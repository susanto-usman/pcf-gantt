import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as React from "react";
import { GanttControlView } from "./components/GanttControlView";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { DEFAULT_FIELDS, FieldSettings, KeyedField, OptionSettings, parseFields, parseOptions } from "./settings";
import { EditPermissions, GanttChartProps, GanttTask, TaskEdit } from "./types";
import { exclusiveEnd, GROUP_ROW_PREFIX, startOfDay, toLocalIso } from "./utils";

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

/** Records the settings panel reads to find the properties on lookup columns. */
const SAMPLED_RECORDS = 25;

/** Values a flag column can carry that mean "no", whatever the host's data type. */
const FALSEY = new Set(["false", "no", "n", "0", "off", "unlocked"]);

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
            was.rowTitle === task.rowTitle &&
            was.groupKey === task.groupKey &&
            was.groupTitle === task.groupTitle &&
            was.isLocked === task.isLocked
        );
    });
}

export class GanttControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private context: ComponentFramework.Context<IInputs>;
    /** Counts updateView calls, so the view knows the data may have moved even when the settings have not. */
    private updateCount = 0;
    private selectedTaskId: string | undefined;
    private selectedRowId: string | undefined;
    /**
     * Task id to dataset record id. The task id mapping lets a task be identified by a
     * column rather than by the record, and the host only ever knows the record.
     */
    private recordIdOf = new Map<string, string>();
    /** Row id to the record ids drawn on that row, which a merged row or a group heading has several of. */
    private rowRecordIds = new Map<string, string[]>();
    /** The dataset from the current updateView, so the handlers below can stay stable. */
    private dataset: ComponentFramework.PropertyTypes.DataSet | undefined;
    private tasks: GanttTask[] = [];
    /** Kept between updates so the chart's rows are not re-rendered by an identical object. */
    private canEdit: EditPermissions = { move: false, resize: false };
    /**
     * The last edit the user made, as JSON, for the host to save. The control
     * never writes to the dataset itself, so this is the whole of the write
     * path. Blank until the first edit.
     */
    private lastEdit = "";
    /**
     * Counts edits. A host only reacts to an output that differs, so without a
     * stamp in the JSON, dragging a bar back where it was would reach nobody.
     */
    private changeStamp = 0;
    /**
     * Settings the maker applied from the settings panel, as compact JSON, for
     * the app to store and feed back into Field mapping and Options. A control
     * cannot write its own input properties, so this is the only way back.
     */
    private draftFields = "";
    private draftOptions = "";

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        this.notifyOutputChanged = notifyOutputChanged;
        // Lets the control fill its container and re-render on resize instead of
        // being pinned to a fixed pixel height.
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        this.context = context;
        this.dataset = context.parameters.tasks;
        this.updateCount += 1;

        // fluentDesignLanguage carries the host's live theme (light, dark or
        // high contrast); webLightTheme is only the standalone-harness fallback.
        return React.createElement(
            FluentProvider,
            {
                theme: context.fluentDesignLanguage?.tokenTheme ?? webLightTheme,
                style: { width: "100%", height: "100%", backgroundColor: "transparent" },
            },
            React.createElement(GanttControlView, {
                fields: context.parameters.fields?.raw ?? "",
                options: context.parameters.options?.raw ?? "",
                columns: this.columnChoices(this.dataset),
                build: this.buildChart,
                version: this.updateCount,
                onApply: this.handleApplySettings,
            })
        );
    }

    /**
     * The chart's props for a pair of settings. The view calls this with the
     * saved settings, or with a draft from the settings panel while a maker is
     * trying one out, so the chart can be previewed without a round trip to the
     * host. It reads the dataset from the latest updateView.
     */
    private readonly buildChart = (fieldsText: string, optionsText: string): GanttChartProps => {
        const context = this.context;
        const dataset = context.parameters.tasks;
        const fields = parseFields(fieldsText);
        const options = parseOptions(optionsText);
        const built = this.buildTasks(dataset, fields.value, options.value.groupRows);

        // The chart derives the rows, the timeline and the parent index from
        // this array, so handing back the same instance when the records have
        // not changed keeps a selection from rebuilding all of it.
        this.tasks = sameTasks(this.tasks, built) ? this.tasks : built;

        const paging = dataset.paging;

        return {
            tasks: this.tasks,
            recordCount: dataset.sortedRecordIds ? dataset.sortedRecordIds.length : 0,
            availableColumns: (dataset.columns ?? []).map((column) => column.name),
            unmatchedFields: this.findUnmatchedFields(dataset, fields.value, options.value.groupRows),
            settingProblems: [...fields.problems, ...options.problems],
            dateFieldNames: { start: fields.value.start, end: fields.value.end },
            selectedTaskId: this.selectedTaskId,
            selectedRowId: this.selectedRowId,
            density: options.value.density,
            timeScale: options.value.timeScale,
            colorMode: options.value.colorBy,
            colorLegend: options.value.legend,
            showToolbar: options.value.showToolbar,
            showCurrentTime: options.value.showCurrentTime,
            showProgress: options.value.showProgress,
            showLegend: options.value.showLegend,
            showSettings: options.value.showSettings,
            canEdit: this.readPermissions(options.value),
            isLoading: dataset.loading,
            hasNextPage: Boolean(paging && paging.hasNextPage),
            width: context.mode.allocatedWidth > 0 ? context.mode.allocatedWidth : 0,
            height: context.mode.allocatedHeight > 0 ? context.mode.allocatedHeight : 0,
            // Stable identities: a new handler on every update would re-render
            // every visible row, however little of the chart actually changed.
            onSelect: this.handleSelect,
            onSelectRow: this.handleSelectRow,
            onOpen: this.handleOpen,
            onEdit: this.handleEdit,
            onLoadMore: this.handleLoadMore,
            start: this.readBoundary(context.parameters.start),
            end: this.readBoundary(context.parameters.end),
        };
    };

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

    /**
     * Publishes a drag for the host to save. Nothing is written here: a canvas
     * app patches the record from OnChange, and a model-driven form does the
     * same from its own handler. The chart has already drawn the edit and will
     * let that drawing go once the records come back.
     */
    private readonly handleEdit = (edit: TaskEdit): void => {
        this.changeStamp += 1;

        // One JSON value rather than a property per part, so the app parses it
        // once and switches on the action. Keys are ordered as a reader would
        // want them: what happened, to what, and what it became.
        this.lastEdit = JSON.stringify({
            stamp: this.changeStamp,
            action: edit.action,
            taskId: edit.taskId,
            title: edit.title,
            start: toLocalIso(edit.start),
            end: toLocalIso(edit.end),
        });

        this.notifyOutputChanged();
    };

    private readonly handleApplySettings = (fields: string, options: string): void => {
        // Compact, as the app stores it in a text column rather than showing it.
        this.draftFields = JSON.stringify(JSON.parse(fields));
        this.draftOptions = JSON.stringify(JSON.parse(options));
        this.notifyOutputChanged();
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
        return {
            selectedTaskId: this.selectedTaskId,
            // A group heading is published by its group value, which is what an
            // app filters on; the prefix only keeps it apart from row keys inside.
            selectedRowId: this.selectedRowId?.startsWith(GROUP_ROW_PREFIX)
                ? this.selectedRowId.slice(GROUP_ROW_PREFIX.length)
                : this.selectedRowId,
            lastEdit: this.lastEdit,
            draftFields: this.draftFields,
            draftOptions: this.draftOptions,
        };
    }

    /**
     * The editing gestures the maker has turned on. The same object is handed
     * back while the settings hold, since a fresh one would re-render every
     * visible row on each update.
     */
    private readPermissions(options: OptionSettings): EditPermissions {
        const next: EditPermissions = { move: options.allowMove, resize: options.allowResize };
        const current = this.canEdit;

        if (current.move === next.move && current.resize === next.resize) {
            return current;
        }

        this.canEdit = next;
        return next;
    }

    public destroy(): void {
        // The platform unmounts the React tree for virtual controls.
    }

    private buildTasks(
        dataset: ComponentFramework.PropertyTypes.DataSet,
        fields: FieldSettings,
        groupRows: boolean
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

        const field = (name: string) => this.resolveField(dataset, name);
        const unset: FieldRef = { column: "", property: null };

        const idField = field(fields.task.id);
        const titleField = field(fields.task.label);
        const startField = field(fields.start);
        const endField = field(fields.end);
        const progressField = field(fields.progress);
        const parentField = field(fields.parent);
        const categoryField = field(fields.category);
        // Colouring falls back to the category, so the common "colour by
        // category" case needs no second setting.
        const colorField = field(fields.color);
        const lockedField = field(fields.locked);
        const groupField = field(fields.group.id);
        const groupTitleField = field(fields.group.label);
        // Merging is switched off by blanking the row key, so no record shares a row.
        const rowField = groupRows ? field(fields.row.id) : unset;
        const rowTitleField = groupRows ? field(fields.row.label) : unset;

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
            // Mirrors rowIdOf: a grouped row is known by its row id value,
            // and any other row by the one task it carries.
            const rowId = rowKey ?? id;

            this.recordIdOf.set(id, recordId);
            this.addToRow(rowId, recordId);

            // Mirrors buildRows, which gathers records without a value under a
            // heading of their own once any record has one.
            const groupKey = this.readText(record, groupField);
            this.addToRow(`${GROUP_ROW_PREFIX}${groupKey ?? ""}`, recordId);

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
                groupKey,
                groupTitle: groupKey === null ? null : this.readText(record, groupTitleField),
                isLocked: this.readFlag(record, lockedField),
            });
        }

        return tasks;
    }

    private addToRow(rowId: string, recordId: string): void {
        const onRow = this.rowRecordIds.get(rowId);

        if (onRow) {
            onRow.push(recordId);
        } else {
            this.rowRecordIds.set(rowId, [recordId]);
        }
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
     * Field mappings that match no column once resolved, so a maker sees why a
     * field reads as empty instead of guessing. Only mappings the maker changed
     * are checked, plus the task label, whose absence shows as "Untitled task".
     */
    private findUnmatchedFields(
        dataset: ComponentFramework.PropertyTypes.DataSet,
        fields: FieldSettings,
        groupRows: boolean
    ): { setting: string; field: string }[] {
        const columns = new Set((dataset.columns ?? []).map((column) => column.name.toLowerCase()));

        // Columns arrive with the first page; judging before then flags everything.
        if (columns.size === 0) {
            return [];
        }

        // [setting, column, default]: a column left at its default is not reported.
        const keyed = (name: string, pair: KeyedField, fallback: KeyedField): [string, string, string][] =>
            pair.id === pair.label
                ? [[name, pair.id, fallback.id]]
                : [
                      [`${name}.id`, pair.id, fallback.id],
                      [`${name}.label`, pair.label, fallback.label],
                  ];

        const settings: [string, string, string][] = [
            ["task.id", fields.task.id, DEFAULT_FIELDS.task.id],
            // The title is checked even at its default, as its absence is what the user sees.
            ["task.label", fields.task.label, ""],
            ["start", fields.start, DEFAULT_FIELDS.start],
            ["end", fields.end, DEFAULT_FIELDS.end],
            ["progress", fields.progress, DEFAULT_FIELDS.progress],
            ["parent", fields.parent, DEFAULT_FIELDS.parent],
            ...keyed("group", fields.group, DEFAULT_FIELDS.group),
            ...(groupRows ? keyed("row", fields.row, DEFAULT_FIELDS.row) : []),
            ["category", fields.category, ""],
            ["color", fields.color, ""],
            ["locked", fields.locked, ""],
        ];
        const unmatched: { setting: string; field: string }[] = [];

        for (const [setting, field, fallback] of settings) {
            if (field && field !== fallback && !columns.has(this.resolveField(dataset, field).column.toLowerCase())) {
                unmatched.push({ setting, field });
            }
        }

        return unmatched;
    }

    /**
     * What the settings panel offers to pick from: every column, and for a
     * column holding a lookup or record, each property on it (employee.id,
     * employee.name) as the field mappings read them. Related columns from the
     * view are offered by their lookup rather than their link alias. Properties
     * are sampled from the first records, since a lookup left blank on one
     * record says nothing about its shape.
     */
    private columnChoices(dataset: ComponentFramework.PropertyTypes.DataSet): string[] {
        const choices: string[] = [];
        const seen = new Set<string>();
        const add = (name: string) => {
            if (!seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                choices.push(name);
            }
        };
        const links = this.readLinkedEntities(dataset);
        const sample = (dataset.sortedRecordIds ?? [])
            .slice(0, SAMPLED_RECORDS)
            .map((recordId) => dataset.records[recordId])
            .filter((record) => record !== undefined);

        for (const { name } of dataset.columns ?? []) {
            const dot = name.indexOf(".");
            const link =
                dot > 0
                    ? links.find((item) => item.alias.toLowerCase() === name.slice(0, dot).toLowerCase())
                    : undefined;

            add(link ? `${link.to}${name.slice(dot)}` : name);

            for (const record of sample) {
                let value: unknown;

                try {
                    value = parseJsonObject(record.getValue(name));
                } catch {
                    continue;
                }

                if (value === null || typeof value !== "object" || value instanceof Date || Array.isArray(value)) {
                    continue;
                }

                for (const [property, item] of Object.entries(value as Record<string, unknown>)) {
                    // Only what reads as text: a guid-wrapped id does, a nested record does not.
                    const readable =
                        item === null ||
                        ["string", "number", "boolean"].indexOf(typeof item) >= 0 ||
                        (typeof item === "object" && "guid" in item);

                    if (readable) {
                        add(`${name}.${property}`);
                    }
                }
            }
        }

        return choices;
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
        return this.parseDate(this.readValue(record, field));
    }

    /**
     * A date read from a host value, which reaches us as a Date from a Dataverse
     * column or as text from a maker-typed property. Null when blank or unparsable.
     */
    private parseDate(value: unknown): Date | null {
        if (value === null || value === undefined) {
            return null;
        }

        // Makers type the boundary properties by hand, so a stray space is worth
        // tolerating: only the date-only branch used to trim, which left a padded
        // "2024-01-01T09:00" unparsable.
        const text = typeof value === "string" ? value.trim() : value;

        if (text === "") {
            return null;
        }

        // A date-only string ("2024-01-01") parses as UTC midnight, which is the
        // previous local day west of UTC, so read it as a local date instead.
        const dateOnly = typeof text === "string" ? DATE_ONLY.exec(text) : null;
        const date =
            text instanceof Date
                ? new Date(text)
                : dateOnly
                  ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
                  : new Date(text as string | number);

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
    private readBoundary(property: ComponentFramework.PropertyTypes.StringProperty | undefined): number | undefined {
        const date = this.parseDate(property?.raw);
        return date === null ? undefined : startOfDay(date).getTime();
    }

    private readNumber(record: DatasetRecord, field: FieldRef, fallback: number): number {
        const value = this.readValue(record, field);

        if (value === null || value === undefined || value === "") {
            return fallback;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    /**
     * A record's value read as a yes/no. Columns that mean "yes" arrive in as
     * many shapes as the hosts allow: a Dataverse two-options column as a
     * boolean, a choice as its formatted label, a CSV in the test harness as
     * text. Anything the list below does not recognise as "no" counts as yes,
     * since a column named for a flag having a value at all is the signal.
     */
    private readFlag(record: DatasetRecord, field: FieldRef): boolean {
        if (!field.column) {
            return false;
        }

        const value = this.readValue(record, field);

        if (value === null || value === undefined || value === "") {
            return false;
        }

        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        return !FALSEY.has(
            String(this.readText(record, field) ?? value)
                .trim()
                .toLowerCase()
        );
    }
}
