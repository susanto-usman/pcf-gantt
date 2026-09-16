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

| Area          | Behaviour                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Density       | **Detailed** and **Compact** modes, switchable from the toolbar or preset by a maker property. Detailed adds Start, Finish and Progress columns and taller rows.               |
| Time scale    | Day, week and month zoom levels, plus **Fit to width**.                                                                                                                        |
| Hierarchy     | `parentField` builds a task tree with expand/collapse. Parent rows show a summary bracket spanning their children and a duration-weighted rolled-up progress.                  |
| Merged rows   | With `rowField` set and `groupRows` on, many records share one row as separate bars. Clicking a bar selects that record; clicking the row selects its current or next segment. |
| Status        | Bars are coloured on track / at risk / overdue / complete / not started, derived from progress against elapsed time.                                                           |
| Colours       | Or colour by any field instead, with your own colours and legend labels — see [Colours and the legend](#colours-and-the-legend).                                               |
| Toolbar       | Fluent `Toolbar` with search, collapse-all, today, zoom, fit and density controls.                                                                                             |
| Data          | Dataset paging is loaded progressively as the user scrolls, so the chart is not limited to the first page.                                                                     |
| Performance   | Rows are windowed, so only the visible slice is rendered.                                                                                                                      |
| Accessibility | Grid semantics, a keyboard-resizable splitter, a roving tab stop, and Fluent tooltips on every bar.                                                                            |

### Properties

| Property                                                          | Type         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`                                                           | Dataset      | The task records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `titleField` / `startField` / `endField`                          | Text         | Column names for the task label and its dates. Records without both dates are skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| _(any field setting)_                                             | Text         | Accepts `lookup.column`, e.g. `resource.name`, to read a column from the table a lookup points at. Resolved in order: a column literally named that (e.g. a flattened `resource.name`); a matching related column in the view; otherwise the property read off the lookup or record value itself (`resource.name`, `resource.id`) — including text holding a JSON object, such as a CSV column `{"id":"E1001","name":"Aroha Patel"}` in the test harness — falling back to its display value. To show another related column in a model-driven app, add it to the view. |
| `progressField`                                                   | Text         | Column holding progress, clamped to 0–100.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `parentField`                                                     | Text         | Parent reference, matched against the record id and then the task title.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `rowField`                                                        | Text         | Optional. With `groupRows` on, records sharing a value are drawn as separate bars on one row labelled with that value — e.g. every roster swing for an employee, with gaps for days off. The row nests under the first parent its records name.                                                                                                                                                                                                                                                                                                                         |
| `rowTitleField`                                                   | Text         | Optional. Labels a grouped row, so rows can be grouped by one value and shown by another — e.g. `rowField` `employee.id` with `rowTitleField` `employee.name`, so two people sharing a name stay on separate rows. Falls back to the `rowField` value.                                                                                                                                                                                                                                                                                                                  |
| `categoryField`                                                   | Text         | Optional grouping label shown in the tooltip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `colorField`                                                      | Text         | Optional. The value each bar is coloured by when `colorMode` is `field`. Falls back to `categoryField`, so colouring by category needs no second setting.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `colorMode`                                                       | Enum         | `status` (default) for the built-in time-based scheme, or `field` to colour by the colour field's value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `colorLegend`                                                     | Text         | Your own colours and legend labels. See [Colours and the legend](#colours-and-the-legend).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `density`                                                         | Enum         | Initial density: `comfortable` (Detailed) or `compact`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `timeScale`                                                       | Enum         | Initial zoom: `day`, `week` or `month`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `showToolbar` / `showCurrentTime` / `showProgress` / `showLegend` | Boolean      | Feature toggles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `groupRows`                                                       | Boolean      | Merges records sharing a `rowField` value onto one row (default on). Off gives every record its own row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `selectedTaskId`                                                  | Text (bound) | Outputs the selected task; selection is also pushed to the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Colours and the legend

Out of the box, bars are coloured by the built-in time-based status and the legend names those five states. Neither is fixed: `colorMode` decides what the colour means, and `colorLegend` decides which colours and labels are used.

**Colour by a field.** Set `colorMode` to `field` and point `colorField` at the column whose value should pick the colour — a shift type, a discipline, a workflow state. With no `colorLegend`, the control hands out its own palette as values appear and builds the legend from them, so `colorMode` alone is enough to get started. `colorField` falls back to `categoryField`, so a chart already grouped by category needs nothing else. Values past the twentieth share the catch-all swatch, which keeps the legend readable when the column has high cardinality.

**Name the colours yourself.** `colorLegend` takes either JSON or a shorthand — whichever is easier to write in the host:

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

**Recolour the built-in statuses.** With `colorMode` left at `status`, entries naming a status — `On track`, `At risk`, `Overdue`, `Complete`, `Not started` — recolour and rename it, and anything else in the legend is ignored:

```
Overdue = #B10E1C; At risk = #F7630C; Complete = #0F7B0F
```

Set `showLegend` off to keep the colours but drop the legend from the status bar.

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
- Edit task details
- Drag and drop task scheduling
- Resize task duration
- Move multiple tasks
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
