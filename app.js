"use strict";

const screens = {
  setup: document.querySelector("#setup-screen"),
  mistakes: document.querySelector("#mistakes-screen"),
  quiz: document.querySelector("#quiz-screen"),
  result: document.querySelector("#result-screen"),
};

const elements = {
  form: document.querySelector("#setup-form"),
  start: document.querySelector("#start-button"),
  error: document.querySelector("#load-error"),
  total: document.querySelector("#total-words"),
  from: document.querySelector("#range-from"),
  to: document.querySelector("#range-to"),
  rangeOutput: document.querySelector("#range-output"),
  bestScore: document.querySelector("#best-score"),
  bestDetail: document.querySelector("#best-detail"),
  historyMissCount: document.querySelector("#history-miss-count"),
  openMistakes: document.querySelector("#open-mistakes"),
  legacyDataNotice: document.querySelector("#legacy-data-notice"),
  storageNotice: document.querySelector("#storage-notice"),
  closeMistakes: document.querySelector("#close-mistakes"),
  statusFilters: document.querySelector("#status-filters"),
  directionFilters: document.querySelector("#direction-filters"),
  countFilters: document.querySelector("#count-filters"),
  testFilter: document.querySelector("#test-filter"),
  selectVisible: document.querySelector("#select-visible"),
  clearVisible: document.querySelector("#clear-visible"),
  selectAllVisible: document.querySelector("#select-all-visible"),
  mistakeTableBody: document.querySelector("#mistake-table-body"),
  mistakeEmpty: document.querySelector("#mistake-empty"),
  selectedMistakeCount: document.querySelector("#selected-mistake-count"),
  retestSettings: document.querySelector("#retest-settings"),
  startMistakeTest: document.querySelector("#start-mistake-test"),
  modeDescription: document.querySelector("#mode-description"),
  direction: document.querySelector("#quiz-direction"),
  progressLabel: document.querySelector("#progress-label"),
  progressBar: document.querySelector("#progress-bar"),
  questionId: document.querySelector("#question-id"),
  questionText: document.querySelector("#question-text"),
  questionHint: document.querySelector(".question-hint"),
  questionCard: document.querySelector(".question-card"),
  questionFlag: document.querySelector("#question-flag"),
  options: document.querySelector("#answer-options"),
  feedback: document.querySelector("#answer-feedback"),
  testAnswer: document.querySelector("#test-answer"),
  testAnswerText: document.querySelector("#test-answer-text"),
  testNavigation: document.querySelector("#test-navigation"),
  previousQuestion: document.querySelector("#previous-question"),
  nextTestQuestion: document.querySelector("#next-test-question"),
  nextTestLabel: document.querySelector("#next-test-question span:first-child"),
  reviewActions: document.querySelector("#review-actions"),
  markWrong: document.querySelector("#mark-wrong"),
  markCorrect: document.querySelector("#mark-correct"),
  reviewCorrection: document.querySelector("#review-correction"),
  previousReview: document.querySelector("#previous-review"),
  finishReview: document.querySelector("#finish-review"),
  reviewOverview: document.querySelector("#review-overview"),
  reviewSummary: document.querySelector("#review-summary"),
  reviewQuestionList: document.querySelector("#review-question-list"),
  keyboardHint: document.querySelector("#keyboard-hint"),
  scoreRing: document.querySelector("#score-ring"),
  scorePercent: document.querySelector("#score-percent"),
  scoreMessage: document.querySelector("#score-message"),
  correctCount: document.querySelector("#correct-count"),
  questionCount: document.querySelector("#question-count"),
  missCount: document.querySelector("#miss-count"),
  reviewList: document.querySelector("#review-list"),
  resultTestLabel: document.querySelector("#result-test-label"),
};

