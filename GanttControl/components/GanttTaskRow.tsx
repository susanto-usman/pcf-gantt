import { Button, mergeClasses, ProgressBar, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { useGanttStyles } from "../styles";
import { Density, GanttRow, Timeline } from "../types";
import { barGeometry, diffInDays, getTaskStatus, pickSegment } from "../utils";
import { BarLayout, GanttBar } from "./GanttBar";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

export interface GanttTaskRowProps {
    row: GanttRow;
    rowIndex: number;
    timeline: Timeline;
    today: Date;
    density: Density;
    isSelected: boolean;
    /** The selected record when it is on this row; tells a merged row which bar to highlight. */
    selectedTaskId: string | undefined;
    /** The single row in the roving tab sequence for the grid. */
    isTabStop: boolean;
    /** Ceiling on indentation, so a deep tree cannot squeeze out the name. */
    maxIndent: number;
    showProgress: boolean;
    onSelect: (taskId: string) => void;
    onOpen: (taskId: string) => void;
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
    isSelected,
    selectedTaskId,
    isTabStop,
    maxIndent,
    showProgress,
    onSelect,
    onOpen,
    onToggleExpand,
}) => {
    const styles = useGanttStyles();
    const isDetailed = density === "comfortable";

    const start = row.hasChildren ? row.rollupStart : row.task.start;
    const end = row.hasChildren ? row.rollupEnd : row.task.end;
    const progress = row.hasChildren ? row.rollupProgress : row.task.progress;
    const status = getTaskStatus(start, end, progress, today);

    // A merged row is not a record, so row-level actions go to one of its segments.
    const recordId = row.isMerged ? pickSegment(row, selectedTaskId, today).id : row.task.id;

    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(recordId);
        } else if (event.key === " ") {
            event.preventDefault();
            onSelect(recordId);
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
            aria-selected={isSelected}
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.isExpanded : undefined}
            tabIndex={isTabStop ? 0 : -1}
            data-task-id={row.task.id}
            className={mergeClasses(styles.row, isSelected && styles.rowSelected)}
            onClick={() => onSelect(recordId)}
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
                        isSelected && styles.listCellSelected
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

                {!isDetailed && (
                    // Compact drops the date columns, but progress is worth
                    // keeping as a bare percentage.
                    <div
                        role="gridcell"
                        className={mergeClasses(
                            styles.listCell,
                            "gantt-list-cell",
                            styles.listCellProgressCompact,
                            isSelected && styles.listCellSelected
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
                                isSelected && styles.listCellSelected
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
                                isSelected && styles.listCellSelected
                            )}
                        >
                            {shortDate(end)}
                        </div>
                        <div
                            role="gridcell"
                            className={mergeClasses(
                                styles.listCell,
                                "gantt-list-cell",
                                styles.listCellProgress,
                                isSelected && styles.listCellSelected
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
                    </>
                )}
            </div>

            <div
                role="gridcell"
                className={mergeClasses(
                    styles.timelinePane,
                    styles.track,
                    "gantt-track",
                    isSelected && styles.trackSelected
                )}
            >
                <div className={styles.trackGrid} aria-hidden="true" />
                {row.isMerged ? (
                    row.segments.map((segment) => (
                        <GanttBar
                            key={segment.id}
                            task={segment}
                            layout={layoutFor(segment.start, segment.end, segment.progress, false, timeline, today)}
                            isSummary={false}
                            rowLabel={row.task.title}
                            isSelected={segment.id === selectedTaskId}
                            showProgress={showProgress}
                            onSelect={onSelect}
                            onOpen={onOpen}
                        />
                    ))
                ) : (
                    <GanttBar
                        task={row.task}
                        layout={layoutFor(start, end, progress, row.hasChildren, timeline, today)}
                        isSummary={row.hasChildren}
                        isSelected={isSelected}
                        showProgress={showProgress}
                        onSelect={onSelect}
                        onOpen={onOpen}
                    />
                )}
            </div>
        </div>
    );
};

function layoutFor(
    start: Date,
    end: Date,
    progress: number,
    isSummary: boolean,
    timeline: Timeline,
    today: Date
): BarLayout {
    return {
        ...barGeometry(start, end, timeline),
        start,
        end,
        progress,
        status: getTaskStatus(start, end, progress, today),
        isMilestone: !isSummary && diffInDays(start, end) === 0 && timeline.scale !== "day",
    };
}

function shortDate(date: Date): string {
    return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export const GanttTaskRow = React.memo(GanttTaskRowInner);
