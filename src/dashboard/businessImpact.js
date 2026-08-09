// Business impact summary — computed from Onboarding's Project Profile
// (business_impact.detail, human-provided, never invented) crossed with
// Detection's currently-open investigations. If a service has no provided
// business impact, or there's no active investigation for it, that's
// exactly what gets shown — never a fabricated number.

const store = require("../shared/store");

function buildBusinessImpactSummary() {
  const profiles = store.load("onboarding-profile", []);
  const investigations = store.load("investigations", []);
  const activeInvestigations = investigations.filter((i) => i.status !== "resolved");

  if (!activeInvestigations.length) {
    return {
      has_active_impact: false,
      headline: "No active incidents right now — no business impact to report.",
      items: [],
    };
  }

  const items = activeInvestigations.map((inv) => {
    const profile = profiles.find((p) => p.service_name === inv.service_name);
    const impact = profile?.business_impact;
    return {
      service_name: inv.service_name,
      investigation_id: inv.id,
      headline: inv.report?.headline || "Investigation in progress — no report yet.",
      confidence: inv.report?.confidence || null,
      business_impact:
        impact?.status === "provided"
          ? impact.detail
          : "unknown, awaiting input — no business-impact answer on file for this service in Onboarding",
      criticality: profile?.service_criticality || "unresolved",
    };
  });

  const knownImpactCount = items.filter((i) => !i.business_impact.startsWith("unknown")).length;

  return {
    has_active_impact: true,
    headline: `${items.length} active incident(s)${knownImpactCount ? `, ${knownImpactCount} with known business impact` : ""}.`,
    items,
  };
}

module.exports = { buildBusinessImpactSummary };
