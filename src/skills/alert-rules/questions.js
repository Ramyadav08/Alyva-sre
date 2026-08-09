// Context gathering, inline and evidence-grounded — per HOUSE_RULES.md rule
// #2: never guess a service's business criticality. Read it from real
// telemetry (discoverServices() already does this from service_criticality
// resource attributes); only ask a human for the services where that
// attribute is genuinely absent, and say exactly what was checked.

const { discoverServices } = require("../../lgtm");
const store = require("./store");

const CRITICALITY_OPTIONS = ["critical", "high", "medium", "low"];

function questionIdFor(serviceName) {
  return `svc-criticality-${serviceName}`;
}

function buildQuestion(serviceName) {
  return {
    id: questionIdFor(serviceName),
    type: "service_criticality",
    service: serviceName,
    question:
      `I don't see a service_criticality label anywhere in "${serviceName}"'s telemetry — ` +
      `is this a customer-facing/business-critical service, or internal tooling I should treat ` +
      `as low priority for alerting?`,
    evidence:
      `Checked the traces_span_metrics_calls_total series for service_name="${serviceName}" — ` +
      `no service_criticality resource attribute present on any span.`,
    options: CRITICALITY_OPTIONS,
    status: "pending",
    answer: null,
  };
}

/**
 * Re-discovers real services from telemetry, merges in any previously
 * answered questions, and returns { services, pendingQuestions }.
 * Services with a real service_criticality label never generate a question.
 */
async function refreshServiceContext() {
  const discovered = await discoverServices();
  const questions = store.load("questions", []);
  const questionsById = new Map(questions.map((q) => [q.id, q]));

  const services = discovered.map((svc) => {
    if (svc.service_criticality) {
      return { ...svc, criticality_source: "telemetry" };
    }
    const qid = questionIdFor(svc.service_name);
    const existing = questionsById.get(qid);
    if (existing?.status === "answered" && existing.answer) {
      return { ...svc, service_criticality: existing.answer, criticality_source: "human_answer" };
    }
    if (!questionsById.has(qid)) {
      const q = buildQuestion(svc.service_name);
      questionsById.set(qid, q);
    }
    return { ...svc, criticality_source: "pending_question" };
  });

  const allQuestions = [...questionsById.values()];
  store.save("questions", allQuestions);
  store.save("services", services);

  const pendingQuestions = allQuestions.filter((q) => q.status === "pending");
  return { services, pendingQuestions };
}

function answerQuestion(id, answer) {
  if (!CRITICALITY_OPTIONS.includes(answer)) {
    throw new Error(`Invalid answer "${answer}" — must be one of ${CRITICALITY_OPTIONS.join(", ")}`);
  }
  const questions = store.load("questions", []);
  const q = questions.find((x) => x.id === id);
  if (!q) throw new Error(`No such question: ${id}`);
  q.status = "answered";
  q.answer = answer;
  q.answered_at = new Date().toISOString();
  store.save("questions", questions);
  return q;
}

module.exports = { refreshServiceContext, answerQuestion, buildQuestion, CRITICALITY_OPTIONS };
