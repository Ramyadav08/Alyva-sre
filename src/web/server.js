require("../env");

const express = require("express");
const path = require("path");
const store = require("../shared/store");
const onboarding = require("../skills/onboarding/run");
const { runPipeline } = require("../skills/alert-rules/run");
const { proposeRetune } = require("../skills/alert-rules/tuning");
const detection = require("../skills/detection/run");
const { proposePR } = require("../skills/detection/proposals");
const { buildServiceGraph } = require("../dashboard/serviceGraph");
const { buildBusinessImpactSummary } = require("../dashboard/businessImpact");
const { buildRecommendations } = require("../dashboard/recommendations");
const customPanel = require("../dashboard/customPanel");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4310;
const RETUNE_INTERVAL_MS = Number(process.env.RETUNE_INTERVAL_MS || 10 * 60 * 1000); // 10 min, agency: runs on its own
const DETECTION_SCAN_INTERVAL_MS = Number(process.env.DETECTION_SCAN_INTERVAL_MS || 2 * 60 * 1000); // 2 min
const SERVICE_GRAPH_INTERVAL_MS = Number(process.env.SERVICE_GRAPH_INTERVAL_MS || 3 * 60 * 1000); // 3 min
const ONBOARDING_REFRESH_INTERVAL_MS = Number(process.env.ONBOARDING_REFRESH_INTERVAL_MS || 2 * 60 * 1000); // 2 min

// Service graph takes ~5s to compute (samples real traces across every
// service) — cached and refreshed on an interval rather than recomputed on
// every dashboard poll.
let cachedServiceGraph = { edges: [], excluded: [], traces_sampled: 0, services_sampled: 0, computed_at: null };
async function refreshServiceGraph() {
  const result = await buildServiceGraph({});
  cachedServiceGraph = { ...result, computed_at: new Date().toISOString() };
}

function recordOutcome(rule, action, extra = {}) {
  const outcomes = store.load("outcomes", []);
  outcomes.push({
    at: new Date().toISOString(),
    rule_id: rule.id,
    service_name: rule.service_name,
    criticality: rule.criticality,
    signal_type: rule.signal_type,
    action, // "approved" | "edited" | "rejected"
    original_threshold: rule.threshold,
    ...extra,
  });
  store.save("outcomes", outcomes);
}

// ---- API ----

app.get("/api/state", async (req, res) => {
  const profiles = store.load("onboarding-profile", []);
  const onboardingQuestions = store.load("onboarding-questions", []);
  const rules = store.load("rules", []);
  const outcomes = store.load("outcomes", []);
  const investigations = detection.loadInvestigations();
  res.json({
    profiles,
    pendingOnboardingQuestions: onboardingQuestions.filter((q) => q.status === "pending"),
    rules,
    outcomes,
    investigations,
  });
});

