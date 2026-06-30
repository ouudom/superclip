import { auth } from "@/lib/auth";
import { getPrismaClient } from "@/server/prisma";
import { NextRequest, NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";

const authHandlers = toNextJsHandler(auth.handler);

const allowPublicSignup = ["1", "true", "yes"].includes(
  (process.env.ALLOW_PUBLIC_SIGNUP ?? "").toLowerCase(),
);
const disableSignUp = ["1", "true", "yes"].includes(
  (process.env.DISABLE_SIGN_UP ?? "").toLowerCase(),
);

function isSignUpRequest(request: NextRequest) {
  return request.nextUrl.pathname.includes("/sign-up");
}

async function readEmail(request: NextRequest) {
  try {
    const body = await request.clone().json();
    return typeof body?.email === "string" ? body.email : null;
  } catch {
    return null;
  }
}

export const GET = authHandlers.GET;

export async function POST(request: NextRequest) {
  if (!isSignUpRequest(request)) {
    return authHandlers.POST(request);
  }

  const prisma = getPrismaClient();
  const userCount = await prisma.user.count();
  if (disableSignUp || (!allowPublicSignup && userCount > 0)) {
    return NextResponse.json(
      { error: "Public signup is disabled on this personal server." },
      { status: 403 },
    );
  }

  const email = await readEmail(request);
  const response = await authHandlers.POST(request);

  if (response.ok && userCount === 0 && email) {
    await prisma.user.update({
      where: { email },
      data: { is_admin: true },
    }).catch(() => null);
  }

  return response;
}
