import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/levels";

// Guards the hand-written content in levels.ts. Every question needs
// distinct answer choices, or a correct answer can be shown as wrong.
describe.each(Object.entries(LEVELS))("level %s content", (_id, level) => {
  it("has the basics configured", () => {
    expect(level.label).toBeTruthy();
    expect(level.swingSpeedMs).toBeGreaterThan(0);
    expect(level.math.ops.length).toBeGreaterThan(0);
    expect(level.math.max).toBeGreaterThanOrEqual(level.math.min);
  });

  it.each(level.spellingWords.map((w) => [w.word, w] as const))(
    "spelling word %s has distinct misspellings",
    (_word, w) => {
      expect(w.sentence).toContain("___");
      expect(w.misspellings).not.toContain(w.word);
      expect(new Set(w.misspellings).size).toBe(w.misspellings.length);
    }
  );

  it.each(level.vocabWords.map((w) => [w.word, w] as const))(
    "vocab word %s has distinct distractors",
    (_word, w) => {
      expect(w.distractors).not.toContain(w.correct);
      expect(new Set(w.distractors).size).toBe(w.distractors.length);
    }
  );
});
