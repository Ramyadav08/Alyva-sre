/**
 * The onboarding skill's actual reasoning: discover from live LGTM, then —
 * for each service still missing business context — let the LLM decide,
 * one call at a time, whether to ask a single grounded Question or
 * finalize a confirm Proposal. See skills/onboarding.md for the guardrails
 * this reasoning is bound by (never fabricate a business number, one
 * question at a time, cite evidence).
 *
 * Deliberately NOT a fixed if/else sequence for which field to ask about
 * next — that would make onboarding's own judgment (is this service
 * plausibly revenue-bearing? has enough been answered to finalize?)
 * something the LLM call is decorative for, not load-bearing.
 */
import { getServiceHealth, getServiceTrafficEdges, listActiveServiceNames } from "./lgtm";
import { getDb, nowIso } from "./store";
import { askQuestion, listUnanswered } from "./questions";
import { createProposal } from "./proposals";
import { getLLMClient, type ToolDefinition } from "./llm";
import { loadSkillDoc } from "./skills";
import type { EvidenceRef, ServiceProfile } from "./models";

export async function discoverServices(): Promise<{ discoveredCount: number; totalServices: number }> {
  const db = await getDb();
  // Fetched once and shared: listActiveServiceNames already derives its own
  // name set from a traffic-edge walk, so re-fetching edges here would
  // double the Tempo work for no benefit.
  const edges = await getServiceTrafficEdges();
  const names = await listActiveServiceNames(50, edges);
  const now = nowIso();
  let discoveredCount = 0;

  for (const name of names) {
    const health = await getServiceHealth(name);
    const upstream = edges.filter((e) => e.target === name).map((e) => e.source);
    const downstream = edges.filter((e) => e.source === name).map((e) => e.target);

    const evidence: EvidenceRef[] = [
      {
        type: "trace",
        query: `Tempo service graph (spans where service.name="${name}")`,
        summary: `${upstream.length} upstream, ${downstream.length} downstream service(s) observed`,
        observedAt: now,
      },
    ];
    if (health.latencyP95Ms !== null) {
      evidence.push({
        type: "metric",
        query: `histogram_quantile(0.95, ... service_name="${name}")`,
        summary: `p95 latency = ${Math.round(health.latencyP95Ms)}ms`,
        observedAt: now,
      });
    }
    if (health.errorRatePercent !== null) {
      evidence.push({
        type: "metric",
        query: `error-rate ratio for service_name="${name}"`,
        summary: `error rate = ${health.errorRatePercent.toFixed(2)}%`,
        observedAt: now,
      });
    }

    const discovered: ServiceProfile["discovered"] = {
      requestsPerMin: null,
      p50Ms: null,
      p95Ms: health.latencyP95Ms,
      p99Ms: health.latencyP99Ms,
      errorRatePercent: health.errorRatePercent,
      upstreamServices: upstream,
      downstreamServices: downstream,
      lastDiscoveredAt: now,
      evidence,
    };

    const existing = db.data.serviceProfiles.find((p) => p.serviceId === name);
    if (existing) {
      existing.discovered = discovered;
      existing.updatedAt = now;
    } else {
      db.data.serviceProfiles.push({
        serviceId: name,
        displayName: name,
        discovered,
        businessContext: {
          tier: "unknown",
          owningTeamOrContact: null,
          slaTargetMs: null,
          revenuePerIncidentMinuteUsd: null,
          avgOrderValueUsd: null,
          knownQuirks: null,
        },
        onboarded: false,
        createdAt: now,
        updatedAt: now,
      });
      discoveredCount++;
    }
  }

  await db.write();
  return { discoveredCount, totalServices: db.data.serviceProfiles.length };
}

