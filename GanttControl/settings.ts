import { DisplayRule, parseDisplayRules, serializeDisplayRules, unwrapValue } from "./display";
import { BarStyle, ColorMode, Density, TimeScale, TimeZoneMode } from "./types";

/**
 * The two JSON settings that configure the control: `fields`, which columns
 * the chart reads, and `options`, how it looks and what a user may do. Both
 * are forgiving: a blank or broken setting falls back to the defaults, and
 * anything that could not be used is reported as a problem for the maker
 * rather than silently ignored.
 */

/** A column that carries both a key and a readable name. */
export interface KeyedField {
    id: string;
    label: string;
}

/** Column names, as the maker wrote them; blank means the field is not used. */
export interface FieldSettings {
    /** The task's own id and title. A blank id keeps the record id. */
    task: KeyedField;
    start: string;
    end: string;
    progress: string;
    parent: string;
    /** Heading rows the task rows are gathered under. */
    group: KeyedField;
    /** Records sharing a row id are drawn as separate bars on one row. */
    row: KeyedField;
    category: string;
    color: string;
    locked: string;
    /** Text on each bar: a column name, or a template such as "{role} · {job}". */
    label: string;
    /** How many a record stands for, shown as a badge on its bar. */
    quantity: string;
    /** A second line under each row title. */
    subtitle: string;
    /** An image for each row's avatar. */
    image: string;
    /** The icon an icon record shows, when the record names its own. */
    icon: string;
}

/**
 * One column of the task list: a built-in (@name, @group, @start, @end,
 * @progress) or a dataset column. A blank label takes the column's display
 * name, and a width of 0 a width the chart picks.
 */
export interface ColumnSetting {
    name: string;
    label: string;
    width: number;
}

/** The built-in task list columns, and what each is headed by default. */
export const BUILT_IN_COLUMNS: Record<string, string> = {
    "@name": "Task",
    "@group": "Group",
    "@start": "Start",
    "@end": "Finish",
    "@progress": "Progress",
};

export interface OptionSettings {
    density: Density;
    timeScale: TimeScale;
    /**
     * Which clock dates and times are read on: the viewer's own, or UTC. Users
     * switch it from the toolbar, so this is only what the chart opens on.
     */
    timeZone: TimeZoneMode;
    colorBy: ColorMode;
    /** The legend as text, JSON or shorthand, in the form parseLegend reads. */
    legend: string;
    showToolbar: boolean;
    showCurrentTime: boolean;
    showProgress: boolean;
    showLegend: boolean;
    /**
     * Places a bar at its start and end times inside the day, rather than
     * filling every day it touches. Only the day scale draws an hour, so the
     * week and month scales keep whole days either way, and there a day two of
     * a row's records land on is shared out between them whatever this says.
     */
    useTimeOfDay: boolean;
    groupRows: boolean;
    allowMove: boolean;
    allowResize: boolean;
    /** Shows the settings button, for a maker tuning the chart. Off for end users. */
    showSettings: boolean;
    showAvatars: boolean;
    barStyle: BarStyle;
    /**
     * The task list's columns: blank for the built-in name, dates and progress,
     * "view" for the name followed by every column in the view, or a list.
     */
    columns: "" | "view" | ColumnSetting[];
    /** How records are drawn, matched against their own columns. See display.ts. */
    display: DisplayRule[];
    /** Heading for the records display rules send to the unallocated pool. */
    poolTitle: string;
}

export interface Parsed<T> {
    value: T;
    /** What the maker wrote that could not be used, e.g. `Options: density "roomy" is not one of ...`. */
    problems: string[];
}

export const DEFAULT_FIELDS: FieldSettings = {
    task: { id: "id", label: "title" },
    start: "startDate",
    end: "endDate",
    progress: "progress",
    parent: "parentId",
    group: { id: "", label: "" },
    row: { id: "", label: "" },
    category: "",
    color: "",
    locked: "",
    label: "",
    quantity: "",
    subtitle: "",
    image: "",
    icon: "",
};

export const DEFAULT_OPTIONS: OptionSettings = {
    density: "comfortable",
    timeScale: "day",
    timeZone: "local",
    colorBy: "status",
    legend: "",
    showToolbar: true,
    showCurrentTime: true,
    showProgress: true,
    showLegend: true,
    useTimeOfDay: true,
    groupRows: true,
    allowMove: false,
    allowResize: false,
    showSettings: false,
    showAvatars: false,
    barStyle: "filled",
    columns: "",
    display: [],
    poolTitle: "Unallocated",
};

