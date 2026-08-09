// Ownership: when a resolved investigation's report says code_fix_suggested,
// this drafts the fix as a real branch + file in OUR OWN repo (per the
// earlier decision: PRs go against Alyva-sre, never a target app repo we
// don't own write access to) and opens a real PR. Draft-then-approve, same
// as every other skill here — this function never merges, and per house
// rule #6 ("ownership never self-executes"), it only runs when a human
// explicitly triggers it on a specific investigation, never on a schedule.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", ...opts }).trim();
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildProposedFixMarkdown(investigation) {
  const r = investigation.report || {};
  const lines = [
    `# Proposed fix — ${investigation.service_name} / ${investigation.signal_type}`,
    "",
    `**Investigation:** \`${investigation.id}\``,
    `**Triggered:** ${investigation.triggered_at}`,
    `**Confidence:** ${r.confidence || "unknown"}`,
    "",
    "## Headline",
    "",
    r.headline || "(none)",
    "",
    "## Hypothesis",
    "",
    r.hypothesis || "(none)",
    "",
    "## Evidence cited",
    "",
    ...(r.evidence_refs || []).map((e) => `- ${e}`),
    "",
    "## Business impact",
    "",
    r.business_impact_note || "unknown, awaiting input",
    "",
    "## Proposed fix",
    "",
    r.code_fix_description || "(none)",
    "",
    "## Ordered next steps",
    "",
    ...(r.next_steps || []).map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Full evidence ledger",
    "",
    "```json",
    JSON.stringify(investigation.ledger, null, 2),
    "```",
    "",
    "---",
    "*Drafted by the Detection & RCA skill — this is a proposal for human review, not an applied fix. Never auto-merge.*",
  ];
  return lines.join("\n");
}

/**
 * dryRun (default true): writes nothing to disk, doesn't touch git — just
 * returns what WOULD happen. Only set dryRun: false when a human has
 * explicitly triggered this for a specific investigation.
 */
function proposePR(investigation, { dryRun = true } = {}) {
  const r = investigation.report || {};
  if (!r.code_fix_suggested) {
    throw new Error("This investigation's report did not suggest a code fix — nothing to propose.");
  }

  const slug = slugify(`${investigation.service_name}-${investigation.id}`);
  const branch = `patches/${slug}`;
  const relDir = `patches/${investigation.service_name}/${investigation.id}`;
  const relFile = `${relDir}/PROPOSED_FIX.md`;
  const content = buildProposedFixMarkdown(investigation);
  const title = `[proposed fix] ${investigation.service_name}: ${(r.headline || "").slice(0, 60)}`;

  const plan = { branch, file: relFile, title, content };
  if (dryRun) return { ...plan, dry_run: true };

  const startBranch = sh("git rev-parse --abbrev-ref HEAD");
  try {
    sh(`git checkout -b ${branch} main`);
    fs.mkdirSync(path.join(REPO_ROOT, relDir), { recursive: true });
    fs.writeFileSync(path.join(REPO_ROOT, relFile), content);
    sh(`git add ${relFile}`);
    sh(`git commit -m ${JSON.stringify(`Proposed fix: ${investigation.service_name} (${investigation.id})`)}`);
    sh(`git push -u origin ${branch}`);

    let prUrl = null;
    let prError = null;
    const bodyFile = path.join(REPO_ROOT, ".pr-body-tmp.md");
    try {
      fs.writeFileSync(bodyFile, content);
      prUrl = sh(`gh pr create --title ${JSON.stringify(title)} --body-file ${bodyFile} --base main --head ${branch}`);
    } catch (err) {
      prError = err.message;
    } finally {
      // Must run whether gh succeeded or failed — this leaked on the
      // failure path until a real test (no gh auth in this environment)
      // caught it.
      if (fs.existsSync(bodyFile)) fs.unlinkSync(bodyFile);
    }

    return {
      ...plan,
      dry_run: false,
      pushed: true,
      pr_url: prUrl,
      pr_error: prError,
      manual_pr_url: prError ? `https://github.com/Ramyadav08/Alyva-sre/compare/main...${branch}?expand=1` : null,
    };
  } finally {
    sh(`git checkout ${startBranch}`);
  }
}

module.exports = { proposePR, buildProposedFixMarkdown };
