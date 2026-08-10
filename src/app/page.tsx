"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import RichTextEditor from "@/components/rich-text-editor";
import {
  MS_PER_DAY,
  addDays,
  computeScheduleUpdate,
  dayValueToTimestamp,
  getDayStartMs,
  getLocalDayStartMs,
  toDayValue,
  type ScheduleMode,
} from "@/lib/dates";
import { sanitizeRichText } from "@/lib/rich-text";
import type {
  BoardData,
  BoardView,
  Column,
  PlatformUser,
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
const TRACKED_STATUS_COLUMNS = new Set(["todo", "doing", "done"]);
const DAYS_PER_WEEK = 7;
const WEEKDAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
});
const MONTH_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const STATUS_META: Record<"todo" | "doing" | "done", { label: string }> = {
  todo: { label: "To Do" },
  doing: { label: "Doing" },
  done: { label: "Done" },
};

type CalendarEntry = {
  id: string;
  taskId: string;
  taskTitle: string;
  statusId: "todo" | "doing" | "done";
  statusLabel: string;
  timestamp: number;
  dayStartMs: number;
};

function getStartOfWeek(date: Date): Date {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfWeek = dayStart.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  dayStart.setDate(dayStart.getDate() + mondayOffset);
  return dayStart;
}

function getTrackedStatusColumnId(
  columnId: string,
): "todo" | "doing" | "done" | null {
  if (!TRACKED_STATUS_COLUMNS.has(columnId)) {
    return null;
  }

  return columnId as "todo" | "doing" | "done";
}

function buildTaskStatusDateLabel(task: Task, columnId: string): string | null {
  const statusId = getTrackedStatusColumnId(columnId);
  if (!statusId) {
    return null;
  }

  const statusDate = task.statusDates?.[statusId];
  if (!statusDate) {
    return null;
  }

  const parsed = new Date(statusDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const todayStartMs = getLocalDayStartMs(new Date());
  const targetStartMs = getLocalDayStartMs(parsed);
  const dayDiff = Math.round((todayStartMs - targetStartMs) / MS_PER_DAY);

  if (dayDiff === 0) {
    return "Today";
  }

  if (dayDiff === 1) {
    return "Yesterday";
  }

  if (dayDiff > 1) {
    return `${dayDiff}d ago`;
  }

  if (dayDiff === -1) {
    return "Tomorrow";
  }

  return `in ${Math.abs(dayDiff)}d`;
}

/** An explicit start wins; otherwise fall back to creation, then first activity. */
function getTaskStartMs(task: Task): number | null {
  const startMs = getDayStartMs(task.startDate);
  if (startMs !== null) {
    return startMs;
  }

  const createdMs = getDayStartMs(task.createdAt);
  if (createdMs !== null) {
    return createdMs;
  }

  const statusMs = Object.values(task.statusDates ?? {})
    .map((value) => getDayStartMs(value))
    .filter((value): value is number => value !== null);

  return statusMs.length > 0 ? Math.min(...statusMs) : null;
}

function formatDayLabel(dayStartMs: number): string {
  return MONTH_DAY_LABEL_FORMATTER.format(new Date(dayStartMs));
}

function buildAssignee(
  assigneeId: string,
  members: PlatformUser[],
): Pick<Task, "assigneeId" | "assigneeName"> {
  if (!assigneeId) return {};

  const member = members.find((candidate) => candidate.id === assigneeId);
  return member
    ? { assigneeId: member.id, assigneeName: member.username }
    : { assigneeId };
}

function toDayValueOrEmpty(value: string | undefined): string {
  const dayStartMs = getDayStartMs(value);
  return dayStartMs === null ? "" : toDayValue(new Date(dayStartMs));
}

function isTaskOverdue(task: Task, columnId: string): boolean {
  if (columnId === "done" || columnId === "trash") {
    return false;
  }

  const goalMs = getDayStartMs(task.goalDate);
  return goalMs !== null && goalMs < getLocalDayStartMs(new Date());
}

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
  statusDateLabel: string | null;
  isActive: boolean;
  onSelectTask: (taskId: string) => void;
  readOnly: boolean;
};

