export type Task = {
  id: string;
  title: string;
  /** Rich text, stored as the whitelisted HTML subset from `@/lib/rich-text`. */
  details?: string;
  /** ISO timestamp of when the task was created. */
  createdAt?: string;
  /** Planned start day, stored as "YYYY-MM-DD". Falls back to `createdAt`. */
  startDate?: string;
  /** Target completion day, stored as "YYYY-MM-DD". */
  goalDate?: string;
  /** Id of the assigned customer; the name is resolved when the board is read. */
  assigneeId?: string;
  assigneeName?: string;
  statusDates?: Partial<Record<"todo" | "doing" | "done", string>>;
};

export type Column = {
  id: string;
  title: string;
  color: string;
  taskIds: string[];
};

export type BoardData = {
  columns: Column[];
  tasks: Record<string, Task>;
};

export type BoardView = {
  id: string;
  name: string;
  board: BoardData;
  /** Username of the owner. Only set on views another customer shared with you. */
  sharedBy?: string;
  sharedByUserId?: string;
  /** Original view id inside the owner's workspace. */
  sourceViewId?: string;
};

export type WorkspaceData = {
  views: BoardView[];
};

export type PlatformUser = {
  id: string;
  username: string;
};
