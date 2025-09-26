"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOOL_DEFINITIONS,
  ToolDefinition,
  ToolParameterProperty,
} from "@/lib/default-settings";
import { useSitePasswordGate } from "@/hooks/use-site-password";

// Switch removed along with save history feature
import { Settings, Send } from "lucide-react";

function cloneToolParameterProperty(
  prop: ToolParameterProperty
): ToolParameterProperty {
  return {
    ...prop,
    enum: prop.enum ? [...prop.enum] : undefined,
  };
}

function cloneToolDefinition(def: ToolDefinition): ToolDefinition {
  const propertiesEntries = Object.entries(def.parameters.properties || {}).map(
    ([key, value]) => [key, cloneToolParameterProperty(value)] as const
  );
  const propertyKeys = propertiesEntries.map(([key]) => key);
  return {
    ...def,
    parameters: {
      ...def.parameters,
      required: propertyKeys,
      properties: Object.fromEntries(propertiesEntries),
    },
  };
}

function cloneToolDefinitions(defs: ToolDefinition[]): ToolDefinition[] {
  return defs.map((def) => cloneToolDefinition(def));
}

function validateToolDefinitionsForUI(defs: ToolDefinition[]): string | null {
  for (let i = 0; i < defs.length; i += 1) {
    const tool = defs[i];
    const label = tool.name?.trim() || `Tool ${i + 1}`;
    if (!tool.name?.trim()) {
      return `${label} needs a name.`;
    }
    if (!tool.description?.trim()) {
      return `${label} needs a description.`;
    }
    const parameters = tool.parameters;
    if (!parameters || parameters.type !== "object") {
      return `${label} is missing parameter definitions.`;
    }
    if (!parameters.properties || !Object.keys(parameters.properties).length) {
      return `${label} must have at least one parameter.`;
    }
    const properties = parameters.properties;
    const propertyKeys = Object.keys(properties);
    const requiredSet = new Set(
      parameters.required && parameters.required.length
        ? parameters.required
        : propertyKeys
    );
    if (requiredSet.size !== propertyKeys.length) {
      return `${label} must set every parameter as required.`;
    }
    for (const key of propertyKeys) {
      if (!requiredSet.has(key)) {
        return `${label}.${key} must be marked as required.`;
      }
    }
    for (const [propName, prop] of Object.entries(properties)) {
      if (!prop) {
        return `${label} has an invalid parameter: ${propName}.`;
      }
      if (!prop.type) {
        return `${label}.${propName} is missing a type.`;
      }
    }
  }
  return null;
}

