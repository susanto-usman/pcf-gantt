import { readColor } from "./colors";

/**
 * Display rules decide how each record is drawn from the columns it already
 * has, so the data never needs a column made for the chart. Rules are tried in
 * order and the first match wins; a record no rule matches is a plain bar, so a
 * value nobody mapped shows up looking wrong rather than disappearing.
 */

export type DisplayAs = "bar" | "icon" | "tint" | "pool" | "hide";

export const DISPLAY_KINDS: readonly DisplayAs[] = ["bar", "icon", "tint", "pool", "hide"];

/**
 * How a condition compares: `equals` the readable value, `contains` or
 * `startsWith` part of it, `blank` for no value, or `value` against the raw
 * value, e.g. a choice column's number rather than its label.
 */
export type MatchOp = "equals" | "contains" | "startsWith" | "blank" | "value";

export interface Condition {
    column: string;
    op: MatchOp;
    /** Any one matching is enough. Empty for `blank`. */
    values: (string | number | boolean)[];
    /** True for `blank: true`; for the other operators, whether the match is turned around by `not`. */
    negate: boolean;
}

export interface DisplayRule {
    /** Every condition must hold. None matches every record. */
    when: Condition[];
    as: DisplayAs;
    icon: string;
    color: string;
    label: string;
    /** Marks unavailable time, which bars overlapping it are flagged against. */
    blocks: boolean;
}

/** Reads a record's column: its readable text, and the value underneath. */
export interface CellReader {
    text(column: string): string | null;
    raw(column: string): unknown;
}

/** Comparison form: trimmed, lower-cased, runs of spaces as one. */
export function normaliseText(value: string | null | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

type Primitive = string | number | boolean;

function isPrimitive(value: unknown): value is Primitive {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Whether a raw value is the one written: a number or flag as itself, a lookup by its id. */
function rawEquals(raw: unknown, expected: Primitive): boolean {
    if (raw === null || raw === undefined) {
        return false;
    }

    if (typeof raw === "object" && !(raw instanceof Date)) {
        const reference = raw as { id?: { guid?: string } | string; guid?: string };
        const id = typeof reference.id === "string" ? reference.id : (reference.id?.guid ?? reference.guid);
        return id !== undefined && normaliseText(id) === normaliseText(String(expected));
    }

    if (typeof raw === "number" || typeof expected === "number") {
        const left = Number(raw);
        const right = Number(expected);
        return Number.isFinite(left) && Number.isFinite(right) ? left === right : false;
    }

    return normaliseText(String(raw)) === normaliseText(String(expected));
}

function conditionHolds(condition: Condition, reader: CellReader): boolean {
    const text = normaliseText(reader.text(condition.column));
    let holds: boolean;

    switch (condition.op) {
        case "blank":
            holds = text.length === 0;
            break;
        case "contains":
            holds = condition.values.some((value) => {
                const part = normaliseText(String(value));
                return part.length > 0 && text.indexOf(part) >= 0;
            });
            break;
        case "startsWith":
            holds = condition.values.some((value) => {
                const part = normaliseText(String(value));
                return part.length > 0 && text.startsWith(part);
            });
            break;
        case "value": {
            const raw = reader.raw(condition.column);
            holds = condition.values.some((value) => rawEquals(raw, value));
            break;
        }
        default: {
            // Text first, which is what a maker reads on screen; the raw value
            // as well, so a number written for a choice column matches too.
            const raw = reader.raw(condition.column);
            holds = condition.values.some(
                (value) => text === normaliseText(String(value)) || (typeof value !== "string" && rawEquals(raw, value))
            );
        }
    }

    return condition.negate ? !holds : holds;
}

/** The first rule a record matches, or null for a plain bar. */
export function matchDisplayRule(rules: readonly DisplayRule[], reader: CellReader): DisplayRule | null {
    for (const rule of rules) {
        if (rule.when.every((condition) => conditionHolds(condition, reader))) {
            return rule;
        }
    }

    return null;
}

/** Every column the rules read, once each, in the order they are first named. */
export function ruleColumns(rules: readonly DisplayRule[]): string[] {
    const seen = new Map<string, string>();

    for (const rule of rules) {
        for (const condition of rule.when) {
            if (!seen.has(condition.column.toLowerCase())) {
                seen.set(condition.column.toLowerCase(), condition.column);
            }
        }
    }

    return [...seen.values()];
}

const OPERATOR_KEYS: Record<string, MatchOp> = {
    equals: "equals",
    in: "equals",
    is: "equals",
    contains: "contains",
    startswith: "startsWith",
    blank: "blank",
    value: "value",
};

/**
 * A canvas app's JSON() writes a table of plain values as records holding a
 * single Value, so a list item in that shape is read as the value itself.
 */
export function unwrapValue(item: unknown): unknown {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);

        if (entries.length === 1 && entries[0][0].toLowerCase() === "value") {
            return entries[0][1];
        }
    }

    return item;
}

