import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "jsdom", globals: true, setupFiles: ["../../../apps/web/src/test/setup.ts"],
    include: ["wallet/**/*.test.{ts,tsx}"], fileParallelism: false },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../../apps/web/src") } },
});
