// Game state machine: setup -> playing (top/bottom halves x N innings) -> game over.

import { celebrate } from "./confetti";
import { LEVELS, type LevelConfig, type Subject } from "./levels";
import { getRandomQuestion, type Question } from "./questions";
import { applyHit, classifySwing, randomCpuOutcome, type Bases, type HitType } from "./rules";
import {
  freshStats,
  loadLevel,
  loadLifetimeStats,
  loadName,
  saveLevel,
  saveLifetimeStats,
  saveName,
  type SubjectStats,
} from "./storage";
import type { PitchResult } from "./swing3d";

// three.js is most of the bundle, so the 3D stage loads in its own chunk
// alongside the setup screen instead of holding it up.
const stage = import("./swing3d");

const MAX_INNINGS = 3;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const dom = {
  setupScreen: el("setup-screen"),
  gameScreen: el("game-screen"),
  gameoverScreen: el("gameover-screen"),
  nameInput: el<HTMLInputElement>("player-name"),
  levelSelect: el("level-select"),
  playBallBtn: el<HTMLButtonElement>("play-ball-btn"),
  lifetimeStats: el("lifetime-stats"),
  cpuTeam: el("cpu-team"),
  playerTeam: el("player-team"),
  cpuScore: el("cpu-score"),
  playerScore: el("player-score"),
  playerNameLabel: el("player-name-label"),
  inningArrow: el("inning-arrow"),
  inningNum: el("inning-num"),
  outsDots: el("outs-dots"),
  strikesLabel: el("strikes-label"),
  strikesDots: el("strikes-dots"),
  baseFirst: el("base-first"),
  baseSecond: el("base-second"),
  baseThird: el("base-third"),
  runnersLabel: el("runners-label"),
  stage: el("stage"),
  stageCanvas: el<HTMLCanvasElement>("swing3d-canvas"),
  stageLoading: el("stage-loading"),
  stageLoadingText: el("stage-loading-text"),
  messageBanner: el("message-banner"),
  hitBurst: el("hit-burst"),
  questionPanel: el("question-panel"),
  subjectChip: el("subject-chip"),
  questionPrompt: el("question-prompt"),
  choices: el("choices"),
  swingPanel: el("swing-panel"),
  swingBtn: el<HTMLButtonElement>("swing-btn"),
  cpuPanel: el("cpu-panel"),
  playByPlay: el("play-by-play"),
  gameoverArt: el("gameover-art"),
  gameoverTitle: el("gameover-title"),
  gameoverScore: el("gameover-score"),
  gameoverStats: el("gameover-stats"),
  playAgainBtn: el<HTMLButtonElement>("play-again-btn"),
};

interface GameState {
  playerName: string;
  level: string;
  inning: number;
  half: "top" | "bottom";
  outs: number;
  strikes: number;
  bases: Bases;
  score: { player: number; cpu: number };
  stats: SubjectStats;
}

let state: GameState;
let stageFailed = false;

const SUBJECT_LABELS: Record<Subject, string> = { math: "Math", spelling: "Spelling", vocab: "Vocab" };
const HIT_LABELS: Record<HitType, string> = { single: "Single", double: "Double", triple: "Triple", homerun: "Home run" };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScreen(name: "setup" | "game" | "gameover") {
  dom.setupScreen.hidden = name !== "setup";
  dom.gameScreen.hidden = name !== "game";
  dom.gameoverScreen.hidden = name !== "gameover";
  stage.then((s) => s.setStageActive(name === "game"));
  window.scrollTo({ top: 0 });
}

// Restarts a CSS animation by toggling its class.
function replay(node: HTMLElement, className: string) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

function pct(s: { correct: number; total: number }) {
  return s.total ? Math.round((s.correct / s.total) * 100) : 0;
}

// ---------- Setup screen ----------