function valuesOf(value: unknown): Primitive[] | null {
    if (isPrimitive(value)) {
        return [value];
    }

    if (Array.isArray(value) && value.length > 0) {
        const items = value.map(unwrapValue);
        return items.every(isPrimitive) ? items : null;
    }

    return null;
}

/** One column's condition, from any of the forms a maker can write it in. */
function parseCondition(column: string, value: unknown, where: string, problems: string[]): Condition | null {
    const plain = valuesOf(value);

    if (plain) {
        return { column, op: "equals", values: plain, negate: false };
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        problems.push(`${where} must be a value, a list of values, or an object such as {"contains": "leave"}`);
        return null;
    }

    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length !== 1) {
        problems.push(`${where} must hold one of equals, contains, startsWith, blank, value or not`);
        return null;
    }

    const [name, operand] = entries[0];
    const key = name.toLowerCase();

    if (key === "not") {
        const inner = parseCondition(column, operand, `${where}.not`, problems);
        return inner ? { ...inner, negate: !inner.negate } : null;
    }

    const op = OPERATOR_KEYS[key];

    if (!op) {
        problems.push(`${where}: "${name}" is not one of equals, contains, startsWith, blank, value or not`);
        return null;
    }

    if (op === "blank") {
        if (typeof operand !== "boolean") {
            problems.push(`${where}.blank must be true or false`);
            return null;
        }

        return { column, op, values: [], negate: !operand };
    }

    const values = valuesOf(operand);

    if (!values) {
        problems.push(`${where}.${name} must be a value or a list of values`);
        return null;
    }

    return { column, op, values, negate: false };
}

function readString(bag: Record<string, unknown>, key: string): unknown {
    const found = Object.keys(bag).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return found === undefined ? undefined : bag[found];
}

/**
 * The display rules as written in Options: a list of
 * { "when": { column: condition }, "as": ..., "icon": ..., "color": ..., "label": ..., "blocks": ... }.
 * A rule with anything wrong in it is dropped whole, since half a rule would
 * match records the maker never meant it to.
 */
