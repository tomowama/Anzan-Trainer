
const LEVELS = {
  6: { mitori_terms: 5, mitori_total_digits: 6, mitori_exact_digits: null, kake_total_digits: 3, wari_total_digits: 3 },
  5: { mitori_terms: 5, mitori_total_digits: 8, mitori_exact_digits: null, kake_total_digits: 3, wari_total_digits: 3 },
  4: { mitori_terms: 5, mitori_total_digits: null, mitori_exact_digits: 2, kake_total_digits: 3, wari_total_digits: 3 },
  3: { mitori_terms: 5, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 4, wari_total_digits: 4 },
  2: { mitori_terms: 7, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 4, wari_total_digits: 4 },
  1: { mitori_terms: 10, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 5, wari_total_digits: 5 }
};

const DEFAULT_COUNTS = {
  6: [24, 18, 18],
  5: [24, 18, 18],
  4: [22, 18, 18],
  3: [20, 20, 20],
  2: [18, 20, 20],
  1: [16, 20, 20]
};

const els = {
  setupScreen: document.getElementById("setup-screen"),
  quizScreen: document.getElementById("quiz-screen"),
  doneScreen: document.getElementById("done-screen"),
  level: document.getElementById("level"),
  seed: document.getElementById("seed"),
  day: document.getElementById("day"),
  feedbackPause: document.getElementById("feedbackPause"),
  mitoriCount: document.getElementById("mitoriCount"),
  kakeCount: document.getElementById("kakeCount"),
  wariCount: document.getElementById("wariCount"),
  redoMisses: document.getElementById("redoMisses"),
  shuffleQuestions: document.getElementById("shuffleQuestions"),
  startBtn: document.getElementById("startBtn"),
  quitBtn: document.getElementById("quitBtn"),
  againBtn: document.getElementById("againBtn"),
  repeatBtn: document.getElementById("repeatBtn"),
  progressText: document.getElementById("progressText"),
  accuracyText: document.getElementById("accuracyText"),
  roundText: document.getElementById("roundText"),
  categoryPill: document.getElementById("categoryPill"),
  questionIndexPill: document.getElementById("questionIndexPill"),
  questionText: document.getElementById("questionText"),
  answerForm: document.getElementById("answerForm"),
  answerDisplay: document.getElementById("answerDisplay"),
  submitBtn: document.getElementById("submitBtn"),
  feedbackBanner: document.getElementById("feedbackBanner"),
  doneSummary: document.getElementById("doneSummary"),
  mistakeSummary: document.getElementById("mistakeSummary")
};

let state = {
  settings: null,
  problems: [],
  queue: [],
  redoQueue: [],
  current: null,
  cursor: 0,
  shown: 0,
  firstPassCorrect: 0,
  attempts: 0,
  misses: 0,
  answerText: ""
};

function showScreen(name) {
  for (const screen of [els.setupScreen, els.quizScreen, els.doneScreen]) {
    screen.classList.remove("active");
  }
  if (name === "setup") els.setupScreen.classList.add("active");
  if (name === "quiz") els.quizScreen.classList.add("active");
  if (name === "done") els.doneScreen.classList.add("active");
}

function saveSettings() {
  if (!state.settings) return;
  localStorage.setItem("anzanTrainerSettings", JSON.stringify(state.settings));
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem("anzanTrainerSettings");
    if (!raw) return;
    const s = JSON.parse(raw);
    els.level.value = String(s.level ?? 6);
    els.seed.value = s.seed ?? "";
    els.day.value = String(s.day ?? 1);
    els.feedbackPause.value = String(s.feedbackPause ?? 0.3);
    els.mitoriCount.value = s.mitoriCount ?? "";
    els.kakeCount.value = s.kakeCount ?? "";
    els.wariCount.value = s.wariCount ?? "";
    els.redoMisses.checked = s.redoMisses ?? true;
    els.shuffleQuestions.checked = s.shuffleQuestions ?? true;
  } catch {}
}

