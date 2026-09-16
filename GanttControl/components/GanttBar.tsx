import {
    mergeClasses,
    PositioningImperativeRef,
    PositioningVirtualElement,
    ProgressBar,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import * as React from "react";
import { cssVars, STATUS_LABELS, STATUS_TOKENS, useGanttStyles } from "../styles";
import { GanttTask } from "../types";
import { diffInDays, exclusiveEnd, formatDateTime, hasTimeOfDay, TaskStatus } from "../utils";

export interface BarLayout {
    left: number;
    width: number;
    start: Date;
    end: Date;
    progress: number;
    status: TaskStatus;
    isMilestone: boolean;
}

/**
 * Where a bar sits in a stack of overlapping bars on a merged row. Deeper bars
 * are painted underneath and drawn taller, so they still show around the bar
 * covering them.
 */
export interface BarOverlap {
    extraHeight: number;
    zIndex: number;
}

export interface GanttBarProps {
    task: GanttTask;
    layout: BarLayout;
    /** Draws the rolled-up bracket used for parent rows. */
    isSummary: boolean;
    /** Label of the merged row a segment belongs to, shown in its tooltip. */
    rowLabel?: string;
    /** Set only for a bar that overlaps another on the same merged row. */
    overlap?: BarOverlap;
    isSelected: boolean;
    showProgress: boolean;
    onSelect: (taskId: string) => void;
    onOpen: (taskId: string) => void;
}

export const GanttBar: React.FC<GanttBarProps> = ({
    task,
    layout,
    isSummary,
    rowLabel,
    overlap,
    isSelected,
    showProgress,
    onSelect,
    onOpen,
}) => {
    const styles = useGanttStyles();
    const { left, width, start, end, progress, status, isMilestone } = layout;
    const palette = STATUS_TOKENS[status];

    /**
     * Bars can span the whole timeline — a summary bar is often thousands of
     * pixels wide — so anchoring the tooltip to the element puts it nowhere
     * near the cursor. Point it at a zero-size virtual element that tracks the
     * pointer instead.
     *
     * The element is stable and reads from a ref, so following the pointer
     * costs a positioning update rather than a React render per mouse move.
     */
    const pointer = React.useRef({ x: 0, y: 0 });
    const positioningRef = React.useRef<PositioningImperativeRef>(null);
    const frame = React.useRef(0);

    const virtualTarget = React.useMemo<PositioningVirtualElement>(
        () => ({
            getBoundingClientRect: () => {
                const { x, y } = pointer.current;
                return { x, y, top: y, bottom: y, left: x, right: x, width: 0, height: 0 };
            },
        }),
        []
    );

    React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        pointer.current = { x: event.clientX, y: event.clientY };

        // Coalesce to one reposition per frame; pointermove can fire far faster.
        if (frame.current === 0) {
            frame.current = requestAnimationFrame(() => {
                frame.current = 0;
                positioningRef.current?.updatePosition();
            });
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(task.id);
        } else if (event.key === " ") {
            event.preventDefault();
            onSelect(task.id);
        }
    };

    const tooltip = (
        <div className={styles.tooltipContent}>
            <Text className={styles.tooltipTitle}>{task.title}</Text>
            {rowLabel && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {rowLabel}
                </Text>
            )}
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Start</span>
                <span>{formatDateTime(start)}</span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Finish</span>
                <span>{formatDateTime(end)}</span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Duration</span>
                <span>{formatDuration(start, end)}</span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Status</span>
                <span style={{ color: palette.text }}>{STATUS_LABELS[status]}</span>
            </div>
            {task.category && (
                <div className={styles.tooltipRow}>
                    <span className={styles.tooltipLabel}>Category</span>
                    <span>{task.category}</span>
                </div>
            )}
            {showProgress && (
                <>
                    <div className={styles.tooltipRow}>
                        <ProgressBar value={progress / 100} thickness="large" />
                    </div>

                    <div className={styles.tooltipRow}>
                        <span className={styles.tooltipLabel}>{isSummary ? "Rolled-up progress" : "Progress"}</span>
                        <span>{`${progress}%`}</span>
                    </div>
                </>
            )}
        </div>
    );

    const spokenRange = `${formatDateTime(start)} to ${formatDateTime(end)}`;

    const shared = {
        role: "button" as const,
        tabIndex: -1,
        "aria-label": `${rowLabel ? `${rowLabel}, ` : ""}${task.title}. ${spokenRange}.${
            showProgress ? ` ${progress} percent complete.` : ""
        } ${STATUS_LABELS[status]}.`,
        onClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onSelect(task.id);
        },
        onDoubleClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onOpen(task.id);
        },
        onKeyDown: handleKeyDown,
        onPointerMove: handlePointerMove,
    };

    // Sits just clear of the cursor so the surface never lands under it.
    const tooltipProps = {
        content: tooltip,
        relationship: "description" as const,
        withArrow: true,
        positioning: {
            target: virtualTarget,
            positioningRef,
            position: "above" as const,
            align: "center" as const,
            offset: 14,
        },
    };

    if (isSummary) {
        return (
            <Tooltip {...tooltipProps}>
                <div {...shared} className={styles.summaryBar} style={{ left: `${left}px`, width: `${width}px` }}>
                    <div className={styles.summaryBarShape} style={{ backgroundColor: palette.fill }} />
                </div>
            </Tooltip>
        );
    }

    if (isMilestone) {
        return (
            <Tooltip {...tooltipProps}>
                <div
                    {...shared}
                    className={styles.milestone}
                    style={{
                        left: `${left + width / 2}px`,
                        backgroundColor: palette.fill,
                        // A diamond is small enough to disappear behind a bar,
                        // so the row hands it the top of the stack.
                        zIndex: overlap?.zIndex,
                    }}
                />
            </Tooltip>
        );
    }

    return (
        <Tooltip {...tooltipProps}>
            <div
                {...shared}
                className={mergeClasses(styles.bar, isSelected && styles.barSelected)}
                style={{
                    left: `${left}px`,
                    width: `${width}px`,
                    backgroundColor: palette.track,
                    // Every bar in the stack stays centred on the row, so the
                    // added height shows above and below the bar on top.
                    ...(overlap && {
                        zIndex: overlap.zIndex,
                        height: `calc(var(${cssVars.barHeight}) + ${overlap.extraHeight}px)`,
                    }),
                }}
            >
                <div
                    className={styles.barFill}
                    style={{
                        width: showProgress ? `${Math.max(0, Math.min(100, progress))}%` : "100%",
                        backgroundColor: palette.fill,
                    }}
                />
            </div>
        </Tooltip>
    );
};

/** Whole days for a date-only task, elapsed time once either end carries one. */
function formatDuration(start: Date, end: Date): string {
    if (!hasTimeOfDay(start) && !hasTimeOfDay(end)) {
        const days = diffInDays(start, end) + 1;
        return days === 1 ? "1 day" : `${days} days`;
    }

    const minutes = Math.max(0, Math.round((exclusiveEnd(end).getTime() - start.getTime()) / 60000));
    const units: [number, string][] = [
        [Math.floor(minutes / 1440), "day"],
        [Math.floor((minutes % 1440) / 60), "hr"],
        [minutes % 60, "min"],
    ];
    const spoken = units
        .filter(([value]) => value > 0)
        .map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`);

    return spoken.length > 0 ? spoken.join(" ") : "0 mins";
}
