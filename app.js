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
  closeMistakes: document.querySelector("#close-mistakes"),
  statusFilters: document.querySelector("#status-filters"),
  countFilters: document.querySelector("#count-filters"),
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
  keyboardHint: document.querySelector("#keyboard-hint"),
  scoreRing: document.querySelector("#score-ring"),
  scorePercent: document.querySelector("#score-percent"),
  scoreMessage: document.querySelector("#score-message"),
  correctCount: document.querySelector("#correct-count"),
  questionCount: document.querySelector("#question-count"),
  missCount: document.querySelector("#miss-count"),
  reviewList: document.querySelector("#review-list"),
};

let words = [];
let session = null;
let selectedMistakeIds = new Set();
let mistakeStatusFilter = "all";
let mistakeCountFilter = null;

function parseWordsCsv(csv) {
  const parsed = [];
  let previousJapanese = "";

  for (const rawLine of csv.replace(/^\uFEFF/, "").split(/\r?\n/).slice(1)) {
    const match = rawLine.match(/^\s*(\d+)\s*,\s*(.*)$/);
    if (!match) continue;

    const id = Number(match[1]);
    const columns = match[2].split(",").map((column) => column.trim());
    let japaneseIndex = columns.findIndex((column, index) => index > 0 && /[ぁ-んァ-ヶ一-龠〃]/.test(column));

    if (japaneseIndex < 0) {
      japaneseIndex = columns.length > 1 ? 1 : -1;
    }

    const english = columns.slice(0, japaneseIndex).join(", ").trim();
    let japanese = columns.slice(japaneseIndex).join(", ").trim();
    japanese = japanese.replace(/(\d),\s+(?=\d{3}\b)/g, "$1,");
    if (japanese === "//" || japanese.startsWith("//")) {
      japanese = `${previousJapanese}${japanese.slice(2)}`;
    }

    if (japanese) previousJapanese = japanese;
    if (english && japanese) parsed.push({ id, english, japanese });
  }

  return parsed;
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

function getWordStats() {
  try {
    return JSON.parse(localStorage.getItem("word-stock-stats")) || {};
  } catch {
    return {};
  }
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

  elements.historyMissCount.textContent = words.filter((word) => stats[word.id]?.wrong).length;
  if (!screens.mistakes.hidden) renderMistakeTable();
}

function needsReview(wordStats) {
  return wordStats.needsReview ?? wordStats.wrong > 0;
}

function getMistakeWords(stats = getWordStats()) {
  return words
    .filter((word) => stats[word.id]?.wrong)
    .sort((a, b) => stats[b.id].wrong - stats[a.id].wrong || a.id - b.id);
}

function getVisibleMistakeWords(stats = getWordStats()) {
  return getMistakeWords(stats).filter((word) => {
    const wordStats = stats[word.id];
    const statusMatches = mistakeStatusFilter === "all"
      || (mistakeStatusFilter === "review" && needsReview(wordStats))
      || (mistakeStatusFilter === "mastered" && !needsReview(wordStats))
      || (mistakeStatusFilter === "flagged" && wordStats.flagged);
    return statusMatches && (mistakeCountFilter === null || wordStats.wrong === mistakeCountFilter);
  });
}

function renderCountFilters(stats = getWordStats()) {
  const counts = [...new Set(getMistakeWords(stats).map((word) => stats[word.id].wrong))].sort((a, b) => a - b);
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
    const wordStats = stats[word.id];
    const attempts = (wordStats.correct || 0) + wordStats.wrong;
    const review = needsReview(wordStats);
    const row = document.createElement("tr");
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedMistakeIds.has(word.id);
    checkbox.setAttribute("aria-label", `${word.english}を選択`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedMistakeIds.add(word.id);
      else selectedMistakeIds.delete(word.id);
      updateMistakeSelection(visibleWords);
    });
    checkCell.className = "check-column";
    checkCell.append(checkbox);

    const values = [
      [String(word.id).padStart(3, "0"), "id-cell"],
      [word.english, "word-cell"],
      [word.japanese, ""],
      [`${wordStats.wrong}回`, ""],
      [`${Math.round(((wordStats.correct || 0) / attempts) * 100)}%`, ""],
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
    badge.className = `status-badge ${review ? "review" : "mastered"}`;
    badge.textContent = review ? "要復習" : "克服済み";
    statusCell.append(badge);
    row.append(statusCell);

    const flagCell = document.createElement("td");
    const flagButton = document.createElement("button");
    flagButton.type = "button";
    flagButton.className = `flag-button${wordStats.flagged ? " active" : ""}`;
    flagButton.textContent = "要注意";
    flagButton.setAttribute("aria-pressed", String(Boolean(wordStats.flagged)));
    flagButton.addEventListener("click", () => toggleWordFlag(word.id));
    flagCell.append(flagButton);
    row.append(flagCell);
    elements.mistakeTableBody.append(row);
  });

  updateMistakeSelection(visibleWords);
}

