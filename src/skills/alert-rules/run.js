// Orchestrator for the Alert Rules skill's draft -> backtest -> tune
// pipeline. This is what the scheduler (agency — runs on its own, not on a
// button click) and the CLI both call.
//
// Service discovery + criticality resolution is now Onboarding's job, not
// this skill's — this skill reads the Project Profile Onboarding produces
// instead of running its own discovery or asking its own criticality
// questions (see onboarding/HOUSE_RULES.md: "What other skills read from
// here"). A service with no resolved criticality in that profile yet is
// skipped with "waiting on onboarding", never a duplicate question.

const store = require("../../shared/store");
const { getProfiles } = require("../onboarding/profile");
const { computeBaseline } = require("../../shared/baseline");
const { draftRulesForService } = require("./draft");
const { refineDraftViaBacktest } = require("./tuning");

function outcomesForTier(criticality) {
  const outcomes = store.load("outcomes", []);
  return outcomes.filter((o) => o.criticality === criticality);
}

async function runPipeline({ hoursBack = 24, log = console.log, serviceFilter = null } = {}) {
  const profiles = getProfiles();

  const waitingOnOnboarding = profiles.filter((p) => !p.service_criticality);
  if (waitingOnOnboarding.length) {
    log(`${waitingOnOnboarding.length} service(s) waiting on Onboarding (no resolved criticality yet) — skipping:`);
    waitingOnOnboarding.forEach((p) => log(`  ${p.service_name}`));
  }

  let readyServices = profiles.filter((p) => p.service_criticality);
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
    const serviceProfile = { service_name: svc.service_name, service_criticality: svc.service_criticality, criticality_source: svc.criticality_source };
    const drafts = await draftRulesForService(serviceProfile, baseline, priorOutcomes);

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
  return { profiles, waitingOnOnboarding, rules: allRules };
}

module.exports = { runPipeline };

if (require.main === module) {
  require("../../env");
  runPipeline()
    .then((r) => {
      console.log(`\nDone. ${r.rules.length} rule(s) total, ${r.waitingOnOnboarding.length} waiting on onboarding.`);
    })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      process.exit(1);
    });
}
