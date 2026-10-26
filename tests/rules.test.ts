import { describe, expect, it } from "vitest";
import { applyHit, classifySwing, randomCpuOutcome, type Bases, type HitType } from "../src/rules";

describe("applyHit", () => {
  const cases: [HitType, Bases, Bases, number][] = [
    // hit, bases before, bases after, runs
    ["single", [false, false, false], [true, false, false], 0],
    ["single", [true, false, false], [true, true, false], 0],
    ["single", [false, false, true], [true, false, false], 1],
    ["single", [true, true, true], [true, true, true], 1],
    ["double", [false, false, false], [false, true, false], 0],
    ["double", [true, false, false], [false, true, true], 0],
    ["double", [true, true, true], [false, true, true], 2],
    ["triple", [false, false, false], [false, false, true], 0],
    ["triple", [true, true, true], [false, false, true], 3],
    ["homerun", [false, false, false], [false, false, false], 1],
    ["homerun", [true, false, true], [false, false, false], 3],
    ["homerun", [true, true, true], [false, false, false], 4],
  ];

  it.each(cases)("%s with %j -> %j scoring %i", (hit, before, after, runs) => {
    const bases = [...before] as Bases;
    expect(applyHit(hit, bases)).toBe(runs);
    expect(bases).toEqual(after);
  });
});

describe("classifySwing", () => {
  it("rewards a perfect swing with a triple or home run", () => {
    for (const pos of [45, 50, 55]) {
      for (let i = 0; i < 50; i++) expect(["triple", "homerun"]).toContain(classifySwing(pos));
    }
  });

  it("grades by distance from the sweet spot", () => {
    expect(classifySwing(44)).toBe("double");
    expect(classifySwing(65)).toBe("double");
    expect(classifySwing(34)).toBe("single");
    expect(classifySwing(80)).toBe("single");
    expect(classifySwing(19)).toBe("strike");
    expect(classifySwing(81)).toBe("strike");
    expect(classifySwing(0)).toBe("strike");
    expect(classifySwing(100)).toBe("strike");
  });
});

describe("randomCpuOutcome", () => {
  it("only returns known outcomes", () => {
    const known = ["out", "single", "double", "triple", "homerun"];
    for (let i = 0; i < 500; i++) expect(known).toContain(randomCpuOutcome());
  });
});
