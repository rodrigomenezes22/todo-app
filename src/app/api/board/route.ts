import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { readBoard, writeBoard } from "@/lib/board-store";
import type { WorkspaceData } from "@/lib/types";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const board = await readBoard(user.id);
  return NextResponse.json(board);
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = (await request.json()) as WorkspaceData;
    await writeBoard(user.id, workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