function levelBlurb(level: LevelConfig) {
  const words = { "+": "adding", "-": "subtracting", "*": "times tables" };
  const parts = level.math.ops.map((op) => words[op]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}` : parts[0];
  const math = level.math.ops.includes("*") ? list : `${list} to ${level.math.max}`;
  return math.charAt(0).toUpperCase() + math.slice(1);
}

function renderLifetimeStats() {
  const stats = loadLifetimeStats();
  const subjects = (Object.keys(stats) as Subject[]).filter((s) => stats[s].total > 0);
  dom.lifetimeStats.hidden = subjects.length === 0;
  dom.lifetimeStats.innerHTML = `
    <p class="field-label">Lifetime practice stats</p>
    <div class="stat-tiles">
      ${subjects
        .map(
          (s) => `
        <div class="stat-tile stat-tile--${s}">
          <span class="stat-tile__name">${SUBJECT_LABELS[s]}</span>
          <span class="stat-tile__pct">${pct(stats[s])}%</span>
          <span class="stat-tile__count">${stats[s].correct}/${stats[s].total} correct</span>
          <span class="meter"><span style="width:${pct(stats[s])}%"></span></span>
        </div>`
        )
        .join("")}
    </div>`;
}

function selectLevel(levelId: string) {
  for (const card of dom.levelSelect.children as HTMLCollectionOf<HTMLElement>) {
    const on = card.dataset.level === levelId;
    card.classList.toggle("selected", on);
    card.setAttribute("aria-checked", String(on));
    card.tabIndex = on ? 0 : -1;
  }
  dom.levelSelect.dataset.selected = levelId;
  updatePlayButtonState();
}

function populateLevelSelect() {
  dom.levelSelect.innerHTML = "";
  delete dom.levelSelect.dataset.selected;
  for (const [levelId, level] of Object.entries(LEVELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "league-card";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.dataset.level = levelId;
    btn.innerHTML = `
      <span class="league-card__icon" aria-hidden="true">${level.icon}</span>
      <span class="league-card__name">${level.label}</span>
      <span class="league-card__ages">${level.ages}</span>
      <span class="league-card__blurb">${levelBlurb(level)} · spelling · vocab</span>`;
    btn.addEventListener("click", () => selectLevel(levelId));
    dom.levelSelect.appendChild(btn);
  }
  const cards = [...dom.levelSelect.children] as HTMLElement[];
  cards.forEach((c, i) => (c.tabIndex = i === 0 ? 0 : -1));

  const savedLevel = loadLevel();
  if (savedLevel && LEVELS[savedLevel]) selectLevel(savedLevel);
}

// Arrow keys move between league cards, like a native radio group.
dom.levelSelect.addEventListener("keydown", (e) => {
  const cards = [...dom.levelSelect.children] as HTMLElement[];
  const i = cards.indexOf(document.activeElement as HTMLElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (i < 0 || !step) return;
  e.preventDefault();
  const next = cards[(i + step + cards.length) % cards.length];
  selectLevel(next.dataset.level!);
  next.focus();
});

function updatePlayButtonState() {
  const hasName = dom.nameInput.value.trim().length > 0;
  const hasLevel = !!dom.levelSelect.dataset.selected;
  dom.playBallBtn.disabled = !(hasName && hasLevel);
}

export function initSetupScreen() {
  dom.nameInput.value = loadName();
  populateLevelSelect();
  renderLifetimeStats();
  updatePlayButtonState();
  showScreen("setup");
}

// ---------- Game setup ----------

function startGame() {
  const name = dom.nameInput.value.trim();
  const level = dom.levelSelect.dataset.selected!;
  saveName(name);
  saveLevel(level);

  state = {
    playerName: name,
    level,
    inning: 1,
    half: "top",
    outs: 0,
    strikes: 0,
    bases: [false, false, false],
    score: { player: 0, cpu: 0 },
    stats: freshStats(),
  };

  dom.playerNameLabel.textContent = name;
  showScreen("game");
  bootStage();
  updateHUD();
  renderField();
  showMessage(`Top of inning 1 — CPU is up!`);
  playTopHalf();
}

function bootStage() {
  stage
    .then((s) => s.initStage(dom.stageCanvas))
    .then(() => (dom.stageLoading.hidden = true))
    .catch((err) => {
      console.error(err);
      stageFailed = true;
      dom.stageLoadingText.textContent = "The 3D field couldn't load on this device — hits are automatic.";
      dom.stageLoading.classList.add("stage__loading--error");
    });
}

function levelConfig() {
  return LEVELS[state.level];
}

// ---------- Rendering ----------

function bulbs(node: HTMLElement, on: number) {
  node.innerHTML = [0, 1, 2].map((i) => `<span class="bulb${i < on ? " on" : ""}"></span>`).join("");
}

function updateHUD() {
  for (const [node, team, value] of [
    [dom.cpuScore, dom.cpuTeam, state.score.cpu],
    [dom.playerScore, dom.playerTeam, state.score.player],
  ] as const) {
    if (node.textContent !== String(value)) {
      node.textContent = String(value);
      replay(team, "bump");
    }
  }
  dom.cpuTeam.classList.toggle("batting", state.half === "top");
  dom.playerTeam.classList.toggle("batting", state.half === "bottom");
  dom.inningArrow.textContent = state.half === "top" ? "▲" : "▼";
  dom.inningArrow.setAttribute("aria-label", state.half === "top" ? "Top" : "Bottom");
  dom.inningNum.textContent = String(state.inning);
  bulbs(dom.outsDots, state.outs);
  bulbs(dom.strikesDots, state.strikes);
  dom.strikesLabel.classList.toggle("count--off", state.half === "top");
}

function renderField() {
  const names = ["first", "second", "third"];
  [dom.baseFirst, dom.baseSecond, dom.baseThird].forEach((base, i) => base.classList.toggle("occupied", state.bases[i]));
  const on = names.filter((_, i) => state.bases[i]);
  dom.runnersLabel.textContent = on.length ? `Runners on ${on.join(", ")}` : "Bases empty";
}

function showMessage(text: string) {
  dom.messageBanner.textContent = text;
  replay(dom.messageBanner, "pop");
}

function hitBurst(text: string, tone: "hit" | "homer" | "out" | "bonus") {
  dom.hitBurst.textContent = text;
  dom.hitBurst.dataset.tone = tone;
  replay(dom.hitBurst, "show");
}

function showPanel(panel: "question" | "swing" | "cpu" | null) {
  dom.questionPanel.hidden = panel !== "question";
  dom.swingPanel.hidden = panel !== "swing";
  dom.cpuPanel.hidden = panel !== "cpu";
  dom.stage.classList.toggle("stage--swing", panel === "swing");
}

function renderQuestion(question: Question, onAnswer: (idx: number, btn: HTMLButtonElement) => void, bonus = false) {
  dom.subjectChip.textContent = bonus ? `Bonus · ${SUBJECT_LABELS[question.subject]}` : SUBJECT_LABELS[question.subject];
  dom.subjectChip.className = `chip chip--${question.subject}${bonus ? " chip--bonus" : ""}`;
  dom.questionPrompt.textContent = question.prompt;
  dom.choices.innerHTML = "";
  dom.choices.className = question.subject === "math" ? "choices choices--grid" : "choices choices--stack";
  question.choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.textContent = choiceText;
    if (import.meta.env.DEV) btn.dataset.correct = String(idx === question.correctIndex); // for screenshot scripts
    btn.addEventListener("click", () => onAnswer(idx, btn));
    dom.choices.appendChild(btn);
  });
  showPanel("question");
  replay(dom.questionPanel, "enter");
}

function markAnswer(question: Question, idx: number, btn: HTMLButtonElement) {
  const buttons = [...dom.choices.children] as HTMLButtonElement[];
  buttons.forEach((c) => (c.disabled = true));
  const correct = idx === question.correctIndex;
  btn.classList.add(correct ? "correct" : "incorrect");
  if (!correct) buttons[question.correctIndex].classList.add("correct");
  return correct;
}

function addPlay(text: string, tone: "out" | "hit") {
  const li = document.createElement("li");
  li.className = `pbp__item pbp__item--${tone}`;
  li.textContent = text;
  dom.playByPlay.prepend(li);
}

// ---------- CPU half-inning (auto-simulated) ----------

async function playTopHalf() {
  state.half = "top";
  state.outs = 0;
  state.bases = [false, false, false];
  dom.playByPlay.innerHTML = "";
  showPanel("cpu");
  updateHUD();
  renderField();
  await simulateCpuHalfInning();
}

async function simulateCpuHalfInning() {
  while (state.outs < 3) {
    await sleep(900);
    const outcome = randomCpuOutcome();
    if (outcome === "out") {
      state.outs++;
      showMessage("CPU batter is out.");
      addPlay(`Out! (${state.outs} out${state.outs > 1 ? "s" : ""})`, "out");
    } else {
      const runs = applyHit(outcome, state.bases);
      state.score.cpu += runs;
      showMessage(`CPU hits a ${HIT_LABELS[outcome].toLowerCase()}!${runs ? " Run scores!" : ""}`);
      addPlay(`${HIT_LABELS[outcome]}${runs ? ` — ${runs} run${runs > 1 ? "s" : ""} score` : ""}`, "hit");
    }
    updateHUD();
    renderField();
  }
  await sleep(1000);
  playBonusRound();
}

// ---------- Bonus round (between top and bottom half) ----------

function playBonusRound() {
  showMessage("Bonus Round! Answer to earn an extra run.");
  const question = getRandomQuestion(levelConfig(), "vocab");
  renderQuestion(
    question,
    (idx, btn) => {
      const correct = markAnswer(question, idx, btn);
      state.stats.vocab.total++;
      if (correct) {
        state.stats.vocab.correct++;
        state.score.player += 1;
        showMessage("Correct! Bonus run scored!");
        hitBurst("+1 Run!", "bonus");
      } else {
        showMessage("Not quite — no bonus run this time.");
      }
      updateHUD();
      setTimeout(playBottomHalf, 1600);
    },
    true
  );
}

// ---------- Player half-inning ----------

function playBottomHalf() {
  state.half = "bottom";
  state.outs = 0;
  state.strikes = 0;
  state.bases = [false, false, false];
  updateHUD();
  renderField();
  showMessage(`Bottom of inning ${state.inning} — you're up!`);
  nextPitch();
}

