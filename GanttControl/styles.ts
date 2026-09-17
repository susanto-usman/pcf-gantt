import { makeStyles, shorthands, tokens, typographyStyles } from "@fluentui/react-components";

/**
 * Fixed widths of the trailing columns in the task list, needed by the chart to
 * work out how much room the task name actually has. Keep these in sync with
 * `listCellDate`, `listCellProgress` and `listCellProgressCompact` below —
 * Griffel rules must stay literal so they remain statically analysable.
 */
export const LIST_COLUMN_WIDTHS = {
    date: 72,
    progress: 88,
    progressCompact: 44,
};

/**
 * Everything in the name cell that is not the name itself: the chevron and its
 * gap, the cell's inline padding at both ends, and the pane's right border.
 */
export const NAME_CELL_CHROME = 44;

/** The task name never shrinks below this; indentation gives way instead. */
export const MIN_NAME_TEXT_WIDTH = 96;

/**
 * Sizing that changes with density or zoom is passed in as CSS custom
 * properties, since Griffel rules must be statically analysable.
 */
export const cssVars = {
    rowHeight: "--gantt-row-height",
    barHeight: "--gantt-bar-height",
    columnWidth: "--gantt-column-width",
    listWidth: "--gantt-list-width",
    timelineWidth: "--gantt-timeline-width",
} as const;

