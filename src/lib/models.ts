/**
 * Core data shapes for Alyva.
 *
 * Two primitives carry every AI-native behavior in this app:
 *
 * - `Proposal` — the generic gated-action envelope. Every reviewable thing
 *   the agent produces (an onboarding profile field, an alert rule, a
 *   dashboard panel, a recommendation, a PR) is a Proposal. Modeled on the
 *   real platform's `AgentApproval`/`McpProposal` shape
 *   (reference/sreoncall/packages/api/src/models/agent-approval.model.ts,
 *   mcp-proposal.model.ts) but adds the `edited` status neither of those
 *   has — the real platform's own documented gap (no modify-then-approve
 *   step) is exactly what this fills. Nothing in this codebase writes a
 *   Proposal's real effect (e.g. an active AlertRule) except through this
 *   approve/apply path — mirrors the reference's own rule that propose_*
 *   tools "NEVER call a creation service directly."
 *
 * - `Question` — the literal "ask, don't assume" mechanism. Anything the
 *   agent cannot derive from a live LGTM query becomes a Question and
 *   blocks the relevant reasoning step until a human answers it. There is
 *   no code path that fabricates a default for an unanswered Question.
 */

export type EvidenceRef = {
  type: "metric" | "log" | "trace";
  /** The exact query/selector run (PromQL, LogQL, or TraceQL/tag filter). */
  query: string;
  /** A short human-readable value/result summary, e.g. "p95 = 476ms". */
  summary: string;
  /** Trace ID / log line id, when applicable — lets a claim be pointed at. */
  ref?: string;
  observedAt: string;
};

export type ProposalKind =
  | "profile_field"
  | "alert_rule"
  | "dashboard_panel"
  | "recommendation"
  | "pr";

export type ProposalStatus =
  | "pending"
  | "edited"
  | "approved"
  | "rejected"
  | "applied"
  | "apply_failed";

export type ProposalHistoryEntry = {
  status: ProposalStatus;
  payload: unknown;
  at: string;
  note?: string;
};

export type Proposal<TPayload = unknown> = {
  id: string;
  kind: ProposalKind;
  serviceId?: string;
  /** Plain-language summary shown to the human reviewer. */
  summary: string;
  /** The exact data this proposal would apply if approved. */
  payload: TPayload;
  /** Why the agent proposed this — must reference the evidence below. */
  rationale: string;
  evidence: EvidenceRef[];
  status: ProposalStatus;
  history: ProposalHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  appliedEntityId?: string;
  applyError?: string;
};

export type Question = {
  id: string;
  skill: "onboarding" | "alerting";
  serviceId?: string;
  /** Grounded in evidence — opens with what the agent already found. */
  prompt: string;
  context: EvidenceRef[];
  answer?: string;
  answeredAt?: string;
  createdAt: string;
};

export type ServiceProfile = {
  serviceId: string;
  displayName: string;
  /** From live Tempo/Mimir/Loki discovery — never hand-entered. */
  discovered: {
    requestsPerMin: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    errorRatePercent: number | null;
    upstreamServices: string[];
    downstreamServices: string[];
    lastDiscoveredAt: string;
    evidence: EvidenceRef[];
  };
  /** Only ever filled from an answered Question — never a fabricated default. */
  businessContext: {
    tier: "revenue_critical" | "customer_facing" | "internal" | "unknown";
    owningTeamOrContact: string | null;
    slaTargetMs: number | null;
    revenuePerIncidentMinuteUsd: number | null;
    avgOrderValueUsd: number | null;
    knownQuirks: string | null;
  };
  /** True only after the batched confirm Proposal for this service is approved. */
  onboarded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlertRulePayload = {
  serviceId: string;
  name: string;
  metricQuery: string;
  operator: "gt" | "lt" | "gte" | "lte";
  threshold: number;
  windowMinutes: number;
  baselineValue: number;
  baselineMultiplier: number;
};

export type AlertRule = AlertRulePayload & {
  id: string;
  proposalId: string;
  status: "active" | "retired";
  firingHistory: AlertFiringEvent[];
  createdAt: string;
  updatedAt: string;
};

export type AlertFiringEvent = {
  id: string;
  firedAt: string;
  observedValue: number;
  /** Was this fire corroborated by real, independent evidence (error-rate/trace spike)? */
  corroborated: boolean | null;
  corroboratingEvidence: EvidenceRef[];
  resolvedAt?: string;
};

export type DashboardPanelSpec = {
  id: string;
  kind: "business_impact" | "top_latency" | "custom";
  title: string;
  /** For 'custom' panels: the query/spec the agent drafted from a chat prompt. */
  spec?: Record<string, unknown>;
  removable: boolean;
  order: number;
};
