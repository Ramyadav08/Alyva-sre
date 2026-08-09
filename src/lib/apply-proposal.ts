/**
 * The only place in this codebase that turns an approved Proposal into a
 * real effect. Called exactly once, exactly after `decideProposal(id,
 * 'approved')` — never speculatively, never on 'pending'/'edited'. This is
 * the second half of the draft-then-approve pattern borrowed from the
 * reference platform's McpProposal service.
 */
import { getDb, newId, nowIso } from "./store";
import { markApplied, markApplyFailed } from "./proposals";
import type { Proposal, ServiceProfile, AlertRulePayload, DashboardPanelSpec } from "./models";

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
      case "pr":
        // No further write beyond the Proposal record itself for now —
        // 'pr' gains a real gh-cli effect once the ownership/PR flow is
        // built (see plan: End-to-end verification task).
        await markApplied(proposal.id, proposal.id);
        return;
    }
  } catch (err) {
    await markApplyFailed(proposal.id, (err as Error).message);
  }
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
  const id = newId("rule");
  db.data.alertRules.push({
    ...payload,
    id,
    proposalId: proposal.id,
    status: "active",
    firingHistory: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.write();
  await markApplied(proposal.id, id);
}

async function applyDashboardPanel(proposal: Proposal): Promise<void> {
  const db = await getDb();
  const spec = proposal.payload as Omit<DashboardPanelSpec, "id" | "order">;
  const id = newId("panel");
  const order = db.data.dashboardPanels.length;
  db.data.dashboardPanels.push({ ...spec, id, order, removable: true });
  await db.write();
  await markApplied(proposal.id, id);
}
