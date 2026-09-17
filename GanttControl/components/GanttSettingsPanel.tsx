import {
    Button,
    Combobox,
    Dropdown,
    Field,
    MessageBar,
    MessageBarBody,
    Option,
    OverlayDrawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Switch,
    Tab,
    TabList,
    Textarea,
} from "@fluentui/react-components";
import * as React from "react";
import {
    DEFAULT_FIELDS,
    FieldSettings,
    KeyedField,
    OptionSettings,
    parseFields,
    parseOptions,
    serializeFields,
    serializeOptions,
    toPowerFx,
} from "../settings";
import { useGanttStyles } from "../styles";
import { Density, TimeScale, ColorMode } from "../types";
import { DismissIcon } from "./icons";

export interface GanttSettingsPanelProps {
    open: boolean;
    /** The settings the panel starts from: the draft being previewed, or else the saved ones. */
    fields: string;
    options: string;
    /** Column names in the dataset, offered in every column picker. */
    columns: string[];
    /** Called on every change, with the settings as the JSON the properties take. */
    onChange: (fields: string, options: string) => void;
    /** Publishes both settings through the control's outputs, for a canvas app to store. */
    onApply: (fields: string, options: string) => void;
    onClose: () => void;
}

type Format = "json" | "powerfx";

const DENSITY_LABELS: Record<Density, string> = { comfortable: "Detailed", compact: "Compact" };
const SCALE_LABELS: Record<TimeScale, string> = { day: "Day", week: "Week", month: "Month" };
const COLOR_LABELS: Record<ColorMode, string> = { status: "Status", field: "Colour field" };

/**
 * Copies text for a maker to paste into a property. The clipboard API is
 * refused in some hosts' frames, so a hidden textarea inside the panel is the
 * fallback; inside, because the drawer keeps focus from leaving it.
 */
async function copyText(text: string, container: HTMLElement | null): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fall through to the textarea.
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    (container ?? document.body).appendChild(area);
    area.select();

    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        area.remove();
    }
}

/** Whether a name could be a column of this dataset: itself, or a lookup it names the property of. */
function isKnownColumn(name: string, columns: string[]): boolean {
    if (!name || columns.length === 0) {
        return true;
    }

    const lower = columns.map((column) => column.toLowerCase());
    const target = name.toLowerCase();
    const dot = target.indexOf(".");

    return lower.indexOf(target) >= 0 || (dot > 0 && lower.indexOf(target.slice(0, dot)) >= 0);
}

interface ColumnPickerProps {
    label: string;
    value: string;
    columns: string[];
    hint?: string;
    placeholder?: string;
    onChange: (value: string) => void;
}

/** A column name, picked from the dataset or typed, e.g. lookup.column. */
const ColumnPicker: React.FC<ColumnPickerProps> = ({ label, value, columns, hint, placeholder, onChange }) => {
    const term = value.trim().toLowerCase();
    const exact = columns.some((column) => column.toLowerCase() === term);
    // Once a column is picked the list shows everything again, so it can be swapped.
    const shown = exact || !term ? columns : columns.filter((column) => column.toLowerCase().indexOf(term) >= 0);
    const known = isKnownColumn(value.trim(), columns);

    return (
        <Field
            label={label}
            hint={hint}
            validationState={known ? "none" : "warning"}
            validationMessage={known ? undefined : "No column by that name in this view"}
        >
            <Combobox
                freeform
                size="small"
                value={value}
                selectedOptions={exact ? [columns.find((column) => column.toLowerCase() === term) ?? value] : []}
                placeholder={placeholder ?? "Not used"}
                onChange={(event) => onChange(event.target.value)}
                // Typing on past a column's name (employee to employee.id) makes the
                // combobox drop its selection with no option; the typed text stands.
                onOptionSelect={(_, data) => {
                    if (data.optionValue !== undefined) {
                        onChange(data.optionValue);
                    }
                }}
            >
                {shown.map((column) => (
                    <Option key={column} value={column}>
                        {column}
                    </Option>
                ))}
            </Combobox>
        </Field>
    );
};

