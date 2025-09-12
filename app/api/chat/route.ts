// app/api/chat/route.ts
/**
 * Minimal chat route using the official OpenAI Agents SDK, non-streaming.
 * Logs each agent action and logs token usage after the model call.
 *
 * UI contract (unchanged):
 *  POST /api/chat
 *    { messages: Array<{ role: "user" | "assistant" | "system"; text?: string; content?: string }> }
 *  Response:
 *    {
 *      reply: string,
 *      usage: { promptTokens?: number, completionTokens?: number, cachedTokens?: number },
 *      events: Array<{ type: string; data: unknown }>,
 *      usageSnapshots: Array<{ index: number; input_tokens?: number; output_tokens?: number; cached_tokens?: number; total_tokens?: number }>
 *    }
 *
 * Notes:
 *  - We rely on the Agents SDK to aggregate usage for the entire run on result.usage.
 *  - We also iterate rawResponses to log per call usage snapshots.
 *  - We use extractAllTextOutput for robust message text logging.
 *
 * References:
 *  Results and newItems: https://openai.github.io/openai-agents-js/guides/results/  :contentReference[oaicite:0]{index=0}
 *  Tools guide: https://openai.github.io/openai-agents-js/guides/tools/  :contentReference[oaicite:1]{index=1}
 *  Usage fields overview, including cached tokens: https://openai.github.io/openai-agents-python/usage/  :contentReference[oaicite:2]{index=2}
 */

import { NextResponse } from "next/server";
import {
  Agent,
  run,
  tool,
  user,
  assistant as assistantMsg,
  system as systemMsg,
  extractAllTextOutput,
  type AgentInputItem,
} from "@openai/agents";
import { setDefaultOpenAIKey } from "@openai/agents-openai";
import { z } from "zod";

export const runtime = "nodejs";

// One time API key setup
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_API_KEY) setDefaultOpenAIKey(OPENAI_API_KEY);
else console.warn("[/api/chat] Missing OPENAI_API_KEY");

// Example tool for demo
const getTimeTool = tool({
  name: "get_time",
  description: "Get the current time in ISO 8601 format.",
  parameters: z.object({
    timezoneHint: z.string().describe("Human hint like 'local' or 'UTC'."),
  }),
  async execute({ timezoneHint }: { timezoneHint: string }) {
    const now = new Date().toISOString();
    const note = timezoneHint ? ` (hint: ${timezoneHint})` : "";
    return `Current time: ${now}${note}`;
  },
});

// Simple assistant agent
const chatAgent = new Agent({
  name: "Assistant",
  instructions: "You are a concise, helpful chat assistant.",
  tools: [getTimeTool],
  // model: "gpt-5-mini", // leave default provider model unless you want to force one
});

// Convert incoming messages to AgentInputItem[]
function toAgentHistory(
  msgs: Array<{ role: string; text?: string; content?: string }>
): AgentInputItem[] {
  const out: AgentInputItem[] = [];
  for (const m of msgs ?? []) {
    const content = (m.content ?? m.text ?? "").toString();
    if (!content) continue;
    if (m.role === "user") out.push(user(content));
    else if (m.role === "assistant") out.push(assistantMsg(content));
    else if (m.role === "system") out.push(systemMsg(content));
  }
  return out;
}

