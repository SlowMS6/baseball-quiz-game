// Baseball rules: base running, CPU at-bats, and swing timing.
// Pure functions with no DOM or game state, so they can be unit tested.

export type HitType = "single" | "double" | "triple" | "homerun";
export type Outcome = HitType | "strike";
export type Bases = [boolean, boolean, boolean];

// Advances runners for a hit (mutating `bases`) and returns runs scored.
export function applyHit(hitType: HitType, bases: Bases): number {
  const b = bases;
  let runs = 0;

  if (hitType === "single") {
    runs = b[2] ? 1 : 0;
    const newSecond = b[0];
    const newThird = b[1];
    b[0] = true;
    b[1] = newSecond;
    b[2] = newThird;
  } else if (hitType === "double") {
    runs = (b[1] ? 1 : 0) + (b[2] ? 1 : 0);
    const newThird = b[0];
    b[0] = false;
    b[1] = true;
    b[2] = newThird;
  } else if (hitType === "triple") {
    runs = b.filter(Boolean).length;
    b[0] = false;
    b[1] = false;
    b[2] = true;
  } else if (hitType === "homerun") {
    runs = b.filter(Boolean).length + 1;
    b[0] = false;
    b[1] = false;
    b[2] = false;
  }

  return runs;
}

export function weightedPick<T>(options: { value: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of options) {
    if (roll < o.weight) return o.value;
    roll -= o.weight;
  }
  return options[options.length - 1].value;
}

export function randomCpuOutcome(): HitType | "out" {
  return weightedPick<HitType | "out">([
    { value: "out", weight: 55 },
    { value: "single", weight: 25 },
    { value: "double", weight: 10 },
    { value: "triple", weight: 5 },
    { value: "homerun", weight: 5 },
  ]);
}

// `pos` is how far through the pitch the player swung, 0-100. A perfect
// swing is at 50, which swing3d.ts lines up with the ball reaching the
// glowing hit-zone ring in front of the plate.
export function classifySwing(pos: number): Outcome {
  const dist = Math.abs(pos - 50);
  if (dist <= 5) {
    return weightedPick<Outcome>([
      { value: "homerun", weight: 40 },
      { value: "triple", weight: 60 },
    ]);
  } else if (dist <= 15) {
    return "double";
  } else if (dist <= 30) {
    return "single";
  }
  return "strike";
}