let words = [];
let session = null;
let datasetVersion = "";
let storedData = { schemaVersion: 2, statsByWordKey: {}, sessions: [] };
let storageWritable = true;
let storageErrorMessage = "";
const promptsByDirection = { "en-ja": new Map(), "ja-en": new Map() };
const answersByDirection = { "en-ja": new Map(), "ja-en": new Map() };
let selectedMistakeKeys = new Set();
let mistakeStatusFilter = "all";
let mistakeCountFilter = null;
let mistakeDirectionFilter = "all";
let mistakeTestFilter = "all";
const STORAGE_KEY = "word-stock-data-v2";
const STORAGE_SCHEMA_VERSION = 2;

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function parseWordsCsv(csv) {
  const parsed = [];
  let previousJapanese = "";

  for (const columns of parseCsvRows(csv.replace(/^\uFEFF/, "")).slice(1)) {
    if (columns.length !== 3) continue;
    const id = Number(columns[0]);
    const english = columns[1].trim();
    let japanese = columns[2].trim();
    if (!Number.isInteger(id)) continue;

    if (japanese === "//" || japanese.startsWith("//")) {
      japanese = `${previousJapanese}${japanese.slice(2)}`;
    }

    if (japanese) previousJapanese = japanese;
    if (english && japanese) parsed.push({ id, english, japanese });
  }

  return parsed;
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function addWordKeys(parsedWords) {
  return Promise.all(parsedWords.map(async (word) => ({
    ...word,
    datasetVersion,
    wordKey: `ws1:${await sha256Hex(`${word.id}\0${word.english}\0${word.japanese}`)}`,
  })));
}

function createWordSnapshot(word) {
  return {
    wordKey: word.wordKey,
    datasetVersion: word.datasetVersion || datasetVersion,
    id: word.id,
    english: word.english,
    japanese: word.japanese,
  };
}

function indexQuestionData(indexedWords = words) {
  promptsByDirection["en-ja"].clear();
  promptsByDirection["ja-en"].clear();
  answersByDirection["en-ja"].clear();
  answersByDirection["ja-en"].clear();

  const uniqueWords = [...new Map(indexedWords.map((word) => [word.wordKey, word])).values()];

  const englishByJapanese = new Map();
  uniqueWords.forEach((word) => {
    if (!englishByJapanese.has(word.japanese)) englishByJapanese.set(word.japanese, new Set());
    englishByJapanese.get(word.japanese).add(word.english);
  });

  uniqueWords.forEach((word) => {
    const initial = word.english.match(/[a-z]/i)?.[0].toLowerCase();
    const japanesePrompt = englishByJapanese.get(word.japanese).size > 1 && initial
      ? `${initial} から始まる「${word.japanese}」`
      : word.japanese;
    const prompts = { "en-ja": word.english, "ja-en": japanesePrompt };
    const answers = { "en-ja": word.japanese, "ja-en": word.english };

    Object.keys(prompts).forEach((direction) => {
      const prompt = prompts[direction];
      promptsByDirection[direction].set(word.wordKey, prompt);
      if (!answersByDirection[direction].has(prompt)) answersByDirection[direction].set(prompt, new Set());
      answersByDirection[direction].get(prompt).add(answers[direction]);
    });
  });
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.hidden = key !== name;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateRange() {
  if (!words.length) return;
  const maxId = words.at(-1).id;
  let from = Math.max(1, Math.min(Number(elements.from.value) || 1, maxId));
  let to = Math.max(1, Math.min(Number(elements.to.value) || maxId, maxId));
  if (from > to) [from, to] = [to, from];
  elements.from.value = from;
  elements.to.value = to;
  elements.rangeOutput.value = `${from} - ${to}`;
}

function createEmptyStoredData() {
  return { schemaVersion: STORAGE_SCHEMA_VERSION, datasetVersion, statsByWordKey: {}, sessions: [] };
}

function isWordSnapshot(word) {
  return /^ws1:[0-9a-f]{64}$/.test(word?.wordKey)
    && /^sha256:[0-9a-f]{64}$/.test(word.datasetVersion)
    && Number.isInteger(word.id)
    && typeof word.english === "string"
    && typeof word.japanese === "string";
}

function isStoredDataValid(data) {
  if (data?.schemaVersion !== STORAGE_SCHEMA_VERSION
    || !/^sha256:[0-9a-f]{64}$/.test(data.datasetVersion)
    || !data.statsByWordKey
    || typeof data.statsByWordKey !== "object"
    || Array.isArray(data.statsByWordKey)
    || !Array.isArray(data.sessions)) return false;

  const validStats = Object.entries(data.statsByWordKey).every(([wordKey, stats]) => wordKey === stats?.word?.wordKey
    && isWordSnapshot(stats.word)
    && Number.isInteger(stats.correct)
    && stats.correct >= 0
    && Number.isInteger(stats.wrong)
    && stats.wrong >= 0
    && (stats.needsReview === undefined || typeof stats.needsReview === "boolean")
    && (stats.flagged === undefined || typeof stats.flagged === "boolean"));
  const sessionIds = new Set();
  const validSessions = data.sessions.every((test) => typeof test?.id === "string"
    && test.id.length > 0
    && !sessionIds.has(test.id)
    && Boolean(sessionIds.add(test.id))
    && typeof test.completedAt === "string"
    && Number.isFinite(Date.parse(test.completedAt))
    && /^sha256:[0-9a-f]{64}$/.test(test.datasetVersion)
    && ["en-ja", "ja-en"].includes(test.direction)
    && ["choice", "test"].includes(test.mode)
    && ["standard", "mistakes"].includes(test.source)
    && Number.isInteger(test.questionCount)
    && test.questionCount >= 0
    && ((test.source === "mistakes" && test.from === null && test.to === null)
      || (test.source === "standard" && Number.isInteger(test.from) && Number.isInteger(test.to) && test.from <= test.to))
    && Array.isArray(test.wrongWords)
    && test.wrongWords.length <= test.questionCount
    && test.wrongWords.every(isWordSnapshot));
  return validStats && validSessions;
}

function loadStoredData() {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) return createEmptyStoredData();
    const data = JSON.parse(serialized);
    if (!isStoredDataValid(data)) {
      storageWritable = false;
      storageErrorMessage = "保存済みの学習履歴を確認できないため、この画面では新しい履歴を保存しません。既存データは変更されていません。";
      return createEmptyStoredData();
    }
    return data;
  } catch {
    storageWritable = false;
    storageErrorMessage = "ブラウザの保存領域を利用できないため、学習履歴は保存されません。";
    return createEmptyStoredData();
  }
}

