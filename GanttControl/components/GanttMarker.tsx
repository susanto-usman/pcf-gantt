import { mergeClasses, Tooltip } from "@fluentui/react-components";
import * as React from "react";
import { BarPalette } from "../colors";
import { useGanttStyles } from "../styles";
import { GanttTask, Timeline } from "../types";
import { barGeometry, clipGeometry, dateToOffset, formatDateTime, markerDays } from "../utils";
import { GanttBarTooltipContent, useCursorTooltip } from "./GanttBarTooltip";
import { MarkerIcon } from "./icons";

/** Width an icon takes, gap included, when several share a day. */
export const MARKER_SLOT_WIDTH = 20;

/** Half an icon's width, for telling whether it would sit over a bar. */
const ICON_HALF_WIDTH = 9;

/** Horizontal extents of the bars on a row, in pixels, which icons keep clear of. */
export type BarSpans = readonly { left: number; right: number }[];

/** Where one marker's icon sits among the icons sharing its day. */
export interface MarkerSlot {
    index: number;
    total: number;
}

/** The key a marker's slot for a day is kept under. */
export function slotKey(taskId: string, day: Date): string {
    return `${taskId}|${day.getTime()}`;
}

export interface GanttMarkerProps {
    task: GanttTask;
    timeline: Timeline;
    /** The colour scheme's palette, used where the display rule gave no colour of its own. */
    palette: BarPalette;
    /** The tint behind the days, already worked out from the rule's colour or the palette. */
    tint: string;
    /** Label of the row the marker sits on, for the tooltip and screen readers. */
    rowLabel?: string;
    /** Slots for this marker's icons, keyed by slotKey; a day without one sits alone. */
    slots: ReadonlyMap<string, MarkerSlot>;
    /** The row's bars: an icon that would cover one moves up above it instead. */
    barSpans: BarSpans;
    isSelected: boolean;
    /** Records on the row this one clashes with, named in its tooltip. */
    clashes?: readonly GanttTask[];
    onSelect: (taskId: string) => void;
    onOpen: (taskId: string) => void;
}

/**
 * A record drawn in the days it covers rather than as a bar: leave as an icon
 * in each day, availability as a tint behind them. On the week and month
 * scales a day is too narrow for an icon each, so one icon sits in the middle
 * of the span instead.
 */
const GanttMarkerInner: React.FC<GanttMarkerProps> = ({
    task,
    timeline,
    palette,
    tint,
    rowLabel,
    slots,
    barSpans,
    isSelected,
    clashes,
    onSelect,
    onOpen,
}) => {
    const styles = useGanttStyles();
    const cursorTooltip = useCursorTooltip();
    const isIcon = task.kind === "icon" && Boolean(task.icon);
    const color = task.displayColor || palette.fill;
    const name = task.displayLabel || task.title;
    const spoken = `${rowLabel ? `${rowLabel}, ` : ""}${name}. ${formatDateTime(task.start)} to ${formatDateTime(task.end)}.`;

    const tooltip = (
        <GanttBarTooltipContent
            task={task}
            rowLabel={rowLabel}
            start={task.start}
            end={task.end}
            progress={task.progress}
            showProgress={false}
            isSummary={false}
            showLock={false}
            clashes={clashes}
        />
    );

    const handlers = {
        onClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onSelect(task.id);
        },
        onDoubleClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onOpen(task.id);
        },
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                onOpen(task.id);
            } else if (event.key === " ") {
                event.preventDefault();
                onSelect(task.id);
            }
        },
        onPointerMove: cursorTooltip.onPointerMove,
    };

    const icon = (key: string, centre: number) => (
        <Tooltip
            key={key}
            content={tooltip}
            relationship="description"
            withArrow
            positioning={cursorTooltip.positioning}
        >
            <div
                role="button"
                tabIndex={-1}
                aria-label={spoken}
                className={mergeClasses(
                    styles.marker,
                    // Over a bar the icon would hide its label, so it rides above the bar instead.
                    barSpans.some(
                        (bar) => bar.left < centre + ICON_HALF_WIDTH && bar.right > centre - ICON_HALF_WIDTH
                    ) && styles.markerRaised,
                    isSelected && styles.markerSelected
                )}
                style={{ left: `${centre}px`, transform: "translateX(-50%)", color }}
                {...handlers}
            >
                <MarkerIcon
                    name={task.icon ?? ""}
                    textClassName={styles.markerText}
                    emojiClassName={styles.markerEmoji}
                />
            </div>
        </Tooltip>
    );

    /**
     * The tint across the days. A tint record has no icon to hover, so the tint
     * itself carries the tooltip; a click still falls through to the row, as a
     * tint covers too much of it to take clicks for itself.
     */
    const tintBand = (left: number, width: number) => {
        const band = (
            <div
                className={mergeClasses(styles.markerTint, !isIcon && styles.markerTintHoverable)}
                style={{ left: `${left}px`, width: `${width}px`, backgroundColor: tint }}
                onPointerMove={isIcon ? undefined : cursorTooltip.onPointerMove}
                onDoubleClick={isIcon ? undefined : handlers.onDoubleClick}
            />
        );

        return isIcon ? (
            band
        ) : (
            <Tooltip content={tooltip} relationship="description" withArrow positioning={cursorTooltip.positioning}>
                {band}
            </Tooltip>
        );
    };

    if (timeline.scale !== "day") {
        const { left, width } = clipGeometry(barGeometry(task.start, task.end, timeline), timeline);

        return (
            <>
                {tintBand(left, width)}
                {isIcon && width > 0 && icon("span", left + width / 2)}
            </>
        );
    }

    const days = markerDays(task.start, task.end, timeline);
    const { columnWidth } = timeline;

    return (
        <>
            {/* One tint across the run of days, rather than a cell per day. */}
            {days.length > 0 && tintBand(dateToOffset(days[0], timeline), days.length * columnWidth)}
            {isIcon &&
                days.map((day) => {
                    const slot = slots.get(slotKey(task.id, day)) ?? { index: 0, total: 1 };
                    const centre =
                        dateToOffset(day, timeline) +
                        columnWidth / 2 +
                        (slot.index - (slot.total - 1) / 2) * MARKER_SLOT_WIDTH;

                    return icon(String(day.getTime()), centre);
                })}
        </>
    );
};

export const GanttMarker = React.memo(GanttMarkerInner);
