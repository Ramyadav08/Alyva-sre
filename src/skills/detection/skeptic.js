// Adversarial check on the investigator's conclusion — pattern taken
// directly from communitytools' skeptic-role.md: a second reasoning pass
// gets the SAME raw evidence but deliberately withholds the investigator's
// own hypothesis/framing, so it can't just agree with itself under a
// different name. It forms its own independent read, then we compare.
//
// Per that reference's own rule: "killing a claim must never silently
// become a severity cap" — a skeptic objection downgrades what's SHOWN
// (a visible flag), never silently rewrites the report's confidence field.

const OpenAI = require("openai");

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey });
}

const SKEPTIC_TOOL = {
  type: "function",
  function: {
    name: "submit_skeptic_review",
    parameters: {
      type: "object",
      properties: {
        independent_hypothesis: { type: "string", description: "Your own read of what the evidence shows — formed WITHOUT seeing the investigator's conclusion." },
        contradicts_investigator: { type: "boolean" },
        unstated_assumption: { type: "string", description: "An assumption the investigation seems to have made without evidence, or null if none found." },
        objection: { type: "string", description: "If contradicts_investigator is true, the specific evidence in the ledger that contradicts it. Null otherwise." },
      },
      required: ["independent_hypothesis", "contradicts_investigator"],
    },
  },
};

/**
 * ledger and trigger only — the investigator's hypothesis text is
 * deliberately NOT passed in, so the skeptic forms an independent read
 * instead of just re-agreeing with a framing it's already seen.
 */
async function skepticCheck(ledger, trigger, investigatorHypothesis) {
  const ai = client();
  const system =
    `You are an independent skeptic reviewing raw evidence from an SRE investigation — you have ` +
    `NOT been told what the investigator concluded. Form your OWN read of what this evidence ` +
    `shows first. Then you'll be told the investigator's hypothesis and asked whether your ` +
    `independent read contradicts it. Objections target unproven claims, not confidence in ` +
    `general — if the evidence genuinely supports the hypothesis, say so, don't invent doubt.`;

  const evidenceOnly = JSON.stringify({ trigger, ledger: ledger.map((e) => ({ tool: e.tool, args: e.args, result: e.result })) }, null, 2);

  const first = await ai.chat.completions.create({
    model: process.env.DETECTION_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Raw evidence (no conclusion attached yet):\n${evidenceOnly}\n\nWhat does this evidence, on its own, suggest happened?` },
    ],
  });
  const independentRead = first.choices[0]?.message?.content || "";

  const second = await ai.chat.completions.create({
    model: process.env.DETECTION_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Raw evidence:\n${evidenceOnly}` },
      { role: "assistant", content: independentRead },
      {
        role: "user",
        content: `The investigator's actual hypothesis was: "${investigatorHypothesis}". Does your independent read contradict it, or find an unstated assumption? Call submit_skeptic_review.`,
      },
    ],
    tools: [SKEPTIC_TOOL],
    tool_choice: { type: "function", function: { name: "submit_skeptic_review" } },
  });

  const call = second.choices[0]?.message?.tool_calls?.[0];
  const review = call ? JSON.parse(call.function.arguments) : { independent_hypothesis: independentRead, contradicts_investigator: false };
  return { ...review, independent_hypothesis: review.independent_hypothesis || independentRead };
}

module.exports = { skepticCheck };