function hasLegacyStoredData() {
  try {
    return localStorage.getItem("word-stock-stats") !== null
      || localStorage.getItem("word-stock-test-history-v1") !== null;
  } catch {
    return false;
  }
}

function showStorageWarning(message) {
  storageErrorMessage = message;
  elements.storageNotice.hidden = false;
  elements.storageNotice.textContent = message;
}

function persistStoredData(nextData) {
  if (!storageWritable) return false;
  const data = { ...nextData, datasetVersion };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    storedData = data;
    return true;
  } catch {
    showStorageWarning("ブラウザの保存容量または設定により、今回の学習履歴を保存できませんでした。");
    return false;
  }
}

function getWordStats() {
  return storedData.statsByWordKey;
}

function getTestHistory() {
  return { version: STORAGE_SCHEMA_VERSION, sessions: storedData.sessions };
}

function matchesMistakeHistory(word, wordStats, sessions) {
  if (mistakeTestFilter !== "all") {
    const test = sessions.find((item) => item.id === mistakeTestFilter);
    return Boolean(test
      && (mistakeDirectionFilter === "all" || test.direction === mistakeDirectionFilter)
      && test.wrongWords.some((item) => item.wordKey === word.wordKey));
  }

  if (mistakeDirectionFilter !== "all") {
    return sessions.some((test) => test.direction === mistakeDirectionFilter
      && test.wrongWords.some((item) => item.wordKey === word.wordKey));
  }

  return true;
}

function updateLearningStats() {
  const stats = getWordStats();
  const totals = Object.values(stats).reduce((result, word) => {
    result.correct += word.correct || 0;
    result.wrong += word.wrong || 0;
    return result;
  }, { correct: 0, wrong: 0 });
  const attempts = totals.correct + totals.wrong;

  if (attempts) {
    elements.bestScore.textContent = `${Math.round((totals.correct / attempts) * 100)}%`;
    elements.bestDetail.textContent = `${totals.correct} / ${attempts} 正解`;
  } else {
    elements.bestScore.textContent = "--";
    elements.bestDetail.textContent = "まだ回答記録がありません";
  }

  elements.historyMissCount.textContent = Object.values(stats)
    .filter((entry) => entry.wrong || entry.flagged).length;
  if (!screens.mistakes.hidden) renderMistakeTable();
}

function needsReview(wordStats) {
  return wordStats.needsReview ?? wordStats.wrong > 0;
}

function getMistakeWords(stats = getWordStats()) {
  return Object.values(stats)
    .filter((entry) => entry.wrong || entry.flagged)
    .map((entry) => entry.word)
    .sort((a, b) => (stats[b.wordKey].wrong || 0) - (stats[a.wordKey].wrong || 0) || a.id - b.id);
}

function getVisibleMistakeWords(stats = getWordStats()) {
  const sessions = getTestHistory()?.sessions || [];
  return getMistakeWords(stats).filter((word) => {
    const wordStats = stats[word.wordKey];
    const statusMatches = mistakeStatusFilter === "all"
      || (mistakeStatusFilter === "review" && needsReview(wordStats))
      || (mistakeStatusFilter === "mastered" && wordStats.wrong > 0 && !needsReview(wordStats))
      || (mistakeStatusFilter === "flagged" && wordStats.flagged);
    const countMatches = mistakeCountFilter === null || (wordStats.wrong || 0) === mistakeCountFilter;
    return statusMatches && countMatches && matchesMistakeHistory(word, wordStats, sessions);
  });
}

function formatTestLabel(test) {
  const date = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(test.completedAt));
  const direction = test.direction === "en-ja" ? "EN→JA" : "JA→EN";
  const mode = test.mode === "test" ? "テスト" : "4択";
  const scope = test.source === "mistakes" ? "誤答復習" : `ID ${test.from}–${test.to}`;
  const shortId = test.id.replaceAll("-", "").slice(0, 6).toUpperCase();
  return `${date}｜${direction}｜${mode}｜${test.questionCount}問｜${scope}｜#${shortId}`;
}

function renderTestFilters() {
  const sessions = (getTestHistory()?.sessions || []).filter((test) => test.wrongWords?.length);
  if (mistakeTestFilter !== "all"
    && !sessions.some((test) => test.id === mistakeTestFilter)) mistakeTestFilter = "all";

  elements.testFilter.replaceChildren();
  const options = [
    ["all", "すべてのテスト"],
    ...[...sessions]
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .map((test) => [test.id, formatTestLabel(test)]),
  ];
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === mistakeTestFilter;
    elements.testFilter.append(option);
  });
}

