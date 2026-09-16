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
import { Density, GanttChartProps, GanttSelection, TimeScale } from "../types";
import {
    BAR_HEIGHT,
    buildRows,
    buildTimeline,
    collectParentIds,
    dateToOffset,
    getTaskExtent,
    instantToOffset,
    isSameDay,
    ROW_HEIGHT,
    rowIdOf,
    selectRow,
    selectTask,
    startOfDay,
} from "../utils";
import { EmptyReason, GanttEmptyState } from "./GanttEmptyState";
import { GanttTaskRow } from "./GanttTaskRow";
import { GanttToolbar } from "./GanttToolbar";
import { DismissIcon } from "./icons";

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
/** Ten years; a longer boundary is treated as a typo rather than drawn. */
const MAX_BOUNDARY_SPAN_MS = 3653 * 86400000;

const MS_PER_HOUR = 3600000;

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
    isLoading,
    hasNextPage,
    width,
    height,
    onSelect,
    onSelectRow,
    onOpen,
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

    const filteredTasks = React.useMemo(() => {
        const term = search.trim().toLowerCase();

        if (!term) {
            return tasks;
        }

        return tasks.filter(
            (task) =>
                task.title.toLowerCase().indexOf(term) >= 0 ||
                (task.category ?? "").toLowerCase().indexOf(term) >= 0 ||
                (task.rowKey ?? "").toLowerCase().indexOf(term) >= 0 ||
                (task.rowTitle ?? "").toLowerCase().indexOf(term) >= 0
        );
    }, [tasks, search]);

    const rows = React.useMemo(() => buildRows(filteredTasks, collapsedIds), [filteredTasks, collapsedIds]);

    // Built from every task rather than the filtered set, so searching narrows
    // the chart without rewriting the legend under it.
    const colors = React.useMemo(
        () => buildColorScheme(colorMode, colorLegend, tasks),
        [colorMode, colorLegend, tasks]
    );

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
    const minListWidth = Math.max(
        MIN_LIST_WIDTH[density] -
            (showProgress ? 0 : isDetailed ? LIST_COLUMN_WIDTHS.progress : LIST_COLUMN_WIDTHS.progressCompact),
        0
    );

    // Switching into detailed mode from a narrow compact pane would hide the
    // task name behind the extra columns, so widen to that mode's floor.
    React.useEffect(() => {
        setListWidth((current) => Math.max(minListWidth, current));
    }, [density, minListWidth]);

    // Derived from every task, not just the visible rows, so that collapse-all
    // still reaches parents whose own parent is already collapsed.
    const parentIds = React.useMemo(() => collectParentIds(filteredTasks), [filteredTasks]);

    /**
     * Budget for indentation. A deep tree would otherwise push the task name out
     * of its column, so indentation stops once the name is down to its minimum
     * legible width. Widening the splitter buys back indentation depth.
     */
    const trailingColumns = isDetailed ? LIST_COLUMN_WIDTHS.date * 2 + progressColumnWidth : progressColumnWidth;
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
            setListWidth(Math.min(MAX_LIST_WIDTH, Math.max(minListWidth, next)));
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
            setListWidth((current) => Math.min(MAX_LIST_WIDTH, current + step));
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
                <div className={styles.tickRow}>
                    {timeline.ticks.map((tick) => (
                        <div
                            key={tick.start.getTime()}
                            className={mergeClasses(
                                styles.tickCell,
                                tick.isNonWorking && styles.tickCellNonWorking,
                                tick.isToday && showCurrentTime && styles.tickCellToday
                            )}
                        >
                            {tick.label}
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
                </div>
            ) : null,
        [styles, timeScale, timeline, listWidth]
    );

    const toolbar = showToolbar ? (
        <GanttToolbar
            density={density}
            timeScale={timeScale}
            search={search}
            canCollapse={parentIds.length > 0}
            allCollapsed={allCollapsed}
            onDensityChange={setDensity}
            onTimeScaleChange={setTimeScale}
            onSearchChange={setSearch}
            onToggleAll={handleToggleAll}
            onScrollToToday={() => scrollToDate(today)}
            onFitToWidth={handleFitToWidth}
        />
    ) : null;

    if (isLoading && tasks.length === 0) {
        return (
            <div className={styles.root} style={containerStyle}>
                {toolbar}
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
                <GanttEmptyState
                    reason={reason}
                    search={search}
                    recordCount={recordCount}
                    availableColumns={availableColumns}
                    dateFieldNames={dateFieldNames}
                />
            </div>
        );
    }

    return (
        <div className={styles.root} style={containerStyle}>
            {toolbar}

            {unmatchedKey && unmatchedKey !== dismissedKey && (
                <MessageBar intent="warning" layout="multiline" style={{ flexShrink: 0 }}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {unmatchedFields.length === 1
                                ? "A field setting doesn't match any column"
                                : "Some field settings don't match any column"}
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
                            <div
                                role="columnheader"
                                className={mergeClasses(styles.listCell, styles.listCellName, styles.headerCellText)}
                            >
                                Task
                            </div>
                            {!isDetailed && showProgress && (
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
                            {isDetailed && (
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
                                aria-valuemax={MAX_LIST_WIDTH}
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
                                onSelect={handleSelect}
                                onSelectRow={handleSelectRow}
                                onOpen={onOpen}
                                onToggleExpand={handleToggleExpand}
                            />
                        ))}

                        <div style={{ height: `${(rows.length - lastVisible) * rowHeight}px` }} aria-hidden="true" />
                    </div>
                </div>
            </div>

            <div className={styles.statusBar}>
                <div className={styles.legend}>
                    {showLegend &&
                        colors.items.map((item) => (
                            <span key={item.key} className={styles.legendItem}>
                                <span
                                    className={styles.legendSwatch}
                                    style={{ backgroundColor: item.palette.fill }}
                                    aria-hidden="true"
                                />
                                {item.label}
                            </span>
                        ))}
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
                </span>
            </div>
        </div>
    );
};
