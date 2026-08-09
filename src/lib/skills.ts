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
