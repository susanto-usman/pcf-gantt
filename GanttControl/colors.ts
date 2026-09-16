import { tokens } from "@fluentui/react-components";
import { ColorMode } from "./types";
import { TaskStatus } from "./utils";

/** The three colours a bar is painted with. */
export interface BarPalette {
    /** The bar itself, and the filled part of it when progress is shown. */
    fill: string;
    /** The unfilled remainder behind the fill. */
    track: string;
    /** The colour the bar's label is written in, on the tooltip's surface. */
    text: string;
}

/** One swatch in the legend, and the rule that paints a bar with it. */
export interface LegendItem {
    /** The colour-field value this matches, normalised. Empty for the catch-all. */
    key: string;
    label: string;
    palette: BarPalette;
}

export interface ColorScheme {
    mode: ColorMode;
    /** What the tooltip and the screen reader call the colour, e.g. "Status". */
    caption: string;
    /** Swatches for the legend, in the order the maker — or failing that, the data — gave them. */
    items: LegendItem[];
    paletteFor(colorKey: string | null, status: TaskStatus): BarPalette;
    labelFor(colorKey: string | null, status: TaskStatus): string;
}

/**
 * Bar colours for the built-in, time-based scheme. Taken from the Fluent
 * palette rather than hard-coded hex so that they invert correctly in dark and
 * high-contrast themes.
 */
export const STATUS_TOKENS: Record<TaskStatus, BarPalette> = {
    complete: {
        fill: tokens.colorPaletteGreenForeground3,
        track: tokens.colorPaletteGreenBackground2,
        text: tokens.colorPaletteGreenForeground1,
    },
    onTrack: {
        fill: tokens.colorBrandBackground,
        track: tokens.colorBrandBackground2,
        text: tokens.colorBrandForeground1,
    },
    atRisk: {
        fill: tokens.colorPaletteMarigoldForeground3,
        track: tokens.colorPaletteMarigoldBackground2,
        text: tokens.colorPaletteDarkOrangeForeground1,
    },
    overdue: {
        fill: tokens.colorPaletteRedForeground3,
        track: tokens.colorPaletteRedBackground2,
        text: tokens.colorPaletteRedForeground1,
    },
    notStarted: {
        fill: tokens.colorNeutralForeground3,
        track: tokens.colorNeutralBackground5,
        text: tokens.colorNeutralForeground3,
    },
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
    complete: "Complete",
    onTrack: "On track",
    atRisk: "At risk",
    overdue: "Overdue",
    notStarted: "Not started",
};

/** Legend order for the time-based scheme, worst news last but for "not started". */
const STATUS_ORDER: TaskStatus[] = ["onTrack", "atRisk", "overdue", "complete", "notStarted"];

/**
 * Handed out in turn to distinct values when the maker colours by a field
 * without naming the colours. Fluent tokens again, so an auto-coloured chart
 * still follows the host's theme.
 */
const AUTO_PALETTE: BarPalette[] = [
    palette(tokens.colorPaletteBlueForeground2, tokens.colorPaletteBlueBackground2),
    palette(tokens.colorPaletteGreenForeground2, tokens.colorPaletteGreenBackground2),
    palette(tokens.colorPaletteMarigoldForeground2, tokens.colorPaletteMarigoldBackground2),
    palette(tokens.colorPalettePurpleForeground2, tokens.colorPalettePurpleBackground2),
    palette(tokens.colorPaletteTealForeground2, tokens.colorPaletteTealBackground2),
    palette(tokens.colorPaletteBerryForeground2, tokens.colorPaletteBerryBackground2),
    palette(tokens.colorPaletteDarkOrangeForeground2, tokens.colorPaletteDarkOrangeBackground2),
    palette(tokens.colorPaletteForestForeground2, tokens.colorPaletteForestBackground2),
    palette(tokens.colorPaletteLilacForeground2, tokens.colorPaletteLilacBackground2),
    palette(tokens.colorPaletteCranberryForeground2, tokens.colorPaletteCranberryBackground2),
    palette(tokens.colorPaletteSteelForeground2, tokens.colorPaletteSteelBackground2),
    palette(tokens.colorPalettePinkForeground2, tokens.colorPalettePinkBackground2),
];

const NEUTRAL: BarPalette = {
    fill: tokens.colorNeutralForeground3,
    track: tokens.colorNeutralBackground5,
    text: tokens.colorNeutralForeground3,
};

/**
 * Ceiling on auto-assigned swatches. Colouring by a high-cardinality column —
 * an employee name, say — would otherwise fill the status bar with a legend
 * nobody can read; the rest fall in with the catch-all.
 */
