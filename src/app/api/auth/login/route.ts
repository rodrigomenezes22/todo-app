import { NextResponse } from "next/server";
import { AUTH_COOKIE, getAuthCookieMaxAge, loginCustomer } from "@/lib/auth";
import { migrateLegacyBoardForInitialCustomer } from "@/lib/board-store";

type LoginPayload = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LoginPayload;

  try {
    body = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  try {
    const { sessionToken, user } = await loginCustomer(
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
      error instanceof Error ? error.message : "Invalid username or password.";
    const isAuthError =
      message === "Invalid username or password." ||
      message === "Username and password are required.";
    return NextResponse.json(
      { error: isAuthError ? message : "Server error, please try again." },
      { status: isAuthError ? 401 : 500 },
    );
  }
}
