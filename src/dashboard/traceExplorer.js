// Standalone trace exploration — independent of any Detection investigation.
// User picks a real trace, asks a question about it, gets a real
// evidence-grounded answer. Reuses Detection's exact tool registry (same
// read-only guarantee — no mute/disable capability exists there either)
// but a lighter Q&A interaction model (submit_answer) instead of a full
// incident report (submit_report) — this isn't declaring an incident, it's
// answering a question.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const lgtm = require("../lgtm");
const { TOOL_DEFINITIONS, executeTool } = require("../skills/detection/tools");

const HOUSE_RULES = fs.readFileSync(path.join(__dirname, "..", "skills", "detection", "HOUSE_RULES.md"), "utf8");
const MAX_ITERATIONS = 5;

const ANSWER_TOOL = {
  type: "function",
  function: {
    name: "submit_answer",
    parameters: {
      type: "object",
      properties: {
        answer: { type: "string", description: "Direct answer to the user's question, citing specific span/service/metric evidence." },
        evidence_refs: { type: "array", items: { type: "string" }, description: "Specific values/messages that support the answer — not just tool names." },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["answer", "evidence_refs", "confidence"],
    },
  },
};

async function searchRecentTraces(serviceName, limit = 10) {
  const result = await lgtm.searchTraces(`service.name=${serviceName}`, limit);
  return (result.traces || []).map((t) => ({
    trace_id: t.traceID,
    root_service: t.rootServiceName,
    root_trace_name: t.rootTraceName,
    duration_ms: t.durationMs,
  }));
}

async function askAboutTrace(traceId, question, { maxIterations = MAX_ITERATIONS } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const ai = new OpenAI({ apiKey });

  const traceDetail = await lgtm.getTraceDetail(traceId);
  const tools = [...TOOL_DEFINITIONS, ANSWER_TOOL];

  const messages = [
    {
      role: "system",
      content:
        `You are the trace-exploration assistant. A human is looking at a specific trace and asked ` +
        `a question about it. Answer directly, citing real evidence. You already have this trace's ` +
        `full detail below — if it already answers the question, call submit_answer IMMEDIATELY, do ` +
        `not call any other tool first. Only reach for query_metric/query_logs/search_traces/ ` +
        `get_service_snapshot/get_project_profile if the question genuinely needs information beyond ` +
        `this one trace. Never invent a metric/log-label name that isn't confirmed real — if a query ` +
        `you tried came back empty, that's a signal to stop guessing metric names, not to try another ` +
        `guess. You have a LIMITED number of tool calls; never call the same tool with the same ` +
        `arguments twice. Follow these guardrails:\n\n${HOUSE_RULES}\n\nCall submit_answer to conclude.`,
    },
    { role: "user", content: `Trace detail:\n${JSON.stringify(traceDetail, null, 2)}\n\nQuestion: ${question}` },
  ];

  const ledger = [];
  const seenCalls = new Map(); // structural dedup guard, same as investigate.js
  for (let i = 0; i < maxIterations; i++) {
    const completion = await ai.chat.completions.create({
      model: process.env.DASHBOARD_MODEL || "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
    });
    const msg = completion.choices[0].message;
    messages.push(msg);
    const toolCalls = msg.tool_calls || [];

    if (!toolCalls.length) {
      messages.push({ role: "user", content: "Call submit_answer with your conclusion, or call another tool if you need more evidence." });
      continue;
    }

    const answerCall = toolCalls.find((tc) => tc.function.name === "submit_answer");
    if (answerCall) {
      for (const tc of toolCalls) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: tc.id === answerCall.id ? JSON.stringify({ acknowledged: true }) : JSON.stringify({ note: "not executed — answered in the same turn" }),
        });
      }
      return { answer: JSON.parse(answerCall.function.arguments), ledger, trace_id: traceId };
    }

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments || "{}");
      const callKey = `${tc.function.name}:${JSON.stringify(args)}`;

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
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(entry.result ?? { error: entry.error }) });
    }
  }

  return {
    answer: { answer: `Did not converge after ${maxIterations} iterations.`, evidence_refs: [], confidence: "low" },
    ledger,
    trace_id: traceId,
  };
}

module.exports = { searchRecentTraces, askAboutTrace };
