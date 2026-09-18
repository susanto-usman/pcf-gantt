import {
    Button,
    Checkbox,
    Combobox,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Option,
    OverlayDrawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Radio,
    RadioGroup,
    Switch,
    Tab,
    TabList,
    Textarea,
    mergeClasses,
} from "@fluentui/react-components";
import * as React from "react";
import {
    isCatchAll,
    LegendEntry,
    readColor,
    readLegendEntries,
    STATUS_LABELS,
    STATUS_ORDER,
    STATUS_TOKENS,
    statusOf,
    toHex,
    writeLegend,
} from "../colors";
import {
    DisplayAs,
    DisplayRule,
    normaliseText,
    parseDisplayRules,
    readValueMap,
    ruleColumns,
    serializeDisplayRules,
    ValueMapping,
    writeValueMap,
} from "../display";
import {
    BUILT_IN_COLUMNS,
    ColumnSetting,
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
import { BarStyle, ColorMode, Density, TimeScale, TimeZoneMode } from "../types";
import { ChevronDownIcon, ChevronUpIcon, DismissIcon, MARKER_ICON_NAMES, MarkerIcon } from "./icons";

export interface GanttSettingsPanelProps {
    open: boolean;
    /** The settings the panel starts from: the draft being previewed, or else the saved ones. */
    fields: string;
    options: string;
    /** Column names in the dataset, offered in every column picker. */
    columns: string[];
    /** The values a column holds across the loaded records, most common first. */
    valuesOf: (column: string) => { value: string; count: number }[];
    /** Called on every change, with the settings as the JSON the properties take. */
    onChange: (fields: string, options: string) => void;
    onClose: () => void;
}

type Format = "json" | "powerfx";

type PanelTab = "columns" | "display" | "options";

const DENSITY_LABELS: Record<Density, string> = { comfortable: "Detailed", compact: "Compact" };
const SCALE_LABELS: Record<TimeScale, string> = { day: "Day", week: "Week", month: "Month" };
const COLOR_LABELS: Record<ColorMode, string> = { status: "Status", field: "Colour field" };
const ZONE_LABELS: Record<TimeZoneMode, string> = { local: "Local time", utc: "UTC" };
const BAR_STYLE_LABELS: Record<BarStyle, string> = { filled: "Filled", outlined: "Outlined" };
const KIND_LABELS: Record<DisplayAs, string> = {
    bar: "Bar",
    icon: "Icon",
    tint: "Tint",
    pool: "Unallocated",
    hide: "Hide",
};

/** Most values the mapper lists; a column with more is not one to map value by value. */
const MAX_MAPPED_VALUES = 60;

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
    /** Skips the check against the dataset's columns, for a value that is not a column name. */
    unchecked?: boolean;
    onChange: (value: string) => void;
}

