import { NextResponse } from "next/server";
import { z } from "zod";
import { Agent, run, tool, setDefaultOpenAIKey } from "@openai/agents";

// If you deploy on Vercel/Node, keep runtime on nodejs for best compatibility.
export const runtime = "nodejs";

// Ensure the SDK can read your key in server runtime.
// The SDK also auto-reads process.env.OPENAI_API_KEY on import, but this is explicit.
setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);

// Simple demo tool: returns the current time, optionally for a provided IANA TZ.
// NOTE: The Responses API requires all fields to be "required"; using .optional() alone
// is not supported. Represent optionality via nullable + default(null).
const timeNowTool = tool({
  name: "time_now",
  description: "datetime",
  parameters: z.object({
    tz: z
      .string()
      .describe("IANA timezone like 'America/New_York' or 'UTC'")
      .nullable()
      .default(null),
  }),
  execute: async ({ tz }: { tz: string | null }) => {
    try {
      const d = new Date();
      const s = new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: tz || "UTC",
      }).format(d);
      console.log("used the tool!", { time: s, tz });
      return `Now: ${s} (${tz || "UTC"})`;
    } catch {
      return `Now: ${new Date().toISOString()} (UTC)`;
    }
  },
});

// Define a single assistant agent. Keep it simple for the POC.
// You can swap model later from the request body if you want.
function createAssistant(model?: string) {
  return new Agent({
    name: "Minimal Assistant",
    instructions:
      "You are a concise helpful chat assistant. Prefer short, direct answers. Use tools only when needed.",
    // You can pass a model name here. If omitted, the SDK falls back to defaults.
    ...(model ? { model } : {}),
    tools: [timeNowTool],
  });
}

// Validate inbound request body
const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .default([]),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const { messages, model } = BodySchema.parse(json);

    // Find the latest user message. If none, return a friendly error.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || !lastUser.content?.trim()) {
      return NextResponse.json(
        { error: "No user message provided." },
        { status: 400 }
      );
    }

    const agent = createAssistant(model);

    // Run one turn. For a chat app, you can pass either:
    //  - just the latest user message (simple), or
    //  - the full conversation as input items (advanced).
    //
    // For this POC, we pass only the last user message to keep it minimal.
    const result = await run(agent, lastUser.content);

    // Extract a plain text reply.
    // The SDK's finalOutput can be a string or a structured object depending on agent config.
    const reply =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : JSON.stringify(result.finalOutput);

    // Try to surface token usage. Depending on SDK version, usage may be on result.usage
    // or on the underlying raw responses. We attempt both, and normalize the shape
    // to what your UI expects.
    console.log("result", result.rawResponses[0].usage);
    const usage = result?.rawResponses?.[0]?.usage ?? undefined;

    // Map to a stable, minimal usage object for the UI
    const normalizedUsage =
      usage && typeof usage === "object"
        ? {
            // Provide BOTH modern and legacy key names so existing UI parsers (expecting prompt_/completion_) work.
            promptTokens: usage.inputTokens ?? 0,
            completionTokens: usage.outputTokens ?? 0,
            cachedTokens: usage.inputTokensDetails?.at(0)?.cachedTokens ?? 0,
          }
        : undefined;
    console.log("Normalized usage:", normalizedUsage);

    return NextResponse.json({
      reply,
      usage: normalizedUsage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json(
      { error: message, status: 500, statusText: "Internal Server Error" },
      { status: 500 }
    );
  }
}
