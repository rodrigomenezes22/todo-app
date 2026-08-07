import { promises as fs } from "node:fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { sanitizeDayValue, sanitizeTimestamp } from "@/lib/dates";
import { sanitizeRichText, sanitizeTaskTitle } from "@/lib/rich-text";
import { sanitizeUserId, sanitizeUsername } from "@/lib/user-fields";
import type { BoardData, Task, WorkspaceData } from "@/lib/types";

const legacyBoardFilePath = path.join(process.cwd(), "data", "board.txt");

const fallbackBoard: BoardData = {
  columns: [
    { id: "todo", title: "To Do", color: "#ff8a3d", taskIds: [] },
    { id: "doing", title: "Doing", color: "#26a4d8", taskIds: [] },
    { id: "done", title: "Done", color: "#2dce7c", taskIds: [] },
    { id: "trash", title: "Trash", color: "#ff4655", taskIds: [] },
  ],
  tasks: {},
};

const fallbackWorkspace: WorkspaceData = {
  views: [
    {
      id: "untitled",
      name: "Untitled view",
      board: fallbackBoard,
    },
  ],
};

type BoardDocument = {
  userId: ObjectId;
  workspace: WorkspaceData;
  createdAt: Date;
  updatedAt: Date;
};

let boardIndexesPromise: Promise<void> | null = null;

async function ensureBoardIndexes(): Promise<void> {
  if (!boardIndexesPromise) {
    boardIndexesPromise = (async () => {
      const db = await getDatabase();
      await db
        .collection<BoardDocument>("boards")
        .createIndex({ userId: 1 }, { unique: true });
    })();
  }

  await boardIndexesPromise;
}

function looksLikeLegacyBoard(data: unknown): data is BoardData {
  const candidate = data as BoardData;
  return Boolean(candidate?.columns && candidate?.tasks);
}

function looksLikeWorkspace(data: unknown): data is WorkspaceData {
  const candidate = data as WorkspaceData;
  return Boolean(candidate?.views && Array.isArray(candidate.views));
}

function parseWorkspacePayload(payload: unknown): WorkspaceData | null {
  if (looksLikeWorkspace(payload) && payload.views.length > 0) {
    return payload;
  }

  if (looksLikeLegacyBoard(payload)) {
    return {
      views: [
        {
          id: "untitled",
          name: "Untitled view",
          board: payload,
        },
      ],
    };
  }

  return null;
}

async function readLegacyWorkspaceFromFile(): Promise<WorkspaceData | null> {
  try {
    const raw = await fs.readFile(legacyBoardFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseWorkspacePayload(parsed);
  } catch {
    return null;
  }
}

export async function readBoard(userId: string): Promise<WorkspaceData> {
  await ensureBoardIndexes();
  const db = await getDatabase();
  const boards = db.collection<BoardDocument>("boards");
  const userObjectId = new ObjectId(userId);

  const existing = await boards.findOne({ userId: userObjectId });
  if (!existing) {
    return fallbackWorkspace;
  }

  const parsed = existing.workspace as unknown;
  return parseWorkspacePayload(parsed) ?? fallbackWorkspace;
}

/** Task titles and rich text are cleaned here so nothing unsafe is ever stored. */
function sanitizeWorkspace(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    views: workspace.views.map((view) => ({
      ...view,
      board: {
        ...view.board,
        tasks: Object.fromEntries(
          Object.entries(view.board.tasks).map(([taskId, task]) => {
            const details = sanitizeRichText(task.details);
            const createdAt = sanitizeTimestamp(task.createdAt);
            const startDate = sanitizeDayValue(task.startDate);
            const goalDate = sanitizeDayValue(task.goalDate);
            const assigneeId = sanitizeUserId(task.assigneeId);
            const assigneeName = assigneeId
              ? sanitizeUsername(task.assigneeName)
              : "";
            const cleanTask: Task = {
              ...task,
              title: sanitizeTaskTitle(task.title),
            };

            for (const [key, value] of [
              ["details", details],
              ["createdAt", createdAt],
              ["startDate", startDate],
              ["goalDate", goalDate],
              ["assigneeId", assigneeId],
              ["assigneeName", assigneeName],
            ] as const) {
              if (value) {
                cleanTask[key] = value;
              } else {
                delete cleanTask[key];
              }
            }

            return [taskId, cleanTask];
          }),
        ),
      },
    })),
  };
}

export async function writeBoard(
  userId: string,
  workspace: WorkspaceData,
): Promise<void> {
  await ensureBoardIndexes();
  const db = await getDatabase();
  const boards = db.collection<BoardDocument>("boards");
  const now = new Date();

  await boards.updateOne(
    { userId: new ObjectId(userId) },
    {
      $set: {
        workspace: sanitizeWorkspace(workspace),
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
}

export async function migrateLegacyBoardForInitialCustomer(
  userId: string,
  username: string,
): Promise<boolean> {
  const migrationUsername =
    process.env.LEGACY_MIGRATION_USERNAME?.trim().toLowerCase() ?? "";
  if (!migrationUsername) {
    return false;
  }

  if (username.trim().toLowerCase() !== migrationUsername) {
    return false;
  }

  await ensureBoardIndexes();
  const db = await getDatabase();
  const boards = db.collection<BoardDocument>("boards");
  const userObjectId = new ObjectId(userId);

  const existing = await boards.findOne({ userId: userObjectId });
  if (existing) {
    return false;
  }

  const legacyWorkspace = await readLegacyWorkspaceFromFile();
  if (!legacyWorkspace) {
    return false;
  }

  const now = new Date();
  await boards.insertOne({
    userId: userObjectId,
    workspace: legacyWorkspace,
    createdAt: now,
    updatedAt: now,
  });

  return true;
}
