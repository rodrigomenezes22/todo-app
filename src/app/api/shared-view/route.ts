import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  listSharedViewMembers,
  saveSharedViewBoard,
} from "@/lib/share-store";
import type { BoardData } from "@/lib/types";

/** Members assignable on a dashboard shared with the caller (owner + recipients). */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const ownerId = params.get("ownerId")?.trim() ?? "";
  const viewId = params.get("viewId")?.trim() ?? "";

  if (!ownerId || !viewId) {
    return NextResponse.json(
      { error: "ownerId and viewId are required" },
      { status: 400 },
    );
  }

  try {
    const members = await listSharedViewMembers(user.id, ownerId, viewId);
    return NextResponse.json({ members });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load members.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

type SavePayload = {
  ownerId?: string;
  viewId?: string;
  board?: BoardData;
};

/** A recipient saves an edit; it is written back into the owner's workspace. */
export async function PUT(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SavePayload;
  try {
    body = (await request.json()) as SavePayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const ownerId = body.ownerId?.trim() ?? "";
  const viewId = body.viewId?.trim() ?? "";
  const board = body.board;

  if (
    !ownerId ||
    !viewId ||
    !board ||
    !Array.isArray(board.columns) ||
    !board.tasks ||
    typeof board.tasks !== "object"
  ) {
    return NextResponse.json(
      { error: "ownerId, viewId and board are required" },
      { status: 400 },
    );
  }

  try {
    await saveSharedViewBoard(user.id, ownerId, viewId, board);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    // Missing share records are an access problem; everything else is a bad request.
    const status = message.includes("access") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