function nextPitch() {
  const question = getRandomQuestion(levelConfig());
  renderQuestion(question, (idx, btn) => onAnswer(idx, btn, question));
}

async function onAnswer(idx: number, btn: HTMLButtonElement, question: Question) {
  const correct = markAnswer(question, idx, btn);
  const subject = question.subject;
  state.stats[subject].total++;

  if (correct) {
    state.stats[subject].correct++;
    showMessage("Correct! Get ready to swing!");
    await sleep(900);
    resolveSwing(await takeSwing());
    return;
  }

  state.strikes++;
  if (state.strikes >= 3) {
    state.outs++;
    state.strikes = 0;
    showMessage("Strikeout!");
    hitBurst("Strikeout!", "out");
  } else {
    showMessage("Strike!");
  }

  updateHUD();
  renderField();

  setTimeout(() => {
    if (state.outs >= 3) {
      endBottomHalf();
    } else {
      nextPitch();
    }
  }, 1400);
}

async function takeSwing(): Promise<PitchResult> {
  if (stageFailed) return { outcome: classifySwing(30 + Math.random() * 40), swung: true };
  showPanel("swing");
  dom.swingBtn.focus({ preventScroll: true });
  showMessage("Here's the pitch…");
  const { playPitch } = await stage;
  const result = await playPitch({ pitchMs: levelConfig().swingSpeedMs, classify: classifySwing });
  showPanel(null);
  return result;
}

