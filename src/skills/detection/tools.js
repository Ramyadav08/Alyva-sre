// The entire tool registry for this skill. Read-only, structurally — per
// house rule #1, there is no mute/disable/collector-config function
// anywhere in this file or called from it. This IS the enforcement
// mechanism, not a comment promising restraint.

const lgtm = require("../../lgtm");
const { computeBaseline } = require("../../shared/baseline");
const { getProfile } = require("../onboarding/profile");

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "query_metric",
      description: "Run a PromQL instant query against Mimir. Use for any metric-based check not already covered by get_service_snapshot.",
      parameters: {
        type: "object",
        properties: { promql: { type: "string", description: "The PromQL query." } },
        required: ["promql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_logs",
      description: "Run a LogQL query against Loki over the last N minutes. Use to check for real error log lines corroborating (or not) a metric signal.",
      parameters: {
        type: "object",
        properties: {
          logql: { type: "string", description: "The LogQL selector/query." },
          since_minutes: { type: "number", description: "How many minutes back to search. Default 15." },
        },
        required: ["logql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_traces",
      description: "Search Tempo for traces matching a tag filter (e.g. 'service.name=checkout'). Without since_minutes, only searches RECENT traces — a 'no errors' conclusion based on that alone does NOT cover a longer window a question might be asking about (e.g. 'in the last 24 hours'). Set since_minutes explicitly whenever the question specifies or implies a time window; do not conclude 'no errors in N hours' from a recent-only search.",
      parameters: {
        type: "object",
        properties: {
          tag_filter: { type: "string", description: "Tempo tag filter, e.g. 'service.name=checkout'." },
          limit: { type: "number", description: "Max traces to return. Default 5." },
          since_minutes: { type: "number", description: "If set, searches this many minutes back instead of just recent traces." },
        },
        required: ["tag_filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trace_detail",
      description: "Fetch a specific trace's full span detail, distilled to which spans errored, in which service, with what message. A trace ID from search_traces alone tells you nothing — the actual error message inside one of its spans is the real evidence. ALWAYS drill into at least one trace if search_traces returned any and the investigation involves an error.",
      parameters: {
        type: "object",
        properties: { trace_id: { type: "string" } },
        required: ["trace_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_service_snapshot",
      description: "Get a real, current multi-signal snapshot for a service — p99/p50 latency, error rate, call rate, log error rate — the same computation Alert Rules uses. Good first call for any service in the investigation.",
      parameters: {
        type: "object",
        properties: { service_name: { type: "string" } },
        required: ["service_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_profile",
      description: "Get the Onboarding Project Profile for a service — criticality, business impact if known. Use this for business-impact context; NEVER invent a dollar figure if this comes back unknown.",
      parameters: {
        type: "object",
        properties: { service_name: { type: "string" } },
        required: ["service_name"],
      },
    },
  },
];

const EXECUTORS = {
  async query_metric({ promql }) {
    const result = await lgtm.queryMetric(promql);
    return { promql, result: result.data };
  },
  async query_logs({ logql, since_minutes }) {
    const result = await lgtm.queryLogs(logql, since_minutes || 15, 50);
    return { logql, since_minutes: since_minutes || 15, result: result.data };
  },
  async search_traces({ tag_filter, limit, since_minutes }) {
    if (since_minutes) {
      // A longer window needs a bigger sample by default — 5 traces out of
      // a real 24h window is a coin-flip, not evidence. Found via testing:
      // a 5-trace sample happened to be clean and the model concluded "no
      // errors in 24h" from it. Scale the default with the window instead
      // of leaving it at the "recent" default.
      const defaultLimit = since_minutes > 180 ? 30 : since_minutes > 30 ? 15 : 5;
      const end = Math.floor(Date.now() / 1000);
      const start = end - since_minutes * 60;
      const result = await lgtm.searchTracesRange(tag_filter, start, end, limit || defaultLimit);
      return { tag_filter, since_minutes, sample_size: (result.traces || []).length, traces: result.traces || [] };
    }
    const result = await lgtm.searchTraces(tag_filter, limit || 5);
    return { tag_filter, traces: result.traces || [], note: "recent traces only — no since_minutes given" };
  },
  async get_trace_detail({ trace_id }) {
    return await lgtm.getTraceDetail(trace_id);
  },
  async get_service_snapshot({ service_name }) {
    return await computeBaseline(service_name);
  },
  async get_project_profile({ service_name }) {
    const profile = getProfile(service_name);
    return profile || { service_name, status: "not_onboarded_yet" };
  },
};

async function executeTool(name, args) {
  const fn = EXECUTORS[name];
  if (!fn) throw new Error(`Unknown tool: ${name}`);
  return fn(args);
}

module.exports = { TOOL_DEFINITIONS, executeTool };
