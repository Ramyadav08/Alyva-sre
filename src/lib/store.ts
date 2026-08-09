/**
 * Single JSON-file-backed store — no auth, single implicit user, MLP scope
 * (see plan: "not worth a real DB for this build"). Everything the agent
 * writes for real (as opposed to draft reasoning) lives here, so the file
 * itself is the audit trail.
 */
import { JSONFilePreset } from "lowdb/node";
import path from "node:path";
import type {
  Proposal,
  Question,
  ServiceProfile,
  AlertRule,
  DashboardPanelSpec,
} from "./models";

export type AlyvaData = {
  serviceProfiles: ServiceProfile[];
  proposals: Proposal[];
  questions: Question[];
  alertRules: AlertRule[];
  dashboardPanels: DashboardPanelSpec[];
};

const DEFAULT_DATA: AlyvaData = {
  serviceProfiles: [],
  proposals: [],
  questions: [],
  alertRules: [],
  dashboardPanels: [
    {
      id: "business-impact",
      kind: "business_impact",
      title: "Business impact",
      removable: false,
      order: 0,
    },
    {
      id: "top-latency",
      kind: "top_latency",
      title: "Top latency",
      removable: false,
      order: 1,
    },
  ],
};

const DB_PATH = path.join(process.cwd(), "data", "alyva.json");

let dbPromise: ReturnType<typeof JSONFilePreset<AlyvaData>> | null = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = JSONFilePreset<AlyvaData>(DB_PATH, DEFAULT_DATA);
  }
  return dbPromise;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
