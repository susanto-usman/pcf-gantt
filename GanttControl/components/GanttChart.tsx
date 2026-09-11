import * as React from "react";
import { GanttChartProps } from "../types";
import { addDays, diffInDays } from "../utils";
import { GanttEmptyState } from "./GanttEmptyState";
import { GanttTaskRow } from "./GanttTaskRow";

export const GanttChart = ({ tasks, selectedTaskId, showCurrentTime, onSelect }: GanttChartProps) => {
    const [taskColumnWidth, setTaskColumnWidth] = React.useState(240);
    const [currentTime, setCurrentTime] = React.useState(new Date());
    const dragState = React.useRef<{ startX: number; startWidth: number } | null>(null);

    React.useEffect(() => {
        if (!showCurrentTime) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            setCurrentTime(new Date());
        }, 30000);

        return () => window.clearInterval(intervalId);
    }, [showCurrentTime]);

    React.useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!dragState.current) {
                return;
            }

            const nextWidth = Math.min(500, Math.max(160, dragState.current.startWidth + event.clientX - dragState.current.startX));
            setTaskColumnWidth(nextWidth);
        };

        const handleMouseUp = () => {
            dragState.current = null;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
        dragState.current = {
            startX: event.clientX,
            startWidth: taskColumnWidth,
        };
        event.preventDefault();
    };

    if (tasks.length === 0) {
        return <GanttEmptyState />;
    }

    const minStart = new Date(Math.min(...tasks.map((task) => task.start.getTime())));
    const maxEnd = new Date(Math.max(...tasks.map((task) => task.end.getTime())));
    const totalDays = Math.max(1, diffInDays(minStart, maxEnd) + 1);
    const dayWidth = 42;

    const dayGridChildren: React.ReactNode[] = [];
    const monthHeaderChildren: React.ReactNode[] = [];

    let monthGroupStartIndex = 0;
    let currentMonthKey = "";

    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
        const currentDate = addDays(minStart, dayIndex);
        const nextMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;

        if (dayIndex === 0) {
            currentMonthKey = nextMonthKey;
        }

        if (dayIndex > 0 && nextMonthKey !== currentMonthKey) {
            const monthLabel = addDays(minStart, monthGroupStartIndex).toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
            });

            monthHeaderChildren.push(
                <div
                    key={`month-${monthGroupStartIndex}`}
                    className="gantt-month-header"
                    style={{ gridColumn: `span ${dayIndex - monthGroupStartIndex}` }}
                >
                    {monthLabel}
                </div>
            );

            monthGroupStartIndex = dayIndex;
            currentMonthKey = nextMonthKey;
        }

        dayGridChildren.push(
            <div key={`day-${currentDate.toISOString()}`} className="gantt-day">
                {currentDate.getDate()}
            </div>
        );
    }

    const finalMonthLabel = addDays(minStart, monthGroupStartIndex).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
    });

    monthHeaderChildren.push(
        <div
            key={`month-${monthGroupStartIndex}-final`}
            className="gantt-month-header"
            style={{ gridColumn: `span ${totalDays - monthGroupStartIndex}` }}
        >
            {finalMonthLabel}
        </div>
    );

    const rows = tasks.map((task) => (
        <GanttTaskRow
            key={task.id}
            task={task}
            selectedTaskId={selectedTaskId}
            taskColumnWidth={taskColumnWidth}
            onSelect={onSelect}
            minStart={minStart}
            totalDays={totalDays}
            dayWidth={dayWidth}
        />
    ));

    const currentDayIndex = diffInDays(minStart, currentTime);
    const shouldShowCurrentTimeMarker = showCurrentTime && currentDayIndex >= 0 && currentDayIndex < totalDays;
    const currentTimeLeft = shouldShowCurrentTimeMarker
        ? taskColumnWidth + currentDayIndex * dayWidth + ((currentTime.getTime() - new Date(currentTime).setHours(0, 0, 0, 0)) / (24 * 60 * 60 * 1000)) * dayWidth
        : undefined;

    return (
        <div className="gantt-root">
            <div className="gantt-header" style={{ gridTemplateColumns: `${taskColumnWidth}px auto` }}>
                <div className="gantt-header-label">Tasks</div>
                <div className="gantt-column-resizer" onMouseDown={startResize} style={{left: `${taskColumnWidth}px`}}/>
                <div className="gantt-header-columns">
                    <div className="gantt-date-group-grid" style={{ gridTemplateColumns: `repeat(${totalDays}, ${dayWidth}px)` }}>
                        {monthHeaderChildren}
                    </div>
                    <div className="gantt-day-grid" style={{ gridTemplateColumns: `repeat(${totalDays}, ${dayWidth}px)` }}>
                        {dayGridChildren}
                    </div>
                </div>
            </div>
            <div className="gantt-body">
                {shouldShowCurrentTimeMarker && currentTimeLeft !== undefined && (
                    <div
                        className="gantt-current-time-marker"
                        style={{ left: `${currentTimeLeft}px` }}
                    />
                )}
                {rows}
            </div>
        </div>
    );
};
