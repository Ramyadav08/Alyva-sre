# House rules — Alert Rules skill

Guardrails, best practices, and the self-learning contract for this skill. This file is loaded
into the agent's reasoning prompt at every step — it's not just documentation, it's enforced
context.

## Guardrails (hard rules, not suggestions)

1. **Never invent a threshold with no evidence behind it.** Every proposed rule must cite the
   actual query and computed statistic that produced it. If there isn't enough historical data
   to derive a threshold statistically, say so explicitly and propose a conservative
   criticality-tier default — flagged as "not yet tuned from real data", not presented as if it
   were derived.
2. **Never guess a service's business criticality.** Read `service_criticality` from real
   telemetry first. Only ask a human when that attribute is genuinely absent — and when asking,
   cite exactly what was checked and came up empty.
3. **Never fix noise by muting or disabling.** A noisy rule gets a cited, reasoned threshold or
   logic adjustment — proposed for approval like any other change. Silencing a rule "to stop the
   noise" is treated as a hard failure of this skill, not a valid tuning move.
4. **Never deploy a rule without human approval.** Every draft — first version and every
   subsequent tuning adjustment — is a proposal. Nothing goes from `draft` to `approved` without
   an explicit human action.
5. **Log every adjustment with a before/after.** The tuning history for a rule must show exactly
   what changed, why (which evidence), and what the noise projection was before and after.
6. **Rate-limit tuning proposals.** Don't re-propose a change to the same rule more than once per
   backtest cycle — avoid churn.
7. **Ask, don't assume, when confidence is low.** If the statistical signal for a threshold is
   ambiguous (e.g., bursty baseline with no stable p99), ask a specific question rather than
   picking an arbitrary number.

## Best practices

- Prefer thresholds derived from real historical distributions (p95/p99, rate-of-change) over
  static round numbers.
- Cross-reference signal types where possible — a metric-based latency rule's backtest should
  check whether real error-rate/log evidence exists at the same timestamps, not just whether the
  metric crossed a line.
- Criticality tier shapes tolerance, not just severity label: `critical` services get tighter
  thresholds and lower acceptable noise; `low` gets looser thresholds and higher tolerance for
  occasional false positives.
- Every question asked should be answerable in one sentence — if a question needs a paragraph to
  explain, it's not specific enough yet.

## Self-learning contract — the four-gate promotion test

Each rule's outcome (approved as-is / edited before approval / rejected) is recorded in
`data/outcomes.json`. A pattern in that history only gets promoted into how future rules are
drafted if it clears all four gates — and **no agent decides this; it's pure code**
(`learnedCorrectionFactor()` in `draft.js`), the same principle this skill already applies to
tuning direction (never trust the model's own arithmetic on a checkable fact):

1. **Generalizable.** At least 2 prior edits for the same criticality tier + signal type — one
   data point is an anecdote, not a pattern.
2. **Material.** The correction ratio must be consistent across those edits (within 25% of each
   other) — a scattered, inconsistent set of edits isn't a learnable pattern, it's noise.
3. **Not already captured.** The factor is computed fresh from `outcomes.json` each time, never
   accumulated/hand-edited — so it can't drift from what the data actually shows.
4. **Minimal footprint.** The correction multiplies whatever the LLM's raw threshold was, applied
   deterministically after the fact — it doesn't rewrite the drafting prompt's logic or add a new
   code path per tier.

When applied, the rationale must say so explicitly ("based on N prior edits for this tier, a Xx
correction applies") — never silently.

## Exit criterion for tuning

A rule is marked `stable` (tuning loop stops actively proposing changes) when its noise score has
stayed under the agreed target for the last 3 consecutive evaluation windows. It's still
passively monitored after that — "stable" is not "ignored".
