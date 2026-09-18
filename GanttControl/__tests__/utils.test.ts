import { describe, expect, it } from "vitest";
import { GanttTask } from "../types";
import {
    addDays,
    addMonths,
    applyDrag,
    applyPendingEdits,
    barGeometry,
    buildRows,
    buildTimeline,
    clampDragDays,
    collectParentIds,
    clashSpan,
    dateToOffset,
    diffInDays,
    drawnSpan,
    drawnSpans,
    fromDisplayZone,
    getTaskExtent,
    getTaskStatus,
    instantToOffset,
    formatMoment,
    isSameDay,
    isStartOfDay,
    isWeekend,
    lastCoveredDay,
    offsetToDays,
    overlapHeight,
    overlapLevels,
    pickSegment,
    pixelsPerDay,
    selectRow,
    selectTask,
    spanGeometry,
    startOfDay,
    startOfMonth,
    startOfWeek,
    toDisplayZone,
    toDisplayZoneTasks,
    toLocalIso,
} from "../utils";

/** Local-time date, so tests hold in any timezone. Months are 1-based for readability. */
const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);
const at = (year: number, month: number, day: number, hour: number) => new Date(year, month - 1, day, hour);

const task = (overrides: Partial<GanttTask> & Pick<GanttTask, "id">): GanttTask => ({
    title: overrides.id,
    start: d(2024, 1, 1),
    end: d(2024, 1, 1),
    progress: 0,
    parentId: null,
    category: null,
    colorKey: null,
    rowKey: null,
    rowTitle: null,
    isLocked: false,
    ...overrides,
});

const none = new Set<string>();

describe("date helpers", () => {
    it("adds days across month and year boundaries", () => {
        expect(addDays(d(2024, 12, 31), 1)).toEqual(d(2025, 1, 1));
        expect(addDays(d(2024, 3, 1), -1)).toEqual(d(2024, 2, 29));
    });

    it("adds months without mutating the input", () => {
        const input = d(2024, 1, 15);
        expect(addMonths(input, 2)).toEqual(d(2024, 3, 15));
        expect(input).toEqual(d(2024, 1, 15));
    });

    it("finds the start of the week (Sunday) and month", () => {
        // 2024-01-10 is a Wednesday.
        expect(startOfWeek(new Date(2024, 0, 10, 15, 30))).toEqual(d(2024, 1, 7));
        expect(startOfMonth(new Date(2024, 0, 10, 15, 30))).toEqual(d(2024, 1, 1));
    });

    it("counts whole days, ignoring time of day", () => {
        expect(diffInDays(new Date(2024, 0, 1, 23, 0), new Date(2024, 0, 2, 1, 0))).toBe(1);
        expect(diffInDays(d(2024, 1, 10), d(2024, 1, 1))).toBe(-9);
        // Spans the March DST change in most northern-hemisphere zones.
        expect(diffInDays(d(2024, 3, 1), d(2024, 4, 1))).toBe(31);
    });

    it("compares days and detects weekends", () => {
        expect(isSameDay(new Date(2024, 0, 1, 1), new Date(2024, 0, 1, 23))).toBe(true);
        expect(isWeekend(d(2024, 1, 6))).toBe(true); // Saturday
        expect(isWeekend(d(2024, 1, 7))).toBe(true); // Sunday
        expect(isWeekend(d(2024, 1, 8))).toBe(false);
    });
});

describe("naming a finish", () => {
    /** Midnight on the drawn clock, nudged as a value shifted into UTC is. */
    const nudged = (year: number, month: number, day: number) => new Date(d(year, month, day).getTime() + 1);

    it("reads a nudged midnight as the start of its day, not as a time", () => {
        expect(isStartOfDay(d(2024, 3, 30))).toBe(true);
        expect(isStartOfDay(nudged(2024, 3, 30))).toBe(true);
        expect(isStartOfDay(at(2024, 3, 30, 8))).toBe(false);

        // The millisecond is not a time of day worth announcing.
        expect(formatMoment(nudged(2024, 3, 30))).toBe(formatMoment(d(2024, 3, 30)));
        expect(formatMoment(at(2024, 3, 30, 8))).toMatch(/8/);
    });

    it("names the day a task runs into, not the midnight it stops at", () => {
        // An end of the 31st at midnight covers the 30th and no more.
        expect(lastCoveredDay(nudged(2024, 3, 30), nudged(2024, 3, 31))).toEqual(d(2024, 3, 30));
        expect(lastCoveredDay(d(2024, 3, 30), new Date(d(2024, 4, 1).getTime() + 1))).toEqual(d(2024, 3, 31));
    });

    it("leaves a date alone and a real time of day as they are", () => {
        // A date alone is inclusive of its whole day, so it already names the
        // last day covered.
        expect(lastCoveredDay(d(2026, 9, 17), d(2026, 9, 17))).toEqual(d(2026, 9, 17));

        const evening = at(2024, 3, 31, 17);
        expect(lastCoveredDay(at(2024, 3, 30, 8), evening)).toBe(evening);
    });

    it("keeps a task with no length on the day it starts", () => {
        const midnight = nudged(2024, 3, 30);

        expect(lastCoveredDay(midnight, midnight)).toEqual(d(2024, 3, 30));
    });
});

