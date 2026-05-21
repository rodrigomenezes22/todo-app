export type Task = {
  id: string;
  title: string;
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
};

export type WorkspaceData = {
  views: BoardView[];
};
