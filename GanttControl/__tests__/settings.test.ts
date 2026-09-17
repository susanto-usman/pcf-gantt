import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_FIELDS,
    DEFAULT_OPTIONS,
    parseFields,
    parseOptions,
    serializeFields,
    serializeOptions,
    toPowerFx,
} from "../settings";

describe("manifest defaults", () => {
    const manifest = readFileSync("GanttControl/ControlManifest.Input.xml", "utf8");
    const defaultOf = (property: string) => {
        const match = new RegExp(`<property name="${property}"[^>]*default-value="([^"]*)"`).exec(manifest);
        return match ? match[1].replace(/&quot;/g, '"') : "";
    };

    // The template a maker starts from must say exactly what a blank setting means.
    it("fills the field mapping with every key at its default", () => {
        const text = defaultOf("fields");

        expect(parseFields(text)).toEqual({ value: DEFAULT_FIELDS, problems: [] });
        expect(Object.keys(JSON.parse(text))).toEqual([
            "task",
            "start",
            "end",
            "progress",
            "parent",
            "group",
            "row",
            "category",
            "color",
            "locked",
        ]);
    });

    it("fills the options with every key at its default", () => {
        const text = defaultOf("options");

        expect(parseOptions(text)).toEqual({ value: DEFAULT_OPTIONS, problems: [] });
        expect(Object.keys(JSON.parse(text)).sort()).toEqual(Object.keys(DEFAULT_OPTIONS).sort());
    });
});

describe("parseFields", () => {
    it("keeps the defaults when the setting is blank", () => {
        expect(parseFields("")).toEqual({ value: DEFAULT_FIELDS, problems: [] });
        expect(parseFields(undefined)).toEqual({ value: DEFAULT_FIELDS, problems: [] });
    });

    it("reads plain column names, ignoring the case of the keys", () => {
        const { value, problems } = parseFields(
            '{"Start":"from","END":" to ","parent":"project.id","locked":"frozen"}'
        );

        expect(problems).toEqual([]);
        expect(value).toMatchObject({ start: "from", end: "to", parent: "project.id", locked: "frozen" });
        // Anything not mentioned keeps its default.
        expect(value.progress).toBe(DEFAULT_FIELDS.progress);
    });

    it("sets both halves of a row or group from one name", () => {
        const { value } = parseFields('{"row":"employee.name","group":"crew"}');

        expect(value.row).toEqual({ id: "employee.name", label: "employee.name" });
        expect(value.group).toEqual({ id: "crew", label: "crew" });
    });

    it("takes an id and a label, letting either stand in for a missing other", () => {
        const { value } = parseFields(
            '{"row":{"id":"employee.id","label":"employee.name"},"group":{"label":"crew.name"},"task":{"id":"code","label":"subject"}}'
        );

        expect(value.row).toEqual({ id: "employee.id", label: "employee.name" });
        expect(value.group).toEqual({ id: "crew.name", label: "crew.name" });
        expect(value.task).toEqual({ id: "code", label: "subject" });
    });

    it("keeps the record id for a task named by its label alone", () => {
        expect(parseFields('{"task":"subject"}').value.task).toEqual({ id: "id", label: "subject" });
        expect(parseFields('{"task":{"label":"subject"}}').value.task).toEqual({ id: "id", label: "subject" });
    });

    it("accepts the British spelling of colour", () => {
        expect(parseFields('{"colour":"shift"}').value.color).toBe("shift");
    });

    it("reports broken JSON and falls back to every default", () => {
        expect(parseFields('{"start": }')).toEqual({
            value: DEFAULT_FIELDS,
            problems: ["Field mapping is not valid JSON"],
        });
        expect(parseFields('["start"]').problems).toEqual([
            'Field mapping must be a JSON object, like {"start": "startDate"}',
        ]);
    });

    it("reports unknown keys and values that are not column names, keeping the rest", () => {
        const { value, problems } = parseFields(
            '{"strat":"from","end":5,"row":{"id":"emp","name":"x"},"start":"from"}'
        );

        expect(value.start).toBe("from");
        expect(value.end).toBe(DEFAULT_FIELDS.end);
        expect(value.row).toEqual({ id: "emp", label: "emp" });
        expect(problems).toEqual([
            'Field mapping: row: "name" is not a setting. Use id, label',
            "Field mapping: end must be a column name",
            'Field mapping: "strat" is not a setting. Use task, group, row, start, end, progress, parent, category, color, locked',
        ]);
    });
});

