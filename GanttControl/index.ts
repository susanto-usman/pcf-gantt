import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as React from "react";
import { GanttChart } from "./components/GanttChart";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ColorMode, Density, GanttTask, TimeScale } from "./types";
import { exclusiveEnd, startOfDay } from "./utils";

type DatasetRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

/** A resolved field setting: the dataset column, and a property to read off its value when it is a record. */
interface FieldRef {
    column: string;
    property: string | null;
}

/**
 * Parses text holding a JSON object, such as a CSV column in the test harness
 * written as {"id":"E1001","name":"Aroha Patel"}. Anything else comes back as is.
 */
function parseJsonObject(value: unknown): unknown {
    if (typeof value !== "string" || !value.trim().startsWith("{")) {
        return value;
    }

    try {
        const parsed: unknown = JSON.parse(value);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : value;
    } catch {
        return value;
    }
}

/**
 * Reads a property off a lookup or record value, ignoring case. A Dataverse
 * EntityReference keeps its id as { guid }, which is unwrapped. Text holding a
 * JSON object is parsed first, so flat sources can carry record values too.
 */
function readProperty(value: unknown, property: string): unknown {
    value = parseJsonObject(value);

    if (value === null || typeof value !== "object" || value instanceof Date) {
        return undefined;
    }

    const bag = value as Record<string, unknown>;
    const key = Object.keys(bag).find((candidate) => candidate.toLowerCase() === property.toLowerCase());
    const found = key === undefined ? undefined : bag[key];

    if (found !== null && typeof found === "object" && "guid" in found) {
        return (found as { guid: unknown }).guid;
    }

    return found;
}

function toText(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "object" && !(value instanceof Date)) {
        const reference = value as Partial<ComponentFramework.EntityReference> & { id?: unknown };
        const id = reference.id as { guid?: string } | string | undefined;
        return reference.name ?? (typeof id === "string" ? id : id?.guid) ?? null;
    }

    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether two builds of the task list describe the same records, field for field. */
function sameTasks(previous: GanttTask[], next: GanttTask[]): boolean {
    if (previous.length !== next.length) {
        return false;
    }

    return next.every((task, index) => {
        const was = previous[index];

        return (
            was.id === task.id &&
            was.title === task.title &&
            was.start.getTime() === task.start.getTime() &&
            was.end.getTime() === task.end.getTime() &&
            was.progress === task.progress &&
            was.parentId === task.parentId &&
            was.category === task.category &&
            was.colorKey === task.colorKey &&
            was.rowKey === task.rowKey &&
            was.rowTitle === task.rowTitle
        );
    });
}

const DENSITIES: Density[] = ["comfortable", "compact"];
const TIME_SCALES: TimeScale[] = ["day", "week", "month"];
const COLOR_MODES: ColorMode[] = ["status", "field"];

