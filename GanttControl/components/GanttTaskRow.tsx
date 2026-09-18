import { Avatar, Button, mergeClasses, ProgressBar, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { ColorScheme, paletteFromColor } from "../colors";
import { useGanttStyles } from "../styles";
import {
    BarStyle,
    Density,
    DrawnSpan,
    EditPermissions,
    GanttRow,
    GanttTask,
    ListColumn,
    RowSelection,
    TaskEdit,
    Timeline,
} from "../types";
import {
    barGeometry,
    clashSpan,
    clipGeometry,
    diffInDays,
    drawnSpan,
    drawnSpans,
    findClashes,
    formatWith,
    getTaskStatus,
    isMarker,
    lastCoveredDay,
    markerDays,
    overlapHeight,
    overlapLevels,
    pickSegment,
    pixelsPerDay,
    rowIdOf,
    spanGeometry,
} from "../utils";
import { BarLayout, BarOverlap, GanttBar } from "./GanttBar";
import { BarSpans, GanttMarker, MarkerSlot, slotKey } from "./GanttMarker";
import { ChevronDownIcon, ChevronRightIcon, WarningIcon } from "./icons";

/** The group column's label, drawn once over the rows of its group that are in view. */
export interface GroupSpan {
    rows: number;
    content: React.ReactNode;
}

export interface GanttTaskRowProps {
    row: GanttRow;
    rowIndex: number;
    timeline: Timeline;
    today: Date;
    density: Density;
    /** Where every bar on the row takes its colour and its legend label from. */
    colors: ColorScheme;
    /** Whether the row is the selected one, merely holds the selected bar, or neither. */
    selection: RowSelection;
    /** The selected record when it is on this row; tells a merged row which bar to highlight. */
    selectedTaskId: string | undefined;
    /** The single row in the roving tab sequence for the grid. */
    isTabStop: boolean;
    /** Ceiling on indentation, so a deep tree cannot squeeze out the name. */
    maxIndent: number;
    showProgress: boolean;
    barStyle: BarStyle;
    /** The task list's columns in view; null keeps the built-in name, dates and progress. */
    columns: ListColumn[] | null;
    showAvatars: boolean;
    /** Set on the row the group column's label is drawn from. */
    groupSpan?: GroupSpan;
    /** The last row of its group, which draws the rule under the group column. */
    isGroupEnd?: boolean;
    /** Drawn after the title of a group heading, e.g. the pool's category filter. */
    headingExtra?: React.ReactNode;
    /** Whether the maker allows bars to be moved or resized. */
    canEdit: EditPermissions;
    /** Ids on this row whose edit is published but not yet settled by the data. */
    pendingIds: ReadonlySet<string>;
    onSelect: (taskId: string) => void;
    onSelectRow: (rowId: string) => void;
    onOpen: (taskId: string) => void;
    onEdit: (edit: TaskEdit) => void;
    onToggleExpand: (taskId: string) => void;
}

const INDENT_PER_LEVEL = 14;
const BASE_INDENT = 8;

const NO_SLOTS: ReadonlyMap<string, MarkerSlot> = new Map();

const GanttTaskRowInner: React.FC<GanttTaskRowProps> = ({
    row,
    rowIndex,
    timeline,
    today,
    density,
    colors,
    selection,
    selectedTaskId,
    isTabStop,
    maxIndent,
    showProgress,
    barStyle,
    columns,
    showAvatars,
    groupSpan,
    isGroupEnd,
    headingExtra,
    canEdit,
    pendingIds,
    onSelect,
    onSelectRow,
    onOpen,
    onEdit,
    onToggleExpand,
}) => {
    const styles = useGanttStyles();
    const isDetailed = density === "comfortable";
    const isRowSelected = selection === "row";
    // The row the user picked is washed in brand and carries an accent edge; a
    // row that merely holds the selected bar only gets the neutral wash.
    const cellSelected = isRowSelected
        ? styles.listCellRowSelected
        : selection === "task"
          ? styles.listCellSelected
          : undefined;

    const start = row.hasChildren ? row.rollupStart : row.task.start;
    const end = row.hasChildren ? row.rollupEnd : row.task.end;
    const progress = row.hasChildren ? row.rollupProgress : row.task.progress;
    const status = getTaskStatus(start, end, progress, today);

    // Opening is a record action, and a merged row is not a record, so it goes
    // to one of the row's segments. Selecting the row does not: it is the row
    // the maker gets, with no record selected alongside it.
    const recordId = row.isMerged ? pickSegment(row, selectedTaskId, today).id : row.task.id;
    const rowId = rowIdOf(row);

    // Icons and tints sit in the days they cover and take no part in stacking.
    const { bars, markers } = React.useMemo(
        () =>
            row.isMerged
                ? { bars: row.segments.filter((segment) => !isMarker(segment)), markers: row.segments.filter(isMarker) }
                : { bars: row.segments, markers: [] as GanttTask[] },
        [row.isMerged, row.segments]
    );

    // The stretch each bar is drawn across: its hours where the timeline reads
    // them, whole days otherwise, and a day two bars would cover each other on
    // shared out between them where their hours leave room for it.
    const spans = React.useMemo(() => drawnSpans(bars, timeline), [bars, timeline]);

    // Bars can still be drawn over one another, which would leave the later one
    // covering the earlier. Stack them instead: the later start goes
    // underneath, taller, so it still shows around the bar on top of it.
    const levels = React.useMemo(() => (row.isMerged ? overlapLevels(spans) : []), [row.isMerged, spans]);
    const topOfStack = levels.length > 0 ? Math.max(...levels) : 0;

    // Bars running into time the row is blocked out for, e.g. a shift over
    // leave, hatched inside the bar each one marks so that a bar which gave up
    // part of its day is not hatched across the whole of it.
    const clashes = React.useMemo(() => {
        const blockers = markers.filter((marker) => marker.blocks);

        return bars.flatMap((bar, index) =>
            findClashes([bar], blockers).map((clash) => clashSpan(clash, spans[index], timeline))
        );
    }, [bars, markers, spans, timeline]);

    // Who clashes with whom, both ways, so each tooltip can name the other side.
    const clashesOf = React.useMemo(() => {
        const found = new Map<string, GanttTask[]>();
        const add = (id: string, other: GanttTask) => found.set(id, [...(found.get(id) ?? []), other]);

        for (const blocker of markers.filter((marker) => marker.blocks)) {
            for (const bar of bars) {
                if (findClashes([bar], [blocker]).length > 0) {
                    add(blocker.id, bar);
                    add(bar.id, blocker);
                }
            }
        }

        return found;
    }, [bars, markers]);

    // Icons sharing a day sit side by side rather than on top of each other.
    const slots = React.useMemo(() => {
        const icons = markers.filter((marker) => marker.kind === "icon" && marker.icon);

        if (icons.length < 2 || timeline.scale !== "day") {
            return NO_SLOTS;
        }

        const byDay = new Map<number, string[]>();

        for (const marker of icons) {
            for (const day of markerDays(marker.start, marker.end, timeline)) {
                const onDay = byDay.get(day.getTime()) ?? [];
                onDay.push(marker.id);
                byDay.set(day.getTime(), onDay);
            }
        }

        const result = new Map<string, MarkerSlot>();

        for (const [day, ids] of byDay) {
            ids.forEach((id, index) => result.set(slotKey(id, new Date(day)), { index, total: ids.length }));
        }

        return result;
    }, [markers, timeline]);

    // A group heading is no record, so there is nothing for it to open.
    const openRow = () => {
        if (!row.isGroup) {
            onOpen(recordId);
        }
    };

    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            openRow();
        } else if (event.key === " ") {
            event.preventDefault();
            onSelectRow(rowId);
        } else if (event.key === "ArrowRight" && row.hasChildren && !row.isExpanded) {
            event.preventDefault();
            onToggleExpand(row.task.id);
        } else if (event.key === "ArrowLeft" && row.hasChildren && row.isExpanded) {
            event.preventDefault();
            onToggleExpand(row.task.id);
        }
    };

    const context = { timeline, today, colors };

    // Where the row's bars sit, so an icon can tell whether it would cover one.
    const barSpans = React.useMemo<BarSpans>(
        () =>
            markers.length === 0
                ? []
                : spans.map((span) => {
                      const { left, width } = clipGeometry(barGeometry(span, timeline), timeline);
                      return { left, right: left + Math.max(4, width) };
                  }),
        [spans, markers, timeline]
    );

    const nameCell = (width?: number) => (
        <div
            key="@name"
            role="gridcell"
            className={mergeClasses(
                styles.listCell,
                "gantt-list-cell",
                styles.listCellName,
                cellSelected,
                isRowSelected && styles.listCellAccent
            )}
            style={{
                paddingInlineStart: `${BASE_INDENT + Math.min(row.depth * INDENT_PER_LEVEL, maxIndent)}px`,
                ...(width ? { flexGrow: 0, flexBasis: `${width}px`, width: `${width}px` } : {}),
            }}
        >
            {row.hasChildren ? (
                <Button
                    className={styles.expandButton}
                    appearance="transparent"
                    size="small"
                    icon={row.isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    aria-label={row.isExpanded ? `Collapse ${row.task.title}` : `Expand ${row.task.title}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleExpand(row.task.id);
                    }}
                />
            ) : (
                <span className={styles.expandSpacer} aria-hidden="true" />
            )}

            {clashes.length > 0 && (
                <span className={styles.rowFlag} title="Booked over unavailable time" role="img" aria-label="Clash">
                    <WarningIcon />
                </span>
            )}

            {showAvatars && !row.isGroup && row.task.title && (
                <Avatar
                    className={styles.avatar}
                    size={isDetailed ? 24 : 20}
                    name={row.task.title}
                    image={row.task.image ? { src: row.task.image } : undefined}
                    aria-hidden="true"
                />
            )}

            <div className={styles.nameStack}>
                <Text
                    className={mergeClasses(styles.taskName, row.hasChildren && styles.taskNameSummary)}
                    size={isDetailed ? 300 : 200}
                    title={row.task.title}
                >
                    {row.task.title}
                </Text>
                {row.task.subtitle && isDetailed && (
                    <span className={styles.subtitle} title={row.task.subtitle}>
                        {row.task.subtitle}
                    </span>
                )}
            </div>

            {headingExtra}
        </div>
    );

    const dateCell = (key: string, date: Date, width?: number) => (
        <div
            key={key}
            role="gridcell"
            className={mergeClasses(styles.listCell, "gantt-list-cell", styles.listCellDate, cellSelected)}
            style={width ? { width: `${width}px` } : undefined}
        >
            {row.isGroup && columns ? "" : shortDate(date)}
        </div>
    );

    const progressCell = (width?: number) => (
        <div
            key="@progress"
            role="gridcell"
            className={mergeClasses(styles.listCell, "gantt-list-cell", styles.listCellProgress, cellSelected)}
            style={width ? { width: `${width}px` } : undefined}
        >
            <ProgressBar
                value={progress / 100}
                thickness="medium"
                color={progress >= 100 ? "success" : status === "overdue" ? "error" : "brand"}
            />
            <Text size={100} style={{ color: tokens.colorNeutralForeground3, minWidth: "28px" }}>
                {`${progress}%`}
            </Text>
        </div>
    );

    const listCells = columns ? (
        columns.map((column) => {
            switch (column.key) {
                case "@name":
                    return nameCell(column.width);
                case "@group":
                    return (
                        <div
                            key="@group"
                            role="gridcell"
                            className={mergeClasses(
                                styles.listCell,
                                styles.listCellGroup,
                                isGroupEnd && styles.listCellGroupEnd
                            )}
                            style={{ width: `${column.width}px` }}
                        >
                            {groupSpan && (
                                <div
                                    className={styles.groupSpan}
                                    // Covers the rows below it, so it is drawn a pixel short of their last rule.
                                    style={{ height: `calc(${groupSpan.rows} * 100% - 1px)` }}
                                >
                                    {groupSpan.content}
                                </div>
                            )}
                        </div>
                    );
                case "@start":
                    return dateCell("@start", start, column.width);
                case "@end":
                    return dateCell("@end", lastCoveredDay(start, end), column.width);
                case "@progress":
                    return row.isGroup ? (
                        <div
                            key="@progress"
                            role="gridcell"
                            className={mergeClasses(styles.listCell, "gantt-list-cell", cellSelected)}
                            style={{ width: `${column.width}px`, flexShrink: 0 }}
                        />
                    ) : (
                        progressCell(column.width)
                    );
                default: {
                    const value = row.isGroup ? "" : (row.task.cells?.[column.key] ?? "");

                    return (
                        <div
                            key={column.key}
                            role="gridcell"
                            className={mergeClasses(
                                styles.listCell,
                                "gantt-list-cell",
                                styles.listCellColumn,
                                cellSelected
                            )}
                            style={{ width: `${column.width}px` }}
                        >
                            <span className={styles.listCellText} title={value}>
                                {value}
                            </span>
                        </div>
                    );
                }
            }
        })
    ) : (
        <>
            {nameCell()}

            {!isDetailed && showProgress && (
                // Compact drops the date columns, but progress is worth
                // keeping as a bare percentage.
                <div
                    role="gridcell"
                    className={mergeClasses(
                        styles.listCell,
                        "gantt-list-cell",
                        styles.listCellProgressCompact,
                        cellSelected
                    )}
                >
                    {`${progress}%`}
                </div>
            )}

            {isDetailed && (
                <>
                    {dateCell("@start", start)}
                    {dateCell("@end", lastCoveredDay(start, end))}
                    {showProgress && progressCell()}
                </>
            )}
        </>
    );

    const markerFor = (marker: GanttTask) => {
        const markerStatus = getTaskStatus(marker.start, marker.end, marker.progress, today);
        const palette = marker.displayColor
            ? paletteFromColor(marker.displayColor)
            : colors.paletteFor(marker.colorKey ?? "", markerStatus);

        return (
            <GanttMarker
                key={marker.id}
                task={marker}
                timeline={timeline}
                palette={palette}
                // An icon says enough on its own; only a tint colours its days.
                tint={marker.kind === "tint" ? palette.track : "transparent"}
                rowLabel={row.isMerged ? row.task.title : undefined}
                slots={slots}
                barSpans={barSpans}
                isSelected={marker.id === selectedTaskId}
                clashes={clashesOf.get(marker.id)}
                onSelect={onSelect}
                onOpen={onOpen}
            />
        );
    };

    return (
        <div
            role="row"
            aria-rowindex={rowIndex + 2}
            aria-selected={selection !== "none"}
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.isExpanded : undefined}
            tabIndex={isTabStop ? 0 : -1}
            data-task-id={row.task.id}
            className={mergeClasses(
                styles.row,
                isRowSelected && styles.rowSelected,
                selection === "task" && styles.rowHighlighted
            )}
            onClick={() => onSelectRow(rowId)}
            onDoubleClick={openRow}
            onKeyDown={handleRowKeyDown}
        >
            {/* A group label runs down over the rows below, so its row's pane is raised above theirs. */}
            <div className={styles.listPane} style={groupSpan ? { zIndex: 3 } : undefined}>
                {listCells}
            </div>

            <div
                role="gridcell"
                className={mergeClasses(
                    styles.timelinePane,
                    styles.track,
                    "gantt-track",
                    isRowSelected ? styles.trackRowSelected : selection === "task" && styles.trackSelected
                )}
            >
                <div className={styles.trackGrid} aria-hidden="true" />
                {markers.map(markerFor)}
                {clashes.map((clash, index) => {
                    const { left, width } = clipGeometry(spanGeometry(clash, timeline), timeline);
                    return (
                        <div
                            key={`clash-${index}`}
                            aria-hidden="true"
                            className={styles.clash}
                            style={{ left: `${left}px`, width: `${width}px` }}
                        />
                    );
                })}
                {row.isMerged
                    ? bars.map((segment, index) => {
                          const layout = layoutFor(
                              segment,
                              segment.start,
                              segment.end,
                              segment.progress,
                              false,
                              context,
                              spans[index]
                          );

                          return layout.isOutside ? null : (
                              <GanttBar
                                  key={segment.id}
                                  task={segment}
                                  layout={layout}
                                  isSummary={false}
                                  rowLabel={row.task.title || undefined}
                                  overlap={overlapFor(levels[index], topOfStack, layout.isMilestone, density)}
                                  isSelected={segment.id === selectedTaskId}
                                  clashes={clashesOf.get(segment.id)}
                                  isPending={pendingIds.has(segment.id)}
                                  showProgress={showProgress}
                                  barStyle={barStyle}
                                  canEdit={canEdit}
                                  onSelect={onSelect}
                                  onOpen={onOpen}
                                  onEdit={onEdit}
                              />
                          );
                      })
                    : !row.hasChildren && isMarker(row.task)
                      ? markerFor(row.task)
                      : (() => {
                            const layout = layoutFor(row.task, start, end, progress, row.hasChildren, context);

                            return layout.isOutside ? null : (
                                <GanttBar
                                    task={row.task}
                                    layout={layout}
                                    isSummary={row.hasChildren}
                                    // Selecting the row is not selecting its bar, so only a
                                    // bar the user picked carries the ring.
                                    isSelected={selection === "task"}
                                    isPending={pendingIds.has(row.task.id)}
                                    showProgress={showProgress}
                                    barStyle={barStyle}
                                    canEdit={canEdit}
                                    onSelect={onSelect}
                                    onOpen={onOpen}
                                    onEdit={onEdit}
                                />
                            );
                        })()}
            </div>
        </div>
    );
};

/**
 * A bar's place in its row's stack: deeper levels are painted first and drawn
 * taller. Milestones keep their size and ride on top, as a diamond has no room
 * to spare.
 */
function overlapFor(level: number, topOfStack: number, isMilestone: boolean, density: Density): BarOverlap | undefined {
    if (topOfStack === 0) {
        return undefined;
    }

    return isMilestone
        ? { extraHeight: 0, zIndex: topOfStack + 1 }
        : { extraHeight: overlapHeight(level, density), zIndex: topOfStack - level };
}

function layoutFor(
    task: GanttTask,
    start: Date,
    end: Date,
    progress: number,
    isSummary: boolean,
    context: { timeline: Timeline; today: Date; colors: ColorScheme },
    /** Set where the row worked the span out for itself, e.g. a day shared with the next bar. */
    span?: DrawnSpan
): BarLayout & { isOutside: boolean } {
    const { timeline, today, colors } = context;
    // The status is worked out whatever the scheme: a field-coloured chart
    // still reports it nowhere, but a status-coloured one needs it, and it is
    // cheaper to compute than to branch on.
    const status = getTaskStatus(start, end, progress, today);
    const geometry = barGeometry(span ?? drawnSpan(start, end, timeline), timeline);
    const clipped = clipGeometry(geometry, timeline);

    return {
        left: clipped.left,
        width: clipped.width,
        clippedStart: clipped.clippedStart,
        clippedEnd: clipped.clippedEnd,
        // Wholly past a boundary the maker set: nothing of it is on the timeline to draw.
        isOutside: geometry.left >= timeline.totalWidth || geometry.left + geometry.width <= 0,
        start,
        end,
        progress,
        pixelsPerDay: pixelsPerDay(timeline),
        // A display rule's own colour wins over the scheme's.
        palette: task.displayColor
            ? paletteFromColor(task.displayColor)
            : colors.paletteFor(task.colorKey ?? "", status),
        label: task.displayLabel || colors.labelFor(task.colorKey ?? "", status),
        caption: colors.caption,
        isMilestone: !isSummary && diffInDays(start, end) === 0 && timeline.scale !== "day",
    };
}

function shortDate(date: Date): string {
    return formatWith({ day: "2-digit", month: "short" }).format(date);
}

export const GanttTaskRow = React.memo(GanttTaskRowInner);