interface KeyedPickerProps {
    label: string;
    pair: KeyedField;
    columns: string[];
    hint: string;
    onChange: (pair: KeyedField) => void;
}

/**
 * A row or group: keyed by one column, labelled by another. The label shows
 * blank while it follows the id, which is what a single name means.
 */
const KeyedPicker: React.FC<KeyedPickerProps> = ({ label, pair, columns, hint, onChange }) => {
    const styles = useGanttStyles();
    const follows = pair.label === pair.id;

    return (
        <div className={styles.settingsPair}>
            <ColumnPicker
                label={`${label} id`}
                value={pair.id}
                columns={columns}
                hint={hint}
                onChange={(id) => onChange({ id, label: follows ? id : pair.label })}
            />
            <ColumnPicker
                label={`${label} label`}
                value={follows ? "" : pair.label}
                columns={columns}
                placeholder="Same as the id"
                onChange={(next) => onChange({ id: pair.id, label: next || pair.id })}
            />
        </div>
    );
};

function choiceProps<T extends string>(labels: Record<T, string>, value: T, onChange: (value: T) => void) {
    return {
        value: labels[value],
        selectedOptions: [value],
        onOptionSelect: (_: unknown, data: { optionValue?: string }) => {
            if (data.optionValue) {
                onChange(data.optionValue as T);
            }
        },
        children: (Object.keys(labels) as T[]).map((key) => (
            <Option key={key} value={key}>
                {labels[key]}
            </Option>
        )),
    };
}

/**
 * The maker's settings panel. Every change is previewed on the chart straight
 * away, but a control cannot save its own properties. The panel ends with the
 * settings written out to copy into Field mapping and Options, and an Apply
 * that publishes them as outputs for a canvas app to store and feed back.
 */
