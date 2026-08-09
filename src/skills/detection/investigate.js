// The actual agentic tool-use loop — this IS the mechanism, not a
// summarization call. The model decides what to check next based on what it
// just saw, exactly the malleability trait this whole repo is built around.
// Every tool call is logged to the ledger BEFORE the model sees the result,
// so the ledger is a true trace of what happened, not a reconstruction.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { TOOL_DEFINITIONS, executeTool } = require("./tools");

const HOUSE_RULES = fs.readFileSync(path.join(__dirname, "HOUSE_RULES.md"), "utf8");
const MAX_ITERATIONS = 8;

const SUBMIT_REPORT_TOOL = {
  type: "function",
  function: {
    name: "submit_report",
    description: "Call this when you have enough evidence to conclude the investigation — this ends it. Every field must be traceable to a tool call you actually made.",
    parameters: {
      type: "object",
      properties: {
        headline: { type: "string", description: "2-3 sentences: what broke, blast radius, confidence. This is what a human sees first." },
        hypothesis: { type: "string", description: "The root-cause hypothesis, citing the specific evidence (metric/log/trace) behind it." },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        evidence_refs: { type: "array", items: { type: "string" }, description: "Specific values/messages from ledger entries — e.g. 'checkout PlaceOrder span error: failed to get product #6E92ZMYYFZ', not just a tool name. If search_traces was called, at least one ref must come from a get_trace_detail call on one of those traces, not the trace list alone." },
        business_impact_note: { type: "string", description: "From get_project_profile's result. Must say 'unknown, awaiting input' verbatim if that's what the profile showed — never invent a figure." },
        next_steps: { type: "array", items: { type: "string" }, description: "Concrete, ordered next steps for THIS incident." },
        code_fix_suggested: { type: "boolean" },
        code_fix_description: { type: "string", description: "Only if code_fix_suggested is true — what the fix would be." },
      },
      required: ["headline", "hypothesis", "confidence", "evidence_refs", "business_impact_note", "next_steps", "code_fix_suggested"],
    },
  },
};

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — cannot investigate without it.");
  return new OpenAI({ apiKey });
}

function buildSystemPrompt() {
  return (
    `You are the Detection & RCA skill of an AI-native SRE agent. An alert rule fired for real ` +
    `— investigate it the way an SRE would: pull evidence, follow it wherever it leads, don't ` +
    `just restate the trigger. Follow these house rules exactly:\n\n${HOUSE_RULES}\n\n` +
    `You have tools to query metrics, logs, and traces, plus get_service_snapshot and ` +
    `get_project_profile. Call them as needed — you decide what to check next based on what you ` +
    `find. When you have enough evidence, call submit_report to conclude. Per house rule #4, ` +
    `check at least one signal type beyond the one that triggered before concluding. You have a ` +
    `LIMITED number of tool calls — never call the same tool with the same arguments twice, check ` +
    `what you've already gathered in this conversation before deciding what to check next. Prefer ` +
    `submit_report as soon as you have a defensible hypothesis over gathering more confirmation.`
  );
}

/**
 * Runs one investigation to conclusion (or exhaustion). Returns
 * { ledger, report, converged }. `priorMessages` lets a follow-up question
 * re-enter the SAME investigation with its existing ledger intact (house
 * rule #7) — pass the messages array this function returns via
 * result.messages, plus a new user message, to continue.
 */
async function runInvestigation(trigger, { maxIterations = MAX_ITERATIONS, priorMessages = null } = {}) {
  const ai = client();
  const ledger = [];
  const tools = [...TOOL_DEFINITIONS, SUBMIT_REPORT_TOOL];
  const seenCalls = new Map(); // "tool:args" -> ledger index, structural dedup guard

  const messages = priorMessages || [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: JSON.stringify({ trigger }, null, 2) },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const completion = await ai.chat.completions.create({
      model: process.env.DETECTION_MODEL || "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    messages.push(msg);

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      // Model responded with plain text instead of calling a tool — nudge
      // it once rather than silently ending with no report.
      messages.push({ role: "user", content: "Call submit_report with your conclusion, or call another tool if you need more evidence." });
      continue;
    }

    const reportCall = toolCalls.find((tc) => tc.function.name === "submit_report");
    if (reportCall) {
      const report = JSON.parse(reportCall.function.arguments);
      // Every tool_call in this message needs a matching tool response
      // before the conversation can be resumed later (OpenAI API
      // requirement) — including submit_report itself. Missing this broke
      // follow-up continuation entirely until caught by testing it for real.
      for (const tc of toolCalls) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: tc.id === reportCall.id ? JSON.stringify({ acknowledged: true }) : JSON.stringify({ note: "Not executed — investigation concluded via submit_report in the same turn." }),
        });
      }
      return { ledger, report, converged: true, messages };
    }

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments || "{}");
      const callKey = `${tc.function.name}:${JSON.stringify(args)}`;

      // Structural dedup, not just a prompt instruction: an identical call
      // doesn't re-hit the API or consume a fresh ledger entry — it's
      // pointed straight back at what was already found, which costs the
      // model nothing to notice and doesn't burn a real evidence-gathering
      // iteration on a repeat.
      if (seenCalls.has(callKey)) {
        const priorIndex = seenCalls.get(callKey);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ note: `Already called with these exact arguments — see ledger entry #${priorIndex + 1}. Result unchanged.`, prior_result: ledger[priorIndex].result }),
        });
        continue;
      }

      const entry = { tool: tc.function.name, args, at: new Date().toISOString() };
      try {
        entry.result = await executeTool(tc.function.name, args);
      } catch (err) {
        entry.error = err.message;
      }
      ledger.push(entry);
      seenCalls.set(callKey, ledger.length - 1);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(entry.result ?? { error: entry.error }),
      });
    }
  }

  // Exhausted iterations without a submit_report call — report what was
  // actually found, at low confidence, rather than silently dropping the
  // evidence gathered so far.
  return {
    ledger,
    report: {
      headline: `Investigation did not converge after ${maxIterations} tool-use iterations — see evidence gathered so far.`,
      hypothesis: "Inconclusive — ran out of investigation budget before reaching a confident root cause.",
      confidence: "low",
      evidence_refs: ledger.map((e) => `${e.tool}(${JSON.stringify(e.args)})`),
      business_impact_note: "unknown, awaiting input",
      next_steps: ["Manual review of the evidence ledger recommended.", "Consider re-running with a higher iteration budget."],
      code_fix_suggested: false,
    },
    converged: false,
    messages,
  };
}

module.exports = { runInvestigation };
