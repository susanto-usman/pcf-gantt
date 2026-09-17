import { mergeClasses, Tooltip } from "@fluentui/react-components";
import * as React from "react";
import { BarPalette } from "../colors";
import { cssVars, useGanttStyles } from "../styles";
import { DragMode, EditPermissions, GanttTask, TaskEdit } from "../types";
import { applyDrag, clampDragDays, formatDateTime } from "../utils";
import { GanttBarTooltipContent, useCursorTooltip } from "./GanttBarTooltip";

/** Below this a bar has no room for two grips without covering itself. */
const MIN_RESIZE_WIDTH = 26;

export interface BarLayout {
    left: number;
    width: number;
    start: Date;
    end: Date;
    progress: number;
    /** Pixels one day takes at this zoom, which turns a drag into a date change. */
    pixelsPerDay: number;
    /** The colour scheme's verdict on this bar: what it is painted with, and what that means. */
    palette: BarPalette;
    /** What the colour stands for, e.g. "On track" or "Night shift". Blank when nothing matched. */
    label: string;
    /** Names the label in the tooltip, e.g. "Status". */
    caption: string;
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
    /** True while this bar's own edit is published but not yet settled by the data. */
    isPending: boolean;
    showProgress: boolean;
    /** Which gestures the maker allows; a summary bar is never editable whatever this says. */
    canEdit: EditPermissions;
    onSelect: (taskId: string) => void;
    onOpen: (taskId: string) => void;
    onEdit: (edit: TaskEdit) => void;
}

