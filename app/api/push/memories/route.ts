export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import MemoryClient from "mem0ai";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const MEM0_API_KEY = getEnv("MEM0_API_KEY");

let mem0Client: any;
function getMem0() {
  if (!mem0Client) {
    mem0Client = new MemoryClient({ apiKey: MEM0_API_KEY });
  }
  return mem0Client;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId =
      typeof body?.userId === "string" && body.userId.trim()
        ? body.userId.trim()
        : undefined;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId in request body." },
        { status: 400 }
      );
    }

    const rawLimit = Number(body?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 25);

    const mem0 = getMem0();
    const response = await mem0.getAll({
      user_id: userId,
      page: 1,
      page_size: cappedLimit,
    });

    const items: any[] = Array.isArray(response)
      ? response
      : Array.isArray(response?.results)
      ? response.results
      : Array.isArray(response?.memories)
      ? response.memories
      : Array.isArray(response?.data)
      ? response.data
      : [];
    const normalized = items.map(
      (memory: any) =>
        memory?.memory ??
        memory?.data?.memory ??
        memory?.text ??
        memory?.content ??
        (typeof memory === "string" ? memory : JSON.stringify(memory))
    );

    return NextResponse.json({
      ok: true,
      total: items.length,
      memories: normalized,
    });
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
