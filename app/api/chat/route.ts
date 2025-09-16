// Force Node.js runtime (mem0 + Agents SDK require Node environment)
/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  Agent,
  run,
  tool,
  user as userMsg,
  assistant as assistantMsg,
} from "@openai/agents";
import MemoryClient from "mem0ai";

// Simple singleton for Mem0 client
let mem0Client: any;
function getMem0() {
  if (!mem0Client) {
    const apiKey = process.env.MEM0_API_KEY || "";
    mem0Client = new MemoryClient({ apiKey });
  }
  return mem0Client;
}

// Tools: add_memory, search_memories
const addMemoryTool = tool({
  name: "add_memory",
  description: "Use this tool to write memories associated with the user.",
  parameters: z.object({
    text: z
      .string()
      .min(1)
      .describe("One short sentence to remember about the user"),
  }),
  strict: true,
  execute: async (input, context) => {
    try {
      const userId = (context as any)?.context?.userId;
      if (!userId)
        return "No userId provided; open settings and set a user id.";
      const mem0 = getMem0();
      // Queue the write and return immediately so we don't block the agent
      const text = String(input.text);
      const write = async () => {
        try {
          // Store as a single-message array; let Mem0 infer memories by default
          await mem0.add(
            [{ role: "user", content: text }],
            {
              user_id: userId,
            }
          );
        } catch (e: any) {
          console.error("Async memory write failed:", e?.message || e);
        }
      };
      // Detach the task; do not await (best-effort fire-and-forget)
      if (typeof setImmediate === "function") setImmediate(write);
      else Promise.resolve().then(write);
      return JSON.stringify({ ok: true, queued: true }, null, 2);
    } catch (err: any) {
      return `Failed to add memory: ${err?.message || String(err)}`;
    }
  },
});

const searchMemoriesTool = tool({
  name: "search_memories",
  description:
    "Search previously saved user memories relevant to the current query. Use to personalize answers when helpful.",
  parameters: z.object({
    query: z.string().min(1).describe("What to look up about the user"),
    limit: z.number().int().positive().describe("Optional max items"),
  }),
  strict: true,
  execute: async (input, context) => {
    try {
      const userId = (context as any)?.context?.userId;
      if (!userId)
        return "No userId provided; open settings and set a user id.";
      const mem0 = getMem0();
      const res = await mem0.search(String(input.query), { user_id: userId });
      // Normalize across API shapes (array vs. object wrappers)
      const raw = res as any;
      let items: any[] = [];
      if (Array.isArray(raw)) items = raw;
      else if (Array.isArray(raw?.results)) items = raw.results;
      else if (Array.isArray(raw?.memories)) items = raw.memories;
      else if (Array.isArray(raw?.data)) items = raw.data;

      const limited = input.limit ? items.slice(0, input.limit) : items;
      const summaries = limited.map(
        (m: any) =>
          m?.memory ??
          m?.data?.memory ??
          m?.text ??
          m?.content ??
          (typeof m === "string" ? m : JSON.stringify(m))
      );
      return JSON.stringify(
        { ok: true, count: items.length, memories: summaries },
        null,
        2
      );
    } catch (err: any) {
      return `Failed to search memories: ${err?.message || String(err)}`;
    }
  },
});

// POST /api/chat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const userId =
      typeof body?.userId === "string" && body.userId ? body.userId : undefined;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY",
          status: 500,
          statusText: "Server Misconfigured",
        },
        { status: 500 }
      );
    }
    if (!process.env.MEM0_API_KEY) {
      // Not fatal for chat, but tools will inform the model on usage; still surface a warning
      // Keeping non-blocking per POC requirement
    }

    // Build agent with tools and instructions
    const DEFAULT_MODEL = process.env.NEXT_PUBLIC_DEFAULT_MODEL || "gpt-5-mini";
    const agent = new Agent({
      name: "Chat Assistant",
      model: DEFAULT_MODEL,
      instructions: ({ context }) => {
        const userId = (context as any)?.userId;
        return `You are a concise, helpful chat assistant.
        You have two tools to manage long-term memory about the user:
        - search_memories: use when prior facts about the user could improve the answer.
        - add_memory: use to store stable, privacy-safe facts (preferences, profile, recurring details). Writes are queued asynchronously; it's okay if the tool returns a queued confirmation.

        Write a new memory anytime we discuss anything that may be relevant to my advertising learning journey. This includes topics I'm interested in, concepts I struggle with, learning milestones I've reached, and anything else that would be helpful to know for a tutor for advertising professionals.

        Only store brief, non-sensitive facts. Do not store secrets, passwords, or ephemeral details.
        Keep responses short and direct unless asked otherwise.

        When retreiving memories, identify the most relevant ones and bring detail from them into your answer. Continue conversations, using memories to pick back up where we left off.
        ${userId ? `\nActive user id: ${userId}` : ""}`;
      },
      tools: [searchMemoriesTool, addMemoryTool],
      modelSettings: {
        providerData: {
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
        },
      },
    });

    // Translate UI messages to Agents SDK items
    const history = messages
      .filter(
        (m: any) =>
          m && typeof m.role === "string" && typeof m.content === "string"
      )
      .map((m: any) => {
        if (m.role === "assistant") return assistantMsg(m.content);
        // treat anything else as user for our POC purposes
        return userMsg(m.content);
      });

    // Run the agent
    const result = await run(agent, history, {
      context: { userId },
      maxTurns: 8,
    });

    // Final text output
    const reply = (result?.finalOutput as any) || "";

    // Aggregate usage across raw responses
    let promptTokens = 0;
    let completionTokens = 0;
    (result?.rawResponses || []).forEach((r: any) => {
      if (r?.usage) {
        promptTokens += Number(r.usage.inputTokens || 0);
        completionTokens += Number(r.usage.outputTokens || 0);
      }
    });

    return NextResponse.json({
      reply,
      usage: {
        promptTokens,
        completionTokens,
        cachedTokens: 0,
      },
    });
  } catch (err: any) {
    const status = 500;
    const statusText = "Internal Error";
    return NextResponse.json(
      {
        error: err?.message || "Unknown error",
        status,
        statusText,
        upstream: String(err),
      },
      { status }
    );
  }
}