export const GanttSettingsPanel: React.FC<GanttSettingsPanelProps> = ({
    open,
    fields: fieldsText,
    options: optionsText,
    columns,
    onChange,
    onApply,
    onClose,
}) => {
    const styles = useGanttStyles();
    const [tab, setTab] = React.useState<"columns" | "options">("columns");
    const [format, setFormat] = React.useState<Format>("json");
    const [copied, setCopied] = React.useState<"" | "fields" | "options" | "failed" | "applied">("");
    const [fields, setFields] = React.useState<FieldSettings>(() => parseFields(fieldsText).value);
    const [options, setOptions] = React.useState<OptionSettings>(() => parseOptions(optionsText).value);
    const footerRef = React.useRef<HTMLDivElement>(null);

    // Each opening starts from what the chart currently shows.
    React.useEffect(() => {
        if (open) {
            setFields(parseFields(fieldsText).value);
            setOptions(parseOptions(optionsText).value);
            setCopied("");
        }
        // Only on opening: the texts echo this panel's own changes while it is open.
    }, [open]);

    const fieldsJson = serializeFields(fields);
    const optionsJson = serializeOptions(options);

    const updateFields = (patch: Partial<FieldSettings>) => {
        const next = { ...fields, ...patch };
        setFields(next);
        setCopied("");
        onChange(serializeFields(next), optionsJson);
    };

    const updateOptions = (patch: Partial<OptionSettings>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        setCopied("");
        onChange(fieldsJson, serializeOptions(next));
    };

    const shownFields = format === "json" ? fieldsJson : toPowerFx(fieldsJson);
    const shownOptions = format === "json" ? optionsJson : toPowerFx(optionsJson);

    const copy = async (which: "fields" | "options") => {
        const ok = await copyText(which === "fields" ? shownFields : shownOptions, footerRef.current);
        setCopied(ok ? which : "failed");
    };

    const toggle = (key: keyof OptionSettings, label: string) => (
        <Switch
            label={label}
            checked={options[key] as boolean}
            onChange={(_, data) => updateOptions({ [key]: data.checked } as Partial<OptionSettings>)}
        />
    );

    return (
        <OverlayDrawer
            open={open}
            position="end"
            size="medium"
            // Non-modal, so the chart behind stays visible and can be tried out.
            modalType="non-modal"
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onClose();
                }
            }}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={<Button appearance="subtle" aria-label="Close" icon={<DismissIcon />} onClick={onClose} />}
                >
                    Chart settings
                </DrawerHeaderTitle>
                <TabList
                    size="small"
                    selectedValue={tab}
                    onTabSelect={(_, data) => setTab(data.value as "columns" | "options")}
                >
                    <Tab value="columns">Columns</Tab>
                    <Tab value="options">Options</Tab>
                </TabList>
            </DrawerHeader>

            <DrawerBody>
                {tab === "columns" ? (
                    <div className={styles.settingsSection}>
                        <div className={styles.settingsPair}>
                            <ColumnPicker
                                label="Task label"
                                value={fields.task.label}
                                columns={columns}
                                onChange={(label) =>
                                    updateFields({
                                        task: { id: fields.task.id, label: label || DEFAULT_FIELDS.task.label },
                                    })
                                }
                            />
                            <ColumnPicker
                                label="Task id"
                                value={fields.task.id === DEFAULT_FIELDS.task.id ? "" : fields.task.id}
                                columns={columns}
                                placeholder="The record id"
                                onChange={(id) =>
                                    updateFields({
                                        task: { id: id || DEFAULT_FIELDS.task.id, label: fields.task.label },
                                    })
                                }
                            />
                        </div>
                        <div className={styles.settingsPair}>
                            <ColumnPicker
                                label="Start"
                                value={fields.start}
                                columns={columns}
                                onChange={(start) => updateFields({ start })}
                            />
                            <ColumnPicker
                                label="End"
                                value={fields.end}
                                columns={columns}
                                onChange={(end) => updateFields({ end })}
                            />
                        </div>
                        <div className={styles.settingsPair}>
                            <ColumnPicker
                                label="Progress"
                                value={fields.progress}
                                columns={columns}
                                onChange={(progress) => updateFields({ progress })}
                            />
                            <ColumnPicker
                                label="Parent"
                                value={fields.parent}
                                columns={columns}
                                hint="The parent task id or title"
                                onChange={(parent) => updateFields({ parent })}
                            />
                        </div>
                        <KeyedPicker
                            label="Group"
                            pair={fields.group}
                            columns={columns}
                            hint="A heading row per value"
                            onChange={(group) => updateFields({ group })}
                        />
                        <KeyedPicker
                            label="Row"
                            pair={fields.row}
                            columns={columns}
                            hint="Records sharing a value share a row"
                            onChange={(row) => updateFields({ row })}
                        />
                        <div className={styles.settingsPair}>
                            <ColumnPicker
                                label="Category"
                                value={fields.category}
                                columns={columns}
                                onChange={(category) => updateFields({ category })}
                            />
                            <ColumnPicker
                                label="Colour"
                                value={fields.color}
                                columns={columns}
                                placeholder="The category"
                                onChange={(color) => updateFields({ color })}
                            />
                        </div>
                        <ColumnPicker
                            label="Locked"
                            value={fields.locked}
                            columns={columns}
                            hint="Records with a yes value cannot be moved or resized"
                            onChange={(locked) => updateFields({ locked })}
                        />
                    </div>
                ) : (
                    <div className={styles.settingsSection}>
                        <div className={styles.settingsPair}>
                            <Field label="Density">
                                <Dropdown
                                    size="small"
                                    {...choiceProps(DENSITY_LABELS, options.density, (density) =>
                                        updateOptions({ density })
                                    )}
                                />
                            </Field>
                            <Field label="Time scale">
                                <Dropdown
                                    size="small"
                                    {...choiceProps(SCALE_LABELS, options.timeScale, (timeScale) =>
                                        updateOptions({ timeScale })
                                    )}
                                />
                            </Field>
                        </div>
                        <Field label="Colour by">
                            <Dropdown
                                size="small"
                                {...choiceProps(COLOR_LABELS, options.colorBy, (colorBy) => updateOptions({ colorBy }))}
                            />
                        </Field>
                        <Field
                            label="Legend"
                            hint="Your own colours, e.g. Day shift=#0F6CBD; Night shift=#5C2E91; *=#8A8886"
                        >
                            <Textarea
                                size="small"
                                resize="vertical"
                                value={options.legend}
                                onChange={(_, data) => updateOptions({ legend: data.value })}
                            />
                        </Field>

                        <div className={styles.settingsGroup} role="group" aria-label="Show">
                            <span className={styles.settingsGroupLabel}>Show</span>
                            {toggle("showToolbar", "Toolbar")}
                            {toggle("showCurrentTime", "Current time")}
                            {toggle("showProgress", "Progress")}
                            {toggle("showLegend", "Legend")}
                            {toggle("groupRows", "Merge records sharing a row id")}
                        </div>
                        <div className={styles.settingsGroup} role="group" aria-label="Editing">
                            <span className={styles.settingsGroupLabel}>Editing</span>
                            {toggle("allowMove", "Allow move")}
                            {toggle("allowResize", "Allow resize")}
                        </div>
                        <div className={styles.settingsGroup} role="group" aria-label="Settings">
                            <span className={styles.settingsGroupLabel}>Settings</span>
                            {toggle("showSettings", "Settings button")}
                            {!options.showSettings && (
                                <MessageBar intent="info" layout="multiline">
                                    <MessageBarBody>
                                        Once saved, this panel is hidden. Turn showSettings back on in Options to return
                                        to it.
                                    </MessageBarBody>
                                </MessageBar>
                            )}
                        </div>
                    </div>
                )}
            </DrawerBody>

            <DrawerFooter>
                <div ref={footerRef} className={styles.settingsOutput}>
                    <div className={styles.settingsOutputHeader}>
                        <span className={styles.settingsGroupLabel}>Save these to the control</span>
                        <TabList
                            size="small"
                            selectedValue={format}
                            onTabSelect={(_, data) => setFormat(data.value as Format)}
                        >
                            <Tab value="json">JSON</Tab>
                            <Tab value="powerfx">Canvas formula</Tab>
                        </TabList>
                    </div>
                    <div className={styles.settingsPair}>
                        <Field label="Field mapping">
                            <Textarea size="small" readOnly value={shownFields} className={styles.settingsCode} />
                        </Field>
                        <Field label="Options">
                            <Textarea size="small" readOnly value={shownOptions} className={styles.settingsCode} />
                        </Field>
                    </div>
                    <div className={styles.settingsActions}>
                        <span className={styles.settingsCopied} role="status">
                            {copied === "fields"
                                ? "Field mapping copied"
                                : copied === "options"
                                  ? "Options copied"
                                  : copied === "failed"
                                    ? "Copy was blocked here; select the text and copy it instead"
                                    : copied === "applied"
                                      ? "Applied: stored once the app saves draftFields and draftOptions in OnChange"
                                      : ""}
                        </span>
                        <Button size="small" onClick={() => copy("fields")}>
                            Copy field mapping
                        </Button>
                        <Button size="small" onClick={() => copy("options")}>
                            Copy options
                        </Button>
                        <Button
                            size="small"
                            appearance="primary"
                            title="Publishes both settings through draftFields and draftOptions, for the app to store"
                            onClick={() => {
                                onApply(fieldsJson, optionsJson);
                                setCopied("applied");
                            }}
                        >
                            Apply
                        </Button>
                    </div>
                </div>
            </DrawerFooter>
        </OverlayDrawer>
    );
};