function applyDefaultsForLevel(level) {
  const [s, m, d] = DEFAULT_COUNTS[level];
  els.mitoriCount.value = s;
  els.kakeCount.value = m;
  els.wariCount.value = d;
}

function applyDoubleForLevel(level) {
  const [s, m, d] = DEFAULT_COUNTS[level];
  els.mitoriCount.value = s * 2;
  els.kakeCount.value = m * 2;
  els.wariCount.value = d * 2;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class RNG {
  constructor(seed) {
    this.rand = mulberry32(seed >>> 0);
  }
  random() { return this.rand(); }
  randint(lo, hi) {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }
  choice(arr) {
    return arr[this.randint(0, arr.length - 1)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randint(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

function lowerForDigits(d) { return d === 1 ? 1 : 10 ** (d - 1); }
function upperForDigits(d) { return 10 ** d - 1; }
function randWithDigits(rng, d, allowZero=false) {
  const lo = allowZero ? 0 : lowerForDigits(d);
  const hi = upperForDigits(d);
  return rng.randint(lo, hi);
}
function randomComposition(rng, total, parts, low, high) {
  const vals = Array(parts).fill(low);
  let remaining = total - low * parts;
  const capacities = Array(parts).fill(high - low);
  while (remaining > 0) {
    const i = rng.randint(0, parts - 1);
    if (capacities[i] > 0) {
      vals[i] += 1;
      capacities[i] -= 1;
      remaining -= 1;
    }
  }
  return rng.shuffle(vals);
}
function mitoriDigitPattern(rng, level) {
  const cfg = LEVELS[level];
  if (cfg.mitori_exact_digits !== null) return Array(cfg.mitori_terms).fill(cfg.mitori_exact_digits);
  return randomComposition(rng, cfg.mitori_total_digits, cfg.mitori_terms, 1, 2);
}

function generateMitori(level, rng) {
  const digits = mitoriDigitPattern(rng, level);
  const terms = [];
  const signs = [];
  let current = randWithDigits(rng, digits[0]);
  terms.push(current);
  signs.push(1);
  for (let i = 1; i < digits.length; i++) {
    const d = digits[i];
    const lo = lowerForDigits(d);
    const hi = upperForDigits(d);
    const doSub = rng.random() < 0.35;
    let value;
    if (doSub && current >= lo) {
      value = rng.randint(lo, Math.min(hi, current));
      current -= value;
      signs.push(-1);
    } else {
      value = rng.randint(lo, hi);
      current += value;
      signs.push(1);
    }
    terms.push(value);
  }
  let prompt = String(terms[0]);
  for (let i = 1; i < terms.length; i++) {
    prompt += (signs[i] > 0 ? "+" : "-") + String(terms[i]);
  }
  return { category: "mitori", prompt, answer: String(current) };
}

function generateKake(level, rng) {
  const total = LEVELS[level].kake_total_digits;
  let a, b;
  if (total === 3) {
    if (rng.random() < 0.5) {
      a = rng.randint(2, 9);
      b = randWithDigits(rng, 2);
    } else {
      a = randWithDigits(rng, 2);
      b = rng.randint(2, 9);
    }
  } else if (total === 4) {
    const [da, db] = rng.choice([[1, 3], [3, 1], [2, 2]]);
    a = da === 1 ? rng.randint(2, 9) : randWithDigits(rng, da);
    b = db === 1 ? rng.randint(2, 9) : randWithDigits(rng, db);
  } else {
    const [da, db] = rng.choice([[1, 4], [4, 1], [2, 3], [3, 2]]);
    a = randWithDigits(rng, da);
    b = randWithDigits(rng, db);
  }
  return { category: "kake", prompt: `${a}×${b}`, answer: String(a * b) };
}

function generateWari(level, rng) {
  const total = LEVELS[level].wari_total_digits;
  let divisor, quotient;
  if (total === 3) {
    divisor = rng.randint(2, 9);
    quotient = randWithDigits(rng, 2);
  } else if (total === 4) {
    if (rng.random() < 0.65) {
      divisor = randWithDigits(rng, 2);
      quotient = randWithDigits(rng, 2);
    } else {
      divisor = rng.randint(2, 9);
      quotient = randWithDigits(rng, 3);
    }
  } else {
    const [dDigits, qDigits] = rng.choice([[1, 4], [2, 3], [3, 2], [4, 1]]);
    divisor = dDigits === 1 ? rng.randint(2, 9) : randWithDigits(rng, dDigits);
    quotient = randWithDigits(rng, qDigits);
  }
  const dividend = divisor * quotient;
  return { category: "wari", prompt: `${dividend}÷${divisor}`, answer: String(quotient) };
}

function generateDay(level, mitoriCount, kakeCount, wariCount, rng) {
  const problems = [];
  for (let i = 0; i < mitoriCount; i++) problems.push(generateMitori(level, rng));
  for (let i = 0; i < kakeCount; i++) problems.push(generateKake(level, rng));
  for (let i = 0; i < wariCount; i++) problems.push(generateWari(level, rng));
  return rng.shuffle(problems);
}

function parseSettings() {
  const level = Number(els.level.value);
  const defaults = DEFAULT_COUNTS[level];
  const mitoriCount = Number(els.mitoriCount.value || defaults[0]);
  const kakeCount = Number(els.kakeCount.value || defaults[1]);
  const wariCount = Number(els.wariCount.value || defaults[2]);
  const rawSeed = (els.seed.value || "").trim();
  const day = Math.max(1, Number(els.day.value || 1));
  const feedbackPause = Number(els.feedbackPause.value || 0.8);
  return {
    level,
    seed: rawSeed || `session-${Date.now()}`,
    seedWasBlank: rawSeed === "",
    day,
    feedbackPause,
    mitoriCount,
    kakeCount,
    wariCount,
    redoMisses: els.redoMisses.checked,
    shuffleQuestions: els.shuffleQuestions.checked
  };
}

function buildProblemSet(settings) {
  const baseSeed = hashSeed(settings.seed);
  const daySeed = hashSeed(`${baseSeed}|${settings.level}|${settings.day}`);
  const rng = new RNG(daySeed);

  const problems = generateDay(
    settings.level,
    settings.mitoriCount,
    settings.kakeCount,
    settings.wariCount,
    rng
  );
  if (!settings.shuffleQuestions) {
    problems.sort((a, b) => a.category.localeCompare(b.category));
  }
  return problems.map((p, i) => ({ ...p, idx: i + 1, round_no: 1 }));
}

function startSession(reuseCurrent=false) {
  const settings = reuseCurrent && state.settings ? state.settings : parseSettings();
  state.settings = settings;
  saveSettings();
  if (!reuseCurrent && settings.seedWasBlank) {
    // keep the UI blank for "fresh session" behavior, but preserve the actual
    // session seed internally so "Run same settings again" repeats the set.
  } else {
    els.seed.value = settings.seed;
  }

  const problems = buildProblemSet(settings);
  state.problems = problems;
  state.queue = [...problems];
  state.redoQueue = [];
  state.current = null;
  state.cursor = 0;
  state.shown = 0;
  state.firstPassCorrect = 0;
  state.attempts = 0;
  state.misses = 0;
  state.answerText = "";

  showScreen("quiz");
  nextQuestion();
}

function nextQuestion() {
  if (state.queue.length === 0) {
    if (state.settings.redoMisses && state.redoQueue.length > 0) {
      for (const item of state.redoQueue) item.round_no += 1;
      state.queue = [...state.redoQueue];
      state.redoQueue = [];
    } else {
      finishSession();
      return;
    }
  }
  state.current = state.queue.shift();
  state.shown += 1;
  renderCurrent();
  state.answerText = "";
  renderAnswer();
}

function categoryName(cat) {
  return cat === "mitori" ? "MITORI" : cat === "kake" ? "KAKE" : "WARI";
}

function renderCurrent() {
  const total = state.problems.length + state.misses;
  const done = state.attempts;
  const firstPassTotal = state.problems.length;
  const accuracy = done === 0 ? 100 : Math.round((state.firstPassCorrect / Math.min(done, firstPassTotal)) * 100);
  els.progressText.textContent = `${Math.min(done + 1, total)} / ${total}`;
  els.accuracyText.textContent = `First-pass accuracy: ${accuracy}%`;
  els.roundText.textContent = `Round ${state.current.round_no}`;
  els.categoryPill.textContent = categoryName(state.current.category);
  els.questionIndexPill.textContent = `#${state.current.idx}`;
  els.questionText.textContent = state.current.prompt;
  hideFeedback();
}

function renderAnswer() {
  els.answerDisplay.textContent = state.answerText === "" ? "__" : state.answerText;
  els.answerDisplay.classList.toggle("placeholder", state.answerText === "");
}

function showFeedback(ok, text) {
  els.feedbackBanner.textContent = text;
  els.feedbackBanner.classList.remove("hidden", "good", "bad");
  els.feedbackBanner.classList.add(ok ? "good" : "bad");
}
function hideFeedback() {
  els.feedbackBanner.textContent = "";
  els.feedbackBanner.classList.add("hidden");
  els.feedbackBanner.classList.remove("good", "bad");
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function submitAnswer() {
  if (!state.current) return;
  const given = state.answerText.trim();
  if (!given) return;
  const correct = state.current.answer;
  const ok = given === correct;
  state.attempts += 1;
  if (state.current.round_no === 1 && ok) state.firstPassCorrect += 1;
  if (!ok) {
    state.misses += 1;
    if (state.settings.redoMisses) {
      state.redoQueue.push({ ...state.current });
    }
  }
  showFeedback(ok, ok ? "Correct" : `Wrong — ${correct}`);
  if (state.settings.feedbackPause > 0) {
    await sleep(state.settings.feedbackPause * 1000);
  }
  nextQuestion();
}

function finishSession() {
  const total = state.problems.length;
  const firstPassPct = Math.round((state.firstPassCorrect / total) * 100);
  els.doneSummary.textContent = `First pass: ${state.firstPassCorrect}/${total} correct (${firstPassPct}%). Total attempts: ${state.attempts}.`;
  if (state.misses > 0) {
    els.mistakeSummary.textContent = state.settings.redoMisses
      ? `You missed ${state.misses} question${state.misses === 1 ? "" : "s"} during the run and they were recycled until correct.`
      : `You missed ${state.misses} question${state.misses === 1 ? "" : "s"}.`;
  } else {
    els.mistakeSummary.textContent = "Perfect session.";
  }
  showScreen("done");
}

els.submitBtn.addEventListener("click", () => {
  submitAnswer();
});

document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const level = Number(els.level.value);
    if (btn.dataset.preset === "defaults") applyDefaultsForLevel(level);
    if (btn.dataset.preset === "double") applyDoubleForLevel(level);
  });
});

els.level.addEventListener("change", () => applyDefaultsForLevel(Number(els.level.value)));
els.startBtn.addEventListener("click", () => startSession(false));
els.quitBtn.addEventListener("click", () => showScreen("setup"));
els.againBtn.addEventListener("click", () => showScreen("setup"));
els.repeatBtn.addEventListener("click", () => startSession(true));

document.querySelectorAll(".keypad .key").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    if (key === "back") {
      state.answerText = state.answerText.slice(0, -1);
    } else if (key === "clear") {
      state.answerText = "";
    } else {
      state.answerText += key;
    }
    renderAnswer();
  });
});

document.addEventListener("keydown", (e) => {
  if (!els.quizScreen.classList.contains("active")) return;
  if (/^[0-9]$/.test(e.key)) {
    state.answerText += e.key;
    renderAnswer();
    e.preventDefault();
  } else if (e.key === "Backspace") {
    state.answerText = state.answerText.slice(0, -1);
    renderAnswer();
    e.preventDefault();
  } else if (e.key === "Escape") {
    state.answerText = "";
    renderAnswer();
    e.preventDefault();
  } else if (e.key === "Enter") {
    submitAnswer();
    e.preventDefault();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

loadSavedSettings();
if (!els.mitoriCount.value) applyDefaultsForLevel(Number(els.level.value));
