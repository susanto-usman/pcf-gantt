import { Density, GanttRow, GanttSelection, GanttTask, Timeline, TimelineBand, TimelineTick, TimeScale } from "./types";

const MS_PER_DAY = 86400000;

/** Column width in pixels for each scale, per density. */
const COLUMN_WIDTH: Record<TimeScale, Record<Density, number>> = {
    day: { comfortable: 40, compact: 28 },
    week: { comfortable: 64, compact: 44 },
    month: { comfortable: 88, compact: 60 },
};

export const ROW_HEIGHT: Record<Density, number> = { comfortable: 44, compact: 30 };
export const BAR_HEIGHT: Record<Density, number> = { comfortable: 20, compact: 14 };

export function startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}

export function startOfWeek(date: Date): Date {
    const result = startOfDay(date);
    return addDays(result, -result.getDay());
}

export function startOfMonth(date: Date): Date {
    const result = startOfDay(date);
    result.setDate(1);
    return result;
}

/** Whole days between two dates, ignoring time of day and DST shifts. */
export function diffInDays(start: Date, end: Date): number {
    const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((utcEnd - utcStart) / MS_PER_DAY);
}

export function isSameDay(left: Date, right: Date): boolean {
    return diffInDays(left, right) === 0;
}

export function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
}

/**
 * Building an Intl formatter costs far more than formatting with one, and the
 * timeline formats a label per column, so they are built once and kept.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatWith(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = JSON.stringify(options);
    let formatter = formatters.get(key);

    if (!formatter) {
        formatter = new Intl.DateTimeFormat(undefined, options);
        formatters.set(key, formatter);
    }

    return formatter;
}

export function formatDate(date: Date): string {
    return formatWith({ day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** True when a value carries a time of day rather than sitting at midnight. */
export function hasTimeOfDay(date: Date): boolean {
    return date.getHours() + date.getMinutes() + date.getSeconds() + date.getMilliseconds() > 0;
}

/** The date alone for a date-only value, and the time of day as well for the rest. */
export function formatDateTime(date: Date): string {
    return hasTimeOfDay(date)
        ? formatWith({
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
          }).format(date)
        : formatDate(date);
}

/**
 * Where a task stops, as an exclusive instant. A date-only end is inclusive of
 * its whole day, so it runs to the following midnight; an end carrying a time
 * stops at that time.
 */
export function exclusiveEnd(end: Date): Date {
    return hasTimeOfDay(end) ? end : addDays(end, 1);
}

/** Prefix for synthesised merged-row ids, keeping them clear of record ids. */
const MERGED_ROW_PREFIX = "row:";

interface RowUnits {
    /** One task per row: plain tasks as-is, plus a synthesised task per row key. */
    units: GanttTask[];
    segmentsOf: Map<string, GanttTask[]>;
    /** Working days a unit contributes to rolled-up progress, excluding gaps. */
    weightOf: Map<string, number>;
}

/**
 * Collapses tasks sharing a row key into one synthesised task per key, so the
 * hierarchy treats each merged row as a single node. The merged row takes the
 * position of its first record and the first parent any of its records names,
 * and is titled with the first row title its records carry.
 */
function buildRowUnits(tasks: GanttTask[]): RowUnits {
    const units: GanttTask[] = [];
    const segmentsOf = new Map<string, GanttTask[]>();
    const weightOf = new Map<string, number>();
    const grouped = new Map<string, GanttTask[]>();

    for (const task of tasks) {
        if (!task.rowKey) {
            units.push(task);
            segmentsOf.set(task.id, [task]);
            weightOf.set(task.id, durationInDays(task));
            continue;
        }

        const group = grouped.get(task.rowKey);

        if (group) {
            group.push(task);
            continue;
        }

        grouped.set(task.rowKey, [task]);
        // Placeholder, replaced below once every segment has been collected.
        units.push(task);
    }

    for (let index = 0; index < units.length; index++) {
        const first = units[index];

        if (!first.rowKey) {
            continue;
        }

        const segments = (grouped.get(first.rowKey) ?? [first])
            .slice()
            .sort((a, b) => a.start.getTime() - b.start.getTime());
        let start = segments[0].start;
        let end = segments[0].end;
        let weight = 0;
        let weightedProgress = 0;

        for (const segment of segments) {
            start = segment.start < start ? segment.start : start;
            end = segment.end > end ? segment.end : end;
            weight += durationInDays(segment);
            weightedProgress += segment.progress * durationInDays(segment);
        }

        const categories = new Set(segments.map((segment) => segment.category));
        const merged: GanttTask = {
            id: `${MERGED_ROW_PREFIX}${first.rowKey}`,
            title: segments.find((segment) => segment.rowTitle)?.rowTitle ?? first.rowKey,
            start,
            end,
            progress: weight > 0 ? Math.round(weightedProgress / weight) : 0,
            parentId: segments.find((segment) => segment.parentId)?.parentId ?? null,
            category: categories.size === 1 ? segments[0].category : null,
            rowKey: first.rowKey,
            rowTitle: null,
        };

        units[index] = merged;
        segmentsOf.set(merged.id, segments);
        weightOf.set(merged.id, weight);
    }

    return { units, segmentsOf, weightOf };
}

