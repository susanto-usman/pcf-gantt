import {
    Input,
    Menu,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tag,
    TagGroup,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from "@fluentui/react-components";
import * as React from "react";
import { useGanttStyles } from "../styles";
import { Density, TimeScale } from "../types";
import {
    CalendarTodayIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    DensityIcon,
    FitToWidthIcon,
    SearchIcon,
    ZoomInIcon,
    ZoomOutIcon,
} from "./icons";

const SCALE_LABELS: Record<TimeScale, string> = { day: "Day", week: "Week", month: "Month" };
const SCALE_ORDER: TimeScale[] = ["day", "week", "month"];
const DENSITY_LABELS: Record<Density, string> = { comfortable: "Detailed", compact: "Compact" };

/** One filter in use, shown as a removable chip. */
export interface FilterChip {
    key: string;
    label: string;
    /** A swatch drawn before the label, for a filter picked from the legend. */
    color?: string;
}

export interface GanttToolbarProps {
    density: Density;
    timeScale: TimeScale;
    search: string;
    canCollapse: boolean;
    allCollapsed: boolean;
    filters: FilterChip[];
    onRemoveFilter: (key: string) => void;
    onClearFilters: () => void;
    onDensityChange: (density: Density) => void;
    onTimeScaleChange: (scale: TimeScale) => void;
    onSearchChange: (value: string) => void;
    onToggleAll: () => void;
    onScrollToToday: () => void;
    onFitToWidth: () => void;
}

export const GanttToolbar: React.FC<GanttToolbarProps> = ({
    density,
    timeScale,
    search,
    canCollapse,
    allCollapsed,
    filters,
    onRemoveFilter,
    onClearFilters,
    onDensityChange,
    onTimeScaleChange,
    onSearchChange,
    onToggleAll,
    onScrollToToday,
    onFitToWidth,
}) => {
    const styles = useGanttStyles();
    const scaleIndex = SCALE_ORDER.indexOf(timeScale);

    const zoom = (delta: number) => {
        const next = SCALE_ORDER[scaleIndex + delta];
        if (next) {
            onTimeScaleChange(next);
        }
    };

    return (
        <Toolbar className={styles.toolbar} size={density === "compact" ? "small" : "medium"}>
            <div className={styles.toolbarGroup}>
                {/* SearchBox postdates Fluent 9.46.2, the newest platform library every region supports. */}
                <Input
                    className={styles.searchBox}
                    type="search"
                    contentBefore={<SearchIcon />}
                    size={density === "compact" ? "small" : "medium"}
                    placeholder="Find a task"
                    value={search}
                    aria-label="Find a task"
                    onChange={(_, data) => onSearchChange(data.value)}
                />

                {canCollapse && (
                    <Tooltip content={allCollapsed ? "Expand all tasks" : "Collapse all tasks"} relationship="label">
                        <ToolbarButton
                            appearance="subtle"
                            icon={allCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                            onClick={onToggleAll}
                        />
                    </Tooltip>
                )}

                {filters.length > 0 && (
                    <>
                        <TagGroup
                            className={styles.filterChips}
                            size={density === "compact" ? "extra-small" : "small"}
                            aria-label="Filters in use"
                            onDismiss={(_, data) => onRemoveFilter(String(data.value))}
                        >
                            {filters.map((filter) => (
                                <Tag
                                    key={filter.key}
                                    value={filter.key}
                                    shape="circular"
                                    appearance="outline"
                                    dismissible
                                    dismissIcon={{ "aria-label": "remove" }}
                                    style={{ paddingLeft: "4px" }}
                                    media={
                                        filter.color ? (
                                            <span
                                                className={styles.legendSwatch}
                                                style={{ backgroundColor: filter.color }}
                                                aria-hidden="true"
                                            />
                                        ) : undefined
                                    }
                                >
                                    {filter.label}
                                </Tag>
                            ))}
                        </TagGroup>

                        <ToolbarButton appearance="subtle" onClick={onClearFilters}>
                            Clear all
                        </ToolbarButton>
                    </>
                )}
            </div>

            <div className={styles.toolbarGroup}>
                <Tooltip content="Scroll to today" relationship="label">
                    <ToolbarButton appearance="subtle" icon={<CalendarTodayIcon />} onClick={onScrollToToday}>
                        Today
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                <Tooltip content="Zoom in" relationship="label">
                    <ToolbarButton
                        appearance="subtle"
                        icon={<ZoomInIcon />}
                        disabled={scaleIndex === 0}
                        onClick={() => zoom(-1)}
                    />
                </Tooltip>

                <Menu
                    checkedValues={{ scale: [timeScale] }}
                    onCheckedValueChange={(_, data) => onTimeScaleChange(data.checkedItems[0] as TimeScale)}
                >
                    <MenuTrigger disableButtonEnhancement>
                        <Tooltip content="Time scale" relationship="label">
                            <ToolbarButton appearance="subtle">{SCALE_LABELS[timeScale]}</ToolbarButton>
                        </Tooltip>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            {SCALE_ORDER.map((scale) => (
                                <MenuItemRadio key={scale} name="scale" value={scale}>
                                    {SCALE_LABELS[scale]}
                                </MenuItemRadio>
                            ))}
                        </MenuList>
                    </MenuPopover>
                </Menu>

                <Tooltip content="Zoom out" relationship="label">
                    <ToolbarButton
                        appearance="subtle"
                        icon={<ZoomOutIcon />}
                        disabled={scaleIndex === SCALE_ORDER.length - 1}
                        onClick={() => zoom(1)}
                    />
                </Tooltip>

                <Tooltip content="Fit the whole plan on screen" relationship="label">
                    <ToolbarButton appearance="subtle" icon={<FitToWidthIcon />} onClick={onFitToWidth} />
                </Tooltip>

                <ToolbarDivider />

                <Menu
                    checkedValues={{ density: [density] }}
                    onCheckedValueChange={(_, data) => onDensityChange(data.checkedItems[0] as Density)}
                >
                    <MenuTrigger disableButtonEnhancement>
                        <Tooltip content="Row density" relationship="label">
                            <ToolbarButton appearance="subtle" icon={<DensityIcon />}>
                                {DENSITY_LABELS[density]}
                            </ToolbarButton>
                        </Tooltip>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItemRadio name="density" value="comfortable">
                                Detailed
                            </MenuItemRadio>
                            <MenuItemRadio name="density" value="compact">
                                Compact
                            </MenuItemRadio>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>
        </Toolbar>
    );
};
