/**
 * Runtime skill docs — the product's own "self-learning skill" mechanism,
 * distinct from any Claude Code dev-tooling. `skills/onboarding.md` and
 * `skills/alerting.md` are written in the same shape as the hackathon's own
 * `.claude/skills/hackathon-judge/SKILL.md` (frontmatter, procedure,
 * guardrails, a "Lessons learned" log) and are read fresh into the LLM's
 * system prompt on every reasoning call for that skill. `appendLesson`
 * writes a short, evidence-cited line to that same file after a real
 * review decision or noise-check outcome — the file's own growth (and its
 * git history in this repo) *is* the audit trail for how the agent's
 * judgment evolved. This is what makes malleability a persisted, diffable
 * artifact instead of a vibe.
 */
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), "skills");

export type SkillName = "onboarding" | "alerting";

export async function loadSkillDoc(name: SkillName): Promise<string> {
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    console.warn(`[skills] could not read ${filePath}:`, (err as Error).message);
    return "";
  }
}

/**
 * Appends one line under the "## Lessons learned" section. Kept
 * deliberately dumb (plain append, not a rewrite) so the file's git
 * history is a clean, ordered log — never a silently-rewritten past
 * entry.
 */
export async function appendLesson(name: SkillName, lesson: string, evidenceRef?: string): Promise<void> {
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  const line = `\n- ${new Date().toISOString()} — ${lesson}${evidenceRef ? ` (evidence: ${evidenceRef})` : ""}`;
  await appendFile(filePath, line, "utf-8");
}

/**
 * Called from the generic decide route for every real human decision on a
 * Proposal — this is what makes the skill docs actually self-learning
 * (an accumulating, git-tracked record of real outcomes) instead of a
 * static prompt nobody revisits. Only fires for the two kinds that have a
 * runtime skill doc; other Proposal kinds have nothing to learn into yet.
 */
export async function recordProposalLesson(args: {
  kind: string;
  serviceId?: string;
  summary: string;
  decision: "approved" | "rejected";
  wasEdited: boolean;
  note?: string;
}): Promise<void> {
  const skillName: SkillName | null = args.kind === "profile_field" ? "onboarding" : args.kind === "alert_rule" ? "alerting" : null;
  if (!skillName) return;

  const service = args.serviceId ? `"${args.serviceId}"` : "an item";
  let lesson: string;
  if (args.decision === "rejected") {
    lesson = `Rejected — ${service}: "${args.summary}"${args.note ? ` — ${args.note}` : ""}. Weigh this against similar future proposals.`;
  } else if (args.wasEdited) {
    lesson = `Approved after edit — ${service}: "${args.summary}"${args.note ? ` — ${args.note}` : ""}. The edited value is the new baseline to reason from, not the original draft.`;
  } else {
    lesson = `Approved as drafted — ${service}: "${args.summary}". No correction needed this time.`;
  }
  await appendLesson(skillName, lesson);
}