function renderCountFilters(stats = getWordStats()) {
  const counts = [...new Set(getMistakeWords(stats).map((word) => stats[word.wordKey].wrong || 0))].sort((a, b) => a - b);
  if (mistakeCountFilter !== null && !counts.includes(mistakeCountFilter)) mistakeCountFilter = null;
  elements.countFilters.replaceChildren();

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.textContent = "すべて";
  allButton.classList.toggle("active", mistakeCountFilter === null);
  allButton.addEventListener("click", () => {
    mistakeCountFilter = null;
    renderCountFilters();
    renderMistakeTable();
  });
  elements.countFilters.append(allButton);

  counts.forEach((count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${count}回`;
    button.classList.toggle("active", mistakeCountFilter === count);
    button.addEventListener("click", () => {
      mistakeCountFilter = count;
      renderCountFilters();
      renderMistakeTable();
    });
    elements.countFilters.append(button);
  });
}

function renderMistakeTable() {
  const stats = getWordStats();
  const visibleWords = getVisibleMistakeWords(stats);
  elements.mistakeTableBody.replaceChildren();
  elements.mistakeEmpty.hidden = visibleWords.length > 0;

  visibleWords.forEach((word) => {
    const wordStats = stats[word.wordKey];
    const attempts = (wordStats.correct || 0) + (wordStats.wrong || 0);
    const review = needsReview(wordStats);
    const hasAttempts = attempts > 0;
    const row = document.createElement("tr");
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedMistakeKeys.has(word.wordKey);
    checkbox.setAttribute("aria-label", `${word.english}を選択`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedMistakeKeys.add(word.wordKey);
      else selectedMistakeKeys.delete(word.wordKey);
      updateMistakeSelection(visibleWords);
    });
    checkCell.className = "check-column";
    checkCell.append(checkbox);

    const values = [
      [String(word.id).padStart(3, "0"), "id-cell"],
      [word.english, "word-cell"],
      [word.japanese, ""],
      [`${wordStats.wrong || 0}回`, ""],
      [hasAttempts ? `${Math.round(((wordStats.correct || 0) / attempts) * 100)}%` : "--", ""],
    ];
    row.append(checkCell);
    values.forEach(([value, className]) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (className) cell.className = className;
      row.append(cell);
    });

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${hasAttempts ? (review ? "review" : "mastered") : "unanswered"}`;
    badge.textContent = hasAttempts ? (review ? "要復習" : "克服済み") : "未回答";
    statusCell.append(badge);
    row.append(statusCell);

    const flagCell = document.createElement("td");
    const flagButton = document.createElement("button");
    flagButton.type = "button";
    flagButton.className = `flag-button${wordStats.flagged ? " active" : ""}`;
    flagButton.textContent = "要注意";
    flagButton.setAttribute("aria-pressed", String(Boolean(wordStats.flagged)));
    flagButton.addEventListener("click", () => toggleWordFlag(word));
    flagCell.append(flagButton);
    row.append(flagCell);
    elements.mistakeTableBody.append(row);
  });

  updateMistakeSelection(visibleWords);
}

function toggleWordFlag(word) {
  const nextData = structuredClone(storedData);
  const wordStats = nextData.statsByWordKey[word.wordKey]
    || { word: createWordSnapshot(word), correct: 0, wrong: 0 };
  wordStats.flagged = !wordStats.flagged;
  nextData.statsByWordKey[word.wordKey] = wordStats;
  if (!persistStoredData(nextData)) return;
  if (!wordStats.wrong && !wordStats.flagged) selectedMistakeKeys.delete(word.wordKey);
  updateLearningStats();
  renderQuestionFlag();
}

function renderQuestionFlag() {
  if (!session || session.settings.mode !== "test") {
    elements.questionFlag.hidden = true;
    return;
  }

  const flagged = Boolean(getWordStats()[session.questions[session.index].wordKey]?.flagged);
  elements.questionFlag.hidden = false;
  elements.questionFlag.classList.toggle("active", flagged);
  elements.questionFlag.setAttribute("aria-pressed", String(flagged));
}

function updateMistakeSelection(visibleWords = getVisibleMistakeWords()) {
  const selectedVisible = visibleWords.filter((word) => selectedMistakeKeys.has(word.wordKey)).length;
  elements.selectAllVisible.checked = visibleWords.length > 0 && selectedVisible === visibleWords.length;
  elements.selectAllVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleWords.length;
  elements.selectedMistakeCount.textContent = selectedMistakeKeys.size;
  elements.startMistakeTest.disabled = selectedMistakeKeys.size === 0;
}

function showMistakes(resetSelection = true) {
  const stats = getWordStats();
  const missed = getMistakeWords(stats);
  if (resetSelection) {
    selectedMistakeKeys = new Set(missed.map((word) => word.wordKey));
    mistakeStatusFilter = "all";
    mistakeCountFilter = null;
    mistakeDirectionFilter = "all";
    mistakeTestFilter = "all";
  }

  const settings = getSettings();
  const modeLabel = settings.mode === "test" ? "テストモード" : "4択モード";
  const directionLabel = settings.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語";
  elements.retestSettings.textContent = `${modeLabel} / ${directionLabel}`;
  elements.statusFilters.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === mistakeStatusFilter);
  });
  elements.directionFilters.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.direction === mistakeDirectionFilter);
  });
  renderCountFilters(stats);
  renderTestFilters();
  renderMistakeTable();
  showScreen("mistakes");
}

