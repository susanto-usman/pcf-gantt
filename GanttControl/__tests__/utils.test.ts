import { describe, expect, it } from "vitest";
import { GanttTask } from "../types";
import {
    addDays,
    addMonths,
    barGeometry,
    buildRows,
    buildTimeline,
    collectParentIds,
    dateToOffset,
    diffInDays,
    getTaskExtent,
    getTaskStatus,
    isSameDay,
    isWeekend,
    pickSegment,
    startOfMonth,
    startOfWeek,
} from "../utils";

/** Local-time date, so tests hold in any timezone. Months are 1-based for readability. */
const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);

const task = (overrides: Partial<GanttTask> & Pick<GanttTask, "id">): GanttTask => ({
    title: overrides.id,
    start: d(2024, 1, 1),
    end: d(2024, 1, 1),
    progress: 0,
    parentId: null,
    category: null,
    rowKey: null,
    rowTitle: null,
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
        expect(barGeometry(d(2024, 1, 4), d(2024, 1, 4), timeline)).toEqual({ left: 120, width: 40 });
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

    it("keeps very short bars visible", () => {
        const timeline = buildTimeline(d(2024, 1, 1), d(2024, 12, 31), "month", "compact", d(2024, 1, 1));

        expect(barGeometry(d(2024, 6, 1), d(2024, 6, 1), timeline).width).toBe(4);
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
