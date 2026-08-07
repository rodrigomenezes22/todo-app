import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  listViewRecipients,
  shareView,
  unshareView,
} from "@/lib/share-store";

type SharePayload = {
  viewId?: string;
  userId?: string;
};

async function readSharePayload(
  request: Request,
): Promise<{ viewId: string; userId: string } | null> {
  let body: SharePayload;

  try {
    body = (await request.json()) as SharePayload;
  } catch {
    return null;
  }

  const viewId = body.viewId?.trim() ?? "";
  const userId = body.userId?.trim() ?? "";

  if (!viewId || !userId) {
    return null;
  }

  return { viewId, userId };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewId = new URL(request.url).searchParams.get("viewId")?.trim() ?? "";
  if (!viewId) {
    return NextResponse.json({ error: "viewId is required" }, { status: 400 });
  }

  try {
    const users = await listViewRecipients(user.id, viewId);
    return NextResponse.json({ users });
  } catch {
    return NextResponse.json(
      { error: "Could not load sharing details." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await readSharePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: "viewId and userId are required" },
      { status: 400 },
    );
  }

  try {
    await shareView(user.id, payload.viewId, payload.userId);
    const users = await listViewRecipients(user.id, payload.viewId);
    return NextResponse.json({ success: true, users });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not share dashboard.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await readSharePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: "viewId and userId are required" },
      { status: 400 },
    );
  }

  try {
    await unshareView(user.id, payload.viewId, payload.userId);
    const users = await listViewRecipients(user.id, payload.viewId);
    return NextResponse.json({ success: true, users });
  } catch {
    return NextResponse.json(
      { error: "Could not stop sharing." },
      { status: 500 },
    );
  }
}