function saveSessionStats() {
  if (session.statsSaved) return;
  const nextData = structuredClone(storedData);
  const stats = nextData.statsByWordKey;
  const results = session.settings.mode === "test" ? session.judgments : session.results;
  const alreadyRecorded = nextData.sessions.some((test) => test.id === session.testId);
  session.completedAt ||= new Date().toISOString();
  session.historyEntry ||= {
    id: session.testId,
    completedAt: session.completedAt,
    datasetVersion,
    direction: session.settings.direction,
    mode: session.settings.mode,
    source: session.source,
    from: session.source === "standard" ? session.settings.from : null,
    to: session.source === "standard" ? session.settings.to : null,
    questionCount: session.questions.length,
    wrongWords: session.questions
      .filter((word, index) => results[index] === false)
      .map(createWordSnapshot),
  };

  if (!alreadyRecorded) {
    session.questions.forEach((word, index) => {
      const result = results[index];
      if (result === null) return;
      const current = stats[word.wordKey] || { word: createWordSnapshot(word), correct: 0, wrong: 0 };
      current.correct ||= 0;
      current.wrong ||= 0;
      current[result ? "correct" : "wrong"] += 1;
      if (!result) current.needsReview = true;
      else if (session.source === "mistakes") current.needsReview = false;
      else if (current.needsReview === undefined && current.wrong > 0) current.needsReview = true;
      stats[word.wordKey] = current;
    });
    nextData.sessions.push(session.historyEntry);
  }
  session.statsSaved = persistStoredData(nextData);
  updateLearningStats();
}

function getSettings() {
  const data = new FormData(elements.form);
  return {
    mode: data.get("mode"),
    direction: data.get("direction"),
    count: data.get("count"),
    from: Number(elements.from.value),
    to: Number(elements.to.value),
  };
}

function beginQuiz(settings = getSettings(), customPool = null, source = "standard") {
  if (!customPool) {
    updateRange();
    settings = { ...settings, from: Number(elements.from.value), to: Number(elements.to.value) };
  }
  const pool = customPool || words.filter((word) => word.id >= settings.from && word.id <= settings.to);
  if (!pool.length) {
    elements.error.hidden = false;
    elements.error.textContent = "この範囲には出題できる単語がありません。範囲を変更してください。";
    return;
  }

  const requestedCount = customPool ? pool.length : settings.count === "all" ? pool.length : Number(settings.count);
  const questionCount = Math.min(requestedCount, pool.length);
  indexQuestionData([...words, ...pool]);
  session = {
    testId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    settings,
    source,
    sourceWordKeys: pool.map((word) => word.wordKey),
    pool,
    questions: shuffle(pool).slice(0, questionCount),
    index: 0,
    correct: 0,
    mistakes: [],
    answered: false,
    phase: settings.mode === "test" ? "question" : "choice",
    results: Array(questionCount).fill(null),
    judgments: Array(questionCount).fill(null),
    statsSaved: false,
  };

  elements.error.hidden = true;
  const directionLabel = settings.direction === "en-ja" ? "EN → JA" : "JA → EN";
  elements.direction.textContent = settings.mode === "test" ? `TEST / ${directionLabel}` : directionLabel;
  document.querySelector("#back-button").textContent = source === "mistakes" ? "間違い一覧へ戻る" : "設定を変える";
  showScreen("quiz");
  renderQuestion();
}

function getAnswer(word) {
  return session.settings.direction === "en-ja" ? word.japanese : word.english;
}

function getPrompt(word) {
  return promptsByDirection[session.settings.direction].get(word.wordKey);
}

function getAcceptedAnswers(question) {
  return [...answersByDirection[session.settings.direction].get(getPrompt(question))];
}

function getAnswerLabel(question) {
  return getAcceptedAnswers(question).join(" / ");
}

function buildOptions(question) {
  const correctAnswer = getAnswerLabel(question);
  const used = new Set([correctAnswer]);
  const distractors = [];
  const candidates = shuffle([...session.pool, ...words]);

  for (const candidate of candidates) {
    const answer = getAnswerLabel(candidate);
    if (!used.has(answer)) {
      used.add(answer);
      distractors.push(answer);
    }
    if (distractors.length === 3) break;
  }
  return shuffle([correctAnswer, ...distractors]);
}

