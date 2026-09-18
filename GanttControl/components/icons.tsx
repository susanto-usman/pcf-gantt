import { tokens } from "@fluentui/react-components";
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

/** The same grid, painted solid rather than stroked. */
const FilledIcon: React.FC<IconProps & { children: React.ReactNode }> = ({ children, ...rest }) => (
    <Icon fill="currentColor" stroke="none" {...rest}>
        {children}
    </Icon>
);

/** A plane seen from above, nose to the right, as ✈️ draws it. */
const PLANE =
    "M18.2 10c0 .8-.9 1.25-1.9 1.25h-3.8l-3.9 6.1H6.9l2.1-6.1H5.2l-1.5 1.9H2.3l.9-3.15-.9-3.15h1.4l1.5 1.9H9L6.9 2.65h1.7l3.9 6.1h3.8c1 0 1.9.45 1.9 1.25Z";

/**
 * A helicopter seen from the side, nose to the right, as 🚁 draws it: main
 * rotor over the cabin, tail boom out to the left with its fin and rotor, and
 * skids below. The `transform` tilts the whole machine for the in and out
 * variants; the numbers there centre it above their ground bar.
 */
const Helicopter: React.FC<{ transform?: string }> = ({ transform }) => (
    <g transform={transform}>
        <rect x="1.6" y="3.4" width="16.8" height="1.1" rx="0.55" />
        <rect x="9.4" y="4.4" width="1.2" height="1.8" />
        <rect x="1.3" y="4.9" width="3.5" height="0.9" rx="0.45" />
        <rect x="2.2" y="5.3" width="1.7" height="4" rx="0.8" />
        <rect x="3" y="8.1" width="5.6" height="1.2" rx="0.6" />
        <ellipse cx="11.9" cy="8.6" rx="4.5" ry="2.7" />
        <rect x="8.1" y="11" width="1.2" height="3.2" />
        <rect x="12.3" y="11" width="1.2" height="3.2" />
        <rect x="4.6" y="14" width="10.8" height="1.1" rx="0.55" />
    </g>
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

export const PersonIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="10" cy="6.75" r="3.25" />
        <path d="M3.75 17c.5-3.25 3.1-5.25 6.25-5.25s5.75 2 6.25 5.25" />
    </Icon>
);

export const ColumnsIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <rect x="3.25" y="3.75" width="13.5" height="12.5" rx="2" />
        <path d="M8 3.75v12.5M12 3.75v12.5" />
    </Icon>
);

/** A globe, for the clock the times are read on. */
export const GlobeIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="10" cy="10" r="7" />
        <path d="M3.4 7.75h13.2M3.4 12.25h13.2" />
        <path d="M10 3c1.85 2 2.75 4.35 2.75 7S11.85 17 10 17 7.25 12.65 7.25 10 8.15 3 10 3Z" />
    </Icon>
);

export const FlagIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M5 17V3.5M5 4h9.5l-2 3.5 2 3.5H5" />
    </Icon>
);

/**
 * Icons a display rule or an icon field can name for a record drawn as an
 * icon. Anything else is written out as text, so a maker is never stuck
 * waiting on this list.
 */
