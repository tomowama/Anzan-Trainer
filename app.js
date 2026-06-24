import { FIREBASE_CONFIG } from "./firebase-config.js";


const LEVELS = {
  6: { mitori_terms: 5, mitori_total_digits: 6, mitori_exact_digits: null, kake_total_digits: 3, wari_total_digits: 3 },
  5: { mitori_terms: 5, mitori_total_digits: 8, mitori_exact_digits: null, kake_total_digits: 3, wari_total_digits: 3 },
  4: { mitori_terms: 5, mitori_total_digits: null, mitori_exact_digits: 2, kake_total_digits: 3, wari_total_digits: 3 },
  3: { mitori_terms: 5, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 4, wari_total_digits: 4 },
  2: { mitori_terms: 7, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 4, wari_total_digits: 4 },
  1: { mitori_terms: 10, mitori_total_digits: null, mitori_exact_digits: 3, kake_total_digits: 5, wari_total_digits: 5 }
};

const DEFAULT_COUNTS = {
  6: [20, 30, 30],
  5: [20, 30, 30],
  4: [20, 30, 30],
  3: [20, 30, 30],
  2: [20, 30, 30],
  1: [20, 30, 30]
};

const VOLUME_PRESETS = {
  16: [4, 6, 6],
  32: [8, 12, 12],
  48: [12, 18, 18],
  64: [16, 24, 24],
  80: [20, 30, 30]
};

const els = {
  setupScreen: document.getElementById("setup-screen"),
  quizScreen: document.getElementById("quiz-screen"),
  doneScreen: document.getElementById("done-screen"),
  level: document.getElementById("level"),
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
  todayCount: document.getElementById("todayCount"),
  todayTime: document.getElementById("todayTime"),
  streakText: document.getElementById("streakText"),
  totalProblems: document.getElementById("totalProblems"),
  totalTime: document.getElementById("totalTime"),
  syncStatus: document.getElementById("syncStatus"),
  signInBtn: document.getElementById("signInBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
  heatmapTitle: document.getElementById("heatmapTitle"),
  heatmapGrid: document.getElementById("heatmapGrid"),
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
  answerText: "",
  questionStartedAt: null
};

const LEGACY_DAILY_STATS_KEY = "anzanDailyStatsV1";
const STATS_HISTORY_KEY = "anzanStatsHistoryV2";
const PENDING_SYNC_KEY = "anzanPendingSyncV1";

let statsHistory = loadStatsHistory();
let firebaseReady = false;
let firebaseUser = null;
let firebaseTools = null;
let cloudSyncInProgress = false;

function trainingDayKey(date = new Date()) {
  // Training day resets at 4:00 AM local time.
  const d = new Date(date);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDayStats(value = {}) {
  return {
    problems: Number(value.problems ?? value.completed ?? 0) || 0,
    activeMs: Number(value.activeMs || 0) || 0
  };
}

function loadStatsHistory() {
  let history = { days: {}, updatedAt: Date.now() };
  try {
    const raw = localStorage.getItem(STATS_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.days && typeof parsed.days === "object") {
        history.days = {};
        for (const [day, value] of Object.entries(parsed.days)) {
          history.days[day] = normalizeDayStats(value);
        }
        history.updatedAt = Number(parsed.updatedAt || Date.now());
        return history;
      }
    }
  } catch {}

  // One-time migration from the earlier single-day storage format.
  try {
    const legacyRaw = localStorage.getItem(LEGACY_DAILY_STATS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy && legacy.dayKey) history.days[legacy.dayKey] = normalizeDayStats(legacy);
    }
  } catch {}
  return history;
}

function saveStatsHistory(history = statsHistory) {
  history.updatedAt = Date.now();
  localStorage.setItem(STATS_HISTORY_KEY, JSON.stringify(history));
}

function getPendingSync() {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePendingSync(pending) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending));
}

