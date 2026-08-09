# Alyva-sre

AI-native incident response prototype for the SREonCall hackathon (team-1).

This is **not** an extension of `reference/sreoncall/` — it's a new, standalone prototype
built on top of the shared LGTM observability stack (Mimir/Loki/Tempo).

## Status

🚧 Scaffold only — initial commit to establish the repo. Real agent behavior (detection,
reasoning, proposed actions) lands in following commits.

## Stack

- `lgtm-client.js` — verified client against the shared Mimir/Loki/Tempo stack (ported from
  the hackathon starter kit).

## Design goals (see hackathon rubric)

- **Observability**: real, live visibility into the target system via LGTM, not periodic
  summaries.
- **Agency**: the agent notices and proposes on its own — no "click to run" trigger.
- **Auditability**: every claim traces back to a specific metric/log/trace.
- **Malleability**: reasoning adapts to new evidence; never self-blinds by muting its own
  telemetry.
- **Progressive disclosure**: headline first, detail on demand.
- **Ownership**: concrete next steps for *this* incident, including opening real PRs for
  code-level fixes.
