---
name: alerting
description: Baseline real observed metrics per onboarded service, propose alert rules grounded in that baseline and in business-impact context from the onboarding skill, run an approve/edit/reject review loop, then continuously check each active rule's own firing history against real corroborating evidence and propose threshold/window adjustments when a rule is noisy. Use whenever a service becomes onboarded with no rules yet, or when an active rule's firing history has enough data to judge its noise level — not only when a human explicitly asks for alerts.
---

# Alerting skill

Alert rules that never get revisited rot — they either drift silent while a service's real
traffic pattern changes, or they nag until someone mutes them. This skill treats a rule as a
living Proposal, not a one-time artifact: propose from real baselines, let a human approve or
edit before it goes active, then keep judging its own firing history against real evidence and
proposing adjustments back through the same review loop. It is structurally unable to fix a
noisy rule by touching the thing that observes it — see the hard rule below.

## What to do when invoked

1. **Baseline.** For an onboarded service with no rules yet, query recent Mimir/Loki/Tempo
   history for its normal ranges (latency percentiles, error-rate baseline, throughput) over a
   real time window. Record the exact query and window used.
2. **Propose.** Draft a small set of `alert_rule` Proposals per service — e.g. "p95 latency >
   1.4× observed baseline (476ms) for 5 min" — each carrying its rationale, its evidence, and
   business-impact framing pulled from that service's `ServiceProfile.businessContext` ("checkout
   p95 breach ≈ $X/min at risk, per the answer on file"). If `businessContext` is still unknown
   for this service, say so plainly instead of omitting the framing silently. Before drafting,
   also consult every active `AlertPolicy` — plain-English house rules a human typed verbatim
   ("don't page before 9am unless it's payments") — and adjust threshold/window/quiet-hours to
   satisfy any that concretely apply to this service/signal. List the exact policy id(s) applied
   in `appliedPolicyIds`; never claim a policy shaped a rule without citing which one.
3. **Review loop.** A human can approve, reject, or edit-then-approve (adjust threshold/window).
   An edit is not a one-off override — the edited value becomes the new baseline this skill
   reasons from on its next pass for that rule, not something to drift back from later.
4. **Monitor.** Once approved/applied, the rule runs for real against live LGTM data. Every fire
   is checked against independent corroborating evidence (did a real error-rate or trace anomaly
   actually accompany it, or not) — never judged by vibes.
5. **Self-correct.** When a rule's firing history shows it's noisy (fired without corroboration
   more than it fired with it), propose a new threshold/window adjustment as a fresh Proposal with
   before/after evidence, and route it through the same review loop. Never change a live rule
   silently.
6. **Reconsider against new policies.** On the same unprompted cycle, also check every
   already-active rule against any `AlertPolicy` it hasn't applied yet — a policy added after a
   rule went live must still reach it, not just future drafts. If one concretely applies, propose
   a policy-driven retune (same review loop, `retuneOfRuleId` set) citing the policy's exact text
   and id. If it doesn't apply, say why rather than a bare "no."

## Guardrails

- No function this skill can call may mute an alert, disable a collector, or otherwise reduce
  what LGTM observes — the only writable surface for "fixing" a rule is the rule's own
  definition. This must be true structurally (the tool list itself has no such function), not
  just a prompted instruction.
- Every self-correction proposal must show the real before/after evidence that motivated it —
  never a bare "this seemed noisy."
- An edited threshold is the new baseline going forward — don't silently revert to a prior value
  on a later pass.
- A policy's `quiet_hours` must have a real structural effect (samples inside it are excluded from
  the noise/firing judgment in backtest.ts, evidenced by a real `excludedByQuietHoursCount`) — a
  policy field nothing ever reads is a decoration, not a house rule.
- A policy applies only when its text is genuinely about the service/signal in front of you — a
  policy naming one service never silently spreads to another because it happened to be active.

## House rules

- Don't propose a rule for a service until its `ServiceProfile.onboarded` is true — an
  unconfirmed profile isn't ground truth yet (see the onboarding skill).
- When business-impact framing is missing, propose the rule anyway (observability shouldn't wait
  on business context) but flag the missing framing explicitly rather than omitting it.

## Best practices

- Prefer a rule's own real fire history over a fixed observation window when judging noise — a
  rule that's fired 20 times is a stronger signal than one that's fired twice, regardless of how
  long it's been active.
- Keep each self-correction proposal scoped to one rule at a time so a reviewer can judge it on
  its own evidence, not a bundle.

## Lessons learned

<!-- Gated, not a blind append log (see lib/skills.ts, adapted from transilienceai/communitytools'
     skill-update four-gate promotion test): a routine "approved exactly as drafted" is never
     logged here — only a real rejection or edit carries a correction worth remembering. A new
     entry about the same service+decision-type supersedes (replaces) the old one rather than
     duplicating it, and the list is capped, oldest dropped first. Don't hand-edit past entries;
     the write path maintains this section, not a human. -->

- 2026-08-09T10:58:23.373Z — Rejected — "flagd": "trace_error_rate rule for flagd — gt 0.05fraction over 5m" — threshold too loose for a critical-tier service. Weigh this against similar future proposals.
- 2026-08-09T12:34:39.589Z — Rejected — "frontend-web": "log_error_rate rule for frontend-web — gt 40.00lines/min over 15m" — second rejection reason, should replace the first. Weigh this against similar future proposals.
- 2026-08-09T12:35:52.634Z — Rejected — "load-generator": "trace_latency rule for load-generator — gt 4517.19ms over 5m" — testing whitespace fix. Weigh this against similar future proposals.
- 2026-08-09T14:32:45.203Z — Rejected — "product-catalog": "log_error_rate rule for product-catalog — gt 10.00lines/min over 5m". Weigh this against similar future proposals.