function renderQuestion() {
  if (session.settings.mode === "test") {
    renderTestQuestion();
    return;
  }

  session.answered = false;
  const question = session.questions[session.index];
  const total = session.questions.length;
  const position = session.index + 1;

  elements.progressLabel.textContent = `${String(position).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  elements.progressBar.style.width = `${((session.index) / total) * 100}%`;
  elements.questionId.textContent = `WORD ${String(question.id).padStart(3, "0")}`;
  elements.questionId.hidden = false;
  elements.questionHint.hidden = false;
  elements.questionHint.textContent = session.settings.direction === "en-ja"
    ? "次の意味を選んでください"
    : "対応する英語を選んでください";
  elements.questionText.textContent = getPrompt(question);
  elements.questionCard.classList.remove("test-phase", "review-phase");
  elements.questionFlag.hidden = true;
  elements.reviewOverview.hidden = true;
  elements.options.hidden = false;
  elements.feedback.hidden = false;
  elements.testAnswer.hidden = true;
  elements.testNavigation.hidden = true;
  elements.reviewActions.hidden = true;
  elements.reviewCorrection.hidden = true;
  elements.keyboardHint.innerHTML = "<kbd>1</kbd>–<kbd>4</kbd> で選択　<kbd>Enter</kbd> で次へ";
  elements.options.replaceChildren();
  elements.feedback.replaceChildren();

  buildOptions(question).forEach((answer, index) => {
    const button = document.createElement("button");
    const number = document.createElement("span");
    const text = document.createElement("span");
    button.type = "button";
    button.className = "answer-option";
    button.dataset.answer = answer;
    number.className = "number";
    number.textContent = String(index + 1);
    text.textContent = answer;
    button.append(number, text);
    button.addEventListener("click", () => answerQuestion(button));
    elements.options.append(button);
  });
}

function renderTestQuestion() {
  const question = session.questions[session.index];
  const total = session.questions.length;
  const position = session.index + 1;
  const isReview = session.phase === "review";

  elements.progressLabel.textContent = `${isReview ? "CHECK " : ""}${String(position).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  elements.progressBar.style.width = `${(position / total) * 100}%`;
  elements.questionText.textContent = getPrompt(question);
  elements.options.hidden = true;
  elements.feedback.hidden = true;
  elements.options.replaceChildren();
  elements.feedback.replaceChildren();
  renderQuestionFlag();
  elements.reviewOverview.hidden = !isReview;

  if (!isReview) {
    elements.questionCard.classList.add("test-phase");
    elements.questionCard.classList.remove("review-phase");
    elements.questionId.hidden = true;
    elements.questionHint.hidden = true;
    elements.testAnswer.hidden = true;
    elements.testNavigation.hidden = false;
    elements.reviewActions.hidden = true;
    elements.reviewCorrection.hidden = true;
    elements.previousQuestion.disabled = session.index === 0;
    elements.nextTestLabel.textContent = session.index === total - 1 ? "答え合わせへ" : "次の問題";
    elements.keyboardHint.innerHTML = "<kbd>←</kbd> <kbd>→</kbd> で問題を移動";
    return;
  }

  elements.questionCard.classList.remove("test-phase");
  elements.questionCard.classList.add("review-phase");
  elements.questionId.hidden = false;
  elements.questionId.textContent = `WORD ${String(question.id).padStart(3, "0")}`;
  elements.questionHint.hidden = false;
  elements.questionHint.textContent = "紙に書いた答えと見比べてください";
  elements.testAnswer.hidden = false;
  elements.testAnswerText.textContent = getAnswerLabel(question);
  elements.testNavigation.hidden = true;
  elements.reviewActions.hidden = false;
  elements.reviewCorrection.hidden = false;
  elements.previousReview.disabled = session.index === 0;
  elements.finishReview.hidden = session.judgments.some((result) => result === null);
  elements.markCorrect.classList.toggle("selected", session.judgments[session.index] === true);
  elements.markWrong.classList.toggle("selected", session.judgments[session.index] === false);
  elements.keyboardHint.innerHTML = "<kbd>1</kbd> 正解　<kbd>2</kbd> 不正解";
  renderReviewOverview();
}

function renderReviewOverview() {
  const judgedCount = session.judgments.filter((result) => result !== null).length;
  elements.reviewSummary.textContent = `${judgedCount} / ${session.questions.length} 採点済み`;
  elements.reviewQuestionList.replaceChildren();

  session.questions.forEach((question, index) => {
    const judgment = session.judgments[index];
    const state = judgment === null ? "未採点" : judgment ? "正解" : "不正解";
    const button = document.createElement("button");
    const number = document.createElement("span");
    const mark = document.createElement("span");
    button.type = "button";
    button.className = `review-question ${judgment === null ? "pending" : judgment ? "correct" : "wrong"}`;
    button.setAttribute("aria-label", `${index + 1}問目、${state}、${getPrompt(question)}`);
    if (index === session.index) button.setAttribute("aria-current", "step");
    number.textContent = String(index + 1);
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = judgment === null ? "−" : judgment ? "○" : "×";
    button.append(number, mark);
    button.addEventListener("click", () => goToReviewQuestion(index));
    elements.reviewQuestionList.append(button);
  });
}

function goToReviewQuestion(index) {
  if (session?.settings.mode !== "test" || session.phase !== "review") return;
  if (!Number.isInteger(index) || index < 0 || index >= session.questions.length) return;
  session.index = index;
  renderQuestion();
}

function moveTestQuestion(offset) {
  if (session?.settings.mode !== "test" || session.phase !== "question") return;

  const nextIndex = session.index + offset;
  if (nextIndex < 0) return;
  if (nextIndex >= session.questions.length) {
    session.phase = "review";
    session.index = 0;
  } else {
    session.index = nextIndex;
  }
  renderQuestion();
}

function markTestAnswer(isCorrect) {
  if (session?.settings.mode !== "test" || session.phase !== "review") return;

  session.judgments[session.index] = isCorrect;

  if (session.index < session.questions.length - 1) session.index += 1;
  renderQuestion();
}

function moveReviewBack() {
  if (session?.settings.mode !== "test" || session.phase !== "review" || session.index === 0) return;
  session.index -= 1;
  renderQuestion();
}

function completeReview() {
  if (session?.settings.mode !== "test" || session.judgments.some((result) => result === null)) return;
  session.correct = session.judgments.filter(Boolean).length;
  session.mistakes = session.questions.filter((word, index) => !session.judgments[index]);
  showResult();
}

function answerQuestion(selectedButton) {
  if (session.answered) return;
  session.answered = true;
  const question = session.questions[session.index];
  const correctAnswer = getAnswerLabel(question);
  const isCorrect = selectedButton.dataset.answer === correctAnswer;
  session.results[session.index] = isCorrect;

  if (isCorrect) {
    session.correct += 1;
  } else {
    session.mistakes.push(question);
  }

  [...elements.options.children].forEach((button) => {
    button.disabled = true;
    if (button.dataset.answer === correctAnswer) button.classList.add("correct");
    else if (button === selectedButton) button.classList.add("wrong");
    else button.classList.add("dimmed");
  });

  const feedbackText = document.createElement("span");
  const nextButton = document.createElement("button");
  feedbackText.textContent = isCorrect ? "正解です　" : "もう一度覚えよう　";
  feedbackText.style.color = isCorrect ? "var(--correct)" : "var(--accent)";
  nextButton.type = "button";
  nextButton.className = "next-button";
  nextButton.textContent = session.index + 1 === session.questions.length ? "結果を見る →" : "次の問題 →";
  nextButton.addEventListener("click", nextQuestion);
  elements.feedback.append(feedbackText, nextButton);
  elements.progressBar.style.width = `${((session.index + 1) / session.questions.length) * 100}%`;
  nextButton.focus();
}

function nextQuestion() {
  if (!session?.answered) return;
  session.index += 1;
  if (session.index >= session.questions.length) {
    showResult();
  } else {
    renderQuestion();
  }
}

function showResult() {
  saveSessionStats();
  const total = session.questions.length;
  const percent = Math.round((session.correct / total) * 100);
  const messages = percent === 100
    ? "Perfect! すべて正解です"
    : percent >= 80
      ? "Great work! あと少しです"
      : percent >= 60
        ? "Good job! 復習して定着させよう"
        : "一歩ずつ、確実に覚えよう";

  elements.scorePercent.textContent = percent;
  elements.scoreRing.style.background = `conic-gradient(var(--accent) ${percent * 3.6}deg, var(--line) 0deg)`;
  elements.scoreMessage.textContent = messages;
  elements.correctCount.textContent = session.correct;
  elements.questionCount.textContent = total;
  elements.missCount.textContent = `${session.mistakes.length} WORDS`;
  elements.resultTestLabel.textContent = formatTestLabel(session.historyEntry);
  elements.reviewList.replaceChildren();
  const stats = getWordStats();

  if (session.mistakes.length) {
    session.mistakes.forEach((word) => {
      const row = document.createElement("div");
      const id = document.createElement("span");
      const english = document.createElement("strong");
      const japanese = document.createElement("span");
      const wrongCount = document.createElement("span");
      row.className = "review-row";
      id.className = "review-id";
      id.textContent = String(word.id).padStart(3, "0");
      english.textContent = word.english;
      japanese.textContent = word.japanese;
      wrongCount.className = "wrong-count";
      wrongCount.textContent = `間違い ${stats[word.wordKey]?.wrong || 1}回`;
      row.append(id, english, japanese, wrongCount);
      elements.reviewList.append(row);
    });
  } else {
    const perfect = document.createElement("p");
    perfect.className = "perfect-message";
    perfect.textContent = "全問正解です。この調子で次の範囲にも挑戦しましょう。";
    elements.reviewList.append(perfect);
  }

  showScreen("result");
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  beginQuiz();
});