describe("buildRows", () => {
    it("returns no rows for no tasks", () => {
        expect(buildRows([], none)).toEqual([]);
    });

    it("places children after their parent and rolls up span and progress", () => {
        const tasks = [
            task({ id: "child-b", parentId: "p", start: d(2024, 1, 6), end: d(2024, 1, 10), progress: 0 }),
            task({ id: "p", start: d(2024, 1, 3), end: d(2024, 1, 3), progress: 0 }),
            task({ id: "child-a", parentId: "p", start: d(2024, 1, 1), end: d(2024, 1, 5), progress: 100 }),
        ];

        const rows = buildRows(tasks, none);

        expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
            ["p", 0],
            ["child-b", 1],
            ["child-a", 1],
        ]);

        const parent = rows[0];
        expect(parent.hasChildren).toBe(true);
        expect(parent.rollupStart).toEqual(d(2024, 1, 1));
        expect(parent.rollupEnd).toEqual(d(2024, 1, 10));
        // Weighted by days: parent 1d@0, child-b 5d@0, child-a 5d@100 → 500/11.
        expect(parent.rollupProgress).toBe(Math.round(500 / 11));
    });

    it("hides collapsed subtrees but still rolls them up", () => {
        const tasks = [
            task({ id: "p" }),
            task({ id: "c", parentId: "p", end: d(2024, 1, 20) }),
            task({ id: "g", parentId: "c", end: d(2024, 2, 1) }),
        ];

        const rows = buildRows(tasks, new Set(["p"]));

        expect(rows.map((row) => row.task.id)).toEqual(["p"]);
        expect(rows[0].isExpanded).toBe(false);
        expect(rows[0].rollupEnd).toEqual(d(2024, 2, 1));
    });

    it("resolves parents by title when no record id matches", () => {
        const rows = buildRows([task({ id: "1", title: "Phase 1" }), task({ id: "2", parentId: "Phase 1" })], none);

        expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
            ["1", 0],
            ["2", 1],
        ]);
    });

    it("treats unknown and self parents as roots", () => {
        const rows = buildRows([task({ id: "a", parentId: "missing" }), task({ id: "b", parentId: "b" })], none);

        expect(rows.map((row) => row.depth)).toEqual([0, 0]);
    });

    it("still renders every task when parents form a cycle", () => {
        const rows = buildRows([task({ id: "a", parentId: "b" }), task({ id: "b", parentId: "a" })], none);

        expect(rows.map((row) => row.task.id).sort()).toEqual(["a", "b"]);
    });

    it("merges tasks sharing a row key into one row of segments", () => {
        const tasks = [
            task({
                id: "s2",
                rowKey: "E1",
                start: d(2024, 1, 10),
                end: d(2024, 1, 11),
                progress: 0,
                category: "Leave",
            }),
            task({ id: "other" }),
            task({
                id: "s1",
                rowKey: "E1",
                rowTitle: "Aroha Patel",
                start: d(2024, 1, 1),
                end: d(2024, 1, 2),
                progress: 100,
                category: "Leave",
            }),
        ];

        const rows = buildRows(tasks, none);

        expect(rows.map((row) => row.task.id)).toEqual(["row:E1", "other"]);

        const merged = rows[0];
        expect(merged.isMerged).toBe(true);
        expect(merged.task.title).toBe("Aroha Patel");
        expect(merged.task.category).toBe("Leave");
        expect(merged.segments.map((segment) => segment.id)).toEqual(["s1", "s2"]);
        expect(merged.task.start).toEqual(d(2024, 1, 1));
        expect(merged.task.end).toEqual(d(2024, 1, 11));
        // Progress weighs only covered days (2 + 2), not the gap between them.
        expect(merged.task.progress).toBe(50);
        expect(rows[1].isMerged).toBe(false);
    });

    it("falls back to the row key for the title and drops mixed categories", () => {
        const rows = buildRows(
            [task({ id: "a", rowKey: "E1", category: "Leave" }), task({ id: "b", rowKey: "E1", category: "Shift" })],
            none
        );

        expect(rows[0].task.title).toBe("E1");
        expect(rows[0].task.category).toBeNull();
    });

    it("gathers top-level rows under a heading per group, in order of appearance, valueless last", () => {
        const tasks = [
            task({ id: "loose", start: d(2024, 3, 1), end: d(2024, 3, 1) }),
            task({ id: "m1", groupKey: "mech", start: d(2024, 1, 1), end: d(2024, 1, 2), progress: 100 }),
            task({ id: "e1", groupKey: "elec", groupTitle: "Electrical" }),
            task({ id: "m2", groupKey: "mech", groupTitle: "Mechanical", start: d(2024, 1, 9), end: d(2024, 1, 10) }),
        ];

        const rows = buildRows(tasks, none);

        expect(rows.map((row) => [row.task.id, row.depth, row.isGroup])).toEqual([
            ["group:mech", 0, true],
            ["m1", 1, false],
            ["m2", 1, false],
            ["group:elec", 0, true],
            ["e1", 1, false],
            ["group:", 0, true],
            ["loose", 1, false],
        ]);

        const [mech] = rows;
        // Titled by the first label its rows carry, even when that is not the first row.
        expect(mech.task.title).toBe("Mechanical");
        expect(rows[3].task.title).toBe("Electrical");
        expect(rows[5].task.title).toBe("(No value)");
        // A heading spans its rows and weighs nothing itself: 2 days at 100, 2 at 0.
        expect(mech.rollupStart).toEqual(d(2024, 1, 1));
        expect(mech.rollupEnd).toEqual(d(2024, 1, 10));
        expect(mech.rollupProgress).toBe(50);
    });

    it("keeps a child under its parent whatever group it names, and groups merged rows", () => {
        const tasks = [
            task({ id: "p", groupKey: "mech" }),
            task({ id: "c", parentId: "p", groupKey: "elec" }),
            task({ id: "s1", rowKey: "E1", groupKey: "elec" }),
            task({ id: "s2", rowKey: "E1" }),
        ];

        const rows = buildRows(tasks, none);

        expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
            ["group:mech", 0],
            ["p", 1],
            ["c", 2],
            ["group:elec", 0],
            ["row:E1", 1],
        ]);
    });

    it("collapses a group heading like any parent", () => {
        const rows = buildRows(
            [task({ id: "a", groupKey: "g" }), task({ id: "b", groupKey: "g" })],
            new Set(["group:g"])
        );

        expect(rows.map((row) => row.task.id)).toEqual(["group:g"]);
        expect(rows[0].isExpanded).toBe(false);
    });

    it("adds no headings when no task names a group", () => {
        expect(buildRows([task({ id: "a" })], none).map((row) => row.isGroup)).toEqual([false]);
    });
});

