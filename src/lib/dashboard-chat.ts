/**
 * Custom-panel-from-chat: the user asks for a panel in plain language, the
 * agent drafts a spec backed by one of a small set of REAL data sources
 * (never an arbitrary free-form chart on data that doesn't exist — that
 * would violate Observability the same way a hallucinated metric would),
 * runs it once for a live preview, and only persists it if the human says
 * "keep." Same draft-then-approve envelope as everything else — a
 * discarded panel is never silently saved.
 */
import { getDb } from "./store";
import { getServiceHealth, getServiceTrafficEdges, queryMetricsRange } from "./lgtm";
import { buildQueryForRule } from "./alert-rules/queries";
import { getLLMClient, type ToolDefinition } from "./llm";
import { createProposal } from "./proposals";
import type { AlertSignalType, DashboardPanelSpec } from "./models";

export type CustomPanelSpec = {
  kind: "service_ranking" | "metric_series";
  title: string;
  rankBy?: "call_latency" | "error_rate" | "latency_p95";
  serviceId?: string;
  signalType?: AlertSignalType;
  windowMinutes?: number;
};

const DRAFT_PANEL_TOOL: ToolDefinition = {
  name: "draft_panel",
  description:
    "Draft a dashboard panel backed by real, queryable data. Only two kinds exist: " +
    "'service_ranking' (rank onboarded services by a real signal) or 'metric_series' " +
    "(one service's real metric over a real time window). Never invent a data source that isn't one of these.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["service_ranking", "metric_series"] },
      title: { type: "string" },
      rank_by: { type: "string", enum: ["call_latency", "error_rate", "latency_p95"] },
      service_id: { type: "string" },
      signal_type: { type: "string", enum: ["trace_latency", "trace_error_rate"] },
      window_minutes: { type: "number" },
    },
    required: ["kind", "title"],
  },
};

export async function runCustomPanelSpec(spec: CustomPanelSpec): Promise<unknown> {
  if (spec.kind === "service_ranking") {
    if (spec.rankBy === "call_latency") {
      const edges = await getServiceTrafficEdges();
      return edges.slice(0, 10).map((e) => ({ label: `${e.source} → ${e.target}`, value: e.avgLatencyMs, unit: "ms" }));
    }
    const db = await getDb();
    const onboarded = db.data.serviceProfiles.filter((p) => p.onboarded);
    const health = await Promise.all(onboarded.map((p) => getServiceHealth(p.serviceId)));
    const rows = onboarded
      .map((p, i) => ({
        label: p.serviceId,
        value: spec.rankBy === "error_rate" ? health[i].errorRatePercent : health[i].latencyP95Ms,
        unit: spec.rankBy === "error_rate" ? "%" : "ms",
      }))
      .filter((r) => r.value !== null)
      .sort((a, b) => (b.value as number) - (a.value as number))
      .slice(0, 10);
    return rows;
  }

  // metric_series
  const signalType = spec.signalType ?? "trace_latency";
  const windowMinutes = spec.windowMinutes ?? 60;
  const built = spec.serviceId ? buildQueryForRule(signalType, spec.serviceId, 5) : null;
  if (!built) return [];
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - windowMinutes * 60;
  const result = await queryMetricsRange(built.query, startSec, endSec, "60s");
  return (result[0]?.values ?? []).map(([ts, v]) => ({ ts, value: Number(v) }));
}

export async function draftCustomPanel(prompt: string) {
  const db = await getDb();
  const onboardedServiceIds = db.data.serviceProfiles.filter((p) => p.onboarded).map((p) => p.serviceId);

  const llm = getLLMClient();
  const { toolCalls } = await llm.chat({
    messages: [
      {
        role: "system",
        content:
          "You draft dashboard panels for an SRE tool from a plain-language request. Only two real " +
          "data sources exist — never invent a third. Pick service_id only from the onboarded list given.",
      },
      { role: "user", content: JSON.stringify({ request: prompt, onboardedServiceIds }) },
    ],
    tools: [DRAFT_PANEL_TOOL],
  });

  const call = toolCalls[0];
  if (!call) throw new Error("Could not draft a panel from that request — try rephrasing it.");
  const args = call.arguments as Record<string, unknown>;

  const spec: CustomPanelSpec = {
    kind: args.kind as CustomPanelSpec["kind"],
    title: String(args.title),
    rankBy: args.rank_by as CustomPanelSpec["rankBy"],
    serviceId: args.service_id as string | undefined,
    signalType: args.signal_type as AlertSignalType | undefined,
    windowMinutes: args.window_minutes as number | undefined,
  };

  const previewData = await runCustomPanelSpec(spec);

  const payload: Omit<DashboardPanelSpec, "id" | "order"> & { previewData: unknown } = {
    kind: "custom",
    title: spec.title,
    spec: spec as unknown as Record<string, unknown>,
    removable: true,
    previewData,
  };

  return createProposal({
    kind: "dashboard_panel",
    summary: `Custom panel: "${spec.title}"`,
    payload,
    rationale: `Drafted from: "${prompt}"`,
    evidence: [],
  });
}
