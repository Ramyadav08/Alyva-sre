// General-purpose ops chatbot — persistent conversation, broad real tool
// registry (Detection's read-only tools + real observability primitives +
// dashboard-panel creation). Answers free-form questions like "top 10 CPU
// containers" or "what recently failed", and can build a new dashboard
// panel directly when explicitly asked in chat (an explicit chat request
// IS the human approval — no separate confirm click needed, unlike the
// scheduled/autonomous paths elsewhere in this repo).
//
// Same read-only guarantee as every other skill: no mute/disable/write
// capability exists in this tool registry either.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const store = require("../shared/store");
const lgtm = require("../lgtm");
const { TOOL_DEFINITIONS: DETECTION_TOOLS, executeTool: executeDetectionTool } = require("../skills/detection/tools");
const obs = require("./observability");
const customPanel = require("./customPanel");

const HOUSE_RULES = fs.readFileSync(path.join(__dirname, "..", "skills", "detection", "HOUSE_RULES.md"), "utf8");
const MAX_ITERATIONS = 6;

const OBSERVABILITY_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_top_containers_by_cpu",
      description: "Real top-N containers by CPU utilization (this environment is Docker Compose, not Kubernetes — 'container' is the real equivalent of 'pod' here).",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_containers_by_memory",
      description: "Real top-N containers by memory percent.",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recently_unhealthy",
      description: "Real signals for 'what recently failed' — scrape targets reporting down (up==0), and services with error rate > 5% in the last 5 minutes. There is no pod-restart-count metric in this environment; never claim one.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_traces_across_services",
      description: "Recent traces sampled across multiple services (not just one).",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_error_logs",
      description: "Recent real ERROR-level log lines across all services.",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "create_dashboard_panel",
      description: "Creates and immediately keeps a new dashboard panel — only call this when the user explicitly asked to build/add/create a panel or dashboard. The category and service_name must be real (validated against real discovery).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: ["trace_latency_p99", "trace_error_rate", "log_error_rate", "call_rate"] },
          service_name: { type: "string" },
          chart_type: { type: "string", enum: ["stat", "timeseries"] },
        },
        required: ["title", "category", "service_name", "chart_type"],
      },
    },
  },
];

const TOOLS = [...DETECTION_TOOLS, ...OBSERVABILITY_TOOLS];

const OBSERVABILITY_EXECUTORS = {
  get_top_containers_by_cpu: ({ limit }) => obs.topContainersByCpu(limit || 10),
  get_top_containers_by_memory: ({ limit }) => obs.topContainersByMemory(limit || 10),
  get_recently_unhealthy: () => obs.recentlyUnhealthy(),
  get_recent_traces_across_services: ({ limit }) => obs.recentTracesAcrossServices(limit || 10),
  get_recent_error_logs: ({ limit }) => obs.recentErrorLogs(limit || 10),
  async create_dashboard_panel({ title, category, service_name, chart_type }) {
    const discovered = await lgtm.discoverServices();
    if (!discovered.some((s) => s.service_name === service_name)) {
      return { error: `"${service_name}" is not a real discovered service.` };
    }
    const spec = { title, category, service_name, chart_type };
    const data = await customPanel.executePanelSpec(spec);
    if (data.kind === "error") return { error: data.error };
    const layout = customPanel.keepPanel(spec);
    return { kept: true, panel_id: layout[layout.length - 1].id, preview: data };
  },
};

async function executeTool(name, args) {
  if (OBSERVABILITY_EXECUTORS[name]) return OBSERVABILITY_EXECUTORS[name](args);
  return executeDetectionTool(name, args);
}

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey });
}

function loadConversation() {
  return store.load("chatbot-messages", [
    {
      role: "system",
      content:
        `You are the ops chatbot for an AI-native SRE platform. Answer questions about real ` +
        `metrics/traces/logs/containers using your tools — never invent a number or claim a ` +
        `signal that doesn't exist (e.g. there is no pod-restart-count metric here, only ` +
        `up==0 scrape gaps and error-rate spikes — say so if asked about restarts specifically). ` +
        `If asked to build/add a dashboard panel, call create_dashboard_panel directly — the user ` +
        `asking in chat IS their approval, don't ask again. Cite specific real values in your ` +
        `answers. Never call the same tool with the same arguments twice in one turn.\n\n${HOUSE_RULES}`,
    },
  ]);
}

async function sendMessage(userMessage) {
  const ai = client();
  const messages = loadConversation();
  messages.push({ role: "user", content: userMessage });

  const seenCalls = new Map();
  const ledger = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const completion = await ai.chat.completions.create({
      model: process.env.DASHBOARD_MODEL || "gpt-4o-mini",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });
    const msg = completion.choices[0].message;
    messages.push(msg);
    const toolCalls = msg.tool_calls || [];

    if (!toolCalls.length) {
      store.save("chatbot-messages", messages);
      return { reply: msg.content, ledger };
    }

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments || "{}");
      const callKey = `${tc.function.name}:${JSON.stringify(args)}`;
      if (seenCalls.has(callKey)) {
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ note: "already called with these arguments this turn" }) });
        continue;
      }
      const entry = { tool: tc.function.name, args, at: new Date().toISOString() };
      try {
        entry.result = await executeTool(tc.function.name, args);
      } catch (err) {
        entry.error = err.message;
      }
      ledger.push(entry);
      seenCalls.set(callKey, true);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(entry.result ?? { error: entry.error }) });
    }
  }

  store.save("chatbot-messages", messages);
  return { reply: `Ran out of tool-use budget (${MAX_ITERATIONS} calls) before finishing — try a more specific question.`, ledger };
}

function getConversation() {
  return loadConversation().filter((m) => m.role !== "system" && m.role !== "tool" && !m.tool_calls);
}

function resetConversation() {
  store.save("chatbot-messages", loadConversation().slice(0, 1));
}

module.exports = { sendMessage, getConversation, resetConversation };
