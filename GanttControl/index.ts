import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as React from "react";
import { GanttChart } from "./components/GanttChart";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { Density, GanttTask, TimeScale } from "./types";
import { startOfDay } from "./utils";

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

const DENSITIES: Density[] = ["comfortable", "compact"];
const TIME_SCALES: TimeScale[] = ["day", "week", "month"];

export class GanttControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private selectedTaskId: string | undefined;

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        this.notifyOutputChanged = notifyOutputChanged;
        // Lets the control fill its container and re-render on resize instead of
        // being pinned to a fixed pixel height.
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.tasks;

        const tasks = this.buildTasks(context, dataset);
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
            density: this.readEnum(context, "density", DENSITIES, "comfortable"),
            timeScale: this.readEnum(context, "timeScale", TIME_SCALES, "day"),
            showToolbar: this.readBoolean(context, "showToolbar", true),
            showCurrentTime: this.readBoolean(context, "showCurrentTime", true),
            showProgress: this.readBoolean(context, "showProgress", true),
            isLoading: dataset.loading,
            hasNextPage: Boolean(paging && paging.hasNextPage),
            width: context.mode.allocatedWidth > 0 ? context.mode.allocatedWidth : 0,
            height: context.mode.allocatedHeight > 0 ? context.mode.allocatedHeight : 0,
            onSelect: (taskId: string) => {
                this.selectedTaskId = taskId;
                // Keeps the host's command bar and any linked controls in step.
                dataset.setSelectedRecordIds([taskId]);
                this.notifyOutputChanged();
            },
            onOpen: (taskId: string) => {
                const record = dataset.records[taskId];
                if (record) {
                    dataset.openDatasetItem(record.getNamedReference());
                }
            },
            onLoadMore: () => {
                if (paging && paging.hasNextPage && !dataset.loading) {
                    paging.loadNextPage();
                }
            },
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

    public getOutputs(): IOutputs {
        return { selectedTaskId: this.selectedTaskId };
    }

    public destroy(): void {
        // The platform unmounts the React tree for virtual controls.
    }

    private buildTasks(
        context: ComponentFramework.Context<IInputs>,
        dataset: ComponentFramework.PropertyTypes.DataSet
    ): GanttTask[] {
        const tasks: GanttTask[] = [];

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

            tasks.push({
                id: this.readText(record, idField) ?? recordId,
                title: this.readText(record, titleField) ?? "Untitled task",
                start,
                end: end >= start ? end : start,
                progress: Math.round(Math.max(0, Math.min(100, this.readNumber(record, progressField, 0)))),
                parentId: this.readText(record, parentField),
                category: this.readText(record, categoryField),
                rowKey: this.readText(record, rowField),
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

    private readFieldName(
        context: ComponentFramework.Context<IInputs>,
        propertyName: keyof IInputs,
        fallback: string
    ): string {
        const property = context.parameters[propertyName] as
            ComponentFramework.PropertyTypes.StringProperty | undefined;
        const raw = property && typeof property.raw === "string" ? property.raw.trim() : "";
        return raw.length > 0 ? raw : fallback;
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

        // Bars are laid out per day, so normalise away the time component to
        // stop timezone offsets shifting a task into the neighbouring day.
        date.setHours(0, 0, 0, 0);
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
