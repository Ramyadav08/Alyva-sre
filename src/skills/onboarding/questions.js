// The actual "ask like a real SRE joining a team" mechanism. Two question
// types, per HOUSE_RULES.md:
//   1. service_criticality — only when telemetry has no service_criticality
//      label (rule #3, moved here from Alert Rules — this skill is now the
//      canonical source of that resolution).
//   2. business_context — only for services already resolved as critical/
//      high tier (rule #5), asking impact + escalation together since
//      they're genuinely one topic (rule #4).
// Every question opens with the concrete evidence that prompted it.

const store = require("../../shared/store");

const CRITICALITY_OPTIONS = ["critical", "high", "medium", "low"];
const HIGH_TIERS = ["critical", "high"];

function criticalityQuestionId(serviceName) {
  return `svc-criticality-${serviceName}`;
}

function businessContextQuestionId(serviceName) {
  return `svc-business-context-${serviceName}`;
}

function buildCriticalityQuestion(serviceName) {
  return {
    id: criticalityQuestionId(serviceName),
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

const MIN_MATCHES_FOR_HINT = 2; // same "generalizable" gate as Alert Rules' learned-correction factor

/**
 * Deterministic escalation-label hint — same four-gate philosophy as Alert
 * Rules' learnedCorrectionFactor(): no agent decides this, pure string
 * matching over real prior answers. Only looks for an EXACT repeated
 * #channel/@handle token across >=2 prior answers in the same tier — it
 * doesn't try to semantically infer a label from free text, that would be a
 * judgment call dressed as a fact. No match, no hint — never guessed.
 */
function escalationHint(existingQuestions, criticality) {
  const priorAnswers = existingQuestions.filter(
    (q) => q.type === "business_context" && q.status === "answered" && q.criticality === criticality && q.answer && q.answer.toLowerCase() !== "unknown"
  );
  if (priorAnswers.length < MIN_MATCHES_FOR_HINT) return null;

  const tokenCounts = new Map();
  for (const q of priorAnswers) {
    const tokens = q.answer.match(/[#@][\w-]+/g) || [];
    for (const t of new Set(tokens)) tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
  }
  const [topToken, count] = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return count >= MIN_MATCHES_FOR_HINT ? { token: topToken, count } : null;
}

function buildBusinessContextQuestion(serviceName, criticality, snapshot, hint) {
  const trafficNote =
    snapshot?.call_rate_per_sec != null
      ? `~${(snapshot.call_rate_per_sec * 60).toFixed(0)} requests/min, p99 latency ${snapshot.latency_p99_ms?.toFixed(1) ?? "n/a"}ms`
      : "no traffic snapshot available yet";
  const hintNote = hint
    ? ` (${hint.count} prior ${criticality}-tier services were flagged to ${hint.token} — reply with that if it's relevant here too, or something else if not)`
    : "";
  return {
    id: businessContextQuestionId(serviceName),
    type: "business_context",
    service: serviceName,
    criticality,
    question:
      `"${serviceName}" is resolved as ${criticality}-tier (${trafficNote}). What's the business ` +
      `impact if it goes down — a rough revenue/minute figure or user-facing consequence — and who/ ` +
      `what team should be notified${hintNote}? Reply "unknown" if you don't have a number yet, ` +
      `that's fine, I won't invent one.`,
    evidence: `Criticality already resolved for "${serviceName}"; asking because it's ${criticality}-tier (rule: only ask business-impact for critical/high services).`,
    status: "pending",
    answer: null,
    free_text: true,
  };
}

/**
 * Given discovered services (with snapshot + telemetry-provided criticality
 * where present) and any previously-answered questions, returns the merged
 * question set — generating new ones only where genuinely needed, never
 * re-asking an already-answered service.
 */
function buildQuestionSet(discoveredServices) {
  const existing = store.load("onboarding-questions", []);
  const byId = new Map(existing.map((q) => [q.id, q]));

  for (const svc of discoveredServices) {
    let resolvedCriticality = svc.service_criticality;

    if (!resolvedCriticality) {
      const qid = criticalityQuestionId(svc.service_name);
      const existingQ = byId.get(qid);
      if (existingQ?.status === "answered" && existingQ.answer) {
        resolvedCriticality = existingQ.answer;
      } else if (!byId.has(qid)) {
        byId.set(qid, buildCriticalityQuestion(svc.service_name));
      }
    }

    // Business-context question only once criticality is resolved AND it's
    // a high/critical tier AND we haven't already asked it.
    if (resolvedCriticality && HIGH_TIERS.includes(resolvedCriticality)) {
      const bqid = businessContextQuestionId(svc.service_name);
      const existingQ = byId.get(bqid);
      // Not just "create if missing" — an existing but still-PENDING question
      // gets its hint refreshed every pass too. Without this, questions
      // created in the same batch (e.g. several telemetry-resolved critical
      // services discovered simultaneously, before any human has answered
      // anything) would never benefit from each other's answers landing
      // later — the hint would only ever apply to services discovered AFTER
      // the pattern existed, which in practice is rarely how discovery
      // batches land. Already-answered questions are never touched.
      if (!existingQ || existingQ.status === "pending") {
        const hint = escalationHint(existing, resolvedCriticality);
        byId.set(bqid, buildBusinessContextQuestion(svc.service_name, resolvedCriticality, svc.snapshot, hint));
      }
    }
  }

  const all = [...byId.values()];
  store.save("onboarding-questions", all);
  return all;
}

function answerQuestion(id, answer) {
  const questions = store.load("onboarding-questions", []);
  const q = questions.find((x) => x.id === id);
  if (!q) throw new Error(`No such question: ${id}`);
  if (q.type === "service_criticality" && !CRITICALITY_OPTIONS.includes(answer)) {
    throw new Error(`Invalid answer "${answer}" — must be one of ${CRITICALITY_OPTIONS.join(", ")}`);
  }
  q.status = "answered";
  q.answer = answer;
  q.answered_at = new Date().toISOString();
  store.save("onboarding-questions", questions);
  return q;
}

module.exports = {
  buildQuestionSet,
  answerQuestion,
  criticalityQuestionId,
  businessContextQuestionId,
  CRITICALITY_OPTIONS,
};
