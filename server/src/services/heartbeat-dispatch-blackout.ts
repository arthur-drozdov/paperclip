type DispatchBlackoutWindow = {
  timeZone: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
};

export type DispatchBlackoutMatch = {
  blocked: boolean;
  label: string | null;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseClockMinute(value: unknown, allowEndOfDay = false): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (allowEndOfDay && hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseWindow(value: unknown): DispatchBlackoutWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const timeZone = typeof record.timeZone === "string" ? record.timeZone.trim() : "";
  const startMinute = parseClockMinute(record.start);
  const endMinute = parseClockMinute(record.end, true);
  if (!timeZone || startMinute === null || endMinute === null || startMinute === endMinute) {
    return null;
  }

  const rawDays = Array.isArray(record.daysOfWeek) ? record.daysOfWeek : null;
  const daysOfWeek = rawDays
    ? [...new Set(rawDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [0, 1, 2, 3, 4, 5, 6];
  if (daysOfWeek.length === 0) return null;

  try {
    getFormatter(timeZone).format(new Date(0));
  } catch {
    return null;
  }

  return { timeZone, daysOfWeek, startMinute, endMinute };
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedWeekdayAndMinute(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAY_INDEX[parts.weekday ?? ""];
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { weekday, minuteOfDay: hour * 60 + minute };
}

function windowMatches(window: DispatchBlackoutWindow, now: Date): boolean {
  const local = zonedWeekdayAndMinute(now, window.timeZone);
  if (!local) return false;

  if (window.startMinute < window.endMinute) {
    return window.daysOfWeek.includes(local.weekday) &&
      local.minuteOfDay >= window.startMinute &&
      local.minuteOfDay < window.endMinute;
  }

  if (local.minuteOfDay >= window.startMinute) {
    return window.daysOfWeek.includes(local.weekday);
  }
  const previousWeekday = (local.weekday + 6) % 7;
  return local.minuteOfDay < window.endMinute && window.daysOfWeek.includes(previousWeekday);
}

/**
 * Evaluate optional heartbeat.dispatchBlackouts entries.
 *
 * A match prevents a queued run from being claimed. The wake and run remain
 * queued, so the normal scheduler resumes them after the blackout ends.
 * Malformed entries are ignored to preserve compatibility with existing
 * untyped runtimeConfig payloads.
 */
export function evaluateHeartbeatDispatchBlackout(
  heartbeatConfig: unknown,
  now = new Date(),
): DispatchBlackoutMatch {
  const heartbeat = asRecord(heartbeatConfig);
  const rawWindows = heartbeat && Array.isArray(heartbeat.dispatchBlackouts)
    ? heartbeat.dispatchBlackouts
    : [];

  for (const rawWindow of rawWindows) {
    const window = parseWindow(rawWindow);
    if (!window || !windowMatches(window, now)) continue;
    const record = asRecord(rawWindow);
    return {
      blocked: true,
      label: typeof record?.label === "string" && record.label.trim()
        ? record.label.trim()
        : null,
    };
  }
  return { blocked: false, label: null };
}
