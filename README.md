# PCF Gantt

A reusable Gantt Chart component built using the Power Apps Component Framework (PCF).

This control provides an interactive scheduling experience for Microsoft Power Platform applications, enabling users to visualize, plan, and manage timelines directly within Model-Driven Apps and Canvas Apps.

## Current implementation

The control is a **virtual (React) PCF control** that renders with Fluent UI v9 supplied
by the Power Apps platform, so it inherits the host's theme automatically — light, dark
and high contrast, in both model-driven and canvas apps.

- `control-type="virtual"`, with React 16.14 and Fluent 9.46.2 declared as
  `<platform-library>` entries. Neither is bundled: the shipped `bundle.js` is ~100 KB.
- All colour, spacing, typography and motion come from Fluent design tokens via
  Griffel (`makeStyles`). There is no stylesheet and no hard-coded palette, which is
  what keeps the control in step with the host theme.
- The theme is read from `context.fluentDesignLanguage.tokenTheme` and applied through
  `FluentProvider`.

### What works today

| Area          | Behaviour                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density       | **Detailed** and **Compact** modes, switchable from the toolbar or preset by a maker property. Detailed adds Start, Finish and Progress columns and taller rows.                                               |
| Time scale    | Day, week and month zoom levels, plus **Fit to width**.                                                                                                                                                        |
| Hierarchy     | `fields.parent` builds a task tree with expand/collapse. Parent rows show a summary bracket spanning their children and a duration-weighted rolled-up progress.                                                |
| Groups        | `fields.group` gathers rows under a heading per value (a crew, a department) without any heading records in the data.                                                                                          |
| Merged rows   | With `fields.row` set, many records share one row as separate bars. Clicking a bar selects that record; clicking the row selects the whole row.                                                                |
| Status        | Bars are coloured on track / at risk / overdue / complete / not started, derived from progress against elapsed time.                                                                                           |
| Colours       | Or colour by any field instead, with your own colours and legend labels — see [Colours and the legend](#colours-and-the-legend).                                                                               |
| Toolbar       | Fluent `Toolbar` with search, collapse-all, today, zoom, fit and density controls.                                                                                                                             |
| Data          | Dataset paging is loaded progressively as the user scrolls, so the chart is not limited to the first page.                                                                                                     |
| Performance   | Rows are windowed, so only the visible slice is rendered.                                                                                                                                                      |
| Editing       | Drag a bar to reschedule it, or drag either end to resize it. Off by default, and `fields.locked` exempts individual records; the control publishes each edit and your app saves it — see [Editing](#editing). |
| Rosters       | Outlined bars with labels and count badges, week numbers, a team column, leave as icons, availability as tints, clashes flagged, and an unallocated pool. See [Roster view](#roster-view).                     |
| Accessibility | Grid semantics, a keyboard-resizable splitter, a roving tab stop, and Fluent tooltips on every bar.                                                                                                            |

### Properties

| Property                 | Type          | Purpose                                                                                                    |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `tasks`                  | Dataset       | The task records.                                                                                          |
| `start` / `end`          | Text          | Optional timeline boundary, as a date such as `2026-01-01`. Blank uses the earliest and latest task dates. |
| `fields` (Field mapping) | Text (JSON)   | Which columns the chart reads. See [Field mapping](#field-mapping).                                        |
| `options` (Options)      | Text (JSON)   | How the chart looks and what a user may do. See [Options](#options).                                       |
| `selectedTaskId`         | Text (output) | The selected task; selection is also pushed to the host.                                                   |
| `selectedRowId`          | Text (output) | The selected row: the group value for a group heading, the row id for a merged row, else the task id.      |
| `lastEdit`               | Text (output) | The last move or resize as JSON, for your app to save. See [Editing](#editing).                            |

A newly added control starts with both settings filled in with every key at its default, as a template to
edit. Both are optional all the same, and so is every entry in them: leave one out, or clear the setting,
and its default applies. A
setting the control cannot use — broken JSON, a misspelt key, a value it does not know — is named in a
warning bar above the chart, and the default applies in its place.

In a canvas app, build the text with `JSON()` rather than typing escaped quotes:

```
JSON({ task: "name", start: "startDate", end: "endDate", group: "crew",
       row: { id: "employee.id", label: "employee.name" } })
```

In a model-driven app, type the JSON straight into the property.

#### Field mapping

| Key        | Default     | Reads                                                                                                                                                                                |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task`     | `title`     | The task label. `{ "id": "code", "label": "name" }` also names the column that identifies a task, which `selectedTaskId` and `lastEdit` then carry; without one, the record id does. |
| `start`    | `startDate` | The start date. Records without both dates are skipped.                                                                                                                              |
| `end`      | `endDate`   | The end date.                                                                                                                                                                        |
| `progress` | `progress`  | Progress, clamped to 0–100.                                                                                                                                                          |
| `parent`   | `parentId`  | A parent reference, matched against the task id and then the task title.                                                                                                             |
| `group`    | —           | A heading row per value, with every top-level row under it. A task with a parent stays under its parent. Records with no value go under **(No value)**, last.                        |
| `row`      | —           | Records sharing a value are drawn as separate bars on one row — e.g. every roster swing for an employee. The row nests under the first parent its records name.                      |
| `category` | —           | A label shown in the tooltip.                                                                                                                                                        |
| `color`    | —           | The value each bar is coloured by when `options.colorBy` is `field`. Falls back to `category`.                                                                                       |
| `locked`   | —           | A column marking records that may not be rescheduled. See [Locking individual tasks](#locking-individual-tasks).                                                                     |
| `label`    | —           | Text on each bar: a column, or a template such as `{role} · {job}`. A blank placeholder takes its separator with it.                                                                 |
| `quantity` | —           | A number shown as a badge on bars standing for more than one, e.g. a shift needing 5 people.                                                                                         |
| `subtitle` | —           | A second line under the row title, e.g. a role.                                                                                                                                      |
| `image`    | —           | A picture for the row avatar, with `options.showAvatars`. Initials are used without one.                                                                                             |
| `icon`     | —           | For records a display rule draws as an icon: the icon to show, when the record names its own.                                                                                        |

`task`, `group` and `row` take either a column name, or `{ "id": ..., "label": ... }` to key by one column
and show another — e.g. `"row": { "id": "employee.id", "label": "employee.name" }`, so two people sharing a
name stay on separate rows. A plain name for `group` or `row` does both jobs.

Every column name accepts `lookup.column`, e.g. `resource.name`, to read a column from the table a lookup
points at. It is resolved in order: a column literally named that (e.g. a flattened `resource.name`); a
matching related column in the view; otherwise the property read off the lookup or record value itself
(`resource.name`, `resource.id`) — including text holding a JSON object, such as a CSV column
`{"id":"E1001","name":"Aroha Patel"}` in the test harness — falling back to its display value. Only one level
is read, so flatten deeper paths in the app first. To show another related column in a model-driven app, add
it to the view.

**How dates are read.** A date-and-time column arrives as an instant and is drawn in the viewer's
timezone. Text with no zone on it (`2026-09-20T09:00:00`) is read as UTC, the way Dataverse stores
such a value: read as local it would be pulled away from the column values around it, and a shift
stored 00:00–08:30 would draw hours too long. Text carrying a zone (`...Z`, `...+08:00`) is honoured as
written. A value with no time of day at all — a Dataverse **Date Only** column, or text such as
`2026-09-20` — names a calendar date rather than an instant, so it stays on that date in every
timezone. Zoneless text spelled out to midnight at both ends (`2026-09-17T00:00:00` to
`2026-09-17T00:00:00`) is an all-day record written out in full, and is read the same way; a midnight
whose partner carries a time of day (`00:00:00` to `08:30`) is still an instant, so the shift keeps
its length.

**Where a task finishes.** An end carrying a time of day is the instant the task stops, so an end of
the 31st at midnight finishes on the 30th — that is the date the tooltip and the **Finish** column
name, rather than a midnight the bar never reaches. An end with no time of day is inclusive of its
whole day and stands as written.

A mapping you set that matches no column is named in a warning bar, along with the columns the dataset does
have.

#### Options

| Key               | Default       | Does                                                                                                                 |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `density`         | `comfortable` | Initial density: `comfortable` (Detailed) or `compact`.                                                              |
| `timeScale`       | `day`         | Initial zoom: `day`, `week` or `month`.                                                                              |
| `timeZone`        | `local`       | Which clock times are read on to start with: `local` or `utc`.                                                       |
| `colorBy`         | `status`      | `status` for the built-in time-based scheme, or `field` to colour by `fields.color`.                                 |
| `legend`          | —             | Your own colours and legend labels. See [Colours and the legend](#colours-and-the-legend).                           |
| `showToolbar`     | `true`        | The toolbar with search, filter chips, zoom and density.                                                             |
| `showCurrentTime` | `true`        | The marker for the current time.                                                                                     |
| `showProgress`    | `true`        | Progress fills on bars and the progress column.                                                                      |
| `showLegend`      | `true`        | The legend along the bottom.                                                                                         |
| `useTimeOfDay`    | `true`        | Places each bar at its start and end times inside the day. Off fills every day a record touches.                     |
| `groupRows`       | `true`        | Merges records sharing a `fields.row` value onto one row. Off gives every record its own row.                        |
| `allowMove`       | `false`       | Lets a user drag a bar along the timeline. See [Editing](#editing).                                                  |
| `allowResize`     | `false`       | Lets a user drag either end of a bar.                                                                                |
| `showSettings`    | `false`       | Shows the settings button. For makers only — see [The settings panel](#the-settings-panel).                          |
| `barStyle`        | `filled`      | `filled`, or `outlined` for white bars with a coloured edge and a label.                                             |
| `showAvatars`     | `false`       | An avatar before each row title.                                                                                     |
| `columns`         | —             | The task list columns. See [Task list columns](#task-list-columns).                                                  |
| `display`         | —             | Rules for drawing records as icons, tints, the unallocated pool, or not at all. See [Display rules](#display-rules). |
| `poolTitle`       | `Unallocated` | Heading for the unallocated pool.                                                                                    |

Density, time scale and time zone are only where the chart starts: the toolbar changes them after that.

#### Local time and UTC

Dataverse stores a Date and Time column as an instant, and the chart draws it on the viewer's own clock — so a
shift saved as 01:00 UTC reads as 09:00 in Perth. The globe button in the toolbar switches the whole chart
between that clock and UTC: the bars, the ticks, the tooltips, the today column and the current-time marker all
move together, so a roster spread across sites can be read in one shared clock. Nothing is written back
differently — a bar dragged while UTC is shown still publishes the instant the user left it at.

A Date Only column names a calendar date rather than an instant, and a date stands in every zone, so records on
date-only columns sit where they are on both clocks.

Only the day scale is fine enough to read an hour off a column, so `useTimeOfDay` changes nothing at week or month
zoom: there a bar always spans the whole days it touches. Turn it off where the times on a record say something
other than when the work runs, e.g. a leave record stamped at the moment it was approved, which would otherwise
start its bar partway through the day.

A day two of a row's records land on is the exception, since filled out to whole days those bars would cover each
other. Where their hours are clear of each other the day is shared out instead: the earlier bar keeps the start it
had and gives up the rest of the day at the hour the next record starts, which runs from there to the end of the
day or to the record after it in turn. So a morning shift handed over at 13:00 fills the day up to 13:00, and the
afternoon shift fills the rest of it. Records whose hours genuinely overlap have no hour to hand over at, so they
keep their whole days and stack as before, and a day with one record on the row still fills.

#### The settings panel

Rather than writing the JSON by hand, set `"showSettings": true` in Options while you build the app. A
settings button then appears at the end of the toolbar (or in the status bar when the toolbar is hidden) and
opens a panel with every field and option:

- Column pickers list the dataset's own columns, and take a typed `lookup.column` too. A name that matches no
  column is flagged as you type.
- Every change is drawn on the chart straight away, from the data it already has, and a banner says the chart
  is previewing unsaved settings.
- A control cannot save its own properties, so the panel writes both settings out at the bottom — as JSON for
  a model-driven app, or as a `JSON({...})` formula for a canvas app — with a button to copy each one. Paste
  them into Field mapping and Options; once a property holds the new value, the preview of it ends by itself.
  **Discard** on the banner drops the preview instead.

Turn `showSettings` off again before the app goes to users: the canvas runtime gives a control no reliable way
to tell the studio from a published app, so the button is shown wherever the option is on.

### Colours and the legend

Out of the box, bars are coloured by the built-in time-based status and the legend names those five states. Neither is fixed: `options.colorBy` decides what the colour means, and `options.legend` decides which colours and labels are used.

**Colour by a field.** Set `options.colorBy` to `field` and point `fields.color` at the column whose value should pick the colour — a shift type, a discipline, a workflow state. With no `options.legend`, the control hands out its own palette as values appear and builds the legend from them, so `colorBy` alone is enough to get started. `fields.color` falls back to `fields.category`, so a chart already grouped by category needs nothing else. Values past the twentieth share the catch-all swatch, which keeps the legend readable when the column has high cardinality.

**Name the colours yourself.** `options.legend` takes either a shorthand string or JSON written straight into the options — whichever is easier to write in the host:

```
Day shift = #0F6CBD; Night shift = #5C2E91; Leave = #C19C00; * = #8A8886
```

```json
[
    { "value": "Day shift", "color": "#0F6CBD" },
    { "value": "Night shift", "label": "Nights", "color": "#5C2E91" },
    { "value": "*", "label": "Everything else", "color": "#8A8886" }
]
```

```json
{ "Day shift": "#0F6CBD", "Night shift": { "label": "Nights", "color": "#5C2E91" } }
```

- Values are matched ignoring case and surrounding space; `label` names the swatch when it should read differently from the stored value.
- `*` (or `default`, `other`) colours everything the other entries did not match. Without one, unmatched bars go grey under an **Other** swatch.
- Colours may be hex, `rgb()`, `hsl()` or a CSS colour keyword. An entry whose colour the browser would not take is dropped on its own, so one typo costs one swatch rather than the whole legend.
- A bar's progress fill is the colour itself, on a faint wash of it; hex and `rgb()` are the colours that wash cleanly.

**Recolour the built-in statuses.** With `options.colorBy` left at `status`, entries naming a status — `On track`, `At risk`, `Overdue`, `Complete`, `Not started` — recolour and rename it, and anything else in the legend is ignored:

```
Overdue = #B10E1C; At risk = #F7630C; Complete = #0F7B0F
```

Set `options.showLegend` off to keep the colours but drop the legend from the status bar.

Clicking a swatch filters the chart to bars of that colour; each colour picked shows as a chip in the toolbar, where it can be removed.

### Roster view

A resource roster in the style of a workforce scheduler is these settings together:

```
Field mapping
{ "row": "employee", "group": "team", "subtitle": "role",
  "label": "{role} · {job}", "quantity": "headcount", "category": "resourceType" }

Options
{ "barStyle": "outlined", "showProgress": false, "showAvatars": true,
  "columns": [{ "name": "@group", "label": "Team" }, { "name": "@name", "label": "Resource" }],
  "poolTitle": "Unallocated shifts",
  "display": [
      { "when": { "status": "Cancelled" }, "as": "hide" },
      { "when": { "type": ["Annual Leave", "AL"] }, "as": "icon", "icon": "plane", "color": "#C4314B", "blocks": true },
      { "when": { "type": "RDO" }, "as": "icon", "icon": "home", "blocks": true },
      { "when": { "travel": "Flight in" }, "as": "icon", "icon": "flight-in" },
      { "when": { "travel": "Flight out" }, "as": "icon", "icon": "flight-out" },
      { "when": { "type": "Available" }, "as": "tint", "color": "#6BB700" },
      { "when": { "employee": { "blank": true } }, "as": "pool" }
  ] }
```

On the day scale the header shows the month, the ISO week number, and each day with its weekday, with today in
a dark box and a dashed line down the chart. A dashed rule marks the start of each week. A bar running past a
`start` or `end` boundary is cut off there and shows `‹` or `›`.

#### Display rules

Data from Dataverse rarely has a column that says how the chart should draw a record, so `options.display`
decides from the columns the records already have. Rules are tried in order and the first match wins. A record
no rule matches is a plain bar, so a new or misspelt value shows up looking wrong rather than disappearing.

| `as`   | Draws the record                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| `bar`  | As a bar. Useful with `color` to recolour some bars.                                                                  |
| `icon` | As an icon in each day it covers (one in the middle on the week and month scales). Several on a day sit side by side. |
| `tint` | As a tint behind the days it covers, e.g. availability.                                                               |
| `pool` | As a bar in the unallocated pool, packed into as few rows as fit, above everything else.                              |
| `hide` | Not at all. It cannot be selected either.                                                                             |

`when` holds one condition per column, and every one must hold. Values are compared trimmed and ignoring case:

| Condition                          | Matches                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `"AL"` or `["AL", "Annual Leave"]` | The value, or any value in the list.                                                                             |
| `{ "contains": "leave" }`          | Part of the value. `startsWith` does the same for the beginning.                                                 |
| `{ "blank": true }`                | No value.                                                                                                        |
| `{ "value": 2 }`                   | The raw value: a choice column's number, which survives its label being renamed or translated, or a lookup's id. |
| `{ "not": ... }`                   | Anything the condition inside does not.                                                                          |

`icon` names a built-in icon (plane, flight-in, flight-out, helicopter, helicopter-in, helicopter-out, home, sick, training, car,
bus, clock, lock, star, check, cross, warning, flag, person, calendar, dot); anything else is drawn as short text. `color` sets the icon, tint or bar colour.
`blocks: true` marks unavailable time: a bar on the same row overlapping it is hatched, and the row gets a
warning flag.

**The value mapper.** Under **Display** in the settings panel, pick a column and every value in the loaded
records is listed with its count, to draw as a bar, icon, tint, the pool, or not at all. It writes the rules for
you and keeps any rule you wrote by hand. While `showSettings` is on, a notice lists values of a column mapped to
icons or tints that no rule covers.

**When a rule is not enough.** If deciding needs dates, several tables or more than a few conditions, add a
Dataverse formula column that works out a short code (`leave`, `rdo`, `shift`) and map that. It works the same in
model-driven and canvas apps and keeps the logic in one place. Avoid `AddColumns` in a canvas app for this: the
query is then no longer delegated, so only the first rows reach the chart.

A column a rule names must come with the dataset. In a model-driven app the control asks for a plain column the
view lacks by itself; a related column has to be added to the view. In a canvas app, add it under Fields.

#### Task list columns

`options.columns` replaces the built-in Task, Start, Finish and Progress columns:

- `"view"`: the name column, then every column in the view, in the view's order.
- A list, such as `["@group", { "name": "@name", "label": "Resource", "width": 200 }, "role", "crew.name"]`.
  Built-in columns start with `@` (`@name`, `@group`, `@start`, `@end`, `@progress`); anything else is a dataset
  column, shown with its formatted value. `label` and `width` are optional.

`@group` shows groups as a column down the left, labelled once over their rows, instead of as heading rows. The
name column is always there, as it holds the tree. Users can hide columns from the toolbar's column menu, and the
choice is remembered in their browser.

### Editing

Two gestures can be turned on, each on its own: `options.allowMove` drags a whole bar along the
timeline, and `options.allowResize` drags either end of it. Both default to **off**, so nothing about an
existing chart changes until you ask for it. Creating and deleting records are left to the app.

**The control never writes to your data.** It publishes what the user did and your app saves
it. That is what keeps the same control working in a canvas app and a model-driven one, and it
leaves the business rules — who may reschedule what, what else has to change with it — where
they belong.

Every edit arrives as one property, `lastEdit`, holding JSON:

```json
{
    "stamp": 1,
    "action": "move",
    "taskId": "T-1",
    "title": "Mobilisation",
    "start": "2026-09-20T09:00:00+08:00",
    "end": "2026-09-27T17:00:00+08:00"
}
```

| Key      | Holds                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `stamp`  | Counts edits. It changes every time, so dragging a bar back where it came from still reads as a change.    |
| `action` | `move` or `resize`.                                                                                        |
| `taskId` | The task that was edited — the same value `selectedTaskId` carries, so your ID field rather than the GUID. |
| `title`  | Its label, so a confirmation message needs no second lookup.                                               |
| `start`  | The new start, ISO 8601 in local time with its offset.                                                     |
| `end`    | The new end, the same way.                                                                                 |

In a canvas app, handle the control's `OnChange`:

```
With(
    { edit: ParseJSON(GanttChart1.lastEdit) },
    Switch(
        Text(edit.action),
        "move",
        Patch(Tasks, LookUp(Tasks, id = Text(edit.taskId)), {
            startDate: DateTimeValue(Text(edit.start)),
            endDate: DateTimeValue(Text(edit.end))
        }),
        "resize",
        Patch(Tasks, LookUp(Tasks, id = Text(edit.taskId)), {
            startDate: DateTimeValue(Text(edit.start)),
            endDate: DateTimeValue(Text(edit.end))
        })
    )
)
```

Both actions save the same two columns, so a real app usually skips the `Switch` and patches
once — it is there because `action` is what you branch on when a move and a resize should mean
different things, such as only a resize needing re-approval.

`OnChange` also fires for a selection, and `lastEdit` keeps the last edit it published, so compare
`stamp` against a variable if you need to act exactly once per edit. `lastEdit` is blank until the
first one.

**Dates.** `start` and `end` are written in local time with the offset attached
(`2026-09-20T09:00:00+08:00`) rather than normalised to UTC. A date-only task sits at local
midnight, and a UTC instant would report it as the previous day anywhere east of UTC — the bar
would look as though it had landed a day early. `DateTimeValue` reads the offset form correctly,
and `Left(Text(edit.start), 10)` gives the plain date for a date-only column.

**What the user sees while that happens.** The edit is drawn straight away — the bar sits at its
new dates, marked with a dashed outline until it settles. It settles as soon as the records come
back changed, whichever way your save went. If nothing is
wired up to save, the chart gives up after about eight seconds and returns to what the data
still says — so a chart with the gestures on but no `OnChange` behind them looks like it is
refusing the edit, rather than quietly losing it.

**The gestures in detail.**

- Edits snap to whole days at every zoom, and a task keeps its time of day across a move: a
  09:00–17:00 shift dragged two days along is still 09:00–17:00.
- Escape during a drag abandons it. The tooltip follows the pointer and names the dates the bar
  will land on, so a drag can be read before it is let go.
- Resizing cannot pull one end past the other; a task can be a single day, never less.
- A rolled-up parent bar is never movable or resizable — its span is its children's, so there is
  nothing to write back.
- On a merged row each bar is its own record and moves on its own.

#### Locking individual tasks

The two `allow*` options decide what a user may do to the chart. `fields.locked` decides which
records are exempt: point it at a column, and any record whose value reads as "yes" cannot be
moved or resized — no drag grips and no grab cursor. Everything else on the chart stays
editable.

A record is read as locked unless its value is blank, `false`, `no`, `n`, `0`, `off` or
`unlocked`, compared ignoring case and surrounding space. That takes a Dataverse two-options
column, a whole number, and free text alike; for a choice column it means any value at all locks
the record, which suits a column naming the reason ("Approved", "Invoiced", "Signed off").

Locked records stay fully selectable, openable and searchable — a lock is about writing, not
reading — and their bars say so in the tooltip and to a screen reader, but only when something on
the chart is draggable in the first place. On a merged row each bar carries its own lock, so one
signed-off swing can be frozen while the rest of the row still moves.

Everything below this point is the intended roadmap rather than shipped behaviour.

---

## Key Features

### Timeline Management

- Display tasks across configurable date ranges
- Day, Week, Month, Quarter and Year views
- Dynamic time scaling
- Zoom in and zoom out support
- Configurable working calendars

### Task Operations

- Create tasks
- Delete tasks
- Edit task details
- Move multiple tasks at once
- Inline editing

### Dependencies

- Finish-to-Start
- Start-to-Start
- Finish-to-Finish
- Start-to-Finish

### Resource Planning

- Resource assignment
- Resource grouping
- Capacity visualization
- Resource utilization views

### Visual Features

- Milestones
- Critical path visualization
- Baseline comparison
- Progress indicators
- Custom color rules
- Conditional formatting

### Power Platform Integration

- Dataverse integration
- Canvas Apps support
- Model-Driven Apps support
- External API integration through Power Platform connectors

---

## Typical Use Cases

### Workforce Rostering

- Staff scheduling
- Shift planning
- Resource allocation

### Project Management

- Task planning
- Program management
- Portfolio management

### Operations Planning

- Maintenance scheduling
- Asset planning
- Capacity management

### Service Delivery

- Project delivery
- Professional services
- Field operations

---

## Architecture

```text
Power Apps
      │
      ▼
┌─────────────────┐
│   PCF Gantt     │
└─────────────────┘
      │
      ▼
 Data Provider
      │
      ▼
 Dataverse / API
```
