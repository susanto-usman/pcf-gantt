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
import {
    cssVars,
    LIST_COLUMN_WIDTHS,
    MIN_NAME_TEXT_WIDTH,
    NAME_CELL_CHROME,
    STATUS_LABELS,
    STATUS_TOKENS,
    useGanttStyles,
} from "../styles";
import { Density, GanttChartProps, TimeScale } from "../types";
import {
    BAR_HEIGHT,
    buildRows,
    buildTimeline,
    collectParentIds,
    dateToOffset,
    getTaskExtent,
    ROW_HEIGHT,
    startOfDay,
    TaskStatus,
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
const LEGEND_STATUSES: TaskStatus[] = ["onTrack", "atRisk", "overdue", "complete", "notStarted"];
/** Rows rendered above and below the viewport so scrolling stays smooth. */
const OVERSCAN = 8;

export const GanttChart: React.FC<GanttChartProps> = ({
    tasks,
    recordCount,
    availableColumns,
    unmatchedFields,
    dateFieldNames,
    selectedTaskId,
    density: densityProp,
    timeScale: timeScaleProp,
    showToolbar,
    showCurrentTime,
    showProgress,
    isLoading,
    hasNextPage,
    width,
    height,
    onSelect,
    onOpen,
    onLoadMore,
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
    const [today, setToday] = React.useState(() => startOfDay(new Date()));
    // Keyed by the mismatch itself, so fixing one setting and breaking another shows the notice again.
    const unmatchedKey = unmatchedFields.map((item) => `${item.setting}=${item.field}`).join("|");
    const [dismissedKey, setDismissedKey] = React.useState("");

    // Maker-facing properties act as the initial value; the toolbar owns the
    // setting afterwards, so re-publishing a new default still takes effect.
    React.useEffect(() => setDensity(densityProp), [densityProp]);
    React.useEffect(() => setTimeScale(timeScaleProp), [timeScaleProp]);

    // Roll the "today" marker over at midnight rather than on a polling timer.
    React.useEffect(() => {
        if (!showCurrentTime) {
            return undefined;
        }

        const msUntilMidnight = startOfDay(new Date()).getTime() + 86400000 - Date.now();
        const timeoutId = window.setTimeout(() => setToday(startOfDay(new Date())), msUntilMidnight + 1000);
        return () => window.clearTimeout(timeoutId);
    }, [showCurrentTime, today]);

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

    const timeline = React.useMemo(() => {
        const extent = getTaskExtent(filteredTasks);
        return buildTimeline(extent.start, extent.end, timeScale, density, today);
    }, [filteredTasks, timeScale, density, today]);

    const rowHeight = ROW_HEIGHT[density];
    const isDetailed = density === "comfortable";
    const minListWidth = MIN_LIST_WIDTH[density];

    // Switching into detailed mode from a narrow compact pane would hide the
    // task name behind the extra columns, so widen to that mode's floor.
    React.useEffect(() => {
        setListWidth((current) => Math.max(MIN_LIST_WIDTH[density], current));
    }, [density]);

    // Derived from every task, not just the visible rows, so that collapse-all
    // still reaches parents whose own parent is already collapsed.
    const parentIds = React.useMemo(() => collectParentIds(filteredTasks), [filteredTasks]);

    /**
     * Budget for indentation. A deep tree would otherwise push the task name out
     * of its column, so indentation stops once the name is down to its minimum
     * legible width. Widening the splitter buys back indentation depth.
     */
    const trailingColumns = isDetailed
        ? LIST_COLUMN_WIDTHS.date * 2 + LIST_COLUMN_WIDTHS.progress
        : LIST_COLUMN_WIDTHS.progressCompact;
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

    const todayOffset = showCurrentTime ? dateToOffset(today, timeline) : 0;
    const isTodayInRange = showCurrentTime && today >= timeline.start && today <= timeline.end;

    // Exactly one row carries tabIndex 0 so the grid is a single tab stop, and
    // it falls back to the first row when nothing is selected.
    // The selection is a record id, which on a merged row is one of its segments.
    const selectedRowId = React.useMemo(() => {
        const selectedRow = selectedTaskId
            ? rows.find((row) => row.segments.some((segment) => segment.id === selectedTaskId))
            : undefined;
        return selectedRow?.task.id;
    }, [rows, selectedTaskId]);
    const tabStopId = selectedRowId ?? rows[0]?.task.id;

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
                        {unmatchedFields.map((item) => `${item.setting} "${item.field}"`).join(", ")}.{" "}
                        Columns received: {availableColumns.join(", ")}. In a canvas app, add the column under Fields,
                        or for a related value such as resource.name add it to Items with AddColumns.
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
                            {!isDetailed && (
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
                    </div>

                    <div role="rowgroup" style={{ position: "relative" }}>
                        {/* Weekend shading spans every row, so it is painted once here. */}
                        {timeScale === "day" && (
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
                        )}

                        {/* Positioned against the timeline pane, so it stays put while scrolling. */}
                        {isTodayInRange && (
                            <div
                                aria-hidden="true"
                                className={styles.todayMarker}
                                style={{ left: `${listWidth + todayOffset}px` }}
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
                                isSelected={row.task.id === selectedRowId}
                                // Only passed to the selected row, so the rest keep their memoised render.
                                selectedTaskId={row.task.id === selectedRowId ? selectedTaskId : undefined}
                                isTabStop={row.task.id === tabStopId}
                                maxIndent={maxIndent}
                                showProgress={showProgress}
                                onSelect={onSelect}
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
                    {LEGEND_STATUSES.map((status) => (
                        <span key={status} className={styles.legendItem}>
                            <span
                                className={styles.legendSwatch}
                                style={{ backgroundColor: STATUS_TOKENS[status].fill }}
                                aria-hidden="true"
                            />
                            {STATUS_LABELS[status]}
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
