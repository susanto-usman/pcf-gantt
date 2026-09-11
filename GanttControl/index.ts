import * as React from "react";
import * as ReactDOM from "react-dom";
import { GanttChart } from "./components/GanttChart";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { GanttTask } from "./types";

type DatasetRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

export class GanttControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private notifyOutputChanged: () => void;
    private selectedTaskId: string | undefined;
    private context: ComponentFramework.Context<IInputs> | undefined;

    constructor() {
        // Empty
    }

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;
        this.container.classList.add("gantt-control");
        this.container.style.width = "100%";
        this.container.style.height = "600px";
        this.container.style.minWidth = "600px";
        this.container.style.minHeight = "320px";
        this.context = context;
        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        this.render();
    }

    public getOutputs(): IOutputs {
        return {
            selectedTaskId: this.selectedTaskId,
        };
    }

    public destroy(): void {
        ReactDOM.unmountComponentAtNode(this.container);
    }

    private render(): void {
        if (!this.context) {
            return;
        }

        const dataset = this.context.parameters.tasks;
        const titleField = this.resolveFieldName(this.context, "titleField", "title");
        const startField = this.resolveFieldName(this.context, "startField", "startDate");
        const endField = this.resolveFieldName(this.context, "endField", "endDate");
        const progressField = this.resolveFieldName(this.context, "progressField", "progress");
        const parentField = this.resolveFieldName(this.context, "parentField", "parentId");
        const showCurrentTime = this.resolveBoolean(this.context, "showCurrentTime", false);

        const tasks = this.buildTasks(dataset, titleField, startField, endField, progressField, parentField);

        ReactDOM.render(
            React.createElement(GanttChart, {
                tasks,
                selectedTaskId: this.selectedTaskId,
                showCurrentTime,
                onSelect: (taskId: string) => {
                    this.selectedTaskId = taskId;
                    this.notifyOutputChanged();
                    this.render();
                },
            }),
            this.container
        );
    }

    private resolveFieldName(
        context: ComponentFramework.Context<IInputs>,
        fieldName: keyof IInputs,
        fallback: string
    ): string {
        const property = context.parameters[fieldName] as ComponentFramework.PropertyTypes.StringProperty | undefined;
        const rawValue = property && typeof property.raw === "string" ? property.raw : undefined;
        return rawValue && rawValue.trim().length > 0 ? rawValue : fallback;
    }

    private resolveBoolean(
        context: ComponentFramework.Context<IInputs>,
        fieldName: keyof IInputs,
        fallback: boolean
    ): boolean {
        const property = context.parameters[fieldName] as ComponentFramework.PropertyTypes.TwoOptionsProperty | undefined;
        const rawValue = property && typeof property.raw === "boolean" ? property.raw : undefined;
        return rawValue === undefined ? fallback : rawValue;
    }

    private buildTasks(
        dataset: ComponentFramework.PropertyTypes.DataSet,
        titleField: string,
        startField: string,
        endField: string,
        progressField: string,
        parentField: string
    ): GanttTask[] {
        const tasks: GanttTask[] = [];

        if (!dataset || !dataset.sortedRecordIds) {
            return tasks;
        }

        for (const recordId of dataset.sortedRecordIds) {
            const record = dataset.records[recordId];

            if (!record) {
                continue;
            }

            const title = this.readString(record, titleField, "Untitled task");
            const start = this.readDate(record, startField);
            const end = this.readDate(record, endField);
            const progress = this.readNumber(record, progressField, 0);
            const parentId = this.readOptionalString(record, parentField);

            if (!start || !end) {
                continue;
            }

            tasks.push({
                id: recordId,
                title,
                start,
                end: end >= start ? end : start,
                progress: Math.max(0, Math.min(100, progress)),
                parentId: parentId || null,
            });
        }

        return tasks;
    }

    private readString(
        record: DatasetRecord,
        fieldName: string,
        fallback: string
    ): string {
        const value = record.getValue(fieldName);
        if (value === null || value === undefined) {
            const formatted = record.getFormattedValue(fieldName);
            return formatted && formatted.trim().length > 0 ? formatted : fallback;
        }

        return value.toString();
    }

    private readOptionalString(record: DatasetRecord, fieldName: string): string | null {
        const value = record.getValue(fieldName);
        if (value === null || value === undefined) {
            const formatted = record.getFormattedValue(fieldName);
            return formatted && formatted.trim().length > 0 ? formatted : null;
        }

        const text = value.toString();
        return text && text.trim().length > 0 ? text : null;
    }

    private readDate(record: DatasetRecord, fieldName: string): Date | null {
        const value = record.getValue(fieldName);

        if (value === null || value === undefined) {
            return null;
        }

        const date = value instanceof Date ? value : new Date(value as string);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    private readNumber(
        record: DatasetRecord,
        fieldName: string,
        fallback: number
    ): number {
        const value = record.getValue(fieldName);
        if (value === null || value === undefined) {
            return fallback;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

}
