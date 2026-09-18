// Game state machine: setup -> playing (top/bottom halves x N innings) -> game over.

const MAX_INNINGS = 3;
const LS_NAME = "hh_playerName";
const LS_LEVEL = "hh_level";
const LS_STATS = "hh_lifetime_stats";

const el = (id) => document.getElementById(id);

const dom = {
  setupScreen: el("setup-screen"),
  gameScreen: el("game-screen"),
  gameoverScreen: el("gameover-screen"),
  nameInput: el("player-name"),
  levelSelect: el("level-select"),
  playBallBtn: el("play-ball-btn"),
  lifetimeStats: el("lifetime-stats"),
  cpuScoreLabel: el("cpu-score-label"),
  playerScoreLabel: el("player-score-label"),
  inningLabel: el("inning-label"),
  outsDots: el("outs-dots"),
  strikesLabel: el("strikes-label"),
  strikesDots: el("strikes-dots"),
  baseFirst: el("base-first"),
  baseSecond: el("base-second"),
  baseThird: el("base-third"),
  messageBanner: el("message-banner"),
  questionPanel: el("question-panel"),
  questionPrompt: el("question-prompt"),
  choices: el("choices"),
  swingPanel: el("swing-panel"),
  swingTrack: el("swing-track"),
  swingMarker: el("swing-marker"),
  swingBtn: el("swing-btn"),
  bat: el("bat"),
  gameoverTitle: el("gameover-title"),
  gameoverStats: el("gameover-stats"),
  playAgainBtn: el("play-again-btn"),
};

let state = null;

function freshStats() {
  return {
    math: { correct: 0, total: 0 },
    spelling: { correct: 0, total: 0 },
    vocab: { correct: 0, total: 0 },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScreen(name) {
  dom.setupScreen.hidden = name !== "setup";
  dom.gameScreen.hidden = name !== "game";
  dom.gameoverScreen.hidden = name !== "gameover";
}

// ---------- Setup screen ----------

function loadLifetimeStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    return raw ? JSON.parse(raw) : freshStats();
  } catch (e) {
    return freshStats();
  }
}

function saveLifetimeStats(gameStats) {
  const lifetime = loadLifetimeStats();
  for (const subject of Object.keys(gameStats)) {
    lifetime[subject].correct += gameStats[subject].correct;
    lifetime[subject].total += gameStats[subject].total;
  }
  try {
    localStorage.setItem(LS_STATS, JSON.stringify(lifetime));
  } catch (e) {
    // ignore storage failures (e.g. private browsing)
  }
  return lifetime;
}

function renderLifetimeStats() {
  const stats = loadLifetimeStats();
  const rows = Object.keys(stats)
    .map((subject) => {
      const s = stats[subject];
      if (s.total === 0) return null;
      const pct = Math.round((s.correct / s.total) * 100);
      const label = subject.charAt(0).toUpperCase() + subject.slice(1);
      return `<div>${label}: ${s.correct}/${s.total} correct (${pct}%)</div>`;
    })
    .filter(Boolean);
  dom.lifetimeStats.innerHTML = rows.length
    ? `<p class="section-label">Lifetime practice stats</p>${rows.join("")}`
    : "";
}

function populateLevelSelect() {
  dom.levelSelect.innerHTML = "";
  Object.keys(LEVELS).forEach((levelId) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "level-btn";
    btn.textContent = LEVELS[levelId].label;
    btn.dataset.level = levelId;
    btn.addEventListener("click", () => {
      [...dom.levelSelect.children].forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      dom.levelSelect.dataset.selected = levelId;
      updatePlayButtonState();
    });
    dom.levelSelect.appendChild(btn);
  });

  const savedLevel = localStorage.getItem(LS_LEVEL);
  if (savedLevel && LEVELS[savedLevel]) {
    const match = [...dom.levelSelect.children].find((c) => c.dataset.level === savedLevel);
    if (match) match.click();
  }
}

function updatePlayButtonState() {
  const hasName = dom.nameInput.value.trim().length > 0;
  const hasLevel = !!dom.levelSelect.dataset.selected;
  dom.playBallBtn.disabled = !(hasName && hasLevel);
}