function addPendingSync(dayKey, problems = 0, activeMs = 0) {
  if (!firebaseReady || !firebaseUser) return;
  const pending = getPendingSync();
  const current = normalizeDayStats(pending[dayKey]);
  current.problems += problems;
  current.activeMs += activeMs;
  pending[dayKey] = current;
  savePendingSync(pending);
  flushPendingSync();
}

function getDayStats(dayKey = trainingDayKey()) {
  return normalizeDayStats(statsHistory.days[dayKey]);
}

function getTotals() {
  let problems = 0;
  let activeMs = 0;
  for (const value of Object.values(statsHistory.days)) {
    const stats = normalizeDayStats(value);
    problems += stats.problems;
    activeMs += stats.activeMs;
  }
  return { problems, activeMs };
}

function isActiveDay(dayKey) {
  const stats = getDayStats(dayKey);
  return stats.problems > 0 || stats.activeMs > 0;
}

function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentStreak() {
  let streak = 0;
  let d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  while (true) {
    const key = dateKey(d);
    if (!isActiveDay(key)) break;
    streak += 1;
    d = addDays(d, -1);
  }
  return streak;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationLong(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function heatLevel(stats) {
  const minutes = stats.activeMs / 60000;
  if (stats.problems <= 0 && stats.activeMs <= 0) return 0;
  if (minutes < 5) return 1;
  if (minutes < 15) return 2;
  if (minutes < 30) return 3;
  return 4;
}

function renderHeatmap(year = new Date().getFullYear()) {
  if (!els.heatmapGrid) return;
  els.heatmapGrid.innerHTML = "";
  if (els.heatmapTitle) els.heatmapTitle.textContent = `${year} heat map`;

  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);
  for (let i = 0; i < first.getDay(); i++) {
    const empty = document.createElement("div");
    empty.className = "heat empty";
    els.heatmapGrid.appendChild(empty);
  }

  for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
    const key = dateKey(d);
    const stats = getDayStats(key);
    const cell = document.createElement("div");
    cell.className = `heat level-${heatLevel(stats)}`;
    cell.title = `${key}: ${stats.problems} problems, ${formatDurationLong(stats.activeMs)}`;
    cell.setAttribute("aria-label", cell.title);
    els.heatmapGrid.appendChild(cell);
  }
}

function renderDailyStats() {
  const today = getDayStats();
  const totals = getTotals();
  const streak = currentStreak();
  if (els.todayCount) els.todayCount.textContent = String(today.problems);
  if (els.todayTime) els.todayTime.textContent = formatDuration(today.activeMs);
  if (els.streakText) els.streakText.textContent = `${streak} day${streak === 1 ? "" : "s"}`;
  if (els.totalProblems) els.totalProblems.textContent = `${totals.problems} problem${totals.problems === 1 ? "" : "s"}`;
  if (els.totalTime) els.totalTime.textContent = formatDurationLong(totals.activeMs);
  renderHeatmap();
}

function recordProgress(problems = 0, activeMs = 0) {
  if ((!Number.isFinite(problems) || problems <= 0) && (!Number.isFinite(activeMs) || activeMs <= 0)) return;
  const dayKey = trainingDayKey();
  const stats = getDayStats(dayKey);
  stats.problems += Math.max(0, Math.floor(problems || 0));
  stats.activeMs += Math.max(0, Math.floor(activeMs || 0));
  statsHistory.days[dayKey] = stats;
  saveStatsHistory();
  renderDailyStats();
  addPendingSync(dayKey, problems, activeMs);
}

function showScreen(name) {
  for (const screen of [els.setupScreen, els.quizScreen, els.doneScreen]) {
    screen.classList.remove("active");
  }
  if (name === "setup") {
    renderDailyStats();
    els.setupScreen.classList.add("active");
  }
  if (name === "quiz") els.quizScreen.classList.add("active");
  if (name === "done") {
    renderDailyStats();
    els.doneScreen.classList.add("active");
  }
}

