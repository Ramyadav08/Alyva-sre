/**
 * Runtime skill docs — the product's own "self-learning skill" mechanism,
 * distinct from any Claude Code dev-tooling. `skills/onboarding.md` and
 * `skills/alerting.md` are written in the same shape as the hackathon's own
 * `.claude/skills/hackathon-judge/SKILL.md` (frontmatter, procedure,
 * guardrails, a "Lessons learned" log) and are read fresh into the LLM's
 * system prompt on every reasoning call for that skill.
 *
 * The learning mechanism itself is adapted from a real, mature reference —
 * transilienceai/communitytools' skill-update/skill-prune pair — rather
 * than a blind append log. Their four-gate promotion test (generalizable /
 * material improvement / not already captured / minimal footprint) and
 * skill-prune's "contradicted by newer content" signal map directly onto
 * what a naive append-everything version of this was missing: it would
 * have logged every routine "approved exactly as drafted" decision
 * forever, which carries no new information, and never removed a lesson
 * superseded by a later one about the same service. Same design
 * philosophy already used in tuning.ts's deterministic candidateThreshold
 * and directional guard — promotion decisions are pure code, never left
 * to an LLM's judgment call, so a run can't claim a promotion it didn't
 * actually earn.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), "skills");
const LESSONS_HEADING = "## Lessons learned";
const MAX_LESSONS_PER_SKILL = 25; // gate 4 (minimal footprint) — cap, not unbounded growth

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

type ParsedLesson = { raw: string; serviceId: string | null; decisionType: string | null };

function parseLessonLine(line: string): ParsedLesson {
  const m = line.match(/^- \S+ — (Rejected|Approved after edit) — "([^"]+)":/);
  return m ? { raw: line, decisionType: m[1], serviceId: m[2] } : { raw: line, decisionType: null, serviceId: null };
}

/**
 * Reads the Lessons learned section, lets `mutate` apply gates against the
 * parsed existing entries, and rewrites just that section. Everything
 * above the heading (frontmatter, procedure, guardrails) is untouched.
 */
async function rewriteLessons(name: SkillName, mutate: (lessons: ParsedLesson[]) => ParsedLesson[]): Promise<void> {
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  const content = await readFile(filePath, "utf-8");
  const idx = content.indexOf(LESSONS_HEADING);
  if (idx === -1) {
    console.warn(`[skills] ${name}.md has no "${LESSONS_HEADING}" section — skipping`);
    return;
  }
  const before = content.slice(0, idx);
  const after = content.slice(idx);
  const commentMatch = after.match(/^(## Lessons learned\s*\n\n<!--[\s\S]*?-->\s*\n)/);
  const header = commentMatch ? commentMatch[1] : `${LESSONS_HEADING}\n\n`;
  const existingLines = after
    .slice(header.length)
    .split("\n")
    .filter((l) => l.trim().startsWith("- "));
  const updated = mutate(existingLines.map(parseLessonLine));
  const body = updated.map((l) => l.raw).join("\n");
  await writeFile(filePath, `${before}${header.replace(/\n+$/, "\n")}\n${body}\n`, "utf-8");
}

/**
 * Called from the generic decide route for every real human decision on a
 * Proposal. Applies the four-gate-inspired promotion test before writing
 * anything:
 *
 * 1+2 (generalizable + material improvement): a routine "approved exactly
 *    as drafted" carries no correction to learn from — skipped entirely,
 *    not logged as noise.
 * 3 (not already captured) + skill-prune's "contradicted by newer
 *    content": a new lesson about the same service + decision type
 *    supersedes the old one rather than duplicating it.
 * 4 (minimal footprint): capped at MAX_LESSONS_PER_SKILL, oldest dropped
 *    first — pruning happens inline on write, not as a separate sweep.
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
  if (args.decision === "approved" && !args.wasEdited) return; // gate 1+2: nothing to learn

  const service = args.serviceId ?? "unknown";
  const decisionType = args.decision === "rejected" ? "Rejected" : "Approved after edit";
  const text =
    args.decision === "rejected"
      ? `"${args.summary}"${args.note ? ` — ${args.note}` : ""}. Weigh this against similar future proposals.`
      : `"${args.summary}"${args.note ? ` — ${args.note}` : ""}. The edited value is the new baseline to reason from, not the original draft.`;
  const raw = `- ${new Date().toISOString()} — ${decisionType} — "${service}": ${text}`;

  await rewriteLessons(skillName, (existing) => {
    const deduped = existing.filter((l) => !(l.serviceId === service && l.decisionType === decisionType));
    const next = [...deduped, { raw, serviceId: service, decisionType }];
    return next.length > MAX_LESSONS_PER_SKILL ? next.slice(next.length - MAX_LESSONS_PER_SKILL) : next;
  });
}