function SortableTaskCard({
  task,
  onEdit,
  onDelete,
  columnId,
  statusLabel,
  statusDateLabel,
  isActive,
  onSelectTask,
  readOnly,
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

  const detailsHtml = useMemo(
    () => sanitizeRichText(task.details),
    [task.details],
  );

  const detailsRef = useRef<HTMLDivElement | null>(null);
  const isActiveRef = useRef(isActive);
  const [hasMoreDetails, setHasMoreDetails] = useState(false);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Watching the box tells us whether the collapsed card is hiding anything.
  // While expanded nothing overflows, so the collapsed answer is kept.
  useEffect(() => {
    const element = detailsRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      if (isActiveRef.current) return;
      setHasMoreDetails(element.scrollHeight > element.clientHeight + 1);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [detailsHtml]);

  const createdMs = getDayStartMs(task.createdAt);
  const startMs = getDayStartMs(task.startDate);
  const goalMs = getDayStartMs(task.goalDate);
  const overdue = isTaskOverdue(task, columnId);
  const hasSchedule = startMs !== null || goalMs !== null;

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        // Lift the card out of the flow so it stays on top of neighbouring
        // cards and columns for the whole drag, not just its own column.
        zIndex: isDragging ? 100 : undefined,
        boxShadow: isDragging ? "var(--shadow-lg)" : undefined,
      }}
      className={`task-card ${isActive ? "active" : ""}`}
      onClick={() => onSelectTask(task.id)}>
      <div className="task-card-top">
        {!readOnly && (
          <button
            type="button"
            className="task-drag-handle"
            aria-label="Drag task"
            title="Drag task"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4h2.2v2.2H9V4zm3.8 0H15v2.2h-2.2V4zM9 8.9h2.2v2.2H9V8.9zm3.8 0H15v2.2h-2.2V8.9zM9 13.8h2.2V16H9v-2.2zm3.8 0H15V16h-2.2v-2.2zM9 18.7h2.2v2.2H9v-2.2zm3.8 0H15v2.2h-2.2v-2.2z" />
            </svg>
          </button>
        )}
        <span className="status-pill">{statusLabel}</span>
        {task.assigneeName && (
          <span
            className="assignee-chip"
            title={`Assigned to @${task.assigneeName}`}>
            <span className="assignee-avatar" aria-hidden="true">
              {task.assigneeName.slice(0, 1).toUpperCase()}
            </span>
            @{task.assigneeName}
          </span>
        )}
        {statusDateLabel && (
          <span
            className="status-date-chip"
            title={`Last moved to ${statusLabel}`}>
            {statusDateLabel}
          </span>
        )}
      </div>
      <p className="task-title">{task.title}</p>
      {detailsHtml && (
        <div
          ref={detailsRef}
          className={`task-details ${hasMoreDetails ? "has-more" : ""}`}
          dangerouslySetInnerHTML={{ __html: detailsHtml }}
        />
      )}
      {detailsHtml && hasMoreDetails && (
        <span className="task-details-hint" aria-hidden="true">
          {isActive ? "Click to collapse" : "Click to read more"}
        </span>
      )}
      {(createdMs !== null || hasSchedule) && (
        <div className="task-dates">
          {createdMs !== null && (
            <span className="task-date" title="Created">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2zm12 8H5v10h14V10z" />
              </svg>
              {formatDayLabel(createdMs)}
            </span>
          )}
          {hasSchedule && (
            <span
              className={`task-date goal ${overdue ? "overdue" : ""}`}
              title={
                startMs !== null && goalMs !== null
                  ? "Start to goal date"
                  : startMs !== null
                    ? "Start date"
                    : overdue
                      ? "Goal date passed"
                      : "Goal date"
              }>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
              </svg>
              {startMs !== null && goalMs !== null
                ? `${formatDayLabel(startMs)} → ${formatDayLabel(goalMs)}`
                : startMs !== null
                  ? `From ${formatDayLabel(startMs)}`
                  : formatDayLabel(goalMs as number)}
            </span>
          )}
        </div>
      )}
      <div
        className={`task-actions ${isActive && !readOnly ? "visible" : ""}`}
        onClick={(event) => event.stopPropagation()}>
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
  readOnly: boolean;
};

function SortableColumn({
  column,
  tasks,
  onEditTask,
  onDeleteTask,
  onDeleteColumn,
  activeTaskId,
  onSelectTask,
  readOnly,
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
        zIndex: isDragging ? 50 : undefined,
        boxShadow: isDragging ? "var(--shadow-lg)" : undefined,
      }}
      className="kanban-column">
      <header
        className="column-header"
        style={{ borderTopColor: column.color }}>
        <div className="column-heading">
          <button
            type="button"
            className="drag-handle"
            {...(readOnly ? {} : attributes)}
            {...(readOnly ? {} : listeners)}>
            {column.title}
          </button>
          <span className="column-count">{tasks.length}</span>
        </div>
        {!readOnly && !PROTECTED_COLUMNS.has(column.id) && (
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
              statusDateLabel={buildTaskStatusDateLabel(task, column.id)}
              isActive={activeTaskId === task.id}
              onSelectTask={onSelectTask}
              readOnly={readOnly}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

type TimelineRow = {
  taskId: string;
  title: string;
  columnTitle: string;
  color: string;
  startIndex: number;
  endIndex: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  startMs: number;
  endMs: number;
  hasGoal: boolean;
  overdue: boolean;
  assigneeName?: string;
};

function TimelineDayCell({
  dayIndex,
  isToday,
}: {
  dayIndex: number;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `calendar-day-${dayIndex}` });

  return (
    <div
      ref={setNodeRef}
      className={`timeline-lane ${isToday ? "today" : ""} ${
        isOver ? "is-over" : ""
      }`}
    />
  );
}

function TimelineEdgeHandle({
  id,
  edge,
  label,
}: {
  id: string;
  edge: "start" | "goal";
  label: string;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });

  return (
    <span
      ref={setNodeRef}
      className={`timeline-handle ${edge}`}
      {...attributes}
      role="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        // Keep the press off the bar body, which would move the whole span.
        event.stopPropagation();
        listeners?.onPointerDown?.(event);
      }}
    />
  );
}