describe("collectParentIds", () => {
    it("lists every parent in task order, including hidden ones and merged rows", () => {
        const tasks = [
            task({ id: "team", title: "Team" }),
            task({ id: "seg", rowKey: "E1", parentId: "team" }),
            task({ id: "leaf", parentId: "row:E1" }),
            task({ id: "solo" }),
        ];

        expect(collectParentIds(tasks)).toEqual(["team", "row:E1"]);
    });

    it("lists group headings first", () => {
        const tasks = [task({ id: "p", groupKey: "g" }), task({ id: "c", parentId: "p" })];

        expect(collectParentIds(tasks)).toEqual(["group:g", "p"]);
    });
});

describe("pickSegment", () => {
    const [row] = buildRows(
        [
            task({ id: "past", rowKey: "E1", start: d(2024, 1, 1), end: d(2024, 1, 2) }),
            task({ id: "next", rowKey: "E1", start: d(2024, 1, 10), end: d(2024, 1, 12) }),
            task({ id: "later", rowKey: "E1", start: d(2024, 2, 1), end: d(2024, 2, 2) }),
        ],
        none
    );

    it("prefers the selected segment", () => {
        expect(pickSegment(row, "past", d(2024, 1, 11)).id).toBe("past");
    });

    it("otherwise picks the current or next segment", () => {
        expect(pickSegment(row, undefined, d(2024, 1, 11)).id).toBe("next");
        expect(pickSegment(row, "not-here", d(2024, 1, 5)).id).toBe("next");
    });

    it("falls back to the last segment once all are past", () => {
        expect(pickSegment(row, undefined, d(2024, 3, 1)).id).toBe("later");
    });
});

describe("selectTask and selectRow", () => {
    it("lets go of whatever was clicked twice", () => {
        expect(selectTask({ taskId: "a" }, "a")).toEqual({ taskId: undefined });
        expect(selectRow({ rowId: "E1" }, "E1")).toEqual({ rowId: undefined });
    });

    it("never leaves a row and a task selected together", () => {
        expect(selectTask({ rowId: "E1" }, "a")).toEqual({ taskId: "a" });
        expect(selectRow({ taskId: "a" }, "E1")).toEqual({ rowId: "E1" });
    });

    it("moves the selection to whatever else is clicked", () => {
        expect(selectTask({ taskId: "a" }, "b")).toEqual({ taskId: "b" });
        expect(selectRow({ rowId: "E1" }, "E2")).toEqual({ rowId: "E2" });
    });
});

