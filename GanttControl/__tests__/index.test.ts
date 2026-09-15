import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { GanttControl } from "../index";
import { IInputs } from "../generated/ManifestTypes";
import { GanttChartProps } from "../types";

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

const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);

describe("GanttControl", () => {
    it("maps records to tasks using the default column names", () => {
        const { props } = render({
            rows: [
                {
                    id: "1",
                    title: "Design",
                    startDate: "2024-01-01T10:30:00",
                    endDate: new Date(2024, 0, 5, 17),
                    progress: "42.6",
                    parentId: null,
                },
            ],
        });

        expect(props.tasks).toEqual([
            {
                id: "1",
                title: "Design",
                start: d(2024, 1, 1),
                end: d(2024, 1, 5),
                progress: 43,
                parentId: null,
                category: null,
                rowKey: null,
                rowTitle: null,
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
        expect(control.getOutputs()).toEqual({ selectedTaskId: "1" });
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
