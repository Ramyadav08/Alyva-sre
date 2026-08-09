/**
 * Read-only bridge into the plain-JS skills' persisted data
 * (data/{onboarding-profile,rules,investigations}.json, snake_case,
 * one-file-per-collection — see src/shared/store.js). Deliberately
 * read-only and one-directional: a real investigation confirmed live
 * (payload verified via a real js:alert-rules run + approved rule +
 * detection scan against this exact stack) that the two systems'
 * underlying data models are NOT the same shape (snake_case, per-service
 * flat profile, no serviceId/discovered/businessContext split) — building
 * a true bidirectional sync would mean a real migration/adapter layer,
 * not just "point at the same file." This bridge instead surfaces the one
 * capability the TS side genuinely lacks (Detection & RCA) without
 * pretending the two stores are unified.
 *
 * Every read degrades to an empty array if the file doesn't exist yet
 * (e.g. nobody has run `npm run js:onboarding` / `js:alert-rules` /
 * `js:detection` in this checkout) — never throws, matching this
 * codebase's own resilience convention in lgtm.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

async function readJsonArray<T>(filename: string): Promise<T[]> {
  try {
    const raw = await readFile(path.join(DATA_DIR, filename), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type JsInvestigation = {
  id: string;
  rule_id: string;
  service_name: string;
  signal_type: string;
  triggered_at: string;
  status: "reported" | "resolved";
  ledger: Array<{ tool: string; args: unknown; at: string; result?: unknown; error?: string }>;
  report: {
    headline: string;
    hypothesis: string;
    confidence: "high" | "medium" | "low";
    evidence_refs: string[];
    business_impact_note: string;
    next_steps: string[];
    code_fix_suggested: boolean;
    code_fix_description?: string;
  };
  converged: boolean;
  skeptic_review: { contradicts_investigator: boolean; objection?: string } | null;
  followups: Array<{ question: string; at: string }>;
  resolved_at?: string;
  resolution_note?: string | null;
  root_cause_tag?: string | null;
};

export type JsAlertRule = {
  id: string;
  service_name: string;
  criticality: string;
  status: string;
  signal_type: string;
  threshold?: number;
  threshold_unit?: string;
};

export async function listJsInvestigations(): Promise<JsInvestigation[]> {
  const rows = await readJsonArray<JsInvestigation>("investigations.json");
  return rows.sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime());
}

export async function listJsActiveRules(): Promise<JsAlertRule[]> {
  const rows = await readJsonArray<JsAlertRule>("rules.json");
  return rows.filter((r) => r.status === "approved");
}
