import { NextResponse } from "next/server";
import { AUTH_COOKIE, DEMO_CREDENTIALS } from "@/lib/auth";

type LoginPayload = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginPayload;

  if (
    body.username !== DEMO_CREDENTIALS.username ||
    body.password !== DEMO_CREDENTIALS.password
  ) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
