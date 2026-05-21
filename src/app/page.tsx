"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  BoardData,
  BoardView,
  Column,
  Task,
  WorkspaceData,
} from "@/lib/types";

const COLUMN_PALETTE = ["#ff8a3d", "#26a4d8", "#2dce7c", "#fca311", "#f06292"];
const PROTECTED_COLUMNS = new Set(["todo", "doing", "done", "trash"]);
const BASE_COLUMNS = [
  { id: "todo", title: "To Do", color: "#ff8a3d" },
  { id: "doing", title: "Doing", color: "#26a4d8" },
  { id: "done", title: "Done", color: "#2dce7c" },
  { id: "trash", title: "Trash", color: "#ff4655" },
];

function buildTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildColumnId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "column"}-${Date.now().toString(36)}`;
}

function buildViewId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "view"}-${Date.now().toString(36)}`;
}

function createEmptyBoard(): BoardData {
  return {
    columns: BASE_COLUMNS.map((column) => ({
      ...column,
      taskIds: [],
    })),
    tasks: {},
  };
}

function findTaskColumn(board: BoardData, taskId: string): Column | undefined {
  return board.columns.find((column) => column.taskIds.includes(taskId));
}

type SortableTaskCardProps = {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  columnId: string;
  statusLabel: string;
  isActive: boolean;
  onSelectTask: (taskId: string) => void;
};

function SortableTaskCard({
  task,
  onEdit,
  onDelete,
  columnId,
  statusLabel,
  isActive,
  onSelectTask,
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", columnId },
  });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={`task-card ${isActive ? "active" : ""}`}
      onClick={() => onSelectTask(task.id)}>
      <span className="status-pill">{statusLabel}</span>
      <button
        type="button"
        className="task-drag-handle"
        aria-label="Drag task"
        onPointerDown={(event) => event.stopPropagation()}
        {...attributes}
        {...listeners}>
        Drag
      </button>
      <p>{task.title}</p>
      <div className={`task-actions ${isActive ? "visible" : ""}`}>
        <button
          type="button"
          className="icon-btn"
          aria-label="Edit task"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onEdit(task)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4l10.5-10.5-4-4L4 16v4zm13.2-15.8 2.6 2.6-1.5 1.5-2.6-2.6 1.5-1.5z" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn danger"
          aria-label="Delete task"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete(task)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 20c0 1.1.9 2 2 2h6a2 2 0 0 0 2-2V8H7v12zm3-9h2v8h-2v-8zm4 0h2v8h-2v-8zM15.5 4l-1-1h-5l-1 1H5v2h14V4h-3.5z" />
          </svg>
        </button>
      </div>
    </article>
  );
}

type SortableColumnProps = {
  column: Column;
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onDeleteColumn: (columnId: string) => void;
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
};

function SortableColumn({
  column,
  tasks,
  onEditTask,
  onDeleteTask,
  onDeleteColumn,
  activeTaskId,
  onSelectTask,
}: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: "column" },
  });

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.75 : 1,
      }}
      className="kanban-column">
      <header
        className="column-header"
        style={{ borderTopColor: column.color }}>
        <button
          type="button"
          className="drag-handle"
          {...attributes}
          {...listeners}>
          {column.title}
        </button>
        {!PROTECTED_COLUMNS.has(column.id) && (
          <button
            type="button"
            className="delete-column"
            onClick={() => onDeleteColumn(column.id)}>
            Remove
          </button>
        )}
      </header>

      <SortableContext items={column.taskIds}>
        <div className="column-body">
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              columnId={column.id}
              statusLabel={column.title}
              isActive={activeTaskId === task.id}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

