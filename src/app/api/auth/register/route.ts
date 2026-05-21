import { NextResponse } from "next/server";
import { AUTH_COOKIE, getAuthCookieMaxAge, registerCustomer } from "@/lib/auth";
import { migrateLegacyBoardForInitialCustomer } from "@/lib/board-store";

type RegisterPayload = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: RegisterPayload;

  try {
    body = (await request.json()) as RegisterPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  try {
    const { sessionToken, user } = await registerCustomer(
      body.username ?? "",
      body.password ?? "",
    );

    await migrateLegacyBoardForInitialCustomer(user.id, user.username);

    const response = NextResponse.json({
      success: true,
      username: user.username,
    });
    response.cookies.set(AUTH_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: getAuthCookieMaxAge(),
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registration failed";
    const status = message === "Username is already taken." ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
