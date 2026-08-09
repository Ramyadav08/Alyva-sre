/**
 * Recommendations: evidence-cited suggestions tied to what's actually
 * observed (latency/resource-consumption), never generic advice. A
 * recommendation that implies a code change becomes a `pr` Proposal
 * instead of a plain suggestion — approving it is what actually opens a
 * PR (see pr-opener.ts), never a side effect of drafting.
 */
import { getServiceTrafficEdges } from "./lgtm";
import { getDb } from "./store";
import { getLLMClient, type ToolDefinition } from "./llm";
import { createProposal } from "./proposals";
import type { EvidenceRef } from "./models";

const RECOMMEND_TOOL: ToolDefinition = {
  name: "propose_recommendation",
  description: "Propose a concrete recommendation tied to real observed latency/resource data.",
  parameters: {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            service_id: { type: "string" },
            title: { type: "string" },
            description: { type: "string", description: "Concrete, evidence-cited — never generic advice." },
            is_code_fix: { type: "boolean" },
            patch_suggestion: { type: ["string", "null"], description: "Short markdown describing the concrete fix, only if is_code_fix." },
          },
          required: ["service_id", "title", "description", "is_code_fix"],
        },
      },
    },
    required: ["recommendations"],
  },
};

export async function generateRecommendations(): Promise<number> {
  const edges = await getServiceTrafficEdges();
  const db = await getDb();
  const onboardedIds = new Set(db.data.serviceProfiles.filter((p) => p.onboarded).map((p) => p.serviceId));
  const relevantEdges = edges.filter((e) => onboardedIds.has(e.source) || onboardedIds.has(e.target)).slice(0, 8);
  if (relevantEdges.length === 0) return 0;

  const llm = getLLMClient();
  const { toolCalls } = await llm.chat({
    messages: [
      {
        role: "system",
        content:
          "Recommend concrete latency/resource improvements from real observed service-to-service call " +
          "data. Cite the actual numbers given — never generic advice like 'add caching' with nothing to " +
          "back it. Only propose 1-3 of the most impactful. Most infra suggestions are not code changes; " +
          "only mark is_code_fix true when the fix is genuinely a source change (e.g. a query/N+1 fix, a " +
          "missing cache check) you can describe concretely enough to draft a patch note from.",
      },
      { role: "user", content: JSON.stringify({ observedEdges: relevantEdges }) },
    ],
    tools: [RECOMMEND_TOOL],
  });

  const call = toolCalls[0];
  if (!call) return 0;
  const recs = ((call.arguments as any).recommendations ?? []) as any[];
  const now = new Date().toISOString();

  for (const r of recs) {
    const evidence: EvidenceRef[] = relevantEdges
      .filter((e) => e.source === r.service_id || e.target === r.service_id)
      .map((e) => ({
        type: "trace",
        query: `traffic edge ${e.source} → ${e.target}`,
        summary: `avg latency ${e.avgLatencyMs.toFixed(1)}ms over ${e.requestCount} request(s), ${e.errorCount} error(s)`,
        observedAt: now,
      }));

    await createProposal({
      kind: r.is_code_fix ? "pr" : "recommendation",
      serviceId: r.service_id,
      summary: r.title,
      payload: r.is_code_fix
        ? { serviceId: r.service_id, title: r.title, description: r.description, patchSuggestion: r.patch_suggestion ?? "" }
        : { serviceId: r.service_id, title: r.title, description: r.description },
      rationale: r.description,
      evidence,
    });
  }

  return recs.length;
}
