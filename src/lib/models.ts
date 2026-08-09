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

/**
 * Alert-rule shapes ported from Ramya's real, working alert-rules skill
 * (src/skills/alert-rules/*.js) — backtest-against-real-history, not a
 * real-time fire-tracking model. That's a deliberate substitution for what
 * an earlier version of this plan sketched: waiting for live rules to
 * accumulate real fire history is slow and hard to demo honestly, whereas
 * replaying the rule's own query against real historical LGTM data
 * produces the same judgment (is this rule noisy?) from evidence that
 * already exists. Field names adapted to this codebase's camelCase
 * convention; the algorithms themselves (baseline.js/draft.js/backtest.js/
 * tuning.js) are followed faithfully — see lib/alert-rules/.
 */
export type AlertSignalType = "trace_latency" | "trace_error_rate" | "log_error_rate";
export type AlertCriticality = "critical" | "high" | "medium" | "low";

export type AlertBacktestVerdict =
  | "never_fired_in_window"
  | "acceptable"
  | "frequent_but_corroborated"
  | "likely_noisy"
  | "untestable"
  | "no_historical_data"
  | "query_failed";

export type AlertBacktestResult = {
  verdict: AlertBacktestVerdict;
  fractionAbove: number | null;
  sampleCount: number;
  episodeCount: number;
  corroboratedFraction: number | null;
  ranAt: string;
  /** Raw historical values from the backtest window — reused by tuning.ts to compute a candidate threshold without re-fetching. */
  rawValues?: number[];
};

export type AlertTuningHistoryEntry = {
  iteration: number;
  at: string;
  beforeThreshold: number;
  afterThreshold: number;
  beforeWindowMinutes: number;
  afterWindowMinutes: number;
  reason: string;
  backtestBefore: AlertBacktestVerdict;
};

export type AlertRetuneProposal = {
  newThreshold: number;
  newWindowMinutes: number;
  rationale: string;
  backtest: AlertBacktestResult;
  proposedAt: string;
};

export type AlertRulePayload = {
  serviceId: string;
  signalType: AlertSignalType;
  criticality: AlertCriticality;
  operator: "gt" | "lt";
  threshold: number;
  thresholdUnit: string;
  windowMinutes: number;
  rationale: string;
  evidenceStatsUsed: string[];
  confidence: "high" | "medium" | "low";
  /** Set only on a retune Proposal — approving it updates this existing rule in place (with a tuningHistory entry) instead of creating a new one. */
  retuneOfRuleId?: string;
};

export type AlertRule = AlertRulePayload & {
  id: string;
  proposalId: string;
  status: "active" | "retired";
  baselineSnapshot: Record<string, unknown>;
  tuningHistory: AlertTuningHistoryEntry[];
  lastBacktest: AlertBacktestResult | null;
  retuneProposal: AlertRetuneProposal | null;
  retuneRejections: Array<{ at: string; note?: string }>;
  learnedCorrectionApplied: { factor: number; sampleSize: number; preCorrectionThreshold: number } | null;
  createdAt: string;
  updatedAt: string;
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
