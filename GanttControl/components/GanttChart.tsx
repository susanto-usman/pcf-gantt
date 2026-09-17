import {
    Button,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import * as React from "react";
import { buildColorScheme } from "../colors";
import { cssVars, LIST_COLUMN_WIDTHS, MIN_NAME_TEXT_WIDTH, NAME_CELL_CHROME, useGanttStyles } from "../styles";
import { normaliseText } from "../display";
import { Density, GanttChartProps, GanttRow, GanttSelection, TaskEdit, TimeScale } from "../types";
import {
    applyPendingEdits,
    BAR_HEIGHT,
    buildRows,
    buildTimeline,
    collectParentIds,
    dateToOffset,
    getTaskExtent,
    getTaskStatus,
    GROUP_ROW_PREFIX,
    instantToOffset,
    isSameDay,
    POOL_GROUP_ID,
    ROW_HEIGHT,
    rowIdOf,
    selectRow,
    selectTask,
    startOfDay,
} from "../utils";
import { EmptyReason, GanttEmptyState } from "./GanttEmptyState";
import { GanttTaskRow, GroupSpan } from "./GanttTaskRow";
import { ColumnChoice, FilterChip, GanttToolbar } from "./GanttToolbar";
import { DismissIcon, SettingsIcon } from "./icons";

/**
 * Detailed mode carries three extra fixed-width columns, so it needs a wider
 * floor and default than compact or the task name is squeezed out.
 */
const MIN_LIST_WIDTH: Record<Density, number> = { comfortable: 340, compact: 160 };
const DEFAULT_LIST_WIDTH: Record<Density, number> = { comfortable: 440, compact: 260 };
const MAX_LIST_WIDTH = 640;
/** Rows rendered above and below the viewport so scrolling stays smooth. */
const OVERSCAN = 8;
const BOUNDARY_DEBOUNCE_MS = 500;
/**
 * How long an edit stays drawn before the chart gives up waiting for the host.
 * The usual settlement is the dataset coming back changed; this is the backstop
 * for an app that was never wired up to save anything, so the bar returns to
 * where the data still says it is rather than lying indefinitely.
 */
const PENDING_TIMEOUT_MS = 8000;
/** Ten years; a longer boundary is treated as a typo rather than drawn. */
const MAX_BOUNDARY_SPAN_MS = 3653 * 86400000;

const MS_PER_HOUR = 3600000;

/** Chip keys: the search has one chip, and each legend item in the filter has its own. */
const SEARCH_CHIP = "search";
const LEGEND_CHIP = "legend:";

/** Room the name column keeps beside configured columns, at the least and by default. */
const MIN_NAME_COLUMN = 140;
const DEFAULT_NAME_COLUMN = 220;

const HEADER_BAND_HEIGHT = 24;
const HEADER_WEEK_HEIGHT = 20;
const HEADER_TICK_HEIGHT = 24;
const HEADER_TALL_TICK_HEIGHT = 34;

/** The hidden columns a user chose, from this browser; storage can be missing or refuse. */
function readHiddenColumns(key: string): ReadonlySet<string> {
    try {
        const stored = window.localStorage.getItem(key);
        const parsed: unknown = stored ? JSON.parse(stored) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
        return new Set();
    }
}

function writeHiddenColumns(key: string, hidden: ReadonlySet<string>): void {
    try {
        if (hidden.size === 0) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, JSON.stringify([...hidden]));
        }
    } catch {
        // The choice then lasts for this session only.
    }
}