describe("overlapLevels", () => {
    /** A drawn span, whose end is the midnight it stops at rather than a day it covers. */
    const span = (start: number, end: number) => ({ start: d(2024, 1, start), end: d(2024, 1, end) });

    it("keeps every bar at the top level when none overlap", () => {
        expect(overlapLevels([span(1, 2), span(3, 4), span(5, 6)])).toEqual([0, 0, 0]);
    });

    it("pushes a later start under the bar it overlaps", () => {
        expect(overlapLevels([span(1, 10), span(5, 12)])).toEqual([0, 1]);
    });

    it("lets one bar start where the one before it stops", () => {
        expect(overlapLevels([span(1, 5), span(5, 8)])).toEqual([0, 0]);
        expect(overlapLevels([span(1, 6), span(5, 8)])).toEqual([0, 1]);
    });

    it("deepens the stack for each bar overlapped", () => {
        expect(overlapLevels([span(1, 10), span(2, 8), span(3, 6)])).toEqual([0, 1, 2]);
    });

    it("starts a new stack once the bars are clear of each other", () => {
        expect(overlapLevels([span(1, 10), span(2, 3), span(5, 9), span(20, 21)])).toEqual([0, 1, 1, 0]);
    });

    it("stacks under a bar that is itself stacked", () => {
        expect(overlapLevels([span(1, 2), span(1, 10), span(4, 6)])).toEqual([0, 1, 2]);
    });

    it("leaves two shifts side by side when the hours they are drawn at do not meet", () => {
        const morning = { start: at(2024, 1, 4, 9), end: at(2024, 1, 4, 12) };
        const afternoon = { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 17) };

        expect(overlapLevels([morning, afternoon])).toEqual([0, 0]);
        // Both filled out to the same day, one goes under the other.
        expect(overlapLevels([span(4, 5), span(4, 5)])).toEqual([0, 1]);
    });
});

describe("drawnSpans", () => {
    const morning = { start: at(2024, 1, 4, 9), end: at(2024, 1, 4, 12) };
    const afternoon = { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 17) };
    const evening = { start: at(2024, 1, 4, 18), end: at(2024, 1, 4, 22) };
    const dayTimeline = (timeOfDay: boolean) =>
        buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1), timeOfDay);

    it("gives every bar its own hours where the timeline reads them", () => {
        expect(drawnSpans([morning, afternoon], dayTimeline(true))).toEqual([
            { start: at(2024, 1, 4, 9), end: at(2024, 1, 4, 12) },
            { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 17) },
        ]);
    });

    it("fills the whole day for a bar that has it to itself", () => {
        expect(drawnSpans([morning], dayTimeline(false))).toEqual([{ start: d(2024, 1, 4), end: d(2024, 1, 5) }]);
    });

    it("hands the rest of a shared day over at the hour the next bar starts", () => {
        expect(drawnSpans([morning, afternoon], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 4), end: at(2024, 1, 4, 13) },
            { start: at(2024, 1, 4, 13), end: d(2024, 1, 5) },
        ]);
    });

    it("hands on again down a day of three, the last keeping the rest of it", () => {
        expect(drawnSpans([morning, afternoon, evening], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 4), end: at(2024, 1, 4, 13) },
            { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 18) },
            { start: at(2024, 1, 4, 18), end: d(2024, 1, 5) },
        ]);
    });

    it("keeps whole days where the hours of the two bars do meet", () => {
        const overlapping = { start: at(2024, 1, 4, 11), end: at(2024, 1, 4, 15) };

        // Nowhere to hand over at, so both fill the day and stack instead.
        expect(drawnSpans([morning, overlapping], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
        ]);
    });

    it("hands over on the second day of a shift that ran past midnight", () => {
        const nightShift = { start: at(2024, 1, 4, 22), end: at(2024, 1, 5, 6) };
        const nextMorning = { start: at(2024, 1, 5, 9), end: at(2024, 1, 5, 17) };

        expect(drawnSpans([nightShift, nextMorning], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 4), end: at(2024, 1, 5, 9) },
            { start: at(2024, 1, 5, 9), end: d(2024, 1, 6) },
        ]);
    });

    it("leaves a run of days whole where a shift falls inside it", () => {
        const leave = { start: d(2024, 1, 3), end: d(2024, 1, 8) };

        // The leave runs on past the shift, so it keeps its days rather than
        // being cut back to the morning the shift starts.
        expect(drawnSpans([leave, morning], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 3), end: d(2024, 1, 9) },
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
        ]);
    });

    it("leaves bars on days of their own alone", () => {
        const nextWeek = { start: at(2024, 1, 9, 9), end: at(2024, 1, 9, 17) };

        expect(drawnSpans([morning, nextWeek], dayTimeline(false))).toEqual([
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
            { start: d(2024, 1, 9), end: d(2024, 1, 10) },
        ]);
    });

    it("keeps whole days on the scales too coarse to draw an hour", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "week", "comfortable", d(2024, 1, 1));

        expect(drawnSpans([morning, afternoon], timeline)).toEqual([
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
            { start: d(2024, 1, 4), end: d(2024, 1, 5) },
        ]);
    });
});

describe("overlapHeight", () => {
    it("draws the first level under an overlap at 1.75x a normal bar", () => {
        // Comfortable bars are 20px, compact ones 14px.
        expect(overlapHeight(0, "comfortable")).toBe(0);
        expect(overlapHeight(1, "comfortable")).toBe(15);
        expect(overlapHeight(1, "compact")).toBe(11);
    });

    it("stops growing before the bar fills the row", () => {
        // 2x a normal bar, inside a 44px row; compact tops out just short.
        expect(overlapHeight(2, "comfortable")).toBe(20);
        expect(overlapHeight(9, "comfortable")).toBe(20);
        expect(overlapHeight(9, "compact")).toBe(12);
    });
});

