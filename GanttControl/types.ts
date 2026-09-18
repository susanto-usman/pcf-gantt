export type Density = "comfortable" | "compact";

export type TimeScale = "day" | "week" | "month";

/** Which clock the chart draws times on: the viewer's own, or UTC. */
export type TimeZoneMode = "local" | "utc";

/** Where a bar's colour comes from: the built-in time-based status, or a field on the record. */
export type ColorMode = "status" | "field";

/** Bars painted solid with a progress fill, or white with a coloured outline and a label. */
export type BarStyle = "filled" | "outlined";

/**
 * How a record is drawn, as a display rule decides: a bar, an icon in each day
 * it covers, a tint behind those days, or a bar in the unallocated pool.
 */
export type TaskKind = "bar" | "icon" | "tint" | "pool";

export interface GanttTask {
    id: string;
    title: string;
    start: Date;
    end: Date;
    progress: number;
    parentId: string | null;
    category: string | null;
    /** The value the colour scheme matches on, when colouring by a field. */
    colorKey?: string | null;
    /** Tasks sharing a row key are drawn as separate bars on a single row. */
    rowKey: string | null;
    /** Label for the merged row this task belongs to; the row key is shown when absent. */
    rowTitle: string | null;
    /** The Group field value; records sharing one are gathered under a heading row. */
    groupKey?: string | null;
    /** Label for that heading; the group key is shown when absent. */
    groupTitle?: string | null;
    /** True when the record refuses to be moved or resized, whatever the maker has allowed. */
    isLocked: boolean;
    /** How the record is drawn. Absent means a bar. */
    kind?: TaskKind;
    /** The icon an icon record shows: a built-in icon name, or short text drawn as is. */
    icon?: string | null;
    /** A colour a display rule gave the record, which wins over the colour scheme. */
    displayColor?: string | null;
    /** What a display rule calls the record, e.g. "Annual leave". */
    displayLabel?: string | null;
    /** True for time the row is unavailable: a bar overlapping it is flagged as a clash. */
    blocks?: boolean;
    /** Text written on the bar, from the label field or template. */
    label?: string | null;
    /** How many the record stands for, shown as a badge when more than one. */
    quantity?: number | null;
    /** A second line under the row title, e.g. a role. */
    subtitle?: string | null;
    /** An image for the row's avatar. */
    image?: string | null;
    /** Values for the task list's dataset columns, keyed by lower-cased column name. */
    cells?: Record<string, string>;
}

/**
 * One column of the task list. Built-in columns are keyed with an @ (@name,
 * @group, @start, @end, @progress); any other key is a dataset column.
 */
export interface ListColumn {
    key: string;
    label: string;
    width: number;
}

/** A task placed in the hierarchy, flattened back out for rendering. */
export interface GanttRow {
    /**
     * The task the row stands for. For a merged row this is synthesised from
     * its segments: titled with the row title (or row key) and spanning all of them.
     */
    task: GanttTask;
    /** Records drawn on this row, ordered by start. Just `[task]` unless merged. */
    segments: GanttTask[];
    /** True when the row was built from a row key rather than a single record. */
    isMerged: boolean;
    /** True for a group heading, which stands for no record and only gathers the rows under it. */
    isGroup: boolean;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
    /** Span of the whole subtree, used to draw summary bars for parent tasks. */
    rollupStart: Date;
    rollupEnd: Date;
    rollupProgress: number;
    /** The group heading the row sits under, for a task list that shows groups as a column. */
    group?: { id: string; title: string };
}

/**
 * How a row stands in the current selection: picked by the user, holding the
 * selected bar, or neither.
 */
export type RowSelection = "none" | "row" | "task";

/** What the chart has selected. A row and a task are never selected together. */
export interface GanttSelection {
    taskId?: string;
    rowId?: string;
}

/** Which end of a bar a drag has hold of. "move" carries the whole bar. */
export type DragMode = "move" | "start" | "end";

/** What a drag did to the record's dates, as published to the host. */
export type EditAction = "move" | "resize";

/**
 * One edit the user made, ready for the host to save. The control never writes
 * to the dataset itself: it publishes the edit and draws it straight away,
 * holding that drawing only until the host's save comes back through the data.
 */
export interface TaskEdit {
    action: EditAction;
    taskId: string;
    /** Carried so the app can name the record it is saving without looking it up. */
    title: string;
    start: Date;
    end: Date;
}

/** Which editing gestures the maker has turned on. */
export interface EditPermissions {
    move: boolean;
    resize: boolean;
}