app.post("/api/run", async (req, res) => {
  try {
    const hoursBack = Number(req.body?.hoursBack) || 24;
    await onboarding.refreshOnboarding({ log: () => {} });
    const result = await runPipeline({ hoursBack, log: () => {} });
    res.json({ ok: true, ruleCount: result.rules.length, waitingOnOnboarding: result.waitingOnOnboarding.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Onboarding ----

app.post("/api/onboarding/questions/:id/answer", (req, res) => {
  try {
    const q = onboarding.answerQuestion(req.params.id, req.body.answer);
    res.json({ ok: true, question: q });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/onboarding/profile/:service/confirm", (req, res) => {
  try {
    const p = onboarding.confirmProfile(req.params.service);
    res.json({ ok: true, profile: p });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---- Dashboard ----

app.get("/api/dashboard/state", (req, res) => {
  res.json({
    businessImpact: buildBusinessImpactSummary(),
    serviceGraph: cachedServiceGraph,
    recommendations: buildRecommendations({ limit: 10 }),
    layout: customPanel.getLayout(),
  });
});

app.post("/api/dashboard/custom-panel/draft", async (req, res) => {
  try {
    const result = await customPanel.draftAndPreview(req.body.request);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/dashboard/custom-panel/keep", (req, res) => {
  try {
    const layout = customPanel.keepPanel(req.body.spec);
    res.json({ ok: true, layout });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/dashboard/custom-panel/:id/remove", (req, res) => {
  const layout = customPanel.removePanel(req.params.id);
  res.json({ ok: true, layout });
});

app.post("/api/dashboard/custom-panel/:id/refresh", async (req, res) => {
  const layout = customPanel.getLayout();
  const panel = layout.find((p) => p.id === req.params.id);
  if (!panel) return res.status(404).json({ ok: false, error: "No such panel" });
  const data = await customPanel.executePanelSpec(panel);
  res.json({ ok: true, data });
});

// Ownership: opens a real PR for a code fix. Only runs on explicit human
// trigger for a specific investigation — never on a schedule (house rule
// #6, "ownership never self-executes").
app.post("/api/investigations/:id/propose-pr", async (req, res) => {
  try {
    const investigations = detection.loadInvestigations();
    const inv = investigations.find((i) => i.id === req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "No such investigation" });
    const result = proposePR(inv, { dryRun: req.body?.dryRun !== false });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---- Detection & RCA ----

app.post("/api/investigations/:id/followup", async (req, res) => {
  try {
    const inv = await detection.askFollowUp(req.params.id, req.body.question);
    res.json({ ok: true, investigation: inv });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/investigations/:id/resolve", (req, res) => {
  try {
    const inv = detection.resolveInvestigation(req.params.id, req.body.note, req.body.root_cause_tag);
    res.json({ ok: true, investigation: inv });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/investigations/scan", async (req, res) => {
  try {
    const investigations = await detection.scanForNewInvestigations({ log: () => {} });
    res.json({ ok: true, count: investigations.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Alert Rules ----

app.post("/api/rules/:id/approve", (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "No such rule" });
  rule.status = "approved";
  rule.approved_at = new Date().toISOString();
  store.save("rules", rules);
  recordOutcome(rule, "approved");
  res.json({ ok: true, rule });
});

app.post("/api/rules/:id/reject", (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "No such rule" });
  rule.status = "rejected";
  rule.rejected_at = new Date().toISOString();
  rule.rejection_note = req.body?.note || null;
  store.save("rules", rules);
  recordOutcome(rule, "rejected", { note: req.body?.note || null });
  res.json({ ok: true, rule });
});

app.post("/api/rules/:id/edit", (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "No such rule" });
  const originalThreshold = rule.threshold;
  if (req.body.threshold != null) rule.threshold = Number(req.body.threshold);
  if (req.body.window_minutes != null) rule.window_minutes = Number(req.body.window_minutes);
  rule.status = "approved";
  rule.edited = true;
  rule.approved_at = new Date().toISOString();
  store.save("rules", rules);
  recordOutcome(rule, "edited", { final_threshold: rule.threshold });
  res.json({ ok: true, rule, original_threshold: originalThreshold });
});

// Post-approval retune check — never auto-applies, just surfaces a cited proposal.
app.post("/api/rules/:id/retune-check", async (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "No such rule" });
  try {
    const result = await proposeRetune(rule, Number(req.body?.hoursBack) || 24);
    if (result.needs_retune) {
      rule.retune_proposal = { ...result.proposal, backtest: result.backtest, proposed_at: new Date().toISOString() };
      store.save("rules", rules);
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/rules/:id/apply-retune", (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule || !rule.retune_proposal) return res.status(404).json({ ok: false, error: "No pending retune proposal" });
  const before = rule.threshold;
  rule.tuning_history = rule.tuning_history || [];
  rule.tuning_history.push({
    at: new Date().toISOString(),
    before_threshold: before,
    after_threshold: rule.retune_proposal.new_threshold,
    reason: rule.retune_proposal.rationale,
    human_approved: true,
  });
  rule.threshold = rule.retune_proposal.new_threshold;
  if (rule.retune_proposal.new_window_minutes) rule.window_minutes = rule.retune_proposal.new_window_minutes;
  rule.retune_proposal = null;
  store.save("rules", rules);
  recordOutcome(rule, "retuned", { before_threshold: before, after_threshold: rule.threshold });
  res.json({ ok: true, rule });
});

// Symmetric with apply-retune — house rule #4 requires a real reject path,
// not just an accept one. Rejecting clears the proposal (so retuneSweep can
// propose again next cycle if it's still noisy) and records why, so a
// human's reasoning for declining a tuning suggestion isn't lost.
app.post("/api/rules/:id/reject-retune", (req, res) => {
  const rules = store.load("rules", []);
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule || !rule.retune_proposal) return res.status(404).json({ ok: false, error: "No pending retune proposal" });
  const rejected = rule.retune_proposal;
  rule.retune_proposal = null;
  rule.retune_rejections = rule.retune_rejections || [];
  rule.retune_rejections.push({ at: new Date().toISOString(), proposal: rejected, note: req.body?.note || null });
  store.save("rules", rules);
  recordOutcome(rule, "retune_rejected", { proposed_threshold: rejected.new_threshold, note: req.body?.note || null });
  res.json({ ok: true, rule });
});

// ---- Agency: runs on its own, not on a button click ----
// Periodically re-checks APPROVED rules for drift back into noisy territory.
// Never auto-applies — proposals sit on the rule until a human approves them
// via /api/rules/:id/apply-retune above.
async function retuneSweep() {
  const rules = store.load("rules", []);
  const approved = rules.filter((r) => r.status === "approved" && !r.retune_proposal);
  for (const rule of approved) {
    try {
      const result = await proposeRetune(rule, 24);
      if (result.needs_retune) {
        rule.retune_proposal = { ...result.proposal, backtest: result.backtest, proposed_at: new Date().toISOString() };
        console.log(`[retune-sweep] ${rule.service_name}/${rule.signal_type}: proposing ${rule.threshold} -> ${result.proposal.new_threshold}`);
      }
    } catch (err) {
      console.error(`[retune-sweep] ${rule.service_name}/${rule.signal_type} failed:`, err.message);
    }
  }
  store.save("rules", rules);
}

app.listen(PORT, async () => {
  console.log(`Alyva-sre review UI: http://localhost:${PORT}`);
  console.log("Running initial onboarding + alert-rules pipeline...");
  try {
    await onboarding.refreshOnboarding({ log: console.log });
    await runPipeline({ hoursBack: 24, log: console.log });
  } catch (err) {
    console.error("Initial pipeline run failed:", err.message);
  }
  try {
    await detection.scanForNewInvestigations({ log: console.log });
  } catch (err) {
    console.error("Initial detection scan failed:", err.message);
  }
  try {
    await refreshServiceGraph();
    console.log(`Service graph: ${cachedServiceGraph.edges.length} edge(s) from ${cachedServiceGraph.traces_sampled} sampled traces.`);
  } catch (err) {
    console.error("Initial service graph build failed:", err.message);
  }
  setInterval(() => {
    retuneSweep().catch((err) => console.error("Retune sweep failed:", err.message));
  }, RETUNE_INTERVAL_MS);
  setInterval(() => {
    detection.scanForNewInvestigations({ log: console.log }).catch((err) => console.error("Detection scan failed:", err.message));
  }, DETECTION_SCAN_INTERVAL_MS);
  setInterval(() => {
    refreshServiceGraph().catch((err) => console.error("Service graph refresh failed:", err.message));
  }, SERVICE_GRAPH_INTERVAL_MS);
  // Agency gap found via a real walkthrough test: answering an onboarding
  // question only updated the Project Profile on the NEXT full pipeline
  // run, which previously only happened at startup or a manual /api/run —
  // meaning the dashboard silently went stale between answers. Chains into
  // Alert Rules too, since a newly-resolved service should get drafted for
  // without a human having to trigger anything.
  setInterval(() => {
    onboarding
      .refreshOnboarding({ log: () => {} })
      .then(() => runPipeline({ hoursBack: 24, log: () => {} }))
      .catch((err) => console.error("Onboarding refresh failed:", err.message));
  }, ONBOARDING_REFRESH_INTERVAL_MS);
});
