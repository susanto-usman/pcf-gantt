import * as React from "react";
import { parseFields, parseOptions, serializeFields, serializeOptions } from "../settings";
import { GanttChartProps } from "../types";
import { GanttChart } from "./GanttChart";
import { GanttSettingsPanel } from "./GanttSettingsPanel";

export interface GanttControlViewProps {
    /** The saved Field mapping and Options, as the host holds them. */
    fields: string;
    options: string;
    /** Column names in the dataset, for the settings panel to offer. */
    columns: string[];
    /** The chart's props for a pair of settings, read against the latest data. */
    build: (fields: string, options: string) => GanttChartProps;
    /** Changes on every updateView, since the data can move while the settings hold still. */
    version: number;
    /** Publishes the settings through the control's outputs, for the app to store. */
    onApply: (fields: string, options: string) => void;
}

/** A draft the maker is trying out; either half left undefined shows the saved setting. */
interface Draft {
    fields?: string;
    options?: string;
}

/**
 * The chart plus the maker's settings panel. The panel's draft is drawn in
 * place of the saved settings until it reaches the properties — pasted in, or
 * applied and fed back by the app — at which point the saved text changes and
 * the draft is let go, or until the maker discards it.
 */
export const GanttControlView: React.FC<GanttControlViewProps> = ({
    fields,
    options,
    columns,
    build,
    version,
    onApply,
}) => {
    const [draft, setDraft] = React.useState<Draft>({});
    const [isOpen, setIsOpen] = React.useState(false);

    // Each half goes as soon as its property is saved, whatever it was saved as.
    React.useEffect(
        () => setDraft((current) => (current.fields === undefined ? current : { ...current, fields: undefined })),
        [fields]
    );
    React.useEffect(
        () => setDraft((current) => (current.options === undefined ? current : { ...current, options: undefined })),
        [options]
    );

    const activeFields = draft.fields ?? fields;
    const activeOptions = draft.options ?? options;

    const chart = React.useMemo(
        () => build(activeFields, activeOptions),
        // version stands in for the dataset, which build reads for itself.
        [build, version, activeFields, activeOptions]
    );

    const handleChange = React.useCallback(
        (nextFields: string, nextOptions: string) => {
            // A draft that says what the saved setting already means is no draft,
            // so opening the panel and closing it again previews nothing.
            setDraft({
                fields: nextFields === serializeFields(parseFields(fields).value) ? undefined : nextFields,
                options: nextOptions === serializeOptions(parseOptions(options).value) ? undefined : nextOptions,
            });
        },
        [fields, options]
    );

    const handleOpen = React.useCallback(() => setIsOpen(true), []);
    const handleClose = React.useCallback(() => setIsOpen(false), []);
    const handleDiscard = React.useCallback(() => setDraft({}), []);

    return (
        <>
            <GanttChart
                {...chart}
                onOpenSettings={handleOpen}
                isPreviewing={draft.fields !== undefined || draft.options !== undefined}
                onDiscardPreview={handleDiscard}
            />
            <GanttSettingsPanel
                open={isOpen}
                fields={activeFields}
                options={activeOptions}
                columns={columns}
                onChange={handleChange}
                onApply={onApply}
                onClose={handleClose}
            />
        </>
    );
};
