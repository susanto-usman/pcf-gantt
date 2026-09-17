import { ColorMode, Density, TimeScale } from "./types";

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
}

export interface OptionSettings {
    density: Density;
    timeScale: TimeScale;
    colorBy: ColorMode;
    /** The legend as text, JSON or shorthand, in the form parseLegend reads. */
    legend: string;
    showToolbar: boolean;
    showCurrentTime: boolean;
    showProgress: boolean;
    showLegend: boolean;
    groupRows: boolean;
    allowMove: boolean;
    allowResize: boolean;
    /** Shows the settings button, for a maker tuning the chart. Off for end users. */
    showSettings: boolean;
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
};

export const DEFAULT_OPTIONS: OptionSettings = {
    density: "comfortable",
    timeScale: "day",
    colorBy: "status",
    legend: "",
    showToolbar: true,
    showCurrentTime: true,
    showProgress: true,
    showLegend: true,
    groupRows: true,
    allowMove: false,
    allowResize: false,
    showSettings: false,
};

const KEYED_FIELDS = ["task", "group", "row"] as const;
const PLAIN_FIELDS = ["start", "end", "progress", "parent", "category", "color", "locked"] as const;
const BOOLEAN_OPTIONS = [
    "showToolbar",
    "showCurrentTime",
    "showProgress",
    "showLegend",
    "groupRows",
    "allowMove",
    "allowResize",
    "showSettings",
] as const;

/** British spellings, since the control's own labels use them. */
const ALIASES: Record<string, string> = { colour: "color", colourby: "colorby" };

/**
 * The object a setting holds, keyed by lower-cased name. Null for a blank
 * setting; a problem for anything that is not a JSON object.
 */
function readObject(text: string | null | undefined, setting: string, problems: string[]) {
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

    const bag = new Map<string, { name: string; value: unknown }>();

    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        const key = name.toLowerCase();
        bag.set(ALIASES[key] ?? key, { name, value });
    }

    return bag;
}

function take(bag: Map<string, { name: string; value: unknown }>, key: string) {
    const entry = bag.get(key.toLowerCase());
    bag.delete(key.toLowerCase());
    return entry;
}

function reportUnknown(
    bag: Map<string, { name: string; value: unknown }>,
    setting: string,
    known: readonly string[],
    problems: string[]
) {
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
            const pair = new Map(
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
    value.colorBy = choice(
        take(bag, "colorBy"),
        { status: "status", field: "field" },
        DEFAULT_OPTIONS.colorBy,
        problems
    );

    const legend = take(bag, "legend");

    if (legend && legend.value !== null && legend.value !== undefined) {
        value.legend = typeof legend.value === "string" ? legend.value.trim() : JSON.stringify(legend.value);
    }

    for (const key of BOOLEAN_OPTIONS) {
        value[key] = flag(take(bag, key), DEFAULT_OPTIONS[key], problems);
    }

    reportUnknown(bag, "Options", ["density", "timeScale", "colorBy", "legend", ...BOOLEAN_OPTIONS], problems);

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
        },
        null,
        4
    );
}

/** The options as indented JSON, every key present. */
export function serializeOptions(options: OptionSettings): string {
    return JSON.stringify({ ...options }, null, 4);
}

/**
 * The same JSON as a canvas formula: JSON({ ... }) builds the text from a
 * record, so nothing needs its quotes doubled. Keys are plain identifiers, so
 * they are written bare.
 */
export function toPowerFx(json: string): string {
    const write = (value: unknown, indent: string): string => {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const inner = `${indent}    `;
            const entries = Object.entries(value as Record<string, unknown>).map(
                ([key, item]) => `${inner}${key}: ${write(item, inner)}`
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
