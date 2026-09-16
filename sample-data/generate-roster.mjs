// Generates a six-month site roster for 100 employees, shaped for the Gantt
// control's default field mapping:
//
//   employee-roster.json  each swing carries employee: { id, name }, the shape
//                         a canvas collection or Dataverse lookup hands over
//   employee-roster.csv   the same data with employee as a JSON string column
//                         ({"id":…,"name":…}), since the test harness only loads CSV
//
//   Crew (root)  ->  one row per employee, holding every swing / leave / induction
//
// Set the control's Row field to "employee.id" and Row title field to
// "employee.name": records sharing an id are drawn as separate bars on a single
// row labelled with the name, with gaps for days off. Title field
// "employee.name" labels every bar with the employee.
//
// Crew rows carry dates too, because the control skips records without both
// endpoints. parentId references the crew's title, which the control resolves
// when it doesn't match a record id (as in the test harness).
//
// Usage: node sample-data/generate-roster.mjs [asOfDate]
// asOfDate (YYYY-MM-DD, default today's date) drives the progress column.
// Output is deterministic: the same asOfDate always produces the same file.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RANGE_START = addDays(new Date(), -14); // 14 days ago, so the first swing is already underway
const RANGE_END = addDays(new Date(), 180); // six months from now, so the last swing is still underway
const AS_OF = parseDate(process.argv[2] ?? new Date().toISOString().split("T")[0]);
const EMPLOYEE_COUNT = 100;

const CREWS = [
    {
        name: "Mechanical",
        share: 25,
        roles: ["Mechanical Fitter", "Mechanical Fitter", "Leading Hand Fitter", "Millwright"],
    },
    {
        name: "Electrical & Instrumentation",
        share: 20,
        roles: ["Electrician", "Electrician", "Instrument Technician", "E&I Leading Hand"],
    },
    {
        name: "Boilermakers & Welders",
        share: 22,
        roles: ["Boilermaker", "Welder", "Coded Welder", "Leading Hand Boilermaker"],
    },
    { name: "Rigging & Scaffolding", share: 20, roles: ["Rigger", "Advanced Scaffolder", "Crane Operator", "Dogman"] },
    {
        name: "Supervision & HSE",
        share: 13,
        roles: ["Site Supervisor", "HSE Advisor", "Planner", "Site Administrator"],
    },
];

// onDays/offDays in calendar days. alternateShifts swaps day/night each swing.
const ROSTERS = [
    { code: "14/14 FIFO", onDays: 14, offDays: 14, alternateShifts: true, weight: 30 },
    { code: "8/6 FIFO", onDays: 8, offDays: 6, alternateShifts: true, weight: 25 },
    { code: "21/7 FIFO", onDays: 21, offDays: 7, alternateShifts: true, weight: 15 },
    { code: "7/7 DIDO", onDays: 7, offDays: 7, alternateShifts: true, weight: 15 },
    { code: "5/2 Residential", onDays: 5, offDays: 2, alternateShifts: false, weight: 15 },
];

const FIRST_NAMES = [
    "Liam",
    "Olivia",
    "Noah",
    "Charlotte",
    "Jack",
    "Amelia",
    "William",
    "Isla",
    "Oliver",
    "Mia",
    "Thomas",
    "Ava",
    "James",
    "Grace",
    "Lucas",
    "Chloe",
    "Henry",
    "Zoe",
    "Ethan",
    "Ruby",
    "Mason",
    "Sophie",
    "Cooper",
    "Harper",
    "Riley",
    "Ella",
    "Lachlan",
    "Matilda",
    "Hamish",
    "Evie",
    "Arjun",
    "Priya",
    "Wei",
    "Mei",
    "Tane",
    "Aroha",
    "Mateo",
    "Lucia",
    "Kofi",
    "Amara",
    "Declan",
    "Siobhan",
    "Nikolai",
    "Anya",
    "Darius",
    "Leila",
    "Ravi",
    "Anjali",
    "Duc",
    "Linh",
];

const LAST_NAMES = [
    "Smith",
    "Jones",
    "Williams",
    "Brown",
    "Wilson",
    "Taylor",
    "Johnson",
    "White",
    "Martin",
    "Anderson",
    "Thompson",
    "Nguyen",
    "Thomas",
    "Walker",
    "Harris",
    "Lee",
    "Ryan",
    "Robinson",
    "Kelly",
    "King",
    "Davis",
    "Wright",
    "Evans",
    "Roberts",
    "Green",
    "Hall",
    "Wood",
    "Jackson",
    "Clarke",
    "Patel",
    "Singh",
    "Chen",
    "Wang",
    "Murphy",
    "O'Brien",
    "Kovac",
    "Rossi",
    "Ngata",
    "Mensah",
    "Fernandes",
];

const rng = mulberry32(20260701);
// Separate stream, so adding overlapping leave leaves the rest of the roster
// (names, rosters, swing dates) byte-for-byte what it was.
const leaveRng = mulberry32(20260902);

