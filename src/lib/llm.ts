/**
 * Thin, provider-agnostic reasoning-layer interface. Implemented today
 * against OpenAI (the key issued for this hackathon); kept behind this
 * interface so swapping providers later — e.g. to Anthropic, matching the
 * real platform's own @anthropic-ai/sdk pattern — is a one-file change.
 *
 * This is the load-bearing mechanism the AI-native gate checks for: every
 * skill (onboarding, alerting) reasons by calling `chat()` with real tools
 * bound to real LGTM queries and real Proposal/Question writes. Delete
 * this file's caller and the product has nothing left — no discovery, no
 * rule proposals, no self-correction. That's the intended shape.
 */
import OpenAI from "openai";

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
};

export interface LLMClient {
  chat(args: { messages: ChatMessage[]; tools?: ToolDefinition[] }): Promise<ChatResult>;
}

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set — the reasoning layer cannot run without it. " +
          "Set it in .env.local (see README).",
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  async chat({ messages, tools }: { messages: ChatMessage[]; tools?: ToolDefinition[] }): Promise<ChatResult> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })) as any,
      tools: tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
    }));

    return { content: choice.message.content ?? null, toolCalls };
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

let sharedClient: LLMClient | null = null;

/** Lazily-constructed singleton so a missing key doesn't crash module import. */
export function getLLMClient(): LLMClient {
  if (!sharedClient) sharedClient = new OpenAIClient();
  return sharedClient;
}
