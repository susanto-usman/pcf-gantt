import { describe, expect, it } from "vitest";
import { buildColorScheme, parseLegend, STATUS_LABELS, STATUS_TOKENS } from "../colors";

/** Only the colour key matters to the scheme, so tasks are stubbed down to it. */
const coloured = (...keys: (string | null)[]) => keys.map((colorKey) => ({ colorKey }));

describe("parseLegend", () => {
    it("reads the JSON array form, with an optional label", () => {
        const items = parseLegend(
            '[{"value":"Planned","label":"Planned work","color":"#0078D4"},{"value":"Active","color":"#107C10"}]'
        );

        expect(items.map((item) => [item.key, item.label, item.palette.fill])).toEqual([
            ["planned", "Planned work", "#0078D4"],
            ["active", "Active", "#107C10"],
        ]);
    });

    it("reads the JSON map form, either as a colour or as a settings object", () => {
        const items = parseLegend('{"Planned":"#0078D4","Active":{"color":"#107C10","label":"In progress"}}');

        expect(items.map((item) => [item.key, item.label, item.palette.fill])).toEqual([
            ["planned", "Planned", "#0078D4"],
            ["active", "In progress", "#107C10"],
        ]);
    });

    it("reads the shorthand form, separated by semicolons or newlines", () => {
        const items = parseLegend("Planned = #0078D4; Active: #107C10\n Leave =#8A8886 ");

        expect(items.map((item) => [item.key, item.palette.fill])).toEqual([
            ["planned", "#0078D4"],
            ["active", "#107C10"],
            ["leave", "#8A8886"],
        ]);
    });

    it("derives a translucent track from the colour so progress still reads", () => {
        expect(parseLegend("Planned=#0078D4")[0].palette).toEqual({
            fill: "#0078D4",
            track: "rgba(0, 120, 212, 0.28)",
            text: "#0078D4",
        });

        // Three-digit hex and rgb() are taken apart as well.
        expect(parseLegend("A=#f00")[0].palette.track).toBe("rgba(255, 0, 0, 0.28)");
        expect(parseLegend("A=rgb(10 20 30)")[0].palette.track).toBe("rgba(10, 20, 30, 0.28)");
        // A colour we cannot take apart still paints the bar.
        expect(parseLegend("A=rebeccapurple")[0].palette.track).toBe("rebeccapurple");
    });

    it("drops entries whose colour is not one the browser would take, and keeps the rest", () => {
        const items = parseLegend("Planned=#0078D4; Broken=not a colour; Missing=");

        expect(items.map((item) => item.key)).toEqual(["planned"]);
    });

    it("lets nothing but a colour through to the style attribute", () => {
        // The separator ends the entry, so the declaration trailing it is read
        // as an entry of its own and then dropped for having no colour.
        const items = parseLegend("Planned=red;background:url(evil)");

        expect(items.map((item) => [item.key, item.palette.fill])).toEqual([["planned", "red"]]);
    });

    it("folds the catch-all spellings onto one entry labelled Other", () => {
        expect(parseLegend("*=#8A8886")[0]).toMatchObject({ key: "", label: "Other" });
        expect(parseLegend("default=#8A8886")[0]).toMatchObject({ key: "", label: "Other" });
        expect(parseLegend('[{"value":"*","label":"Everything else","color":"#8A8886"}]')[0]).toMatchObject({
            key: "",
            label: "Everything else",
        });
    });

    it("keeps the first of two entries for the same value, and survives broken input", () => {
        expect(parseLegend("A=#111111; a=#222222").map((item) => item.palette.fill)).toEqual(["#111111"]);
        expect(parseLegend('[{"value":"A"')).toEqual([]);
        expect(parseLegend("   ")).toEqual([]);
        expect(parseLegend(undefined)).toEqual([]);
    });
});