// Safe getter for usage fields that may be snake or camel case depending on source
function pickUsage(snapshot: any) {
  const input_tokens =
    snapshot?.input_tokens ?? snapshot?.inputTokens ?? undefined;
  const output_tokens =
    snapshot?.output_tokens ?? snapshot?.outputTokens ?? undefined;
  const total_tokens =
    snapshot?.total_tokens ??
    snapshot?.totalTokens ??
    (typeof input_tokens === "number" && typeof output_tokens === "number"
      ? input_tokens + output_tokens
      : undefined);

  // Cached tokens live in details.input_tokens_details.cached_tokens on most recent SDKs
  const cached_tokens =
    snapshot?.details?.input_tokens_details?.cached_tokens ??
    snapshot?.input_tokens_details?.cached_tokens ??
    snapshot?.inputTokensDetails?.cachedTokens ??
    snapshot?.inputTokensDetails?.[0]?.cached_tokens ??
    undefined;

  return { input_tokens, output_tokens, total_tokens, cached_tokens };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messages?: Array<{ role: string; text?: string; content?: string }>;
    };

    const history = toAgentHistory(body?.messages ?? []);
    if (history.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    // Run agent, non streaming
    const result = await run(chatAgent, history);

    // Log final output
    const finalText =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : JSON.stringify(result.finalOutput ?? "");
    console.log("[Agent] finalOutput:", finalText);

    // Log each new item with robust accessors
    for (const item of result.newItems ?? []) {
      const type = item?.constructor?.name ?? "UnknownItem";

      if (type === "RunToolCallItem") {
        const raw = (item as any)?.rawItem ?? (item as any)?.raw;
        const name = raw?.name ?? raw?.toolName ?? "(unknown_tool)";
        // arguments can be stringified JSON or object depending on provider
        const args = raw?.arguments ?? raw?.args ?? undefined;
        console.log("[Agent] Tool call:", name, args);
      } else if (type === "RunToolCallOutputItem") {
        const raw = (item as any)?.rawItem ?? (item as any)?.raw;
        const name = raw?.name ?? raw?.toolName ?? "(unknown_tool)";
        const output = raw?.output ?? (item as any)?.output ?? undefined;
        console.log("[Agent] Tool result:", name, output);
      } else if (type === "RunMessageOutputItem") {
        // Use helper to extract text consistently
        const [text] = extractAllTextOutput([item]) ?? [undefined];
        console.log("[Agent] Message:", text ?? "(no text)");
      } else {
        // Reasoning, approvals, handoffs, unknown
        console.log("[Agent] Item:", type, JSON.stringify(item));
      }
    }

    // Per call usage snapshots from rawResponses
    const usageSnapshots: Array<{
      index: number;
      input_tokens?: number;
      output_tokens?: number;
      cached_tokens?: number;
      total_tokens?: number;
    }> = [];

    for (const [i, resp] of (result.rawResponses ?? []).entries()) {
      // Responses API tends to put usage at top level
      const rawUsage =
        (resp as any)?.usage ?? (resp as any)?.response?.usage ?? {};
      const { input_tokens, output_tokens, total_tokens, cached_tokens } =
        pickUsage(rawUsage);
      const snap = {
        index: i,
        input_tokens,
        output_tokens,
        cached_tokens,
        total_tokens,
      };
      usageSnapshots.push(snap);
      console.log("[Agent] Usage snapshot", snap);
    }

    // Simple final usage: just take the last snapshot (it already has combined totals)
    const finalUsage = usageSnapshots[usageSnapshots.length - 1];
    console.log("[Agent] Total usage after this run", {
      input_tokens: finalUsage?.input_tokens,
      output_tokens: finalUsage?.output_tokens,
      cached_tokens: finalUsage?.cached_tokens,
      total_tokens: finalUsage?.total_tokens,
    });

    // Emit compact events for the UI console if desired
    const events = (result.newItems ?? []).map((it: any) => {
      const t = it?.constructor?.name ?? "UnknownItem";
      if (t === "RunToolCallItem") {
        const raw = it?.rawItem ?? it?.raw;
        return {
          type: t,
          data: {
            toolName: raw?.name ?? raw?.toolName,
            arguments: raw?.arguments,
          },
        };
      }
      if (t === "RunToolCallOutputItem") {
        const raw = it?.rawItem ?? it?.raw;
        return {
          type: t,
          data: {
            toolName: raw?.name ?? raw?.toolName,
            output: raw?.output ?? it?.output,
          },
        };
      }
      if (t === "RunMessageOutputItem") {
        const [text] = extractAllTextOutput([it]) ?? [undefined];
        return { type: t, data: { content: text } };
      }
      return { type: t, data: it };
    });

    const reply = finalText;

    return NextResponse.json({
      reply,
      usage: finalUsage
        ? {
            promptTokens: finalUsage.input_tokens,
            completionTokens: finalUsage.output_tokens,
            cachedTokens: finalUsage.cached_tokens,
            totalTokens: finalUsage.total_tokens,
          }
        : {},
      events,
      usageSnapshots,
    });
  } catch (err: unknown) {
    console.error("[/api/chat] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json(
      { error: message, status: 500, statusText: "Internal Server Error" },
      { status: 500 }
    );
  }
}