const rows = [];
const usedNames = new Set();
let employeeNumber = 1001;

for (const crew of CREWS) {
    const crewTitle = `${crew.name} Crew`;
    const crewRow = {
        title: crewTitle,
        parentId: "",
        category: "Crew",
        employee: null,
        role: "",
        crew: crew.name,
        roster: "",
        shift: "",
    };
    rows.push(crewRow);
    const crewChildren = [];

    for (let i = 0; i < crew.share; i++) {
        const role = crew.name === "Supervision & HSE" ? crew.roles[i % crew.roles.length] : pick(crew.roles);
        const isSupervision = crew.name === "Supervision & HSE";
        const roster = isSupervision ? ROSTERS[i % 2 === 0 ? 0 : 4] : pickWeighted(ROSTERS);

        // Unique, so employee.name also works as the Row field without merging two people.
        let name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        while (usedNames.has(name)) name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        usedNames.add(name);

        const employee = { id: `E${employeeNumber++}`, name };

        for (const assignment of buildAssignments(roster, isSupervision)) {
            rows.push({ ...assignment, parentId: crewTitle, employee, role, crew: crew.name });
            crewChildren.push(assignment);
        }
    }

    setSpan(crewRow, crewChildren);
}

// Row objects hold Dates; serialise them (and derive progress) at write time.
for (const row of rows) {
    row.progress = progressFor(row.start, row.end);
    row.startDate = formatDate(row.start);
    row.endDate = formatDate(row.end);
}

const fields = [
    "title",
    "startDate",
    "endDate",
    "progress",
    "parentId",
    "category",
    "employee",
    "role",
    "crew",
    "roster",
    "shift",
];
const outDir = dirname(fileURLToPath(import.meta.url));

const records = rows.map((row) => Object.fromEntries(fields.map((field) => [field, field in row ? row[field] : ""])));
writeFileSync(join(outDir, "employee-roster.json"), JSON.stringify(records, null, 2) + "\n", "utf8");

// CSV has no nested values, so employee is written as a JSON string in one column.
const csvValue = (row, field) =>
    field === "employee"
        ? row.employee
            ? JSON.stringify({ id: row.employee.id, name: row.employee.name })
            : ""
        : row[field];
const csv = [fields.join(",")]
    .concat(rows.map((row) => fields.map((field) => csvCell(csvValue(row, field))).join(",")))
    .join("\r\n");
writeFileSync(join(outDir, "employee-roster.csv"), csv + "\r\n", "utf8");

const swingCount = rows.filter((row) => row.category === "Day shift" || row.category === "Night shift").length;
const rosterSwitchers = new Set(rows.filter((row) => row.title === "Roster change").map((row) => row.employee.id)).size;
console.log(
    `Wrote ${rows.length} rows (${EMPLOYEE_COUNT} employees, ${swingCount} swings, ` +
        `${rosterSwitchers} on more than one roster) to employee-roster.json and employee-roster.csv in ${outDir}`
);

function buildAssignments(firstRoster, dayShiftOnly) {
    const assignments = [];

    // Most people are on site for the whole period; some mobilise late or
    // demobilise early, which is the churn a site roster actually has to show.
    const mobilise = rng() < 0.12 ? addDays(RANGE_START, 21 + Math.floor(rng() * 90)) : RANGE_START;
    const demobilise = rng() < 0.08 ? addDays(RANGE_START, 100 + Math.floor(rng() * 60)) : RANGE_END;
    const isNewStarter = mobilise > RANGE_START;

    if (isNewStarter) {
        const induction = addDays(mobilise, -1);
        assignments.push(makeRow("Site induction", "Induction", induction, induction, "", firstRoster.code));
    }

    // Some people move to a different roster partway through, with a stand-down
    // between the two. Both land on the same row, so the gap has to read clearly.
    const periods = [{ roster: firstRoster, from: mobilise, to: demobilise }];

    if (!dayShiftOnly && rng() < 0.22) {
        const switchAt = addDays(RANGE_START, 45 + Math.floor(rng() * 75));
        const resumeAt = addDays(switchAt, 10 + Math.floor(rng() * 18));
        let nextRoster = pickWeighted(ROSTERS);
        while (nextRoster === firstRoster) nextRoster = pickWeighted(ROSTERS);

        if (switchAt > mobilise && resumeAt < demobilise) {
            periods[0].to = addDays(switchAt, -1);
            periods.push({ roster: nextRoster, from: resumeAt, to: demobilise });
        }
    }

    const state = {
        swing: 0,
        isNight: !dayShiftOnly && rng() < 0.5,
        leaveSwing: rng() < 0.35 ? 2 + Math.floor(rng() * 6) : -1,
    };

    periods.forEach((period, index) => {
        if (index > 0) {
            // Briefed on the new roster the day before it starts.
            const day = addDays(period.from, -1);
            assignments.push(makeRow("Roster change", "Induction", day, day, "", period.roster.code));
        }

        // Only someone already on site at the start of the range is mid-cycle.
        const isMidCycle = index === 0 && !isNewStarter;
        assignments.push(...buildSwings(period.roster, period.from, period.to, isMidCycle, dayShiftOnly, state));
    });

    assignments.push(...buildOverlappingLeave(assignments));

    return assignments;
}