/**
 * What a click on a bar leaves selected. Clicking the selected bar again lets
 * it go, and selecting a bar drops any selected row.
 */
export function selectTask(current: GanttSelection, taskId: string): GanttSelection {
    return { taskId: current.taskId === taskId ? undefined : taskId };
}

/** The same for a row, which likewise drops any selected bar. */
export function selectRow(current: GanttSelection, rowId: string): GanttSelection {
    return { rowId: current.rowId === rowId ? undefined : rowId };
}

/**
 * How a row is identified outside the control: a merged row by the Row field
 * value it was built from, any other row by its record id. A merged row has no
 * record of its own, so its synthesised id would mean nothing to the host.
 */
export function rowIdOf(row: GanttRow): string {
    return row.task.rowKey ?? row.task.id;
}

/**
 * The record a merged row acts on when the row itself, rather than one of its
 * bars, is clicked or opened: the selected segment if there is one, otherwise
 * the one in progress or next up, falling back to the last.
 */
export function pickSegment(row: GanttRow, selectedTaskId: string | undefined, today: Date): GanttTask {
    const { segments } = row;
    return (
        segments.find((segment) => segment.id === selectedTaskId) ??
        segments.find((segment) => segment.end >= today) ??
        segments[segments.length - 1]
    );
}

/**
 * Share of a normal bar's height added per overlap level — one level deep is
 * 1.75x a normal bar — and the gap the tallest bar leaves inside the row.
 */
const OVERLAP_GROWTH = 0.75;
const OVERLAP_MARGIN = 2;

/**
 * Levels for bars sharing a merged row, in segment order. A bar that overlaps
 * an earlier-starting one sits a level deeper: it is painted underneath and
 * drawn taller, so it still shows above and below the bar covering it.
 *
 * Segments arrive ordered by start, as `buildRows` leaves them.
 */
export function overlapLevels(segments: { start: Date; end: Date }[]): number[] {
    const levels: number[] = [];

    for (let index = 0; index < segments.length; index++) {
        let level = 0;

        for (let before = 0; before < index; before++) {
            // Compared against the drawn extent, so a date-only end still holds
            // its whole day while two timed segments only clash if their hours do.
            if (exclusiveEnd(segments[before].end) > segments[index].start) {
                level = Math.max(level, levels[before] + 1);
            }
        }

        levels.push(level);
    }

    return levels;
}

/** Extra height for a bar at `level`, capped at what the row height allows. */
export function overlapHeight(level: number, density: Density): number {
    const headroom = ROW_HEIGHT[density] - OVERLAP_MARGIN * 2 - BAR_HEIGHT[density];
    return Math.min(Math.round(level * OVERLAP_GROWTH * BAR_HEIGHT[density]), Math.max(0, headroom));
}

/**
 * Resolves each task's parent reference to a task id. The reference may be the
 * record id or, for hand-authored data, the parent's title.
 */
function resolveParents(tasks: GanttTask[]): Map<string, string | null> {
    const byId = new Set(tasks.map((task) => task.id));
    const byTitle = new Map<string, string>();

    for (const task of tasks) {
        if (!byTitle.has(task.title)) {
            byTitle.set(task.title, task.id);
        }
    }

    const resolved = new Map<string, string | null>();

    for (const task of tasks) {
        if (!task.parentId) {
            resolved.set(task.id, null);
            continue;
        }

        if (byId.has(task.parentId)) {
            resolved.set(task.id, task.parentId === task.id ? null : task.parentId);
            continue;
        }

        const viaTitle = byTitle.get(task.parentId);
        resolved.set(task.id, viaTitle && viaTitle !== task.id ? viaTitle : null);
    }

    return resolved;
}

/**
 * Ids of every task that has children, regardless of what is currently
 * collapsed. Expand/collapse-all needs the full set, which the visible rows
 * cannot supply once a subtree is hidden.
 */
export function collectParentIds(tasks: GanttTask[]): string[] {
    const { units } = buildRowUnits(tasks);
    const parents = resolveParents(units);
    const withChildren = new Set<string>();

    for (const task of units) {
        const parentId = parents.get(task.id);

        if (parentId) {
            withChildren.add(parentId);
        }
    }

    // Returned in task order so that collapse-all is deterministic.
    return units.filter((task) => withChildren.has(task.id)).map((task) => task.id);
}

