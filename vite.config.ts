import { defineConfig } from "vitest/config";

// Served from https://slowms6.github.io/baseball-quiz-game/ by GitHub Pages.
export default defineConfig({
  base: "/baseball-quiz-game/",
  build: {
    // The lazily loaded 3D chunk is mostly three.js (~170 kB gzipped).
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