describe("getTaskExtent", () => {
    it("spans the earliest start to the latest end at midnight", () => {
        const extent = getTaskExtent([
            task({ id: "a", start: new Date(2024, 0, 5, 9), end: d(2024, 1, 6) }),
            task({ id: "b", start: d(2024, 1, 2), end: new Date(2024, 0, 20, 18) }),
        ]);

        expect(extent).toEqual({ start: d(2024, 1, 2), end: d(2024, 1, 20) });
    });

    it("defaults to a window around today with no tasks", () => {
        const { start, end } = getTaskExtent([]);
        expect(diffInDays(start, end)).toBe(28);
    });
});

describe("buildTimeline", () => {
    const today = d(2024, 1, 3);

    it("builds padded day ticks with today and weekends flagged", () => {
        const timeline = buildTimeline(d(2024, 1, 1), d(2024, 1, 7), "day", "comfortable", today);

        expect(timeline.ticks).toHaveLength(11);
        expect(timeline.start).toEqual(d(2023, 12, 30));
        expect(timeline.end).toEqual(d(2024, 1, 9));
        expect(timeline.columnWidth).toBe(40);
        expect(timeline.totalWidth).toBe(440);
        expect(timeline.ticks.filter((tick) => tick.isToday).map((tick) => tick.start)).toEqual([today]);
        expect(timeline.ticks.filter((tick) => tick.isNonWorking)).toHaveLength(4);
        // December and January bands.
        expect(timeline.bands.map((band) => band.span)).toEqual([2, 9]);
    });

    it("builds week ticks starting on Sunday", () => {
        const timeline = buildTimeline(d(2024, 1, 10), d(2024, 1, 20), "week", "compact", today);

        expect(timeline.columnWidth).toBe(44);
        for (const tick of timeline.ticks) {
            expect(tick.start.getDay()).toBe(0);
            expect(diffInDays(tick.start, tick.end)).toBe(6);
        }
        expect(timeline.ticks.filter((tick) => tick.isToday)).toHaveLength(1);
    });

    it("builds month ticks with a band per year", () => {
        const timeline = buildTimeline(d(2024, 1, 15), d(2024, 3, 15), "month", "comfortable", today);

        expect(timeline.ticks.map((tick) => tick.start)).toEqual([
            d(2023, 12, 1),
            d(2024, 1, 1),
            d(2024, 2, 1),
            d(2024, 3, 1),
            d(2024, 4, 1),
        ]);
        expect(timeline.ticks[2].end).toEqual(d(2024, 2, 29));
        expect(timeline.bands).toEqual([
            { label: "2023", span: 1 },
            { label: "2024", span: 4 },
        ]);
    });
});

describe("dateToOffset and barGeometry", () => {
    it("offsets by whole columns on a day scale", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        expect(dateToOffset(d(2024, 1, 1), timeline)).toBe(0);
        expect(dateToOffset(d(2024, 1, 4), timeline)).toBe(120);
        // Inclusive end: a one-day task is one column wide.
        expect(barGeometry(drawnSpan(d(2024, 1, 4), d(2024, 1, 4), timeline), timeline)).toEqual({
            left: 120,
            width: 40,
        });
    });

    it("interpolates within a week column", () => {
        const timeline = buildTimeline(d(2024, 1, 14), d(2024, 1, 20), "week", "comfortable", d(2024, 1, 1));
        expect(dateToOffset(addDays(timeline.start, 7), timeline)).toBe(64);
        expect(dateToOffset(addDays(timeline.start, 10), timeline)).toBeCloseTo((10 / 7) * 64);
    });

    it("interpolates within a month column by days in that month", () => {
        const timeline = buildTimeline(d(2024, 2, 1), d(2024, 2, 29), "month", "comfortable", d(2024, 1, 1));

        // Timeline starts 2024-01-01; February begins one column in.
        expect(dateToOffset(d(2024, 2, 1), timeline)).toBe(88);
        expect(dateToOffset(d(2024, 2, 15), timeline)).toBeCloseTo(88 + (14 / 29) * 88);
    });

    it("places a timed bar inside its day column", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        // 09:00 to 17:00 on 4 Jan: three columns in, a third of a column wide.
        const bar = barGeometry(drawnSpan(at(2024, 1, 4, 9), at(2024, 1, 4, 17), timeline), timeline);

        expect(bar.left).toBe(120 + 40 * 0.375);
        expect(bar.width).toBeCloseTo(40 * (8 / 24));
    });

    it("runs a timed start to the end of a date-only end day", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        expect(barGeometry(drawnSpan(at(2024, 1, 4, 12), d(2024, 1, 4), timeline), timeline)).toEqual({
            left: 140,
            width: 20,
        });
    });

    it("ignores the time of day on the coarser scales", () => {
        const timeline = buildTimeline(d(2024, 1, 1), d(2024, 12, 31), "month", "comfortable", d(2024, 1, 1));

        expect(barGeometry(drawnSpan(at(2024, 6, 1, 9), at(2024, 6, 3, 17), timeline), timeline)).toEqual(
            barGeometry(drawnSpan(d(2024, 6, 1), d(2024, 6, 3), timeline), timeline)
        );
    });

    it("fills the whole days a timed bar touches when the timeline ignores the time of day", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1), false);

        // 09:00 on 4 Jan to 17:00 on 5 Jan: both days in full, as date-only values would draw.
        expect(barGeometry(drawnSpan(at(2024, 1, 4, 9), at(2024, 1, 5, 17), timeline), timeline)).toEqual({
            left: 120,
            width: 80,
        });
        expect(barGeometry(drawnSpan(at(2024, 1, 4, 9), at(2024, 1, 4, 17), timeline), timeline)).toEqual(
            barGeometry(drawnSpan(d(2024, 1, 4), d(2024, 1, 4), timeline), timeline)
        );
    });

    it("draws the part of a day a bar was left with after handing the rest on", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1), false);
        const [morning, afternoon] = drawnSpans(
            [
                { start: at(2024, 1, 4, 9), end: at(2024, 1, 4, 12) },
                { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 17) },
            ],
            timeline
        );

        // The day column starts at 120 and is 40 wide; the handover is at 13:00.
        expect(barGeometry(morning, timeline).left).toBe(120);
        expect(barGeometry(morning, timeline).width).toBeCloseTo(40 * (13 / 24));
        expect(barGeometry(afternoon, timeline).left).toBeCloseTo(120 + 40 * (13 / 24));
        expect(barGeometry(afternoon, timeline).width).toBeCloseTo(40 * (11 / 24));
    });

    it("keeps very short bars visible", () => {
        const timeline = buildTimeline(d(2024, 1, 1), d(2024, 12, 31), "month", "compact", d(2024, 1, 1));

        expect(barGeometry(drawnSpan(d(2024, 6, 1), d(2024, 6, 1), timeline), timeline).width).toBe(4);
    });
});