/**
 * Builds the visible, ordered list of rows from the flat task list: children
 * follow their parent, collapsed subtrees are omitted, and each parent carries
 * the rolled-up span and progress of its descendants.
 */
export function buildRows(tasks: GanttTask[], collapsedIds: ReadonlySet<string>): GanttRow[] {
    if (tasks.length === 0) {
        return [];
    }

    const { units, segmentsOf, weightOf } = buildRowUnits(tasks);
    const parents = resolveParents(units);
    const childrenOf = new Map<string, GanttTask[]>();
    const roots: GanttTask[] = [];

    for (const task of units) {
        const parentId = parents.get(task.id) ?? null;

        if (parentId === null) {
            roots.push(task);
            continue;
        }

        const siblings = childrenOf.get(parentId);
        if (siblings) {
            siblings.push(task);
        } else {
            childrenOf.set(parentId, [task]);
        }
    }

    // A cycle in the parent references would leave tasks unreachable from any
    // root, so promote whatever the walk below never visits.
    const rows: GanttRow[] = [];
    const visited = new Set<string>();

    const walk = (task: GanttTask, depth: number): { start: Date; end: Date; weight: number; progress: number } => {
        visited.add(task.id);

        const children = childrenOf.get(task.id) ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = !collapsedIds.has(task.id);
        const segments = segmentsOf.get(task.id) ?? [task];
        const row: GanttRow = {
            task,
            segments,
            // Only synthesised units carry a row key; their segments never become rows.
            isMerged: task.rowKey !== null,
            depth,
            hasChildren,
            isExpanded,
            rollupStart: task.start,
            rollupEnd: task.end,
            rollupProgress: task.progress,
        };

        rows.push(row);

        let start = task.start;
        let end = task.end;
        // A merged row weighs only the days its segments cover, not the gaps.
        let weight = weightOf.get(task.id) ?? durationInDays(task);
        let weightedProgress = task.progress * weight;

        for (const child of children) {
            if (visited.has(child.id)) {
                continue;
            }

            const rowsBefore = rows.length;
            const childSpan = walk(child, depth + 1);

            if (!isExpanded) {
                rows.length = rowsBefore;
            }

            start = childSpan.start < start ? childSpan.start : start;
            end = childSpan.end > end ? childSpan.end : end;
            weightedProgress += childSpan.progress * childSpan.weight;
            weight += childSpan.weight;
        }

        if (hasChildren) {
            row.rollupStart = start;
            row.rollupEnd = end;
            row.rollupProgress = weight > 0 ? Math.round(weightedProgress / weight) : task.progress;
        }

        return { start, end, weight, progress: weight > 0 ? weightedProgress / weight : task.progress };
    };

    for (const root of roots) {
        walk(root, 0);
    }

    for (const task of units) {
        if (!visited.has(task.id)) {
            walk(task, 0);
        }
    }

    return rows;
}

function durationInDays(task: GanttTask): number {
    return Math.max(1, diffInDays(task.start, task.end) + 1);
}

/** The date range the timeline must cover, padded so bars do not touch the edges. */
export function getTaskExtent(tasks: GanttTask[]): { start: Date; end: Date } {
    if (tasks.length === 0) {
        const today = startOfDay(new Date());
        return { start: addDays(today, -7), end: addDays(today, 21) };
    }

    let min = tasks[0].start.getTime();
    let max = tasks[0].end.getTime();

    // Iterated rather than spread into Math.min so that large datasets do not
    // overflow the call stack.
    for (const task of tasks) {
        const start = task.start.getTime();
        const end = task.end.getTime();

        if (start < min) {
            min = start;
        }

        if (end > max) {
            max = end;
        }
    }

    return { start: startOfDay(new Date(min)), end: startOfDay(new Date(max)) };
}

export function buildTimeline(
    extentStart: Date,
    extentEnd: Date,
    scale: TimeScale,
    density: Density,
    today: Date
): Timeline {
    const columnWidth = COLUMN_WIDTH[scale][density];
    const ticks: TimelineTick[] = [];

    if (scale === "day") {
        const start = addDays(extentStart, -2);
        const end = addDays(extentEnd, 2);

        for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
            ticks.push({
                start: cursor,
                end: cursor,
                label: String(cursor.getDate()),
                isToday: isSameDay(cursor, today),
                isNonWorking: isWeekend(cursor),
            });
        }
    } else if (scale === "week") {
        const start = startOfWeek(addDays(extentStart, -7));
        const end = addDays(extentEnd, 7);

        for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
            const last = addDays(cursor, 6);
            ticks.push({
                start: cursor,
                end: last,
                label: formatWith({ day: "numeric", month: "short" }).format(cursor),
                isToday: today >= cursor && today <= last,
                isNonWorking: false,
            });
        }
    } else {
        const start = startOfMonth(addMonths(extentStart, -1));
        const end = addMonths(extentEnd, 1);

        for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) {
            const last = addDays(addMonths(cursor, 1), -1);
            ticks.push({
                start: cursor,
                end: last,
                label: formatWith({ month: "short" }).format(cursor),
                isToday: today >= cursor && today <= last,
                isNonWorking: false,
            });
        }
    }

    return {
        ticks,
        bands: buildBands(ticks, scale),
        start: ticks[0].start,
        end: ticks[ticks.length - 1].end,
        scale,
        columnWidth,
        totalWidth: ticks.length * columnWidth,
    };
}

