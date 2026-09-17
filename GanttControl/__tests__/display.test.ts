import { describe, expect, it } from "vitest";
import {
    CellReader,
    DisplayRule,
    matchDisplayRule,
    parseDisplayRules,
    readValueMap,
    renderTemplate,
    ruleColumns,
    serializeDisplayRules,
    templateColumns,
    writeValueMap,
} from "../display";
import { parseOptions, serializeOptions, toPowerFx } from "../settings";

/** A record as the rules see it: text by column, with raw values where they differ. */
function record(text: Record<string, string | null>, raw: Record<string, unknown> = {}): CellReader {
    const find = <T>(bag: Record<string, T>, column: string) =>
        Object.entries(bag).find(([key]) => key.toLowerCase() === column.toLowerCase())?.[1];

    return {
        text: (column) => find(text, column) ?? null,
        raw: (column) => find(raw, column) ?? find(text, column) ?? null,
    };
}

function rules(json: unknown): DisplayRule[] {
    const problems: string[] = [];
    const parsed = parseDisplayRules(json, problems);
    expect(problems).toEqual([]);
    return parsed;
}

describe("matchDisplayRule", () => {
    const leave = rules([
        { when: { absenceType: ["Annual Leave", "AL"] }, as: "icon", icon: "plane", color: "#D13438", blocks: true },
        { when: { absenceType: { contains: "sick" } }, as: "icon", icon: "sick" },
        { when: { resource: { blank: true } }, as: "pool" },
        { when: { statuscode: { value: 2 } }, as: "hide" },
    ]);

    it("matches values forgivingly: case, spacing and either spelling in a list", () => {
        expect(matchDisplayRule(leave, record({ absenceType: "  annual   LEAVE ", resource: "Jess" }))?.icon).toBe(
            "plane"
        );
        expect(matchDisplayRule(leave, record({ absenceType: "al", resource: "Jess" }))?.blocks).toBe(true);
    });

    it("matches part of a value", () => {
        expect(matchDisplayRule(leave, record({ absenceType: "Sick leave (paid)", resource: "Jess" }))?.icon).toBe(
            "sick"
        );
    });

    it("matches a blank value", () => {
        expect(matchDisplayRule(leave, record({ absenceType: null, resource: "" }))?.as).toBe("pool");
    });

    it("matches a choice by its number rather than its label", () => {
        expect(
            matchDisplayRule(leave, record({ resource: "Jess", statuscode: "Inactive" }, { statuscode: 2 }))?.as
        ).toBe("hide");
    });

    it("takes the first rule that matches, and none leaves a plain bar", () => {
        expect(matchDisplayRule(leave, record({ absenceType: "AL", resource: "" }))?.as).toBe("icon");
        expect(matchDisplayRule(leave, record({ absenceType: "Day shift", resource: "Jess" }))).toBeNull();
    });

    it("needs every condition in a rule to hold, and turns one around with not", () => {
        const approved = rules([{ when: { type: "Leave", status: { not: "Cancelled" } }, as: "icon", icon: "home" }]);

        expect(matchDisplayRule(approved, record({ type: "Leave", status: "Approved" }))).not.toBeNull();
        expect(matchDisplayRule(approved, record({ type: "Leave", status: "cancelled" }))).toBeNull();
        expect(matchDisplayRule(approved, record({ type: "Shift", status: "Approved" }))).toBeNull();
    });

    it("matches a lookup by its id", () => {
        const byId = rules([{ when: { crew: { value: "ABC-123" } }, as: "tint" }]);

        expect(
            matchDisplayRule(byId, record({ crew: "North" }, { crew: { id: { guid: "abc-123" }, name: "North" } }))
        ).not.toBeNull();
    });
});

describe("parseDisplayRules", () => {
    it("drops a rule with a mistake in it and says what the mistake was", () => {
        const problems: string[] = [];
        const parsed = parseDisplayRules(
            [
                { when: { type: "Leave" }, as: "picture" },
                { when: { type: { resembles: "x" } }, as: "icon" },
                { when: { type: "Leave" }, as: "icon", color: "not a colour" },
                { when: { type: "Shift" }, as: "tint", colour: "#0F6CBD" },
            ],
            problems
        );

        expect(parsed).toHaveLength(1);
        expect(parsed[0].color).toBe("#0F6CBD");
        expect(problems).toEqual([
            'Options: display[1].as "picture" is not one of bar, icon, tint, pool, hide',
            'Options: display[2].when.type: "resembles" is not one of equals, contains, startsWith, blank, value or not',
            'Options: display[3].color "not a colour" is not a colour',
        ]);
    });

    it("reads a list written by a canvas app, where plain values arrive as records of Value", () => {
        const parsed = rules([{ when: { type: [{ Value: "AL" }, { Value: "Annual Leave" }] }, as: "icon" }]);

        expect(parsed[0].when[0].values).toEqual(["AL", "Annual Leave"]);
    });

    it("writes rules back as the JSON it reads", () => {
        const json = [
            {
                when: { type: ["AL", "Annual Leave"], status: { not: { contains: "cancel" } } },
                as: "icon",
                icon: "plane",
                blocks: true,
            },
            { when: { resource: { blank: true } }, as: "pool" },
            { as: "bar", color: "#0F6CBD" },
        ];

        expect(serializeDisplayRules(rules(json))).toEqual(json);
        expect(ruleColumns(rules(json))).toEqual(["type", "status", "resource"]);
    });
});

