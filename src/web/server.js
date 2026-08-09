require("../env");

const express = require("express");
const path = require("path");
const store = require("../skills/alert-rules/store");
const { refreshServiceContext, answerQuestion } = require("../skills/alert-rules/questions");
const { runPipeline } = require("../skills/alert-rules/run");
const { proposeRetune } = require("../skills/alert-rules/tuning");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4310;
const RETUNE_INTERVAL_MS = Number(process.env.RETUNE_INTERVAL_MS || 10 * 60 * 1000); // 10 min, agency: runs on its own

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
  const services = store.load("services", []);
  const questions = store.load("questions", []);
  const rules = store.load("rules", []);
  const outcomes = store.load("outcomes", []);
  res.json({
    services,
    pendingQuestions: questions.filter((q) => q.status === "pending"),
    rules,
    outcomes,
  });
});

app.post("/api/run", async (req, res) => {
  try {
    const hoursBack = Number(req.body?.hoursBack) || 24;
    const result = await runPipeline({ hoursBack, log: () => {} });
    res.json({ ok: true, ruleCount: result.rules.length, pendingQuestionCount: result.pendingQuestions.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/questions/:id/answer", (req, res) => {
  try {
    const q = answerQuestion(req.params.id, req.body.answer);
    res.json({ ok: true, question: q });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

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
  console.log(`Alyva-sre Alert Rules review UI: http://localhost:${PORT}`);
  console.log("Running initial discovery + draft pipeline...");
  try {
    await refreshServiceContext();
    await runPipeline({ hoursBack: 24, log: console.log });
  } catch (err) {
    console.error("Initial pipeline run failed:", err.message);
  }
  setInterval(() => {
    retuneSweep().catch((err) => console.error("Retune sweep failed:", err.message));
  }, RETUNE_INTERVAL_MS);
});