const KEYED_FIELDS = ["task", "group", "row"] as const;
const PLAIN_FIELDS = [
    "start",
    "end",
    "progress",
    "parent",
    "category",
    "color",
    "locked",
    "label",
    "quantity",
    "subtitle",
    "image",
    "icon",
] as const;
const BOOLEAN_OPTIONS = [
    "showToolbar",
    "showCurrentTime",
    "showProgress",
    "showLegend",
    "useTimeOfDay",
    "groupRows",
    "allowMove",
    "allowResize",
    "showSettings",
    "showAvatars",
] as const;

/** British spellings, since the control's own labels use them. */
const ALIASES: Record<string, string> = { colour: "color", colourby: "colorby" };

type Bag = Map<string, { name: string; value: unknown }>;

/**
 * The object a setting holds, keyed by lower-cased name. Null for a blank
 * setting; a problem for anything that is not a JSON object.
 */
function readObject(text: string | null | undefined, setting: string, problems: string[]): Bag | null {
    const trimmed = (text ?? "").trim();

    if (trimmed.length === 0) {
        return null;
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(trimmed);
    } catch {
        problems.push(`${setting} is not valid JSON`);
        return null;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        problems.push(`${setting} must be a JSON object, like {"start": "startDate"}`);
        return null;
    }

    const bag: Bag = new Map();

    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        const key = name.toLowerCase();
        bag.set(ALIASES[key] ?? key, { name, value });
    }

    return bag;
}

function take(bag: Bag, key: string) {
    const entry = bag.get(key.toLowerCase());
    bag.delete(key.toLowerCase());
    return entry;
}

function reportUnknown(bag: Bag, setting: string, known: readonly string[], problems: string[]) {
    for (const { name } of bag.values()) {
        problems.push(`${setting}: "${name}" is not a setting. Use ${known.join(", ")}`);
    }
}

function columnName(value: unknown, where: string, problems: string[]): string | null {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string") {
        return value.trim();
    }

    problems.push(`${where} must be a column name`);
    return null;
}

/**
 * Where the chart reads each value from. Every entry takes a column name,
 * including lookup.column paths; task, group and row also take
 * { "id": ..., "label": ... } for a column that is keyed by one value and
 * shown by another. A plain name there sets both, except for task, whose id
 * stays the record id unless one is given.
 */
export function parseFields(text: string | null | undefined): Parsed<FieldSettings> {
    const problems: string[] = [];
    const bag = readObject(text, "Field mapping", problems);
    const value: FieldSettings = {
        ...DEFAULT_FIELDS,
        task: { ...DEFAULT_FIELDS.task },
        group: { ...DEFAULT_FIELDS.group },
        row: { ...DEFAULT_FIELDS.row },
    };

    if (!bag) {
        return { value, problems };
    }

    for (const key of KEYED_FIELDS) {
        const entry = take(bag, key);

        if (!entry) {
            continue;
        }

        const where = `Field mapping: ${entry.name}`;

        if (entry.value !== null && typeof entry.value === "object" && !Array.isArray(entry.value)) {
            const pair: Bag = new Map(
                Object.entries(entry.value as Record<string, unknown>).map(([name, v]) => [
                    name.toLowerCase(),
                    { name, value: v },
                ])
            );
            const id = columnName(take(pair, "id")?.value, `${where}.id`, problems);
            const label = columnName(take(pair, "label")?.value, `${where}.label`, problems);

            reportUnknown(pair, where, ["id", "label"], problems);

            if (id === null || label === null) {
                continue;
            }

            // Either half stands in for the other, but a task left without an
            // id keeps the default: its title is no key.
            value[key] = {
                id: id || (key === "task" ? DEFAULT_FIELDS.task.id : label),
                label: label || (key === "task" ? DEFAULT_FIELDS.task.label : id),
            };
            continue;
        }

        const name = columnName(entry.value, where, problems);

        if (name !== null) {
            value[key] =
                key === "task"
                    ? { id: DEFAULT_FIELDS.task.id, label: name || DEFAULT_FIELDS.task.label }
                    : { id: name, label: name };
        }
    }

    for (const key of PLAIN_FIELDS) {
        const entry = take(bag, key);

        if (entry) {
            const name = columnName(entry.value, `Field mapping: ${entry.name}`, problems);
            value[key] = name ?? DEFAULT_FIELDS[key];
        }
    }

    reportUnknown(bag, "Field mapping", [...KEYED_FIELDS, ...PLAIN_FIELDS], problems);

    return { value, problems };
}

