import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { readBoard, writeBoard } from "@/lib/board-store";
import {
  isSharedViewId,
  listUsernamesByIds,
  pruneSharesForMissingViews,
  readSharedViewsForUser,
} from "@/lib/share-store";
import type { BoardView, WorkspaceData } from "@/lib/types";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [workspace, sharedViews] = await Promise.all([
    readBoard(user.id),
    readSharedViewsForUser(user.id),
  ]);

  const views = await withResolvedAssignees([
    ...workspace.views,
    ...sharedViews,
  ]);

  return NextResponse.json({ views } satisfies WorkspaceData);
}

/** Names are looked up on read so an assignment can never show a stale handle. */
async function withResolvedAssignees(views: BoardView[]): Promise<BoardView[]> {
  const assigneeIds = new Set<string>();

  for (const view of views) {
    for (const task of Object.values(view.board.tasks)) {
      if (task.assigneeId) {
        assigneeIds.add(task.assigneeId);
      }
    }
  }

  if (assigneeIds.size === 0) {
    return views;
  }

  const usernames = await listUsernamesByIds([...assigneeIds]);

  return views.map((view) => ({
    ...view,
    board: {
      ...view.board,
      tasks: Object.fromEntries(
        Object.entries(view.board.tasks).map(([taskId, task]) => {
          if (!task.assigneeId) {
            return [taskId, task];
          }

          const username = usernames.get(task.assigneeId);
          if (!username) {
            const unassigned = { ...task };
            delete unassigned.assigneeId;
            delete unassigned.assigneeName;
            return [taskId, unassigned];
          }

          return [taskId, { ...task, assigneeName: username }];
        }),
      ),
    },
  }));
}

/** Views shared with the user are read-only, so they never enter their own document. */
function keepOwnedViews(views: BoardView[]): BoardView[] {
  return views
    .filter((view) => !view.sharedBy && !isSharedViewId(view.id))
    .map((view) => ({ id: view.id, name: view.name, board: view.board }));
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as WorkspaceData;
    if (!Array.isArray(payload?.views)) {
      return NextResponse.json(
        { error: "Invalid workspace payload" },
        { status: 400 },
      );
    }

    const views = keepOwnedViews(payload.views);
    await writeBoard(user.id, { views });
    await pruneSharesForMissingViews(
      user.id,
      views.map((view) => view.id),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