function saveSettings() {
  if (!state.settings) return;
  const persisted = {
    level: state.settings.level,
    feedbackPause: state.settings.feedbackPause,
    mitoriCount: state.settings.mitoriCount,
    kakeCount: state.settings.kakeCount,
    wariCount: state.settings.wariCount,
    redoMisses: state.settings.redoMisses,
    shuffleQuestions: state.settings.shuffleQuestions
  };
  localStorage.setItem("anzanTrainerSettings", JSON.stringify(persisted));
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem("anzanTrainerSettings");
    if (!raw) return;
    const s = JSON.parse(raw);
    els.level.value = String(s.level ?? 6);
    els.feedbackPause.value = String(s.feedbackPause ?? 0.8);
    els.mitoriCount.value = s.mitoriCount ?? "";
    els.kakeCount.value = s.kakeCount ?? "";
    els.wariCount.value = s.wariCount ?? "";
    els.redoMisses.checked = s.redoMisses ?? true;
    els.shuffleQuestions.checked = s.shuffleQuestions ?? true;
  } catch {}
}

function setCounts(mitori, kake, wari) {
  els.mitoriCount.value = mitori;
  els.kakeCount.value = kake;
  els.wariCount.value = wari;
}

function applyDefaultsForLevel(level) {
  const [s, m, d] = DEFAULT_COUNTS[level];
  setCounts(s, m, d);
  updateVolumeButtonState(80);
}

function applyVolumePreset(total) {
  const preset = VOLUME_PRESETS[total];
  if (!preset) return;
  setCounts(preset[0], preset[1], preset[2]);
  updateVolumeButtonState(total);
}

