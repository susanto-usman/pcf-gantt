import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { GanttControl } from "../index";
import { IInputs } from "../generated/ManifestTypes";
import { GanttChartProps } from "../types";
import { toLocalIso } from "../utils";

type Row = Record<string, unknown>;

interface MockOptions {
    rows: Row[];
    /** Column names; defaults to every key used by the rows. */
    columns?: string[];
    /** Control properties, e.g. { titleField: "name", groupRows: false }. */
    settings?: Record<string, string | boolean | null>;
    formatted?: Record<string, Record<string, string>>;
    links?: { to: string; alias: string }[];
    loading?: boolean;
    hasNextPage?: boolean;
}

function mockContext(options: MockOptions) {
    const ids = options.rows.map((row, index) => String(row.id ?? `r${index}`));
    const columns = options.columns ?? [...new Set(options.rows.flatMap((row) => Object.keys(row)))];
    const records = Object.fromEntries(
        options.rows.map((row, index) => [
            ids[index],
            {
                getValue: (column: string) => row[column] ?? null,
                getFormattedValue: (column: string) => options.formatted?.[ids[index]]?.[column] ?? "",
                getNamedReference: () => ({ id: { guid: ids[index] }, name: ids[index] }),
            },
        ])
    );

    const dataset = {
        sortedRecordIds: ids,
        records,
        columns: columns.map((name) => ({ name })),
        loading: options.loading ?? false,
        paging: { hasNextPage: options.hasNextPage ?? false, loadNextPage: vi.fn() },
        linking: { getLinkedEntities: () => options.links ?? [] },
        setSelectedRecordIds: vi.fn(),
        openDatasetItem: vi.fn(),
    };

    const parameters: Record<string, unknown> = { tasks: dataset };
    for (const [name, raw] of Object.entries(options.settings ?? {})) {
        parameters[name] = { raw };
    }

    const context = {
        parameters,
        mode: { trackContainerResize: vi.fn(), allocatedWidth: 800, allocatedHeight: -1 },
    } as unknown as ComponentFramework.Context<IInputs>;

    return { context, dataset };
}

function render(options: MockOptions) {
    const control = new GanttControl();
    const notify = vi.fn();
    const { context, dataset } = mockContext(options);

    control.init(context, notify);
    const provider = control.updateView(context) as React.ReactElement<{ children: React.ReactElement }>;
    const props = provider.props.children.props as GanttChartProps;

    return { control, context, dataset, notify, props };
}

function renderAgain(control: GanttControl, context: ComponentFramework.Context<IInputs>): GanttChartProps {
    const provider = control.updateView(context) as React.ReactElement<{ children: React.ReactElement }>;
    return provider.props.children.props as GanttChartProps;
}

const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);

/** Just the selection half of the outputs, so the edit outputs need not be spelled out. */
function selection(control: GanttControl) {
    const { selectedTaskId, selectedRowId } = control.getOutputs();
    return { selectedTaskId, selectedRowId };
}

