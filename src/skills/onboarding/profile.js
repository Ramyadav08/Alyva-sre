// The Project Profile — the thing every other skill reads from (per
// HOUSE_RULES.md: "What other skills read from here"). Built by merging real
// discovery (discover.js) with answered questions (questions.js). Nothing
// here is invented — a field stays null/"unknown, awaiting input" until
// either telemetry or a human answer resolves it.

const store = require("../../shared/store");

/**
 * Builds/updates the persisted profile from discovered services + the
 * current question set. A service's profile is only "confirmed" once a
 * human has explicitly approved it (draft-then-approve, rule #8) — until
 * then it's "draft", but downstream skills MAY still read a draft profile's
 * resolved criticality (waiting for full confirmation on every field before
 * any other skill can function would stall everything on a slow reviewer).
 */
function buildProfiles(discoveredServices, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const existingProfiles = store.load("onboarding-profile", []);
  const existingByService = new Map(existingProfiles.map((p) => [p.service_name, p]));

  const profiles = discoveredServices.map((svc) => {
    const prior = existingByService.get(svc.service_name);
    let criticality = svc.service_criticality;
    let criticalitySource = criticality ? "telemetry" : null;

    if (!criticality) {
      const cq = byId.get(`svc-criticality-${svc.service_name}`);
      if (cq?.status === "answered" && cq.answer) {
        criticality = cq.answer;
        criticalitySource = "human_answer";
      }
    }

    const bq = byId.get(`svc-business-context-${svc.service_name}`);
    const businessImpact =
      bq?.status === "answered" && bq.answer && bq.answer.toLowerCase() !== "unknown"
        ? { status: "provided", detail: bq.answer, answered_at: bq.answered_at }
        : { status: "unknown_awaiting_input", detail: null };

    return {
      service_name: svc.service_name,
      service_criticality: criticality || null,
      criticality_source: criticalitySource || "pending_question",
      business_impact: businessImpact,
      snapshot: svc.snapshot,
      status: prior?.status === "confirmed" ? "confirmed" : "draft",
      onboarded_at: prior?.onboarded_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  store.save("onboarding-profile", profiles);
  return profiles;
}

function getProfiles() {
  return store.load("onboarding-profile", []);
}

function getProfile(serviceName) {
  return getProfiles().find((p) => p.service_name === serviceName) || null;
}

function confirmProfile(serviceName) {
  const profiles = store.load("onboarding-profile", []);
  const p = profiles.find((x) => x.service_name === serviceName);
  if (!p) throw new Error(`No profile for ${serviceName}`);
  p.status = "confirmed";
  p.confirmed_at = new Date().toISOString();
  store.save("onboarding-profile", profiles);
  return p;
}

module.exports = { buildProfiles, getProfiles, getProfile, confirmProfile };