function resolveSwing({ outcome, swung }: PitchResult) {
  if (outcome === "strike") {
    const what = swung ? "Swing and a miss" : "Strike — you didn't swing";
    state.strikes++;
    if (state.strikes >= 3) {
      state.outs++;
      state.strikes = 0;
      showMessage(`${what} — strikeout!`);
      hitBurst("Strikeout!", "out");
    } else {
      showMessage(`${what}!`);
    }
  } else {
    const runs = applyHit(outcome, state.bases);
    state.score.player += runs;
    showMessage(runs ? `${runs} run${runs > 1 ? "s" : ""} score${runs > 1 ? "" : "s"}!` : "Nice hit!");
    hitBurst(`${HIT_LABELS[outcome]}!`, outcome === "homerun" ? "homer" : "hit");
    if (outcome === "homerun") celebrate(true);
    state.strikes = 0;
  }

  updateHUD();
  renderField();

  setTimeout(() => {
    if (state.outs >= 3) {
      endBottomHalf();
    } else {
      nextPitch();
    }
  }, 1400);
}

function endBottomHalf() {
  if (state.inning >= MAX_INNINGS) {
    endGame();
  } else {
    state.inning++;
    showMessage(`Top of inning ${state.inning} — CPU is up!`);
    playTopHalf();
  }
}

