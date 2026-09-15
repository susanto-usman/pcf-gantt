import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["GanttControl/**/*.test.ts"],
    },
});