function choice<T extends string>(
    entry: { name: string; value: unknown } | undefined,
    allowed: Record<string, T>,
    fallback: T,
    problems: string[]
): T {
    if (!entry || entry.value === null || entry.value === "") {
        return fallback;
    }

    const match = typeof entry.value === "string" ? allowed[entry.value.trim().toLowerCase()] : undefined;

    if (match) {
        return match;
    }

    const names = [...new Set(Object.values(allowed))].join(", ");
    problems.push(`Options: ${entry.name} ${JSON.stringify(entry.value)} is not one of ${names}`);
    return fallback;
}

function flag(entry: { name: string; value: unknown } | undefined, fallback: boolean, problems: string[]): boolean {
    if (!entry || entry.value === null || entry.value === "") {
        return fallback;
    }

    if (typeof entry.value === "boolean") {
        return entry.value;
    }

    // Text as well, for a model-driven form where every value is typed by hand.
    const text = String(entry.value).trim().toLowerCase();

    if (text === "true" || text === "false") {
        return text === "true";
    }

    problems.push(`Options: ${entry.name} must be true or false`);
    return fallback;
}

function parseColumns(
    entry: { name: string; value: unknown } | undefined,
    problems: string[]
): OptionSettings["columns"] {
    if (!entry || entry.value === null || entry.value === undefined || entry.value === "") {
        return "";
    }

    if (typeof entry.value === "string") {
        if (entry.value.trim().toLowerCase() === "view") {
            return "view";
        }

        problems.push(`Options: ${entry.name} must be "view" or a list of columns`);
        return "";
    }

    if (!Array.isArray(entry.value)) {
        problems.push(`Options: ${entry.name} must be "view" or a list of columns`);
        return "";
    }

    const columns: ColumnSetting[] = [];

    entry.value.forEach((raw: unknown, index) => {
        const item = unwrapValue(raw);
        const where = `Options: ${entry.name}[${index + 1}]`;
        let column: ColumnSetting | null = null;

        if (typeof item === "string") {
            column = { name: item.trim(), label: "", width: 0 };
        } else if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            const bag = new Map(Object.entries(item as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]));
            const name = bag.get("name");
            const label = bag.get("label");
            const width = bag.get("width");

            if (typeof name !== "string" || !name.trim()) {
                problems.push(`${where} needs a name`);
                return;
            }

            if (width !== undefined && width !== null && (typeof width !== "number" || width < 0)) {
                problems.push(`${where}.width must be a number of pixels`);
                return;
            }

            column = {
                name: name.trim(),
                label: typeof label === "string" ? label.trim() : "",
                width: typeof width === "number" ? Math.round(width) : 0,
            };
        }

        if (!column || !column.name) {
            problems.push(`${where} must be a column name or {"name": ..., "label": ..., "width": ...}`);
            return;
        }

        if (column.name.startsWith("@")) {
            const builtIn = column.name.toLowerCase();

            if (!(builtIn in BUILT_IN_COLUMNS)) {
                problems.push(`${where}: ${column.name} is not one of ${Object.keys(BUILT_IN_COLUMNS).join(", ")}`);
                return;
            }

            column.name = builtIn;
        }

        columns.push(column);
    });

    return columns;
}

/**
 * How the chart looks and behaves. The legend is taken as the shorthand text
 * or as JSON written straight into the options.
 */
