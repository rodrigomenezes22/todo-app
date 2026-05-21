import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { readBoard, writeBoard } from "@/lib/board-store";
import type { WorkspaceData } from "@/lib/types";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const board = await readBoard();
  return NextResponse.json(board);
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = (await request.json()) as WorkspaceData;
    await writeBoard(workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