/** A column name, picked from the dataset or typed, e.g. lookup.column. */
const ColumnPicker: React.FC<ColumnPickerProps> = ({
    label,
    value,
    columns,
    hint,
    placeholder,
    unchecked,
    onChange,
}) => {
    const term = value.trim().toLowerCase();
    const exact = columns.some((column) => column.toLowerCase() === term);
    // Once a column is picked the list shows everything again, so it can be swapped.
    const shown = exact || !term ? columns : columns.filter((column) => column.toLowerCase().indexOf(term) >= 0);
    const known = unchecked || isKnownColumn(value.trim(), columns);

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

interface ColumnListProps {
    value: OptionSettings["columns"];
    columns: string[];
    onChange: (value: OptionSettings["columns"]) => void;
}

/** The task list's columns: the built-in ones, the view's, or a list the maker puts in order. */
const ColumnList: React.FC<ColumnListProps> = ({ value, columns, onChange }) => {
    const styles = useGanttStyles();
    const mode = Array.isArray(value) ? "custom" : value === "view" ? "view" : "builtin";
    const list = Array.isArray(value) ? value : [];
    const choices = [...Object.keys(BUILT_IN_COLUMNS), ...columns];

    const update = (index: number, patch: Partial<ColumnSetting>) =>
        onChange(list.map((column, at) => (at === index ? { ...column, ...patch } : column)));

    const move = (index: number, by: number) => {
        const next = list.slice();
        const [column] = next.splice(index, 1);
        next.splice(index + by, 0, column);
        onChange(next);
    };

    return (
        <div className={styles.settingsSection}>
            <Field label="Task list columns" hint="Users can hide any of them from the toolbar">
                <RadioGroup
                    layout="horizontal"
                    value={mode}
                    onChange={(_, data) =>
                        onChange(
                            data.value === "view"
                                ? "view"
                                : data.value === "custom"
                                  ? [{ name: "@name", label: "", width: 0 }]
                                  : ""
                        )
                    }
                >
                    <Radio value="builtin" label="Name and dates" />
                    <Radio value="view" label="The view" />
                    <Radio value="custom" label="Choose" />
                </RadioGroup>
            </Field>

            {mode === "custom" && (
                <div>
                    {list.map((column, index) => (
                        <div key={index} className={styles.settingsListRow}>
                            <div className={styles.settingsValue}>
                                <Combobox
                                    freeform
                                    size="small"
                                    aria-label="Column"
                                    placeholder="@group, or a column"
                                    value={column.name}
                                    selectedOptions={[column.name]}
                                    onChange={(event) => update(index, { name: event.target.value })}
                                    onOptionSelect={(_, data) => {
                                        if (data.optionValue !== undefined) {
                                            update(index, { name: data.optionValue });
                                        }
                                    }}
                                >
                                    {choices.map((choice) => (
                                        <Option key={choice} value={choice}>
                                            {choice}
                                        </Option>
                                    ))}
                                </Combobox>
                            </div>
                            <Input
                                size="small"
                                className={styles.settingsNarrow}
                                aria-label="Heading"
                                placeholder={BUILT_IN_COLUMNS[column.name] ?? "Heading"}
                                value={column.label}
                                onChange={(_, data) => update(index, { label: data.value })}
                            />
                            <Input
                                size="small"
                                type="number"
                                className={styles.settingsNarrow}
                                aria-label="Width in pixels"
                                placeholder="Width"
                                value={column.width ? String(column.width) : ""}
                                onChange={(_, data) => update(index, { width: Math.max(0, Number(data.value) || 0) })}
                            />
                            <Button
                                size="small"
                                appearance="subtle"
                                aria-label="Move up"
                                icon={<ChevronUpIcon />}
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                            />
                            <Button
                                size="small"
                                appearance="subtle"
                                aria-label="Move down"
                                icon={<ChevronDownIcon />}
                                disabled={index === list.length - 1}
                                onClick={() => move(index, 1)}
                            />
                            <Button
                                size="small"
                                appearance="subtle"
                                aria-label="Remove"
                                icon={<DismissIcon />}
                                onClick={() => onChange(list.filter((_, at) => at !== index))}
                            />
                        </div>
                    ))}
                    <Button size="small" onClick={() => onChange([...list, { name: "", label: "", width: 0 }])}>
                        Add column
                    </Button>
                </div>
            )}
        </div>
    );
};

interface ColorInputProps {
    label: string;
    value: string;
    placeholder: string;
    /** Painted on the swatch while no colour is given. */
    defaultColor?: string;
    disabled?: boolean;
    onChange: (color: string) => void;
}

/**
 * A colour, picked from the swatch or typed. The swatch opens the browser's own
 * picker, which works in hex; typing still takes any CSS colour, and clearing
 * the text goes back to the default.
 */
const ColorInput: React.FC<ColorInputProps> = ({ label, value, placeholder, defaultColor, disabled, onChange }) => {
    const styles = useGanttStyles();

    return (
        <Input
            size="small"
            className={styles.settingsNarrow}
            aria-label={label}
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            contentBefore={
                <span
                    className={mergeClasses(styles.settingsSwatch, styles.settingsSwatchButton)}
                    style={{ backgroundColor: readColor(value) ?? defaultColor ?? "transparent" }}
                >
                    <input
                        type="color"
                        className={styles.settingsColorWell}
                        aria-label={`Pick ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
                        disabled={disabled}
                        value={toHex(value) ?? "#808080"}
                        onChange={(event) => onChange(event.target.value.toUpperCase())}
                    />
                </span>
            }
            onChange={(_, data) => onChange(data.value.trim())}
        />
    );
};

interface ValueMapperProps {
    rules: DisplayRule[];
    columns: string[];
    valuesOf: (column: string) => { value: string; count: number }[];
    onChange: (rules: DisplayRule[]) => void;
}

const AS_BAR: ValueMapping = { as: "bar", icon: "", color: "", blocks: false };

/**
 * Maps each value a column holds to how its records are drawn. The values are
 * read from the data itself, so the maker never has to guess how a choice is
 * spelt, and a value the rules name that the data no longer holds is kept.
 */
const ValueMapper: React.FC<ValueMapperProps> = ({ rules, columns, valuesOf, onChange }) => {
    const styles = useGanttStyles();
    const [column, setColumn] = React.useState(() => ruleColumns(rules)[0] ?? "");
    const name = column.trim();
    const found = React.useMemo(() => (name ? valuesOf(name) : []), [name, valuesOf]);
    const mapped = readValueMap(rules, name);

    // Values in the data first, then any a rule names that the data has lost.
    const values = found.filter((entry) => entry.value !== "");
    const present = new Set(values.map((entry) => normaliseText(entry.value)));

    for (const rule of rules) {
        if (rule.when.length === 1 && rule.when[0].column.toLowerCase() === name.toLowerCase()) {
            for (const value of rule.when[0].values) {
                if (typeof value === "string" && !present.has(normaliseText(value))) {
                    present.add(normaliseText(value));
                    values.push({ value, count: 0 });
                }
            }
        }
    }

    const shown = values.slice(0, MAX_MAPPED_VALUES);

    const set = (value: string, patch: Partial<ValueMapping>) => {
        const mappings = shown.map((entry) => {
            const current = mapped.get(normaliseText(entry.value)) ?? AS_BAR;
            return { value: entry.value, mapping: entry.value === value ? { ...current, ...patch } : current };
        });

        onChange(writeValueMap(rules, name, mappings));
    };

    return (
        <div className={styles.settingsSection}>
            <ColumnPicker
                label="Map the values of"
                value={column}
                columns={columns}
                hint="The column that says what a record is, e.g. a shift type or a leave type"
                onChange={setColumn}
            />

            {name && values.length === 0 && (
                <MessageBar intent="info">
                    <MessageBarBody>No loaded record has a value in this column.</MessageBarBody>
                </MessageBar>
            )}
            {values.length > MAX_MAPPED_VALUES && (
                <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                        {`This column holds ${values.length} values, so only the ${MAX_MAPPED_VALUES} most common are listed. A formula column with a short code maps more easily.`}
                    </MessageBarBody>
                </MessageBar>
            )}

            <div>
                {shown.map((entry) => {
                    const mapping = mapped.get(normaliseText(entry.value)) ?? AS_BAR;

                    return (
                        <div key={normaliseText(entry.value)} className={styles.settingsListRow}>
                            <span className={styles.settingsValue}>
                                <span>{entry.value}</span>
                                <span className={styles.settingsValueCount}>
                                    {entry.count === 0
                                        ? "Not in the loaded records"
                                        : `${entry.count} record${entry.count === 1 ? "" : "s"}`}
                                </span>
                            </span>
                            <Dropdown
                                size="small"
                                className={styles.settingsNarrow}
                                aria-label={`How ${entry.value} is drawn`}
                                {...choiceProps(KIND_LABELS, mapping.as, (as) => set(entry.value, { as }))}
                            />
                            {mapping.as === "icon" && (
                                <Combobox
                                    freeform
                                    size="small"
                                    className={styles.settingsNarrow}
                                    aria-label="Icon"
                                    placeholder="Icon or text"
                                    value={mapping.icon}
                                    selectedOptions={[mapping.icon]}
                                    onChange={(event) => set(entry.value, { icon: event.target.value })}
                                    onOptionSelect={(_, data) => {
                                        if (data.optionValue !== undefined) {
                                            set(entry.value, { icon: data.optionValue });
                                        }
                                    }}
                                >
                                    {MARKER_ICON_NAMES.map((icon) => (
                                        <Option key={icon} value={icon} text={icon}>
                                            <MarkerIcon name={icon} /> {icon}
                                        </Option>
                                    ))}
                                </Combobox>
                            )}
                            {mapping.as !== "bar" && mapping.as !== "hide" && (
                                <ColorInput
                                    label={`Colour for ${entry.value}`}
                                    placeholder="#D13438"
                                    value={mapping.color}
                                    onChange={(color) => set(entry.value, { color })}
                                />
                            )}
                            {(mapping.as === "icon" || mapping.as === "tint") && (
                                <Checkbox
                                    label="Unavailable"
                                    checked={mapping.blocks}
                                    onChange={(_, data) => set(entry.value, { blocks: data.checked === true })}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface LegendMapperProps {
    legend: string;
    colorBy: ColorMode;
    /** The column bars are coloured by: the colour field, or else the category. */
    column: string;
    valuesOf: (column: string) => { value: string; count: number }[];
    onChange: (legend: string) => void;
}

interface LegendRow {
    key: string;
    name: string;
    detail?: string;
    /** Written as the entry's value when the row is first given a colour. */
    value: string;
    /** The label shown while the maker has not given one. */
    defaultLabel: string;
    /** The colour shown while the maker has not given one. */
    defaultColor?: string;
    matches: (entry: LegendEntry) => boolean;
}

/**
 * The legend's colours and labels, one row per status or per value the colour
 * column holds, read from the data as the value mapper does. A row left without
 * a colour keeps the chart's own.
 */
const LegendMapper: React.FC<LegendMapperProps> = ({ legend, colorBy, column, valuesOf, onChange }) => {
    const styles = useGanttStyles();
    const entries = readLegendEntries(legend);
    const name = column.trim();
    const found = React.useMemo(() => (colorBy === "field" && name ? valuesOf(name) : []), [colorBy, name, valuesOf]);

    let rows: LegendRow[];
    let hiddenCount = 0;

    if (colorBy === "status") {
        rows = STATUS_ORDER.map((status) => ({
            key: status,
            name: STATUS_LABELS[status],
            value: STATUS_LABELS[status],
            defaultLabel: STATUS_LABELS[status],
            defaultColor: STATUS_TOKENS[status].fill,
            matches: (entry) => statusOf(entry.value) === status,
        }));
    } else {
        // Values in the data first, then any the legend names that the data has lost.
        const values = found.filter((entry) => entry.value !== "");
        const present = new Set(values.map((entry) => normaliseText(entry.value)));

        for (const entry of entries) {
            if (!isCatchAll(entry.value) && !present.has(normaliseText(entry.value))) {
                present.add(normaliseText(entry.value));
                values.push({ value: entry.value, count: 0 });
            }
        }

        hiddenCount = Math.max(0, values.length - MAX_MAPPED_VALUES);
        rows = values.slice(0, MAX_MAPPED_VALUES).map((entry) => ({
            key: normaliseText(entry.value),
            name: entry.value,
            detail:
                entry.count === 0
                    ? "Not in the loaded records"
                    : `${entry.count} record${entry.count === 1 ? "" : "s"}`,
            value: entry.value,
            defaultLabel: entry.value,
            matches: (candidate) =>
                !isCatchAll(candidate.value) && normaliseText(candidate.value) === normaliseText(entry.value),
        }));
        rows.push({
            key: "*",
            name: "Everything else",
            detail: "Records no row above matches",
            value: "*",
            defaultLabel: "Other",
            matches: (entry) => isCatchAll(entry.value),
        });
    }

    const set = (row: LegendRow, patch: Partial<LegendEntry>) => {
        const index = entries.findIndex(row.matches);
        const next = entries.slice();

        if (index >= 0) {
            next[index] = { ...next[index], ...patch };
        } else {
            // A new entry goes before the catch-all, which the legend shows last.
            const catchAll = next.findIndex((entry) => isCatchAll(entry.value));
            next.splice(catchAll >= 0 ? catchAll : next.length, 0, {
                value: row.value,
                label: "",
                color: "",
                ...patch,
            });
        }

        onChange(writeLegend(next));
    };

    return (
        <div className={styles.settingsSection}>
            <span className={styles.settingsGroupLabel}>Legend</span>

            {colorBy === "field" && !name && (
                <MessageBar intent="info" layout="multiline">
                    <MessageBarBody>
                        Pick a Colour or Category column on the Columns tab to set a colour per value.
                    </MessageBarBody>
                </MessageBar>
            )}
            {hiddenCount > 0 && (
                <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                        {`This column holds ${MAX_MAPPED_VALUES + hiddenCount} values, so only the ${MAX_MAPPED_VALUES} most common are listed. The rest take the Everything else colour.`}
                    </MessageBarBody>
                </MessageBar>
            )}

            {(colorBy === "status" || name) && (
                <div>
                    {rows.map((row) => {
                        const entry = entries.find(row.matches);
                        const color = entry?.color ?? "";
                        const label = entry && entry.label !== entry.value ? entry.label : "";

                        return (
                            <div key={row.key} className={styles.settingsListRow}>
                                <span className={styles.settingsValue}>
                                    <span>{row.name}</span>
                                    {row.detail && <span className={styles.settingsValueCount}>{row.detail}</span>}
                                </span>
                                <ColorInput
                                    label={`Colour for ${row.name}`}
                                    placeholder={row.defaultColor ? "Default" : "Automatic"}
                                    value={color}
                                    defaultColor={row.defaultColor}
                                    onChange={(nextColor) => set(row, { color: nextColor })}
                                />
                                <Input
                                    size="small"
                                    className={styles.settingsNarrow}
                                    aria-label={`Label for ${row.name}`}
                                    placeholder={row.defaultLabel}
                                    title={color ? undefined : "Give a colour first"}
                                    disabled={!color}
                                    value={label}
                                    onChange={(_, data) => set(row, { label: data.value })}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

interface RulesEditorProps {
    rules: DisplayRule[];
    onChange: (rules: DisplayRule[]) => void;
}

/** Every rule as JSON, for what the value mapper cannot say: several columns, contains, blank. */
const RulesEditor: React.FC<RulesEditorProps> = ({ rules, onChange }) => {
    const styles = useGanttStyles();
    const written = JSON.stringify(serializeDisplayRules(rules), null, 2);
    const [text, setText] = React.useState(written);
    const [problems, setProblems] = React.useState<string[]>([]);

    // Follows the mapper's changes, but leaves an edit the maker has not finished alone.
    React.useEffect(() => {
        setText((current) => {
            try {
                return JSON.stringify(JSON.parse(current)) === JSON.stringify(JSON.parse(written)) ? current : written;
            } catch {
                return current;
            }
        });
    }, [written]);

    const commit = () => {
        const found: string[] = [];
        const parsed = parseDisplayRules(text.trim() || "[]", found);

        setProblems(found);

        if (found.length === 0) {
            onChange(parsed);
        }
    };

    return (
        <Field
            label="All display rules"
            hint='The first rule a record matches wins. E.g. [{"when": {"type": {"contains": "leave"}, "status": "Approved"}, "as": "icon", "icon": "plane", "blocks": true}]'
            validationState={problems.length > 0 ? "error" : "none"}
            validationMessage={problems.length > 0 ? problems.join(". ") : undefined}
        >
            <Textarea
                size="small"
                resize="vertical"
                className={styles.settingsCode}
                value={text}
                onChange={(_, data) => setText(data.value)}
                onBlur={commit}
            />
        </Field>
    );
};

/**
 * The maker's settings panel. Every change is previewed on the chart straight
 * away, but a control cannot save its own properties. The panel ends with the
 * settings written out to copy into Field mapping and Options.
 */
export const GanttSettingsPanel: React.FC<GanttSettingsPanelProps> = ({
    open,
    fields: fieldsText,
    options: optionsText,
    columns,
    valuesOf,
    onChange,
    onClose,
}) => {
    const styles = useGanttStyles();
    const [tab, setTab] = React.useState<PanelTab>("columns");
    const [format, setFormat] = React.useState<Format>("json");
    const [copied, setCopied] = React.useState<"" | "fields" | "options" | "failed">("");
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
                <TabList size="small" selectedValue={tab} onTabSelect={(_, data) => setTab(data.value as PanelTab)}>
                    <Tab value="columns">Columns</Tab>
                    <Tab value="display">Display</Tab>
                    <Tab value="options">Options</Tab>
                </TabList>
            </DrawerHeader>

            <DrawerBody>
                {tab === "columns" && (
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
                                label="Row subtitle"
                                value={fields.subtitle}
                                columns={columns}
                                hint="A second line under the row, e.g. a role"
                                onChange={(subtitle) => updateFields({ subtitle })}
                            />
                            <ColumnPicker
                                label="Row image"
                                value={fields.image}
                                columns={columns}
                                hint="A picture for the row avatar"
                                onChange={(image) => updateFields({ image })}
                            />
                        </div>
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
                            label="Bar label"
                            value={fields.label}
                            columns={columns}
                            hint="A column, or several written as {role} · {job}"
                            unchecked={fields.label.indexOf("{") >= 0}
                            onChange={(label) => updateFields({ label })}
                        />
                        <div className={styles.settingsPair}>
                            <ColumnPicker
                                label="Quantity"
                                value={fields.quantity}
                                columns={columns}
                                hint="A badge on bars standing for more than one"
                                onChange={(quantity) => updateFields({ quantity })}
                            />
                            <ColumnPicker
                                label="Icon"
                                value={fields.icon}
                                columns={columns}
                                hint="For icon records that name their own icon"
                                onChange={(icon) => updateFields({ icon })}
                            />
                        </div>
                        <ColumnPicker
                            label="Locked"
                            value={fields.locked}
                            columns={columns}
                            hint="Records with a yes value cannot be moved or resized"
                            onChange={(locked) => updateFields({ locked })}
                        />
                        <ColumnList
                            value={options.columns}
                            columns={columns}
                            onChange={(value) => updateOptions({ columns: value })}
                        />
                    </div>
                )}

                {tab === "display" && (
                    <div className={styles.settingsSection}>
                        <ValueMapper
                            rules={options.display}
                            columns={columns}
                            valuesOf={valuesOf}
                            onChange={(display) => updateOptions({ display })}
                        />
                        <RulesEditor rules={options.display} onChange={(display) => updateOptions({ display })} />
                        <Field label="Unallocated heading" hint="Heads the records sent to the unallocated pool">
                            <Input
                                size="small"
                                value={options.poolTitle}
                                onChange={(_, data) => updateOptions({ poolTitle: data.value })}
                            />
                        </Field>
                    </div>
                )}

                {tab === "options" && (
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
                        <div className={styles.settingsPair}>
                            <Field label="Bar style">
                                <Dropdown
                                    size="small"
                                    {...choiceProps(BAR_STYLE_LABELS, options.barStyle, (barStyle) =>
                                        updateOptions({ barStyle })
                                    )}
                                />
                            </Field>
                            <Field label="Colour by">
                                <Dropdown
                                    size="small"
                                    {...choiceProps(COLOR_LABELS, options.colorBy, (colorBy) =>
                                        updateOptions({ colorBy })
                                    )}
                                />
                            </Field>
                        </div>
                        <div className={styles.settingsPair}>
                            <Field label="Time zone" hint="Users can switch clocks from the toolbar">
                                <Dropdown
                                    size="small"
                                    {...choiceProps(ZONE_LABELS, options.timeZone, (timeZone) =>
                                        updateOptions({ timeZone })
                                    )}
                                />
                            </Field>
                        </div>
                        <LegendMapper
                            legend={options.legend}
                            colorBy={options.colorBy}
                            column={fields.color || fields.category}
                            valuesOf={valuesOf}
                            onChange={(legend) => updateOptions({ legend })}
                        />

                        <div className={styles.settingsGroup} role="group" aria-label="Show">
                            <span className={styles.settingsGroupLabel}>Show</span>
                            {toggle("showToolbar", "Toolbar")}
                            {toggle("showCurrentTime", "Current time")}
                            {toggle("showProgress", "Progress")}
                            {toggle("showLegend", "Legend")}
                            {toggle("showAvatars", "Row avatars")}
                            {toggle("groupRows", "Merge records sharing a row id")}
                            {toggle("useTimeOfDay", "Bars at their start and end times")}
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
                                    : ""}
                        </span>
                        <Button size="small" onClick={() => copy("fields")}>
                            Copy field mapping
                        </Button>
                        <Button size="small" onClick={() => copy("options")}>
                            Copy options
                        </Button>
                    </div>
                </div>
            </DrawerFooter>
        </OverlayDrawer>
    );
};
