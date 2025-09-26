export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  Agent,
  webSearchTool,
  run,
  tool,
  user as userMsg,
} from "@openai/agents";

import MemoryClient from "mem0ai";

// ---------- Env & Clients ----------
function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const MEM0_API_KEY = getEnv("MEM0_API_KEY");

let mem0Client: any;
function mem0() {
  if (!mem0Client) mem0Client = new MemoryClient({ apiKey: MEM0_API_KEY });
  return mem0Client;
}

// ---------- Tool: search_memories ----------
const searchMemoriesParams = z.object({
  query: z
    .string()
    .describe(
      "Free text to search user memories. Include topics, strengths, struggles, goals, and any terms that help find the next best learning nudge."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe("Maximum number of memory items to return, default 10."),
});

const searchMemoriesTool = tool({
  name: "search_memories",
  description:
    "Search the user's stored memories to retrieve relevant items about prior topics, strengths, and struggles.",
  parameters: searchMemoriesParams,
  execute: async (input, context) => {
    const userId = (context as any)?.context?.userId;
    if (!userId)
      return JSON.stringify({ ok: false, error: "No userId in context." });
    try {
      const res = await mem0().search(input.query, { user_id: userId });
      const raw = res as any;
      let items: any[] = [];
      if (Array.isArray(raw)) items = raw;
      else if (Array.isArray(raw?.results)) items = raw.results;
      else if (Array.isArray(raw?.memories)) items = raw.memories;
      else if (Array.isArray(raw?.data)) items = raw.data;

      const limited = items.slice(0, input.limit);
      const normalized = limited.map(
        (m: any) =>
          m?.memory ??
          m?.data?.memory ??
          m?.text ??
          m?.content ??
          (typeof m === "string" ? m : JSON.stringify(m))
      );
      return JSON.stringify({
        ok: true,
        count: items.length,
        memories: normalized,
      });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e?.message || String(e) });
    }
  },
});

// ---------- Output contract ----------
const DraftOutput = z.object({
  finalMessage: z
    .string()
    .describe(
      "The concise, user-ready message. A few short paragraphs total. Friendly, actionable, and personalized."
    ),
});
type DraftOutput = z.infer<typeof DraftOutput>;

// ---------- Agent ----------
const SYSTEM_INSTRUCTIONS = `
You are a proactive learning assistant that drafts short, personalized nudges.
Follow this exact three-step routine for every run. You have tools to help.

Step 1, Memories: call search_memories with a broad but relevant query. Pull what the user studied, what they did well, where they struggled, and any goals.
Step 2, Web: call the Web Search tool to find 2 to 5 high quality, recent resources that match the user's current topic or pain point. Prefer summaries, tutorials, and actionable references. Avoid fluff and paywalls when possible.
Step 3, Synthesize: write a concise message, 2 to 5 short paragraphs total. Personalize it using the memories and signal the next best action. Format the message as:
  - Short intro paragraph tying past progress to the next focus.
  - "Helpful reads:" on its own line followed by 2 to 4 markdown bullets like "- [Title](https://example.com) — reason".

Style: warm, direct, specific. No marketing tone. No long preambles. Keep it human. Always embed resource URLs using markdown link syntax (e.g., [Title](https://example.com)). Keep blurbs tight (5-10 words) and actionable. Contextually understand the fact that you are sending a proactive message to a user you haven't talked to in a little while. No need to address that explicitly, but do make the message feel like a natural next step in their learning journey.

CRITICAL: Do NOT use any special citation or footnote characters.

Examples to mirror:
---
Example 1:
Hey (user, if we know their name). Last time, you mapped basic SEO keywords and wrote first title tags. Good start. Next, cluster those terms and build one primary page per cluster.
Helpful reads:
- [Keyword clustering quickstart](https://example.com/keyword-clustering) — short rules to group terms
- [On-page checklist](https://example.com/on-page-checklist) — headers, internals, intent
Do this: pick one cluster, write a simple outline with H1, three H2s, and one internal link plan.
---
Example 2:
Hi! How are things progressing? In our last session, you practiced email subject lines and preview text. Solid reps. Next, set up a tiny A/B loop that tests one variable at a time.
Helpful reads:
- [Subject line patterns](https://example.com/subject-line-patterns) — 12 templates to remix
- [A/B test guardrails](https://example.com/ab-test-guardrails) — sample size basics
Do this: draft two subjects, identical body, send to a 10 percent slice, record open rate and top click.

Output only the finalMessage field per the schema.
`;

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId =
      typeof body?.userId === "string" && body.userId ? body.userId : undefined;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId in request body." },
        { status: 400 }
      );
    }

    // Optional seed topic from caller. If omitted, the agent will infer from memories.
    const topicSeed: string | undefined =
      typeof body?.topic === "string" && body.topic.trim()
        ? body.topic.trim()
        : undefined;

    const agent = new Agent({
      name: "LearningNudgeAgent",
      model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "gpt-5-nano",
      instructions: SYSTEM_INSTRUCTIONS,
      tools: [
        searchMemoriesTool,
        webSearchTool(), // built-in tool from Agents SDK
      ],
      outputType: DraftOutput,
      modelSettings: {
        toolChoice: "auto",
        providerData: {
          reasoning: { effort: "low" },
          text: { verbosity: "low" },
        },
      },
    });

    // Seed message gives minimal context. Agent must call tools and then return finalMessage.
    const userSeed = topicSeed
      ? `User context: ${userId}. Topic to focus on: "${topicSeed}". Draft a proactive nudge now.`
      : `User context: ${userId}. No explicit topic provided. Use memories to infer the most timely and helpful topic, then draft a proactive nudge.`;

    const result = await run(agent, [userMsg(userSeed)], {
      context: { userId },
      maxTurns: 10,
    });

    // result.finalOutput is validated by zod via outputType
    const data = result?.finalOutput as DraftOutput | undefined;
    if (!data?.finalMessage) {
      // Fallback, return raw text if present
      const fallback =
        typeof result?.finalOutput === "string"
          ? String(result.finalOutput)
          : "";
      return NextResponse.json(
        { message: fallback || "No message produced." },
        { status: fallback ? 200 : 500 }
      );
    }

    // Only return the message body, nothing else
    return NextResponse.json({ message: data.finalMessage });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err?.message || "Unknown error",
        status: 500,
        statusText: "Internal Error",
      },
      { status: 500 }
    );
  }
}