function buildBands(ticks: TimelineTick[], scale: TimeScale): TimelineBand[] {
    const bands: TimelineBand[] = [];
    // Years for a month scale, months otherwise. Compared as a number so only a
    // band boundary pays for a formatted label, not every column.
    const bandOf = (date: Date) => (scale === "month" ? date.getFullYear() : date.getFullYear() * 12 + date.getMonth());
    const labelFor = (date: Date) =>
        scale === "month" ? String(date.getFullYear()) : formatWith({ month: "long", year: "numeric" }).format(date);

    let current = NaN;

    for (const tick of ticks) {
        const band = bandOf(tick.start);
        const previous = bands[bands.length - 1];

        if (previous && band === current) {
            previous.span += 1;
        } else {
            current = band;
            bands.push({ label: labelFor(tick.start), span: 1 });
        }
    }

    return bands;
}

/** Horizontal offset in pixels of a date within the timeline, interpolated inside its column. */
export function dateToOffset(date: Date, timeline: Timeline): number {
    const { scale, columnWidth } = timeline;

    if (scale === "day") {
        return diffInDays(timeline.start, date) * columnWidth;
    }

    if (scale === "week") {
        return (diffInDays(timeline.start, date) / 7) * columnWidth;
    }

    const monthsApart =
        (date.getFullYear() - timeline.start.getFullYear()) * 12 + (date.getMonth() - timeline.start.getMonth());
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return (monthsApart + (date.getDate() - 1) / daysInMonth) * columnWidth;
}

/**
 * How far through its calendar day `date` falls, 0 at midnight and 1 at the
 * next. Divided by the day's own length rather than a fixed 24h so the two
 * DST days do not land short of or past their own midnight.
 */
function fractionOfDay(date: Date): number {
    const dayStart = startOfDay(date).getTime();
    return (date.getTime() - dayStart) / (startOfDay(addDays(date, 1)).getTime() - dayStart);
}

/**
 * Like dateToOffset, but places an instant at its time of day inside the
 * column instead of at the column's leading edge.
 */
export function instantToOffset(date: Date, timeline: Timeline): number {
    const { scale, columnWidth } = timeline;
    const withinDay = fractionOfDay(date) * columnWidth;

    if (scale === "day") {
        return dateToOffset(date, timeline) + withinDay;
    }

    if (scale === "week") {
        return dateToOffset(date, timeline) + withinDay / 7;
    }

    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return dateToOffset(date, timeline) + withinDay / daysInMonth;
}

/** Pixel geometry of a bar spanning start..end inclusive. */
export function barGeometry(start: Date, end: Date, timeline: Timeline): { left: number; width: number } {
    // A column is a week or a month on the other scales, far too coarse to read
    // an hour off, so only the day scale resolves the time of day. Elsewhere the
    // bar keeps whole-day edges, which dateToOffset gives by ignoring the time.
    if (timeline.scale !== "day") {
        const left = dateToOffset(start, timeline);
        // End dates are inclusive, so the bar runs to the start of the following day.
        return { left, width: Math.max(4, dateToOffset(addDays(end, 1), timeline) - left) };
    }

    const left = instantToOffset(start, timeline);
    return { left, width: Math.max(8, instantToOffset(exclusiveEnd(end), timeline) - left) };
}

export type TaskStatus = "notStarted" | "onTrack" | "atRisk" | "overdue" | "complete";

export function getTaskStatus(start: Date, end: Date, progress: number, today: Date): TaskStatus {
    if (progress >= 100) {
        return "complete";
    }

    // Compared by date rather than by instant: a task starting at 09:00 is under
    // way for the whole of today, not "not started" until the clock catches up.
    if (diffInDays(today, start) > 0) {
        return "notStarted";
    }

    if (diffInDays(end, today) > 0) {
        return "overdue";
    }

    const elapsed = diffInDays(start, today) + 1;
    const total = Math.max(1, diffInDays(start, end) + 1);
    const expected = (elapsed / total) * 100;

    return progress + 10 < expected ? "atRisk" : "onTrack";
}
