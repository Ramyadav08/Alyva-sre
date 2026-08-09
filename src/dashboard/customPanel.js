// Custom panels via chat — user describes what they want, the LLM picks a
// CATEGORY + SERVICE (a small, checkable judgment call), and the actual
// query is built deterministically from the same tested templates Alert
// Rules/Detection already use (shared/queries.js) — never freehand PromQL
// from a raw metric-name list. That approach was tried first and picked the
// wrong metric entirely for "checkout error rate" (chose a payment-service
// transaction-count metric) — same lesson as everywhere else this session:
// let the LLM judge, let code do the mechanical construction.

const OpenAI = require("openai");
const lgtm = require("../lgtm");
const store = require("../shared/store");
const { traceLatencyP99Query, traceErrorRateQuery, logErrorRateQuery } = require("../shared/queries");
const { lokiServiceLabel } = require("../shared/baseline");

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey });
}

const CATEGORIES = ["trace_latency_p99", "trace_error_rate", "log_error_rate", "call_rate"];

const SPEC_TOOL = {
  type: "function",
  function: {
    name: "submit_panel_spec",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        service_name: { type: "string", description: "MUST be one of the real discovered service names provided — never invent one." },
        chart_type: { type: "string", enum: ["stat", "timeseries"] },
        cannot_fulfill_reason: { type: "string", description: "Set this INSTEAD of the above if the request doesn't match any category/service available — never force a bad match." },
      },
      required: ["title", "chart_type"],
    },
  },
};

async function draftPanelSpec(request) {
  const ai = client();
  const discovered = await lgtm.discoverServices();
  const serviceNames = discovered.map((s) => s.service_name);

  const completion = await ai.chat.completions.create({
    model: process.env.DASHBOARD_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          `You draft a dashboard panel spec. You may ONLY choose from these categories: ${CATEGORIES.join(", ")} ` +
          `and these real service names: ${serviceNames.join(", ")}. Never invent a service or category not in ` +
          `these lists. If the request doesn't map to any of them, set cannot_fulfill_reason instead of guessing. ` +
          `Call submit_panel_spec.`,
      },
      { role: "user", content: `User request: "${request}"` },
    ],
    tools: [SPEC_TOOL],
    tool_choice: { type: "function", function: { name: "submit_panel_spec" } },
  });

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("Model did not return a panel spec.");
  const spec = JSON.parse(call.function.arguments);

  // Structural validation, not just trusting the schema constraint — same
  // pattern as everywhere else: the LLM's output gets checked against real
  // facts before anything downstream trusts it.
  if (spec.cannot_fulfill_reason) return spec;
  if (!CATEGORIES.includes(spec.category)) {
    return { ...spec, cannot_fulfill_reason: `Model returned an invalid category "${spec.category}".` };
  }
  if (!serviceNames.includes(spec.service_name)) {
    return { ...spec, cannot_fulfill_reason: `Model returned "${spec.service_name}", which isn't a real discovered service.` };
  }
  return spec;
}

const WINDOW_MINUTES = 15;

async function buildQueryForSpec(spec) {
  switch (spec.category) {
    case "trace_latency_p99":
      return { kind: "metric", query: traceLatencyP99Query(spec.service_name, WINDOW_MINUTES), unit: "ms" };
    case "trace_error_rate":
      return { kind: "metric", query: traceErrorRateQuery(spec.service_name, WINDOW_MINUTES), unit: "fraction" };
    case "log_error_rate": {
      const label = await lokiServiceLabel(spec.service_name);
      if (!label) return null;
      return { kind: "log", query: logErrorRateQuery(label, WINDOW_MINUTES), unit: "lines/min", divideBy: WINDOW_MINUTES };
    }
    case "call_rate":
      return { kind: "metric", query: `sum(rate(traces_span_metrics_calls_total{service_name="${spec.service_name}"}[${WINDOW_MINUTES}m]))`, unit: "req/s" };
    default:
      return null;
  }
}

async function executePanelSpec(spec) {
  if (spec.cannot_fulfill_reason) return { kind: "error", error: spec.cannot_fulfill_reason };

  const built = await buildQueryForSpec(spec);
  if (!built) return { kind: "error", error: `No queryable source for ${spec.category} on ${spec.service_name}.` };

  try {
    if (spec.chart_type === "timeseries" && built.kind === "metric") {
      const end = Math.floor(Date.now() / 1000);
      const start = end - 3600;
      const result = await lgtm.queryMetricRange(built.query, start, end, 60);
      return { kind: "timeseries", series: result.data?.result || [], unit: built.unit, query: built.query };
    }
    if (built.kind === "metric") {
      const result = await lgtm.queryMetric(built.query);
      const value = result.data?.result?.[0]?.value?.[1];
      return { kind: "stat", value: value != null ? Number(value) : null, unit: built.unit, query: built.query };
    }
    // log-based stat
    const result = await lgtm.queryLogs(built.query, WINDOW_MINUTES, 1);
    const series = result.data?.result?.[0]?.values || [];
    const last = series.length ? Number(series[series.length - 1][1]) / built.divideBy : 0;
    return { kind: "stat", value: last, unit: built.unit, query: built.query };
  } catch (err) {
    return { kind: "error", error: err.message };
  }
}

