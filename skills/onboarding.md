---
name: onboarding
description: Discover a target system's real topology from live LGTM telemetry and interview a human for whatever that telemetry cannot answer (business criticality, ownership, revenue impact), the way a real SRE gets onboarded to a new service on day one. Use when a service appears in LGTM with no ServiceProfile yet, or when an existing profile's discovered data has drifted enough to warrant re-confirming it — not just when a human explicitly asks to "onboard" something.
---

# Onboarding skill

A real SRE joining a team doesn't get handed a finished runbook — they poke around the
dashboards themselves, then ask the team the things dashboards can't tell them, then repeat
back what they think they now know before they trust it. This skill is that sequence, made
literal: discover from evidence, ask one grounded question at a time for the rest, confirm
before treating anything as final. It never guesses a business fact it wasn't told.

## What to do when invoked

1. **Discover.** Query Tempo for the live service graph, Mimir for available metric names, Loki
   for active service labels. Build or refresh a draft `ServiceProfile` per discovered service —
   request volume, p50/p95/p99 latency, error rate, upstream/downstream services — with the exact
   query behind every field recorded as evidence. This step runs unprompted; it is never gated
   behind a human clicking anything.
2. **Check what's still unknown.** For each service, compare its `businessContext` fields against
   what discovery could possibly answer. Tier, owning contact, SLA target, and — for anything on a
   revenue-bearing path — revenue-per-incident-minute or average order value are never derivable
   from telemetry. Anything still unknown becomes step 3, not a guess.
3. **Interview, one question at a time.** For each unknown field, ask a single `Question` that
   opens with what was actually discovered ("checkout→payment is averaging 340ms p95 and 2.1%
   error rate over the last hour — is this revenue-bearing, and roughly what's revenue/min or
   average order value if a checkout-path incident happens?"). Wait for the answer before asking
   the next one. Never present a form with every field at once.
4. **Confirm before finalizing.** Once discovery + interview are both complete for a service,
   present the full profile as a `profile_field` Proposal (batched per service) for explicit
   approve / edit / reject. A service is not `onboarded: true` until this Proposal is approved.
5. **Re-trigger discovery, not the interview, on drift.** If LGTM shows a genuinely new service, or
   a discovered field has moved enough to be worth re-confirming, redo step 1 for that service only
   — don't re-ask business-context questions that were already answered unless the human corrects
   them.

## Guardrails

- Never fabricate a business-impact number (revenue/min, order value, SLA target) if the human
  hasn't answered it — show "unknown, awaiting input" instead of a plausible-sounding default.
- Every topology or latency claim must carry the exact query it came from.
- One question per `Question` record — never bundle multiple unknowns into a single prompt.
- A profile is a draft until its confirm Proposal is approved; nothing downstream (alerting,
  dashboard business-impact panel) should treat an unconfirmed profile as ground truth.

## House rules

- Prioritize the checkout/payment/cart path first when multiple services have unanswered
  business-context questions — it's the one path where "business impact" is unambiguous.
- If a human edits a discovered field during confirm (not just the business-context fields),
  treat that as a correction to trust over telemetry going forward, not a one-time override.

## Best practices

- If discovery evidence already shows a real `service_criticality` telemetry label for a
  service, treat that as strong evidence for tier — don't re-ask a human to reclassify from
  scratch. Still ask for whatever the label can't answer (owning team, revenue $ figures);
  finalize with tier informed by the label plus whatever the human adds, not the label alone.
- Open every interview question with the evidence that prompted it — a question that doesn't
  reference what was actually observed reads as a form, not a real interview.
- Keep the confirm Proposal's summary short enough to scan in one glance; the full evidence list
  is available on demand, not dumped inline.

## Lessons learned

<!-- The agent appends a short, evidence-cited entry here after each real confirm decision
     (approve/edit/reject) — this section is the running, git-tracked record of how this skill's
     own judgment has adapted over time. Never hand-edit past entries; only append. -->
