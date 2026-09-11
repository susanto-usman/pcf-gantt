import * as React from "react";
import { GanttTaskRowProps } from "../types";
import { colorForTask, diffInDays } from "../utils";

export const GanttTaskRow = ({ task, selectedTaskId, taskColumnWidth, onSelect, minStart, totalDays, dayWidth }: GanttTaskRowProps) => {
    const startOffset = Math.max(0, diffInDays(minStart, task.start));
    const taskDays = Math.max(1, diffInDays(task.start, task.end) + 1);

    const laneElements = [] as React.ReactNode[];

    for (let index = 0; index < totalDays; index++) {
        const isActive = index >= startOffset && index < startOffset + taskDays;
        const laneClassName = isActive ? "gantt-lane gantt-lane-active" : "gantt-lane";

        laneElements.push(
            <div
                key={`lane-${task.id}-${index}`}
                className={laneClassName}
                style={isActive ? { borderColor: colorForTask(task.progress) } : undefined}
            />
        );
    }

    laneElements.push(
        <div
            key={`bar-${task.id}`}
            className="gantt-bar"
            style={{
                left: `${startOffset * dayWidth}px`,
                width: `${taskDays * dayWidth - 4}px`,
                background: colorForTask(task.progress),
            }}
            title={`${task.title} (${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()})`}
        />
    );

    return (
        <div key={task.id} className="gantt-row" style={{ gridTemplateColumns: `${taskColumnWidth}px auto` }}>
            <button
                type="button"
                className={selectedTaskId === task.id ? "gantt-task-label gantt-task-label-selected" : "gantt-task-label"}
                onClick={() => onSelect(task.id)}
            >
                {`${task.title} (${task.progress}%)`}
            </button>
            <div className="gantt-column-resizer" aria-hidden="true" style={{left: `${taskColumnWidth}px`}}/>
            <div className="gantt-track" style={{ gridTemplateColumns: `repeat(${totalDays}, ${dayWidth}px)` }}>
                {laneElements}
            </div>
        </div>
    );
};