async function draftAndPreview(request) {
  const spec = await draftPanelSpec(request);
  const data = await executePanelSpec(spec);
  return { spec, data };
}

function keepPanel(spec) {
  const layout = store.load("dashboard-layout", []);
  layout.push({ ...spec, id: `panel-${Date.now()}`, kept_at: new Date().toISOString() });
  store.save("dashboard-layout", layout);
  return layout;
}

function removePanel(panelId) {
  const layout = store.load("dashboard-layout", []).filter((p) => p.id !== panelId);
  store.save("dashboard-layout", layout);
  return layout;
}

function getLayout() {
  return store.load("dashboard-layout", []);
}

// --- Auto-created panels — no chat prompt, no LLM call -------------------
// A user has to type into chat to get a panel from draftPanelSpec() above.
// This path is for the opposite case: the moment Detection's scan finds an
// approved Alert Rule breaching live (agency, not a click), the exact
// service + signal that breached is already known ground truth — there is
// nothing for an LLM to guess, so this builds the spec deterministically
// and skips the model entirely. Keyed by rule_id so a rule already under
// investigation never gets a duplicate panel on the next scan cycle.

const AUTO_CATEGORY_BY_SIGNAL = {
  trace_latency: { category: "trace_latency_p99", chart_type: "timeseries" },
  trace_error_rate: { category: "trace_error_rate", chart_type: "timeseries" },
  log_error_rate: { category: "log_error_rate", chart_type: "stat" },
  // "baseline_anomaly" has no single queryable series of its own — never
  // force a bad match, same rule draftPanelSpec follows via cannot_fulfill_reason.
};

/**
 * Called from Detection's scan the instant a rule is confirmed firing —
 * before the investigation itself has even converged, so the panel shows
 * up in real time, not only once there's a conclusion to report.
 */
async function ensureAutoPanel(rule) {
  const panelId = `auto-${rule.id}`;
  const layout = store.load("dashboard-layout", []);
  if (layout.some((p) => p.id === panelId)) return layout; // already created for this open investigation

  const mapping = AUTO_CATEGORY_BY_SIGNAL[rule.signal_type];
  if (!mapping) return layout; // no queryable category for this signal — disclosed via absence, not a bad guess

  const spec = {
    id: panelId,
    auto: true,
    rule_id: rule.id,
    service_name: rule.service_name,
    category: mapping.category,
    chart_type: mapping.chart_type,
    title: `${rule.service_name} — ${rule.signal_type.replace(/_/g, " ")} (auto — rule breached)`,
    reason: `Auto-created: approved rule for ${rule.service_name}/${rule.signal_type} breached live.`,
    created_at: new Date().toISOString(),
  };

  layout.push(spec);
  store.save("dashboard-layout", layout);
  return layout;
}

/**
 * Sweeps auto-panels whose investigation has since resolved and aged past
 * the grace window — keeps the dashboard from accumulating panels for
 * incidents that are long over, without silently deleting anything still
 * relevant (open, or resolved recently).
 */
const AUTO_PANEL_RETENTION_MS = 2 * 60 * 60 * 1000; // 2h after resolution

function pruneStaleAutoPanels(investigations) {
  const layout = store.load("dashboard-layout", []);
  const byRuleId = new Map(investigations.map((inv) => [inv.rule_id, inv]));
  const now = Date.now();

  const kept = layout.filter((p) => {
    if (!p.auto) return true; // never touch chat-created panels here
    const inv = byRuleId.get(p.rule_id);
    if (!inv) return false; // orphaned — no matching investigation at all, safe to drop
    if (inv.status !== "resolved") return true; // still open — keep
    const resolvedAgeMs = now - new Date(inv.resolved_at).getTime();
    return resolvedAgeMs < AUTO_PANEL_RETENTION_MS;
  });

  if (kept.length !== layout.length) store.save("dashboard-layout", kept);
  return kept;
}

module.exports = {
  draftAndPreview,
  executePanelSpec,
  keepPanel,
  removePanel,
  getLayout,
  ensureAutoPanel,
  pruneStaleAutoPanels,
};
