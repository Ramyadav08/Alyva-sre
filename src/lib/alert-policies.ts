/**
 * Stretch 8: plain-English policy acceptance for alerting.
 *
 * Deliberately the simplest possible surface — a human types an exact
 * behavior rule ("don't page before 9am unless it's payments"), it's
 * stored verbatim, and every subsequent alert-rule draft/retune pass
 * (lib/alert-rules/draft.ts, lib/alert-rules/policy-retune.ts) consults
 * the active list unprompted. There is no LLM in this file — nothing
 * here needs drafting or a review loop, since the human already said
 * exactly what they meant in their own words. Malleability is `active`,
 * not edit-in-place: flipping a policy off (or adding a new one) takes
 * effect on the very next unprompted cycle, without rewriting the
 * history of any rule an earlier version of the policy already shaped.
 */
import { getDb, newId, nowIso } from "./store";
import type { AlertPolicy } from "./models";

/** lowdb doesn't retroactively add new top-level keys to an existing data/alyva.json — same defensive pattern as postmortems.ts. */
function ensurePoliciesArray(data: { alertPolicies?: AlertPolicy[] }): AlertPolicy[] {
  if (!data.alertPolicies) data.alertPolicies = [];
  return data.alertPolicies;
}

export async function listPolicies(): Promise<AlertPolicy[]> {
  const db = await getDb();
  return [...ensurePoliciesArray(db.data)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listActivePolicies(): Promise<AlertPolicy[]> {
  return (await listPolicies()).filter((p) => p.active);
}

export async function createPolicy(text: string): Promise<AlertPolicy> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Policy text cannot be empty");
  const db = await getDb();
  const now = nowIso();
  const policy: AlertPolicy = { id: newId("policy"), text: trimmed, active: true, createdAt: now, updatedAt: now };
  ensurePoliciesArray(db.data).push(policy);
  await db.write();
  return policy;
}

export async function setPolicyActive(id: string, active: boolean): Promise<AlertPolicy | null> {
  const db = await getDb();
  const policy = ensurePoliciesArray(db.data).find((p) => p.id === id);
  if (!policy) return null;
  policy.active = active;
  policy.updatedAt = nowIso();
  await db.write();
  return policy;
}