export class GanttControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private selectedTaskId: string | undefined;
    private selectedRowId: string | undefined;
    /**
     * Task id to dataset record id. The ID field lets a task be identified by a
     * column rather than by the record, and the host only ever knows the record.
     */
    private recordIdOf = new Map<string, string>();
    /** Row id to the record ids drawn on that row, which a merged row has several of. */
    private rowRecordIds = new Map<string, string[]>();
    /** The dataset from the current updateView, so the handlers below can stay stable. */
    private dataset: ComponentFramework.PropertyTypes.DataSet | undefined;
    private tasks: GanttTask[] = [];

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        this.notifyOutputChanged = notifyOutputChanged;
        // Lets the control fill its container and re-render on resize instead of
        // being pinned to a fixed pixel height.
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.tasks;

        this.dataset = dataset;

        const built = this.buildTasks(context, dataset);

        // The chart derives the rows, the timeline and the parent index from
        // this array, so handing back the same instance when the records have
        // not changed keeps a selection from rebuilding all of it.
        this.tasks = sameTasks(this.tasks, built) ? this.tasks : built;

        const tasks = this.tasks;
        const paging = dataset.paging;

        const chart = React.createElement(GanttChart, {
            tasks,
            recordCount: dataset.sortedRecordIds ? dataset.sortedRecordIds.length : 0,
            availableColumns: (dataset.columns ?? []).map((column) => column.name),
            unmatchedFields: this.findUnmatchedFields(context, dataset),
            dateFieldNames: {
                start: this.readFieldName(context, "startField", "startDate"),
                end: this.readFieldName(context, "endField", "endDate"),
            },
            selectedTaskId: this.selectedTaskId,
            selectedRowId: this.selectedRowId,
            density: this.readEnum(context, "density", DENSITIES, "comfortable"),
            timeScale: this.readEnum(context, "timeScale", TIME_SCALES, "day"),
            colorMode: this.readEnum(context, "colorMode", COLOR_MODES, "status"),
            colorLegend: this.readString(context, "colorLegend", ""),
            showToolbar: this.readBoolean(context, "showToolbar", true),
            showCurrentTime: this.readBoolean(context, "showCurrentTime", true),
            showProgress: this.readBoolean(context, "showProgress", true),
            showLegend: this.readBoolean(context, "showLegend", true),
            isLoading: dataset.loading,
            hasNextPage: Boolean(paging && paging.hasNextPage),
            width: context.mode.allocatedWidth > 0 ? context.mode.allocatedWidth : 0,
            height: context.mode.allocatedHeight > 0 ? context.mode.allocatedHeight : 0,
            // Stable identities: a new handler on every update would re-render
            // every visible row, however little of the chart actually changed.
            onSelect: this.handleSelect,
            onSelectRow: this.handleSelectRow,
            onOpen: this.handleOpen,
            onLoadMore: this.handleLoadMore,
            start: this.readBoundary(context.parameters.start),
            end: this.readBoundary(context.parameters.end),
        });

        // fluentDesignLanguage carries the host's live theme (light, dark or
        // high contrast); webLightTheme is only the standalone-harness fallback.
        return React.createElement(
            FluentProvider,
            {
                theme: context.fluentDesignLanguage?.tokenTheme ?? webLightTheme,
                style: { width: "100%", height: "100%", backgroundColor: "transparent" },
            },
            chart
        );
    }

    /** The chart resolves what a click selects; the control only publishes it. */
    private readonly handleSelect = (taskId: string | undefined): void => {
        this.select(taskId, undefined);
    };

    private readonly handleSelectRow = (rowId: string | undefined): void => {
        this.select(undefined, rowId);
    };

    private readonly handleOpen = (taskId: string): void => {
        const record = this.dataset?.records[this.recordIdOf.get(taskId) ?? taskId];

        if (record) {
            // The second click of a double-click toggles the bar off, so
            // opening re-asserts it; the chart follows the props back.
            this.select(taskId, undefined);
            this.dataset?.openDatasetItem(record.getNamedReference());
        }
    };

    private readonly handleLoadMore = (): void => {
        const paging = this.dataset?.paging;

        if (paging && paging.hasNextPage && !this.dataset?.loading) {
            paging.loadNextPage();
        }
    };

    private select(taskId: string | undefined, rowId: string | undefined): void {
        this.selectedTaskId = taskId;
        this.selectedRowId = rowId;
        // Keeps the host's command bar and any linked controls in step. A row
        // stands for every record drawn on it, which for a merged row is more
        // than one.
        this.dataset?.setSelectedRecordIds(this.selectedRecordIds(taskId, rowId));
        this.notifyOutputChanged();
    }

    private selectedRecordIds(taskId: string | undefined, rowId: string | undefined): string[] {
        if (taskId !== undefined) {
            return [this.recordIdOf.get(taskId) ?? taskId];
        }

        if (rowId !== undefined) {
            return this.rowRecordIds.get(rowId) ?? [];
        }

        return [];
    }

    public getOutputs(): IOutputs {
        return { selectedTaskId: this.selectedTaskId, selectedRowId: this.selectedRowId };
    }

    public destroy(): void {
        // The platform unmounts the React tree for virtual controls.
    }

    private buildTasks(
        context: ComponentFramework.Context<IInputs>,
        dataset: ComponentFramework.PropertyTypes.DataSet
    ): GanttTask[] {
        const tasks: GanttTask[] = [];

        this.recordIdOf = new Map<string, string>();
        this.rowRecordIds = new Map<string, string[]>();

        // Deliberately not short-circuiting on dataset.loading: paging in the
        // next page sets it while the existing records are still valid, and
        // dropping them would blank the chart on every "load more".
        if (!dataset || !dataset.sortedRecordIds) {
            return tasks;
        }

        const field = (propertyName: keyof IInputs, fallback: string) =>
            this.resolveField(dataset, this.readFieldName(context, propertyName, fallback));
        const unset: FieldRef = { column: "", property: null };

        const idField = field("idField", "id");
        const titleField = field("titleField", "title");
        const startField = field("startField", "startDate");
        const endField = field("endField", "endDate");
        const progressField = field("progressField", "progress");
        const parentField = field("parentField", "parentId");
        const categoryField = field("categoryField", "");
        // Colouring falls back to the category, so the common "colour by
        // category" case needs no second setting.
        const colorField = field("colorField", "");
        // Grouping is switched off by blanking the row key, so no record shares a row.
        const groupRows = this.readBoolean(context, "groupRows", true);
        const rowField = groupRows ? field("rowField", "") : unset;
        const rowTitleField = groupRows ? field("rowTitleField", "") : unset;

        for (const recordId of dataset.sortedRecordIds) {
            const record = dataset.records[recordId];

            if (!record) {
                continue;
            }

            const start = this.readDate(record, startField);
            const end = this.readDate(record, endField);

            // A task without both endpoints cannot be placed on the timeline.
            if (!start || !end) {
                continue;
            }

            const customId = this.readText(record, idField);
            // Two tasks sharing an id are indistinguishable to selection: the
            // chart would light up whichever came first. Only the first record
            // keeps a repeated id, the rest fall back to their record id.
            const id = customId !== null && !this.recordIdOf.has(customId) ? customId : recordId;

            const rowKey = this.readText(record, rowField);
            // Mirrors rowIdOf: a grouped row is known by its Row field value,
            // and any other row by the one task it carries.
            const rowId = rowKey ?? id;
            const onRow = this.rowRecordIds.get(rowId);

            this.recordIdOf.set(id, recordId);
            if (onRow) {
                onRow.push(recordId);
            } else {
                this.rowRecordIds.set(rowId, [recordId]);
            }

            const category = this.readText(record, categoryField);

            tasks.push({
                id,
                title: this.readText(record, titleField) ?? "Untitled task",
                start,
                // Compared against the drawn extent so a timed start paired with
                // a date-only end on the same day still spans the rest of it.
                end: exclusiveEnd(end) > start ? end : start,
                progress: Math.round(Math.max(0, Math.min(100, this.readNumber(record, progressField, 0)))),
                parentId: this.readText(record, parentField),
                category,
                colorKey: this.readText(record, colorField) ?? category,
                rowKey,
                rowTitle: this.readText(record, rowTitleField),
            });
        }

        return tasks;
    }

    /**
     * Maps a field setting to the column the dataset actually exposes. Plain
     * names pass straight through; "lookup.column" (e.g. resource.name) reads a
     * value from the record a lookup or record column points at. Tried in order:
     *
     * 1. A column literally named that, alias included.
     * 2. A related column from the view. These are keyed by their link-entity
     *    alias ("a_1b2c….name"), so the lookup is matched against each link's
     *    "to" attribute.
     * 3. The lookup column itself, reading the property off its value: a
     *    Dataverse EntityReference ({ id, name }), a canvas record, or text
     *    holding a JSON object (as a CSV loads in the test harness). When the
     *    value has no such property, text fields show its display value.
     *
     * The control deliberately never extends the query itself: that needs
     * utils.getEntityMetadata, which canvas apps do not implement and report to
     * the user as an error just for being called.
     */
    private resolveField(dataset: ComponentFramework.PropertyTypes.DataSet, fieldName: string): FieldRef {
        const columns = dataset.columns ?? [];
        const findColumn = (name: string) =>
            columns.find((column) => column.name.toLowerCase() === name.toLowerCase())?.name;

        const direct = findColumn(fieldName);
        const dot = fieldName.indexOf(".");

        if (direct || dot <= 0 || dot === fieldName.length - 1) {
            return { column: direct ?? fieldName, property: null };
        }

        const lookup = fieldName.slice(0, dot);
        const property = fieldName.slice(dot + 1);

        for (const link of this.readLinkedEntities(dataset)) {
            if (link.to.toLowerCase() === lookup.toLowerCase()) {
                const related = findColumn(`${link.alias}.${property}`);

                if (related) {
                    return { column: related, property: null };
                }
            }
        }

        return { column: findColumn(lookup) ?? lookup, property };
    }

    /**
     * Field settings that match no column once resolved, so a maker sees why a
     * field reads as empty instead of guessing. Only settings the maker filled
     * in are checked, plus the title, whose absence shows as "Untitled task".
     */
    private findUnmatchedFields(
        context: ComponentFramework.Context<IInputs>,
        dataset: ComponentFramework.PropertyTypes.DataSet
    ): { setting: string; field: string }[] {
        const columns = new Set((dataset.columns ?? []).map((column) => column.name.toLowerCase()));

        // Columns arrive with the first page; judging before then flags everything.
        if (columns.size === 0) {
            return [];
        }

        const settings: [keyof IInputs, string, string][] = [
            ["idField", "ID field", "id"],
            ["titleField", "Title field", "title"],
            ["startField", "Start field", ""],
            ["endField", "End field", ""],
            ["progressField", "Progress field", ""],
            ["parentField", "Parent field", ""],
            ["categoryField", "Category field", ""],
            ["colorField", "Colour field", ""],
            ["rowField", "Row field", ""],
            ["rowTitleField", "Row title field", ""],
        ];
        const unmatched: { setting: string; field: string }[] = [];

        for (const [propertyName, setting, fallback] of settings) {
            const field = this.readFieldName(context, propertyName, fallback);

            if (field && !columns.has(this.resolveField(dataset, field).column.toLowerCase())) {
                unmatched.push({ setting, field });
            }
        }

        return unmatched;
    }

    /** Hosts vary in how much of the linking API they carry, so any gap reads as no links. */
    private readLinkedEntities(
        dataset: ComponentFramework.PropertyTypes.DataSet
    ): ComponentFramework.PropertyHelper.DataSetApi.LinkEntityExposedExpression[] {
        try {
            return dataset.linking?.getLinkedEntities?.() ?? [];
        } catch {
            return [];
        }
    }

    /** A text property's value, trimmed, or the fallback when it is blank. */
    private readString(
        context: ComponentFramework.Context<IInputs>,
        propertyName: keyof IInputs,
        fallback: string
    ): string {
        const property = context.parameters[propertyName] as
            ComponentFramework.PropertyTypes.StringProperty | undefined;
        const raw = property && typeof property.raw === "string" ? property.raw.trim() : "";
        return raw.length > 0 ? raw : fallback;
    }

    private readFieldName(
        context: ComponentFramework.Context<IInputs>,
        propertyName: keyof IInputs,
        fallback: string
    ): string {
        return this.readString(context, propertyName, fallback);
    }

    private readBoolean(
        context: ComponentFramework.Context<IInputs>,
        propertyName: keyof IInputs,
        fallback: boolean
    ): boolean {
        const property = context.parameters[propertyName] as
            ComponentFramework.PropertyTypes.TwoOptionsProperty | undefined;
        return property && typeof property.raw === "boolean" ? property.raw : fallback;
    }

    private readEnum<T extends string>(
        context: ComponentFramework.Context<IInputs>,
        propertyName: keyof IInputs,
        allowed: T[],
        fallback: T
    ): T {
        const property = context.parameters[propertyName] as { raw?: string } | undefined;
        const raw = property && typeof property.raw === "string" ? (property.raw as T) : undefined;
        return raw && allowed.indexOf(raw) >= 0 ? raw : fallback;
    }

    /** The field's raw value: the column's own, or the named property of a record-valued column. */
    private readValue(record: DatasetRecord, field: FieldRef): unknown {
        if (!field.column) {
            return undefined;
        }

        const value: unknown = record.getValue(field.column);
        return field.property ? readProperty(value, field.property) : value;
    }

    /**
     * Prefers the formatted value, which resolves lookups, option sets and
     * choice columns to something readable, and falls back to the raw value.
     */
    private readText(record: DatasetRecord, field: FieldRef): string | null {
        if (!field.column) {
            return null;
        }

        if (field.property) {
            const text = toText(this.readValue(record, field));

            // A property the value lacks reads as the lookup's display value.
            if (text !== null) {
                return text;
            }
        }

        const formatted = record.getFormattedValue(field.column);

        if (formatted && formatted.trim().length > 0) {
            return formatted;
        }

        return toText(record.getValue(field.column));
    }

    private readDate(record: DatasetRecord, field: FieldRef): Date | null {
        const value = this.readValue(record, field);

        if (value === null || value === undefined || value === "") {
            return null;
        }

        // A date-only string ("2024-01-01") parses as UTC midnight, which is the
        // previous local day west of UTC, so read it as a local date instead.
        const dateOnly = typeof value === "string" ? DATE_ONLY.exec(value.trim()) : null;
        const date =
            value instanceof Date
                ? new Date(value)
                : dateOnly
                  ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
                  : new Date(value as string | number);

        if (Number.isNaN(date.getTime())) {
            return null;
        }

        // A date-only column reaches us at UTC midnight, which is the previous
        // local day west of UTC, so it is read back as that calendar date. Every
        // other value keeps its time of day for the day scale to draw. The cost
        // is that a real midnight-UTC appointment is taken for a date, the only
        // reading that also keeps date-only columns on their own day.
        if (date.getUTCHours() + date.getUTCMinutes() + date.getUTCSeconds() + date.getUTCMilliseconds() === 0) {
            return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        }

        return date;
    }

    /**
     * A timeline boundary as a local-midnight timestamp, or undefined when the
     * property is blank. A number rather than a Date so an unchanged value
     * compares equal across updateView calls and memoised work is kept.
     */
    private readBoundary(property: ComponentFramework.PropertyTypes.DateTimeProperty | undefined): number | undefined {
        const raw = property?.raw;

        if (!raw) {
            return undefined;
        }

        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? undefined : startOfDay(date).getTime();
    }

    private readNumber(record: DatasetRecord, field: FieldRef, fallback: number): number {
        const value = this.readValue(record, field);

        if (value === null || value === undefined || value === "") {
            return fallback;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
}