function TimelineBar({
  row,
  readOnly,
  onOpenTask,
}: {
  row: TimelineRow;
  readOnly: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `timeline-move-${row.taskId}`, disabled: readOnly });

  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const spanLabel = row.hasGoal
    ? `${formatDayLabel(row.startMs)} to ${formatDayLabel(row.endMs)}`
    : `${formatDayLabel(row.startMs)} - no goal date yet`;

  return (
    <div
      className="timeline-row"
      style={{ gridColumn: `${row.startIndex + 1} / ${row.endIndex + 2}` }}>
      <div
        ref={setNodeRef}
        className={`timeline-bar ${row.clippedStart ? "clipped-start" : ""} ${
          row.clippedEnd ? "clipped-end" : ""
        } ${row.hasGoal ? "" : "open-ended"} ${row.overdue ? "overdue" : ""} ${
          isDragging ? "dragging" : ""
        }`}
        style={{
          borderLeftColor: row.color,
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        }}
        title={`${row.title} · ${row.columnTitle} · ${spanLabel}`}
        {...(readOnly ? {} : attributes)}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
          if (!readOnly) {
            listeners?.onPointerDown?.(event);
          }
        }}
        onClick={(event) => {
          // A drag ends with a click too; only treat a stationary press as one.
          const start = pointerStart.current;
          pointerStart.current = null;
          if (
            (event.target as HTMLElement).closest(".timeline-handle") ||
            (start &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)
          ) {
            return;
          }
          onOpenTask(row.taskId);
        }}>
        {!readOnly && !row.clippedStart && (
          <TimelineEdgeHandle
            id={`timeline-start-${row.taskId}`}
            edge="start"
            label={`Move start date of ${row.title}`}
          />
        )}
        {row.assigneeName && (
          <span
            className="assignee-avatar"
            title={`Assigned to @${row.assigneeName}`}>
            {row.assigneeName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="timeline-bar-title">{row.title}</span>
        <span className="timeline-bar-meta">
          {row.hasGoal ? formatDayLabel(row.endMs) : "No goal"}
        </span>
        {!readOnly && !row.clippedEnd && (
          <TimelineEdgeHandle
            id={`timeline-goal-${row.taskId}`}
            edge="goal"
            label={`Move goal date of ${row.title}`}
          />
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const sensors = useSensors(useSensor(PointerSensor));
  const timelineSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [sessionUsername, setSessionUsername] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [loginState, setLoginState] = useState({
    username: "",
    password: "",
  });
  const [loginError, setLoginError] = useState("");

  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // One drawer serves both new and existing tasks, so the draft is shared.
  const [taskDrawerMode, setTaskDrawerMode] = useState<"create" | "edit" | null>(
    null,
  );
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetails, setDraftDetails] = useState("");
  const [draftCreatedDate, setDraftCreatedDate] = useState("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftGoalDate, setDraftGoalDate] = useState("");
  const [draftAssigneeId, setDraftAssigneeId] = useState("");
  const [draftColumnId, setDraftColumnId] = useState("todo");

  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState("untitled");
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState("");
  const [newViewName, setNewViewName] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<
    "board" | "calendar"
  >("board");
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);

  const [viewRecipients, setViewRecipients] = useState<{
    viewId: string;
    users: PlatformUser[];
  }>({ viewId: "", users: [] });

  const [shareView, setShareView] = useState<BoardView | null>(null);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [sharedUserIds, setSharedUserIds] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [isShareLoading, setIsShareLoading] = useState(false);
  const [pendingShareUserId, setPendingShareUserId] = useState<string | null>(
    null,
  );
  const [shareError, setShareError] = useState("");

  const views = useMemo(() => workspace?.views ?? [], [workspace]);

  const ownedViews = useMemo(
    () => views.filter((view) => !view.sharedBy),
    [views],
  );

  const sharedViews = useMemo(
    () => views.filter((view) => Boolean(view.sharedBy)),
    [views],
  );

  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? views[0],
    [activeViewId, views],
  );

  const board = activeView?.board ?? null;
  const activeViewName = activeView?.name ?? "Untitled view";
  const isReadOnlyView = Boolean(activeView?.sharedBy);
  const ownedViewId = activeView && !activeView.sharedBy ? activeView.id : "";

  const viewMembers = useMemo(() => {
    if (!ownedViewId || !sessionUserId || !sessionUsername) {
      return [] as PlatformUser[];
    }

    const owner: PlatformUser = { id: sessionUserId, username: sessionUsername };

    // Recipients from another dashboard are ignored until this one has loaded.
    return viewRecipients.viewId === ownedViewId
      ? [owner, ...viewRecipients.users]
      : [owner];
  }, [ownedViewId, sessionUserId, sessionUsername, viewRecipients]);

  const filteredShareUsers = useMemo(() => {
    const term = shareSearch.trim().toLowerCase();
    if (!term) return platformUsers;
    return platformUsers.filter((user) =>
      user.username.toLowerCase().includes(term),
    );
  }, [platformUsers, shareSearch]);

  const calendarWeekStart = useMemo(() => {
    const thisWeek = getStartOfWeek(new Date());
    return addDays(thisWeek, calendarWeekOffset * DAYS_PER_WEEK);
  }, [calendarWeekOffset]);

  const calendarDays = useMemo(
    () =>
      Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) =>
        addDays(calendarWeekStart, dayIndex),
      ),
    [calendarWeekStart],
  );

  const calendarWeekLabel = useMemo(() => {
    const weekEnd = addDays(calendarWeekStart, DAYS_PER_WEEK - 1);
    const sameMonth =
      calendarWeekStart.getMonth() === weekEnd.getMonth() &&
      calendarWeekStart.getFullYear() === weekEnd.getFullYear();

    if (sameMonth) {
      return `${calendarWeekStart.toLocaleDateString(undefined, {
        month: "long",
      })} ${calendarWeekStart.getDate()}-${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    }

    return `${calendarWeekStart.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} - ${weekEnd.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }, [calendarWeekStart]);

  const calendarEntries = useMemo(() => {
    if (!board) {
      return [] as CalendarEntry[];
    }

    const entries: CalendarEntry[] = [];

    for (const task of Object.values(board.tasks)) {
      const statusDates = task.statusDates;
      if (!statusDates) {
        continue;
      }

      for (const statusId of Object.keys(statusDates) as Array<
        "todo" | "doing" | "done"
      >) {
        const statusDate = statusDates[statusId];
        if (!statusDate) {
          continue;
        }

        const parsed = new Date(statusDate);
        const timestamp = parsed.getTime();
        if (Number.isNaN(timestamp)) {
          continue;
        }

        entries.push({
          id: `${task.id}-${statusId}`,
          taskId: task.id,
          taskTitle: task.title,
          statusId,
          statusLabel: STATUS_META[statusId].label,
          timestamp,
          dayStartMs: getLocalDayStartMs(parsed),
        });
      }
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }, [board]);

  const timelineRows = useMemo(() => {
    if (!board) {
      return [] as TimelineRow[];
    }

    const weekStartMs = calendarWeekStart.getTime();
    const weekEndMs = addDays(calendarWeekStart, DAYS_PER_WEEK).getTime();
    const todayMs = getLocalDayStartMs(new Date());
    const rows: TimelineRow[] = [];

    for (const column of board.columns) {
      if (column.id === "trash") {
        continue;
      }

      for (const taskId of column.taskIds) {
        const task = board.tasks[taskId];
        if (!task) continue;

        const goalMs = getDayStartMs(task.goalDate);
        const startCandidate = getTaskStartMs(task) ?? goalMs;
        if (startCandidate === null) continue;

        // A goal before the start still draws a span, just the other way round.
        const spanStartMs = goalMs === null ? startCandidate : Math.min(startCandidate, goalMs);
        const spanEndMs = goalMs === null ? startCandidate : Math.max(startCandidate, goalMs);

        if (spanEndMs < weekStartMs || spanStartMs >= weekEndMs) {
          continue;
        }

        const startIndex = Math.max(
          0,
          Math.round((spanStartMs - weekStartMs) / MS_PER_DAY),
        );
        const endIndex = Math.min(
          DAYS_PER_WEEK - 1,
          Math.round((spanEndMs - weekStartMs) / MS_PER_DAY),
        );

        rows.push({
          taskId: task.id,
          title: task.title,
          columnTitle: column.title,
          color: column.color,
          startIndex,
          endIndex: Math.max(startIndex, endIndex),
          clippedStart: spanStartMs < weekStartMs,
          clippedEnd: spanEndMs >= weekEndMs,
          startMs: spanStartMs,
          endMs: spanEndMs,
          hasGoal: goalMs !== null,
          overdue: goalMs !== null && goalMs < todayMs && column.id !== "done",
          assigneeName: task.assigneeName,
        });
      }
    }

    return rows.sort(
      (a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title),
    );
  }, [board, calendarWeekStart]);

  const calendarEntriesByDay = useMemo(() => {
    const weekStartMs = calendarWeekStart.getTime();
    const weekEndMs = addDays(calendarWeekStart, DAYS_PER_WEEK).getTime();
    const groupedByTask = new Map<number, Map<string, CalendarEntry>>();

    for (const entry of calendarEntries) {
      if (entry.dayStartMs < weekStartMs || entry.dayStartMs >= weekEndMs) {
        continue;
      }

      let dayMap = groupedByTask.get(entry.dayStartMs);
      if (!dayMap) {
        dayMap = new Map<string, CalendarEntry>();
        groupedByTask.set(entry.dayStartMs, dayMap);
      }

      const existingForTask = dayMap.get(entry.taskId);
      if (!existingForTask || entry.timestamp >= existingForTask.timestamp) {
        dayMap.set(entry.taskId, entry);
      }
    }

    const grouped = new Map<number, CalendarEntry[]>();
    for (const [dayStartMs, dayEntriesMap] of groupedByTask.entries()) {
      grouped.set(
        dayStartMs,
        Array.from(dayEntriesMap.values()).sort(
          (a, b) => b.timestamp - a.timestamp,
        ),
      );
    }

    return grouped;
  }, [calendarEntries, calendarWeekStart]);

  useEffect(() => {
    async function bootstrapSession() {
      try {
        const response = await fetch("/api/auth/session");
        const data = (await response.json()) as {
          authenticated: boolean;
          username?: string | null;
          userId?: string | null;
        };
        setIsAuthenticated(data.authenticated);
        setSessionUsername(data.username ?? null);
        setSessionUserId(data.userId ?? null);
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
            setCalendarWeekOffset(0);
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

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      setTaskDrawerMode(null);
      setEditingTask(null);
      setIsColumnDialogOpen(false);
      setShareView(null);
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Assignable people for a dashboard: its owner plus everyone it is shared with.
  useEffect(() => {
    let cancelled = false;

    async function loadRecipients() {
      if (!ownedViewId) return;

      try {
        const response = await fetch(
          `/api/share?viewId=${encodeURIComponent(ownedViewId)}`,
        );
        if (!response.ok) throw new Error("Could not load members");

        const payload = (await response.json()) as { users: PlatformUser[] };
        if (!cancelled) {
          setViewRecipients({ viewId: ownedViewId, users: payload.users });
        }
      } catch {
        if (!cancelled) {
          setViewRecipients({ viewId: ownedViewId, users: [] });
        }
      }
    }

    void loadRecipients();
    return () => {
      cancelled = true;
    };
  }, [ownedViewId]);

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
      setCalendarWeekOffset(0);
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
        body: JSON.stringify({
          views: nextWorkspace.views.filter((view) => !view.sharedBy),
        } satisfies WorkspaceData),
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
    if (!workspace || !activeView || activeView.sharedBy) return null;

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

    const payload = (await response.json()) as {
      username?: string;
      userId?: string;
    };

    setSessionUsername(payload.username ?? loginState.username.trim());
    setSessionUserId(payload.userId ?? null);
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

    const payload = (await response.json()) as {
      username?: string;
      userId?: string;
    };
    setSessionUsername(payload.username ?? loginState.username.trim());
    setSessionUserId(payload.userId ?? null);
    setIsAuthenticated(true);
    await loadWorkspace();
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsAuthenticated(false);
    setSessionUsername(null);
    setSessionUserId(null);
    setWorkspace(null);
  }

  function openTaskDrawer(mode: "create" | "edit", task?: Task) {
    if (isReadOnlyView) return;

    if (mode === "create") {
      const fallbackColumn =
        board?.columns.find((column) => column.id === "todo") ??
        board?.columns.find((column) => column.id !== "trash");

      setEditingTask(null);
      setDraftTitle("");
      setDraftDetails("");
      setDraftCreatedDate("");
      setDraftStartDate("");
      setDraftGoalDate("");
      setDraftAssigneeId("");
      setDraftColumnId(fallbackColumn?.id ?? "todo");
    } else if (task && board) {
      setEditingTask(task);
      setDraftTitle(task.title);
      setDraftDetails(sanitizeRichText(task.details));
      setDraftCreatedDate(toDayValueOrEmpty(task.createdAt));
      setDraftStartDate(toDayValueOrEmpty(task.startDate));
      setDraftGoalDate(toDayValueOrEmpty(task.goalDate));
      setDraftAssigneeId(task.assigneeId ?? "");
      setDraftColumnId(findTaskColumn(board, task.id)?.id ?? "todo");
    } else {
      return;
    }

    setTaskDrawerMode(mode);
  }

  function closeTaskDrawer() {
    setTaskDrawerMode(null);
    setEditingTask(null);
  }

  /** Adds a new task or saves the one being edited, including a column move. */
  async function handleTaskDrawerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!board || !workspace || !activeView || isReadOnlyView) return;

    const title = draftTitle.trim();
    if (!title) return;

    const details = sanitizeRichText(draftDetails);
    const targetColumnId =
      board.columns.find((column) => column.id === draftColumnId)?.id ??
      board.columns[0]?.id;
    if (!targetColumnId) return;

    const statusId = getTrackedStatusColumnId(targetColumnId);
    const isCreate = taskDrawerMode === "create" || !editingTask;
    const taskId = isCreate ? buildTaskId() : editingTask.id;
    const sourceColumnId = isCreate
      ? null
      : (findTaskColumn(board, taskId)?.id ?? null);

    const nextTask: Task = isCreate
      ? { id: taskId, title, createdAt: new Date().toISOString() }
      : { ...editingTask, title };

    for (const [key, value] of [
      ["details", details],
      ["startDate", draftStartDate],
      ["goalDate", draftGoalDate],
    ] as const) {
      if (value) {
        nextTask[key] = value;
      } else {
        delete nextTask[key];
      }
    }

    delete nextTask.assigneeId;
    delete nextTask.assigneeName;
    Object.assign(
      nextTask,
      buildAssignee(draftAssigneeId, [
        ...viewMembers,
        ...(editingTask?.assigneeId && editingTask.assigneeName
          ? [{ id: editingTask.assigneeId, username: editingTask.assigneeName }]
          : []),
      ]),
    );

    if (isCreate) {
      if (statusId) {
        nextTask.statusDates = { [statusId]: new Date().toISOString() };
      }
    } else {
      // Keep the original stamp unless the day itself was changed.
      const createdDayChanged =
        draftCreatedDate !== toDayValueOrEmpty(editingTask.createdAt);
      if (draftCreatedDate && createdDayChanged) {
        nextTask.createdAt = dayValueToTimestamp(draftCreatedDate);
      } else if (!draftCreatedDate) {
        delete nextTask.createdAt;
      }

      // Moving to another column counts as reaching that status today.
      if (sourceColumnId !== targetColumnId && statusId) {
        nextTask.statusDates = {
          ...nextTask.statusDates,
          [statusId]: new Date().toISOString(),
        };
      }
    }

    const columns = board.columns.map((column) => {
      const withoutTask = column.taskIds.filter((id) => id !== taskId);

      if (column.id === targetColumnId) {
        return { ...column, taskIds: [...withoutTask, taskId] };
      }

      return withoutTask.length === column.taskIds.length
        ? column
        : { ...column, taskIds: withoutTask };
    });

    const nextBoard: BoardData = {
      columns,
      tasks: { ...board.tasks, [taskId]: nextTask },
    };

    closeTaskDrawer();
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleDeleteTask(task: Task) {
    if (!board || !workspace || !activeView || isReadOnlyView) return;

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
    if (!board || !workspace || !activeView || isReadOnlyView) return;

    const title = newColumnTitle.trim();
    if (!title) return;

    setIsColumnDialogOpen(false);

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
    if (
      !board ||
      PROTECTED_COLUMNS.has(columnId) ||
      !workspace ||
      !activeView ||
      isReadOnlyView
    )
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

    if (draftColumnId === columnId) {
      setDraftColumnId("todo");
    }

    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!board || !event.over || !workspace || !activeView || isReadOnlyView)
      return;

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

    const destinationStatusId = getTrackedStatusColumnId(destinationColumnId);
    const activeTask = board.tasks[activeId];

    const nextTasks =
      destinationStatusId && activeTask
        ? {
            ...board.tasks,
            [activeId]: {
              ...activeTask,
              statusDates: {
                ...activeTask.statusDates,
                [destinationStatusId]: new Date().toISOString(),
              },
            },
          }
        : board.tasks;

    const nextBoard: BoardData = {
      ...board,
      columns: nextColumns,
      tasks: nextTasks,
    };
    const nextWorkspace = replaceActiveViewBoard(nextBoard);
    if (!nextWorkspace) return;
    await persistWorkspace(nextWorkspace);
  }

  /** Dropping a bar body moves the whole span; an edge moves just that date. */
  async function handleTimelineDragEnd(event: DragEndEvent) {
    if (!board || !event.over || !workspace || !activeView || isReadOnlyView) {
      return;
    }

    const dragged = /^timeline-(move|start|goal)-(.+)$/.exec(
      String(event.active.id),
    );
    const dayIndex = Number(String(event.over.id).replace("calendar-day-", ""));
    const targetDay = calendarDays[dayIndex];
    if (!dragged || !targetDay) return;

    const [, mode, taskId] = dragged;
    const task = board.tasks[taskId];
    if (!task) return;

    const effectiveStartMs = getTaskStartMs(task);
    const update = computeScheduleUpdate({
      startDayValue: task.startDate
        ? task.startDate
        : effectiveStartMs === null
          ? ""
          : toDayValue(new Date(effectiveStartMs)),
      goalDayValue: task.goalDate ?? "",
      hasExplicitStart: Boolean(task.startDate),
      mode: mode as ScheduleMode,
      targetDayValue: toDayValue(targetDay),
    });

    if (!update) return;

    const nextTask: Task = { ...task };
    if (update.startDate) {
      nextTask.startDate = update.startDate;
    } else {
      delete nextTask.startDate;
    }

    if (update.goalDate) {
      nextTask.goalDate = update.goalDate;
    } else {
      delete nextTask.goalDate;
    }

    const nextBoard: BoardData = {
      ...board,
      tasks: {
        ...board.tasks,
        [taskId]: nextTask,
      },
    };

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
    setCalendarWeekOffset(0);
    setNewViewName("");
    setDraftColumnId("todo");
    await persistWorkspace(nextWorkspace);
  }

  async function handleDeleteView(viewId: string) {
    if (!workspace || ownedViews.length <= 1) return;

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
    setCalendarWeekOffset(0);
    await persistWorkspace(nextWorkspace);
  }

  async function openShareDialog(view: BoardView) {
    setShareView(view);
    setShareSearch("");
    setShareError("");
    setPlatformUsers([]);
    setSharedUserIds([]);
    setIsShareLoading(true);

    try {
      const [usersResponse, sharesResponse] = await Promise.all([
        fetch("/api/users"),
        fetch(`/api/share?viewId=${encodeURIComponent(view.id)}`),
      ]);

      if (!usersResponse.ok || !sharesResponse.ok) {
        throw new Error("Could not load users.");
      }

      const usersPayload = (await usersResponse.json()) as {
        users: PlatformUser[];
      };
      const sharesPayload = (await sharesResponse.json()) as {
        users: PlatformUser[];
      };

      setPlatformUsers(usersPayload.users);
      setSharedUserIds(sharesPayload.users.map((user) => user.id));
    } catch {
      setShareError("Could not load users.");
    } finally {
      setIsShareLoading(false);
    }
  }

  function closeShareDialog() {
    setShareView(null);
    setPendingShareUserId(null);
    setShareError("");
    setShareSearch("");
  }

  async function toggleShareWithUser(user: PlatformUser, isShared: boolean) {
    if (!shareView) return;

    setPendingShareUserId(user.id);
    setShareError("");

    try {
      const response = await fetch("/api/share", {
        method: isShared ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewId: shareView.id, userId: user.id }),
      });

      const payload = (await response.json()) as {
        users?: PlatformUser[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not update sharing.");
      }

      const recipients = payload.users ?? [];
      setSharedUserIds(recipients.map((entry) => entry.id));

      // Sharing changes who can be assigned on the dashboard being viewed.
      if (shareView.id === ownedViewId) {
        setViewRecipients({ viewId: ownedViewId, users: recipients });
      }
    } catch (error) {
      setShareError(
        error instanceof Error ? error.message : "Could not update sharing.",
      );
    } finally {
      setPendingShareUserId(null);
    }
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
        <button
          type="button"
          className="new-task-btn"
          disabled={isReadOnlyView}
          onClick={() => openTaskDrawer("create")}>
          New Task
        </button>

        <div className="nav-group">
          <p>Views</p>
          <ul>
            {ownedViews.map((view) => (
              <li
                key={view.id}
                className={activeViewId === view.id ? "active" : ""}
                onClick={() => {
                  setActiveViewId(view.id);
                  setCalendarWeekOffset(0);
                }}>
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
                        aria-label={`Share ${view.name}`}
                        title="Share dashboard"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openShareDialog(view);
                        }}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.1c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .3 0 .5.1.7L8 9.9c-.5-.5-1.2-.8-2-.8-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.6 1.3 2.9 2.9 2.9s2.9-1.3 2.9-2.9-1.2-3-2.8-3z" />
                        </svg>
                      </button>
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
                        disabled={ownedViews.length <= 1}
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

        {sharedViews.length > 0 && (
          <div className="nav-group">
            <p>Shared with me</p>
            <ul>
              {sharedViews.map((view) => (
                <li
                  key={view.id}
                  className={activeViewId === view.id ? "active" : ""}
                  onClick={() => {
                    setActiveViewId(view.id);
                    setCalendarWeekOffset(0);
                    setActiveTaskId(null);
                  }}>
                  <span className="shared-view-label">
                    <span>{view.name}</span>
                    <small>@{view.sharedBy}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div>
            <h1>
              {activeViewName}
              {isReadOnlyView && (
                <span className="shared-badge">Shared with you</span>
              )}
            </h1>
            <p>
              {isReadOnlyView
                ? `Shared by @${activeView.sharedBy} · read-only`
                : activeWorkspaceTab === "board"
                  ? `${board.columns.length} columns · ${
                      Object.keys(board.tasks).length
                    } tasks`
                  : `Weekly schedule · ${calendarWeekLabel}`}
              {sessionUsername && <span> · @{sessionUsername}</span>}
              {isSaving && <span className="saving-pill">Saving...</span>}
            </p>
          </div>
          <div className="topbar-actions">
            <div className="workspace-mode-tabs" role="tablist" aria-label="View mode">
              <button
                type="button"
                className={activeWorkspaceTab === "board" ? "active" : ""}
                role="tab"
                aria-selected={activeWorkspaceTab === "board"}
                onClick={() => setActiveWorkspaceTab("board")}>
                Board
              </button>
              <button
                type="button"
                className={activeWorkspaceTab === "calendar" ? "active" : ""}
                role="tab"
                aria-selected={activeWorkspaceTab === "calendar"}
                onClick={() => setActiveWorkspaceTab("calendar")}>
                Calendar
              </button>
            </div>

            {!isReadOnlyView && (
              <>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => openTaskDrawer("create")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" />
                  </svg>
                  Add Task
                </button>
                {activeWorkspaceTab === "board" && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setNewColumnTitle("");
                      setIsColumnDialogOpen(true);
                    }}>
                    Add Column
                  </button>
                )}
              </>
            )}

            <button type="button" className="ghost" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>


        {errorMessage && <p className="error-text">{errorMessage}</p>}

        {activeWorkspaceTab === "board" ? (
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
                    onEditTask={(task) => openTaskDrawer("edit", task)}
                    onDeleteTask={handleDeleteTask}
                    onDeleteColumn={handleDeleteColumn}
                    activeTaskId={activeTaskId}
                    onSelectTask={(taskId) =>
                      setActiveTaskId((current) =>
                        current === taskId ? null : taskId,
                      )
                    }
                    readOnly={isReadOnlyView}
                  />
                ))}
              </section>
            </SortableContext>
          </DndContext>
        ) : (
          <>
            <section className="calendar-timeline" aria-label="Task schedule">
              <header className="timeline-header">
                <div className="calendar-nav">
                  <button
                    type="button"
                    className="ghost"
                    aria-label="Previous week"
                    onClick={() => setCalendarWeekOffset((offset) => offset - 1)}>
                    ‹
                  </button>
                  <strong>{calendarWeekLabel}</strong>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="Next week"
                    onClick={() => setCalendarWeekOffset((offset) => offset + 1)}>
                    ›
                  </button>
                  {calendarWeekOffset !== 0 && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setCalendarWeekOffset(0)}>
                      Today
                    </button>
                  )}
                </div>
                <div>
                  <h2>Schedule</h2>
                  <p>
                    Each bar runs from the start date (or creation, if none) to
                    the goal date.
                    {!isReadOnlyView &&
                      " Drag a bar to move the whole span, or drag its edges to change the start and goal."}
                  </p>
                </div>
              </header>

              <div className="timeline-days">
                {calendarDays.map((day) => (
                  <div
                    key={`head-${getLocalDayStartMs(day)}`}
                    className={`timeline-day-head ${
                      getLocalDayStartMs(day) ===
                      getLocalDayStartMs(new Date())
                        ? "today"
                        : ""
                    }`}>
                    <p>{WEEKDAY_LABEL_FORMATTER.format(day)}</p>
                    <span>{MONTH_DAY_LABEL_FORMATTER.format(day)}</span>
                  </div>
                ))}
              </div>

              <DndContext
                sensors={timelineSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleTimelineDragEnd}>
                <div className="timeline-body">
                  <div className="timeline-lanes" aria-hidden="true">
                    {calendarDays.map((day, dayIndex) => (
                      <TimelineDayCell
                        key={`lane-${getLocalDayStartMs(day)}`}
                        dayIndex={dayIndex}
                        isToday={
                          getLocalDayStartMs(day) ===
                          getLocalDayStartMs(new Date())
                        }
                      />
                    ))}
                  </div>

                  {timelineRows.length === 0 ? (
                    <p className="timeline-empty">
                      No tasks scheduled this week. Add a start or goal date to
                      place a task on the timeline.
                    </p>
                  ) : (
                    <div className="timeline-rows">
                      {timelineRows.map((row) => (
                        <TimelineBar
                          key={row.taskId}
                          row={row}
                          readOnly={isReadOnlyView}
                          onOpenTask={(taskId) => {
                            const task = board.tasks[taskId];
                            if (task) openTaskDrawer("edit", task);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </DndContext>
            </section>

            <section
              className="calendar-grid"
              aria-label="Weekly activity calendar">
              {calendarDays.map((day) => {
                const dayStartMs = getLocalDayStartMs(day);
                const entriesForDay =
                  calendarEntriesByDay.get(dayStartMs) ?? [];

                return (
                  <article key={dayStartMs} className="calendar-day">
                    <header>
                      <p>{WEEKDAY_LABEL_FORMATTER.format(day)}</p>
                      <h3>{MONTH_DAY_LABEL_FORMATTER.format(day)}</h3>
                    </header>

                    {entriesForDay.length === 0 ? (
                      <p className="calendar-empty">No activity</p>
                    ) : (
                      <ul>
                        {entriesForDay.map((entry) => (
                          <li key={entry.id}>
                            <span
                              className={`calendar-status-pill status-${entry.statusId}`}>
                              {entry.statusLabel}
                            </span>
                            <strong>{entry.taskTitle}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </section>
          </>
        )}
      </section>


      {taskDrawerMode && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onClick={closeTaskDrawer}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={
              taskDrawerMode === "create" ? "New task" : "Edit task"
            }
            onClick={(event) => event.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <h2>{taskDrawerMode === "create" ? "New task" : "Edit task"}</h2>
                <p>{activeViewName}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={closeTaskDrawer}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5L5.6 17l5-5-5-5L12 5.6l0 0 0 5z" />
                </svg>
              </button>
            </header>

            <form
              id="task-drawer-form"
              className="drawer-body"
              onSubmit={handleTaskDrawerSubmit}>
              <div className="field">
                <label htmlFor="drawer-task-title">Title</label>
                <input
                  id="drawer-task-title"
                  autoFocus
                  placeholder="What needs doing?"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="drawer-task-details">Task</label>
                <RichTextEditor
                  id="drawer-task-details"
                  value={draftDetails}
                  onChange={setDraftDetails}
                  placeholder="Describe the task. Use the toolbar for bold, italics and lists."
                  ariaLabel="Task details"
                />
              </div>

              <div className="date-fields">
                <div className="field">
                  <label htmlFor="drawer-task-column">Column</label>
                  <select
                    id="drawer-task-column"
                    value={draftColumnId}
                    onChange={(event) => setDraftColumnId(event.target.value)}>
                    {board.columns
                      .filter(
                        (column) =>
                          column.id !== "trash" || column.id === draftColumnId,
                      )
                      .map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.title}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="drawer-task-assignee">Assign to</label>
                  <select
                    id="drawer-task-assignee"
                    value={draftAssigneeId}
                    onChange={(event) => setDraftAssigneeId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {viewMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        @{member.username}
                        {member.id === sessionUserId ? " (you)" : ""}
                      </option>
                    ))}
                    {draftAssigneeId &&
                      !viewMembers.some(
                        (member) => member.id === draftAssigneeId,
                      ) && (
                        <option value={draftAssigneeId}>
                          @{editingTask?.assigneeName ?? "unknown"} (no longer
                          shared)
                        </option>
                      )}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="drawer-task-start">Start date</label>
                  <input
                    id="drawer-task-start"
                    type="date"
                    className="date-input"
                    value={draftStartDate}
                    onChange={(event) => setDraftStartDate(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="drawer-task-goal">Goal date</label>
                  <input
                    id="drawer-task-goal"
                    type="date"
                    className="date-input"
                    value={draftGoalDate}
                    onChange={(event) => setDraftGoalDate(event.target.value)}
                  />
                </div>

                {taskDrawerMode === "edit" && (
                  <div className="field">
                    <label htmlFor="drawer-task-created">Created date</label>
                    <input
                      id="drawer-task-created"
                      type="date"
                      className="date-input"
                      value={draftCreatedDate}
                      onChange={(event) =>
                        setDraftCreatedDate(event.target.value)
                      }
                    />
                  </div>
                )}
              </div>
            </form>

            <footer className="drawer-footer">
              <button type="button" className="ghost" onClick={closeTaskDrawer}>
                Cancel
              </button>
              <button
                type="submit"
                form="task-drawer-form"
                disabled={!draftTitle.trim()}>
                {taskDrawerMode === "create" ? "Add task" : "Save changes"}
              </button>
            </footer>
          </aside>
        </div>
      )}

      {isColumnDialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setIsColumnDialogOpen(false)}>
          <form
            className="modal column-modal"
            onSubmit={handleAddColumn}
            onClick={(event) => event.stopPropagation()}>
            <h2>Add column</h2>
            <div className="field">
              <label htmlFor="new-column-title">Column title</label>
              <input
                id="new-column-title"
                autoFocus
                placeholder="e.g. In Review"
                value={newColumnTitle}
                onChange={(event) => setNewColumnTitle(event.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setIsColumnDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={!newColumnTitle.trim()}>
                Add column
              </button>
            </div>
          </form>
        </div>
      )}

      {shareView && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeShareDialog}>
          <div
            className="modal share-modal"
            role="dialog"
            aria-label={`Share ${shareView.name}`}
            onClick={(event) => event.stopPropagation()}>
            <h2>Share &ldquo;{shareView.name}&rdquo;</h2>
            <p className="share-hint">
              Pick the people who should see this dashboard. They get read-only
              access.
            </p>

            <input
              className="share-search"
              placeholder="Search users..."
              value={shareSearch}
              onChange={(event) => setShareSearch(event.target.value)}
            />

            {shareError && <p className="error-text">{shareError}</p>}

            {isShareLoading ? (
              <p className="share-empty">Loading users...</p>
            ) : filteredShareUsers.length === 0 ? (
              <p className="share-empty">
                {platformUsers.length === 0
                  ? "No other users have signed up yet."
                  : "No users match that search."}
              </p>
            ) : (
              <ul className="share-user-list">
                {filteredShareUsers.map((user) => {
                  const isShared = sharedUserIds.includes(user.id);
                  const isPending = pendingShareUserId === user.id;

                  return (
                    <li key={user.id} className={isShared ? "shared" : ""}>
                      <span className="share-avatar" aria-hidden="true">
                        {user.username.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="share-username">@{user.username}</span>
                      <button
                        type="button"
                        className={isShared ? "ghost" : ""}
                        disabled={isPending}
                        onClick={() => void toggleShareWithUser(user, isShared)}>
                        {isPending
                          ? "Saving..."
                          : isShared
                            ? "Remove"
                            : "Share"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="share-count">
              {sharedUserIds.length === 0
                ? "Not shared with anyone yet."
                : `Shared with ${sharedUserIds.length} ${
                    sharedUserIds.length === 1 ? "person" : "people"
                  }.`}
            </p>

            <div className="modal-actions">
              <button type="button" onClick={closeShareDialog}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
