import { Text } from "@fluentui/react-components";
import * as React from "react";
import { useGanttStyles } from "../styles";
import { CalendarIcon, SearchIcon, WarningIcon } from "./icons";

export type EmptyReason =
    /** The dataset returned no records at all. */
    | "noData"
    /** Records arrived, but none of them had a usable start and finish date. */
    | "noValidDates"
    /** Records exist, but the current search or legend filter excluded them. */
    | "noMatches";

export interface GanttEmptyStateProps {
    reason: EmptyReason;
    search?: string;
    /** True when a legend filter is narrowing the chart, alongside or instead of the search. */
    isLegendFiltered?: boolean;
    recordCount?: number;
    availableColumns?: string[];
    dateFieldNames?: { start: string; end: string };
}

export const GanttEmptyState: React.FC<GanttEmptyStateProps> = ({
    reason,
    search,
    isLegendFiltered,
    recordCount,
    availableColumns,
    dateFieldNames,
}) => {
    const styles = useGanttStyles();

    const { icon, title, detail } = {
        noData: {
            icon: <CalendarIcon />,
            title: "Nothing to schedule yet",
            detail: "Tasks appear here once records have a valid start and finish date.",
        },
        noValidDates: {
            icon: <WarningIcon />,
            title: `${recordCount ?? 0} record${recordCount === 1 ? "" : "s"} loaded, but none can be placed`,
            detail: dateFieldNames
                ? `No record has a usable value in both "${dateFieldNames.start}" and "${dateFieldNames.end}". Point start and end in the Field mapping at date columns in this view.`
                : "No record has both a start and a finish date.",
        },
        noMatches: isLegendFiltered
            ? {
                  icon: <SearchIcon />,
                  title: search?.trim() ? `No tasks match "${search}" in this filter` : "No tasks match this filter",
                  detail: search?.trim()
                      ? "Try a different search term, or pick other colours in the legend."
                      : "Pick other colours in the legend, or clear the filter.",
              }
            : {
                  icon: <SearchIcon />,
                  title: `No tasks match "${search ?? ""}"`,
                  detail: "Try a different search term.",
              },
    }[reason];

    return (
        <div className={styles.centred} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">
                {icon}
            </span>
            <Text weight="semibold">{title}</Text>
            <Text size={200} className={styles.emptyDetail}>
                {detail}
            </Text>
            {reason === "noValidDates" && availableColumns && availableColumns.length > 0 && (
                <Text size={200} className={styles.emptyDetail}>
                    Columns in this view: {availableColumns.join(", ")}
                </Text>
            )}
        </div>
    );
};
