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

## Self-learning contract

Each rule's outcome (approved as-is / edited before approval / rejected, and later: did tuning
converge or keep missing target) is recorded in this skill's outcome memory
(`data/outcomes.json`). Before drafting a new rule for a service in the same criticality tier,
the skill checks whether past outcomes for that tier show a consistent human correction pattern
(e.g., humans always tighten `medium`-tier latency thresholds by ~20%) and leans toward that
pattern in the next draft — cited as "based on N prior approvals for this tier", not silently.

## Exit criterion for tuning

A rule is marked `stable` (tuning loop stops actively proposing changes) when its noise score has
stayed under the agreed target for the last 3 consecutive evaluation windows. It's still
passively monitored after that — "stable" is not "ignored".