describe("parseOptions", () => {
    it("keeps the defaults when the setting is blank", () => {
        expect(parseOptions(" ")).toEqual({ value: DEFAULT_OPTIONS, problems: [] });
    });

    it("reads every option, matching values and keys ignoring case", () => {
        const { value, problems } = parseOptions(
            JSON.stringify({
                density: "Detailed",
                TimeScale: "WEEK",
                colourBy: "field",
                legend: "Day=#0F6CBD",
                showToolbar: false,
                showCurrentTime: "false",
                showProgress: false,
                showLegend: false,
                groupRows: false,
                allowMove: true,
                allowResize: "TRUE",
                showSettings: true,
            })
        );

        expect(problems).toEqual([]);
        expect(value).toEqual({
            density: "comfortable",
            timeScale: "week",
            colorBy: "field",
            legend: "Day=#0F6CBD",
            showToolbar: false,
            showCurrentTime: false,
            showProgress: false,
            showLegend: false,
            groupRows: false,
            allowMove: true,
            allowResize: true,
            showSettings: true,
        });
    });

    it("takes a legend written as JSON", () => {
        expect(parseOptions('{"legend":[{"value":"Day","color":"#0F6CBD"}]}').value.legend).toBe(
            '[{"value":"Day","color":"#0F6CBD"}]'
        );
    });

    it("reports values it cannot use and keeps their defaults", () => {
        const { value, problems } = parseOptions('{"density":"roomy","allowMove":"yes","zoom":"day"}');

        expect(value.density).toBe("comfortable");
        expect(value.allowMove).toBe(false);
        expect(problems).toEqual([
            'Options: density "roomy" is not one of comfortable, compact',
            "Options: allowMove must be true or false",
            'Options: "zoom" is not a setting. Use density, timeScale, colorBy, legend, showToolbar, showCurrentTime, showProgress, showLegend, groupRows, allowMove, allowResize, showSettings',
        ]);
    });
});

describe("serializeFields", () => {
    it("writes every key, keeping single names where one does both jobs", () => {
        const { value } = parseFields(
            '{"task":"name","group":"crew","row":{"id":"employee.id","label":"employee.name"}}'
        );

        expect(JSON.parse(serializeFields(value))).toEqual({
            task: "name",
            start: "startDate",
            end: "endDate",
            progress: "progress",
            parent: "parentId",
            group: "crew",
            row: { id: "employee.id", label: "employee.name" },
            category: "",
            color: "",
            locked: "",
        });
    });

    it("writes a task with its own id as a pair", () => {
        const { value } = parseFields('{"task":{"id":"code","label":"name"}}');

        expect(JSON.parse(serializeFields(value)).task).toEqual({ id: "code", label: "name" });
    });

    it("reads back as the same settings", () => {
        const { value } = parseFields('{"task":{"id":"code","label":"name"},"row":"emp","locked":"frozen"}');

        expect(parseFields(serializeFields(value))).toEqual({ value, problems: [] });
    });
});

describe("serializeOptions", () => {
    it("reads back as the same settings", () => {
        const { value } = parseOptions('{"density":"compact","legend":"A=#f00","allowMove":true,"showSettings":true}');

        expect(parseOptions(serializeOptions(value))).toEqual({ value, problems: [] });
    });
});

describe("toPowerFx", () => {
    it("writes the JSON as a JSON() formula over a record, doubling quotes in text", () => {
        const json = JSON.stringify({ task: "name", row: { id: "employee.id", label: 'the "name"' }, allowMove: true });

        expect(toPowerFx(json)).toBe(
            [
                "JSON({",
                '    task: "name",',
                "    row: {",
                '        id: "employee.id",',
                '        label: "the ""name"""',
                "    },",
                "    allowMove: true",
                "})",
            ].join("\n")
        );
    });
});
