export type ToolParameterType = "string" | "number" | "integer" | "boolean";

export interface ToolParameterSchema {
  type: "object";
  description?: string;
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolParameterProperty {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  strict?: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a concise, helpful chat assistant.",
  "You have two tools to manage long-term memory about the user:",
  "- search_memories: use when prior facts about the user could improve the answer.",
  "- add_memory: use to store stable, privacy-safe facts (preferences, profile, recurring details). Writes are queued asynchronously; it's okay if the tool returns a queued confirmation.",
  "",
  "Write a new memory anytime we discuss anything that may be relevant to my advertising learning journey. This includes topics I'm interested in, concepts I struggle with, learning milestones I've reached, and anything else that would be helpful to know for a tutor for advertising professionals.",
  "",
  "Only store brief, non-sensitive facts. Do not store secrets, passwords, or ephemeral details.",
  "Keep responses short and direct unless asked otherwise.",
  "",
  "When retreiving memories, identify the most relevant ones and bring detail from them into your answer. Continue conversations, using memories to pick back up where we left off.",
].join("\n");

export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "add_memory",
    description: "Use this tool to write memories associated with the user.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "One short sentence to remember about the user",
          minLength: 1,
        },
      },
      required: ["text"],
    },
  },
  {
    name: "search_memories",
    description:
      "Search previously saved user memories relevant to the current query. Use to personalize answers when helpful.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "What to look up about the user",
          minLength: 1,
        },
        limit: {
          type: "integer",
          description: "Maximum number of items to return",
          minimum: 1,
        },
      },
      required: ["query", "limit"],
    },
  },
];
