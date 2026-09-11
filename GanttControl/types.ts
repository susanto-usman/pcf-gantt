export interface GanttTask {
    id: string;
    title: string;
    start: Date;
    end: Date;
    progress: number;
    parentId: string | null;
}

export interface GanttChartProps {
    tasks: GanttTask[];
    selectedTaskId?: string;
    showCurrentTime?: boolean;
    onSelect: (taskId: string) => void;
}

export interface GanttTaskRowProps {
    task: GanttTask;
    selectedTaskId?: string;
    taskColumnWidth: number;
    onSelect: (taskId: string) => void;
    minStart: Date;
    totalDays: number;
    dayWidth: number;
}
