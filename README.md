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

A mapping you set that matches no column is named in a warning bar, along with the columns the dataset does
have.

#### Options

| Key               | Default       | Does                                                                                          |
| ----------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `density`         | `comfortable` | Initial density: `comfortable` (Detailed) or `compact`.                                       |
| `timeScale`       | `day`         | Initial zoom: `day`, `week` or `month`.                                                       |
| `colorBy`         | `status`      | `status` for the built-in time-based scheme, or `field` to colour by `fields.color`.          |
| `legend`          | —             | Your own colours and legend labels. See [Colours and the legend](#colours-and-the-legend).    |
| `showToolbar`     | `true`        | The toolbar with search, filter chips, zoom and density.                                      |
| `showCurrentTime` | `true`        | The marker for the current time.                                                              |
| `showProgress`    | `true`        | Progress fills on bars and the progress column.                                               |
| `showLegend`      | `true`        | The legend along the bottom.                                                                  |
| `groupRows`       | `true`        | Merges records sharing a `fields.row` value onto one row. Off gives every record its own row. |
| `allowMove`       | `false`       | Lets a user drag a bar along the timeline. See [Editing](#editing).                           |
| `allowResize`     | `false`       | Lets a user drag either end of a bar.                                                         |
| `showSettings`    | `false`       | Shows the settings button. For makers only — see [The settings panel](#the-settings-panel).   |

Density and time scale are only where the chart starts: the toolbar changes them after that.

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
- **Apply** skips the pasting in a canvas app. It publishes both settings through the `draftFields` and
  `draftOptions` outputs and fires `OnChange`; the app stores them and reads the properties back from the store.

**Saving with Apply in a canvas app.** A property cannot read the control's own output — that is a circular
reference — so the settings go through a table, which also keeps them across sessions. With a `GanttSettings`
table holding `Name`, `Fields` and `Options` text columns:

```
// OnChange of the control. OnChange also fires for selections and edits, so only save a change.
With(
    { saved: LookUp(GanttSettings, Name = "Roster") },
    If(
        !IsBlank(Self.draftFields) &&
            (Self.draftFields <> saved.Fields || Self.draftOptions <> saved.Options),
        Patch(GanttSettings, saved, { Fields: Self.draftFields, Options: Self.draftOptions })
    )
)

// Field mapping
LookUp(GanttSettings, Name = "Roster").Fields

// Options
LookUp(GanttSettings, Name = "Roster").Options
```

Once the properties pick up the stored values, the preview ends by itself: the chart is showing the saved
settings. The settings can then change without republishing the app. A model-driven form cannot take its
properties from data, so there the panel's Copy buttons remain the way to save.

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