describe("clashSpan and spanGeometry", () => {
    const clash = { start: at(2024, 1, 4, 6), end: at(2024, 1, 4, 18) };

    it("places a clash at its times of day", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));
        const bar = drawnSpan(at(2024, 1, 4, 6), at(2024, 1, 4, 18), timeline);

        expect(spanGeometry(clashSpan(clash, bar, timeline), timeline)).toEqual({ left: 130, width: 20 });
    });

    it("spans whole days when the timeline ignores the time of day", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1), false);
        const bar = drawnSpan(at(2024, 1, 4, 6), at(2024, 1, 4, 18), timeline);

        // The exclusive end still runs to the end of the day it falls in.
        expect(spanGeometry(clashSpan(clash, bar, timeline), timeline)).toEqual({ left: 120, width: 40 });
    });

    it("stops where a bar that handed the rest of its day on stops", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1), false);
        const [morning] = drawnSpans(
            [
                { start: at(2024, 1, 4, 6), end: at(2024, 1, 4, 12) },
                { start: at(2024, 1, 4, 13), end: at(2024, 1, 4, 17) },
            ],
            timeline
        );

        expect(clashSpan(clash, morning, timeline)).toEqual({ start: d(2024, 1, 4), end: at(2024, 1, 4, 13) });
    });
});

describe("instantToOffset", () => {
    it("places the instant partway across its day column", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        expect(instantToOffset(d(2024, 1, 4), timeline)).toBe(120);
        expect(instantToOffset(at(2024, 1, 4, 6), timeline)).toBeCloseTo(120 + 40 * 0.25);
        expect(instantToOffset(at(2024, 1, 4, 18), timeline)).toBeCloseTo(120 + 40 * 0.75);
    });

    it("scales the time of day down to a week column", () => {
        const timeline = buildTimeline(d(2024, 1, 14), d(2024, 1, 20), "week", "comfortable", d(2024, 1, 1));
        const noon = new Date(timeline.start.getFullYear(), timeline.start.getMonth(), timeline.start.getDate(), 12);

        expect(instantToOffset(noon, timeline)).toBeCloseTo((0.5 / 7) * 64);
    });

    it("scales the time of day down to a month column", () => {
        const timeline = buildTimeline(d(2024, 2, 1), d(2024, 2, 29), "month", "comfortable", d(2024, 1, 1));

        expect(instantToOffset(at(2024, 2, 15, 12), timeline)).toBeCloseTo(88 + ((14 + 0.5) / 29) * 88);
    });

    it("never runs past the column it belongs to", () => {
        const timeline = buildTimeline(d(2024, 1, 3), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        // A DST changeover makes the day 23 or 25 hours long; the last instant
        // of any day must still fall short of the next column.
        for (let day = 1; day <= 8; day += 1) {
            const lastMoment = new Date(2024, 0, day, 23, 59, 59, 999);
            expect(instantToOffset(lastMoment, timeline)).toBeLessThan(dateToOffset(d(2024, 1, day + 1), timeline));
        }
    });
});

