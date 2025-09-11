import { NextRequest } from "next/server";

// NOTE: Lightweight manual validation to avoid pulling in zod on edge; could swap later.

// Simple chat backend calling OpenAI API (non-streaming)
// Expects POST JSON: { messages: { role: 'user'|'assistant'|'system', content: string }[] }
// Returns { reply: string, model: string, usage?: any, error?: string }

export const runtime = "edge"; // Use edge for lower latency (optional)

type Role = "user" | "assistant" | "system";
interface ChatMessage {
  role: Role;
  content: string;
}

interface IncomingBody {
  messages: { role: Role; content: unknown }[];
  model?: unknown;
  systemPrompt?: unknown;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const DEBUG = (process.env.CHAT_DEBUG || "").toLowerCase() === "true";

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY env var." }),
        { status: 500 }
      );
    }

    const body: IncomingBody | null = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid body. Expect { messages: ChatMessage[] }",
        }),
        { status: 400 }
      );
    }
    // Validate & sanitize messages
    const cleaned: ChatMessage[] = [];
    const isRole = (r: unknown): r is Role =>
      r === "user" || r === "assistant" || r === "system";
    for (const raw of body.messages) {
      if (!raw || typeof raw !== "object") continue;
      const maybeRole = (raw as { role?: unknown }).role;
      const maybeContent = (raw as { content?: unknown }).content;
      if (!isRole(maybeRole)) continue;
      if (typeof maybeContent !== "string") continue;
      cleaned.push({ role: maybeRole, content: maybeContent });
    }
    if (!cleaned.length) {
      return new Response(
        JSON.stringify({ error: "No valid messages provided." }),
        { status: 400 }
      );
    }
    let messages = cleaned; // No turn limit (POC mode)

    // Optional system prompt injection
    if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) {
      messages = [
        { role: "system", content: body.systemPrompt.trim() },
        ...messages,
      ];
    }

    // Model override (trust caller minimally — fallback to default)
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;

    // Log basic request summary (non-sensitive)
    console.log("[chat] request", {
      model,
      messagesCount: messages.length,
      systemPrompt:
        typeof body.systemPrompt === "string" && body.systemPrompt.trim()
          ? "yes"
          : "no",
    });

    // Call OpenAI Chat Completions API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        reasoning_effort: "minimal",
        verbosity: "low",
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      console.error("[chat] upstream failure", {
        status: response.status,
        statusText: response.statusText,
        body: raw.slice(0, 500),
      });
      return new Response(
        JSON.stringify({
          error: "Upstream error",
          status: response.status,
          statusText: response.statusText,
          upstream: parsed ?? raw,
        }),
        { status: 502 }
      );
    }

    interface OpenAIChoice {
      message?: { role?: string; content?: string };
    }
    interface OpenAIResp {
      choices?: OpenAIChoice[];
      model?: string;
      usage?: unknown;
    }
    const data: OpenAIResp = await response.json();
    const reply: string = data.choices?.[0]?.message?.content ?? "";

    if (DEBUG) console.log("[chat] usage", data?.usage);
    return new Response(
      JSON.stringify({
        reply,
        model: data.model || model,
        usage: data.usage,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (DEBUG) console.error("[chat] error", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
