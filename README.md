# Alyva-sre

AI-native SRE agent for the SREonCall hackathon (team-1). Three real skills, each a
self-contained module with its own guardrails/house-rules doc, each independently satisfying
the AI-native traits — not a single monolith with features bolted on.

This is **not** an extension of `reference/sreoncall/` — it's a new, standalone prototype
built on the shared LGTM observability stack (Mimir/Loki/Tempo).

## Status

Three skills built, tested against live data, and running together in one review UI:

1. **Onboarding** (`src/skills/onboarding/`) — discovers real services from telemetry, asks
   an SRE-style interview (criticality only when telemetry has no label, business impact only
   for critical/high tier, never invents a number), produces the Project Profile every other
   skill reads from.
2. **Alert Rules** (`src/skills/alert-rules/`) — drafts thresholds from real observed
   metrics/logs/traces, backtests against historical data with cross-signal noise-vs-incident
   corroboration, self-tunes with deterministic direction/calibration guards, reviewed via
   approve/edit/reject.
3. **Detection & RCA** (`src/skills/detection/`) — triggered only when an *approved* Alert
   Rule breaches live (no independent watcher duplicating that logic); a real multi-turn
   tool-use loop investigates via metrics/logs/traces/trace-detail, concludes via a forced
   structured report, gets an adversarial skeptic pass, and supports live follow-up questions
   against the same investigation.

## Run it

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY + the shared LGTM endpoints
npm start               # starts the review UI at :4310, runs all 3 skills' pipelines on boot
```

Or run any single skill's pipeline standalone: `npm run onboarding` / `npm run alert-rules` /
`npm run detection`.

## Design goals (see hackathon rubric)

- **Observability**: real, live visibility into the target system via LGTM, not periodic
  summaries — every number traces to an actual query.
- **Agency**: pipelines run on startup and on a schedule (retune sweep, detection scan) — no
  "click to run" trigger for the actual detection/tuning behavior.
- **Auditability**: every claim cites the actual metric/log/trace behind it — evidence ledgers,
  not summaries with no trail.
- **Malleability**: reasoning adapts to new evidence (backtest-driven tuning, live follow-up
  Q&A re-entering the same investigation); never self-blinds by muting its own telemetry — no
  mute/disable capability exists anywhere in any skill's tool registry.
- **Progressive disclosure**: headline first, full evidence trail collapsed by default.
- **Ownership**: concrete next steps tied to the specific incident; code-fix PR opening is a
  known open gap, not yet built (see each skill's `HOUSE_RULES.md` for what's real vs. planned).