describe("getTaskStatus", () => {
    const start = d(2024, 1, 1);
    const end = d(2024, 1, 10);

    it.each([
        ["complete regardless of dates", 100, d(2023, 1, 1), "complete"],
        ["not started before the start", 0, d(2023, 12, 31), "notStarted"],
        ["overdue after the end", 90, d(2024, 1, 11), "overdue"],
        ["on track when close to expected", 45, d(2024, 1, 5), "onTrack"],
        ["at risk when more than 10 points behind", 39, d(2024, 1, 5), "atRisk"],
    ] as const)("is %s", (_, progress, today, expected) => {
        expect(getTaskStatus(start, end, progress, today)).toBe(expected);
    });
});

describe("editing geometry", () => {
    it("reads a day off the timeline at each scale", () => {
        const day = buildTimeline(d(2024, 1, 1), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));
        const week = buildTimeline(d(2024, 1, 1), d(2024, 1, 10), "week", "comfortable", d(2024, 1, 1));
        const month = buildTimeline(d(2024, 1, 1), d(2024, 3, 1), "month", "comfortable", d(2024, 1, 1));

        expect(pixelsPerDay(day)).toBe(40);
        expect(pixelsPerDay(week)).toBeCloseTo(64 / 7);
        // An average month, near enough at a zoom that cannot draw a day.
        expect(pixelsPerDay(month)).toBeCloseTo(88 / 30.4375);
    });

    it("snaps a drag to whole days, rounding to the nearer one", () => {
        const timeline = buildTimeline(d(2024, 1, 1), d(2024, 1, 10), "day", "comfortable", d(2024, 1, 1));

        expect(offsetToDays(0, timeline)).toBe(0);
        expect(offsetToDays(19, timeline)).toBe(0);
        expect(offsetToDays(21, timeline)).toBe(1);
        expect(offsetToDays(-85, timeline)).toBe(-2);
    });
});

describe("applyDrag", () => {
    const start = at(2024, 1, 10, 9);
    const end = at(2024, 1, 12, 17);

    it("moves both ends together, keeping the time of day", () => {
        expect(applyDrag(start, end, "move", 3)).toEqual({ start: at(2024, 1, 13, 9), end: at(2024, 1, 15, 17) });
        expect(applyDrag(start, end, "move", -9)).toEqual({ start: at(2024, 1, 1, 9), end: at(2024, 1, 3, 17) });
    });

    it("moves one end only when resizing", () => {
        expect(applyDrag(start, end, "start", -2)).toEqual({ start: at(2024, 1, 8, 9), end });
        expect(applyDrag(start, end, "end", 4)).toEqual({ start, end: at(2024, 1, 16, 17) });
    });

    it("will not pull either end past the other", () => {
        // The span is two days, so that is as far as a resize may close it.
        expect(applyDrag(start, end, "start", 8)).toEqual({ start: at(2024, 1, 12, 9), end });
        expect(applyDrag(start, end, "end", -8)).toEqual({ start, end: at(2024, 1, 10, 17) });
    });

    it("leaves a single-day task alone rather than inverting it", () => {
        const only = d(2024, 1, 10);

        expect(applyDrag(only, only, "start", 5)).toEqual({ start: only, end: only });
        expect(applyDrag(only, only, "end", -5)).toEqual({ start: only, end: only });
    });

    it("clamps the days a drag is worth, so a preview can be drawn from them", () => {
        expect(clampDragDays(start, end, "move", 40)).toBe(40);
        expect(clampDragDays(start, end, "start", 40)).toBe(2);
        expect(clampDragDays(start, end, "end", -40)).toBe(-2);
        expect(clampDragDays(start, end, "end", 3)).toBe(3);
    });

    it("moves a date-only task without giving it a time", () => {
        expect(applyDrag(d(2024, 1, 10), d(2024, 1, 12), "move", 1)).toEqual({
            start: d(2024, 1, 11),
            end: d(2024, 1, 13),
        });
    });
});

describe("applyPendingEdits", () => {
    const tasks = [
        task({ id: "a", start: d(2024, 1, 1), end: d(2024, 1, 3) }),
        task({ id: "b", start: d(2024, 1, 5), end: d(2024, 1, 6) }),
    ];

    it("hands the list straight back when nothing is in flight", () => {
        expect(applyPendingEdits(tasks, new Map())).toBe(tasks);
    });

    it("draws an edited task at its new dates without touching the rest", () => {
        const edits = new Map([["b", { start: d(2024, 1, 8), end: d(2024, 1, 9) }]]);
        const pending = applyPendingEdits(tasks, edits);

        expect(pending[0]).toBe(tasks[0]);
        expect(pending[1]).toMatchObject({ id: "b", start: d(2024, 1, 8), end: d(2024, 1, 9) });
        // The source list is untouched, so a settled edit restores it exactly.
        expect(tasks[1].start).toEqual(d(2024, 1, 5));
    });
});

describe("locked records", () => {
    const segment = (id: string, day: number, isLocked: boolean) =>
        task({ id, rowKey: "Mech", start: d(2024, 1, day), end: d(2024, 1, day), isLocked });

    it("locks a merged row only once every record on it is locked", () => {
        const mixed = buildRows([segment("s1", 1, true), segment("s2", 8, false)], none);
        const all = buildRows([segment("s1", 1, true), segment("s2", 8, true)], none);

        expect(mixed[0].task.isLocked).toBe(false);
        expect(all[0].task.isLocked).toBe(true);
        // Either way each bar still answers for itself.
        expect(mixed[0].segments.map((entry) => entry.isLocked)).toEqual([true, false]);
    });
});