// Minimal, elegant, isolated chat POC with a right-side settings panel that is always on-page
export default function ChatPOC() {
  const authorized = useSitePasswordGate();

  const [showSettings, setShowSettings] = useState(true);

  // Chat state
  type MessageItem = {
    id: string;
    role: "user" | "assistant";
    text: string;
    time: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      cachedTokens?: number;
    };
  };
  const [messages, setMessages] = useState<MessageItem[]>(() => []);

  // Composer
  const [draft, setDraft] = useState("");
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  interface UpstreamErrorDetails {
    error?: string;
    status?: number;
    statusText?: string;
    upstream?: unknown;
  }
  const [errorDetails, setErrorDetails] = useState<UpstreamErrorDetails | null>(
    null
  );
  const [userId, setUserId] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [toolDefinitions, setToolDefinitions] = useState<ToolDefinition[]>(() =>
    cloneToolDefinitions(DEFAULT_TOOL_DEFINITIONS)
  );
  const [toolValidationError, setToolValidationError] = useState<string | null>(
    validateToolDefinitionsForUI(DEFAULT_TOOL_DEFINITIONS)
  );
  const updateToolDefinition = useCallback(
    (index: number, updater: (tool: ToolDefinition) => ToolDefinition) => {
      setToolDefinitions((prev) => {
        const next = prev.map((tool, i) =>
          i === index ? updater(tool) : tool
        );
        setToolValidationError(validateToolDefinitionsForUI(next));
        return next;
      });
    },
    []
  );
  const resetToolDefinitions = useCallback(() => {
    const defaults = cloneToolDefinitions(DEFAULT_TOOL_DEFINITIONS);
    setToolDefinitions(defaults);
    setToolValidationError(validateToolDefinitionsForUI(defaults));
  }, []);
  // Removed global cumulative usage display per request

  // Save history feature removed: no local storage persistence

  const clearConversation = useCallback(() => {
    setMessages([]);
  }, []);

  // Build OpenAI style context
  const buildContext = () =>
    messages.map((m) => ({ role: m.role, content: m.text }));

  // Scrolling to bottom when messages change
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // After all hooks are declared, gate rendering by authorization
  if (!authorized) {
    return null;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || sendingRef.current) return;
    const currentToolValidation = validateToolDefinitionsForUI(toolDefinitions);
    if (currentToolValidation) {
      setToolValidationError(currentToolValidation);
      setError(
        "Tool definitions incomplete. Fix the entries in Settings before chatting."
      );
      return;
    }

    const userMsg: MessageItem = {
      id: cryptoId(),
      role: "user",
      text: draft.trim(),
      time: nowTime(),
    };
    setDraft("");
    setMessages((prev) => [...prev, userMsg]);
    setError(null);

    // Real backend call
    sendingRef.current = true;
    try {
      interface PayloadBase {
        messages: { role: string; content: string }[];
        stream?: boolean;
        userId?: string;
        systemPrompt?: string;
        toolDefinitions?: ToolDefinition[];
      }
      const base: PayloadBase = {
        messages: [...buildContext(), { role: "user", content: userMsg.text }],
        userId: userId || undefined,
      };
      const bodyPayload: PayloadBase = {
        ...base,
        systemPrompt,
        toolDefinitions,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        if (data && typeof data === "object") {
          const candidate = data as Partial<UpstreamErrorDetails>;
          setErrorDetails({
            error:
              typeof candidate.error === "string" ? candidate.error : undefined,
            status:
              typeof candidate.status === "number"
                ? candidate.status
                : undefined,
            statusText:
              typeof candidate.statusText === "string"
                ? candidate.statusText
                : undefined,
            upstream: "upstream" in candidate ? candidate.upstream : undefined,
          });
          const base =
            typeof candidate.error === "string"
              ? candidate.error
              : `Request failed (${res.status})`;
          const meta =
            candidate.statusText || candidate.status
              ? ` [${candidate.status || res.status}${
                  candidate.statusText ? " " + candidate.statusText : ""
                }]`
              : "";
          throw new Error(base + meta);
        }
        throw new Error(`Request failed (${res.status})`);
      }
      const data = await res.json();
      const replyText: string = data.reply || "(empty response)";
      // Simplified: backend now guarantees camelCase usage keys always present.
      const usageForMessage = data.usage
        ? {
            promptTokens: data.usage.promptTokens ?? 0,
            completionTokens: data.usage.completionTokens ?? 0,
            cachedTokens: data.usage.cachedTokens ?? 0,
          }
        : undefined;
      setErrorDetails(null);
      setMessages((prev) => [
        ...prev,
        {
          id: cryptoId(),
          role: "assistant",
          text: replyText,
          time: nowTime(),
          usage: usageForMessage,
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: cryptoId(),
          role: "assistant",
          text: `Error: ${msg}`,
          time: nowTime(),
        },
      ]);
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-background grid place-items-center p-6">
      <Card className="w-full max-w-5xl gap-0 pb-0">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-xl tracking-tight">Chat POC</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearConversation}
              disabled={sendingRef.current}
            >
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showSettings}
              aria-controls="settings-panel"
              onClick={() => setShowSettings((s) => !s)}
              title={showSettings ? "Hide settings" : "Show settings"}
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">Toggle settings</span>
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          <div className="flex h-[560px] md:h-[640px]">
            {/* Chat column */}
            <div
              className={`flex-1 flex flex-col ${
                showSettings ? "" : "rounded-r-xl"
              }`}
            >
              <div
                className="flex-1 overflow-y-auto p-4 space-y-4"
                aria-live="polite"
              >
                {messages.length === 0 && (
                  <div className="text-xs text-neutral-500 italic select-none">
                    No messages yet. Start the conversation.
                  </div>
                )}
                {messages.map((m) => (
                  <Message
                    key={m.id}
                    role={m.role}
                    text={m.text}
                    timestamp={m.time}
                    usage={m.usage}
                  />
                ))}
                <div ref={scrollRef} />
              </div>
              {/* Composer */}
              <div className="border-t-2 bg-card p-3">
                <form className="flex items-center gap-2" onSubmit={onSubmit}>
                  <Input
                    placeholder="Type a message…"
                    className="flex-1"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        onSubmit(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    variant="default"
                    className="bg-blue-700 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
                    disabled={!draft.trim() || sendingRef.current}
                  >
                    {sendingRef.current ? (
                      <span className="text-xs px-2">…</span>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span className="sr-only">Send</span>
                      </>
                    )}
                  </Button>
                </form>
                {error ? (
                  <div className="mt-2 space-y-1" role="alert">
                    <div className="text-xs text-red-600 font-medium">
                      {error}
                    </div>
                    {errorDetails ? (
                      <ErrorDetails
                        details={errorDetails}
                        onClear={() => setErrorDetails(null)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Right-side settings column, always on-page, not a modal */}
            <aside
              id="settings-panel"
              className={`hidden md:block w-[280px] lg:w-[320px] border-l-2 bg-card ${
                showSettings ? "" : "md:hidden"
              }`}
            >
              <SettingsPanel
                userId={userId}
                setUserId={setUserId}
                systemPrompt={systemPrompt}
                setSystemPrompt={setSystemPrompt}
                toolDefinitions={toolDefinitions}
                onToolDefinitionChange={updateToolDefinition}
                onResetTools={resetToolDefinitions}
                toolValidationError={toolValidationError}
              />
            </aside>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorDetails({
  details,
  onClear,
}: {
  details: {
    error?: string;
    status?: number;
    statusText?: string;
    upstream?: unknown;
  };
  onClear: () => void;
}) {
  // Attempt to extract known fields
  const { status, statusText, upstream } = details || {};
  const upstreamPreview =
    typeof upstream === "string" ? upstream : JSON.stringify(upstream, null, 2);
  const copy = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    } catch {}
  };
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-red-700 font-semibold">
          Upstream Error Detail
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-100"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="text-[11px] space-y-1 text-red-700">
        {status ? (
          <div>
            <span className="font-medium">Status:</span> {status}
            {statusText ? <span className="ml-1">{statusText}</span> : null}
          </div>
        ) : null}
        {upstream ? (
          <details className="group">
            <summary className="cursor-pointer select-none font-medium">
              Upstream payload
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words bg-white/60 border border-red-100 rounded p-2 text-[10px] leading-snug">
              {upstreamPreview}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function Message({
  role,
  text,
  timestamp,
  usage,
}: {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
  };
}) {
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-blue-700 text-white border-2 border-border shadow-[4px_4px_0_0_var(--ring)] dark:bg-blue-600"
            : "bg-card border-2 border-border shadow-[4px_4px_0_0_var(--ring)]"
        }`}
      >
        <div>{text}</div>
        {(timestamp || (isAssistant && usage)) && (
          <div
            className={`mt-1 text-[10px] flex flex-wrap gap-x-2 gap-y-0.5 ${
              isUser ? "text-white/80" : "text-foreground/60"
            }`}
          >
            {timestamp && <span>{timestamp}</span>}
            {isAssistant && usage && (
              <span className="flex items-center gap-1">
                {usage.promptTokens !== undefined && (
                  <span>• in: {formatTokens(usage.promptTokens)}tks</span>
                )}
                {usage.completionTokens !== undefined && (
                  <span>• out: {formatTokens(usage.completionTokens)}tks</span>
                )}
                {usage.cachedTokens !== undefined && (
                  <span>• cached: {formatTokens(usage.cachedTokens)}</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTokens(n: number) {
  try {
    return n.toLocaleString();
  } catch {
    return String(n);
  }
}

interface SettingsPanelProps {
  userId: string;
  setUserId: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  toolDefinitions: ToolDefinition[];
  onToolDefinitionChange: (
    index: number,
    updater: (tool: ToolDefinition) => ToolDefinition
  ) => void;
  onResetTools: () => void;
  toolValidationError: string | null;
}

function SettingsPanel({
  userId,
  setUserId,
  systemPrompt,
  setSystemPrompt,
  toolDefinitions,
  onToolDefinitionChange,
  onResetTools,
  toolValidationError,
}: SettingsPanelProps) {
  const toolErrorId = toolValidationError
    ? "settings-tool-definitions-error"
    : undefined;
  return (
    <div className="h-full flex flex-col">
      <div className="p-4">
        <h2 className="text-base font-semibold">Settings</h2>
      </div>
      <Separator />
      <div className="p-4 overflow-y-auto space-y-6 text-sm">
        <div className="grid gap-2">
          <Label htmlFor="settings-user-id">User ID</Label>
          <Input
            id="settings-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. user-123 or email"
          />
          <p className="text-[11px] text-muted-foreground">
            Used by the memory tools to scope reads and writes.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="settings-system-prompt">System Prompt</Label>
          <Textarea
            id="settings-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="min-h-[160px] h-[300px] text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Applied to the agent before each run. Updates take effect
            immediately.
          </p>
        </div>
        <div className="space-y-3" aria-describedby={toolErrorId}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tools</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResetTools}
            >
              Reset to defaults
            </Button>
          </div>
          {toolValidationError ? (
            <p id={toolErrorId} className="text-[11px] text-red-600">
              {toolValidationError}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Edit tool names, descriptions, or parameter copy.
            </p>
          )}
          <div className="space-y-4">
            {toolDefinitions.map((tool, toolIndex) => (
              <div
                key={`${tool.name}-${toolIndex}`}
                className="rounded-md border border-border bg-background/60 p-3 space-y-3"
              >
                <div className="grid gap-2">
                  <Label htmlFor={`tool-${toolIndex}-name`}>Tool name</Label>
                  <Input
                    id={`tool-${toolIndex}-name`}
                    value={tool.name}
                    onChange={(e) =>
                      onToolDefinitionChange(toolIndex, (current) => ({
                        ...current,
                        name: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`tool-${toolIndex}-description`}>
                    Tool description
                  </Label>
                  <Textarea
                    id={`tool-${toolIndex}-description`}
                    value={tool.description}
                    onChange={(e) =>
                      onToolDefinitionChange(toolIndex, (current) => ({
                        ...current,
                        description: e.target.value,
                      }))
                    }
                    className="min-h-[100px] text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Parameters
                  </div>
                  {(() => {
                    const propertyEntries = Object.entries(
                      tool.parameters.properties
                    );
                    const requiredSet = new Set(
                      tool.parameters.required &&
                      tool.parameters.required.length
                        ? tool.parameters.required
                        : propertyEntries.map(([propKey]) => propKey)
                    );
                    return propertyEntries.map(([propKey, propValue]) => {
                      const isRequired = requiredSet.has(propKey);
                      const enumValues = propValue.enum;
                      return (
                        <div
                          key={propKey}
                          className="rounded border border-border/60 bg-card/50 p-2 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                            <span className="uppercase tracking-wide">
                              {propKey}
                            </span>
                            <span>
                              {propValue.type}
                              {isRequired ? " • required" : ""}
                            </span>
                          </div>
                          {enumValues && enumValues.length ? (
                            <div className="text-[10px] text-muted-foreground">
                              Options: {enumValues.join(", ")}
                            </div>
                          ) : null}
                          <Textarea
                            value={propValue.description ?? ""}
                            onChange={(e) =>
                              onToolDefinitionChange(toolIndex, (current) => {
                                const nextProperty: ToolParameterProperty = {
                                  ...current.parameters.properties[propKey],
                                  description: e.target.value,
                                };
                                const nextProperties = {
                                  ...current.parameters.properties,
                                  [propKey]: nextProperty,
                                };
                                return {
                                  ...current,
                                  parameters: {
                                    ...current.parameters,
                                    properties: nextProperties,
                                    required: Object.keys(nextProperties),
                                  },
                                };
                              })
                            }
                            className="min-h-[80px] text-xs"
                          />
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Save history removed */}
      </div>
    </div>
  );
}

// Helpers
function cryptoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function nowTime() {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
