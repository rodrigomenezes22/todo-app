import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listPlatformUsers } from "@/lib/share-store";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const users = await listPlatformUsers(user.id);
    return NextResponse.json({ users });
  } catch {
    return NextResponse.json(
      { error: "Could not load users." },
      { status: 500 },
    );
  }
}