describe("toLocalIso", () => {
    /** The offset the machine running the test is in, as the format writes it. */
    const offsetOf = (date: Date) => {
        const minutes = -date.getTimezoneOffset();
        const sign = minutes < 0 ? "-" : "+";
        const size = Math.abs(minutes);
        return `${sign}${String(Math.floor(size / 60)).padStart(2, "0")}:${String(size % 60).padStart(2, "0")}`;
    };

    it("writes the wall clock the user sees, with its offset", () => {
        const instant = new Date(2026, 8, 20, 9, 5, 0);

        expect(toLocalIso(instant)).toBe(`2026-09-20T09:05:00${offsetOf(instant)}`);
    });

    it("keeps a date-only task on its own day in any timezone", () => {
        const midnight = d(2026, 9, 20);

        // toISOString would move this to the 19th anywhere east of UTC.
        expect(toLocalIso(midnight)).toBe(`2026-09-20T00:00:00${offsetOf(midnight)}`);
        expect(toLocalIso(midnight).slice(0, 10)).toBe("2026-09-20");
    });

    it("pads every part to a fixed width", () => {
        const early = new Date(2026, 0, 2, 3, 4, 5);

        expect(toLocalIso(early)).toBe(`2026-01-02T03:04:05${offsetOf(early)}`);
    });

    it("round-trips back to the same instant", () => {
        const instant = new Date(2026, 8, 20, 9, 5, 0);

        expect(new Date(toLocalIso(instant)).getTime()).toBe(instant.getTime());
    });
});

describe("display zones", () => {
    /** What the local clock reads for an instant once it is drawn in UTC. */
    const utcParts = (instant: Date) => [
        instant.getUTCFullYear(),
        instant.getUTCMonth(),
        instant.getUTCDate(),
        instant.getUTCHours(),
        instant.getUTCMinutes(),
    ];
    const localParts = (shown: Date) => [
        shown.getFullYear(),
        shown.getMonth(),
        shown.getDate(),
        shown.getHours(),
        shown.getMinutes(),
    ];

    it("leaves every date alone on the local clock", () => {
        const instant = at(2026, 9, 20, 9);

        expect(toDisplayZone(instant, "local")).toBe(instant);
        expect(fromDisplayZone(instant, "local")).toBe(instant);
    });

    it("reads an instant on the UTC clock", () => {
        const instant = new Date(2026, 8, 20, 9, 30, 0);

        expect(localParts(toDisplayZone(instant, "utc"))).toEqual(utcParts(instant));
    });

    it("keeps a date alone on its own day, which stands in every zone", () => {
        const midnight = d(2026, 9, 20);

        expect(toDisplayZone(midnight, "utc")).toBe(midnight);
        expect(fromDisplayZone(midnight, "utc")).toBe(midnight);
    });

    it("keeps a time of day from reading as a date alone", () => {
        // 9am somewhere is midnight UTC; drawn as midnight it would be taken for
        // a bare date and fill the whole day.
        const noon = new Date(2026, 8, 20, 12, 0, 0);
        const midnightInUtc = new Date(noon.getTime() - (12 * 60 + noon.getTimezoneOffset()) * 60000);
        const shown = toDisplayZone(midnightInUtc, "utc");

        expect(shown.getHours()).toBe(0);

        if (midnightInUtc.getTimezoneOffset() === 0) {
            // The clock these tests run on is UTC itself, so the two agree:
            // there is no shift to make, and a value on midnight there is a
            // date alone in earnest rather than one that only reads as one.
            expect(shown).toBe(midnightInUtc);
            return;
        }

        expect(shown.getTime() - startOfDay(shown).getTime()).toBe(1);
    });

    it("gives back the instant behind a date drawn in UTC", () => {
        for (const instant of [
            new Date(2026, 8, 20, 9, 30),
            new Date(2026, 0, 2, 3, 4),
            new Date(2026, 5, 15, 23, 45),
        ]) {
            const shown = toDisplayZone(instant, "utc");

            expect(fromDisplayZone(shown, "utc").getTime()).toBe(instant.getTime());
        }
    });

    it("moves both of a task's dates and leaves the rest of it alone", () => {
        const tasks = [task({ id: "T-1", start: new Date(2026, 8, 20, 9), end: new Date(2026, 8, 20, 17) })];
        const [shown] = toDisplayZoneTasks(tasks, "utc");

        expect(toDisplayZoneTasks(tasks, "local")).toBe(tasks);
        expect(localParts(shown.start)).toEqual(utcParts(tasks[0].start));
        expect(localParts(shown.end)).toEqual(utcParts(tasks[0].end));
        expect(shown.title).toBe(tasks[0].title);
        expect(shown.end.getTime() - shown.start.getTime()).toBe(8 * 3600000);
    });
});