export function parseOptions(text: string | null | undefined): Parsed<OptionSettings> {
    const problems: string[] = [];
    const bag = readObject(text, "Options", problems);
    const value: OptionSettings = { ...DEFAULT_OPTIONS };

    if (!bag) {
        return { value, problems };
    }

    value.density = choice(
        take(bag, "density"),
        { comfortable: "comfortable", detailed: "comfortable", compact: "compact" },
        DEFAULT_OPTIONS.density,
        problems
    );
    value.timeScale = choice(
        take(bag, "timeScale"),
        { day: "day", week: "week", month: "month" },
        DEFAULT_OPTIONS.timeScale,
        problems
    );
    value.timeZone = choice(
        take(bag, "timeZone"),
        { local: "local", browser: "local", utc: "utc", gmt: "utc" },
        DEFAULT_OPTIONS.timeZone,
        problems
    );
    value.colorBy = choice(
        take(bag, "colorBy"),
        { status: "status", field: "field" },
        DEFAULT_OPTIONS.colorBy,
        problems
    );
    value.barStyle = choice(
        take(bag, "barStyle"),
        { filled: "filled", outlined: "outlined" },
        DEFAULT_OPTIONS.barStyle,
        problems
    );

    const legend = take(bag, "legend");

    if (legend && legend.value !== null && legend.value !== undefined) {
        value.legend = typeof legend.value === "string" ? legend.value.trim() : JSON.stringify(legend.value);
    }

    for (const key of BOOLEAN_OPTIONS) {
        value[key] = flag(take(bag, key), DEFAULT_OPTIONS[key], problems);
    }

    value.columns = parseColumns(take(bag, "columns"), problems);
    value.display = parseDisplayRules(take(bag, "display")?.value, problems);

    const poolTitle = take(bag, "poolTitle");

    if (poolTitle && poolTitle.value !== null && poolTitle.value !== undefined) {
        if (typeof poolTitle.value === "string") {
            value.poolTitle = poolTitle.value.trim() || DEFAULT_OPTIONS.poolTitle;
        } else {
            problems.push(`Options: ${poolTitle.name} must be text`);
        }
    }

    reportUnknown(bag, "Options", Object.keys(DEFAULT_OPTIONS), problems);

    return { value, problems };
}

/** A keyed field as the maker would write it: one name when it does both jobs. */
function keyedValue(key: (typeof KEYED_FIELDS)[number], pair: KeyedField): string | KeyedField {
    if (key === "task") {
        return pair.id === DEFAULT_FIELDS.task.id ? pair.label : { id: pair.id, label: pair.label };
    }

    return pair.id === pair.label ? pair.id : { id: pair.id, label: pair.label };
}

/** The field mapping as indented JSON, every key present, in the order the template lists them. */
export function serializeFields(fields: FieldSettings): string {
    return JSON.stringify(
        {
            task: keyedValue("task", fields.task),
            start: fields.start,
            end: fields.end,
            progress: fields.progress,
            parent: fields.parent,
            group: keyedValue("group", fields.group),
            row: keyedValue("row", fields.row),
            category: fields.category,
            color: fields.color,
            locked: fields.locked,
            label: fields.label,
            quantity: fields.quantity,
            subtitle: fields.subtitle,
            image: fields.image,
            icon: fields.icon,
        },
        null,
        4
    );
}

/** The options as indented JSON, every key present. Columns are written as bare names where that says it all. */
export function serializeOptions(options: OptionSettings): string {
    return JSON.stringify(
        {
            ...options,
            // A row the panel has added but not yet named is left out until it is.
            columns: Array.isArray(options.columns)
                ? options.columns
                      .filter((column) => column.name.trim())
                      .map((column) =>
                          column.label || column.width
                              ? {
                                    name: column.name,
                                    ...(column.label ? { label: column.label } : {}),
                                    ...(column.width ? { width: column.width } : {}),
                                }
                              : column.name
                      )
                : options.columns,
            display: serializeDisplayRules(options.display),
        },
        null,
        4
    );
}

/** A record key as Power Fx takes it: bare when it is a plain name, in single quotes otherwise. */
function powerFxName(name: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * The same JSON as a canvas formula: JSON({ ... }) builds the text from a
 * record, so nothing needs its quotes doubled. A list is written as a table,
 * which JSON() writes back out as a list.
 */
export function toPowerFx(json: string): string {
    const write = (value: unknown, indent: string): string => {
        const inner = `${indent}    `;

        if (Array.isArray(value)) {
            const items = value.map((item) => `${inner}${write(item, inner)}`);
            return items.length === 0 ? "[]" : `[\n${items.join(",\n")}\n${indent}]`;
        }

        if (value !== null && typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>).map(
                ([key, item]) => `${inner}${powerFxName(key)}: ${write(item, inner)}`
            );
            return entries.length === 0 ? "{}" : `{\n${entries.join(",\n")}\n${indent}}`;
        }

        if (typeof value === "string") {
            // Power Fx escapes a quote by doubling it.
            return `"${value.replace(/"/g, '""')}"`;
        }

        return String(value);
    };

    return `JSON(${write(JSON.parse(json), "")})`;
}