function updateVolumeButtonState(activeTotal = null) {
  document.querySelectorAll("[data-volume]").forEach(btn => {
    const total = Number(btn.dataset.volume);
    const preset = VOLUME_PRESETS[total];
    const isMatchingPreset = preset &&
      Number(els.mitoriCount.value) === preset[0] &&
      Number(els.kakeCount.value) === preset[1] &&
      Number(els.wariCount.value) === preset[2];
    btn.classList.toggle("active", Boolean(isMatchingPreset && (activeTotal === null || total === activeTotal)));
  });
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
  const feedbackPause = Number(els.feedbackPause.value || 0.8);
  const generatedSeed = `session-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return {
    level,
    seed: generatedSeed,
    feedbackPause,
    mitoriCount,
    kakeCount,
    wariCount,
    redoMisses: els.redoMisses.checked,
    shuffleQuestions: els.shuffleQuestions.checked
  };
}

function buildProblemSet(settings) {
  const seed = hashSeed(`${settings.seed}|${settings.level}`);
  const rng = new RNG(seed);

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
  state.questionStartedAt = null;

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
  state.questionStartedAt = Date.now();
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
  const activeMs = state.questionStartedAt ? Date.now() - state.questionStartedAt : 0;
  state.questionStartedAt = null;
  state.attempts += 1;
  const problemIncrement = state.current.round_no === 1 ? 1 : 0;
  if (state.current.round_no === 1 && ok) state.firstPassCorrect += 1;
  recordProgress(problemIncrement, activeMs);
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


function hasFirebaseConfig(config) {
  return Boolean(config && config.apiKey && config.authDomain && config.projectId && config.appId);
}

function setSyncStatus(text) {
  if (els.syncStatus) els.syncStatus.textContent = text;
}

function setSyncButtons() {
  if (!els.signInBtn || !els.signOutBtn) return;
  const configured = hasFirebaseConfig(FIREBASE_CONFIG);
  els.signInBtn.disabled = !configured || firebaseReady;
  els.signInBtn.classList.toggle("hidden-soft", firebaseReady);
  els.signOutBtn.classList.toggle("hidden-soft", !firebaseReady);
}

function mergeHistories(localHistory, cloudHistory) {
  const merged = { days: { ...localHistory.days }, updatedAt: Date.now() };
  for (const [day, cloudValue] of Object.entries(cloudHistory.days || {})) {
    const localValue = normalizeDayStats(merged.days[day]);
    const remoteValue = normalizeDayStats(cloudValue);
    merged.days[day] = {
      problems: Math.max(localValue.problems, remoteValue.problems),
      activeMs: Math.max(localValue.activeMs, remoteValue.activeMs)
    };
  }
  return merged;
}

function dayDoc(dayKey) {
  const { doc, db } = firebaseTools;
  return doc(db, "users", firebaseUser.uid, "days", dayKey);
}

async function fetchCloudHistory() {
  const { collection, getDocs, db } = firebaseTools;
  const snap = await getDocs(collection(db, "users", firebaseUser.uid, "days"));
  const history = { days: {}, updatedAt: Date.now() };
  snap.forEach(docSnap => {
    history.days[docSnap.id] = normalizeDayStats(docSnap.data());
  });
  return history;
}

async function uploadExactHistory(history) {
  const { setDoc, serverTimestamp } = firebaseTools;
  const entries = Object.entries(history.days || {});
  for (const [day, stats] of entries) {
    const clean = normalizeDayStats(stats);
    if (clean.problems <= 0 && clean.activeMs <= 0) continue;
    await setDoc(dayDoc(day), {
      problems: clean.problems,
      activeMs: clean.activeMs,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
}

async function flushPendingSync() {
  if (!firebaseReady || !firebaseUser || !firebaseTools || cloudSyncInProgress) return;
  const pending = getPendingSync();
  const entries = Object.entries(pending).filter(([, value]) => {
    const stats = normalizeDayStats(value);
    return stats.problems > 0 || stats.activeMs > 0;
  });
  if (entries.length === 0) return;
  cloudSyncInProgress = true;
  setSyncStatus("Syncing stats…");
  try {
    const { setDoc, increment, serverTimestamp } = firebaseTools;
    for (const [day, value] of entries) {
      const stats = normalizeDayStats(value);
      await setDoc(dayDoc(day), {
        problems: increment(stats.problems),
        activeMs: increment(stats.activeMs),
        updatedAt: serverTimestamp()
      }, { merge: true });
      const latest = getPendingSync();
      delete latest[day];
      savePendingSync(latest);
    }
    setSyncStatus(`Synced as ${firebaseUser.displayName || firebaseUser.email || "signed-in user"}.`);
  } catch (err) {
    console.warn("Firebase sync failed", err);
    setSyncStatus("Offline or sync failed — progress is saved locally and will retry.");
  } finally {
    cloudSyncInProgress = false;
  }
}

async function initialCloudSync() {
  if (!firebaseReady || !firebaseUser || !firebaseTools) return;
  setSyncStatus("Loading cloud stats…");
  try {
    const cloudHistory = await fetchCloudHistory();
    statsHistory = mergeHistories(statsHistory, cloudHistory);
    saveStatsHistory();
    renderDailyStats();
    await uploadExactHistory(statsHistory);
    await flushPendingSync();
    setSyncStatus(`Synced as ${firebaseUser.displayName || firebaseUser.email || "signed-in user"}.`);
  } catch (err) {
    console.warn("Initial cloud sync failed", err);
    setSyncStatus("Could not load cloud stats. Local stats are still safe on this device.");
  }
}

function compatCollection(db, ...segments) {
  if (segments.length === 0 || segments.length % 2 === 0) {
    throw new Error("Invalid Firestore collection path.");
  }
  let ref = db.collection(segments[0]);
  for (let i = 1; i < segments.length; i += 2) {
    ref = ref.doc(segments[i]);
    if (i + 1 < segments.length) ref = ref.collection(segments[i + 1]);
  }
  return ref;
}

function compatDoc(db, ...segments) {
  if (segments.length < 2 || segments.length % 2 !== 0) {
    throw new Error("Invalid Firestore document path.");
  }
  const collectionRef = compatCollection(db, ...segments.slice(0, -1));
  return collectionRef.doc(segments[segments.length - 1]);
}

async function initFirebaseSync() {
  if (!hasFirebaseConfig(FIREBASE_CONFIG)) {
    setSyncStatus("Firebase config missing — local-only mode.");
    setSyncButtons();
    return;
  }

  try {
    setSyncStatus("Preparing Firebase sync…");

    if (!window.firebase || !window.firebase.initializeApp || !window.firebase.auth || !window.firebase.firestore) {
      throw new Error("Firebase compat scripts did not load. Check the three firebase-*-compat.js script tags in index.html.");
    }

    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp(FIREBASE_CONFIG);
    }

    const auth = window.firebase.auth();
    const db = window.firebase.firestore();

    firebaseTools = {
      auth,
      db,
      GoogleAuthProvider: window.firebase.auth.GoogleAuthProvider,
      signInWithPopup: (authInstance, provider) => authInstance.signInWithPopup(provider),
      signOut: authInstance => authInstance.signOut(),
      onAuthStateChanged: (authInstance, callback) => authInstance.onAuthStateChanged(callback),
      collection: compatCollection,
      doc: compatDoc,
      getDocs: ref => ref.get(),
      setDoc: (ref, data, options) => ref.set(data, options),
      increment: value => window.firebase.firestore.FieldValue.increment(value),
      serverTimestamp: () => window.firebase.firestore.FieldValue.serverTimestamp()
    };

    firebaseTools.onAuthStateChanged(auth, async user => {
      firebaseUser = user;
      firebaseReady = Boolean(user);
      setSyncButtons();
      if (user) {
        await initialCloudSync();
      } else {
        setSyncStatus("Not signed in — stats are saved locally on this device.");
      }
    });
  } catch (err) {
    console.error("Firebase setup failed", err);
    const message = err && (err.message || err.code) ? (err.message || err.code) : String(err);
    setSyncStatus(`Firebase could not load: ${message}`);
    setSyncButtons();
  }
}

async function signIn() {
  if (!firebaseTools) {
    setSyncStatus("Firebase has not loaded yet. Check the console, config, and CDN imports.");
    return;
  }
  try {
    const provider = new firebaseTools.GoogleAuthProvider();
    await firebaseTools.signInWithPopup(firebaseTools.auth, provider);
  } catch (err) {
    console.warn("Sign-in failed", err);
    setSyncStatus("Sign-in failed. Check Firebase Auth setup and authorized domains.");
  }
}

async function signOutUser() {
  if (!firebaseTools) return;
  try {
    await firebaseTools.signOut(firebaseTools.auth);
  } catch (err) {
    console.warn("Sign-out failed", err);
  }
}


els.submitBtn.addEventListener("click", () => {
  submitAnswer();
});

document.querySelectorAll("[data-volume]").forEach(btn => {
  btn.addEventListener("click", () => {
    applyVolumePreset(Number(btn.dataset.volume));
  });
});

["input", "change"].forEach(eventName => {
  [els.mitoriCount, els.kakeCount, els.wariCount].forEach(input => {
    input.addEventListener(eventName, () => updateVolumeButtonState(null));
  });
});

els.level.addEventListener("change", () => applyDefaultsForLevel(Number(els.level.value)));
els.startBtn.addEventListener("click", () => startSession(false));
els.quitBtn.addEventListener("click", () => showScreen("setup"));
els.againBtn.addEventListener("click", () => showScreen("setup"));
els.repeatBtn.addEventListener("click", () => startSession(true));
if (els.signInBtn) els.signInBtn.addEventListener("click", signIn);
if (els.signOutBtn) els.signOutBtn.addEventListener("click", signOutUser);
window.addEventListener("online", () => flushPendingSync());

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


document.addEventListener("visibilitychange", () => {
  if (!els.quizScreen.classList.contains("active") || !state.current) return;
  state.questionStartedAt = document.hidden ? null : Date.now();
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
if (!els.feedbackPause.value) els.feedbackPause.value = "0.8";
updateVolumeButtonState(null);
renderDailyStats();
initFirebaseSync();

window.anzanFirebaseDebug = () => ({
  firebaseConfigured: hasFirebaseConfig(FIREBASE_CONFIG),
  firebaseLoading: "compat global scripts v10.12.4",
  firebaseGlobalPresent: Boolean(window.firebase),
  firebaseReady,
  firebaseUser: firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null,
  statusText: els.syncStatus ? els.syncStatus.textContent : null
});

