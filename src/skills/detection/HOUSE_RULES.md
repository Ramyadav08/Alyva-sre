# House rules — Detection & RCA skill

Guardrails, best practices, and the self-learning contract for this skill. Loaded into every
investigation's reasoning prompt. This skill exists to notice a real incident and investigate it
the way an SRE actually would — pull evidence, follow it wherever it leads, stop when the
evidence supports a real hypothesis — not to summarize a dashboard.

## Guardrails (hard rules, not suggestions)

1. **The tool registry is read-only, structurally.** `query_metric`, `query_logs`,
   `search_traces`, `get_service_snapshot`, `get_project_profile` — that's the entire list. There
   is no mute/disable/collector-config tool anywhere in this skill, full stop. Malleability
   applies to reasoning about the target system, never to this skill's own observability
   pipeline (the hard rule every other skill in this repo also follows).
2. **Every claim in the final report must cite a ledger entry.** If a sentence in the report
   isn't backed by an actual tool call result in this investigation's ledger, it doesn't get
   written — no "something looks wrong" without the metric/log/trace behind it.
3. **Never invent business impact.** Pull it from the Onboarding Project Profile
   (`get_project_profile`) if it's there; if that service's business impact is still
   "unknown, awaiting input", the report says exactly that — never a guessed dollar figure.
4. **Investigate, don't just re-state the trigger.** The rule that fired is the starting point,
   not the whole investigation — pull at least one signal type beyond the one that triggered
   (e.g. a latency trigger should also check error rate/logs for corroboration) before
   concluding, same cross-signal discipline Alert Rules already uses for backtesting. A trace ID
   alone is not evidence — if `search_traces` returns anything and the investigation involves an
   error, drill into at least one with `get_trace_detail` before concluding. "No error logs
   found" is not a root cause; the actual span status message inside a real trace usually is.
5. **One open investigation per rule at a time.** Don't start a second investigation for the same
   rule while one is still open — re-evaluate the existing one instead of duplicating.
6. **Ownership never self-executes.** A proposed next step — including a code-fix PR — is a
   proposal a human approves, same draft-then-approve shape as every other skill here. This
   skill never merges its own PR.
7. **Follow-ups re-enter the same reasoning, with the same ledger.** A human asking "why didn't
   you check X" is not a new investigation — it's the same one, given a new instruction, with
   every prior tool call still visible to it. This is where malleability is actually demonstrated
   live, not just claimed.

## Best practices

- Open the report with a 2-3 line headline (what broke, blast radius, confidence) — full evidence
  trail is available on demand, never dumped up front.
- Prefer pulling from Onboarding's live snapshot machinery over inventing new query patterns —
  this skill reuses `shared/baseline.js` and `shared/queries.js`, same as Alert Rules.
- Cap tool-use iterations per investigation (see `investigate.js`) — an investigation that can't
  converge should report what it found and flag low confidence, not loop forever.

## Self-learning contract — the four-gate promotion test, same as the other two skills

No agent decides whether a past investigation's outcome changes future investigation behavior —
pure code does (`priorHypothesisHint()` in `run.js`), same principle as Alert Rules'
`learnedCorrectionFactor()` and Onboarding's `escalationHint()`:

1. **Generalizable.** At least 2 resolved investigations for the same service carry the exact
   same `root_cause_tag` — a human-assigned deterministic label, not inferred by an agent.
2. **Material.** Only an exact tag match counts — no semantic similarity between hypothesis
   text, that would be a judgment call dressed as a fact.
3. **Not already captured.** Computed fresh from `investigations.json` on every scan, never
   hand-maintained.
4. **Minimal footprint.** Surfaced as a `prior_hypothesis_hint` field in the trigger context —
   the investigator is told to check that angle first, but still has to verify with real
   evidence; the hint never substitutes for actually investigating.

A skeptic review (see `skeptic.js`) runs on every converged report — an independent pass over
the SAME raw ledger, deliberately not shown the investigator's hypothesis first, to catch
confirmation bias rather than rubber-stamp it. An objection is surfaced visibly, never used to
silently rewrite the report's confidence.

## What this skill reads from / writes to

Reads: Alert Rules' approved rules (trigger source — only a real live threshold breach on an
*approved* rule starts an investigation, never an independent watcher duplicating that logic).
Reads: Onboarding's Project Profile (business impact, criticality context).
Writes: its own investigation records only — never touches another skill's data.
