// Question generators. Each returns a multiple-choice question built from
// a level's config in levels.ts.

import type { LevelConfig, Subject } from "./levels";

export interface Question {
  subject: Subject;
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildChoices(correctValue: string, otherValues: string[]) {
  const choices = shuffle([correctValue, ...otherValues]);
  return { choices, correctIndex: choices.indexOf(correctValue) };
}

export function generateMathQuestion(levelConfig: LevelConfig): Question {
  const { min, max, ops } = levelConfig.math;
  const op = ops[randInt(0, ops.length - 1)];
  let a: number, b: number, answer: number, prompt: string;

  if (op === "+") {
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a + b;
    prompt = `${a} + ${b} = ?`;
  } else if (op === "-") {
    a = randInt(min, max);
    b = randInt(min, a);
    answer = a - b;
    prompt = `${a} − ${b} = ?`;
  } else {
    a = randInt(1, 9);
    b = randInt(1, 9);
    answer = a * b;
    prompt = `${a} × ${b} = ?`;
  }

  const distractors = new Set<number>();
  while (distractors.size < 3) {
    const offset = randInt(-5, 5) || 1;
    const candidate = answer + offset;
    if (candidate >= 0 && candidate !== answer) distractors.add(candidate);
  }

  const { choices, correctIndex } = buildChoices(String(answer), [...distractors].map(String));
  return { subject: "math", prompt, choices, correctIndex };
}

export function generateSpellingQuestion(levelConfig: LevelConfig): Question {
  const list = levelConfig.spellingWords;
  const entry = list[randInt(0, list.length - 1)];
  const prompt = `Which word correctly completes the sentence?\n"${entry.sentence}"`;
  const { choices, correctIndex } = buildChoices(entry.word, entry.misspellings);
  return { subject: "spelling", prompt, choices, correctIndex };
}

export function generateVocabQuestion(levelConfig: LevelConfig): Question {
  const list = levelConfig.vocabWords;
  const entry = list[randInt(0, list.length - 1)];
  const prompt = `What does "${entry.word}" mean?\n(as in: "${entry.sentence}")`;
  const { choices, correctIndex } = buildChoices(entry.correct, entry.distractors);
  return { subject: "vocab", prompt, choices, correctIndex };
}

const QUESTION_GENERATORS: Record<Subject, (levelConfig: LevelConfig) => Question> = {
  math: generateMathQuestion,
  spelling: generateSpellingQuestion,
  vocab: generateVocabQuestion,
};

export function getRandomQuestion(levelConfig: LevelConfig, subjectOverride?: Subject): Question {
  const subjectPool: Subject[] = ["math", "math", "spelling", "vocab"];
  const subject = subjectOverride || subjectPool[randInt(0, subjectPool.length - 1)];
  return QUESTION_GENERATORS[subject](levelConfig);
}