describe("the value mapper", () => {
    const existing = rules([
        { when: { resource: { blank: true } }, as: "pool" },
        { when: { type: ["AL"] }, as: "icon", icon: "plane" },
        { when: { type: "Leave", status: "Approved" }, as: "icon", icon: "home" },
    ]);

    it("reads the mapping each value has", () => {
        expect(readValueMap(existing, "TYPE").get("al")).toEqual({
            as: "icon",
            icon: "plane",
            color: "",
            blocks: false,
        });
        // A rule over two columns is not the mapper's to read.
        expect(readValueMap(existing, "type").has("leave")).toBe(false);
    });

    it("rewrites only its own rules, in place, grouping values set alike", () => {
        const written = writeValueMap(existing, "type", [
            { value: "AL", mapping: { as: "icon", icon: "plane", color: "", blocks: true } },
            { value: "Annual Leave", mapping: { as: "icon", icon: "plane", color: "", blocks: true } },
            { value: "RDO", mapping: { as: "tint", icon: "", color: "#8A8886", blocks: false } },
            { value: "Day shift", mapping: { as: "bar", icon: "", color: "", blocks: false } },
        ]);

        expect(serializeDisplayRules(written)).toEqual([
            { when: { resource: { blank: true } }, as: "pool" },
            { when: { type: ["AL", "Annual Leave"] }, as: "icon", icon: "plane", blocks: true },
            { when: { type: "RDO" }, as: "tint", color: "#8A8886" },
            { when: { type: "Leave", status: "Approved" }, as: "icon", icon: "home" },
        ]);
    });
});

describe("renderTemplate", () => {
    const values: Record<string, string | null> = { role: "Rigger", job: "200T Crane", shift: null };
    const read = (column: string) => values[column] ?? null;

    it("reads a single column when there are no braces", () => {
        expect(renderTemplate("role", read)).toBe("Rigger");
        expect(templateColumns("role")).toEqual(["role"]);
    });

    it("fills placeholders, dropping the separators around blank ones", () => {
        expect(renderTemplate("{role} · {job} · {shift}", read)).toBe("Rigger · 200T Crane");
        expect(renderTemplate("{shift} · {role}", read)).toBe("Rigger");
        expect(renderTemplate("Job: {job} ({shift})", read)).toBe("Job: 200T Crane");
        expect(renderTemplate("{shift}", read)).toBeNull();
        expect(templateColumns("{role} · {job}")).toEqual(["role", "job"]);
    });
});

describe("the new options", () => {
    it("reads columns as view, or as a list of names and settings", () => {
        expect(parseOptions('{"columns":"View"}').value.columns).toBe("view");
        expect(
            parseOptions(
                '{"columns":["@GROUP",{"name":"@name","label":"Resource"},{"Value":"role"},{"name":"team","width":90}]}'
            ).value.columns
        ).toEqual([
            { name: "@group", label: "", width: 0 },
            { name: "@name", label: "Resource", width: 0 },
            { name: "role", label: "", width: 0 },
            { name: "team", label: "", width: 90 },
        ]);
    });

    it("reports a built-in column it does not have", () => {
        expect(parseOptions('{"columns":["@owner"]}').problems).toEqual([
            "Options: columns[1]: @owner is not one of @name, @group, @start, @end, @progress",
        ]);
    });

    it("reads back as the same settings", () => {
        const { value } = parseOptions(
            JSON.stringify({
                barStyle: "outlined",
                showAvatars: true,
                poolTitle: "Unallocated shifts",
                columns: ["@group", { name: "@name", label: "Resource" }],
                display: [{ when: { type: "AL" }, as: "icon", icon: "plane" }],
            })
        );

        expect(parseOptions(serializeOptions(value))).toEqual({ value, problems: [] });
    });

    it("writes lists and awkward names for a canvas formula", () => {
        expect(toPowerFx(JSON.stringify({ columns: ["@group", "role"], when: { "crew.name": "North" } }))).toBe(
            [
                "JSON({",
                "    columns: [",
                '        "@group",',
                '        "role"',
                "    ],",
                "    when: {",
                "        'crew.name': \"North\"",
                "    }",
                "})",
            ].join("\n")
        );
    });
});
