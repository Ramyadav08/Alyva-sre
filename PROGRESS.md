# Progress — where this actually stands

Living status doc, updated as work lands — not a plan, a record of what's real. See each skill's
`HOUSE_RULES.md` for design rationale; this is the "what's done / what's not" summary.

## Built and tested against live data

**Onboarding** (`src/skills/onboarding/`) — real service discovery, criticality/business-impact
interview, Project Profile every other skill reads from. Self-learning (`escalationHint`) tested
with real answered questions.

**Alert Rules** (`src/skills/alert-rules/`) — draft → backtest → self-tune → review UI. Self-
learning (`learnedCorrectionFactor`) tested with real prior-edit data.

**Detection & RCA** (`src/skills/detection/`) — triggers only off an approved Alert Rule breaching
live. Real multi-turn tool-use loop, forced structured report, adversarial skeptic pass (`skeptic.js`,
pattern from `communitytools`'s skeptic-role.md), live follow-up Q&A, PR-opening for code fixes
(`proposals.js`, tested end-to-end with a real branch pushed and cleaned up). Found the real
recurring root cause behind most incidents seen this session: `product-catalog`'s
`productCatalogFailure` feature flag, cascading into checkout/frontend. Self-learning
(`priorHypothesisHint`) tested with real resolved investigations.

**Dashboard** (`src/dashboard/`) — fixed 70/30 split-screen (no page scroll), three horizontal
rows (Metrics/Traces/Logs) with a shared entity+time-range filter, persistent general-purpose ops
chatbot on the right. Real inter-service latency from actual Tempo span walks, real
container/service metrics (this environment is Docker Compose, not Kubernetes — the entity
selector is honest about that, no fabricated pod/node concept). Iterated 3 rounds on direct user
feedback (boring → real bar charts/status pills → fixed split-screen layout).

Both Alert Rules' retune sweep and Detection's live scan schedulers confirmed firing
**unattended** via live testing, not just coded and assumed — same for the dashboard's
service-graph and onboarding-refresh schedulers.

## The running list of real bugs found and fixed by testing (not theoretical)

1. LLM tuning direction errors (lowering a `gt` threshold to "reduce noise" — increases firing)
2. Inconsistent `needs_human_input` self-gating (same input, different answer across calls)
3. Threshold calibration against a backtest window that itself contained a real incident
4. `submit_report`/`submit_answer` missing a tool-response message, silently breaking follow-up continuation
5. Freehand PromQL construction picking a completely wrong metric
6. A misleading 600,001ms "average latency" from a single flagd streaming-connection span
7. Log lines truncated *before* JSON parsing, so extraction always failed and fell back to raw JSON
8. **Most recent**: an investigation searched 24h of traces, sampled only 5, drilled into zero of
   them, and confidently concluded "no errors" — violating its own house rule. Fixed with a
   structural gate (not just a prompt instruction) that mechanically rejects a conclusion if
   traces were found but never inspected. Residual, disclosed, not fixed: Tempo returns the most
   *recent* matching traces, not an even spread across a requested window — recency bias remains.

## Known open gaps, not hidden

- **`gh` CLI isn't authenticated in this environment** — `gh pr create` falls back to a manual compare-URL.
- **UX is functional, not polished**, even after 3 rounds of visual iteration.
- **Detection only triggers off approved Alert Rules**, not an independent continuous sweep — a
  deliberate tradeoff for architectural cleanliness, discussed and confirmed with the user.
- **No `/hackathon-judge` self-check has been run on Detection & RCA specifically yet.**
- **No extended soak test** of all schedulers running concurrently for a long stretch.
- **Trace-search recency bias** (see bug #8 above) — drilling in is now mandatory, but the sample
  itself still skews toward "most recent," not a representative spread across a long window.

## Other things worth knowing

- **Resolved**: Avi's Next.js implementation (`feat/web-dashboard-integration`) is now merged
  into `main`, coexisting with this JS system rather than overwriting it (see git history around
  `abf0396`) — two interfaces, same underlying idea, no file collisions. Avi has since added a
  read-only bridge into this system's Detection & RCA data, recovery verification, and
  postmortem generation on the Next.js side. Not yet verified to run end-to-end the way the JS
  side has been proven all session — don't assume parity until checked directly.
- Leaderboard: team-1 reached **70.4, 2nd place** (Team 4 leads at 72.9) after the dashboard work
  landed — an earlier 0.0/"not scored" state turned out to be a genuine queue delay, not a
  problem with the submission (Team 3 was stuck the same way and later cleared). Self-learning
  and the propose→PR ownership lane are our clearest relative edge — the other 3 teams all
  scored 0-50 on Self-learning specifically.
