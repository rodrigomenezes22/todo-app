import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  const user = await getAuthenticatedUser();
  return NextResponse.json({
    authenticated: Boolean(user),
    username: user?.username ?? null,
  });
}
