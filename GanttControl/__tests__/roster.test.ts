import { describe, expect, it } from "vitest";
import { GanttTask } from "../types";
import {
    assignPoolLanes,
    buildRows,
    buildTimeline,
    clipGeometry,
    collectParentIds,
    findClashes,
    isoWeek,
    markerDays,
    POOL_GROUP_ID,
} from "../utils";

/** Local-time date, so tests hold in any timezone. Months are 1-based for readability. */
const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);
const at = (year: number, month: number, day: number, hour: number) => new Date(year, month - 1, day, hour);

const task = (overrides: Partial<GanttTask> & Pick<GanttTask, "id">): GanttTask => ({
    title: overrides.id,
    start: d(2026, 4, 20),
    end: d(2026, 4, 20),
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

describe("the day scale header", () => {
    const timeline = buildTimeline(d(2026, 4, 20), d(2026, 5, 3), "day", "comfortable", d(2026, 4, 27));

    it("numbers ISO weeks, which start on Monday", () => {
        expect(isoWeek(d(2026, 4, 20))).toBe(17);
        expect(isoWeek(d(2026, 4, 19))).toBe(16);
        // 1 January 2027 is a Friday, so it still belongs to the last week of 2026.
        expect(isoWeek(d(2027, 1, 1))).toBe(53);
        expect(isoWeek(d(2027, 1, 4))).toBe(1);
    });

    it("bands the ticks into weeks, each as wide as the days it holds", () => {
        // Padded two days either side: Saturday 18 April to Tuesday 5 May.
        expect(timeline.weeks).toEqual([
            { label: "16", span: 2 },
            { label: "17", span: 7 },
            { label: "18", span: 7 },
            { label: "19", span: 2 },
        ]);
        expect(timeline.weeks.reduce((sum, week) => sum + week.span, 0)).toBe(timeline.ticks.length);
    });

    it("gives each day its weekday as a second line", () => {
        expect(timeline.ticks.every((tick) => typeof tick.subLabel === "string" && tick.subLabel.length > 0)).toBe(
            true
        );
    });

    it("labels months with a short year", () => {
        expect(timeline.bands.map((band) => band.label.slice(-4))).toEqual([" '26", " '26"]);
    });

    it("leaves the other scales without week numbers", () => {
        expect(buildTimeline(d(2026, 4, 20), d(2026, 6, 1), "week", "comfortable", d(2026, 4, 27)).weeks).toEqual([]);
    });
});

describe("assignPoolLanes", () => {
    it("packs pool records into as few lanes as hold them without overlap", () => {
        const packed = assignPoolLanes([
            task({ id: "a", kind: "pool", start: d(2026, 4, 20), end: d(2026, 4, 22) }),
            task({ id: "b", kind: "pool", start: d(2026, 4, 21), end: d(2026, 4, 21) }),
            // Starts the day after "a" ends, so it fits behind it.
            task({ id: "c", kind: "pool", start: d(2026, 4, 23), end: d(2026, 4, 24) }),
            task({ id: "d", rowKey: "E1" }),
        ]);

        expect(packed.map((item) => item.rowKey)).toEqual(["pool:0", "pool:1", "pool:0", "E1"]);
    });

    it("draws the pool first, under its own heading, with nameless lanes", () => {
        const rows = buildRows(
            [
                task({ id: "shift", rowKey: "E1", rowTitle: "Jess", groupKey: "Head Office" }),
                task({ id: "open-1", kind: "pool", groupKey: "Head Office" }),
                task({ id: "open-2", kind: "pool" }),
            ],
            none,
            "Unallocated shifts"
        );

        expect(rows.map((row) => [row.task.title, row.depth, row.group?.title])).toEqual([
            ["Unallocated shifts", 0, "Unallocated shifts"],
            ["", 1, "Unallocated shifts"],
            ["", 1, "Unallocated shifts"],
            ["Head Office", 0, "Head Office"],
            ["Jess", 1, "Head Office"],
        ]);
        expect(rows[0].task.id).toBe(POOL_GROUP_ID);
        expect(collectParentIds([task({ id: "open", kind: "pool" })])).toEqual([POOL_GROUP_ID]);
    });
});

describe("markers on a merged row", () => {
    it("take no part in the row's span or progress", () => {
        const [row] = buildRows(
            [
                task({ id: "shift", rowKey: "E1", start: d(2026, 4, 20), end: d(2026, 4, 21), progress: 50 }),
                task({
                    id: "leave",
                    rowKey: "E1",
                    kind: "icon",
                    icon: "plane",
                    start: d(2026, 4, 25),
                    end: d(2026, 5, 2),
                }),
            ],
            none
        );

        expect(row.task.start).toEqual(d(2026, 4, 20));
        expect(row.task.end).toEqual(d(2026, 4, 21));
        expect(row.task.progress).toBe(50);
        expect(row.segments.map((segment) => segment.id)).toEqual(["shift", "leave"]);
    });

    it("carry the row's subtitle and shared cells", () => {
        const [row] = buildRows(
            [
                task({ id: "a", rowKey: "E1", subtitle: "Supervisor", cells: { team: "North", job: "Pump" } }),
                task({ id: "b", rowKey: "E1", cells: { team: "North", job: "Crane" } }),
            ],
            none
        );

        expect(row.task.subtitle).toBe("Supervisor");
        // The job differs from record to record, so the row has none to show.
        expect(row.task.cells).toEqual({ team: "North", job: "" });
    });
});

describe("markerDays", () => {
    const timeline = buildTimeline(d(2026, 4, 20), d(2026, 4, 30), "day", "comfortable", d(2026, 4, 20));

    it("lists every day a date-only record covers, its end day included", () => {
        expect(markerDays(d(2026, 4, 21), d(2026, 4, 23), timeline)).toEqual([
            d(2026, 4, 21),
            d(2026, 4, 22),
            d(2026, 4, 23),
        ]);
    });

    it("keeps a timed record to the days its hours touch", () => {
        expect(markerDays(at(2026, 4, 21, 9), at(2026, 4, 21, 17), timeline)).toEqual([d(2026, 4, 21)]);
    });

    it("stops at the edges of the timeline", () => {
        const days = markerDays(d(2026, 1, 1), d(2026, 12, 31), timeline);

        expect(days[0]).toEqual(timeline.start);
        expect(days[days.length - 1]).toEqual(timeline.end);
    });
});

describe("findClashes", () => {
    it("finds where a bar runs into blocked time, with an exclusive end", () => {
        expect(
            findClashes(
                [{ start: d(2026, 4, 20), end: d(2026, 4, 24) }],
                [{ start: d(2026, 4, 23), end: d(2026, 4, 30) }]
            )
        ).toEqual([{ start: d(2026, 4, 23), end: d(2026, 4, 25) }]);
    });

    it("finds nothing where they only meet", () => {
        expect(
            findClashes(
                [{ start: at(2026, 4, 20, 8), end: at(2026, 4, 20, 12) }],
                [{ start: at(2026, 4, 20, 12), end: at(2026, 4, 20, 17) }]
            )
        ).toEqual([]);
    });
});

describe("clipGeometry", () => {
    const timeline = buildTimeline(d(2026, 4, 20), d(2026, 4, 30), "day", "comfortable", d(2026, 4, 20));

    it("holds a bar inside the timeline and says which ends were cut", () => {
        expect(clipGeometry({ left: -80, width: 200 }, timeline)).toEqual({
            left: 0,
            width: 120,
            clippedStart: true,
            clippedEnd: false,
        });
        expect(clipGeometry({ left: timeline.totalWidth - 40, width: 100 }, timeline)).toEqual({
            left: timeline.totalWidth - 40,
            width: 40,
            clippedStart: false,
            clippedEnd: true,
        });
    });
});