/** Follows value, but only once it has stopped changing for delayMs. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = React.useState(value);

    React.useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(timeoutId);
    }, [value, delayMs]);

    return debounced;
}

export const GanttChart: React.FC<GanttChartProps> = ({
    tasks,
    recordCount,
    availableColumns,
    unmatchedFields,
    settingProblems,
    dateFieldNames,
    selectedTaskId,
    selectedRowId,
    density: densityProp,
    timeScale: timeScaleProp,
    colorMode,
    colorLegend,
    showToolbar,
    showCurrentTime,
    showProgress,
    showLegend,
    barStyle,
    listColumns,
    columnsStorageKey,
    showAvatars,
    poolTitle,
    displayNotes,
    showSettings,
    onOpenSettings,
    isPreviewing,
    onDiscardPreview,
    canEdit,
    isLoading,
    hasNextPage,
    width,
    height,
    onSelect,
    onSelectRow,
    onOpen,
    onEdit,
    onLoadMore,
    start,
    end,
}) => {
    const styles = useGanttStyles();
    // Held in state rather than a ref: the scroll area is absent from the
    // loading and empty trees, so effects must re-run when it mounts.
    const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);

    const [density, setDensity] = React.useState<Density>(densityProp);
    const [timeScale, setTimeScale] = React.useState<TimeScale>(timeScaleProp);
    const [search, setSearch] = React.useState("");
    const [collapsedIds, setCollapsedIds] = React.useState<ReadonlySet<string>>(() => new Set<string>());
    const [listWidth, setListWidth] = React.useState(DEFAULT_LIST_WIDTH[densityProp]);
    const [isResizing, setIsResizing] = React.useState(false);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(height);
    // Two clocks: `now` moves the marker within the day, while `today` stays
    // day-granular so the timeline, task status and segment memos are not
    // rebuilt on every tick.
    const [now, setNow] = React.useState(() => new Date());
    const [today, setToday] = React.useState(() => startOfDay(new Date()));

    /**
     * The host echoes a selection back through updateView, a round trip the
     * highlight should not wait for, so the chart holds it and the control
     * follows. Props win whenever they disagree, which is how a selection made
     * outside the control arrives.
     */
    const [selection, setSelection] = React.useState<GanttSelection>({ taskId: selectedTaskId, rowId: selectedRowId });
    const selectionRef = React.useRef(selection);
    selectionRef.current = selection;

    React.useEffect(() => {
        setSelection((current) =>
            current.taskId === selectedTaskId && current.rowId === selectedRowId
                ? current
                : { taskId: selectedTaskId, rowId: selectedRowId }
        );
    }, [selectedTaskId, selectedRowId]);

    const handleSelect = React.useCallback(
        (taskId: string) => {
            const next = selectTask(selectionRef.current, taskId);

            setSelection(next);
            onSelect(next.taskId);
        },
        [onSelect]
    );

    const handleSelectRow = React.useCallback(
        (rowId: string) => {
            const next = selectRow(selectionRef.current, rowId);

            setSelection(next);
            onSelectRow(next.rowId);
        },
        [onSelectRow]
    );
    // Keyed by the mismatch itself, so fixing one setting and breaking another shows the notice again.
    const unmatchedKey = unmatchedFields.map((item) => `${item.setting}=${item.field}`).join("|");
    const [dismissedKey, setDismissedKey] = React.useState("");
    const problemsKey = settingProblems.join("|");
    const [dismissedProblemsKey, setDismissedProblemsKey] = React.useState("");
    const notesKey = displayNotes.join("|");
    const [dismissedNotesKey, setDismissedNotesKey] = React.useState("");

    /** Columns ------------------------------------------------------------ */
    /** The columns this user hid, kept in their browser against this chart's set of columns. */
    const [hiddenColumns, setHiddenColumns] = React.useState<ReadonlySet<string>>(() =>
        readHiddenColumns(columnsStorageKey)
    );

    React.useEffect(() => setHiddenColumns(readHiddenColumns(columnsStorageKey)), [columnsStorageKey]);

    const handleToggleColumn = React.useCallback(
        (key: string) => {
            setHiddenColumns((current) => {
                const next = new Set(current);

                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }

                writeHiddenColumns(columnsStorageKey, next);
                return next;
            });
        },
        [columnsStorageKey]
    );

    // The name column holds the tree, so it is never hidden.
    const visibleColumns = React.useMemo(
        () => listColumns?.filter((column) => column.key === "@name" || !hiddenColumns.has(column.key)) ?? null,
        [listColumns, hiddenColumns]
    );
    const columnChoices = React.useMemo<ColumnChoice[]>(
        () =>
            (listColumns ?? [])
                .filter((column) => column.key !== "@name")
                .map((column) => ({ key: column.key, label: column.label, visible: !hiddenColumns.has(column.key) })),
        [listColumns, hiddenColumns]
    );
    const groupAsColumn = visibleColumns?.some((column) => column.key === "@group") ?? false;

    /** The unallocated pool's category filter; blank shows every category. */
    const [poolCategory, setPoolCategory] = React.useState("");

    /** Editing ---------------------------------------------------------- */
    /**
     * Drags the user has made and the host has not yet saved. The chart draws
     * them immediately — a bar that snapped back while the round trip ran would
     * read as the drag having failed — and lets them go once the records change.
     */
    const [pendingEdits, setPendingEdits] = React.useState<ReadonlyMap<string, { start: Date; end: Date }>>(
        () => new Map()
    );

    const clearPending = React.useCallback(() => {
        setPendingEdits((current) => (current.size === 0 ? current : new Map()));
    }, []);

    const handleEdit = React.useCallback(
        (edit: TaskEdit) => {
            setPendingEdits((current) => new Map(current).set(edit.taskId, { start: edit.start, end: edit.end }));
            onEdit(edit);
        },
        [onEdit]
    );

    const liveTasks = React.useMemo(() => applyPendingEdits(tasks, pendingEdits), [tasks, pendingEdits]);

    /** The task list the pending edits were made against, to tell a save apart from a redraw. */
    const editedAgainst = React.useRef(tasks);

    React.useEffect(() => {
        if (pendingEdits.size === 0) {
            editedAgainst.current = tasks;
            return undefined;
        }

        // The control hands back the same array while the records are unchanged,
        // so a different one means the data moved — and whichever way the save
        // went, what it now says wins over what the chart drew.
        if (editedAgainst.current !== tasks) {
            clearPending();
            return undefined;
        }

        // Restarted by each further edit, so a second drag is not cut short by
        // the first one's clock.
        const timeoutId = window.setTimeout(clearPending, PENDING_TIMEOUT_MS);
        return () => window.clearTimeout(timeoutId);
    }, [pendingEdits, tasks, clearPending]);

    // Maker-facing properties act as the initial value; the toolbar owns the
    // setting afterwards, so re-publishing a new default still takes effect.
    React.useEffect(() => setDensity(densityProp), [densityProp]);
    React.useEffect(() => setTimeScale(timeScaleProp), [timeScaleProp]);

    // The marker advances on the hour, and the date rolls over on the tick
    // past midnight. Each timeout is measured against the clock rather than
    // chained, so a throttled background tab resumes on the next boundary
    // instead of accumulating drift.
    React.useEffect(() => {
        if (!showCurrentTime) {
            return undefined;
        }

        const clock = new Date();
        const msUntilNextHour =
            MS_PER_HOUR - (clock.getMinutes() * 60000 + clock.getSeconds() * 1000 + clock.getMilliseconds());
        const timeoutId = window.setTimeout(() => {
            const current = new Date();

            setNow(current);
            setToday((previous) => (isSameDay(previous, current) ? previous : startOfDay(current)));
        }, msUntilNextHour + 1000);
        return () => window.clearTimeout(timeoutId);
    }, [showCurrentTime, now]);

    // A hidden marker stops ticking, so showing it again resyncs rather than
    // sitting at an hours-old position until the next boundary.
    React.useEffect(() => {
        if (showCurrentTime) {
            setNow((previous) => (Date.now() - previous.getTime() < MS_PER_HOUR ? previous : new Date()));
        }
    }, [showCurrentTime]);

    // Built from every task rather than the filtered set, so searching or
    // filtering narrows the chart without rewriting the legend under it.
    const colors = React.useMemo(
        () => buildColorScheme(colorMode, colorLegend, tasks),
        [colorMode, colorLegend, tasks]
    );

    /**
     * Legend items the user has clicked; empty shows every bar. Held as keys,
     * and read through the current legend, so a key the legend no longer has —
     * the maker switched scheme, or the value left the data — stops filtering
     * rather than hiding everything with no swatch left to click.
     */
    const [legendKeys, setLegendKeys] = React.useState<ReadonlySet<string>>(() => new Set<string>());
    const legendFilter = React.useMemo<ReadonlySet<string>>(
        () => new Set(colors.items.filter((item) => legendKeys.has(item.key)).map((item) => item.key)),
        [colors, legendKeys]
    );

    const handleToggleLegend = React.useCallback((key: string) => {
        setLegendKeys((current) => {
            const next = new Set(current);

            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }

            return next;
        });
    }, []);

    /** The categories in the pool, for its filter, in the order they first appear. */
    const poolCategories = React.useMemo(() => {
        const seen = new Map<string, string>();

        for (const task of tasks) {
            const key = normaliseText(task.category);

            if (task.kind === "pool" && key && !seen.has(key)) {
                seen.set(key, (task.category ?? "").trim());
            }
        }

        return [...seen.entries()].map(([key, label]) => ({ key, label }));
    }, [tasks]);
    // A category that has left the data stops filtering rather than emptying the pool.
    const activePoolCategory = poolCategories.some((item) => item.key === poolCategory) ? poolCategory : "";

    const filteredTasks = React.useMemo(() => {
        const term = search.trim().toLowerCase();

        if (!term && legendFilter.size === 0 && !activePoolCategory) {
            return liveTasks;
        }

        return liveTasks.filter(
            (task) =>
                (!activePoolCategory || task.kind !== "pool" || normaliseText(task.category) === activePoolCategory) &&
                (!term ||
                    task.title.toLowerCase().indexOf(term) >= 0 ||
                    (task.label ?? "").toLowerCase().indexOf(term) >= 0 ||
                    (task.subtitle ?? "").toLowerCase().indexOf(term) >= 0 ||
                    (task.category ?? "").toLowerCase().indexOf(term) >= 0 ||
                    (task.rowKey ?? "").toLowerCase().indexOf(term) >= 0 ||
                    (task.rowTitle ?? "").toLowerCase().indexOf(term) >= 0 ||
                    (task.groupTitle ?? task.groupKey ?? "").toLowerCase().indexOf(term) >= 0) &&
                // Matched on the record's own dates, the same ones its bar is coloured by.
                (legendFilter.size === 0 ||
                    legendFilter.has(
                        colors.keyFor(task.colorKey ?? "", getTaskStatus(task.start, task.end, task.progress, today))
                    ))
        );
    }, [liveTasks, search, legendFilter, colors, today, activePoolCategory]);

    // With groups shown as a column there are no heading rows, so nothing to
    // collapse them with: a heading collapsed before would hide its rows for good.
    const rows = React.useMemo(() => {
        if (!groupAsColumn) {
            return buildRows(filteredTasks, collapsedIds, poolTitle);
        }

        const collapsed = new Set([...collapsedIds].filter((id) => !id.startsWith(GROUP_ROW_PREFIX)));
        return buildRows(filteredTasks, collapsed, poolTitle).filter((row) => !row.isGroup);
    }, [filteredTasks, collapsedIds, poolTitle, groupAsColumn]);

    // Canvas pushes every keystroke of a bound input through, so wait for the
    // boundary to settle rather than rebuilding the timeline per character.
    const boundaryStart = useDebouncedValue(start, BOUNDARY_DEBOUNCE_MS);
    const boundaryEnd = useDebouncedValue(end, BOUNDARY_DEBOUNCE_MS);

    const timeline = React.useMemo(() => {
        const extent = getTaskExtent(filteredTasks);
        let rangeStart = boundaryStart ?? extent.start.getTime();
        let rangeEnd = boundaryEnd ?? extent.end.getTime();

        // A half-typed year (e.g. 202) would otherwise render centuries of day
        // columns, so an inverted or implausibly long range falls back to the tasks.
        if (rangeStart > rangeEnd || rangeEnd - rangeStart > MAX_BOUNDARY_SPAN_MS) {
            rangeStart = extent.start.getTime();
            rangeEnd = extent.end.getTime();
        }

        return buildTimeline(new Date(rangeStart), new Date(rangeEnd), timeScale, density, today);
    }, [filteredTasks, timeScale, density, today, boundaryStart, boundaryEnd]);

    const rowHeight = ROW_HEIGHT[density];
    const isDetailed = density === "comfortable";
    const progressColumnWidth = showProgress
        ? isDetailed
            ? LIST_COLUMN_WIDTHS.progress
            : LIST_COLUMN_WIDTHS.progressCompact
        : 0;
    // Configured columns keep their own widths, and the name column takes what is left.
    const fixedColumnsWidth = visibleColumns
        ? visibleColumns.reduce((sum, column) => sum + (column.key === "@name" ? 0 : column.width), 0)
        : 0;
    const minListWidth = visibleColumns
        ? fixedColumnsWidth + MIN_NAME_COLUMN
        : Math.max(
              MIN_LIST_WIDTH[density] -
                  (showProgress ? 0 : isDetailed ? LIST_COLUMN_WIDTHS.progress : LIST_COLUMN_WIDTHS.progressCompact),
              0
          );
    const maxListWidth = visibleColumns ? Math.max(MAX_LIST_WIDTH, fixedColumnsWidth + 480) : MAX_LIST_WIDTH;

    // Switching into detailed mode from a narrow compact pane would hide the
    // task name behind the extra columns, so widen to that mode's floor.
    React.useEffect(() => {
        setListWidth((current) => Math.max(minListWidth, current));
    }, [density, minListWidth]);

    const clampListWidth = (width: number) => Math.min(maxListWidth, Math.max(minListWidth, width));
    const columnsKey = listColumns ? listColumns.map((column) => `${column.key}:${column.width}`).join("|") : "";
    const previousFixedWidth = React.useRef<number | null>(null);

    // A new set of columns starts the pane at their width plus room for the name.
    React.useEffect(() => {
        previousFixedWidth.current = fixedColumnsWidth;

        if (visibleColumns) {
            setListWidth(clampListWidth(fixedColumnsWidth + DEFAULT_NAME_COLUMN));
        }
        // Keyed on the columns alone; hiding one is handled below.
    }, [columnsKey]);

    // Showing or hiding a column moves the pane by that column, so the name keeps the room it had.
    React.useEffect(() => {
        const previous = previousFixedWidth.current;
        previousFixedWidth.current = fixedColumnsWidth;

        if (visibleColumns && previous !== null && previous !== fixedColumnsWidth) {
            setListWidth((current) => clampListWidth(current + fixedColumnsWidth - previous));
        }
    }, [fixedColumnsWidth]);

    // Derived from every task, not just the visible rows, so that collapse-all
    // still reaches parents whose own parent is already collapsed.
    const parentIds = React.useMemo(() => collectParentIds(filteredTasks), [filteredTasks]);

    /**
     * Budget for indentation. A deep tree would otherwise push the task name out
     * of its column, so indentation stops once the name is down to its minimum
     * legible width. Widening the splitter buys back indentation depth.
     */
    const trailingColumns = visibleColumns
        ? fixedColumnsWidth
        : isDetailed
          ? LIST_COLUMN_WIDTHS.date * 2 + progressColumnWidth
          : progressColumnWidth;
    const maxIndent = Math.max(0, listWidth - trailingColumns - NAME_CELL_CHROME - MIN_NAME_TEXT_WIDTH);

    /** Splitter ---------------------------------------------------------- */
    const handleSplitterDown = (event: React.PointerEvent<HTMLDivElement>) => {
        // Primary button only: a right- or middle-click must not start a drag.
        if (event.button !== 0) {
            return;
        }

        // Every value the deferred handlers need is read here, while the event
        // is still live. React 16 pools synthetic events and nulls their
        // properties once this handler returns.
        const target = event.currentTarget;
        const { pointerId } = event;
        const startX = event.clientX;
        const startWidth = listWidth;

        const handleMove = (moveEvent: PointerEvent) => {
            const next = startWidth + moveEvent.clientX - startX;
            setListWidth(Math.min(maxListWidth, Math.max(minListWidth, next)));
        };

        const stopResize = () => {
            // Detach first: if releasing capture throws, the drag must still
            // end rather than leaving the pane following the pointer.
            target.removeEventListener("pointermove", handleMove);
            target.removeEventListener("pointerup", stopResize);
            target.removeEventListener("pointercancel", stopResize);
            setIsResizing(false);

            if (target.hasPointerCapture(pointerId)) {
                target.releasePointerCapture(pointerId);
            }
        };

        target.setPointerCapture(pointerId);
        setIsResizing(true);

        target.addEventListener("pointermove", handleMove);
        target.addEventListener("pointerup", stopResize);
        target.addEventListener("pointercancel", stopResize);
        event.preventDefault();
    };

    const handleSplitterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 40 : 10;

        if (event.key === "ArrowLeft") {
            event.preventDefault();
            setListWidth((current) => Math.max(minListWidth, current - step));
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setListWidth((current) => Math.min(maxListWidth, current + step));
        }
    };

    /** Scrolling --------------------------------------------------------- */
    const handleScroll = React.useCallback(
        (event: React.UIEvent<HTMLDivElement>) => {
            const element = event.currentTarget;
            setScrollTop(element.scrollTop);

            // Pull the next dataset page in as the user nears the bottom.
            if (
                hasNextPage &&
                !isLoading &&
                element.scrollHeight - element.scrollTop - element.clientHeight < rowHeight * 6
            ) {
                onLoadMore();
            }
        },
        [hasNextPage, isLoading, onLoadMore, rowHeight]
    );

    React.useEffect(() => {
        if (!scrollEl) {
            return undefined;
        }

        setViewportHeight(scrollEl.clientHeight);

        if (typeof ResizeObserver === "undefined") {
            return undefined;
        }

        const observer = new ResizeObserver((entries) => setViewportHeight(entries[0].contentRect.height));
        observer.observe(scrollEl);
        return () => observer.disconnect();
    }, [scrollEl]);

    const scrollToDate = React.useCallback(
        (date: Date) => {
            if (!scrollEl) {
                return;
            }

            const offset = dateToOffset(date, timeline);
            const visibleTimelineWidth = scrollEl.clientWidth - listWidth;
            scrollEl.scrollTo({
                left: Math.max(0, offset - visibleTimelineWidth / 2),
                behavior: "smooth",
            });
        },
        [scrollEl, timeline, listWidth]
    );

    /** Picks the finest scale whose full span still fits the visible timeline. */
    const handleFitToWidth = React.useCallback(() => {
        if (!scrollEl) {
            return;
        }

        const available = Math.max(1, scrollEl.clientWidth - listWidth);
        const spanInDays = Math.max(1, (timeline.end.getTime() - timeline.start.getTime()) / 86400000 + 1);

        let next: TimeScale = "month";

        if (spanInDays * 28 <= available) {
            next = "day";
        } else if ((spanInDays / 7) * 44 <= available) {
            next = "week";
        }

        setTimeScale(next);
        scrollEl.scrollTo({ left: 0, behavior: "smooth" });
    }, [scrollEl, listWidth, timeline]);

    const handleToggleExpand = React.useCallback((taskId: string) => {
        setCollapsedIds((current) => {
            const next = new Set(current);

            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }

            return next;
        });
    }, []);

    const allCollapsed = parentIds.length > 0 && parentIds.every((id) => collapsedIds.has(id));

    const handleToggleAll = React.useCallback(() => {
        setCollapsedIds((current) => {
            const everyCollapsed = parentIds.length > 0 && parentIds.every((id) => current.has(id));
            return everyCollapsed ? new Set<string>() : new Set(parentIds);
        });
    }, [parentIds]);

    /** Windowing --------------------------------------------------------- */
    const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const lastVisible = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN);
    const visibleRows = rows.slice(firstVisible, lastVisible);

    const currentTimeOffset = showCurrentTime ? instantToOffset(now, timeline) : 0;
    const isTodayInRange = showCurrentTime && today >= timeline.start && today <= timeline.end;

    /** The pool's category filter, as a strip of buttons beside its heading. */
    const poolFilter =
        poolCategories.length > 1 ? (
            <span
                className={styles.poolFilter}
                role="group"
                aria-label={`Filter ${poolTitle}`}
                // Choosing a category is not choosing the row it sits on.
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                {[{ key: "", label: "All" }, ...poolCategories].map((item) => (
                    <button
                        key={item.key || "all"}
                        type="button"
                        aria-pressed={activePoolCategory === item.key}
                        className={mergeClasses(
                            styles.poolFilterButton,
                            activePoolCategory === item.key && styles.poolFilterButtonActive
                        )}
                        onClick={() => setPoolCategory(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </span>
        ) : null;

    /**
     * With groups as a column, each group's label is drawn once over its rows
     * in view, from the first of them the viewport shows, so it stays readable
     * however far into a long group the user has scrolled.
     */
    const groupSpans = React.useMemo(() => {
        const spans = new Map<number, GroupSpan>();
        const ends = new Set<number>();

        if (!groupAsColumn) {
            return { spans, ends };
        }

        const viewportFirst = Math.floor(scrollTop / rowHeight);
        // Counted only to the viewport's foot, so the label centres on what can be seen.
        const spanLimit = Math.min(lastVisible, Math.ceil((scrollTop + viewportHeight) / rowHeight));
        const groupOf = (row: GanttRow | undefined) => row?.group?.id ?? "";

        for (let index = firstVisible; index < lastVisible; index++) {
            const row = rows[index];

            if (groupOf(rows[index + 1]) !== groupOf(row)) {
                ends.add(index);
            }

            // A span starts at the first row of a group, or at the viewport's top inside one.
            const startsHere =
                index === Math.max(firstVisible, viewportFirst)
                    ? true
                    : index > viewportFirst && groupOf(rows[index - 1]) !== groupOf(row);

            if (!startsHere || !row.group) {
                continue;
            }

            let count = 1;

            while (index + count < Math.max(spanLimit, index + 1) && groupOf(rows[index + count]) === groupOf(row)) {
                count++;
            }

            spans.set(index, {
                rows: count,
                content: (
                    <>
                        <span>{row.group.title}</span>
                        {row.group.id === POOL_GROUP_ID && poolFilter}
                    </>
                ),
            });
        }

        return { spans, ends };
    }, [groupAsColumn, rows, firstVisible, lastVisible, scrollTop, viewportHeight, rowHeight, poolFilter]);

    const headerHeight =
        HEADER_BAND_HEIGHT +
        (timeline.weeks.length > 0 ? HEADER_WEEK_HEIGHT : 0) +
        (timeScale === "day" ? HEADER_TALL_TICK_HEIGHT : HEADER_TICK_HEIGHT);

    // The row to highlight: the selected row itself, or the one carrying the
    // selected record, which on a merged row is one of its segments.
    const activeRowId = React.useMemo(() => {
        const activeRow = selection.rowId
            ? rows.find((row) => rowIdOf(row) === selection.rowId)
            : selection.taskId
              ? rows.find((row) => row.segments.some((segment) => segment.id === selection.taskId))
              : undefined;
        return activeRow?.task.id;
    }, [rows, selection]);
    // Exactly one row carries tabIndex 0 so the grid is a single tab stop, and
    // it falls back to the first row when nothing is selected.
    const tabStopId = activeRowId ?? rows[0]?.task.id;

    // A set rather than the map itself, since a bar only asks whether its own
    // edit has settled.
    const pendingIds = React.useMemo<ReadonlySet<string>>(() => new Set(pendingEdits.keys()), [pendingEdits]);

    const containerStyle = {
        // An explicit allocated width stops the timeline's content width from
        // inflating the control inside a shrink-to-fit host container.
        width: width > 0 ? `${width}px` : "100%",
        height: height > 0 ? `${height}px` : "100%",
        [cssVars.rowHeight]: `${rowHeight}px`,
        [cssVars.barHeight]: `${BAR_HEIGHT[density]}px`,
        [cssVars.columnWidth]: `${timeline.columnWidth}px`,
        [cssVars.listWidth]: `${listWidth}px`,
        [cssVars.timelineWidth]: `${timeline.totalWidth}px`,
        [cssVars.headerHeight]: `${headerHeight}px`,
    } as React.CSSProperties;

    /**
     * A column per day over a year is hundreds of nodes, and neither the header
     * nor the weekend shading depends on anything a click changes, so both are
     * built once per timeline instead of once per render.
     */
    const timelineHeader = React.useMemo(
        () => (
            <div className={styles.timelinePane} role="columnheader" aria-label="Timeline">
                <div className={styles.bandRow}>
                    {timeline.bands.map((band, index) => (
                        <div
                            key={`${band.label}-${index}`}
                            className={styles.bandCell}
                            style={{ width: `${band.span * timeline.columnWidth}px` }}
                        >
                            <span className={styles.bandCellLabel}>{band.label}</span>
                        </div>
                    ))}
                </div>
                {timeline.weeks.length > 0 && (
                    <div className={styles.weekRow}>
                        {timeline.weeks.map((week, index) => (
                            <div
                                key={`${week.label}-${index}`}
                                className={styles.weekCell}
                                style={{ width: `${week.span * timeline.columnWidth}px` }}
                                title={`Week ${week.label}`}
                            >
                                {week.label}
                            </div>
                        ))}
                    </div>
                )}
                <div className={mergeClasses(styles.tickRow, timeline.scale === "day" && styles.tickRowTall)}>
                    {timeline.ticks.map((tick) => (
                        <div
                            key={tick.start.getTime()}
                            className={mergeClasses(
                                styles.tickCell,
                                tick.subLabel !== undefined && styles.tickCellTwoLine,
                                tick.isNonWorking && styles.tickCellNonWorking,
                                tick.isToday && showCurrentTime && styles.tickCellToday
                            )}
                        >
                            {tick.subLabel !== undefined ? (
                                <>
                                    <span className={styles.tickSubLabel}>{tick.subLabel}</span>
                                    <span className={styles.tickLabel}>{tick.label}</span>
                                </>
                            ) : (
                                tick.label
                            )}
                        </div>
                    ))}
                </div>
            </div>
        ),
        [styles, timeline, showCurrentTime]
    );

    const weekendShading = React.useMemo(
        () =>
            // Weekend shading spans every row, so it is painted once here.
            timeScale === "day" ? (
                <div
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        inset: 0,
                        left: `${listWidth}px`,
                        pointerEvents: "none",
                    }}
                >
                    {timeline.ticks.map((tick, index) =>
                        tick.isNonWorking ? (
                            <div
                                key={`weekend-${tick.start.getTime()}`}
                                className={styles.nonWorkingOverlay}
                                style={{
                                    left: `${index * timeline.columnWidth}px`,
                                    width: `${timeline.columnWidth}px`,
                                }}
                            />
                        ) : null
                    )}
                    {/* A dashed rule where each week starts, on the Monday the week numbers count from. */}
                    {timeline.ticks.map((tick, index) =>
                        index > 0 && tick.start.getDay() === 1 ? (
                            <div
                                key={`week-${tick.start.getTime()}`}
                                className={styles.weekLine}
                                style={{ left: `${index * timeline.columnWidth}px` }}
                            />
                        ) : null
                    )}
                </div>
            ) : null,
        [styles, timeScale, timeline, listWidth]
    );

    const searchTerm = search.trim();
    const filterChips = React.useMemo<FilterChip[]>(
        () => [
            ...(searchTerm ? [{ key: SEARCH_CHIP, label: `Search: "${searchTerm}"` }] : []),
            ...colors.items
                .filter((item) => legendFilter.has(item.key))
                .map((item) => ({
                    key: LEGEND_CHIP + item.key,
                    label: item.label,
                    color: item.palette.fill,
                })),
        ],
        [searchTerm, colors, legendFilter]
    );

    const handleRemoveFilter = React.useCallback(
        (key: string) => {
            if (key === SEARCH_CHIP) {
                setSearch("");
            } else if (key.startsWith(LEGEND_CHIP)) {
                handleToggleLegend(key.slice(LEGEND_CHIP.length));
            }
        },
        [handleToggleLegend]
    );

    const handleClearFilters = React.useCallback(() => {
        setSearch("");
        setLegendKeys(new Set());
    }, []);

    // Kept within reach while previewing, even if the draft itself hides the button.
    const openSettings = (showSettings || isPreviewing) && onOpenSettings ? onOpenSettings : undefined;

    const previewNotice = isPreviewing ? (
        <MessageBar intent="info" layout="multiline" style={{ flexShrink: 0 }}>
            <MessageBarBody>
                <MessageBarTitle>Previewing unsaved settings</MessageBarTitle>
                Copy them from the settings panel into Field mapping and Options to keep them.
            </MessageBarBody>
            <MessageBarActions>
                {onOpenSettings && (
                    <Button size="small" onClick={onOpenSettings}>
                        Open settings
                    </Button>
                )}
                {onDiscardPreview && (
                    <Button size="small" onClick={onDiscardPreview}>
                        Discard
                    </Button>
                )}
            </MessageBarActions>
        </MessageBar>
    ) : null;

    const toolbar = showToolbar ? (
        <GanttToolbar
            density={density}
            timeScale={timeScale}
            search={search}
            canCollapse={parentIds.length > 0}
            allCollapsed={allCollapsed}
            filters={filterChips}
            onRemoveFilter={handleRemoveFilter}
            onClearFilters={handleClearFilters}
            onDensityChange={setDensity}
            onTimeScaleChange={setTimeScale}
            onSearchChange={setSearch}
            onToggleAll={handleToggleAll}
            onScrollToToday={() => scrollToDate(today)}
            onFitToWidth={handleFitToWidth}
            columns={columnChoices}
            onToggleColumn={handleToggleColumn}
            onOpenSettings={openSettings}
        />
    ) : null;

    const isLegendFiltered = legendFilter.size > 0;

    const statusBar = (
        <div className={styles.statusBar}>
            <div className={styles.legend} role="group" aria-label="Filter by colour">
                {showLegend && (
                    <>
                        {colors.items.map((item) => {
                            const isActive = legendFilter.has(item.key);

                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    aria-pressed={isActive}
                                    title={isActive ? `Stop filtering by ${item.label}` : `Show only ${item.label}`}
                                    className={mergeClasses(
                                        styles.legendItem,
                                        isActive && styles.legendItemActive,
                                        isLegendFiltered && !isActive && styles.legendItemMuted
                                    )}
                                    onClick={() => handleToggleLegend(item.key)}
                                >
                                    <span
                                        className={styles.legendSwatch}
                                        style={{ backgroundColor: item.palette.fill }}
                                        aria-hidden="true"
                                    />
                                    {item.label}
                                </button>
                            );
                        })}
                        {/* With a toolbar, its chips carry the clear action instead. */}
                        {isLegendFiltered && !showToolbar && (
                            <Button appearance="transparent" size="small" onClick={() => setLegendKeys(new Set())}>
                                Clear filter
                            </Button>
                        )}
                    </>
                )}
            </div>

            <span style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS }}>
                {isLoading && <Spinner size="extra-tiny" aria-label="Loading more tasks" />}
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {`${rows.length} of ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
                </Text>
                {hasNextPage && !isLoading && (
                    <Button appearance="subtle" size="small" onClick={onLoadMore}>
                        Load more
                    </Button>
                )}
                {/* The toolbar's own button is gone with the toolbar. */}
                {!showToolbar && openSettings && (
                    <Button appearance="subtle" size="small" icon={<SettingsIcon />} onClick={openSettings}>
                        Settings
                    </Button>
                )}
            </span>
        </div>
    );

    if (isLoading && tasks.length === 0) {
        return (
            <div className={styles.root} style={containerStyle}>
                {toolbar}
                {previewNotice}
                <div className={styles.centred}>
                    <Spinner labelPosition="below" label="Loading tasks…" />
                </div>
            </div>
        );
    }

    if (rows.length === 0) {
        const reason: EmptyReason = tasks.length > 0 ? "noMatches" : recordCount > 0 ? "noValidDates" : "noData";

        return (
            <div className={styles.root} style={containerStyle}>
                {toolbar}
                {previewNotice}
                <GanttEmptyState
                    reason={reason}
                    search={search}
                    isLegendFiltered={isLegendFiltered}
                    recordCount={recordCount}
                    availableColumns={availableColumns}
                    dateFieldNames={dateFieldNames}
                />
                {/* Kept when a filter emptied the chart, so the legend that did it can undo it,
                    and without a toolbar, so the settings stay within reach. */}
                {(reason === "noMatches" || (!showToolbar && openSettings)) && statusBar}
            </div>
        );
    }

    return (
        <div className={styles.root} style={containerStyle}>
            {toolbar}
            {previewNotice}

            {problemsKey && problemsKey !== dismissedProblemsKey && (
                <MessageBar intent="warning" layout="multiline" style={{ flexShrink: 0 }}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {settingProblems.length === 1
                                ? "A setting could not be used"
                                : "Some settings could not be used"}
                        </MessageBarTitle>
                        {settingProblems.join(". ")}. The defaults apply in their place.
                    </MessageBarBody>
                    <MessageBarActions
                        containerAction={
                            <Button
                                appearance="transparent"
                                aria-label="Dismiss"
                                icon={<DismissIcon />}
                                onClick={() => setDismissedProblemsKey(problemsKey)}
                            />
                        }
                    />
                </MessageBar>
            )}

            {/* For the maker only: values the display rules leave out. */}
            {openSettings && notesKey && notesKey !== dismissedNotesKey && (
                <MessageBar intent="info" layout="multiline" style={{ flexShrink: 0 }}>
                    <MessageBarBody>
                        <MessageBarTitle>Display rules</MessageBarTitle>
                        {displayNotes.join(". ")}. Map them in the settings panel under Display.
                    </MessageBarBody>
                    <MessageBarActions
                        containerAction={
                            <Button
                                appearance="transparent"
                                aria-label="Dismiss"
                                icon={<DismissIcon />}
                                onClick={() => setDismissedNotesKey(notesKey)}
                            />
                        }
                    />
                </MessageBar>
            )}

            {unmatchedKey && unmatchedKey !== dismissedKey && (
                <MessageBar intent="warning" layout="multiline" style={{ flexShrink: 0 }}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {unmatchedFields.length === 1
                                ? "A field mapping doesn't match any column"
                                : "Some field mappings don't match any column"}
                        </MessageBarTitle>
                        {unmatchedFields.map((item) => `${item.setting} "${item.field}"`).join(", ")}. Columns received:{" "}
                        {availableColumns.join(", ")}. In a canvas app, add the column under Fields, or for a related
                        value such as resource.name add it to Items with AddColumns.
                    </MessageBarBody>
                    <MessageBarActions
                        containerAction={
                            <Button
                                appearance="transparent"
                                aria-label="Dismiss"
                                icon={<DismissIcon />}
                                onClick={() => setDismissedKey(unmatchedKey)}
                            />
                        }
                    />
                </MessageBar>
            )}

            <div ref={setScrollEl} className={styles.scrollArea} onScroll={handleScroll}>
                <div className={styles.grid} role="grid" aria-rowcount={rows.length + 1} aria-label="Gantt chart">
                    <div className={styles.headerRow} role="row" aria-rowindex={1}>
                        <div className={mergeClasses(styles.listPane, styles.listPaneHeader)}>
                            {visibleColumns ? (
                                visibleColumns.map((column) => (
                                    <div
                                        key={column.key}
                                        role="columnheader"
                                        title={column.label}
                                        className={mergeClasses(
                                            styles.listCell,
                                            column.key === "@name" ? styles.listCellName : styles.listCellColumn,
                                            styles.headerCellText,
                                            column.key === "@group" && styles.listCellGroup
                                        )}
                                        style={
                                            column.key === "@name"
                                                ? column.width
                                                    ? {
                                                          flexGrow: 0,
                                                          flexBasis: `${column.width}px`,
                                                          width: `${column.width}px`,
                                                      }
                                                    : undefined
                                                : { width: `${column.width}px` }
                                        }
                                    >
                                        {column.label}
                                    </div>
                                ))
                            ) : (
                                <div
                                    role="columnheader"
                                    className={mergeClasses(
                                        styles.listCell,
                                        styles.listCellName,
                                        styles.headerCellText
                                    )}
                                >
                                    Task
                                </div>
                            )}
                            {!visibleColumns && !isDetailed && showProgress && (
                                <div
                                    role="columnheader"
                                    className={mergeClasses(
                                        styles.listCell,
                                        styles.listCellProgressCompact,
                                        styles.headerCellText
                                    )}
                                >
                                    %
                                </div>
                            )}
                            {!visibleColumns && isDetailed && (
                                <>
                                    <div
                                        role="columnheader"
                                        className={mergeClasses(
                                            styles.listCell,
                                            styles.listCellDate,
                                            styles.headerCellText
                                        )}
                                    >
                                        Start
                                    </div>
                                    <div
                                        role="columnheader"
                                        className={mergeClasses(
                                            styles.listCell,
                                            styles.listCellDate,
                                            styles.headerCellText
                                        )}
                                    >
                                        Finish
                                    </div>
                                    {showProgress && (
                                        <div
                                            role="columnheader"
                                            className={mergeClasses(
                                                styles.listCell,
                                                styles.listCellProgress,
                                                styles.headerCellText
                                            )}
                                        >
                                            Progress
                                        </div>
                                    )}
                                </>
                            )}
                            <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="Resize the task column"
                                aria-valuenow={listWidth}
                                aria-valuemin={minListWidth}
                                aria-valuemax={maxListWidth}
                                tabIndex={0}
                                className={mergeClasses(styles.splitter, isResizing && styles.splitterActive)}
                                onPointerDown={handleSplitterDown}
                                onKeyDown={handleSplitterKeyDown}
                            />
                        </div>

                        {timelineHeader}
                    </div>

                    <div role="rowgroup" style={{ position: "relative" }}>
                        {weekendShading}

                        {/* Positioned against the timeline pane, so it stays put while scrolling. */}
                        {isTodayInRange && (
                            <div
                                aria-hidden="true"
                                className={styles.todayMarker}
                                style={{ left: `${listWidth + currentTimeOffset}px` }}
                            >
                                <span className={styles.todayFlag} />
                            </div>
                        )}

                        <div style={{ height: `${firstVisible * rowHeight}px` }} aria-hidden="true" />

                        {visibleRows.map((row, index) => (
                            <GanttTaskRow
                                key={row.task.id}
                                row={row}
                                rowIndex={firstVisible + index}
                                timeline={timeline}
                                today={today}
                                density={density}
                                colors={colors}
                                selection={row.task.id === activeRowId ? (selection.rowId ? "row" : "task") : "none"}
                                // Only passed to the selected row, so the rest keep their memoised render.
                                selectedTaskId={row.task.id === activeRowId ? selection.taskId : undefined}
                                isTabStop={row.task.id === tabStopId}
                                maxIndent={maxIndent}
                                showProgress={showProgress}
                                barStyle={barStyle}
                                columns={visibleColumns}
                                showAvatars={showAvatars}
                                groupSpan={groupSpans.spans.get(firstVisible + index)}
                                isGroupEnd={groupSpans.ends.has(firstVisible + index)}
                                headingExtra={row.isGroup && row.task.id === POOL_GROUP_ID ? poolFilter : undefined}
                                canEdit={canEdit}
                                pendingIds={pendingIds}
                                onSelect={handleSelect}
                                onSelectRow={handleSelectRow}
                                onOpen={onOpen}
                                onEdit={handleEdit}
                                onToggleExpand={handleToggleExpand}
                            />
                        ))}

                        <div style={{ height: `${(rows.length - lastVisible) * rowHeight}px` }} aria-hidden="true" />
                    </div>
                </div>
            </div>

            {statusBar}
        </div>
    );
};
