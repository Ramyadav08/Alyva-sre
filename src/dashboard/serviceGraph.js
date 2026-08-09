// Real inter-service latency graph — walks actual recent traces (not a
// config file of "known" service dependencies) and derives which service
// calls which, and how long it takes, from real span parent/child
// relationships. This is what answers "top services having the latency
// between service and call request" with real evidence, not a diagram
// someone drew by hand.

const lgtm = require("../lgtm");

const DEFAULT_TRACES_PER_SERVICE = 3;
const MIN_SAMPLES_FOR_RANKING = 2; // a single sample can't support an "average", it's just that one call
const IMPLAUSIBLE_LATENCY_MS = 30_000; // beyond this, it's more likely a long-lived/streaming span than a real request-response call (e.g. flagd's streaming flag-evaluation connections)

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Samples a few recent traces per service, walks every span's parent/child
 * relationship, and records an edge wherever a parent span's service
 * differs from its child's — that's a real cross-service call, with the
 * child span's duration as the latency sample for that edge.
 */
async function buildServiceGraph({ tracesPerService = DEFAULT_TRACES_PER_SERVICE, serviceFilter = null } = {}) {
  const discovered = await lgtm.discoverServices();
  const services = serviceFilter ? discovered.filter((s) => serviceFilter.includes(s.service_name)) : discovered;

  const traceIds = new Set();
  for (const svc of services) {
    try {
      const result = await lgtm.searchTraces(`service.name=${svc.service_name}`, tracesPerService);
      for (const t of result.traces || []) traceIds.add(t.traceID);
    } catch {
      // best-effort — one service's search failing shouldn't block the rest
    }
  }

  const edgeSamples = new Map(); // "source->target" -> [duration_ms, ...]

  for (const traceId of traceIds) {
    let spans;
    try {
      ({ spans } = await lgtm.getTraceGraph(traceId));
    } catch {
      continue;
    }
    const byId = new Map(spans.map((s) => [s.span_id, s]));
    for (const span of spans) {
      if (!span.parent_span_id) continue;
      const parent = byId.get(span.parent_span_id);
      if (!parent || !parent.service_name || !span.service_name) continue;
      if (parent.service_name === span.service_name) continue; // same-service hop, not a cross-service edge

      const key = `${parent.service_name}->${span.service_name}`;
      if (!edgeSamples.has(key)) edgeSamples.set(key, []);
      edgeSamples.get(key).push(span.duration_ms);
    }
  }

  const allEdges = [...edgeSamples.entries()].map(([key, durations]) => {
    const [source, target] = key.split("->");
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    return {
      source,
      target,
      call_count: durations.length,
      avg_latency_ms: avg,
      p99_latency_ms: percentile(sorted, 0.99),
    };
  });

  // No silent caps — an edge excluded from the ranking is reported, not
  // just dropped. Two separate reasons: too few samples to mean anything
  // ("avg" of 1 call isn't an average), or implausibly large (more likely a
  // long-lived/streaming span like flagd's flag-evaluation connection than
  // a real request-response call — comparing it to millisecond RPCs would
  // be misleading, not informative).
  const excluded = [];
  const edges = allEdges.filter((e) => {
    if (e.call_count < MIN_SAMPLES_FOR_RANKING) {
      excluded.push({ ...e, excluded_reason: `only ${e.call_count} sample — too few to average` });
      return false;
    }
    if (e.avg_latency_ms > IMPLAUSIBLE_LATENCY_MS) {
      excluded.push({ ...e, excluded_reason: `${(e.avg_latency_ms / 1000).toFixed(0)}s avg — likely a long-lived/streaming span, not a request-response call` });
      return false;
    }
    return true;
  });

  edges.sort((a, b) => b.avg_latency_ms - a.avg_latency_ms);
  return { edges, excluded, traces_sampled: traceIds.size, services_sampled: services.length };
}

module.exports = { buildServiceGraph };