// Leave that lands on top of a swing instead of replacing it: someone calls in
// sick mid-swing, or takes annual leave that eats the tail of one. The swing
// stays on the roster until it is re-planned, so both records share the row and
// the dates overlap.
function buildOverlappingLeave(assignments) {
    const swings = assignments.filter((row) => row.category === "Day shift" || row.category === "Night shift");
    const leave = [];
    const taken = [];

    // Never twice over the same swing: two leave records on one swing read as a
    // data error rather than as the overlap this sample is meant to show.
    const claim = (swing) => {
        if (taken.includes(swing)) return false;
        taken.push(swing);
        return true;
    };

    if (swings.length >= 3 && leaveRng() < 0.3) {
        // Sick leave, wholly inside a swing of three days or more.
        const swing = swings[1 + Math.floor(leaveRng() * (swings.length - 1))];
        const span = diffDays(swing.start, swing.end) + 1;
        if (span >= 3 && claim(swing)) {
            const days = 1 + Math.floor(leaveRng() * Math.min(3, span - 2));
            const offset = 1 + Math.floor(leaveRng() * (span - days - 1));
            const start = addDays(swing.start, offset);
            leave.push(makeRow("Sick leave", "Leave", start, addDays(start, days - 1), "", swing.roster));
        }
    }

    if (swings.length >= 4 && leaveRng() < 0.22) {
        // Annual leave starting mid-swing and running past its end, so the bar
        // overhangs the swing it overlaps.
        const swing = swings[2 + Math.floor(leaveRng() * (swings.length - 2))];
        const span = diffDays(swing.start, swing.end) + 1;
        if (span >= 4 && claim(swing)) {
            const start = addDays(swing.start, Math.max(1, Math.floor(span / 2)));
            const end = addDays(swing.end, 3 + Math.floor(leaveRng() * 8));
            leave.push(makeRow("Annual leave", "Leave", start, end > RANGE_END ? RANGE_END : end, "", swing.roster));
        }
    }

    return leave;
}

function buildSwings(roster, from, to, isMidCycle, dayShiftOnly, state) {
    const cycle = roster.onDays + roster.offDays;
    const swings = [];
    let cursor = new Date(from);

    if (roster.code === "5/2 Residential") {
        // Snap to Monday so the working week lines up with the calendar.
        while (cursor.getDay() !== 1) cursor = addDays(cursor, 1);
    } else if (isMidCycle) {
        // Stagger crews across the cycle so the site is never empty.
        cursor = addDays(cursor, -Math.floor(rng() * cycle));
    }

    while (cursor <= to) {
        const start = cursor < from ? new Date(from) : cursor;
        let end = addDays(cursor, roster.onDays - 1);
        if (end > to) end = new Date(to);

        if (end >= start) {
            state.swing++;
            if (state.swing === state.leaveSwing) {
                swings.push(makeRow("Annual leave", "Leave", start, end, "", roster.code));
            } else {
                const shift = state.isNight ? "Night" : "Day";
                swings.push(
                    makeRow(`Swing ${state.swing} - ${shift} shift`, `${shift} shift`, start, end, shift, roster.code)
                );
                if (roster.alternateShifts && !dayShiftOnly) state.isNight = !state.isNight;
            }
        }

        cursor = addDays(cursor, cycle);
    }

    return swings;
}

function makeRow(title, category, start, end, shift, roster) {
    return { title, category, shift, start, end, roster };
}

function setSpan(row, children) {
    row.start = new Date(Math.min(...children.map((child) => child.start.getTime())));
    row.end = new Date(Math.max(...children.map((child) => child.end.getTime())));
}

function progressFor(start, end) {
    if (AS_OF > end) return 100;
    if (AS_OF < start) return 0;
    const total = diffDays(start, end) + 1;
    return Math.round(((diffDays(start, AS_OF) + 1) / total) * 100);
}

function csvCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDate(date) {
    // Local-time ISO without a zone, so the control's setHours(0) can't shift
    // a date into the neighbouring day for users west of UTC.
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00`;
}

function parseDate(text) {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function diffDays(a, b) {
    return Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
            86400000
    );
}

function pick(list) {
    return list[Math.floor(rng() * list.length)];
}

function pickWeighted(list) {
    let roll = rng() * list.reduce((sum, item) => sum + item.weight, 0);
    for (const item of list) {
        roll -= item.weight;
        if (roll < 0) return item;
    }
    return list[list.length - 1];
}

function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
