"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
// Switch removed along with save history feature
import { Settings, Send } from "lucide-react";

// Minimal, elegant, isolated chat POC with a right-side settings panel that is always on-page
export default function ChatPOC() {
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || sendingRef.current) return;

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
      }
      const base: PayloadBase = {
        messages: [...buildContext(), { role: "user", content: userMsg.text }],
        userId: userId || undefined,
      };
      const bodyPayload: PayloadBase = base; // no temperature field
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
      <Card className="w-full max-w-5xl shadow-lg gap-0 pb-0">
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
              variant="ghost"
              size="icon"
              className="hover:bg-neutral-100"
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
              <div className="border-t bg-white p-3">
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
              className={`hidden md:block w-[360px] lg:w-[400px] border-l bg-white ${
                showSettings ? "" : "md:hidden"
              }`}
            >
              <SettingsPanel userId={userId} setUserId={setUserId} />
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
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
          isUser ? "bg-black text-white" : "bg-white border border-neutral-200"
        }`}
      >
        <div>{text}</div>
        {(timestamp || (isAssistant && usage)) && (
          <div
            className={`mt-1 text-[10px] opacity-60 flex flex-wrap gap-x-2 gap-y-0.5 ${
              isUser ? "text-white" : "text-neutral-600"
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
}

function SettingsPanel({ userId, setUserId }: SettingsPanelProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="p-4">
        <h2 className="text-base font-semibold">Settings</h2>
      </div>
      <Separator />
      <div className="p-4 overflow-y-auto space-y-6 text-sm">
        <div className="grid gap-2">
          <Label>User ID</Label>
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. user-123 or email"
          />
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
