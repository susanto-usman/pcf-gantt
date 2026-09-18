import {
    PositioningImperativeRef,
    PositioningVirtualElement,
    ProgressBar,
    Text,
    TooltipProps,
    tokens,
} from "@fluentui/react-components";
import * as React from "react";
import { BarPalette } from "../colors";
import { useGanttStyles } from "../styles";
import { GanttTask } from "../types";
import { diffInDays, exclusiveEnd, formatMoment, hasTimeOfDay, lastCoveredDay } from "../utils";

export interface GanttBarTooltipContentProps {
    task: GanttTask;
    /** Label of the merged row a segment belongs to. */
    rowLabel?: string;
    /** The dates to show, which mid-drag are where the bar will land. */
    start: Date;
    end: Date;
    progress: number;
    showProgress: boolean;
    isSummary: boolean;
    showLock: boolean;
    /**
     * Records on the same row this one clashes with: for unavailable time, the
     * bookings made over it; for a booking, the unavailable time it runs into.
     */
    clashes?: readonly GanttTask[];
}

export const GanttBarTooltipContent: React.FC<GanttBarTooltipContentProps> = ({
    task,
    rowLabel,
    start,
    end,
    progress,
    showProgress,
    isSummary,
    showLock,
    clashes,
}) => {
    const styles = useGanttStyles();

    return (
        <div className={styles.tooltipContent}>
            <Text className={styles.tooltipTitle}>{task.title}</Text>
            {rowLabel && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {rowLabel}
                </Text>
            )}
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Start</span>
                <span>{formatMoment(start)}</span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Finish</span>
                {/* The day the task runs into, not the midnight it stops at:
                    an end of the 31st at 12:00 AM finishes on the 30th. */}
                <span>{formatMoment(lastCoveredDay(start, end))}</span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Duration</span>
                <span>{formatDuration(start, end)}</span>
            </div>
            {task.category && (
                <div className={styles.tooltipRow}>
                    <span className={styles.tooltipLabel}>Category</span>
                    <span>{task.category}</span>
                </div>
            )}
            {showLock && (
                <div className={styles.tooltipRow}>
                    <span className={styles.tooltipLabel}>Locked</span>
                    <span>This task cannot be rescheduled</span>
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
            {clashes && clashes.length > 0 && (
                <div className={styles.tooltipClashes}>
                    <span className={styles.tooltipClashTitle}>
                        {task.blocks ? "Booked during this time" : "Clashes with unavailable time"}
                    </span>
                    {clashes.map((other) => (
                        <div key={other.id} className={styles.tooltipRow}>
                            <span>{other.displayLabel || other.label || other.title}</span>
                            <span className={styles.tooltipLabel}>{formatRange(other.start, other.end)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Bars can span the whole timeline — a summary bar is often thousands of
 * pixels wide — so anchoring the tooltip to the element puts it nowhere
 * near the cursor. Point it at a zero-size virtual element that tracks the
 * pointer instead.
 *
 * The element is stable and reads from a ref, so following the pointer
 * costs a positioning update rather than a React render per mouse move.
 *
 * Returns the tooltip's positioning and the pointermove handler the trigger
 * element must carry.
 */
export function useCursorTooltip(): {
    positioning: TooltipProps["positioning"];
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
} {
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

    const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
        pointer.current = { x: event.clientX, y: event.clientY };

        // Coalesce to one reposition per frame; pointermove can fire far faster.
        if (frame.current === 0) {
            frame.current = requestAnimationFrame(() => {
                frame.current = 0;
                positioningRef.current?.updatePosition();
            });
        }
    };

    // Sits just clear of the cursor so the surface never lands under it.
    const positioning: TooltipProps["positioning"] = {
        target: virtualTarget,
        positioningRef,
        position: "above",
        align: "center",
        offset: 14,
    };

    return { positioning, onPointerMove };
}

/** A short "20 Apr – 24 Apr", or a single date when both ends fall on it. */
function formatRange(start: Date, end: Date): string {
    const startText = formatMoment(start);
    const endText = formatMoment(lastCoveredDay(start, end));
    return startText === endText ? startText : `${startText} – ${endText}`;
}

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
