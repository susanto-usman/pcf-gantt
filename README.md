# PCF Gantt

A reusable Gantt Chart component built using the Power Apps Component Framework (PCF).

This control provides an interactive scheduling experience for Microsoft Power Platform applications, enabling users to visualize, plan, and manage timelines directly within Model-Driven Apps and Canvas Apps.

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
