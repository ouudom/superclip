import { NextResponse } from "next/server";

import { createProxyResponse, fetchBackend } from "@/server/backend-api";
import { getServerSession } from "@/server/session";

async function proxyAgentsRoot(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();
  const upstream = await fetchBackend("/agents/runs", {
    method: request.method,
    userId: session.user.id,
    extraHeaders: {
      ...(body && request.headers.get("content-type")
        ? { "Content-Type": request.headers.get("content-type") as string }
        : {}),
    },
    body,
    cache: "no-store",
  });

  return createProxyResponse(upstream);
}

export async function GET(request: Request) {
  return proxyAgentsRoot(request);
}

export async function POST(request: Request) {
  return proxyAgentsRoot(request);
}
