# Alyva — Hackathon Submission (team-1)

## Team + members

**team-1** — Avi Bhardwaj, Ramrekha Yadav

## One-line pitch

Alyva is an AI-native SRE that onboards itself by interviewing a real service graph, drafts and
self-corrects its own alert rules against live evidence, investigates its own breaches with a
multi-turn tool-use loop, and writes its own postmortem the moment a fix is confirmed recovered —
with a human in the loop at every point that matters, never at the points that don't.

## Interface(s) we built

Two interfaces on top of the same underlying skills — kept side by side deliberately, not one
overwriting the other (see the parallel-branch note under "not production-ready" below).

**1. Next.js web dashboard** (primary interface, `src/app/`, `src/components/`)
Tabbed dashboard — Overview, Review queue, Rules & fixes, Custom panel, Services — rebuilt this
week on shadcn/ui, with UI inspiration pulled from Traversal, Resolve AI, Cleric, and incident.io.

| Trait | What's actually there |
|---|---|
| Observability | Every panel (Business Impact, Top Latency, Investigations) resolves from a live Mimir/Loki/Tempo query at read time — no cached/canned data. |
| Agency | Onboarding discovery, alert-rule drafting/retuning, policy-sweep, and recovery-checks all fire unprompted on load/schedule — none are gated behind a button. |
| Auditability | Every proposal and every investigation finding carries the exact metric/log/trace query behind it, shown as an evidence chip on demand — never a bare claim. |
| Malleability | Proposals support approve / **edit-then-approve** / reject, not binary — an edited threshold becomes the new baseline the agent reasons from next, not a one-off override. Plain-English "house rules" (e.g. *"don't page before 9am unless it's payments"*) are consulted on every future rule draft, unprompted. |
| Progressive disclosure | Every panel leads with a 2–3 line headline (confidence meter, impact badge, status pill); full evidence/ledger/timeline is a click away, never dumped. |
| Ownership | Alert-rule and recommendation output ends in concrete next steps tied to the specific incident; code-fix recommendations open a real PR on this repo. |

**2. Plain-JS review UI** (`src/web/`, `src/skills/*`) — the original, backend-mechanism-first
implementation the three skills were built and tested against before the dashboard existed. Same
skills, same evidence model, deliberately unpolished single-page UI — a known, discussed tradeoff
in favor of getting the reasoning depth right first (see PROGRESS.md history).

## Architecture

- **Storage**: a JSON-file-backed store (`lowdb`) — no auth, single implicit tenant, deliberately
  not a real DB for this scope.
- **Generic gated-action envelope**: every reviewable thing the agent produces — an onboarding
  profile field, an alert rule, a dashboard panel, a recommendation, a PR — is a `Proposal`
  (`{ payload, evidence[], rationale, status: pending|edited|approved|rejected|applied, history[] }`).
  This is modeled on the real platform's `AgentApproval`/`McpProposal` shape, with the one status
  (`edited`) that shape is missing added deliberately — see "what to borrow" below.
- **Question queue**: anything the agent can't derive from live telemetry (business criticality,
  revenue/incident-minute, SLA target) becomes a `Question` record and blocks that reasoning step
  until a human answers — never a fabricated default.
- **Skill self-learning**: each skill (`skills/onboarding.md`, `skills/alerting.md`, plus each
  skill's `HOUSE_RULES.md`) is a git-tracked markdown doc with a `## Lessons learned` section the
  agent appends short, evidence-cited entries to after real approve/reject/edit decisions — re-read
  into context on every subsequent call. Self-learning as an auditable artifact in the repo's own
  commit history, not a hidden weight update.
- **Structural self-blinding guard**: the LLM's callable tool/function list contains no
  mute-alert / disable-collector / edit-flagd function anywhere, for any skill — the only "fix"
  surface for a noisy rule is the rule's own threshold definition. Enforced structurally, not by
  prompting against it.
- **Key tool defs**: Detection & RCA's investigation loop (`src/skills/detection/investigate.js`)
  forces a structured report schema (`headline`, `hypothesis`, `confidence`, `evidence_refs`,
  `business_impact_note`, `next_steps`, `code_fix_suggested`) and requires at least one
  `evidence_ref` come from a `get_trace_detail` call, not just a trace list — a structural gate
  against concluding without actually drilling in.

## What's NOT production-ready yet

- **No deployment** — runs locally (`npm run dev`) against the shared hackathon LGTM stack. No
  hosted URL exists.
- **`gh` CLI isn't authenticated in the build environment** — PR-opening for code-fix
  recommendations works end-to-end (real branch pushed, tested live) but `gh pr create` itself
  fails and falls back to a manual compare-URL. Needs `gh auth login` run locally to close fully.
- **Detection only triggers off an approved Alert Rule breaching live**, not an independent
  continuous sweep — a deliberate architecture tradeoff (cleaner, but less raw coverage breadth
  than a continuous watcher would give).
- **No extended soak test** of all schedulers (retune sweep, detection scan, recovery-check,
  policy-sweep) running concurrently for a long stretch — each has been confirmed firing
  unattended individually, not stress-tested together over hours.
- **No auth/multi-tenant model** — single implicit user, by explicit scope cut.
- **The shadcn/ui dashboard rebuild is UI-only** — it's a faithful visual rebuild of existing,
  already-tested logic (verified via full typecheck + production build + live screenshot pass
  against real data), but hasn't itself been through a fresh end-to-end fault-injection walk on
  top of the merge.

## One thing the real SREonCall product should borrow

**The `edited` status on the propose→approve envelope.** The real platform's `AgentApproval` and
`McpProposal` are both strictly binary — `approved` or `rejected`, nothing in between. A human
reviewing a drafted alert rule (or any agent proposal) can't adjust the threshold and approve the
adjusted version in one step; they can only accept the agent's exact draft or kill it outright.
Alyva's `Proposal.status: 'edited'` state — with `history[]` preserving every prior version — fills
that gap directly, and it's not just a UI nicety: the edited value becomes the new baseline the
agent reasons from on its *next* pass, which is what actually makes the review loop feel like
collaboration instead of a gate. It's a small schema change with an outsized effect on how much a
human trusts approving agent output at all.