describe("buildColorScheme, by status", () => {
    it("keeps the built-in scheme when no legend is given", () => {
        const scheme = buildColorScheme("status", "", coloured("Planned"));

        expect(scheme.items.map((item) => item.label)).toEqual([
            "On track",
            "At risk",
            "Overdue",
            "Complete",
            "Not started",
        ]);
        expect(scheme.caption).toBe("Status");
        // The colour key is beside the point here; the status decides.
        expect(scheme.paletteFor("Planned", "overdue")).toEqual(STATUS_TOKENS.overdue);
        expect(scheme.labelFor("Planned", "overdue")).toBe(STATUS_LABELS.overdue);
        expect(scheme.keyFor("Planned", "overdue")).toBe("overdue");
    });

    it("lets a legend recolour and rename a status, however it is spelled", () => {
        const scheme = buildColorScheme("status", "On track = #123456; OVERDUE=#654321|", coloured(null));

        expect(scheme.paletteFor(null, "onTrack").fill).toBe("#123456");
        expect(scheme.labelFor(null, "onTrack")).toBe("On track");
        // The entry above is malformed past the colour, so the status keeps its own.
        expect(scheme.paletteFor(null, "overdue")).toEqual(STATUS_TOKENS.overdue);
        expect(scheme.items).toHaveLength(5);
    });

    it("ignores legend entries that name no status", () => {
        const scheme = buildColorScheme("status", "Night shift=#123456", coloured("Night shift"));

        expect(scheme.items.map((item) => item.palette.fill)).not.toContain("#123456");
    });
});

describe("buildColorScheme, by field", () => {
    it("paints each bar from the legend, matching the value case-insensitively", () => {
        const scheme = buildColorScheme("field", "Planned=#0078D4; Active=#107C10", coloured("planned", "ACTIVE"));

        expect(scheme.mode).toBe("field");
        expect(scheme.paletteFor("planned", "overdue").fill).toBe("#0078D4");
        expect(scheme.paletteFor(" Active ", "complete").fill).toBe("#107C10");
        expect(scheme.labelFor("ACTIVE", "onTrack")).toBe("Active");
        expect(scheme.items.map((item) => item.label)).toEqual(["Planned", "Active"]);
    });

    it("sends unmatched and blank values to the catch-all, adding one when the maker gave none", () => {
        const scheme = buildColorScheme("field", "Planned=#0078D4", coloured("Planned", "Leave", null));

        expect(scheme.items.map((item) => item.label)).toEqual(["Planned", "Other"]);
        expect(scheme.paletteFor("Leave", "onTrack")).toEqual(scheme.paletteFor(null, "onTrack"));
        // An unmatched value still names itself, which says more than "Other".
        expect(scheme.labelFor("Leave", "onTrack")).toBe("Leave");
        expect(scheme.labelFor(null, "onTrack")).toBe("Other");
        // Both land on the catch-all's swatch, so a legend filter treats them alike.
        expect(scheme.keyFor("Planned", "onTrack")).toBe("planned");
        expect(scheme.keyFor("Leave", "onTrack")).toBe("");
        expect(scheme.keyFor(null, "onTrack")).toBe("");
    });

    it("uses the maker's own catch-all, and leaves it in the legend even when nothing needs it", () => {
        const scheme = buildColorScheme("field", "Planned=#0078D4; *=#8A8886", coloured("Planned"));

        expect(scheme.items.map((item) => item.label)).toEqual(["Planned", "Other"]);
        expect(scheme.paletteFor("Leave", "onTrack").fill).toBe("#8A8886");
    });

    it("builds the legend from the data when no legend is authored", () => {
        const scheme = buildColorScheme("field", "", coloured("Day shift", "Night shift", "Day shift", null));

        expect(scheme.items.map((item) => item.label)).toEqual(["Day shift", "Night shift", "Other"]);
        // Distinct values get distinct colours, and a value keeps its own.
        expect(scheme.paletteFor("Day shift", "onTrack")).not.toEqual(scheme.paletteFor("Night shift", "onTrack"));
        expect(scheme.paletteFor("day shift", "overdue")).toEqual(scheme.paletteFor("Day shift", "complete"));
    });

    it("stops handing out swatches once the legend would be unreadable", () => {
        const many = coloured(...Array.from({ length: 40 }, (_, index) => `value ${index}`));
        const scheme = buildColorScheme("field", "", many);

        // Twenty values, then the catch-all for everything past them.
        expect(scheme.items).toHaveLength(21);
        expect(scheme.labelFor("value 39", "onTrack")).toBe("value 39");
    });

    it("falls back to the status scheme when there is nothing to colour by", () => {
        const scheme = buildColorScheme("field", "", coloured(null, null));

        expect(scheme.mode).toBe("status");
        expect(scheme.paletteFor(null, "atRisk")).toEqual(STATUS_TOKENS.atRisk);
    });
});
