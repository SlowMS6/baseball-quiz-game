import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/levels";
import { getRandomQuestion, type Question } from "../src/questions";

function expectWellFormed(q: Question) {
  expect(new Set(q.choices).size).toBe(q.choices.length);
  expect(q.correctIndex).toBeGreaterThanOrEqual(0);
  expect(q.correctIndex).toBeLessThan(q.choices.length);
}

describe.each(Object.entries(LEVELS))("level %s question generators", (_id, level) => {
  it("math questions have 4 unique, non-negative choices and the right answer", () => {
    for (let i = 0; i < 500; i++) {
      const q = getRandomQuestion(level, "math");
      expectWellFormed(q);
      expect(q.choices).toHaveLength(4);
      for (const c of q.choices) expect(Number(c)).toBeGreaterThanOrEqual(0);

      const [, a, op, b] = q.prompt.match(/^(\d+) (\+|−|×) (\d+) = \?$/) ?? [];
      const answer = op === "+" ? +a + +b : op === "−" ? +a - +b : +a * +b;
      expect(answer).toBeGreaterThanOrEqual(0);
      expect(q.choices[q.correctIndex]).toBe(String(answer));
    }
  });

  it("spelling questions offer the real word once among its misspellings", () => {
    for (let i = 0; i < 200; i++) {
      const q = getRandomQuestion(level, "spelling");
      expectWellFormed(q);
      const entry = level.spellingWords.find((w) => w.word === q.choices[q.correctIndex]);
      expect(entry).toBeDefined();
    }
  });

  it("vocab questions mark the correct definition", () => {
    for (let i = 0; i < 200; i++) {
      const q = getRandomQuestion(level, "vocab");
      expectWellFormed(q);
      const entry = level.vocabWords.find((w) => q.prompt.includes(`"${w.word}"`));
      expect(q.choices[q.correctIndex]).toBe(entry?.correct);
    }
  });

  it("mixes subjects when no override is given", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(getRandomQuestion(level).subject);
    expect([...seen].sort()).toEqual(["math", "spelling", "vocab"]);
  });
});