function toggleWordFlag(wordId) {
  const stats = getWordStats();
  const wordStats = stats[wordId];
  if (!wordStats) return;
  wordStats.flagged = !wordStats.flagged;
  try {
    localStorage.setItem("word-stock-stats", JSON.stringify(stats));
  } catch {
    return;
  }
  renderMistakeTable();
}

function updateMistakeSelection(visibleWords = getVisibleMistakeWords()) {
  const selectedVisible = visibleWords.filter((word) => selectedMistakeIds.has(word.id)).length;
  elements.selectAllVisible.checked = visibleWords.length > 0 && selectedVisible === visibleWords.length;
  elements.selectAllVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleWords.length;
  elements.selectedMistakeCount.textContent = selectedMistakeIds.size;
  elements.startMistakeTest.disabled = selectedMistakeIds.size === 0;
}

function showMistakes(resetSelection = true) {
  const stats = getWordStats();
  const missed = getMistakeWords(stats);
  if (resetSelection) {
    selectedMistakeIds = new Set(missed.map((word) => word.id));
    mistakeStatusFilter = "all";
    mistakeCountFilter = null;
  }

  const settings = getSettings();
  const modeLabel = settings.mode === "test" ? "テストモード" : "4択モード";
  const directionLabel = settings.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語";
  elements.retestSettings.textContent = `${modeLabel} / ${directionLabel}`;
  elements.statusFilters.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === mistakeStatusFilter);
  });
  renderCountFilters(stats);
  renderMistakeTable();
  showScreen("mistakes");
}

function saveSessionStats() {
  if (session.statsSaved) return;
  const stats = getWordStats();
  const results = session.settings.mode === "test" ? session.judgments : session.results;

  session.questions.forEach((word, index) => {
    const result = results[index];
    if (result === null) return;
    const current = stats[word.id] || { correct: 0, wrong: 0 };
    current.correct ||= 0;
    current.wrong ||= 0;
    current[result ? "correct" : "wrong"] += 1;
    if (!result) current.needsReview = true;
    else if (session.source === "mistakes") current.needsReview = false;
    else if (current.needsReview === undefined && current.wrong > 0) current.needsReview = true;
    stats[word.id] = current;
  });

  try {
    localStorage.setItem("word-stock-stats", JSON.stringify(stats));
    session.statsSaved = true;
  } catch {
    // Results still work when browser storage is unavailable.
  }
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
  session = {
    settings,
    source,
    sourceIds: pool.map((word) => word.id),
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
  return session.settings.direction === "en-ja" ? word.english : word.japanese;
}

function buildOptions(question) {
  const correctAnswer = getAnswer(question);
  const used = new Set([correctAnswer]);
  const distractors = [];
  const candidates = shuffle(session.pool.length >= 4 ? session.pool : words);

  for (const candidate of candidates) {
    const answer = getAnswer(candidate);
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
  elements.testAnswerText.textContent = getAnswer(question);
  elements.testNavigation.hidden = true;
  elements.reviewActions.hidden = false;
  elements.reviewCorrection.hidden = false;
  elements.previousReview.disabled = session.index === 0;
  elements.finishReview.hidden = session.index !== total - 1 || session.judgments[session.index] === null;
  elements.markCorrect.classList.toggle("selected", session.judgments[session.index] === true);
  elements.markWrong.classList.toggle("selected", session.judgments[session.index] === false);
  elements.keyboardHint.innerHTML = "<kbd>1</kbd> 正解　<kbd>2</kbd> 不正解";
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
  const correctAnswer = getAnswer(question);
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
      wrongCount.textContent = `間違い ${stats[word.id]?.wrong || 1}回`;
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

function setVisibleSelection(selected) {
  getVisibleMistakeWords().forEach((word) => {
    if (selected) selectedMistakeIds.add(word.id);
    else selectedMistakeIds.delete(word.id);
  });
  renderMistakeTable();
}

elements.selectVisible.addEventListener("click", () => setVisibleSelection(true));
elements.clearVisible.addEventListener("click", () => setVisibleSelection(false));
elements.selectAllVisible.addEventListener("change", () => setVisibleSelection(elements.selectAllVisible.checked));
elements.startMistakeTest.addEventListener("click", () => {
  const selectedWords = words.filter((word) => selectedMistakeIds.has(word.id));
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
    const sourceIds = new Set(session.sourceIds);
    beginQuiz(session.settings, words.filter((word) => sourceIds.has(word.id)), "mistakes");
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
    words = parseWordsCsv(await response.text());
    if (!words.length) throw new Error("No words parsed");

    const maxId = words.at(-1).id;
    elements.total.textContent = words.length;
    elements.to.max = maxId;
    elements.from.max = maxId;
    elements.to.value = maxId;
    elements.rangeOutput.value = `1 - ${maxId}`;
    elements.start.disabled = false;
    updateLearningStats();
  } catch (error) {
    console.error(error);
    elements.error.hidden = false;
    elements.error.textContent = "words.csvを読み込めませんでした。ローカルサーバーからこのページを開いてください。";
  }
}

initialize();