export const useGanttStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: "100%",
        // Stops a flex host from sizing the control to the timeline's content.
        minWidth: 0,
        height: "100%",
        // The host does not always allocate a height; without a floor the
        // control would collapse to nothing.
        minHeight: "320px",
        boxSizing: "border-box",
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },

    toolbar: {
        flexShrink: 0,
        justifyContent: "space-between",
        columnGap: tokens.spacingHorizontalS,
        paddingInline: tokens.spacingHorizontalS,
        paddingBlock: tokens.spacingVerticalXS,
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        // Filter chips can outgrow one line; the controls wrap under them rather than being clipped.
        flexWrap: "wrap",
        rowGap: tokens.spacingVerticalXS,
    },
    toolbarGroup: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: tokens.spacingHorizontalXXS,
        rowGap: tokens.spacingVerticalXS,
        minWidth: 0,
    },
    searchBox: {
        maxWidth: "220px",
    },
    filterChips: {
        flexWrap: "wrap",
        columnGap: tokens.spacingHorizontalXS,
        rowGap: tokens.spacingVerticalXXS,
        marginInlineStart: tokens.spacingHorizontalS,
    },

    /**
     * Single scroll container for both panes: the task list is held in place
     * with `position: sticky`, so the two axes stay in sync without any
     * scroll-event plumbing.
     */
    scrollArea: {
        position: "relative",
        flexGrow: 1,
        overflow: "auto",
        // Firefox
        scrollbarWidth: "thin",
        "::-webkit-scrollbar": { width: "10px", height: "10px" },
        "::-webkit-scrollbar-thumb": {
            backgroundColor: tokens.colorNeutralStroke1,
            borderRadius: tokens.borderRadiusCircular,
            border: `2px solid ${tokens.colorNeutralBackground1}`,
        },
        "::-webkit-scrollbar-track": { backgroundColor: "transparent" },
    },
    grid: {
        display: "flex",
        flexDirection: "column",
        width: "fit-content",
        minWidth: "100%",
    },

    headerRow: {
        display: "flex",
        position: "sticky",
        top: 0,
        zIndex: 4,
        backgroundColor: tokens.colorNeutralBackground1,
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    row: {
        display: "flex",
        position: "relative",
        height: `var(${cssVars.rowHeight})`,
        ":hover .gantt-list-cell": { backgroundColor: tokens.colorNeutralBackground1Hover },
        ":hover .gantt-track": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    /**
     * Two states, and they must not read alike: the row the user picked carries
     * a brand wash and an accent edge, while a row holding the selected bar is
     * only tinted, so it reads as "the selection is in here".
     */
    rowSelected: {
        ":hover .gantt-list-cell": { backgroundColor: tokens.colorBrandBackground2Hover },
        ":hover .gantt-track": { backgroundColor: tokens.colorBrandBackground2Hover },
    },
    rowHighlighted: {
        ":hover .gantt-list-cell": { backgroundColor: tokens.colorNeutralBackground1Selected },
        ":hover .gantt-track": { backgroundColor: tokens.colorNeutralBackground1Selected },
    },

    /** Left pane -------------------------------------------------------- */
    listPane: {
        position: "sticky",
        left: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "stretch",
        flexShrink: 0,
        width: `var(${cssVars.listWidth})`,
        boxSizing: "border-box",
        backgroundColor: tokens.colorNeutralBackground1,
        borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    listPaneHeader: {
        zIndex: 5,
    },
    listCell: {
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        minWidth: 0,
        height: "100%",
        paddingInline: tokens.spacingHorizontalS,
        backgroundColor: tokens.colorNeutralBackground1,
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    },
    listCellRowSelected: {
        backgroundColor: tokens.colorBrandBackground2,
    },
    /** The accent edge, drawn inside the name cell so it rides the sticky pane. */
    listCellAccent: {
        "::before": {
            content: '""',
            position: "absolute",
            insetInlineStart: 0,
            top: 0,
            bottom: 0,
            width: "3px",
            backgroundColor: tokens.colorBrandStroke1,
        },
    },
    listCellSelected: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    listCellName: {
        position: "relative",
        flexGrow: 1,
        // flexBasis 0 makes the name take the leftover space rather than its
        // content width, so the fixed columns cannot squeeze it out entirely.
        flexBasis: 0,
        minWidth: "90px",
        columnGap: tokens.spacingHorizontalXXS,
    },
    // Widths here are mirrored by LIST_COLUMN_WIDTHS above.
    listCellDate: {
        width: "72px",
        flexShrink: 0,
        justifyContent: "flex-end",
        color: tokens.colorNeutralForeground3,
        ...typographyStyles.caption1,
        fontVariantNumeric: "tabular-nums",
    },
    listCellProgress: {
        width: "88px",
        flexShrink: 0,
        columnGap: tokens.spacingHorizontalXS,
    },
    listCellProgressCompact: {
        width: "44px",
        flexShrink: 0,
        justifyContent: "flex-end",
        color: tokens.colorNeutralForeground3,
        ...typographyStyles.caption1,
        fontVariantNumeric: "tabular-nums",
    },
    headerCellText: {
        ...typographyStyles.caption1Strong,
        color: tokens.colorNeutralForeground2,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    taskName: {
        minWidth: 0,
        flexGrow: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    taskNameSummary: {
        fontWeight: tokens.fontWeightSemibold,
    },
    expandButton: {
        flexShrink: 0,
    },
    expandSpacer: {
        flexShrink: 0,
        width: "20px",
    },

    splitter: {
        position: "absolute",
        top: 0,
        bottom: 0,
        right: "-3px",
        width: "7px",
        zIndex: 3,
        cursor: "col-resize",
        backgroundColor: "transparent",
        border: "none",
        padding: 0,
        touchAction: "none",
        ":hover::after": { backgroundColor: tokens.colorBrandStroke1 },
        ":focus-visible::after": { backgroundColor: tokens.colorBrandStroke1 },
        "::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "3px",
            width: "1px",
            backgroundColor: "transparent",
            transitionDuration: tokens.durationFaster,
            transitionProperty: "background-color",
        },
    },
    splitterActive: {
        "::after": { backgroundColor: tokens.colorBrandStroke1 },
    },

    /** Timeline --------------------------------------------------------- */
    timelinePane: {
        position: "relative",
        flexShrink: 0,
        width: `var(${cssVars.timelineWidth})`,
    },
    bandRow: {
        display: "flex",
        height: "24px",
        alignItems: "center",
    },
    bandCell: {
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        height: "100%",
        paddingInline: tokens.spacingHorizontalXS,
        overflow: "hidden",
        whiteSpace: "nowrap",
        borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        ...typographyStyles.caption1Strong,
        color: tokens.colorNeutralForeground2,
    },
    bandCellLabel: {
        position: "sticky",
        left: tokens.spacingHorizontalXS,
    },
    tickRow: {
        display: "flex",
        height: "24px",
    },
    tickCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        flexShrink: 0,
        width: `var(${cssVars.columnWidth})`,
        height: "100%",
        overflow: "hidden",
        borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
        ...typographyStyles.caption2,
        color: tokens.colorNeutralForeground3,
        fontVariantNumeric: "tabular-nums",
    },
    tickCellNonWorking: {
        backgroundColor: tokens.colorNeutralBackground3,
    },
    tickCellToday: {
        ...typographyStyles.caption2Strong,
        color: tokens.colorBrandForeground1,
        backgroundColor: tokens.colorBrandBackground2,
    },

    track: {
        position: "relative",
        // Keeps the z-index a stack of overlapping bars uses inside the row, so
        // it cannot compete with the today marker or the sticky task list.
        isolation: "isolate",
        height: "100%",
        boxSizing: "border-box",
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    },
    trackSelected: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    trackRowSelected: {
        backgroundColor: tokens.colorBrandBackground2,
    },
    /** Column rules and weekend shading, painted once per row as a gradient. */
    trackGrid: {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `linear-gradient(to right, ${tokens.colorNeutralStroke3} 0 1px, transparent 1px 100%)`,
        backgroundSize: `var(${cssVars.columnWidth}) 100%`,
    },
    nonWorkingOverlay: {
        position: "absolute",
        top: 0,
        bottom: 0,
        pointerEvents: "none",
        backgroundColor: tokens.colorNeutralBackground3,
        opacity: 0.6,
    },
    todayMarker: {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: "2px",
        marginLeft: "-1px",
        // Above the bars, but below the sticky task list so the line does not
        // bleed over the left pane once the timeline is scrolled.
        zIndex: 1,
        pointerEvents: "none",
        backgroundColor: tokens.colorPaletteRedBorderActive,
        opacity: 0.85,
    },
    todayFlag: {
        position: "sticky",
        top: "48px",
        display: "block",
        width: "8px",
        height: "8px",
        marginLeft: "-3px",
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorPaletteRedBorderActive,
    },

    /** Bars ------------------------------------------------------------- */
    bar: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: `var(${cssVars.barHeight})`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        borderRadius: tokens.borderRadiusMedium,
        border: "1px solid lightgray",
        cursor: "pointer",
        transitionDuration: tokens.durationFaster,
        transitionTimingFunction: tokens.curveEasyEase,
        transitionProperty: "box-shadow, transform, filter",
        ":hover": { filter: "brightness(1.06)", boxShadow: tokens.shadow4 },
        // The grips stay invisible but grabbable until the bar is pointed at.
        ":hover .gantt-bar-handle": { opacity: 0.75 },
        ":focus-visible": {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    /** A bar the user may drag along the timeline. */
    barDraggable: {
        cursor: "grab",
        // Without this a touch drag scrolls the chart instead of moving the bar.
        touchAction: "none",
    },
    barDragging: {
        cursor: "grabbing",
        // Clear of the rest of the row's stack while it is being carried.
        zIndex: 5,
        boxShadow: tokens.shadow8,
        ":hover": { filter: "none" },
    },
    /**
     * An edit that has been published but not yet seen coming back through the
     * data. Drawn in its new place, but marked as not settled.
     */
    barPending: {
        outline: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralForeground3}`,
        outlineOffset: "1px",
    },
    /** Grip at either end of a bar; drag it to change that date alone. */
    barHandle: {
        position: "absolute",
        top: "2px",
        bottom: "2px",
        width: "6px",
        zIndex: 1,
        boxSizing: "border-box",
        cursor: "ew-resize",
        touchAction: "none",
        opacity: 0,
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground1,
        transitionDuration: tokens.durationFaster,
        transitionProperty: "opacity",
        ":hover": { opacity: 1 },
    },
    barHandleStart: {
        insetInlineStart: "2px",
    },
    barHandleEnd: {
        insetInlineEnd: "2px",
    },
    barSelected: {
        boxShadow: `0 0 0 ${tokens.strokeWidthThick} ${tokens.colorNeutralBackground1}, 0 0 0 calc(${tokens.strokeWidthThick} * 2) ${tokens.colorBrandStroke1}`,
    },
    barFill: {
        height: "100%",
        borderRadius: "inherit",
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveDecelerateMid,
        transitionProperty: "width",
    },
    /**
     * Parent rows read as a bracket rather than a solid bar. The bracket is
     * drawn with clip-path, which also clips hit testing — in the middle of the
     * bar only the top 40% would be a target, roughly 4px. So this element is a
     * transparent, full-height hit area and the clipped shape is a child that
     * takes no pointer events.
     */
    summaryBar: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: `var(${cssVars.barHeight})`,
        boxSizing: "border-box",
        backgroundColor: "transparent",
        cursor: "pointer",
        ":focus-visible": {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    summaryBarShape: {
        position: "absolute",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        top: "50%",
        transform: "translateY(-50%)",
        height: "10px",
        pointerEvents: "none",
        clipPath: "polygon(0 0, 100% 0, 100% 100%, calc(100% - 6px) 40%, 6px 40%, 0 100%)",
    },
    milestone: {
        position: "absolute",
        top: "50%",
        width: "14px",
        height: "14px",
        marginLeft: "-7px",
        transform: "translateY(-50%) rotate(45deg)",
        borderRadius: tokens.borderRadiusSmall,
        cursor: "pointer",
    },
    /** The diamond is already rotated, so it cannot reuse the bar's drag styles. */
    milestoneDraggable: {
        cursor: "grab",
        touchAction: "none",
    },

    /** Tooltip body ----------------------------------------------------- */
    tooltipContent: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalXXS,
        minWidth: "180px",
    },
    tooltipTitle: {
        ...typographyStyles.body1Strong,
    },
    tooltipRow: {
        display: "flex",
        justifyContent: "space-between",
        columnGap: tokens.spacingHorizontalM,
        ...typographyStyles.caption1,
    },
    tooltipLabel: {
        color: tokens.colorNeutralForeground3,
    },

    /** States ----------------------------------------------------------- */
    statusBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        paddingInline: tokens.spacingHorizontalM,
        paddingBlock: tokens.spacingVerticalXS,
        borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground3,
    },
    legend: {
        display: "flex",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    /** A button, so reset to look like the plain label it replaced. */
    legendItem: {
        display: "inline-flex",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalXS,
        paddingInline: tokens.spacingHorizontalXS,
        paddingBlock: "1px",
        border: `${tokens.strokeWidthThin} solid transparent`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: "transparent",
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground2,
        },
        ":focus-visible": {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    legendItemActive: {
        ...shorthands.borderColor(tokens.colorNeutralStroke1),
        backgroundColor: tokens.colorSubtleBackgroundSelected,
        color: tokens.colorNeutralForeground1,
    },
    /** Swatches left out of an active filter. */
    legendItemMuted: {
        opacity: 0.5,
    },
    legendSwatch: {
        width: "10px",
        height: "10px",
        borderRadius: tokens.borderRadiusSmall,
        flexShrink: 0,
    },
    /** Settings panel ---------------------------------------------------- */
    settingsSection: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalM,
        paddingBlock: tokens.spacingVerticalS,
    },
    /** Two fields side by side, stacking when the drawer is narrow. */
    settingsPair: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        columnGap: tokens.spacingHorizontalM,
        rowGap: tokens.spacingVerticalM,
    },
    settingsGroup: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        rowGap: tokens.spacingVerticalXXS,
    },
    settingsGroupLabel: {
        ...typographyStyles.caption1Strong,
        color: tokens.colorNeutralForeground2,
    },
    settingsOutput: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalS,
        width: "100%",
    },
    settingsOutputHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        columnGap: tokens.spacingHorizontalS,
    },
    settingsCode: {
        fontFamily: tokens.fontFamilyMonospace,
        height: "120px",
    },
    settingsActions: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        columnGap: tokens.spacingHorizontalS,
        rowGap: tokens.spacingVerticalXS,
    },
    settingsCopied: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground3,
        marginInlineEnd: "auto",
    },

    centred: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        rowGap: tokens.spacingVerticalS,
        flexGrow: 1,
        minHeight: "160px",
        padding: tokens.spacingVerticalXXL,
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
    emptyIcon: {
        fontSize: "32px",
        lineHeight: "32px",
        color: tokens.colorNeutralForeground4,
    },
    emptyDetail: {
        maxWidth: "420px",
        color: tokens.colorNeutralForeground3,
    },
});
