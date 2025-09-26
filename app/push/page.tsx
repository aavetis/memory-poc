"use client";

import React, { useMemo, useState } from "react";
import { Sparkles, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSitePasswordGate } from "@/hooks/use-site-password";

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function parseMarkdownish(text: string): MarkdownBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push({ type: "paragraph", text: paragraphBuffer.join(" ") });
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push({ type: "list", items: [...listBuffer] });
    listBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      listBuffer.push(line.slice(2).trim());
      continue;
    }
    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^\s)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    const [full, label, url] = match;
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={`${keyPrefix}-link-${match.index}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
      >
        {label}
      </a>
    );
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function Markdownish({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownish(text), [text]);

  return (
    <div className="space-y-3 text-sm leading-6 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={`paragraph-${index}`}>
              {renderInline(block.text, `p-${index}`)}
            </p>
          );
        }
        return (
          <ul key={`list-${index}`} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={`list-${index}-item-${itemIndex}`}>
                {renderInline(item, `li-${index}-${itemIndex}`)}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export default function PushDemoPage() {
  const authorized = useSitePasswordGate();
  const [userId, setUserId] = useState("");
  const [memories, setMemories] = useState<string[]>([]);
  const [memoriesTotal, setMemoriesTotal] = useState<number | null>(null);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);

  const [lastMemoriesUser, setLastMemoriesUser] = useState<string | null>(null);
  const [lastMessageUser, setLastMessageUser] = useState<string | null>(null);

  const disabled = !userId.trim();

  const handleFetchMemories = async () => {
    if (disabled || memoriesLoading) return;
    setMemoriesLoading(true);
    setMemoriesError(null);
    setLastMemoriesUser(null);
    try {
      const res = await fetch("/api/push/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.error === "string"
            ? data.error
            : `Failed to fetch memories (${res.status})`;
        throw new Error(message);
      }
      const data = await res.json();
      const list: string[] = Array.isArray(data?.memories) ? data.memories : [];
      setMemories(list);
      setMemoriesTotal(
        typeof data?.total === "number" ? data.total : list.length
      );
      setLastMemoriesUser(userId.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setMemoriesError(message);
      setMemories([]);
      setMemoriesTotal(null);
    } finally {
      setMemoriesLoading(false);
    }
  };

  const handleGeneratePush = async () => {
    if (disabled || messageLoading) return;
    setMessageLoading(true);
    setMessageError(null);
    setLastMessageUser(null);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.error === "string"
            ? data.error
            : `Failed to generate push (${res.status})`;
        throw new Error(message);
      }
      const data = await res.json();
      const result = typeof data?.message === "string" ? data.message : null;
      if (!result) {
        throw new Error("Push workflow completed without a message.");
      }
      setMessage(result);
      setLastMessageUser(userId.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setMessage(null);
      setMessageError(message);
    } finally {
      setMessageLoading(false);
    }
  };

  if (!authorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-8 md:p-10">
      <Card className="mx-auto flex w-full max-w-4xl flex-col min-h-[760px] md:min-h-[820px]">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Push</CardTitle>
          <p className="text-sm text-muted-foreground">
            Trigger the proactive agent workflow and peek at the user memories
            powering it.
          </p>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-1 flex-col gap-6 pt-6">
          <div className="grid gap-2">
            <Label htmlFor="user-id">User ID</Label>
            <Input
              id="user-id"
              placeholder="example@domain.com"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use the same user ID when chatting.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={handleFetchMemories}
              disabled={disabled || memoriesLoading}
              className="flex-1 sm:flex-initial"
            >
              <Database className="mr-2 h-4 w-4" />
              {memoriesLoading ? "Loading..." : "Get memories"}
            </Button>
            <Button
              onClick={handleGeneratePush}
              disabled={disabled || messageLoading}
              className="flex-1 bg-blue-700 text-white hover:bg-blue-600 sm:flex-initial"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {messageLoading ? "Running..." : "Generate push"}
            </Button>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <section className="flex h-full flex-col rounded-lg border p-4">
              <header className="flex items-center justify-between pb-2">
                <h3 className="text-sm font-medium text-foreground">
                  Recent memories
                </h3>
                {lastMemoriesUser && (
                  <span className="text-xs text-muted-foreground">
                    for {lastMemoriesUser}
                  </span>
                )}
              </header>
              <div className="mt-1 flex-1 overflow-hidden">
                <ScrollArea className="h-full pr-2">
                  <div className="space-y-3 text-sm text-foreground">
                    {memoriesError && (
                      <p className="text-xs text-red-500">{memoriesError}</p>
                    )}
                    {memoriesLoading && (
                      <p className="text-xs text-muted-foreground">
                        Retrieving…
                      </p>
                    )}
                    {!memoriesLoading &&
                      !memoriesError &&
                      memories.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Fetch memories to see the latest context captured for
                          this user.
                        </p>
                      )}
                    {!memoriesLoading &&
                      !memoriesError &&
                      memories.length > 0 && (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Showing {memories.length}
                            {typeof memoriesTotal === "number"
                              ? ` of ${memoriesTotal}`
                              : ""}
                            .
                          </p>
                          <div className="space-y-3">
                            {memories.map((memory, index) => (
                              <div
                                key={`${memory}-${index}`}
                                className="rounded-md border bg-card px-3 py-2 text-xs text-foreground"
                              >
                                {memory}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                  </div>
                </ScrollArea>
              </div>
            </section>

            <section className="flex h-full flex-col rounded-lg border p-4">
              <header className="flex items-center justify-between pb-2">
                <h3 className="text-sm font-medium text-foreground">
                  Generated push message
                </h3>
                {lastMessageUser && (
                  <span className="text-xs text-muted-foreground">
                    for {lastMessageUser}
                  </span>
                )}
              </header>
              <div className="mt-1 flex-1 overflow-hidden">
                <ScrollArea className="h-full pr-2">
                  <div className="space-y-3 text-sm text-foreground">
                    {messageError && (
                      <p className="text-xs text-red-500">{messageError}</p>
                    )}
                    {messageLoading && (
                      <p className="text-xs text-muted-foreground">
                        Generating proactive message…
                      </p>
                    )}
                    {!messageLoading && message && (
                      <Markdownish text={message} />
                    )}
                    {!messageLoading && !message && !messageError && (
                      <p className="text-xs text-muted-foreground">
                        Run the workflow to preview the proactive outreach
                        drafted for this user.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