[elements.from, elements.to].forEach((input) => input.addEventListener("change", updateRange));

document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    const [from, to] = button.dataset.range.split(",");
    elements.from.value = from;
    elements.to.value = to;
    updateRange();
  });
});

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    elements.modeDescription.textContent = input.value === "test"
      ? "問題だけを順番に表示し、全問完了後にまとめて答え合わせします。"
      : "選択肢から答えて、その場で正解を確認します。";
  });
});

elements.openMistakes.addEventListener("click", () => showMistakes(true));
elements.closeMistakes.addEventListener("click", () => showScreen("setup"));

elements.statusFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  mistakeStatusFilter = button.dataset.status;
  elements.statusFilters.querySelectorAll("button").forEach((filterButton) => {
    filterButton.classList.toggle("active", filterButton === button);
  });
  renderMistakeTable();
});

elements.directionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  mistakeDirectionFilter = button.dataset.direction;
  elements.directionFilters.querySelectorAll("button").forEach((filterButton) => {
    filterButton.classList.toggle("active", filterButton === button);
  });
  renderMistakeTable();
});

elements.testFilter.addEventListener("change", () => {
  mistakeTestFilter = elements.testFilter.value;
  renderMistakeTable();
});

function setVisibleSelection(selected) {
  getVisibleMistakeWords().forEach((word) => {
    if (selected) selectedMistakeKeys.add(word.wordKey);
    else selectedMistakeKeys.delete(word.wordKey);
  });
  renderMistakeTable();
}