/** One column of the timeline, in scale-dependent units (a day, a week or a month). */
export interface TimelineTick {
    start: Date;
    end: Date;
    label: string;
    /** A second, smaller line above the label: the weekday letter on the day scale. */
    subLabel?: string;
    isToday: boolean;
    isNonWorking: boolean;
}

/** The banded header above the ticks: months for a day/week scale, years for a month scale. */
export interface TimelineBand {
    label: string;
    span: number;
}

export interface Timeline {
    ticks: TimelineTick[];
    bands: TimelineBand[];
    /** Week numbers between the bands and the ticks, on the day scale only. */
    weeks: TimelineBand[];
    start: Date;
    end: Date;
    scale: TimeScale;
    columnWidth: number;
    totalWidth: number;
    /**
     * Whether a bar is placed at its start and end times inside the day column,
     * rather than filling every day it touches. Only the day scale is fine
     * enough to draw an hour, so the other scales ignore it, and there a day
     * two of a row's bars would otherwise cover each other on is shared out
     * between them either way - see `drawnSpans`.
     */
    timeOfDay: boolean;
}

/**
 * The stretch of time a bar is drawn across, as instants, with an exclusive
 * end. It is what the chart draws rather than what the record says: a bar
 * filling whole days reaches the midnights around its dates, and one sharing a
 * day hands over at the hour the next bar starts.
 */
export interface DrawnSpan {
    start: Date;
    end: Date;
}

export interface GanttChartProps {
    tasks: GanttTask[];
    /** Records in the dataset, including any the date mapping rejected. */
    recordCount: number;
    /** Column names the dataset actually exposes, surfaced when mapping fails. */
    availableColumns: string[];
    /** Field settings that name a column the dataset does not have, e.g. { setting: "Title field", field: "resource.name" }. */
    unmatchedFields: { setting: string; field: string }[];
    /** Parts of the Field mapping and Options settings that could not be used, worded for the maker. */
    settingProblems: string[];
    /** The start/end column names currently configured. */
    dateFieldNames: { start: string; end: string };
    /** The selected record; a row and a task are never selected at once. */
    selectedTaskId?: string;
    /** The selected row: a group heading or merged row by its internal row id, otherwise a task id. */
    selectedRowId?: string;
    density: Density;
    timeScale: TimeScale;
    /** Which clock times are drawn on. The toolbar owns it once the user picks. */
    timeZone: TimeZoneMode;
    /** Whether bars take their colour from the time-based status or from their colour key. */
    colorMode: ColorMode;
    /** The maker's legend, as JSON or "Value = #colour" shorthand; blank leaves the colours to the control. */
    colorLegend: string;
    showToolbar: boolean;
    showCurrentTime: boolean;
    showProgress: boolean;
    showLegend: boolean;
    /** Places bars at their start and end times on the day scale; off fills whole days, bar a day two records share. */
    useTimeOfDay: boolean;
    barStyle: BarStyle;
    /** The task list's columns in order; null keeps the built-in name, dates and progress. */
    listColumns: ListColumn[] | null;
    /** Where the user's choice of hidden columns is kept, so each chart keeps its own. */
    columnsStorageKey: string;
    /** An avatar before each row title. */
    showAvatars: boolean;
    /** Heading for records a display rule sends to the unallocated pool. */
    poolTitle: string;
    /** Notes for the maker about the display rules, e.g. values no rule maps. Shown with the settings button only. */
    displayNotes: string[];
    /** Shows the settings button, which only a maker should see. */
    showSettings: boolean;
    /** Opens the settings panel; supplied by the view, not by the control. */
    onOpenSettings?: () => void;
    /** True while the chart shows draft settings rather than the saved ones. */
    isPreviewing?: boolean;
    /** Drops the draft and goes back to the saved settings. */
    onDiscardPreview?: () => void;
    /** Whether the user may move or resize a bar. Both off leaves the chart read-only. */
    canEdit: EditPermissions;
    isLoading: boolean;
    hasNextPage: boolean;
    /** Allocated size from the host; 0 means "not constrained, fill the parent". */
    width: number;
    height: number;
    /** The chart resolves the click; undefined means nothing is selected any more. */
    onSelect: (taskId: string | undefined) => void;
    /** Selects a whole row rather than one of the records drawn on it. */
    onSelectRow: (rowId: string | undefined) => void;
    onOpen: (taskId: string) => void;
    /** A completed drag, for the host to save. */
    onEdit: (edit: TaskEdit) => void;
    onLoadMore: () => void;
    /** Timeline boundary as a timestamp; undefined falls back to the earliest task start. */
    start?: number;
    /** Timeline boundary as a timestamp; undefined falls back to the latest task end. */
    end?: number;
}