// ---------- Game over ----------

function endGame() {
  showPanel(null);
  showScreen("gameover");

  const { player, cpu } = state.score;
  let title: string;
  if (player > cpu) title = `${state.playerName} wins!`;
  else if (cpu > player) title = "CPU wins. Good game!";
  else title = "It's a tie!";
  dom.gameoverTitle.textContent = title;
  dom.gameoverArt.textContent = player > cpu ? "\u{1F3C6}" : player < cpu ? "\u{1F91D}" : "\u{26BE}";
  dom.gameoverArt.dataset.result = player > cpu ? "win" : player < cpu ? "loss" : "tie";
  dom.gameoverScore.innerHTML = `
    <span class="final-score__team final-score__team--you"><span></span>${player}</span>
    <span class="final-score__dash">–</span>
    <span class="final-score__team final-score__team--cpu">${cpu}<span>CPU</span></span>`;
  dom.gameoverScore.querySelector(".final-score__team--you span")!.textContent = state.playerName;
  if (player > cpu) setTimeout(() => celebrate(true), 250);

  const lifetime = saveLifetimeStats(state.stats);
  dom.gameoverStats.innerHTML = (Object.keys(state.stats) as Subject[])
    .map((subject) => {
      const g = state.stats[subject];
      const l = lifetime[subject];
      return `
      <div class="result-row result-row--${subject}">
        <span class="result-row__name">${SUBJECT_LABELS[subject]}</span>
        <span class="result-row__label">This game</span>
        <strong class="result-row__value">${g.correct}/${g.total}</strong>
        <span class="meter"><span style="width:${pct(g)}%"></span></span>
        <span class="result-row__label">Lifetime</span>
        <strong class="result-row__value">${pct(l)}%</strong>
        <span class="meter meter--soft"><span style="width:${pct(l)}%"></span></span>
      </div>`;
    })
    .join("");
}

// ---------- Wire up ----------

export function wireControls() {
  dom.nameInput.addEventListener("input", updatePlayButtonState);
  dom.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !dom.playBallBtn.disabled) startGame();
  });
  dom.playBallBtn.addEventListener("click", startGame);
  dom.playAgainBtn.addEventListener("click", initSetupScreen);

  // Swings use the input's own timestamp, so a slow frame can't make them late.
  const swing = (e: Event) => stage.then((s) => s.swing(e.timeStamp));
  dom.swingBtn.addEventListener("pointerdown", swing);
  dom.swingBtn.addEventListener("click", swing);
  dom.stage.addEventListener("pointerdown", (e) => {
    if (!dom.swingPanel.hidden) swing(e);
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !dom.swingPanel.hidden) {
      e.preventDefault();
      if (!e.repeat) swing(e);
    }
  });
}
