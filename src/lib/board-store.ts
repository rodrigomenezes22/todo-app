import { promises as fs } from "node:fs";
import path from "node:path";
import type { BoardData, WorkspaceData } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const boardFilePath = path.join(dataDir, "board.txt");

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
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(boardFilePath);
  } catch {
    await fs.writeFile(
      boardFilePath,
      JSON.stringify(fallbackWorkspace, null, 2),
      "utf8",
    );
  }
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
  const raw = await fs.readFile(boardFilePath, "utf8");

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
  await fs.writeFile(boardFilePath, JSON.stringify(workspace, null, 2), "utf8");
}
