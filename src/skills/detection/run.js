// Orchestrator: scan approved Alert Rules for a REAL live breach, start an
// investigation, and support live follow-up questions against an existing
// one (house rule #7 — same investigation, same ledger, not a new one).
// This is what runs unprompted on a schedule (agency) and what the follow-up
// API endpoint calls.

const store = require("../../shared/store");
const { checkLiveFiring } = require("./liveCheck");
const { runInvestigation } = require("./investigate");
const { skepticCheck } = require("./skeptic");

function loadInvestigations() {
  return store.load("investigations", []);
}

const MIN_MATCHES_FOR_HINT = 2; // same "generalizable" gate as the other two skills

/**
 * Same four-gate promotion test as Alert Rules'/Onboarding's self-learning
 * — no agent decides this, pure code does. Only an EXACT repeated
 * root_cause_tag (deterministically assigned by a human at resolve time,
 * not inferred) across >=2 resolved investigations for the same service
 * counts as a pattern.
 */
function priorHypothesisHint(serviceName) {
  const resolved = loadInvestigations().filter(
    (i) => i.service_name === serviceName && i.status === "resolved" && i.root_cause_tag
  );
  if (resolved.length < MIN_MATCHES_FOR_HINT) return null;

  const counts = new Map();
  for (const inv of resolved) counts.set(inv.root_cause_tag, (counts.get(inv.root_cause_tag) || 0) + 1);
  const [topTag, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!topTag || count < MIN_MATCHES_FOR_HINT) return null;

  const example = resolved.filter((i) => i.root_cause_tag === topTag).pop();
  return { tag: topTag, count, example_hypothesis: example.report?.hypothesis || null };
}

/**
 * Scans every approved rule; for any not already under an open
 * investigation (house rule #5), checks if it's breaching RIGHT NOW, and if
 * so, starts a real investigation.
 */
async function scanForNewInvestigations({ log = () => {} } = {}) {
  const rules = store.load("rules", []);
  const approved = rules.filter((r) => r.status === "approved");
  const investigations = loadInvestigations();
  const openRuleIds = new Set(investigations.filter((i) => i.status !== "resolved").map((i) => i.rule_id));

  for (const rule of approved) {
    if (openRuleIds.has(rule.id)) continue;

    const check = await checkLiveFiring(rule);
    if (!check.firing) continue;

    log(`LIVE FIRING: ${rule.service_name}/${rule.signal_type} (${check.live_value} vs threshold ${check.threshold}) — investigating...`);
    const hint = priorHypothesisHint(rule.service_name);
    const trigger = {
      rule_id: rule.id,
      service_name: rule.service_name,
      signal_type: rule.signal_type,
      threshold: rule.threshold,
      live_value: check.live_value,
      evidence_note: `Approved alert rule (${rule.signal_type}, threshold ${rule.threshold}) is currently breached — live value ${check.live_value}, via: ${check.query}`,
      prior_hypothesis_hint: hint
        ? `${hint.count} prior resolved investigations for this service were confirmed to share the same root cause ("${hint.tag}", e.g. "${hint.example_hypothesis}"). Check this angle first — but verify with real evidence, never assume it's the same without confirming.`
        : null,
    };

    const { ledger, report, converged, messages } = await runInvestigation(trigger);

    let skepticReview = null;
    if (converged) {
      try {
        skepticReview = await skepticCheck(ledger, trigger, report.hypothesis);
      } catch (err) {
        log(`  skeptic check failed (non-fatal): ${err.message}`);
      }
    }

    investigations.push({
      id: `inv-${rule.service_name}-${Date.now()}`,
      rule_id: rule.id,
      service_name: rule.service_name,
      signal_type: rule.signal_type,
      triggered_at: new Date().toISOString(),
      trigger: check,
      status: "reported",
      ledger,
      report,
      converged,
      messages,
      skeptic_review: skepticReview,
      followups: [],
    });
    log(`  -> ${converged ? "converged" : "did not converge"}: ${report.headline}`);
    if (skepticReview?.contradicts_investigator) {
      log(`  ⚠ skeptic objects: ${skepticReview.objection}`);
    }
  }

  store.save("investigations", investigations);
  return investigations;
}

/**
 * Re-enters an EXISTING investigation with a new question, same ledger and
 * conversation intact — this is where malleability is demonstrated live,
 * not a new investigation. Follow-ups may re-query live data even if
 * similar to something already checked — that's correct for "what does it
 * look like right now", not a redundant call.
 */
async function askFollowUp(investigationId, question) {
  const investigations = loadInvestigations();
  const inv = investigations.find((i) => i.id === investigationId);
  if (!inv) throw new Error(`No such investigation: ${investigationId}`);

  const priorMessages = [...inv.messages, { role: "user", content: question }];
  const { ledger, report, converged, messages } = await runInvestigation(inv.trigger, { priorMessages });

  const combinedLedger = [...inv.ledger, ...ledger];
  let skepticReview = inv.skeptic_review;
  if (converged && report.hypothesis !== inv.report?.hypothesis) {
    try {
      skepticReview = await skepticCheck(combinedLedger, inv.trigger, report.hypothesis);
    } catch {
      // non-fatal — keep the prior review rather than block the follow-up
    }
  }

  inv.ledger = combinedLedger;
  inv.report = report;
  inv.converged = converged;
  inv.messages = messages;
  inv.skeptic_review = skepticReview;
  inv.followups = [...(inv.followups || []), { question, at: new Date().toISOString() }];

  store.save("investigations", investigations);
  return inv;
}

/**
 * root_cause_tag is a short, deterministic label a human assigns at resolve
 * time (e.g. "product_catalog_feature_flag") — NOT free text and NOT
 * inferred by an agent. This is what priorHypothesisHint() matches on
 * exactly; a human choosing the same tag twice is what makes a pattern,
 * never a guess at semantic similarity.
 */
function resolveInvestigation(investigationId, note, rootCauseTag) {
  const investigations = loadInvestigations();
  const inv = investigations.find((i) => i.id === investigationId);
  if (!inv) throw new Error(`No such investigation: ${investigationId}`);
  inv.status = "resolved";
  inv.resolved_at = new Date().toISOString();
  inv.resolution_note = note || null;
  inv.root_cause_tag = rootCauseTag || null;
  store.save("investigations", investigations);
  return inv;
}

module.exports = { scanForNewInvestigations, askFollowUp, resolveInvestigation, loadInvestigations, priorHypothesisHint };
