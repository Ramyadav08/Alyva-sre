/**
 * Opens a real PR on this team's own onboarded repo when a recommendation
 * or resolution is a code fix — the guide's own Ownership requirement
 * ("if the fix needs a code change, did it open a real PR on your
 * onboarded repo?"). Operates in a dedicated shallow clone
 * (.agent-pr-workspace/), never the developer's own working tree/branch,
 * so this can run from a live server process without colliding with
 * whatever branch a human happens to be working on.
 *
 * dryRun stops after writing the patch file locally — no branch push, no
 * `gh pr create` — used to verify the mechanism without actually creating
 * visible, outward-facing artifacts on the shared team repo. Firing a
 * real PR against a repo other real teammates watch is exactly the kind
 * of action that needs an explicit human go-ahead, not just "the code
 * exists and might work."
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const exec = promisify(execFile);
const REPO_URL = "https://github.com/Ramyadav08/Alyva-sre.git";
const WORKSPACE = path.join(process.cwd(), ".agent-pr-workspace");

async function ensureWorkspace(): Promise<void> {
  if (!existsSync(WORKSPACE)) {
    await exec("git", ["clone", REPO_URL, WORKSPACE]);
  } else {
    await exec("git", ["-C", WORKSPACE, "checkout", "main"]);
    await exec("git", ["-C", WORKSPACE, "fetch", "origin", "main"]);
    await exec("git", ["-C", WORKSPACE, "reset", "--hard", "origin/main"]);
  }
}

export type FixPrRequest = {
  serviceId: string;
  slug: string;
  title: string;
  body: string;
  patchRelPath: string;
  patchContent: string;
  dryRun?: boolean;
};

export type FixPrResult = { branch: string; patchPath: string; prUrl?: string; dryRun: boolean };

export async function openFixPr(req: FixPrRequest): Promise<FixPrResult> {
  await ensureWorkspace();
  const branch = `agent-fix/${req.slug}-${Date.now()}`;
  await exec("git", ["-C", WORKSPACE, "checkout", "-b", branch]);

  const fullPath = path.join(WORKSPACE, req.patchRelPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, req.patchContent, "utf-8");
  await exec("git", ["-C", WORKSPACE, "add", req.patchRelPath]);
  await exec("git", ["-C", WORKSPACE, "commit", "-m", req.title]);

  if (req.dryRun) {
    return { branch, patchPath: fullPath, dryRun: true };
  }

  await exec("git", ["-C", WORKSPACE, "push", "-u", "origin", branch]);
  const { stdout } = await exec("gh", [
    "pr",
    "create",
    "--repo",
    "Ramyadav08/Alyva-sre",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    req.title,
    "--body",
    req.body,
  ]);
  return { branch, patchPath: fullPath, prUrl: stdout.trim(), dryRun: false };
}