describe("GanttControl", () => {
    it("maps records to tasks using the default column names", () => {
        const { props } = render({
            rows: [
                {
                    id: "1",
                    title: "Design",
                    startDate: "2024-01-01T10:30:00",
                    endDate: new Date(2024, 0, 5, 17, 30),
                    progress: "42.6",
                    parentId: null,
                },
            ],
        });

        expect(props.tasks).toEqual([
            {
                id: "1",
                title: "Design",
                start: new Date(2024, 0, 1, 10, 30),
                end: new Date(2024, 0, 5, 17, 30),
                progress: 43,
                parentId: null,
                category: null,
                colorKey: null,
                rowKey: null,
                rowTitle: null,
                isLocked: false,
            },
        ]);
        expect(props.recordCount).toBe(1);
        expect(props.unmatchedFields).toEqual([]);
    });

    it("reads date-only strings as that local day in any timezone", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: " 2024-12-31 " }],
        });

        expect(props.tasks[0].start).toEqual(d(2024, 1, 1));
        expect(props.tasks[0].end).toEqual(d(2024, 12, 31));
    });

    it("reads a midnight-UTC value as that calendar day rather than shifting it", () => {
        const { props } = render({
            rows: [
                {
                    id: "1",
                    title: "T",
                    startDate: new Date(Date.UTC(2024, 0, 1)),
                    endDate: new Date(Date.UTC(2024, 0, 2)),
                },
            ],
        });

        expect(props.tasks[0].start).toEqual(d(2024, 1, 1));
        expect(props.tasks[0].end).toEqual(d(2024, 1, 2));
    });

    it("keeps a timed start against a date-only end on the same day", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01T09:00:00", endDate: "2024-01-01" }],
        });

        expect(props.tasks[0].start).toEqual(new Date(2024, 0, 1, 9));
        // Not clamped back to the start: the bar still runs to the end of the day.
        expect(props.tasks[0].end).toEqual(d(2024, 1, 1));
    });

    it("skips records without dates and repairs inverted ranges and bad progress", () => {
        const { props } = render({
            rows: [
                { id: "no-start", title: "A", startDate: "", endDate: "2024-01-01" },
                { id: "bad-date", title: "B", startDate: "not a date", endDate: "2024-01-01" },
                { id: "inverted", title: "C", startDate: "2024-01-10", endDate: "2024-01-01", progress: 250 },
                { id: "negative", title: "D", startDate: "2024-01-01", endDate: "2024-01-02", progress: -5 },
            ],
        });

        expect(props.tasks.map((task) => task.id)).toEqual(["inverted", "negative"]);
        expect(props.tasks[0].end).toEqual(props.tasks[0].start);
        expect(props.tasks[0].progress).toBe(100);
        expect(props.tasks[1].progress).toBe(0);
        expect(props.recordCount).toBe(4);
    });

    it("honours configured field names, case-insensitively, and prefers formatted text", () => {
        const { props } = render({
            rows: [{ id: "1", Name: "raw", From: "2024-01-01", To: "2024-01-02", Kind: 3 }],
            settings: { titleField: "name", startField: "from", endField: "to", categoryField: "kind" },
            formatted: { "1": { Name: "Formatted", Kind: "Leave" } },
        });

        expect(props.tasks[0]).toMatchObject({ title: "Formatted", category: "Leave" });
        expect(props.dateFieldNames).toEqual({ start: "from", end: "to" });
    });

    it("takes the colour key from the colour field, falling back to the category", () => {
        const { props } = render({
            rows: [
                { id: "1", title: "A", startDate: "2024-01-01", endDate: "2024-01-02", kind: "Leave", shift: "Night" },
                { id: "2", title: "B", startDate: "2024-01-01", endDate: "2024-01-02", kind: "Leave", shift: null },
            ],
            settings: { categoryField: "kind", colorField: "shift" },
        });

        expect(props.tasks.map((task) => task.colorKey)).toEqual(["Night", "Leave"]);
    });

    it("defaults the colour settings to the built-in status scheme", () => {
        const { props } = render({ rows: [{ id: "1", title: "A", startDate: "2024-01-01", endDate: "2024-01-02" }] });

        expect(props).toMatchObject({ colorMode: "status", colorLegend: "", showLegend: true });
    });

    it("passes the maker's colour settings through to the chart", () => {
        const { props } = render({
            rows: [{ id: "1", title: "A", startDate: "2024-01-01", endDate: "2024-01-02" }],
            settings: { colorMode: "field", colorLegend: " Planned=#0078D4 ", showLegend: false },
        });

        expect(props).toMatchObject({ colorMode: "field", colorLegend: "Planned=#0078D4", showLegend: false });
    });

    it("falls back to the status scheme when the colour mode is not one it knows", () => {
        const { props } = render({
            rows: [{ id: "1", title: "A", startDate: "2024-01-01", endDate: "2024-01-02" }],
            settings: { colorMode: "rainbow" },
        });

        expect(props.colorMode).toBe("status");
    });

    it("reads a property off a lookup value, including JSON text and EntityReferences", () => {
        const { props } = render({
            rows: [
                {
                    id: "1",
                    title: "Shift",
                    startDate: "2024-01-01",
                    endDate: "2024-01-01",
                    resource: '{"id":"E1001","name":"Aroha Patel"}',
                },
                {
                    id: "2",
                    title: "Shift",
                    startDate: "2024-01-02",
                    endDate: "2024-01-02",
                    resource: { id: { guid: "guid-1" }, name: "Mere Smith" },
                },
            ],
            settings: { rowField: "resource.id", rowTitleField: "resource.name" },
        });

        expect(props.tasks.map((task) => [task.rowKey, task.rowTitle])).toEqual([
            ["E1001", "Aroha Patel"],
            ["guid-1", "Mere Smith"],
        ]);
    });

    it("resolves a dotted field through a linked entity column", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01", "a_1.fullname": "Linked" }],
            settings: { rowTitleField: "resource.fullname" },
            links: [{ to: "resource", alias: "a_1" }],
        });

        expect(props.tasks[0].rowTitle).toBe("Linked");
        expect(props.unmatchedFields).toEqual([]);
    });

    it("drops row keys when grouping is switched off", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01", emp: "E1" }],
            settings: { rowField: "emp", groupRows: false },
        });

        expect(props.tasks[0].rowKey).toBeNull();
    });

    it("reports field settings that match no column", () => {
        const { props } = render({
            rows: [{ id: "1", startDate: "2024-01-01", endDate: "2024-01-01" }],
            settings: { rowField: "employee.name" },
        });

        expect(props.unmatchedFields).toEqual([
            { setting: "Title field", field: "title" },
            { setting: "Row field", field: "employee.name" },
        ]);
        expect(props.tasks[0].title).toBe("Untitled task");
    });

    it("falls back to defaults for missing or invalid display settings", () => {
        const { props } = render({
            rows: [],
            settings: { density: "roomy", timeScale: "week", showToolbar: false },
        });

        expect(props).toMatchObject({
            density: "comfortable",
            timeScale: "week",
            showToolbar: false,
            showCurrentTime: true,
            showProgress: true,
            width: 800,
            height: 0,
        });
    });

    it("publishes the selection to the dataset and outputs", () => {
        const { props, dataset, notify, control } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" }],
        });

        props.onSelect("1");

        expect(dataset.setSelectedRecordIds).toHaveBeenCalledWith(["1"]);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(selection(control)).toEqual({ selectedTaskId: "1", selectedRowId: undefined });
    });

    // The chart resolves a repeat click into a cleared selection; the control
    // publishes whatever it is handed.
    it("clears the selection when the chart reports nothing selected", () => {
        const { props, dataset, notify, control } = render({
            rows: [
                { id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" },
                { id: "2", title: "U", startDate: "2024-01-01", endDate: "2024-01-01" },
            ],
        });

        props.onSelect("1");
        props.onSelect(undefined);

        expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith([]);
        expect(notify).toHaveBeenCalledTimes(2);
        expect(selection(control)).toEqual({ selectedTaskId: undefined, selectedRowId: undefined });

        props.onSelect("1");
        props.onSelect("2");

        expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith(["2"]);
        expect(selection(control)).toEqual({ selectedTaskId: "2", selectedRowId: undefined });
    });

    it("selects a row on its own, and swaps between a row and a task", () => {
        const { props, dataset, control } = render({
            rows: [
                { id: "r1", title: "Swing 1", startDate: "2024-01-01", endDate: "2024-01-02", crew: "Mech" },
                { id: "r2", title: "Swing 2", startDate: "2024-01-10", endDate: "2024-01-11", crew: "Mech" },
                { id: "r3", title: "Solo", startDate: "2024-01-01", endDate: "2024-01-02", crew: "Elec" },
            ],
            settings: { rowField: "crew" },
        });

        props.onSelectRow("Mech");

        // A row stands for every record drawn on it.
        expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith(["r1", "r2"]);
        expect(selection(control)).toEqual({ selectedTaskId: undefined, selectedRowId: "Mech" });

        // Picking a bar drops the row, and picking a row drops the bar.
        props.onSelect("r2");

        expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith(["r2"]);
        expect(selection(control)).toEqual({ selectedTaskId: "r2", selectedRowId: undefined });

        props.onSelectRow("Elec");

        expect(selection(control)).toEqual({ selectedTaskId: undefined, selectedRowId: "Elec" });
    });

    it("clears the row when the chart reports no row selected", () => {
        const { props, dataset, control, notify } = render({
            rows: [{ id: "r1", title: "Solo", startDate: "2024-01-01", endDate: "2024-01-02" }],
        });

        // Ungrouped rows are known by their task id.
        props.onSelectRow("r1");
        props.onSelectRow(undefined);

        expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith([]);
        expect(selection(control)).toEqual({ selectedTaskId: undefined, selectedRowId: undefined });
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it("selects and opens the record behind a task identified by an ID field", () => {
        const { props, dataset, control } = render({
            rows: [
                { id: "r1", code: "E1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" },
                { id: "r2", code: "E2", title: "U", startDate: "2024-01-01", endDate: "2024-01-01" },
            ],
            settings: { idField: "code" },
        });

        expect(props.tasks.map((task) => task.id)).toEqual(["E1", "E2"]);

        props.onSelect("E2");

        // The host only knows record ids, never the ID field's value.
        expect(dataset.setSelectedRecordIds).toHaveBeenCalledWith(["r2"]);
        expect(selection(control)).toEqual({ selectedTaskId: "E2", selectedRowId: undefined });

        props.onOpen("E2");

        expect(dataset.openDatasetItem).toHaveBeenCalledWith({ id: { guid: "r2" }, name: "r2" });
        // Opening keeps the record selected rather than toggling it off.
        expect(selection(control)).toEqual({ selectedTaskId: "E2", selectedRowId: undefined });
    });

    it("falls back to the record id when an ID field repeats", () => {
        const { props, dataset } = render({
            rows: [
                { id: "r1", code: "E1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" },
                { id: "r2", code: "E1", title: "U", startDate: "2024-01-01", endDate: "2024-01-01" },
            ],
            settings: { idField: "code" },
        });

        // Sharing an id would leave the chart unable to tell the two apart.
        expect(props.tasks.map((task) => task.id)).toEqual(["E1", "r2"]);

        props.onSelect("r2");

        expect(dataset.setSelectedRecordIds).toHaveBeenCalledWith(["r2"]);
    });

    it("hands the chart the same task list until the records change", () => {
        const rows = [{ id: "r1", title: "T", startDate: "2024-01-01", endDate: "2024-01-02" }];
        const { control, context, props } = render({ rows });

        // Rebuilding the rows, the timeline and the parent index on every
        // update is what makes a click feel slow, so an unchanged dataset has
        // to come back as the very same array.
        expect(renderAgain(control, context).tasks).toBe(props.tasks);

        rows[0].title = "Renamed";

        const changed = renderAgain(control, context).tasks;

        expect(changed).not.toBe(props.tasks);
        expect(changed[0].title).toBe("Renamed");
    });

    it("opens known records only", () => {
        const { props, dataset } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" }],
        });

        props.onOpen("missing");
        props.onOpen("1");

        expect(dataset.openDatasetItem).toHaveBeenCalledTimes(1);
        expect(dataset.openDatasetItem).toHaveBeenCalledWith({ id: { guid: "1" }, name: "1" });
    });

    it("leaves every editing gesture off until the maker turns it on", () => {
        const { props } = render({ rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" }] });

        expect(props.canEdit).toEqual({ move: false, resize: false });
    });

    it("reads the editing settings and keeps the same object while they hold", () => {
        const { control, context, props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" }],
            settings: { allowMove: true, allowResize: false },
        });

        expect(props.canEdit).toEqual({ move: true, resize: false });
        // A fresh object every update would re-render every visible row.
        expect(renderAgain(control, context).canEdit).toBe(props.canEdit);
    });

    it("publishes nothing until an edit is made", () => {
        const { control } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-03" }],
            settings: { allowMove: true },
        });

        expect(control.getOutputs().lastEdit).toBe("");
    });

    it("publishes a drag as one JSON value, without touching the dataset", () => {
        const { props, control, dataset, notify } = render({
            rows: [{ id: "1", title: "Mobilisation", startDate: "2024-01-01", endDate: "2024-01-03" }],
            settings: { allowMove: true },
        });

        props.onEdit({
            action: "move",
            taskId: "1",
            title: "Mobilisation",
            start: new Date(2024, 0, 4, 9),
            end: new Date(2024, 0, 6, 17),
        });

        expect(notify).toHaveBeenCalledTimes(1);
        expect(JSON.parse(control.getOutputs().lastEdit ?? "")).toEqual({
            stamp: 1,
            action: "move",
            taskId: "1",
            title: "Mobilisation",
            start: toLocalIso(new Date(2024, 0, 4, 9)),
            end: toLocalIso(new Date(2024, 0, 6, 17)),
        });
        // Saving is the host's job; the control only reports what the user did.
        expect(dataset.setSelectedRecordIds).not.toHaveBeenCalled();
    });

    it("stamps every edit, so repeating one still changes the value the host sees", () => {
        const { props, control } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-03" }],
            settings: { allowResize: true },
        });
        const edit = {
            action: "resize",
            taskId: "1",
            title: "T",
            start: d(2024, 1, 1),
            end: d(2024, 1, 5),
        } as const;

        props.onEdit(edit);
        const first = control.getOutputs().lastEdit;

        props.onEdit(edit);
        const second = control.getOutputs().lastEdit;

        expect(JSON.parse(second ?? "")).toMatchObject({ action: "resize", stamp: 2 });
        // The same drag twice must still read as a change, or OnChange sleeps through it.
        expect(second).not.toBe(first);
    });

    it("reads the locked field from whatever shape the host gives it", () => {
        const { props } = render({
            rows: [
                { id: "bool", title: "A", startDate: "2024-01-01", endDate: "2024-01-02", frozen: true },
                { id: "boolNo", title: "B", startDate: "2024-01-01", endDate: "2024-01-02", frozen: false },
                { id: "yes", title: "C", startDate: "2024-01-01", endDate: "2024-01-02", frozen: "Yes" },
                { id: "no", title: "D", startDate: "2024-01-01", endDate: "2024-01-02", frozen: " NO " },
                { id: "one", title: "E", startDate: "2024-01-01", endDate: "2024-01-02", frozen: 1 },
                { id: "zero", title: "F", startDate: "2024-01-01", endDate: "2024-01-02", frozen: 0 },
                { id: "blank", title: "G", startDate: "2024-01-01", endDate: "2024-01-02", frozen: "" },
                { id: "absent", title: "H", startDate: "2024-01-01", endDate: "2024-01-02", frozen: null },
                // A choice column: anything that is not plainly a "no" locks it.
                { id: "reason", title: "I", startDate: "2024-01-01", endDate: "2024-01-02", frozen: "Approved" },
            ],
            settings: { lockedField: "frozen" },
        });

        expect(props.tasks.filter((task) => task.isLocked).map((task) => task.id)).toEqual([
            "bool",
            "yes",
            "one",
            "reason",
        ]);
    });

    it("prefers a two-options column's formatted label over its raw value", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-02", frozen: "1" }],
            settings: { lockedField: "frozen" },
            formatted: { "1": { frozen: "No" } },
        });

        expect(props.tasks[0].isLocked).toBe(false);
    });

    it("leaves every task unlocked when no locked field is set", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-02", frozen: true }],
        });

        expect(props.tasks[0].isLocked).toBe(false);
    });

    it("rebuilds the task list when only the lock changes", () => {
        const control = new GanttControl();
        const notify = vi.fn();
        const rows = [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-02", frozen: false }];
        const { context } = mockContext({ rows, settings: { lockedField: "frozen" } });

        control.init(context, notify);
        const before = renderAgain(control, context).tasks;

        rows[0].frozen = true;
        const after = renderAgain(control, context).tasks;

        expect(before[0].isLocked).toBe(false);
        expect(after[0].isLocked).toBe(true);
        expect(after).not.toBe(before);
    });

    it("loads the next page only when one exists and nothing is loading", () => {
        const idle = render({ rows: [], hasNextPage: true });
        idle.props.onLoadMore();
        expect(idle.dataset.paging.loadNextPage).toHaveBeenCalledTimes(1);

        const busy = render({ rows: [], hasNextPage: true, loading: true });
        busy.props.onLoadMore();
        expect(busy.dataset.paging.loadNextPage).not.toHaveBeenCalled();
    });

    it("keeps existing records while the next page loads", () => {
        const { props } = render({
            rows: [{ id: "1", title: "T", startDate: "2024-01-01", endDate: "2024-01-01" }],
            loading: true,
        });

        expect(props.tasks).toHaveLength(1);
        expect(props.isLoading).toBe(true);
    });
});