const MAX_AUTO_ITEMS = 20;

function palette(fill: string, track: string): BarPalette {
    return { fill, track, text: fill };
}

/** Comparison form for a colour-field value and for a legend's own key. */
function normaliseKey(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

/** Letters and digits only, so "On track", "on-track" and "onTrack" all meet. */
function squash(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STATUS_ALIASES = new Map<string, TaskStatus>(
    STATUS_ORDER.flatMap((status): [string, TaskStatus][] => [
        [squash(status), status],
        [squash(STATUS_LABELS[status]), status],
    ])
);

/** The status a legend entry recolours, or null when it names something else. */
function statusOf(key: string): TaskStatus | null {
    return STATUS_ALIASES.get(squash(key)) ?? null;
}

/** Values a maker writes to mean "everything the entries above did not match". */
const CATCH_ALL = new Set(["*", "", "default", "other", "rest"]);

/**
 * CSS colours we are willing to write into a style attribute: hex, a functional
 * notation, or a bare colour keyword. Anything else is dropped rather than
 * handed to the browser to ignore silently.
 */
const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\([0-9a-z%.,\-+/\s]+\)|[a-z]{3,20})$/i;

const RGB_PATTERN = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i;

function readColor(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const text = value.trim();
    return COLOR_PATTERN.test(text) ? text : null;
}

/** The red, green and blue of a hex or rgb() colour; null for anything else. */
function toRgb(color: string): [number, number, number] | null {
    if (color.startsWith("#")) {
        const hex = color.slice(1);
        const pairs =
            hex.length === 3 || hex.length === 4
                ? [...hex.slice(0, 3)].map((digit) => digit + digit)
                : hex.length >= 6
                  ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
                  : null;

        if (!pairs) {
            return null;
        }

        const [red, green, blue] = pairs.map((pair) => parseInt(pair, 16));
        return [red, green, blue].some(Number.isNaN) ? null : [red, green, blue];
    }

    const match = RGB_PATTERN.exec(color);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * A maker gives one colour per legend entry, but a bar needs a track behind its
 * progress fill as well. It is the same colour at low alpha, which sits
 * correctly on a light or a dark surface; a colour we cannot take apart — a
 * keyword, or a notation the browser knows and we do not — goes on the track
 * as-is, which costs the progress fill its contrast but never the bar's colour.
 */
function paletteFromColor(color: string): BarPalette {
    const rgb = toRgb(color);
    return { fill: color, track: rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.28)` : color, text: color };
}

/** A legend entry as authored, before its colour is checked. */
interface RawEntry {
    value: string;
    label: string;
    color: unknown;
}

function pick(bag: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const found = Object.keys(bag).find((candidate) => candidate.toLowerCase() === key);
        const value = found === undefined ? undefined : bag[found];

        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return null;
}

function fromJson(text: string): RawEntry[] {
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }

    if (Array.isArray(parsed)) {
        return parsed.flatMap((item): RawEntry[] => {
            if (item === null || typeof item !== "object") {
                return [];
            }

            const bag = item as Record<string, unknown>;
            const value = pick(bag, ["value", "key", "name", "status", "category"]);
            const color = pick(bag, ["color", "colour", "fill"]);

            return value === null || color === null
                ? []
                : [{ value, label: pick(bag, ["label", "text", "title"]) ?? value, color }];
        });
    }

    if (parsed === null || typeof parsed !== "object") {
        return [];
    }

    // The map form: { "Planned": "#0078D4" }, or { "Planned": { "color": "#0078D4", "label": "Planned work" } }.
    return Object.entries(parsed as Record<string, unknown>).flatMap(([value, setting]): RawEntry[] => {
        if (setting !== null && typeof setting === "object") {
            const bag = setting as Record<string, unknown>;
            const color = pick(bag, ["color", "colour", "fill"]);
            return color === null ? [] : [{ value, label: pick(bag, ["label", "text", "title"]) ?? value, color }];
        }

        return [{ value, label: value, color: setting }];
    });
}

/** The shorthand form: "Planned = #0078D4; Active = #107C10". */
function fromShorthand(text: string): RawEntry[] {
    return text.split(/[;\n]/).flatMap((part): RawEntry[] => {
        const separator = part.search(/[=:]/);

        if (separator <= 0) {
            return [];
        }

        const value = part.slice(0, separator).trim();
        const color = part.slice(separator + 1).trim();

        return value.length > 0 && color.length > 0 ? [{ value, label: value, color }] : [];
    });
}

/**
 * The legend a maker authored, as JSON or as shorthand. Entries naming a colour
 * the browser would not understand are dropped, so one typo costs its own
 * swatch rather than the whole legend.
 */
export function parseLegend(text: string | null | undefined): LegendItem[] {
    const trimmed = (text ?? "").trim();

    if (trimmed.length === 0) {
        return [];
    }

    const raw = trimmed.startsWith("[") || trimmed.startsWith("{") ? fromJson(trimmed) : fromShorthand(trimmed);
    const items: LegendItem[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        const color = readColor(entry.color);
        const value = normaliseKey(entry.value);
        const key = CATCH_ALL.has(value) ? "" : value;

        if (color === null || seen.has(key)) {
            continue;
        }

        seen.add(key);
        items.push({
            key,
            label: key === "" && CATCH_ALL.has(normaliseKey(entry.label)) ? "Other" : entry.label.trim(),
            palette: paletteFromColor(color),
        });
    }

    return items;
}

/**
 * The colours the chart paints with. `status` keeps the built-in, time-based
 * scheme, which an authored legend may still recolour and rename status by
 * status; `field` colours each bar by its own colour-field value, from the
 * authored legend or, when there is none, from a palette handed out in the
 * order the values appear.
 *
 * Colouring by a field with nothing to colour by — no legend, and no record
 * carrying a value — falls back to the time-based scheme rather than painting
 * the whole chart one colour.
 */
export function buildColorScheme(
    mode: ColorMode,
    legend: string | null | undefined,
    tasks: readonly { colorKey: string | null }[]
): ColorScheme {
    const authored = parseLegend(legend);
    return mode === "field" ? fieldScheme(authored, tasks) : statusScheme(authored);
}

function statusScheme(authored: LegendItem[]): ColorScheme {
    const overrides = new Map<TaskStatus, LegendItem>();

    for (const item of authored) {
        const status = statusOf(item.key);

        if (status && !overrides.has(status)) {
            overrides.set(status, { ...item, key: status });
        }
    }

    const items = STATUS_ORDER.map(
        (status) =>
            overrides.get(status) ?? { key: status, label: STATUS_LABELS[status], palette: STATUS_TOKENS[status] }
    );
    const byStatus = new Map<TaskStatus, LegendItem>(items.map((item, index) => [STATUS_ORDER[index], item]));
    const itemFor = (status: TaskStatus) => byStatus.get(status);

    return {
        mode: "status",
        caption: "Status",
        items,
        paletteFor: (_colorKey, status) => itemFor(status)?.palette ?? STATUS_TOKENS[status],
        labelFor: (_colorKey, status) => itemFor(status)?.label ?? STATUS_LABELS[status],
    };
}

function fieldScheme(authored: LegendItem[], tasks: readonly { colorKey: string | null }[]): ColorScheme {
    const byKey = new Map<string, LegendItem>();
    const items: LegendItem[] = [];
    let fallback = authored.find((item) => item.key === "");

    for (const item of authored) {
        if (item.key !== "" && !byKey.has(item.key)) {
            byKey.set(item.key, item);
            items.push(item);
        }
    }

    // With no entry to match against, the values in the data become the legend.
    const isAuto = items.length === 0;
    let hasUnmatched = false;

    for (const task of tasks) {
        const key = normaliseKey(task.colorKey);

        if (key.length === 0) {
            hasUnmatched = true;
            continue;
        }

        if (byKey.has(key)) {
            continue;
        }

        if (isAuto && items.length < MAX_AUTO_ITEMS) {
            const item: LegendItem = {
                key,
                label: (task.colorKey ?? "").trim(),
                palette: AUTO_PALETTE[items.length % AUTO_PALETTE.length],
            };

            byKey.set(key, item);
            items.push(item);
            continue;
        }

        hasUnmatched = true;
    }

    // Nothing authored and nothing in the data to colour by: a catch-all here
    // would paint the whole chart one colour, so hand it back to the clock.
    if (items.length === 0 && !fallback) {
        return statusScheme(authored);
    }

    if (hasUnmatched && !fallback) {
        fallback = { key: "", label: "Other", palette: NEUTRAL };
    }

    if (fallback) {
        items.push(fallback);
    }

    const itemFor = (colorKey: string | null) => byKey.get(normaliseKey(colorKey));

    return {
        mode: "field",
        caption: "Colour",
        items,
        paletteFor: (colorKey) => itemFor(colorKey)?.palette ?? fallback?.palette ?? NEUTRAL,
        labelFor: (colorKey) => {
            const item = itemFor(colorKey);

            if (item) {
                return item.label;
            }

            // An unmatched value still says more about the bar than "Other" does.
            return (colorKey ?? "").trim() || (fallback?.label ?? "");
        },
    };
}
