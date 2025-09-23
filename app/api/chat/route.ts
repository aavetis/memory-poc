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
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOOL_DEFINITIONS,
  ToolDefinition,
  ToolParameterProperty,
  ToolParameterSchema,
} from "@/lib/default-settings";
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

type ToolExecutor = (
  input: Record<string, unknown>,
  context: unknown
) => Promise<string> | string;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  add_memory: async (input, context) => {
    try {
      const userId = (context as any)?.context?.userId;
      if (!userId)
        return "No userId provided; open settings and set a user id.";
      const mem0 = getMem0();
      const text = String(input.text ?? "");
      if (!text.trim()) {
        return "Cannot add empty memory.";
      }
      // Queue the write and return immediately so we don't block the agent
      const write = async () => {
        try {
          await mem0.add([{ role: "user", content: text }], {
            user_id: userId,
          });
        } catch (e: any) {
          console.error("Async memory write failed:", e?.message || e);
        }
      };
      if (typeof setImmediate === "function") setImmediate(write);
      else Promise.resolve().then(write);
      return JSON.stringify({ ok: true, queued: true }, null, 2);
    } catch (err: any) {
      return `Failed to add memory: ${err?.message || String(err)}`;
    }
  },
  search_memories: async (input, context) => {
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

      const limit = typeof input.limit === "number" ? input.limit : undefined;
      const limited = limit ? items.slice(0, limit) : items;
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
};

function buildToolParameters(schema: ToolParameterSchema) {
  if (schema.type !== "object") {
    throw new Error("Tool parameter schema must be an object");
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const zodType = buildZodForProperty(prop);
    shape[key] = zodType;
  }
  const base = z.object(shape);
  return schema.description ? base.describe(schema.description) : base;
}

function buildZodForProperty(prop: ToolParameterProperty) {
  let base: z.ZodTypeAny;
  switch (prop.type) {
    case "string": {
      if (prop.enum && prop.enum.length) {
        base = z.enum(prop.enum as [string, ...string[]]);
        break;
      }
      let schema = z.string();
      if (typeof prop.minLength === "number") {
        schema = schema.min(prop.minLength);
      }
      if (typeof prop.maxLength === "number") {
        schema = schema.max(prop.maxLength);
      }
      base = schema;
      break;
    }
    case "integer": {
      let schema = z.number().int();
      if (typeof prop.minimum === "number") {
        schema = schema.min(prop.minimum);
      }
      if (typeof prop.maximum === "number") {
        schema = schema.max(prop.maximum);
      }
      base = schema;
      break;
    }
    case "number": {
      let schema = z.number();
      if (typeof prop.minimum === "number") {
        schema = schema.min(prop.minimum);
      }
      if (typeof prop.maximum === "number") {
        schema = schema.max(prop.maximum);
      }
      base = schema;
      break;
    }
    case "boolean":
      base = z.boolean();
      break;
    default:
      throw new Error(`Unsupported parameter type: ${String(prop.type)}`);
  }
  if (prop.description) {
    base = base.describe(prop.description);
  }
  return base;
}

function buildTools(definitions: ToolDefinition[]) {
  return definitions.map((definition, index) => {
    const executor = TOOL_EXECUTORS[definition.name];
    if (!executor) {
      throw new Error(
        `Unsupported tool name at index ${index}: ${definition.name}`
      );
    }
    const parameters = buildToolParameters(definition.parameters);
    return tool({
      name: definition.name,
      description: definition.description,
      parameters,
      execute: executor,
    });
  });
}

function normalizeToolDefinitions(input: unknown): ToolDefinition[] {
  if (!Array.isArray(input)) {
    throw new Error("Tool definitions must be an array.");
  }

  return input.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Tool definition at index ${index} must be an object.`);
    }
    const candidate = item as Record<string, unknown>;
    const name = candidate.name;
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        `Tool definition at index ${index} is missing a valid name.`
      );
    }
    const description = candidate.description;
    if (typeof description !== "string" || !description.trim()) {
      throw new Error(
        `Tool definition for ${name} is missing a valid description.`
      );
    }

    const parameters = candidate.parameters;
    if (!parameters || typeof parameters !== "object") {
      throw new Error(`Tool definition for ${name} is missing parameters.`);
    }
    const paramSchema = parameters as ToolParameterSchema;
    if (paramSchema.type !== "object") {
      throw new Error(`Tool definition for ${name} must use an object schema.`);
    }

    const strict = candidate.strict;
    const rawProperties = paramSchema.properties || {};
    const clonedProperties: Record<string, ToolParameterProperty> = {};
    for (const [propKey, propValue] of Object.entries(rawProperties)) {
      if (!propValue || typeof propValue !== "object") {
        throw new Error(
          `Tool definition for ${name} has an invalid parameter: ${propKey}.`
        );
      }
      clonedProperties[propKey] = {
        ...propValue,
        enum: propValue.enum ? [...propValue.enum] : undefined,
      };
    }
    const propertyKeys = Object.keys(clonedProperties);
    if (propertyKeys.length === 0) {
      throw new Error(
        `Tool definition for ${name} must include at least one parameter.`
      );
    }

    return {
      name,
      description,
      parameters: {
        ...paramSchema,
        properties: clonedProperties,
        required: propertyKeys,
      },
      strict: typeof strict === "boolean" ? strict : undefined,
    };
  });
}

// POST /api/chat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const userId =
      typeof body?.userId === "string" && body.userId ? body.userId : undefined;

    const systemPrompt =
      typeof body?.systemPrompt === "string" && body.systemPrompt.trim()
        ? String(body.systemPrompt)
        : DEFAULT_SYSTEM_PROMPT;

    let toolDefinitions = DEFAULT_TOOL_DEFINITIONS;
    if (body?.toolDefinitions !== undefined) {
      try {
        toolDefinitions = normalizeToolDefinitions(body.toolDefinitions);
      } catch (parseErr: any) {
        const message = parseErr?.message || "Invalid tool definitions";
        return NextResponse.json(
          {
            error: message,
            status: 400,
            statusText: "Bad Request",
          },
          { status: 400 }
        );
      }
    }

    let toolsInstance;
    try {
      toolsInstance = buildTools(toolDefinitions);
    } catch (toolErr: any) {
      const message = toolErr?.message || "Failed to build tools";
      return NextResponse.json(
        {
          error: message,
          status: 400,
          statusText: "Bad Request",
        },
        { status: 400 }
      );
    }

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
        const contextUserId = (context as any)?.userId;
        const base = systemPrompt.trim();
        if (contextUserId) {
          return `${base}\n\nActive user id: ${contextUserId}`;
        }
        return base;
      },
      tools: toolsInstance,
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
