export type Density = "comfortable" | "compact";

export type TimeScale = "day" | "week" | "month";

/** Where a bar's colour comes from: the built-in time-based status, or a field on the record. */
export type ColorMode = "status" | "field";

export interface GanttTask {
    id: string;
    title: string;
    start: Date;
    end: Date;
    progress: number;
    parentId: string | null;
    category: string | null;
    /** The value the colour scheme matches on, when colouring by a field. */
    colorKey: string | null;
    /** Tasks sharing a row key are drawn as separate bars on a single row. */
    rowKey: string | null;
    /** Label for the merged row this task belongs to; the row key is shown when absent. */
    rowTitle: string | null;
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
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
    /** Span of the whole subtree, used to draw summary bars for parent tasks. */
    rollupStart: Date;
    rollupEnd: Date;
    rollupProgress: number;
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

/** One column of the timeline, in scale-dependent units (a day, a week or a month). */
export interface TimelineTick {
    start: Date;
    end: Date;
    label: string;
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
    start: Date;
    end: Date;
    scale: TimeScale;
    columnWidth: number;
    totalWidth: number;
}

export interface GanttChartProps {
    tasks: GanttTask[];
    /** Records in the dataset, including any the date mapping rejected. */
    recordCount: number;
    /** Column names the dataset actually exposes, surfaced when mapping fails. */
    availableColumns: string[];
    /** Field settings that name a column the dataset does not have, e.g. { setting: "Title field", field: "resource.name" }. */
    unmatchedFields: { setting: string; field: string }[];
    /** The start/end column names currently configured. */
    dateFieldNames: { start: string; end: string };
    /** The selected record; a row and a task are never selected at once. */
    selectedTaskId?: string;
    /** The selected row: a Row field value when grouping, otherwise a task id. */
    selectedRowId?: string;
    density: Density;
    timeScale: TimeScale;
    /** Whether bars take their colour from the time-based status or from their colour key. */
    colorMode: ColorMode;
    /** The maker's legend, as JSON or "Value = #colour" shorthand; blank leaves the colours to the control. */
    colorLegend: string;
    showToolbar: boolean;
    showCurrentTime: boolean;
    showProgress: boolean;
    showLegend: boolean;
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
    onLoadMore: () => void;
    /** Timeline boundary as a timestamp; undefined falls back to the earliest task start. */
    start?: number;
    /** Timeline boundary as a timestamp; undefined falls back to the latest task end. */
    end?: number;
}
