export function diffInDays(start: Date, end: Date): number {
    const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((utcEnd - utcStart) / 86400000);
}

export function addDays(inputDate: Date, days: number): Date {
    const nextDate = new Date(inputDate);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

export function colorForTask(progress: number): string {
    if (progress >= 90) {
        return "#2f6bed";
    }

    if (progress >= 60) {
        return "#3aa272";
    }

    if (progress >= 30) {
        return "#d99f1f";
    }

    return "#c85d5d";
}
