import { promises as fs } from "node:fs";
import path from "node:path";
import type { BoardData, WorkspaceData } from "@/lib/types";

const localDataDir = path.join(process.cwd(), "data");
const localBoardFilePath = path.join(localDataDir, "board.txt");
const runtimeTempRoot =
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";
const runtimeDataDir = path.join(runtimeTempRoot, "todo-app-data");
const runtimeBoardFilePath = path.join(runtimeDataDir, "board.txt");
const boardFilePathCandidates = [localBoardFilePath, runtimeBoardFilePath];

let writableBoardFilePath: string | null = null;

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

async function ensureBoardFile(): Promise<void> {
  if (writableBoardFilePath) {
    return;
  }

  let lastError: unknown;

  for (const filePath of boardFilePathCandidates) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(
          filePath,
          JSON.stringify(fallbackWorkspace, null, 2),
          "utf8",
        );
      }

      await fs.appendFile(filePath, "");
      writableBoardFilePath = filePath;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`Unable to locate writable board file.${detail}`);
}

function getBoardFilePath(): string {
  if (!writableBoardFilePath) {
    throw new Error("Board file path is not initialized");
  }

  return writableBoardFilePath;
}

function looksLikeLegacyBoard(data: unknown): data is BoardData {
  const candidate = data as BoardData;
  return Boolean(candidate?.columns && candidate?.tasks);
}

function looksLikeWorkspace(data: unknown): data is WorkspaceData {
  const candidate = data as WorkspaceData;
  return Boolean(candidate?.views && Array.isArray(candidate.views));
}

export async function readBoard(): Promise<WorkspaceData> {
  await ensureBoardFile();
  const raw = await fs.readFile(getBoardFilePath(), "utf8");

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (looksLikeWorkspace(parsed) && parsed.views.length > 0) {
      return parsed;
    }

    if (looksLikeLegacyBoard(parsed)) {
      return {
        views: [
          {
            id: "untitled",
            name: "Untitled view",
            board: parsed,
          },
        ],
      };
    }

    return fallbackWorkspace;
  } catch {
    return fallbackWorkspace;
  }
}

export async function writeBoard(workspace: WorkspaceData): Promise<void> {
  await ensureBoardFile();
  await fs.writeFile(
    getBoardFilePath(),
    JSON.stringify(workspace, null, 2),
    "utf8",
  );
}