export default function Home() {
  const sensors = useSensors(useSensor(PointerSensor));

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [sessionUsername, setSessionUsername] = useState<string | null>(null);
  const [loginState, setLoginState] = useState({
    username: "",
    password: "",
  });
  const [loginError, setLoginError] = useState("");

  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("todo");
  const [newColumnTitle, setNewColumnTitle] = useState("");

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState("untitled");
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState("");
  const [newViewName, setNewViewName] = useState("");

  const views = useMemo(() => workspace?.views ?? [], [workspace]);

  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? views[0],
    [activeViewId, views],
  );

  const board = activeView?.board ?? null;
  const activeViewName = activeView?.name ?? "Untitled view";

  useEffect(() => {
    async function bootstrapSession() {
      try {
        const response = await fetch("/api/auth/session");
        const data = (await response.json()) as {
          authenticated: boolean;
          username?: string | null;
        };
        setIsAuthenticated(data.authenticated);
        setSessionUsername(data.username ?? null);
        if (data.authenticated) {
          const workspaceResponse = await fetch("/api/board");
          if (!workspaceResponse.ok) {
            throw new Error("Failed to load board");
          }

          const workspaceData =
            (await workspaceResponse.json()) as WorkspaceData;
          setWorkspace(workspaceData);
          const firstView = workspaceData.views[0];
          if (firstView) {
            setActiveViewId(firstView.id);
            if (
              !firstView.board.columns.some((column) => column.id === "todo")
            ) {
              setSelectedColumnId(firstView.board.columns[0]?.id ?? "todo");
            } else {
              setSelectedColumnId("todo");
            }
          } else {
            setActiveViewId("untitled");
          }
        }
      } catch {
        setErrorMessage("Unable to check session.");
      } finally {
        setIsCheckingSession(false);
      }
    }

    void bootstrapSession();
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (!target.closest(".task-card")) {
        setActiveTaskId(null);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
    };
  }, []);

  async function loadWorkspace() {
    const response = await fetch("/api/board");
    if (!response.ok) {
      throw new Error("Failed to load board");
    }

    const data = (await response.json()) as WorkspaceData;
    setWorkspace(data);
    const firstView = data.views[0];
    if (firstView) {
      setActiveViewId(firstView.id);
      if (
        !firstView.board.columns.some(
          (column) => column.id === selectedColumnId,
        )
      ) {
        setSelectedColumnId("todo");
      }
    }
  }

  async function persistWorkspace(nextWorkspace: WorkspaceData) {
    setWorkspace(nextWorkspace);
    setIsSaving(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextWorkspace),
      });

      if (!response.ok) {
        let details = "";

        try {
          const payload = (await response.json()) as { error?: string };
          details = payload.error ? `: ${payload.error}` : "";
        } catch {
          // Ignore invalid JSON body and use status text below.
        }

        throw new Error(
          `Could not save changes (HTTP ${response.status})${details}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not save changes to board data";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  function replaceActiveViewBoard(nextBoard: BoardData): WorkspaceData | null {
    if (!workspace || !activeView) return null;

    return {
      ...workspace,
      views: workspace.views.map((view) =>
        view.id === activeView.id ? { ...view, board: nextBoard } : view,
      ),
    };
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginState),
    });

    if (!response.ok) {
      try {
        const payload = (await response.json()) as { error?: string };
        setLoginError(payload.error ?? "Invalid username or password.");
      } catch {
        setLoginError("Invalid username or password.");
      }
      return;
    }

    const payload = (await response.json()) as { username?: string };

    setSessionUsername(payload.username ?? loginState.username.trim());
    setIsAuthenticated(true);
    await loadWorkspace();
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginState),
    });

    if (!response.ok) {
      try {
        const payload = (await response.json()) as { error?: string };
        setLoginError(payload.error ?? "Could not create account.");
      } catch {
        setLoginError("Could not create account.");
      }
      return;
    }

    const payload = (await response.json()) as { username?: string };
    setSessionUsername(payload.username ?? loginState.username.trim());
    setIsAuthenticated(true);
    await loadWorkspace();
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsAuthenticated(false);
    setSessionUsername(null);
    setWorkspace(null);
  }

  async function handleAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!board || !workspace || !activeView) return;

    const title = newTaskTitle.trim();
    if (!title) return;

    const id = buildTaskId();
    const columns = board.columns.map((column) =>
      column.id === selectedColumnId
        ? { ...column, taskIds: [...column.taskIds, id] }
        : column,
    );

    const nextBoard: BoardData = {
      columns,
      tasks: {
        ...board.tasks,
        [id]: { id, title },
      },
    };

    setNewTaskTitle("");
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleUpdateTask() {
    if (!board || !editingTask || !workspace || !activeView) return;
    const title = editingTaskTitle.trim();
    if (!title) return;

    const nextBoard: BoardData = {
      ...board,
      tasks: {
        ...board.tasks,
        [editingTask.id]: { ...editingTask, title },
      },
    };

    setEditingTask(null);
    setEditingTaskTitle("");
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleDeleteTask(task: Task) {
    if (!board || !workspace || !activeView) return;

    const sourceColumn = findTaskColumn(board, task.id);
    if (!sourceColumn) return;

    const nextBoard: BoardData = {
      columns: board.columns.map((column) =>
        column.id === sourceColumn.id
          ? {
              ...column,
              taskIds: column.taskIds.filter((taskId) => taskId !== task.id),
            }
          : column,
      ),
      tasks: Object.fromEntries(
        Object.entries(board.tasks).filter(([id]) => id !== task.id),
      ),
    };

    if (activeTaskId === task.id) {
      setActiveTaskId(null);
    }

    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleAddColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!board || !workspace || !activeView) return;

    const title = newColumnTitle.trim();
    if (!title) return;

    const nextBoard: BoardData = {
      ...board,
      columns: [
        ...board.columns.slice(0, -1),
        {
          id: buildColumnId(title),
          title,
          color:
            COLUMN_PALETTE[Math.floor(Math.random() * COLUMN_PALETTE.length)],
          taskIds: [],
        },
        board.columns[board.columns.length - 1],
      ],
    };

    setNewColumnTitle("");
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleDeleteColumn(columnId: string) {
    if (!board || PROTECTED_COLUMNS.has(columnId) || !workspace || !activeView)
      return;

    const targetColumn = board.columns.find((column) => column.id === columnId);
    if (!targetColumn) return;

    const trashColumn = board.columns.find((column) => column.id === "trash");
    if (!trashColumn) return;

    const nextColumns = board.columns
      .filter((column) => column.id !== columnId)
      .map((column) =>
        column.id === "trash"
          ? { ...column, taskIds: [...column.taskIds, ...targetColumn.taskIds] }
          : column,
      );

    const nextBoard: BoardData = { ...board, columns: nextColumns };

    if (selectedColumnId === columnId) {
      setSelectedColumnId("todo");
    }

    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!board || !event.over || !workspace || !activeView) return;

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (activeId === overId) return;

    const activeType = event.active.data.current?.type;
    const overType = event.over.data.current?.type;

    if (activeType === "column" && overType === "column") {
      const oldIndex = board.columns.findIndex(
        (column) => column.id === activeId,
      );
      const newIndex = board.columns.findIndex(
        (column) => column.id === overId,
      );
      if (oldIndex < 0 || newIndex < 0) return;

      const nextBoard: BoardData = {
        ...board,
        columns: arrayMove(board.columns, oldIndex, newIndex),
      };
      const nextWorkspace = replaceActiveViewBoard(nextBoard);
      if (!nextWorkspace) return;
      await persistWorkspace(nextWorkspace);
      return;
    }

    if (activeType !== "task") return;

    const sourceColumn = findTaskColumn(board, activeId);
    if (!sourceColumn) return;

    let destinationColumnId: string;
    let destinationIndex = 0;

    if (overType === "task") {
      destinationColumnId = String(event.over.data.current?.columnId);
      const destinationColumn = board.columns.find(
        (column) => column.id === destinationColumnId,
      );
      if (!destinationColumn) return;
      destinationIndex = destinationColumn.taskIds.indexOf(overId);
    } else if (overType === "column") {
      destinationColumnId = overId;
      const destinationColumn = board.columns.find(
        (column) => column.id === destinationColumnId,
      );
      if (!destinationColumn) return;
      destinationIndex = destinationColumn.taskIds.length;
    } else {
      return;
    }

    const sourceWithoutActive = sourceColumn.taskIds.filter(
      (taskId) => taskId !== activeId,
    );

    const nextColumns = board.columns.map((column) => {
      if (
        column.id === sourceColumn.id &&
        sourceColumn.id === destinationColumnId
      ) {
        const reordered = arrayMove(
          column.taskIds,
          column.taskIds.indexOf(activeId),
          destinationIndex,
        );
        return { ...column, taskIds: reordered };
      }

      if (column.id === sourceColumn.id) {
        return { ...column, taskIds: sourceWithoutActive };
      }

      if (column.id === destinationColumnId) {
        const nextTaskIds = [...column.taskIds];
        nextTaskIds.splice(destinationIndex, 0, activeId);
        return { ...column, taskIds: nextTaskIds };
      }

      return column;
    });

    const nextBoard: BoardData = { ...board, columns: nextColumns };
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  function startViewRename(view: BoardView) {
    setEditingViewId(view.id);
    setEditingViewName(view.name);
  }

  function submitViewRename() {
    if (!editingViewId || !workspace) return;

    const nextName = editingViewName.trim();
    if (!nextName) {
      setEditingViewId(null);
      setEditingViewName("");
      return;
    }

    const nextWorkspace: WorkspaceData = {
      ...workspace,
      views: workspace.views.map((view) =>
        view.id === editingViewId ? { ...view, name: nextName } : view,
      ),
    };

    setEditingViewId(null);
    setEditingViewName("");
    void persistWorkspace(nextWorkspace);
  }

  async function handleCreateView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;

    const name = newViewName.trim();
    if (!name) return;

    const id = buildViewId(name);
    const nextWorkspace: WorkspaceData = {
      ...workspace,
      views: [...workspace.views, { id, name, board: createEmptyBoard() }],
    };

    setActiveViewId(id);
    setNewViewName("");
    setSelectedColumnId("todo");
    await persistWorkspace(nextWorkspace);
  }

  async function handleDeleteView(viewId: string) {
    if (!workspace || workspace.views.length <= 1) return;

    const nextViews = workspace.views.filter((view) => view.id !== viewId);
    if (nextViews.length === 0) return;

    const nextActive =
      activeViewId === viewId
        ? (nextViews[Math.max(0, nextViews.length - 1)]?.id ?? nextViews[0].id)
        : activeViewId;

    const nextWorkspace: WorkspaceData = {
      ...workspace,
      views: nextViews,
    };

    setActiveViewId(nextActive);
    await persistWorkspace(nextWorkspace);
  }

  if (isCheckingSession) {
    return <main className="loading-state">Loading workspace...</main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="login-shell">
        <div className="glass-card">
          <h1>Customer Workspace</h1>
          <p>
            {authMode === "login"
              ? "Sign in to continue to your board."
              : "Create a customer account to start your board."}
          </p>

          <form
            className="login-form"
            onSubmit={authMode === "login" ? handleLogin : handleRegister}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              value={loginState.username}
              onChange={(event) =>
                setLoginState((state) => ({
                  ...state,
                  username: event.target.value,
                }))
              }
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={
                authMode === "login" ? "current-password" : "new-password"
              }
              value={loginState.password}
              onChange={(event) =>
                setLoginState((state) => ({
                  ...state,
                  password: event.target.value,
                }))
              }
            />

            {loginError && <p className="error-text">{loginError}</p>}

            <button type="submit">
              {authMode === "login" ? "Login" : "Create Account"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setLoginError("");
                setAuthMode((mode) =>
                  mode === "login" ? "register" : "login",
                );
              }}>
              {authMode === "login"
                ? "Need an account? Register"
                : "Already have an account? Login"}
            </button>
          </form>

          <small>
            Accounts are private. Each customer gets their own board.
          </small>
        </div>
      </main>
    );
  }

  if (!board || !activeView) {
    return <main className="loading-state">Loading board...</main>;
  }

  return (
    <main className="workspace-layout">
      <aside className="left-nav">
        <h2>Tasks</h2>
        <button type="button" className="new-task-btn">
          New Task
        </button>

        <div className="nav-group">
          <p>Views</p>
          <ul>
            {views.map((view) => (
              <li
                key={view.id}
                className={activeViewId === view.id ? "active" : ""}
                onClick={() => setActiveViewId(view.id)}>
                {editingViewId === view.id ? (
                  <input
                    className="view-edit-input"
                    value={editingViewName}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditingViewName(event.target.value)}
                    onBlur={submitViewRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submitViewRename();
                      }
                      if (event.key === "Escape") {
                        setEditingViewId(null);
                        setEditingViewName("");
                      }
                    }}
                  />
                ) : (
                  <>
                    <span>{view.name}</span>
                    <div className="view-actions">
                      <button
                        type="button"
                        className="icon-btn view-action-btn"
                        aria-label="Rename view"
                        onClick={(event) => {
                          event.stopPropagation();
                          startViewRename(view);
                        }}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 20h4l10.5-10.5-4-4L4 16v4zm13.2-15.8 2.6 2.6-1.5 1.5-2.6-2.6 1.5-1.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger view-action-btn"
                        aria-label="Delete view"
                        disabled={views.length <= 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteView(view.id);
                        }}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 20c0 1.1.9 2 2 2h6a2 2 0 0 0 2-2V8H7v12zm3-9h2v8h-2v-8zm4 0h2v8h-2v-8zM15.5 4l-1-1h-5l-1 1H5v2h14V4h-3.5z" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>

          <form className="view-create-form" onSubmit={handleCreateView}>
            <input
              placeholder="New project view"
              value={newViewName}
              onChange={(event) => setNewViewName(event.target.value)}
            />
            <button type="submit">Add</button>
          </form>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div>
            <h1>{activeViewName}</h1>
            <p>
              {board.columns.length} columns for your workflow
              {sessionUsername && <span> · @{sessionUsername}</span>}
              {isSaving && <span className="saving-pill">Saving...</span>}
            </p>
          </div>
          <button type="button" className="ghost" onClick={handleLogout}>
            Logout
          </button>
        </header>

        <section className="control-panel">
          <form onSubmit={handleAddTask} className="task-form">
            <input
              placeholder="New task..."
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
            />
            <select
              value={selectedColumnId}
              onChange={(event) => setSelectedColumnId(event.target.value)}>
              {board.columns
                .filter((column) => column.id !== "trash")
                .map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.title}
                  </option>
                ))}
            </select>
            <button type="submit">Add New Task</button>
          </form>

          <form onSubmit={handleAddColumn} className="column-form">
            <input
              placeholder="New column"
              value={newColumnTitle}
              onChange={(event) => setNewColumnTitle(event.target.value)}
            />
            <button type="submit">Add Column</button>
          </form>
        </section>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}>
          <SortableContext items={board.columns.map((column) => column.id)}>
            <section className="kanban-grid">
              {board.columns.map((column) => (
                <SortableColumn
                  key={column.id}
                  column={column}
                  tasks={column.taskIds
                    .map((taskId) => board.tasks[taskId])
                    .filter(Boolean)}
                  onEditTask={(task) => {
                    setEditingTask(task);
                    setEditingTaskTitle(task.title);
                  }}
                  onDeleteTask={handleDeleteTask}
                  onDeleteColumn={handleDeleteColumn}
                  activeTaskId={activeTaskId}
                  onSelectTask={setActiveTaskId}
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      </section>

      {editingTask && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setEditingTask(null)}>
          <div
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}>
            <h2>Edit Task</h2>
            <input
              value={editingTaskTitle}
              onChange={(event) => setEditingTaskTitle(event.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setEditingTask(null)}>
                Cancel
              </button>
              <button type="button" onClick={handleUpdateTask}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
