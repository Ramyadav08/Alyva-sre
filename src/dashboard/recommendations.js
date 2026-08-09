// Recommendations — deliberately NOT a new anomaly-detection pathway. Every
// recommendation here is a next_step already produced by a real Detection &
// RCA investigation, tied to its source investigation and evidence. No
// generic advice restated regardless of context — if there's no
// investigation, there's no recommendation.

const store = require("../shared/store");

function buildRecommendations({ limit = 10 } = {}) {
  const investigations = store.load("investigations", []);
  const withReports = investigations.filter((i) => i.converged && i.report);

  const items = [];
  for (const inv of withReports) {
    const r = inv.report;
    (r.next_steps || []).forEach((step, i) => {
      items.push({
        service_name: inv.service_name,
        investigation_id: inv.id,
        recommendation: step,
        is_code_fix: i === 0 && r.code_fix_suggested, // convention: first next_step is the primary action
        confidence: r.confidence,
        evidence_headline: r.headline,
        triggered_at: inv.triggered_at,
        status: inv.status,
      });
    });
  }

  items.sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at));
  return { recommendations: items.slice(0, limit), total: items.length };
}

module.exports = { buildRecommendations };
