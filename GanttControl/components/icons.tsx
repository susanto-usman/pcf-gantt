import * as React from "react";

/**
 * The handful of glyphs this control needs, drawn inline.
 *
 * `@fluentui/react-icons` is not part of the Fluent platform library, so
 * importing from it bundles roughly a megabyte of icon chunks plus a second
 * copy of Griffel. These are stroked on a 20x20 grid to sit alongside the
 * Fluent Regular icons the platform draws elsewhere.
 */
type IconProps = React.SVGProps<SVGSVGElement>;

const Icon: React.FC<IconProps & { children: React.ReactNode }> = ({ children, ...rest }) => (
    <svg
        width="1em"
        height="1em"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        {...rest}
    >
        {children}
    </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M7.75 4.75 13 10l-5.25 5.25" />
    </Icon>
);

export const DismissIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </Icon>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M4.75 7.75 10 13l5.25-5.25" />
    </Icon>
);

export const ChevronUpIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M4.75 12.25 10 7l5.25 5.25" />
    </Icon>
);

export const CalendarTodayIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <rect x="3.25" y="4.25" width="13.5" height="12.5" rx="2.25" />
        <path d="M3.25 8.25h13.5M6.75 2.75v3M13.25 2.75v3" />
        <rect x="6.75" y="10.75" width="3.5" height="3" rx="0.75" fill="currentColor" stroke="none" />
    </Icon>
);

export const CalendarIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <rect x="3.25" y="4.25" width="13.5" height="12.5" rx="2.25" />
        <path d="M3.25 8.25h13.5M6.75 2.75v3M13.25 2.75v3" />
    </Icon>
);

export const SearchIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="8.75" cy="8.75" r="5" />
        <path d="m12.5 12.5 4 4" />
    </Icon>
);

export const ZoomInIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="8.75" cy="8.75" r="5" />
        <path d="m12.5 12.5 4 4M6.5 8.75h4.5M8.75 6.5v4.5" />
    </Icon>
);

export const ZoomOutIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="8.75" cy="8.75" r="5" />
        <path d="m12.5 12.5 4 4M6.5 8.75h4.5" />
    </Icon>
);

export const FitToWidthIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M3 4.5v11M17 4.5v11M6 10h8M6 10l2.25-2.25M6 10l2.25 2.25M14 10l-2.25-2.25M14 10l-2.25 2.25" />
    </Icon>
);

export const WarningIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M8.7 3.4 2.4 14.2a1.5 1.5 0 0 0 1.3 2.3h12.6a1.5 1.5 0 0 0 1.3-2.3L11.3 3.4a1.5 1.5 0 0 0-2.6 0Z" />
        <path d="M10 7.75v3.5" />
        <circle cx="10" cy="13.75" r="0.35" fill="currentColor" />
    </Icon>
);

export const DensityIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M3.25 5.25h13.5M3.25 10h13.5M3.25 14.75h13.5" />
    </Icon>
);

export const SettingsIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M3.25 6h7.5M14.25 6h2.5M3.25 14h2.5M9.25 14h7.5" />
        <circle cx="12.5" cy="6" r="1.75" />
        <circle cx="7.5" cy="14" r="1.75" />
    </Icon>
);
