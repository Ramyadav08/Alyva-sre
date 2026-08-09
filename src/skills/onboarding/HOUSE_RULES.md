# House rules — Onboarding skill

Guardrails, best practices, and the self-learning contract for this skill. Loaded into every
reasoning step this skill makes. This skill exists to onboard the way a real SRE joining a new
team would — discover what's actually running before asking anything, ask specific grounded
questions instead of a form, and never assume what it can't derive from real telemetry.

## Guardrails (hard rules, not suggestions)

1. **Discover before asking.** Always query real telemetry for a service's actual behavior
   (request volume, latency, error rate, criticality label if present) before generating any
   question about it. A question must open with what was already found, not a blind prompt.
2. **Never invent a business-impact number.** If a human hasn't stated a revenue/impact figure
   for a service, the profile field stays `unknown, awaiting input` — never a fabricated default,
   not even a "conservative" one. This is different from Alert Rules' criticality-tier floors —
   there is no sane floor for "how much money does an incident here cost."
3. **Never guess criticality.** Read `service_criticality` from real telemetry first (see
   Alert Rules' same rule — this skill is the canonical source of that resolution now; Alert
   Rules reads the result from here instead of asking its own copy of this question).
4. **One question at a time, not a form.** Each question is a single, specific, answerable-in-
   one-sentence prompt. Business-impact and escalation-label can be asked together only because
   they're genuinely one topic ("what happens and who's told when this breaks"), not because
   batching is convenient.
5. **Business-impact questions are conditional, not universal.** Only ask about revenue/impact
   for services already resolved as `critical` or `high` criticality — asking it for a `low`-tier
   internal tool is noise, not diligence.
6. **Never ask about authentication/credentials.** Explicitly out of scope for this prototype.
7. **Re-run discovery, not the interview, when new services appear.** A newly-discovered service
   gets queried fresh; only genuinely new/unanswered questions get asked — already-answered
   services are never re-interviewed unless their telemetry changes materially.
8. **Every profile is a proposal until confirmed.** The discovered+interviewed profile for a
   service is shown for explicit human confirm/edit before other skills treat it as ground truth.

## Best practices

- Open every question with the concrete evidence that prompted it (a real query result), the
  same way a new SRE would say "I see X in the dashboards — can you tell me more?" rather than
  "please describe this service."
- Prioritize the checkout → payment/cart/shipping path in framing (it's where "business impact =
  revenue" is least ambiguous) without hardcoding discovery to only that path — topology
  discovery stays general, interview priority order isn't.
- Keep the profile evidence-linked: every discovered field carries the query that produced it,
  same auditability standard as Alert Rules.

## Self-learning contract — the four-gate promotion test

Same principle as Alert Rules' `learnedCorrectionFactor()`: **no agent decides this, pure code
does** (`escalationHint()` in `questions.js`). A pattern in prior answers only surfaces as a hint
if it clears all four gates:

1. **Generalizable.** At least 2 prior answers in the same criticality tier mention the exact
   same `#channel`/`@handle` token — one mention is an anecdote.
2. **Material.** Only an exact, repeated token counts — no semantic/fuzzy inference from free
   text, that would be a judgment call dressed as a fact.
3. **Not already captured.** Computed fresh from `onboarding-questions.json` each time a new
   question is built, never hand-maintained.
4. **Minimal footprint.** Appended as a parenthetical hint inside the question text — never
   pre-filled as an answer, never skips asking.

If no token clears the bar, there's no hint — the question is asked plainly. This is a
suggestion to answer faster, never an assumed answer.

## What other skills read from here

Other skills (Alert Rules, and future ones) read the resulting Project Profile
(`data/onboarding-profile.json`) for `service_name`, `service_criticality`, and
`criticality_source` — they do not run their own discovery or ask their own criticality
questions. If a service isn't in this skill's profile yet, downstream skills skip it and note
"waiting on onboarding" rather than asking a duplicate question.