export const GanttBar: React.FC<GanttBarProps> = ({
    task,
    layout,
    isSummary,
    rowLabel,
    overlap,
    isSelected,
    isPending,
    showProgress,
    canEdit,
    onSelect,
    onOpen,
    onEdit,
}) => {
    const styles = useGanttStyles();
    const { left, width, start, end, progress, palette, label, caption, isMilestone, pixelsPerDay } = layout;

    /**
     * The drag in flight, held here rather than in the chart so that a pointer
     * move re-renders one bar instead of every visible row.
     */
    const [drag, setDrag] = React.useState<{ mode: DragMode; days: number } | null>(null);
    /**
     * Set by the pointerup that ends a drag that actually moved something, so
     * the click browsers fire afterwards does not also toggle the selection.
     */
    const dragged = React.useRef(false);
    /**
     * Detaches the listeners of the drag in flight, if any. Scrolling the row
     * out of the windowed range unmounts the bar mid-drag, and the window-level
     * Escape listener would outlive it.
     */
    const detachDrag = React.useRef<(() => void) | null>(null);
    /** The bar itself, so a press on one of its grips still lands focus on it. */
    const barRef = React.useRef<HTMLDivElement>(null);

    // A rolled-up bar has no dates of its own to change: its span comes from its
    // children, so dragging it would have nothing to write back. A locked record
    // refuses both gestures whatever the maker has allowed.
    const canMove = canEdit.move && !isSummary && !task.isLocked;
    const canResize = canEdit.resize && !isSummary && !isMilestone && !task.isLocked;
    // Worth saying only where the bar would otherwise have been draggable.
    const showLock = task.isLocked && (canEdit.move || canEdit.resize);

    const startDrag = (event: React.PointerEvent<HTMLDivElement>, mode: DragMode) => {
        // Primary button only: a right- or middle-click must not start a drag.
        if (event.button !== 0) {
            return;
        }

        // Every value the deferred handlers need is read here, while the event
        // is still live. React 16 pools synthetic events and nulls their
        // properties once this handler returns.
        const target = event.currentTarget;
        const { pointerId } = event;
        const originX = event.clientX;
        let days = 0;

        // Cleared up front as well as on the click it suppresses, since a drag
        // that ends without one would otherwise swallow the next real click.
        dragged.current = false;

        const handleMove = (moveEvent: PointerEvent) => {
            const next = clampDragDays(start, end, mode, Math.round((moveEvent.clientX - originX) / pixelsPerDay));

            if (next !== days) {
                days = next;
                setDrag({ mode, days: next });
            }
        };

        const detach = () => {
            target.removeEventListener("pointermove", handleMove);
            target.removeEventListener("pointerup", handleUp);
            target.removeEventListener("pointercancel", handleCancel);
            window.removeEventListener("keydown", handleKeyCancel, true);
            detachDrag.current = null;

            if (target.hasPointerCapture(pointerId)) {
                target.releasePointerCapture(pointerId);
            }
        };

        const stopDrag = (commit: boolean) => {
            // Detached first: if releasing capture throws, the drag must still
            // end rather than leaving the bar following the pointer.
            detach();
            setDrag(null);

            if (commit && days !== 0) {
                dragged.current = true;
                onEdit({
                    action: mode === "move" ? "move" : "resize",
                    taskId: task.id,
                    title: task.title,
                    ...applyDrag(start, end, mode, days),
                });
            }
        };

        const handleUp = () => stopDrag(true);
        const handleCancel = () => stopDrag(false);
        const handleKeyCancel = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === "Escape") {
                keyEvent.preventDefault();
                stopDrag(false);
            }
        };

        target.setPointerCapture(pointerId);
        setDrag({ mode, days: 0 });
        detachDrag.current = detach;

        target.addEventListener("pointermove", handleMove);
        target.addEventListener("pointerup", handleUp);
        target.addEventListener("pointercancel", handleCancel);
        // Captured, so Escape reaches this even though focus is elsewhere.
        window.addEventListener("keydown", handleKeyCancel, true);
        // Stops the drag from selecting text or starting a native one. It also
        // stops the press moving focus, so the bar claims it itself rather than
        // leaving the keyboard behind wherever it was.
        event.preventDefault();
        barRef.current?.focus({ preventScroll: true });
        // The row beneath would otherwise take the press as a row selection.
        event.stopPropagation();
    };

    // What the bar shows mid-drag. Dates and pixels are shifted by the same
    // snapped number of days, so the tooltip always names where it will land.
    const shift = drag ? drag.days * pixelsPerDay : 0;
    const dragTo = drag ? applyDrag(start, end, drag.mode, drag.days) : null;
    const shownStart = dragTo ? dragTo.start : start;
    const shownEnd = dragTo ? dragTo.end : end;
    const shownLeft = drag && drag.mode !== "end" ? left + shift : left;
    const shownWidth = !drag || drag.mode === "move" ? width : drag.mode === "start" ? width - shift : width + shift;

    const cursorTooltip = useCursorTooltip();

    React.useEffect(() => () => detachDrag.current?.(), []);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(task.id);
        } else if (event.key === " ") {
            event.preventDefault();
            onSelect(task.id);
        }
    };

    const spokenRange = `${formatDateTime(shownStart)} to ${formatDateTime(shownEnd)}`;

    const shared = {
        role: "button" as const,
        tabIndex: -1,
        "aria-label": `${rowLabel ? `${rowLabel}, ` : ""}${task.title}. ${spokenRange}.${
            showProgress ? ` ${progress} percent complete.` : ""
        }${label ? ` ${label}.` : ""}${showLock ? " Locked." : ""}`,
        onClick: (event: React.MouseEvent) => {
            event.stopPropagation();

            // The click that closes a drag must not also toggle the selection.
            if (dragged.current) {
                dragged.current = false;
                return;
            }

            onSelect(task.id);
        },
        onDoubleClick: (event: React.MouseEvent) => {
            event.stopPropagation();
            onOpen(task.id);
        },
        onKeyDown: handleKeyDown,
        onPointerMove: cursorTooltip.onPointerMove,
    };

    const tooltipProps = {
        content: (
            <GanttBarTooltipContent
                task={task}
                rowLabel={rowLabel}
                start={shownStart}
                end={shownEnd}
                progress={progress}
                showProgress={showProgress}
                isSummary={isSummary}
                showLock={showLock}
            />
        ),
        relationship: "description" as const,
        withArrow: true,
        positioning: cursorTooltip.positioning,
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
                    ref={barRef}
                    className={mergeClasses(
                        styles.milestone,
                        canMove && styles.milestoneDraggable,
                        isPending && styles.barPending
                    )}
                    onPointerDown={canMove ? (event) => startDrag(event, "move") : undefined}
                    style={{
                        left: `${shownLeft + width / 2}px`,
                        backgroundColor: palette.fill,
                        // A diamond is small enough to disappear behind a bar,
                        // so the row hands it the top of the stack.
                        zIndex: drag ? 5 : overlap?.zIndex,
                    }}
                />
            </Tooltip>
        );
    }

    return (
        <Tooltip {...tooltipProps}>
            <div
                {...shared}
                ref={barRef}
                className={mergeClasses(
                    styles.bar,
                    canMove && styles.barDraggable,
                    drag !== null && styles.barDragging,
                    isPending && styles.barPending,
                    isSelected && styles.barSelected
                )}
                onPointerDown={canMove ? (event) => startDrag(event, "move") : undefined}
                style={{
                    left: `${shownLeft}px`,
                    width: `${Math.max(4, shownWidth)}px`,
                    backgroundColor: palette.track,
                    // Every bar in the stack stays centred on the row, so the
                    // added height shows above and below the bar on top.
                    ...(overlap && {
                        zIndex: drag ? 5 : overlap.zIndex,
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

                {/* Gated on the settled width, not the previewed one: a grip that
                    vanished part-way through its own drag would take the pointer
                    capture with it and leave the bar stuck to the cursor. */}
                {canResize && width >= MIN_RESIZE_WIDTH && (
                    <>
                        <div
                            className={mergeClasses(styles.barHandle, styles.barHandleStart, "gantt-bar-handle")}
                            aria-hidden="true"
                            onPointerDown={(event) => startDrag(event, "start")}
                            onClick={(event) => event.stopPropagation()}
                        />
                        <div
                            className={mergeClasses(styles.barHandle, styles.barHandleEnd, "gantt-bar-handle")}
                            aria-hidden="true"
                            onPointerDown={(event) => startDrag(event, "end")}
                            onClick={(event) => event.stopPropagation()}
                        />
                    </>
                )}
            </div>
        </Tooltip>
    );
};
