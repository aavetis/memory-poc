import { Agent } from "@openai/agents";

// Basic single chat agent for the application.
// Instructions kept minimal so existing simple chat UI behavior remains.
// Model can be overridden via OPENAI_MODEL env var (falls back to gpt-5-mini like prior code).

export const DEFAULT_AGENT_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";

export const chatAgent = new Agent({
  name: "Chat Assistant",
  model: DEFAULT_AGENT_MODEL,
  instructions:
    "You are a helpful AI assistant. Keep responses concise unless the user asks for depth.",
  //   modelSettings: {
  //     reasoning: { effort: "minimal" },
  //     text: { verbosity: "low" },
  //   },
});

export default chatAgent;