function initSetupScreen() {
  dom.nameInput.value = localStorage.getItem(LS_NAME) || "";
  populateLevelSelect();
  renderLifetimeStats();
  updatePlayButtonState();
  showScreen("setup");
}

// ---------- Game setup ----------

function startGame() {
  const name = dom.nameInput.value.trim();
  const level = dom.levelSelect.dataset.selected;
  localStorage.setItem(LS_NAME, name);
  localStorage.setItem(LS_LEVEL, level);

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

  dom.strikesLabel.hidden = true;
  showScreen("game");
  updateHUD();
  renderField();
  showMessage(`Top of inning 1 — CPU is up!`);
  playTopHalf();
}

function levelConfig() {
  return LEVELS[state.level];
}

// ---------- Rendering ----------

function updateHUD() {
  dom.cpuScoreLabel.textContent = `CPU ${state.score.cpu}`;
  dom.playerScoreLabel.textContent = `You ${state.score.player}`;
  const halfLabel = state.half === "top" ? "Top" : "Bottom";
  dom.inningLabel.textContent = `${halfLabel} ${state.inning}`;
  dom.outsDots.textContent = "●".repeat(state.outs) + "○".repeat(3 - state.outs);
  dom.strikesDots.textContent = "●".repeat(state.strikes) + "○".repeat(3 - state.strikes);
}

function renderField() {
  dom.baseFirst.classList.toggle("occupied", state.bases[0]);
  dom.baseSecond.classList.toggle("occupied", state.bases[1]);
  dom.baseThird.classList.toggle("occupied", state.bases[2]);
}

function showMessage(text) {
  dom.messageBanner.textContent = text;
}

function renderQuestion(question, onAnswer) {
  dom.questionPrompt.textContent = question.prompt;
  dom.choices.innerHTML = "";
  question.choices.forEach((choiceText, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.textContent = choiceText;
    btn.addEventListener("click", () => onAnswer(idx, btn));
    dom.choices.appendChild(btn);
  });
  dom.questionPanel.hidden = false;
}

function hideQuestion() {
  dom.questionPanel.hidden = true;
}

// ---------- Baseball logic ----------

function applyHit(hitType, teamKey) {
  const b = state.bases;
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

  state.score[teamKey] += runs;
  return runs;
}

function weightedPick(options) {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of options) {
    if (roll < o.weight) return o.value;
    roll -= o.weight;
  }
  return options[options.length - 1].value;
}

function randomCpuOutcome() {
  return weightedPick([
    { value: "out", weight: 55 },
    { value: "single", weight: 25 },
    { value: "double", weight: 10 },
    { value: "triple", weight: 5 },
    { value: "homerun", weight: 5 },
  ]);
}

// ---------- Swing meter (player timing minigame) ----------

let swingAnimId = null;
let swingPos = 50;