export function parseDisplayRules(value: unknown, problems: string[]): DisplayRule[] {
    if (value === null || value === undefined || value === "") {
        return [];
    }

    let list = value;

    if (typeof list === "string") {
        try {
            list = JSON.parse(list);
        } catch {
            problems.push("Options: display is not valid JSON");
            return [];
        }
    }

    if (!Array.isArray(list)) {
        problems.push('Options: display must be a list of rules, like [{"when": {"type": "Leave"}, "as": "icon"}]');
        return [];
    }

    const rules: DisplayRule[] = [];

    list.forEach((item: unknown, index) => {
        const where = `Options: display[${index + 1}]`;

        if (item === null || typeof item !== "object" || Array.isArray(item)) {
            problems.push(`${where} must be an object`);
            return;
        }

        const bag = item as Record<string, unknown>;
        const known = ["when", "as", "icon", "color", "colour", "label", "blocks"];
        const unknown = Object.keys(bag).filter((key) => known.indexOf(key.toLowerCase()) < 0);

        if (unknown.length > 0) {
            problems.push(`${where}: "${unknown[0]}" is not a setting. Use when, as, icon, color, label, blocks`);
            return;
        }

        const whenValue = readString(bag, "when");
        const when: Condition[] = [];
        let ok = true;

        if (whenValue !== undefined && whenValue !== null) {
            if (typeof whenValue !== "object" || Array.isArray(whenValue)) {
                problems.push(`${where}.when must be an object of column names, like {"type": "Leave"}`);
                return;
            }

            for (const [column, condition] of Object.entries(whenValue as Record<string, unknown>)) {
                const parsed = parseCondition(column.trim(), condition, `${where}.when.${column}`, problems);

                if (parsed) {
                    when.push(parsed);
                } else {
                    ok = false;
                }
            }
        }

        const asValue = readString(bag, "as") ?? "bar";
        const as =
            typeof asValue === "string"
                ? DISPLAY_KINDS.find((kind) => kind === asValue.trim().toLowerCase())
                : undefined;

        if (!as) {
            problems.push(`${where}.as ${JSON.stringify(asValue)} is not one of ${DISPLAY_KINDS.join(", ")}`);
            ok = false;
        }

        const colorValue = readString(bag, "color") ?? readString(bag, "colour");
        let color = "";

        if (colorValue !== undefined && colorValue !== null && colorValue !== "") {
            const read = readColor(colorValue);

            if (read === null) {
                problems.push(`${where}.color ${JSON.stringify(colorValue)} is not a colour`);
                ok = false;
            } else {
                color = read;
            }
        }

        const text = (key: string) => {
            const found = readString(bag, key);
            return typeof found === "string"
                ? found.trim()
                : found === undefined || found === null
                  ? ""
                  : String(found);
        };
        const blocksValue = readString(bag, "blocks");

        if (blocksValue !== undefined && typeof blocksValue !== "boolean") {
            problems.push(`${where}.blocks must be true or false`);
            ok = false;
        }

        if (ok && as) {
            rules.push({ when, as, icon: text("icon"), color, label: text("label"), blocks: blocksValue === true });
        }
    });

    return rules;
}

function conditionJson(condition: Condition): unknown {
    const single = (values: Primitive[]) => (values.length === 1 ? values[0] : values);

    if (condition.op === "blank") {
        return { blank: !condition.negate };
    }

    const form = condition.op === "equals" ? single(condition.values) : { [condition.op]: single(condition.values) };

    return condition.negate ? { not: form } : form;
}

/** The rules as the JSON Options holds, with only the keys a rule actually uses. */
export function serializeDisplayRules(rules: readonly DisplayRule[]): unknown[] {
    return rules.map((rule) => {
        const out: Record<string, unknown> = {};

        if (rule.when.length > 0) {
            out.when = Object.fromEntries(rule.when.map((condition) => [condition.column, conditionJson(condition)]));
        }

        out.as = rule.as;

        if (rule.icon) {
            out.icon = rule.icon;
        }

        if (rule.color) {
            out.color = rule.color;
        }

        if (rule.label) {
            out.label = rule.label;
        }

        if (rule.blocks) {
            out.blocks = true;
        }

        return out;
    });
}

/**
 * A rule the value mapper can own: it matches one column against a list of
 * values and nothing else, so the mapper can rewrite it without losing
 * anything the maker wrote by hand.
 */
export function isValueMapRule(rule: DisplayRule, column: string): boolean {
    return (
        rule.when.length === 1 &&
        rule.when[0].column.toLowerCase() === column.toLowerCase() &&
        rule.when[0].op === "equals" &&
        !rule.when[0].negate &&
        rule.when[0].values.every((value) => typeof value === "string")
    );
}

