// Educational content and level configuration.
// To add a new age tier later, add a new numbered entry to LEVELS below —
// no other file needs to change.

const LEVELS = {
  1: {
    label: "Rookie League (Ages 5-7)",
    swingSpeedMs: 1800,
    math: { min: 0, max: 10, ops: ["+", "-"] },
    spellingWords: [
      { word: "cat", sentence: "The ___ sat on the mat.", misspellings: ["cet", "kat"] },
      { word: "dog", sentence: "My ___ likes to run.", misspellings: ["dawg", "doog"] },
      { word: "run", sentence: "I like to ___ fast.", misspellings: ["ron", "runn"] },
      { word: "big", sentence: "The elephant is very ___.", misspellings: ["bige", "beg"] },
      { word: "red", sentence: "The apple is ___.", misspellings: ["rede", "red"] },
      { word: "sun", sentence: "The ___ is bright today.", misspellings: ["son", "sunn"] },
      { word: "hat", sentence: "He wore a ___ to the game.", misspellings: ["hatt", "het"] },
      { word: "fun", sentence: "Baseball is so much ___!", misspellings: ["funn", "fon"] },
      { word: "bed", sentence: "I sleep in my ___.", misspellings: ["bedd", "bad"] },
      { word: "top", sentence: "He hit it to the ___ of the fence.", misspellings: ["tap", "topp"] },
    ],
    vocabWords: [
      { word: "happy", sentence: "She felt happy when her team won.", correct: "feeling glad or joyful", distractors: ["feeling sleepy", "feeling angry"] },
      { word: "big", sentence: "The stadium is really big.", correct: "large in size", distractors: ["very small", "very loud"] },
      { word: "fast", sentence: "The runner was very fast.", correct: "moving quickly", distractors: ["moving slowly", "standing still"] },
      { word: "jump", sentence: "The player will jump to catch the ball.", correct: "to leap into the air", distractors: ["to sit down", "to walk slowly"] },
      { word: "smile", sentence: "She had a big smile after the home run.", correct: "a happy look on your face", distractors: ["a loud sound", "a fast run"] },
      { word: "loud", sentence: "The crowd was loud after the win.", correct: "making a lot of noise", distractors: ["very quiet", "very small"] },
      { word: "tiny", sentence: "The tiny bug crawled on the bat.", correct: "very small", distractors: ["very large", "very loud"] },
      { word: "brave", sentence: "It was brave to try a new position.", correct: "not afraid; showing courage", distractors: ["feeling tired", "feeling silly"] },
    ],
  },
  2: {
    label: "All-Star League (Ages 8-10)",
    swingSpeedMs: 1300,
    math: { min: 0, max: 12, ops: ["+", "-", "*"] },
    spellingWords: [
      { word: "because", sentence: "He swung ___ the pitch looked good.", misspellings: ["becuase", "becaus"] },
      { word: "friend", sentence: "My best ___ plays shortstop.", misspellings: ["freind", "frend"] },
      { word: "favorite", sentence: "Baseball is my ___ sport.", misspellings: ["favorate", "favroite"] },
      { word: "believe", sentence: "I ___ our team can win.", misspellings: ["beleive", "belive"] },
      { word: "definitely", sentence: "That was ___ a home run.", misspellings: ["definately", "definitly"] },
      { word: "separate", sentence: "Keep the bats in a ___ bag.", misspellings: ["seperate", "separat"] },
      { word: "weird", sentence: "That bounce was really ___.", misspellings: ["wierd", "weerd"] },
      { word: "thought", sentence: "I ___ that pitch was a strike.", misspellings: ["thout", "thaught"] },
      { word: "through", sentence: "The ball flew ___ the outfield.", misspellings: ["throo", "throught"] },
      { word: "beautiful", sentence: "It was a ___ catch at the wall.", misspellings: ["beautifull", "beatiful"] },
    ],
    vocabWords: [
      { word: "enormous", sentence: "He hit an enormous home run.", correct: "extremely large", distractors: ["extremely small", "extremely quiet"] },
      { word: "curious", sentence: "She was curious about the new pitching grip.", correct: "eager to learn or know something", distractors: ["tired and bored", "angry and upset"] },
      { word: "fatigue", sentence: "By the ninth inning, fatigue set in.", correct: "extreme tiredness", distractors: ["extreme excitement", "extreme hunger"] },
      { word: "generous", sentence: "The coach was generous with his praise.", correct: "willing to give more than expected", distractors: ["unwilling to share", "quick to anger"] },
      { word: "hesitate", sentence: "Don't hesitate — swing at a good pitch!", correct: "to pause because of uncertainty", distractors: ["to run very fast", "to celebrate loudly"] },
      { word: "furious", sentence: "The coach was furious about the bad call.", correct: "extremely angry", distractors: ["extremely happy", "extremely sleepy"] },
      { word: "ancient", sentence: "The stadium had an ancient scoreboard.", correct: "very old", distractors: ["very new", "very shiny"] },
      { word: "glimpse", sentence: "She caught a glimpse of the ball over the fence.", correct: "a brief or quick look", distractors: ["a long, slow look", "a loud shout"] },
    ],
  },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildChoices(correctValue, otherValues) {
  const choices = shuffle([correctValue, ...otherValues]);
  return { choices, correctIndex: choices.indexOf(correctValue) };
}

function generateMathQuestion(levelConfig) {
  const { min, max, ops } = levelConfig.math;
  const op = ops[randInt(0, ops.length - 1)];
  let a, b, answer, prompt;

  if (op === "+") {
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a + b;
    prompt = `${a} + ${b} = ?`;
  } else if (op === "-") {
    a = randInt(min, max);
    b = randInt(min, a);
    answer = a - b;
    prompt = `${a} - ${b} = ?`;
  } else {
    a = randInt(1, 9);
    b = randInt(1, 9);
    answer = a * b;
    prompt = `${a} × ${b} = ?`;
  }

  const distractors = new Set();
  while (distractors.size < 3) {
    const offset = randInt(-5, 5) || 1;
    const candidate = answer + offset;
    if (candidate >= 0 && candidate !== answer) distractors.add(candidate);
  }

  const { choices, correctIndex } = buildChoices(answer, [...distractors]);
  return { prompt, choices, correctIndex };
}

function generateSpellingQuestion(levelConfig) {
  const list = levelConfig.spellingWords;
  const entry = list[randInt(0, list.length - 1)];
  const prompt = `Which word correctly completes the sentence?\n"${entry.sentence}"`;
  const { choices, correctIndex } = buildChoices(entry.word, entry.misspellings);
  return { prompt, choices, correctIndex };
}

function generateVocabQuestion(levelConfig) {
  const list = levelConfig.vocabWords;
  const entry = list[randInt(0, list.length - 1)];
  const prompt = `What does "${entry.word}" mean?\n(as in: "${entry.sentence}")`;
  const { choices, correctIndex } = buildChoices(entry.correct, entry.distractors);
  return { prompt, choices, correctIndex };
}

const QUESTION_GENERATORS = {
  math: generateMathQuestion,
  spelling: generateSpellingQuestion,
  vocab: generateVocabQuestion,
};

function getRandomQuestion(levelConfig, subjectOverride) {
  const subjectPool = ["math", "math", "spelling", "vocab"];
  const subject = subjectOverride || subjectPool[randInt(0, subjectPool.length - 1)];
  const question = QUESTION_GENERATORS[subject](levelConfig);
  question.subject = subject;
  return question;
}
