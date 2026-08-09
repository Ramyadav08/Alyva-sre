/**
 * The only place in this codebase that turns an approved Proposal into a
 * real effect. Called exactly once, exactly after `decideProposal(id,
 * 'approved')` — never speculatively, never on 'pending'/'edited'. This is
 * the second half of the draft-then-approve pattern borrowed from the
 * reference platform's McpProposal service.
 */
import { getDb, newId, nowIso } from "./store";
import { markApplied, markApplyFailed } from "./proposals";
import { openFixPr } from "./pr-opener";
import type { Proposal, ServiceProfile, AlertRulePayload, DashboardPanelSpec } from "./models";

/**
 * Real PRs land on the shared team repo other people watch — firing one
 * is an outward-facing action, so this defaults to dry-run (writes the
 * patch file, commits it in the isolated workspace clone, stops before
 * push/`gh pr create`) until a human explicitly turns it on.
 */
const PR_DRY_RUN = process.env.PR_OPENER_LIVE !== "true";

export async function applyProposal(proposal: Proposal): Promise<void> {
  try {
    switch (proposal.kind) {
      case "profile_field":
        await applyProfileField(proposal);
        break;
      case "alert_rule":
        await applyAlertRule(proposal);
        break;
      case "dashboard_panel":
        await applyDashboardPanel(proposal);
        break;
      case "recommendation":
        await markApplied(proposal.id, proposal.id);
        return;
      case "pr":
        await applyPr(proposal);
        return;
    }
  } catch (err) {
    await markApplyFailed(proposal.id, (err as Error).message);
  }
}

async function applyPr(proposal: Proposal): Promise<void> {
  const payload = proposal.payload as { serviceId: string; title: string; description: string; patchSuggestion: string };
  const slug = payload.serviceId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const patchRelPath = `patches/${payload.serviceId}/${slug}-${Date.now()}/README.md`;
  const patchContent =
    `# ${payload.title}\n\n` +
    `**Service:** ${payload.serviceId}\n\n` +
    `## Why\n\n${payload.description}\n\n` +
    `## Suggested fix\n\n${payload.patchSuggestion || "(no patch detail provided)"}\n\n` +
    `---\n_Opened by Alyva, cites the evidence attached to this proposal — never applies itself, a human reviewed and approved this before it was opened._\n`;

  const result = await openFixPr({
    serviceId: payload.serviceId,
    slug,
    title: `[Alyva] ${payload.title}`,
    body: patchContent,
    patchRelPath,
    patchContent,
    dryRun: PR_DRY_RUN,
  });

  await markApplied(proposal.id, result.prUrl ?? `dry-run:${result.branch}`);
}

async function applyProfileField(proposal: Proposal): Promise<void> {
  const db = await getDb();
  const patch = proposal.payload as Partial<ServiceProfile> & { serviceId: string };
  const existing = db.data.serviceProfiles.find((p) => p.serviceId === patch.serviceId);
  const now = nowIso();
  if (existing) {
    Object.assign(existing, patch, { onboarded: true, updatedAt: now });
  } else {
    db.data.serviceProfiles.push({
      ...(patch as ServiceProfile),
      onboarded: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.write();
  await markApplied(proposal.id, patch.serviceId);
}

async function applyAlertRule(proposal: Proposal): Promise<void> {
  const db = await getDb();
  const payload = proposal.payload as AlertRulePayload;
  const now = nowIso();

  if (payload.retuneOfRuleId) {
    const existing = db.data.alertRules.find((r) => r.id === payload.retuneOfRuleId);
    if (!existing) {
      await markApplyFailed(proposal.id, `retune target rule ${payload.retuneOfRuleId} not found`);
      return;
    }
    existing.tuningHistory.push({
      iteration: existing.tuningHistory.length + 1,
      at: now,
      beforeThreshold: existing.threshold,
      afterThreshold: payload.threshold,
      beforeWindowMinutes: existing.windowMinutes,
      afterWindowMinutes: payload.windowMinutes,
      reason: payload.rationale,
      backtestBefore: existing.lastBacktest?.verdict ?? "untestable",
    });
    existing.threshold = payload.threshold;
    existing.windowMinutes = payload.windowMinutes;
    existing.retuneProposal = null;
    existing.updatedAt = now;
    await db.write();
    await markApplied(proposal.id, existing.id);
    return;
  }

  const id = newId("rule");
  db.data.alertRules.push({
    ...payload,
    id,
    proposalId: proposal.id,
    status: "active",
    baselineSnapshot: {},
    tuningHistory: [],
    lastBacktest: null,
    retuneProposal: null,
    retuneRejections: [],
    learnedCorrectionApplied: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.write();
  await markApplied(proposal.id, id);
}

async function applyDashboardPanel(proposal: Proposal): Promise<void> {
  const db = await getDb();
  // previewData (a one-time snapshot used only for the pre-approval
  // preview) is deliberately dropped here — the persisted panel re-queries
  // live on every render, never replays a stale snapshot.
  const { kind, title, spec, removable } = proposal.payload as DashboardPanelSpec & { previewData?: unknown };
  const id = newId("panel");
  const order = db.data.dashboardPanels.length;
  db.data.dashboardPanels.push({ kind, title, spec, removable, id, order });
  await db.write();
  await markApplied(proposal.id, id);
}