/** What the value mapper sets for one value. */
export interface ValueMapping {
    as: DisplayAs;
    icon: string;
    color: string;
    blocks: boolean;
}

/** The mapping each value of a column has in the rules the mapper owns. Unmapped values are absent. */
export function readValueMap(rules: readonly DisplayRule[], column: string): Map<string, ValueMapping> {
    const map = new Map<string, ValueMapping>();

    for (const rule of rules) {
        if (!isValueMapRule(rule, column)) {
            continue;
        }

        for (const value of rule.when[0].values) {
            const key = normaliseText(String(value));

            if (!map.has(key)) {
                map.set(key, { as: rule.as, icon: rule.icon, color: rule.color, blocks: rule.blocks });
            }
        }
    }

    return map;
}

/**
 * Rewrites the rules for one column from the value mapper: values sharing the
 * same settings become one rule, placed where the column's first rule was so
 * the order against the maker's other rules holds. Values left as a bar need
 * no rule at all.
 */
export function writeValueMap(
    rules: readonly DisplayRule[],
    column: string,
    mappings: readonly { value: string; mapping: ValueMapping }[]
): DisplayRule[] {
    const grouped = new Map<string, DisplayRule>();

    for (const { value, mapping } of mappings) {
        if (mapping.as === "bar") {
            continue;
        }

        const key = JSON.stringify([mapping.as, mapping.icon, mapping.color, mapping.blocks]);
        const existing = grouped.get(key);

        if (existing) {
            existing.when[0].values.push(value);
        } else {
            grouped.set(key, {
                when: [{ column, op: "equals", values: [value], negate: false }],
                as: mapping.as,
                icon: mapping.as === "icon" ? mapping.icon : "",
                color: mapping.color,
                label: "",
                blocks: mapping.blocks,
            });
        }
    }

    const generated = [...grouped.values()];
    const at = rules.findIndex((rule) => isValueMapRule(rule, column));
    const kept = rules.filter((rule) => !isValueMapRule(rule, column));
    const insertAt = at < 0 ? kept.length : rules.slice(0, at).filter((rule) => !isValueMapRule(rule, column)).length;

    return [...kept.slice(0, insertAt), ...generated, ...kept.slice(insertAt)];
}

/**
 * A bar label from a template such as "{role} · {job}". A placeholder with no
 * value takes the text before it along, so blanks do not leave a trail of
 * separators. A template without braces is a single column name.
 */
export function renderTemplate(template: string, read: (column: string) => string | null): string | null {
    const trimmed = template.trim();

    if (!trimmed) {
        return null;
    }

    if (trimmed.indexOf("{") < 0) {
        return read(trimmed);
    }

    // Literals at even indexes, placeholders at odd ones.
    const parts = trimmed.split(/(\{[^{}]+\})/);
    let out = "";
    let lastWritten = -1;

    for (let index = 1; index < parts.length; index += 2) {
        const value = read(parts[index].slice(1, -1).trim());

        if (!value) {
            continue;
        }

        // The text before a value is a separator, unless it opens the template.
        if (out.length > 0 || index === 1) {
            out += parts[index - 1];
        }

        out += value;
        lastWritten = index;
    }

    // Closing text belongs to the last placeholder, so it goes when that one is blank.
    if (out.length > 0 && lastWritten === parts.length - 2) {
        out += parts[parts.length - 1];
    }

    const result = out.trim();
    return result.length > 0 ? result : null;
}

/** The columns a template reads. */
export function templateColumns(template: string): string[] {
    const trimmed = template.trim();

    if (!trimmed) {
        return [];
    }

    if (trimmed.indexOf("{") < 0) {
        return [trimmed];
    }

    return trimmed
        .split(/(\{[^{}]+\})/)
        .filter((_, index) => index % 2 === 1)
        .map((part) => part.slice(1, -1).trim());
}
