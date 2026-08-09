// Orchestrator: discover -> build/merge question set -> build profile.
// This is what runs unprompted on server startup (agency) and whenever a
// genuinely new service appears in telemetry (rule #7 — re-run discovery,
// not the interview, for existing services).

const { discoverWithSnapshots } = require("./discover");
const { buildQuestionSet, answerQuestion } = require("./questions");
const { buildProfiles, getProfiles, getProfile, confirmProfile } = require("./profile");

async function refreshOnboarding({ log = () => {} } = {}) {
  log("Discovering services + live snapshots...");
  const discovered = await discoverWithSnapshots();
  const questions = buildQuestionSet(discovered);
  const profiles = buildProfiles(discovered, questions);
  const pendingQuestions = questions.filter((q) => q.status === "pending");
  log(`Onboarding: ${profiles.length} service(s) profiled, ${pendingQuestions.length} question(s) pending.`);
  return { profiles, questions, pendingQuestions };
}

module.exports = { refreshOnboarding, answerQuestion, getProfiles, getProfile, confirmProfile };

if (require.main === module) {
  require("../../env");
  refreshOnboarding({ log: console.log }).catch((err) => {
    console.error("Onboarding run failed:", err);
    process.exit(1);
  });
}
