export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Goal dates are stored as plain calendar days ("2026-08-12"), never timestamps. */
const DAY_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getLocalDayStartMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function toDayValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses either a day value or an ISO timestamp into the local start of day. */
export function parseDayStart(value: unknown): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  if (DAY_VALUE_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);

    // `new Date(2026, 12, 45)` silently rolls over, so reject impossible days.
    const isRealDay =
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day;

    return isRealDay ? parsed : null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(getLocalDayStartMs(parsed));
}

export function getDayStartMs(value: unknown): number | null {
  return parseDayStart(value)?.getTime() ?? null;
}

export function sanitizeDayValue(input: unknown): string {
  const parsed = parseDayStart(input);
  return parsed ? toDayValue(parsed) : "";
}

export function sanitizeTimestamp(input: unknown): string {
  if (typeof input !== "string" || !input) {
    return "";
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/** Midday keeps the stamp on the intended calendar day across DST shifts. */
export function dayValueToTimestamp(dayValue: string): string {
  const parsed = parseDayStart(dayValue);
  if (!parsed) return "";

  parsed.setHours(12, 0, 0, 0);
  return parsed.toISOString();
}

export type ScheduleMode = "move" | "start" | "goal";

export type ScheduleUpdate = {
  /** "" clears the field. */
  startDate: string;
  goalDate: string;
};

/**
 * Works out the new start/goal days when a timeline bar is dragged: the body
 * moves the whole span, the edges move one end. A start never ends up after its
 * goal — the other end is pushed along instead.
 */
export function computeScheduleUpdate(params: {
  startDayValue: string;
  goalDayValue: string;
  hasExplicitStart: boolean;
  mode: ScheduleMode;
  targetDayValue: string;
}): ScheduleUpdate | null {
  const { hasExplicitStart, mode, targetDayValue } = params;

  const targetMs = getDayStartMs(targetDayValue);
  if (targetMs === null) return null;

  const startMs = getDayStartMs(params.startDayValue);
  const goalMs = getDayStartMs(params.goalDayValue);

  const asDayValue = (ms: number) => toDayValue(new Date(ms));
  const currentStart = hasExplicitStart ? params.startDayValue : "";
  let next: ScheduleUpdate;

  if (mode === "start") {
    next = {
      startDate: targetDayValue,
      goalDate:
        goalMs !== null && goalMs < targetMs
          ? targetDayValue
          : params.goalDayValue,
    };
  } else if (mode === "goal") {
    next = {
      startDate:
        hasExplicitStart && startMs !== null && startMs > targetMs
          ? targetDayValue
          : currentStart,
      goalDate: targetDayValue,
    };
  } else if (goalMs === null) {
    // Nothing to span yet: an explicit start moves, otherwise set the goal.
    next = hasExplicitStart
      ? { startDate: targetDayValue, goalDate: "" }
      : { startDate: currentStart, goalDate: targetDayValue };
  } else {
    // Move the whole bar, keeping its length. Dragging pins the start.
    const spanMs = startMs === null ? 0 : Math.max(0, goalMs - startMs);
    next = {
      startDate: targetDayValue,
      goalDate: asDayValue(targetMs + spanMs),
    };
  }

  if (next.startDate === currentStart && next.goalDate === params.goalDayValue) {
    return null;
  }

  return next;
}

export function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}