elements.selectVisible.addEventListener("click", () => setVisibleSelection(true));
elements.clearVisible.addEventListener("click", () => setVisibleSelection(false));
elements.selectAllVisible.addEventListener("change", () => setVisibleSelection(elements.selectAllVisible.checked));
elements.startMistakeTest.addEventListener("click", () => {
  const stats = getWordStats();
  const selectedWords = [...selectedMistakeKeys].map((wordKey) => stats[wordKey]?.word).filter(Boolean);
  if (selectedWords.length) beginQuiz(getSettings(), selectedWords, "mistakes");
});

document.querySelector("#quit-button").addEventListener("click", () => {
  if (session?.source === "mistakes") showMistakes(false);
  else showScreen("setup");
});
document.querySelector("#back-button").addEventListener("click", () => {
  if (session?.source === "mistakes") showMistakes(false);
  else showScreen("setup");
});
document.querySelector("#retry-button").addEventListener("click", () => {
  if (session.source === "mistakes") {
    const sourceWordKeys = new Set(session.sourceWordKeys);
    beginQuiz(session.settings, session.pool.filter((word) => sourceWordKeys.has(word.wordKey)), "mistakes");
  } else {
    beginQuiz(session.settings);
  }
});
elements.previousQuestion.addEventListener("click", () => moveTestQuestion(-1));
elements.nextTestQuestion.addEventListener("click", () => moveTestQuestion(1));
elements.markCorrect.addEventListener("click", () => markTestAnswer(true));
elements.markWrong.addEventListener("click", () => markTestAnswer(false));
elements.previousReview.addEventListener("click", moveReviewBack);
elements.finishReview.addEventListener("click", completeReview);
elements.questionFlag.addEventListener("click", () => {
  if (!session || session.settings.mode !== "test") return;
  toggleWordFlag(session.questions[session.index]);
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const data = JSON.parse(event.newValue);
    if (!isStoredDataValid(data)) return;
    storedData = data;
    updateLearningStats();
    if (!screens.mistakes.hidden) showMistakes(false);
  } catch {
    // Ignore incomplete writes from another tab.
  }
});

document.addEventListener("keydown", (event) => {
  if (screens.quiz.hidden || !session) return;

  if (session.settings.mode === "test") {
    if (session.phase === "question" && event.key === "ArrowLeft") moveTestQuestion(-1);
    else if (session.phase === "question" && event.key === "ArrowRight") moveTestQuestion(1);
    else if (session.phase === "review" && event.key === "1") markTestAnswer(true);
    else if (session.phase === "review" && event.key === "2") markTestAnswer(false);
    else if (session.phase === "review" && event.key === "ArrowLeft") moveReviewBack();
  } else if (!session.answered && /^[1-4]$/.test(event.key)) {
    elements.options.children[Number(event.key) - 1]?.click();
  } else if (session.answered && event.key === "Enter") {
    nextQuestion();
  }
});

async function initialize() {
  try {
    const response = await fetch("words.csv");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvBytes = new Uint8Array(await response.arrayBuffer());
    datasetVersion = `sha256:${await sha256Hex(csvBytes)}`;
    const parsedWords = parseWordsCsv(new TextDecoder("utf-8").decode(csvBytes));
    if (new Set(parsedWords.map((word) => word.id)).size !== parsedWords.length) {
      throw new Error("Duplicate word IDs");
    }
    words = await addWordKeys(parsedWords);
    if (!words.length) throw new Error("No words parsed");
    storedData = loadStoredData();
    if (hasLegacyStoredData()) {
      elements.legacyDataNotice.hidden = false;
      elements.legacyDataNotice.textContent = "以前の履歴は安全のため現在の単語へ引き継いでいません。旧データはブラウザ内に保持されています。";
    }
    indexQuestionData();

    const maxId = words.at(-1).id;
    elements.total.textContent = words.length;
    elements.to.max = maxId;
    elements.from.max = maxId;
    elements.to.value = maxId;
    elements.rangeOutput.value = `1 - ${maxId}`;
    elements.start.disabled = false;
    elements.openMistakes.disabled = false;
    updateLearningStats();
    if (storageErrorMessage) showStorageWarning(storageErrorMessage);
  } catch (error) {
    console.error(error);
    elements.error.hidden = false;
    elements.error.textContent = "words.csvを読み込めませんでした。ローカルサーバーからこのページを開いてください。";
  }
}

initialize();
