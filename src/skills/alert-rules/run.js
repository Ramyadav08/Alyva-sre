// Orchestrator for the Alert Rules skill's discover -> draft -> backtest ->
// tune pipeline. This is what the scheduler (agency — runs on its own, not
// on a button click) and the CLI both call.

const store = require("./store");
const { refreshServiceContext } = require("./questions");
const { computeBaseline } = require("./baseline");
const { draftRulesForService } = require("./draft");
const { refineDraftViaBacktest } = require("./tuning");

function outcomesForTier(criticality) {
  const outcomes = store.load("outcomes", []);
  return outcomes.filter((o) => o.criticality === criticality);
}

/**
 * Runs the full pipeline for every service that has a resolved criticality
 * (real telemetry label or an already-answered question). Services still
 * waiting on a pending question are skipped — per house rule #2, never
 * guess criticality to force a draft through.
 */
async function runPipeline({ hoursBack = 24, log = console.log, serviceFilter = null } = {}) {
  const { services, pendingQuestions } = await refreshServiceContext();

  if (pendingQuestions.length) {
    log(`${pendingQuestions.length} question(s) pending — skipping drafting for those services until answered:`);
    pendingQuestions.forEach((q) => log(`  [${q.id}] ${q.question}`));
  }

  let readyServices = services.filter((s) => s.service_criticality);
  if (serviceFilter) readyServices = readyServices.filter((s) => serviceFilter.includes(s.service_name));
  const existingRules = store.load("rules", []);
  const rulesByService = new Map();
  for (const r of existingRules) {
    if (!rulesByService.has(r.service_name)) rulesByService.set(r.service_name, []);
    rulesByService.get(r.service_name).push(r);
  }

  const allRules = [...existingRules];

  for (const svc of readyServices) {
    // Don't re-draft a service that already has active drafts/approved rules
    // from a prior run — this pipeline is for NEW services or ones with none
    // yet. Re-tuning of already-approved rules is proposeRetune's job, not this.
    if (rulesByService.has(svc.service_name)) continue;

    log(`Drafting rules for ${svc.service_name} (criticality: ${svc.service_criticality})...`);
    const baseline = await computeBaseline(svc.service_name);
    const priorOutcomes = outcomesForTier(svc.service_criticality);
    const drafts = await draftRulesForService(svc, baseline, priorOutcomes);

    for (const draft of drafts) {
      if (draft.status === "needs_input") {
        allRules.push(draft);
        continue;
      }
      log(`  Backtesting + tuning ${draft.signal_type}...`);
      const { rule: tuned, status, question } = await refineDraftViaBacktest(draft, { hoursBack });
      allRules.push({ ...tuned, status: status === "draft_ready" ? "pending_review" : "needs_input", open_question: question || null });
    }
  }

  store.save("rules", allRules);
  return { services, pendingQuestions, rules: allRules };
}

module.exports = { runPipeline };

if (require.main === module) {
  require("../../env");
  runPipeline()
    .then((r) => {
      console.log(`\nDone. ${r.rules.length} rule(s) total, ${r.pendingQuestions.length} pending question(s).`);
    })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      process.exit(1);
    });
}