function classifySwing(pos) {
  const dist = Math.abs(pos - 50);
  if (dist <= 5) {
    return weightedPick([
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

function startSwingMeter(onResult) {
  const periodMs = levelConfig().swingSpeedMs || 1500;
  const startTime = performance.now();
  dom.bat.classList.remove("swinging");
  dom.swingPanel.hidden = false;

  function animate(now) {
    const phase = ((now - startTime) % periodMs) / periodMs;
    swingPos = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) * 50;
    dom.swingMarker.style.left = `${swingPos}%`;
    swingAnimId = requestAnimationFrame(animate);
  }
  swingAnimId = requestAnimationFrame(animate);

  function handleSwing() {
    cancelAnimationFrame(swingAnimId);
    dom.swingBtn.removeEventListener("click", handleSwing);
    dom.bat.classList.add("swinging");
    const outcome = classifySwing(swingPos);
    setTimeout(() => {
      dom.swingPanel.hidden = true;
      onResult(outcome);
    }, 250);
  }
  dom.swingBtn.addEventListener("click", handleSwing);
}

// ---------- CPU half-inning (auto-simulated) ----------

async function playTopHalf() {
  state.half = "top";
  state.outs = 0;
  state.bases = [false, false, false];
  dom.strikesLabel.hidden = true;
  hideQuestion();
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
    } else {
      const runs = applyHit(outcome, "cpu");
      showMessage(`CPU hits a ${outcome}!${runs ? " Run scores!" : ""}`);
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
  renderQuestion(question, (idx, btn) => {
    [...dom.choices.children].forEach((c) => (c.disabled = true));
    const correct = idx === question.correctIndex;
    state.stats.vocab.total++;
    btn.classList.add(correct ? "correct" : "incorrect");
    if (correct) {
      state.stats.vocab.correct++;
      state.score.player += 1;
      showMessage("Correct! Bonus run scored!");
    } else {
      dom.choices.children[question.correctIndex].classList.add("correct");
      showMessage("Not quite — no bonus run this time.");
    }
    updateHUD();
    setTimeout(() => {
      hideQuestion();
      playBottomHalf();
    }, 1600);
  });
}

// ---------- Player half-inning ----------

function playBottomHalf() {
  state.half = "bottom";
  state.outs = 0;
  state.strikes = 0;
  state.bases = [false, false, false];
  dom.strikesLabel.hidden = false;
  updateHUD();
  renderField();
  showMessage(`Bottom of inning ${state.inning} — you're up!`);
  nextPitch();
}

function nextPitch() {
  const question = getRandomQuestion(levelConfig());
  renderQuestion(question, (idx, btn) => onAnswer(idx, btn, question));
}

function onAnswer(idx, btn, question) {
  [...dom.choices.children].forEach((c) => (c.disabled = true));
  const correct = idx === question.correctIndex;
  const subject = question.subject;
  state.stats[subject].total++;

  btn.classList.add(correct ? "correct" : "incorrect");
  if (!correct) {
    dom.choices.children[question.correctIndex].classList.add("correct");
  }

  if (correct) {
    state.stats[subject].correct++;
    showMessage("Correct! Get ready to swing!");
    setTimeout(() => {
      hideQuestion();
      startSwingMeter(resolveSwing);
    }, 900);
    return;
  }

  state.strikes++;
  if (state.strikes >= 3) {
    state.outs++;
    state.strikes = 0;
    showMessage("Strikeout!");
  } else {
    showMessage("Strike!");
  }

  updateHUD();
  renderField();

  setTimeout(() => {
    hideQuestion();
    if (state.outs >= 3) {
      endBottomHalf();
    } else {
      nextPitch();
    }
  }, 1400);
}

function resolveSwing(outcome) {
  if (outcome === "strike") {
    state.strikes++;
    if (state.strikes >= 3) {
      state.outs++;
      state.strikes = 0;
      showMessage("Swing and a miss — strikeout!");
    } else {
      showMessage("Swing and a miss!");
    }
  } else {
    const runs = applyHit(outcome, "player");
    showMessage(`${outcome.toUpperCase()}! ${runs ? "Run(s) score!" : "Nice hit!"}`);
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
    playTopHalf();
  }
}

// ---------- Game over ----------

function endGame() {
  hideQuestion();
  showScreen("gameover");

  const { player, cpu } = state.score;
  let title;
  if (player > cpu) title = `${state.playerName} wins ${player}-${cpu}! \u{1F3C6}`;
  else if (cpu > player) title = `CPU wins ${cpu}-${player}. Good game!`;
  else title = `It's a tie, ${player}-${cpu}!`;
  dom.gameoverTitle.textContent = title;

  const lifetime = saveLifetimeStats(state.stats);

  const rows = Object.keys(state.stats).map((subject) => {
    const g = state.stats[subject];
    const l = lifetime[subject];
    const label = subject.charAt(0).toUpperCase() + subject.slice(1);
    const gamePct = g.total ? Math.round((g.correct / g.total) * 100) : 0;
    const lifePct = l.total ? Math.round((l.correct / l.total) * 100) : 0;
    return `<div><strong>${label}:</strong> this game ${g.correct}/${g.total} (${gamePct}%) &middot; lifetime ${l.correct}/${l.total} (${lifePct}%)</div>`;
  });
  dom.gameoverStats.innerHTML = rows.join("");
}

// ---------- Wire up ----------

dom.nameInput.addEventListener("input", updatePlayButtonState);
dom.playBallBtn.addEventListener("click", startGame);
dom.playAgainBtn.addEventListener("click", initSetupScreen);

initSetupScreen();
