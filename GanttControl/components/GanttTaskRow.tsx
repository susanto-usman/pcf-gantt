import { Button, mergeClasses, ProgressBar, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { ColorScheme } from "../colors";
import { useGanttStyles } from "../styles";
import { Density, EditPermissions, GanttRow, GanttTask, RowSelection, TaskEdit, Timeline } from "../types";
import {
    barGeometry,
    diffInDays,
    formatWith,
    getTaskStatus,
    overlapHeight,
    overlapLevels,
    pickSegment,
    pixelsPerDay,
    rowIdOf,
} from "../utils";
import { BarLayout, BarOverlap, GanttBar } from "./GanttBar";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

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

    // Segments can overlap, which would leave the later one covering the
    // earlier. Stack them instead: the later start goes underneath, taller, so
    // it still shows around the bar on top of it.
    const levels = React.useMemo(() => (row.isMerged ? overlapLevels(row.segments) : []), [row.isMerged, row.segments]);
    const topOfStack = levels.length > 0 ? Math.max(...levels) : 0;

    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(recordId);
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
            onDoubleClick={() => onOpen(recordId)}
            onKeyDown={handleRowKeyDown}
        >
            <div className={styles.listPane}>
                <div
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

                    <Text
                        className={mergeClasses(styles.taskName, row.hasChildren && styles.taskNameSummary)}
                        size={isDetailed ? 300 : 200}
                        title={row.task.title}
                    >
                        {row.task.title}
                    </Text>
                </div>

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
                        <div
                            role="gridcell"
                            className={mergeClasses(
                                styles.listCell,
                                "gantt-list-cell",
                                styles.listCellDate,
                                cellSelected
                            )}
                        >
                            {shortDate(start)}
                        </div>
                        <div
                            role="gridcell"
                            className={mergeClasses(
                                styles.listCell,
                                "gantt-list-cell",
                                styles.listCellDate,
                                cellSelected
                            )}
                        >
                            {shortDate(end)}
                        </div>
                        {showProgress && (
                            <div
                                role="gridcell"
                                className={mergeClasses(
                                    styles.listCell,
                                    "gantt-list-cell",
                                    styles.listCellProgress,
                                    cellSelected
                                )}
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
                        )}
                    </>
                )}
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
                {row.isMerged ? (
                    row.segments.map((segment, index) => {
                        const layout = layoutFor(segment, segment.start, segment.end, segment.progress, false, {
                            timeline,
                            today,
                            colors,
                        });

                        return (
                            <GanttBar
                                key={segment.id}
                                task={segment}
                                layout={layout}
                                isSummary={false}
                                rowLabel={row.task.title}
                                overlap={overlapFor(levels[index], topOfStack, layout.isMilestone, density)}
                                isSelected={segment.id === selectedTaskId}
                                isPending={pendingIds.has(segment.id)}
                                showProgress={showProgress}
                                canEdit={canEdit}
                                onSelect={onSelect}
                                onOpen={onOpen}
                                onEdit={onEdit}
                            />
                        );
                    })
                ) : (
                    <GanttBar
                        task={row.task}
                        layout={layoutFor(row.task, start, end, progress, row.hasChildren, {
                            timeline,
                            today,
                            colors,
                        })}
                        isSummary={row.hasChildren}
                        // Selecting the row is not selecting its bar, so only a
                        // bar the user picked carries the ring.
                        isSelected={selection === "task"}
                        isPending={pendingIds.has(row.task.id)}
                        showProgress={showProgress}
                        canEdit={canEdit}
                        onSelect={onSelect}
                        onOpen={onOpen}
                        onEdit={onEdit}
                    />
                )}
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
    context: { timeline: Timeline; today: Date; colors: ColorScheme }
): BarLayout {
    const { timeline, today, colors } = context;
    // The status is worked out whatever the scheme: a field-coloured chart
    // still reports it nowhere, but a status-coloured one needs it, and it is
    // cheaper to compute than to branch on.
    const status = getTaskStatus(start, end, progress, today);

    return {
        ...barGeometry(start, end, timeline),
        start,
        end,
        progress,
        pixelsPerDay: pixelsPerDay(timeline),
        palette: colors.paletteFor(task.colorKey ?? "", status),
        label: colors.labelFor(task.colorKey ?? "", status),
        caption: colors.caption,
        isMilestone: !isSummary && diffInDays(start, end) === 0 && timeline.scale !== "day",
    };
}

function shortDate(date: Date): string {
    return formatWith({ day: "2-digit", month: "short" }).format(date);
}

export const GanttTaskRow = React.memo(GanttTaskRowInner);