const INTERVIEW_TOOLS: ToolDefinition[] = [
  {
    name: "ask_question",
    description:
      "Ask the human exactly one grounded question about this service, opening with what was actually discovered. Use when a business-context field this service plausibly needs is still unknown.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The question, referencing the relevant discovered evidence." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "finalize_profile",
    description:
      "Call once discovery plus any answered questions add up to enough to consider this service onboarded. Only fill revenue fields for services you judge revenue-bearing or customer-facing; use null for fields that genuinely don't apply (e.g. a purely internal service).",
    parameters: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["revenue_critical", "customer_facing", "internal", "unknown"] },
        owning_team_or_contact: { type: ["string", "null"] },
        sla_target_ms: { type: ["number", "null"] },
        revenue_per_incident_minute_usd: { type: ["number", "null"] },
        avg_order_value_usd: { type: ["number", "null"] },
        known_quirks: { type: ["string", "null"] },
        rationale: { type: "string", description: "Why this is enough to finalize now." },
      },
      required: ["tier", "rationale"],
    },
  },
];

export async function runInterviewStep(serviceId: string): Promise<{ action: "asked" | "finalized" | "skipped" }> {
  const db = await getDb();
  const profile = db.data.serviceProfiles.find((p) => p.serviceId === serviceId);
  if (!profile || profile.onboarded) return { action: "skipped" };

  const pending = await listUnanswered("onboarding");
  if (pending.some((q) => q.serviceId === serviceId)) return { action: "skipped" }; // already waiting on a human

  const hasPendingProposal = db.data.proposals.some(
    (p) => p.serviceId === serviceId && p.kind === "profile_field" && (p.status === "pending" || p.status === "edited"),
  );
  if (hasPendingProposal) return { action: "skipped" };

  const answeredHistory = db.data.questions
    .filter((q) => q.serviceId === serviceId && q.answer)
    .map((q) => ({ question: q.prompt, answer: q.answer }));

  const skillDoc = await loadSkillDoc("onboarding");
  const llm = getLLMClient();

  const { toolCalls } = await llm.chat({
    messages: [
      { role: "system", content: skillDoc },
      {
        role: "user",
        content:
          `Current knowledge of service "${serviceId}":\n` +
          JSON.stringify({ discovered: profile.discovered, businessContext: profile.businessContext, answeredHistory }, null, 2) +
          `\n\nDecide: ask exactly one more grounded question, or finalize if you have enough. Call exactly one tool.`,
      },
    ],
    tools: INTERVIEW_TOOLS,
  });

  const call = toolCalls[0];
  if (!call) return { action: "skipped" };

  if (call.name === "ask_question") {
    await askQuestion({
      skill: "onboarding",
      serviceId,
      prompt: String(call.arguments.prompt ?? ""),
      context: profile.discovered.evidence,
    });
    return { action: "asked" };
  }

  if (call.name === "finalize_profile") {
    const args = call.arguments as Record<string, unknown>;
    await createProposal({
      kind: "profile_field",
      serviceId,
      summary: `Onboard ${serviceId} — ${String(args.tier)} tier`,
      payload: {
        serviceId,
        displayName: profile.displayName,
        discovered: profile.discovered,
        businessContext: {
          tier: args.tier,
          owningTeamOrContact: (args.owning_team_or_contact as string | null) ?? null,
          slaTargetMs: (args.sla_target_ms as number | null) ?? null,
          revenuePerIncidentMinuteUsd: (args.revenue_per_incident_minute_usd as number | null) ?? null,
          avgOrderValueUsd: (args.avg_order_value_usd as number | null) ?? null,
          knownQuirks: (args.known_quirks as string | null) ?? null,
        },
      },
      rationale: String(args.rationale ?? ""),
      evidence: profile.discovered.evidence,
    });
    return { action: "finalized" };
  }

  return { action: "skipped" };
}

export async function runOnboardingCycle() {
  const discovery = await discoverServices();
  const db = await getDb();
  const interview: Array<{ serviceId: string; action: string }> = [];

  for (const profile of db.data.serviceProfiles) {
    if (profile.onboarded) continue;
    const result = await runInterviewStep(profile.serviceId);
    interview.push({ serviceId: profile.serviceId, ...result });
  }

  return { discovery, interview };
}
