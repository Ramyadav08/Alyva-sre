# Architecture — Alyva-sre

AI-native incident response agent for the SREonCall hackathon. The reasoning loop below is the
product — delete the LLM calls in your head and there is no detection, no RCA, no proposed fix
left. That's the AI-native bar this design is built to clear.

Interface: **Slack bot**. Code-fix PRs: opened against **this repo** (`Alyva-sre`), never
against the target app or any infra we don't own.

## Data flow

```
 LGTM stack (Mimir/Loki/Tempo, 10.10.1.139)
        │  read-only, X-Scope-OrgID: hackathon
        ▼
 ┌─────────────┐
 │   Watcher    │  scheduler, polls every N seconds per known OTel-demo service
 │ (heartbeat)  │  rolling baseline (error rate, p99 latency, log-error volume)
 └──────┬───────┘
        │ deviation past threshold → fires, NO human trigger
        ▼
 ┌──────────────────┐   tools: query_metric / list_metric_names /
 │  Investigation    │◀──query_logs / search_traces / get_trace_detail /
 │ (agentic tool-use) │   get_service_health — ALL READ-ONLY, nothing else exists
 └──────┬────────────┘   in the tool registry
        │ every tool call + result appended to this investigation's evidence ledger
        ▼
 ┌───────────────────┐
 │  Evidence ledger    │  append-only, keyed by investigation id
 │  {tool,args,result,  │  the report is RENDERED FROM this, not free text
 │   timestamp}[]        │
 └──────┬────────────┘
        ▼
 ┌───────────────────┐        ┌──────────────────────┐
 │  Report            │──────▶│  Slack post           │  headline (2-3 lines) as the
 │  headline+evidence  │       │  thread = evidence     │  top-level message; full
 │  refs+hypothesis+    │       │  trail + next steps    │  evidence trail as thread
 │  next steps           │       │                        │  replies (progressive disclosure)
 └──────┬────────────┘        └──────────┬───────────┘
        │                                 │ judge/human replies in-thread
        │                                 ▼
        │                       ┌──────────────────────┐
        │                       │  Follow-up loop        │  re-enters the SAME agentic loop
        │                       │  ("why didn't you       │  with existing ledger + question,
        │                       │   check X?")             │  can pull more evidence, revises
        │                       └──────────────────────┘  hypothesis (malleability, live)
        ▼
 ┌───────────────────┐
 │  Proposal            │  ONE primitive, mirrors McpProposal:
 │  target_type:        │  alert_rule | runbook | code_fix
 │  pending→approved     │  NEVER applies itself
 └──────┬────────────┘
        │ code_fix only
        ▼
 ┌───────────────────┐
 │  PR opener           │  branch + patch under patches/<service>/<slug>/,
 │  (gh CLI / Octokit)   │  PR body cites evidence ledger entries, opened against
 │                        │  Alyva-sre main — human reviews & merges, agent never does
 └───────────────────┘
```

## Module layout

```
Alyva-sre/
  src/
    lgtm/            # extends starter lgtm-client.js: + getTraceDetail, getServiceHealth
    watcher/         # scheduler + per-service rolling baseline + threshold check
    agent/           # tool registry (read-only only), tool-use loop, prompt templates
    ledger/          # evidence ledger — append-only store, one file/row per investigation
    slack/           # bot: postInvestigation, postFollowup (thread), handleMention
    proposals/       # proposal object + PR opener (branch, patch, gh pr create)
    config/          # OTel-demo service list, thresholds, poll interval
  patches/           # where code-fix branches/patches land before PR
  package.json
  README.md
  ARCHITECTURE.md
```

## Key data shapes

```js
Investigation = {
  id, triggeredAt, triggerReason, service,
  status: 'investigating' | 'reported' | 'awaiting_approval' | 'resolved',
  ledger: EvidenceEntry[],
  report: { headline, evidenceRefs, hypothesis, confidence, nextSteps },
  slackThreadTs,
}

EvidenceEntry = { id, tool, args, result, timestamp }

Proposal = {
  id, investigationId,
  target_type: 'alert_rule' | 'runbook' | 'code_fix',
  summary, payload,
  status: 'pending' | 'approved' | 'rejected' | 'applied',
  prUrl?,
}
```

## Why this clears the 6 traits

| Trait | Mechanism |
|---|---|
| Observability | Watcher polls Mimir/Loki/Tempo live, every cycle — not a periodic canned summary |
| Agency | Watcher fires investigations on threshold deviation; nothing waits for a human click |
| Auditability | Report is rendered from the evidence ledger — every sentence traces to a real tool call + result |
| Malleability | Follow-up replies re-enter the same tool-use loop with new questions, can pull more evidence, revise hypothesis |
| Progressive disclosure | Slack: 2-3 line headline as the message, full evidence trail as thread replies |
| Ownership | Proposal → PR flow; code fixes are real branches/PRs on our own repo, human approves, agent never merges |

## Hard guardrail

The agent's tool registry (`src/agent/`) contains **read-only observability tools only** —
`query_metric`, `list_metric_names`, `query_logs`, `search_traces`, `get_trace_detail`,
`get_service_health`. There is no mute/disable/reroute tool in the registry at all. Malleability
applies to reasoning and proposed actions on the target system — never to the agent's own
observability pipeline.

## Slack bot requirements (not yet configured)

Needs a Slack app with:
- Bot token (`xoxb-...`) with `chat:write` scope, to post investigations and thread replies
- Socket Mode + app-level token (`xapp-...`), to receive thread replies without needing a public
  URL (we're on VPN-only, no public ingress) — avoids standing up a webhook receiver
- A channel ID to post into

To add: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID` in `.env`.

## PR opener requirements

Uses `gh` CLI (already required for repo setup) authenticated against the GitHub account that
owns `Ramyadav08/Alyva-sre`. Opens branch `patches/<service>-<slug>`, commits the patch under
`patches/<service>/<slug>/`, `gh pr create` against `main` with a body linking the specific
evidence ledger entries that justify the fix. Never auto-merges.
