# Progress — where this actually stands

Living status doc, updated as work lands — not a plan, a record of what's real. See each skill's
`HOUSE_RULES.md` for design rationale; this is the "what's done / what's not" summary.

## Built and tested against live data

**Onboarding** (`src/skills/onboarding/`) — real service discovery, criticality/business-impact
interview, Project Profile every other skill reads from. Self-learning (`escalationHint`) tested
with real answered questions.

**Alert Rules** (`src/skills/alert-rules/`) — draft → backtest → self-tune → review UI. Found and
fixed 3 real LLM reliability bugs via live testing (directional tuning errors, inconsistent
human-input gating, incident-contaminated calibration) — see git log for detail, not restated
here. Self-learning (`learnedCorrectionFactor`) tested with real prior-edit data.

**Detection & RCA** (`src/skills/detection/`) — triggers only off an approved Alert Rule breaching
live. Real multi-turn tool-use loop, forced structured report, adversarial skeptic pass, live
follow-up Q&A, PR-opening for code fixes. Found the real recurring root cause behind most
incidents seen this session: `product-catalog`'s `productCatalogFailure` feature flag, cascading
into checkout/frontend. Self-learning (`priorHypothesisHint`) tested with real resolved
investigations.

Both schedulers (Alert Rules' retune sweep, Detection's live scan) confirmed firing **unattended**
via live testing, not just coded and assumed.

## Known open gaps, not hidden

- **`gh` CLI isn't authenticated in this environment** — `proposals.js`'s PR-opening works end to
  end (real branch pushed, tested live) but `gh pr create` itself fails and falls back to a
  manual compare-URL. Needs `gh auth login` run locally to close fully.
- **UX is deliberately unpolished** — a plain single-page review UI, not a differentiator. Known
  and accepted tradeoff (see PROGRESS discussion in commit history) in favor of backend
  mechanism depth.
- **Detection only triggers off approved Alert Rules**, not an independent continuous sweep —
  cleaner architecture, less raw coverage breadth than a competitor's continuous watcher. Also a
  deliberate, discussed tradeoff.
- **No `/hackathon-judge` self-check has been run on Detection & RCA specifically yet.**
- **No extended soak test** of all 3 schedulers running concurrently for a long stretch.

## Other things worth knowing

- There's a parallel branch (`feat/web-dashboard-integration`) with a different teammate's
  Next.js implementation that conflicts with this build — untouched, unresolved, needs a real
  conversation before anyone merges anything.
- Team leaderboard score was stuck at 0.0 as of this doc's last update despite multiple valid
  `/update` calls — check the live board for current status before assuming it's still broken.