export const MARKER_ICONS: Record<string, React.FC<IconProps>> = {
    // Travel is drawn solid, after the emoji ✈️ 🛫 🛬 🚁 🚗 🚌, so it reads at a glance
    // beside the outlined icons and still takes the display rule's colour.
    plane: (props) => (
        <FilledIcon {...props}>
            <path d={PLANE} />
        </FilledIcon>
    ),
    "flight-out": (props) => (
        <FilledIcon {...props}>
            <path d={PLANE} transform="translate(0 -1.8) rotate(-32 10 10) scale(0.88) translate(1.2 1.2)" />
            <rect x="2" y="17" width="16" height="1.6" rx="0.8" />
        </FilledIcon>
    ),
    "flight-in": (props) => (
        <FilledIcon {...props}>
            <path d={PLANE} transform="translate(0 -1.8) rotate(32 10 10) scale(0.88) translate(1.2 1.2)" />
            <rect x="2" y="17" width="16" height="1.6" rx="0.8" />
        </FilledIcon>
    ),
    helicopter: (props) => (
        <FilledIcon {...props}>
            <Helicopter />
        </FilledIcon>
    ),
    "helicopter-out": (props) => (
        <FilledIcon {...props}>
            <Helicopter transform="translate(3.71 1.76) rotate(-22 10 10) scale(0.82)" />
            <rect x="2" y="17" width="16" height="1.6" rx="0.8" />
        </FilledIcon>
    ),
    "helicopter-in": (props) => (
        <FilledIcon {...props}>
            <Helicopter transform="translate(-0.35 3.11) rotate(22 10 10) scale(0.82)" />
            <rect x="2" y="17" width="16" height="1.6" rx="0.8" />
        </FilledIcon>
    ),
    home: (props) => (
        <Icon {...props}>
            <path d="M3.5 9.25 10 3.75l6.5 5.5M5.25 8v8.25h9.5V8M8.5 16.25v-4.5h3v4.5" />
        </Icon>
    ),
    sick: (props) => (
        <Icon {...props}>
            <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="3" />
            <path d="M10 6.5v7M6.5 10h7" />
        </Icon>
    ),
    training: (props) => (
        <Icon {...props}>
            <path d="M2.5 7.5 10 4l7.5 3.5L10 11 2.5 7.5ZM5.5 9v4c1 1.25 2.75 2 4.5 2s3.5-.75 4.5-2V9M17.5 7.5v4.5" />
        </Icon>
    ),
    car: (props) => (
        <FilledIcon {...props}>
            <path
                fillRule="evenodd"
                d="M2.2 13.6v-2.7c0-.75.45-1.35 1.15-1.55l2.05-.6 1.85-3.05c.3-.5.85-.8 1.45-.8h4.2c.55 0 1.05.25 1.4.7l2.35 3.1 1.35.4c.75.2 1.25.85 1.25 1.6v2.9H2.2ZM8.2 6.3h2.3v2.5H6.7l1.5-2.5Zm3.8 0h1.3l1.9 2.5H12V6.3Z"
            />
            {/* Each wheel is ringed in the surface colour, so it stands clear of the body. */}
            <circle cx="6" cy="14.2" r="2.1" style={{ fill: tokens.colorNeutralBackground1 }} />
            <circle cx="6" cy="14.2" r="1.5" />
            <circle cx="14" cy="14.2" r="2.1" style={{ fill: tokens.colorNeutralBackground1 }} />
            <circle cx="14" cy="14.2" r="1.5" />
        </FilledIcon>
    ),
    bus: (props) => (
        <FilledIcon {...props}>
            <path
                fillRule="evenodd"
                d="M4 3.8h12c1 0 1.8.8 1.8 1.8v8.6H2.2V5.6c0-1 .8-1.8 1.8-1.8Zm-.1 2.1h5.2v3.3H3.9V5.9Zm7 0h5.2v3.3h-5.2V5.9Z"
            />
            {/* Ringed in the surface colour like the car, so each wheel stands clear of the body. */}
            <circle cx="6" cy="14.2" r="2.1" style={{ fill: tokens.colorNeutralBackground1 }} />
            <circle cx="6" cy="14.2" r="1.5" />
            <circle cx="14" cy="14.2" r="2.1" style={{ fill: tokens.colorNeutralBackground1 }} />
            <circle cx="14" cy="14.2" r="1.5" />
        </FilledIcon>
    ),
    clock: (props) => (
        <Icon {...props}>
            <circle cx="10" cy="10" r="6.75" />
            <path d="M10 6v4.25l2.75 1.75" />
        </Icon>
    ),
    lock: (props) => (
        <Icon {...props}>
            <rect x="4.25" y="8.75" width="11.5" height="8" rx="1.75" />
            <path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25" />
        </Icon>
    ),
    star: (props) => (
        <Icon {...props}>
            <path d="m10 3 2.1 4.4 4.65.6-3.4 3.25.85 4.75L10 13.7 5.8 16l.85-4.75L3.25 8l4.65-.6z" />
        </Icon>
    ),
    check: (props) => (
        <Icon {...props}>
            <path d="m4.25 10.5 3.5 3.5 8-8" />
        </Icon>
    ),
    cross: DismissIcon,
    warning: WarningIcon,
    flag: FlagIcon,
    person: PersonIcon,
    calendar: CalendarIcon,
    dot: (props) => (
        <Icon {...props}>
            <circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none" />
        </Icon>
    ),
};

export const MARKER_ICON_NAMES = Object.keys(MARKER_ICONS);

/** Text with anything outside printable ASCII in it, which for an icon means an emoji such as 🛫. */
const NON_ASCII = /[^\x20-\x7E]/;

/**
 * A marker's icon: a built-in one by name, otherwise the name itself as text.
 * An emoji is drawn at icon size in its own colours; short text such as RDO
 * gets the smaller text style.
 */
export const MarkerIcon: React.FC<{
    name: string;
    className?: string;
    textClassName?: string;
    emojiClassName?: string;
}> = ({ name, className, textClassName, emojiClassName }) => {
    const text = name.trim();
    const Glyph = MARKER_ICONS[text.toLowerCase()];

    if (Glyph) {
        return <Glyph className={className} />;
    }

    return (
        <span className={(NON_ASCII.test(text) ? emojiClassName : textClassName) ?? className} aria-hidden="true">
            {text}
        </span>
    );
};
