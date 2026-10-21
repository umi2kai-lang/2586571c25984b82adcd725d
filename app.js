'use strict';
/*
 * SC 直前ドリル — app.js
 * 素のHTML/CSS/JSのみ。外部通信なし。記録は localStorage に保存する。
 * localStorage キー接頭辞: scapp.v1.
 */

/* ===== 定数・ユーティリティ ===== */

// 試験日時(JST)。端末のタイムゾーンに依存しないよう、JSTの時刻をUTCへ換算した
// 絶対時刻(ミリ秒)で保持する。JST = UTC+9 なので、UTC時刻 = JST時刻 − 9時間。
// 例: 科目A 2026-10-27 09:30 JST → 2026-10-27 00:30 UTC
var EXAMS = {
  A: { label: '科目A', ms: Date.UTC(2026, 9, 27, 0, 30, 0) },  // 月は0始まり: 9 = 10月
  B: { label: '科目B', ms: Date.UTC(2026, 10, 19, 0, 0, 0) }   // 10 = 11月
};

var LS = 'scapp.v1.';
var K_RECORDS = LS + 'records'; // { [id]: { a:試行数, c:正解数, last:'o'|'x', at:ms } }
var K_DAILY = LS + 'daily';     // { 'YYYY-MM-DD': { n:回答数, c:正答数 } }

var CHOICE_KEYS = ['ア', 'イ', 'ウ', 'エ'];

// A-2 / A-1 のカテゴリ(固定順)
var CATEGORIES = {
  'A-2': ['暗号・認証・PKI', 'ネットワークセキュリティ', 'Webセキュリティ', 'マルウェア・インシデント対応', 'セキュリティ管理・法規'],
  'A-1': ['テクノロジ', 'マネジメント', 'ストラテジ']
};

// 指定ミリ秒時点のJSTカレンダー日付(YYYY-MM-DD)を返す。
// UTCに9時間を足した時刻のUTC日付 = その瞬間のJST日付。
function jstDateKey(ms) {
  var d = new Date(ms + 9 * 3600 * 1000);
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function loadJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 容量超過等は無視 */ }
}

/* ===== 状態 ===== */

var QUESTIONS = [];
var QById = {};
var CARDS = [];        // 教科書(図解カード)。cards.json から読込
var records = loadJSON(K_RECORDS, {});
var daily = loadJSON(K_DAILY, {});

// 教科書ビューアの状態
var tb = {
  filter: 'all',  // all | A-1 | A-2 | 計算
  list: [],       // 現在のフィルタで並んだカード配列(閲覧順)
  idx: 0          // ビューアで表示中のインデックス(tb.list 内)
};

var ui = {
  mode: 'a1',
  count: 10
};

var session = null; // { items:[q], idx, correct, answered:[{id,ok,chosen}] }

/* ===== データ読込 ===== */

function init() {
  fetch('data/questions.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('問題データの取得に失敗しました: ' + r.status);
      return r.json();
    })
    .then(function (data) {
      QUESTIONS = (data && data.questions) || [];
      QUESTIONS.forEach(function (q) { QById[q.id] = q; });
      return loadCards();
    })
    .then(function () {
      bootUI();
    })
    .catch(function (err) {
      $('#main').insertAdjacentHTML('afterbegin',
        '<div class="card"><p>問題データを読み込めませんでした。ページを再読み込みしてください。</p></div>');
      console.error(err);
    });
}

// 教科書カードを読み込む。失敗してもドリル本体は使えるよう、常に解決する。
function loadCards() {
  return fetch('data/cards.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('cards ' + r.status);
      return r.json();
    })
    .then(function (data) {
      CARDS = (data && data.cards) || [];
    })
    .catch(function (err) {
      CARDS = [];
      console.error('教科書データを読み込めませんでした', err);
    });
}

/* ===== UI 初期化 ===== */

function bootUI() {
  // タブ
  $all('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  // 教科書(図解カード)
  setupTextbook();

  // モード選択
  $all('#mode-seg .seg__btn').forEach(function (b) {
    b.addEventListener('click', function () {
      setSeg('#mode-seg', b);
      ui.mode = b.dataset.mode;
      updateModeNote();
    });
  });
  // 出題数選択
  $all('#count-seg .seg__btn').forEach(function (b) {
    b.addEventListener('click', function () {
      setSeg('#count-seg', b);
      ui.count = parseInt(b.dataset.count, 10);
    });
  });

  $('#start-btn').addEventListener('click', startSession);
  $('#quiz-quit').addEventListener('click', function () {
    confirmDialog('セッションを中断', '現在のセッションを中断してホームに戻りますか。ここまでの回答記録は保存されます。', function () {
      session = null;
      showView('home');
    });
  });

  $('#res-again').addEventListener('click', startSession);
  $('#res-home').addEventListener('click', function () { showView('home'); });

  $('#st-export').addEventListener('click', exportRecords);
  $('#st-reset').addEventListener('click', function () {
    confirmDialog('記録をリセット', 'すべての学習記録(回答履歴・統計)を削除します。元に戻せません。よろしいですか。', resetRecords);
  });

  // モーダル
  $('#confirm-cancel').addEventListener('click', closeDialog);

  updateModeNote();
  renderHome();
  showView('home');

  // Service Worker 登録(オフライン対応)。
  // 新しい版が公開されたら即時反映するため、登録後に update() で更新を確認し、
  // 制御する SW が切り替わったら一度だけリロードする。
  if ('serviceWorker' in navigator) {
    // 初回インストール時(まだ制御SWなし)は clients.claim による controllerchange が
    // 発火するが、ページは既に最新なのでリロードしない。更新で制御が切り替わった時だけ
    // 一度リロードして新しい版を確実に反映する。
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded) return;  // 初回 or 二重リロードを防止
      reloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      try { reg.update(); } catch (e) { /* 失敗は無視 */ }
    }).catch(function () { /* 失敗は無視 */ });
  }
}

function setSeg(segSel, btn) {
  $all(segSel + ' .seg__btn').forEach(function (b) {
    var on = (b === btn);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function updateModeNote() {
  var notes = {
    a1: 'A-1(共通知識)の全分野からランダムに出題します。',
    a2: 'A-2(セキュリティ専門)の全カテゴリからランダムに出題します。',
    weak: 'カテゴリ別の誤答率や直近の誤り・未回答をもとに、弱点を重み付けして出題します。',
    review: '最後の回答が誤りだった問題だけを出題します。正解すると復習リストから外れます。',
    all: 'A-1・A-2のすべての問題からランダムに出題します。'
  };
  var note = notes[ui.mode] || '';
  if (ui.mode === 'review') {
    var n = reviewPool().length;
    note += ' 現在 ' + n + ' 問。';
  }
  $('#mode-note').textContent = note;
}

/* ===== 画面遷移 ===== */

function showView(name) {
  $all('.view').forEach(function (v) { v.hidden = true; });
  var map = {
    home: '#view-home', quiz: '#view-quiz', result: '#view-result',
    stats: '#view-stats', textbook: '#view-textbook', card: '#view-card'
  };
  var el = $(map[name]);
  if (el) el.hidden = false;

  // タブのハイライト(quiz/result はホーム扱い、card は教科書扱い)
  var tabFor = (name === 'stats') ? 'stats'
    : (name === 'textbook' || name === 'card') ? 'textbook'
    : 'home';
  $all('.tab').forEach(function (t) { t.classList.toggle('is-on', t.dataset.view === tabFor); });

  if (name === 'home') { renderHome(); updateModeNote(); }
  if (name === 'stats') renderStats();
  if (name === 'textbook') renderTextbook();
  window.scrollTo(0, 0);
}

/* ===== ホーム ===== */

var countdownTimer = null;

function renderHome() {
  renderCountdown();
  if (countdownTimer) clearInterval(countdownTimer);
  // 1分ごとに更新(時・分表示のため)
  countdownTimer = setInterval(renderCountdown, 60 * 1000);

  // 今日の成績
  var today = daily[jstDateKey(Date.now())] || { n: 0, c: 0 };
  $('#today-count').textContent = today.n;
  $('#today-correct').textContent = today.c;

  renderWeakTop3();
}

function renderCountdown() {
  var now = Date.now();
  renderOneCountdown('#cd-a', EXAMS.A.ms - now);
  renderOneCountdown('#cd-b', EXAMS.B.ms - now);
}

function renderOneCountdown(sel, diffMs) {
  var card = $(sel);
  var valEl = $('[data-cd-value]', card);
  if (diffMs <= 0) {
    card.classList.add('is-past');
    valEl.textContent = '開始時刻になりました';
    return;
  }
  card.classList.remove('is-past');
  var totalMin = Math.floor(diffMs / 60000);
  var days = Math.floor(totalMin / (60 * 24));
  var hours = Math.floor((totalMin - days * 60 * 24) / 60);
  valEl.innerHTML = '<strong>' + days + '</strong>日 ' + hours + '時間';
}

function renderWeakTop3() {
  var stats = categoryStats(); // [{cat, exam, attempts, correct, errRate}]
  var attempted = stats.filter(function (s) { return s.attempts > 0; });
  attempted.sort(function (a, b) {
    if (b.errRate !== a.errRate) return b.errRate - a.errRate;
    return b.attempts - a.attempts;
  });
  var top = attempted.slice(0, 3);
  var ul = $('#weak-list');
  if (top.length === 0) {
    ul.innerHTML = '<li class="muted">まだデータがありません。問題を解くと表示されます。</li>';
    return;
  }
  ul.innerHTML = top.map(function (s, i) {
    return '<li><span class="rank">' + (i + 1) + '</span>' +
      '<span>' + escapeHTML(s.cat) + '<br><span class="muted" style="font-size:11px">' + s.exam + ' ／ ' + s.attempts + '回</span></span>' +
      '<span class="wrate">誤答率 ' + Math.round(s.errRate * 100) + '%</span></li>';
  }).join('');
}

/* ===== 問題選択 ===== */

function reviewPool() {
  return QUESTIONS.filter(function (q) {
    var r = records[q.id];
    return r && r.last === 'x';
  });
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// カテゴリ別の誤答率を計算して返す
function categoryStats() {
  var agg = {};
  function keyOf(exam, cat) { return exam + '|' + cat; }
  Object.keys(CATEGORIES).forEach(function (exam) {
    CATEGORIES[exam].forEach(function (cat) {
      agg[keyOf(exam, cat)] = { cat: cat, exam: exam, attempts: 0, correct: 0 };
    });
  });
  QUESTIONS.forEach(function (q) {
    var r = records[q.id];
    if (!r || !r.a) return;
    var k = keyOf(q.exam, q.category);
    if (!agg[k]) agg[k] = { cat: q.category, exam: q.exam, attempts: 0, correct: 0 };
    agg[k].attempts += r.a;
    agg[k].correct += r.c;
  });
  return Object.keys(agg).map(function (k) {
    var s = agg[k];
    s.errRate = s.attempts > 0 ? (s.attempts - s.correct) / s.attempts : 0;
    return s;
  });
}

// カテゴリ -> 誤答率 の辞書
function categoryErrRateMap() {
  var m = {};
  categoryStats().forEach(function (s) { m[s.exam + '|' + s.cat] = s.errRate; });
  return m;
}

/*
 * 苦手優先の重み付け。
 * weight = 1(基礎点)
 *        + 3 * (そのカテゴリの誤答率)   … 誤りやすい分野を厚く
 *        + 2 * (この問題を最後に間違えたか)… 直近で間違えた問題を厚く
 *        + 1.5(未回答ボーナス)          … まだ解いていない問題を拾う
 * 重みが大きい問題ほど選ばれやすくなるよう、重み付き抽選(非復元)で選ぶ。
 */
function weightOf(q, errMap) {
  var w = 1;
  var errRate = errMap[q.exam + '|' + q.category] || 0;
  w += 3 * errRate;
  var r = records[q.id];
  if (!r || !r.a) {
    w += 1.5; // 未回答ボーナス
  } else if (r.last === 'x') {
    w += 2;   // 最後に間違えた
  }
  return w;
}

// 重み付き非復元抽選
function weightedSample(pool, weights, k) {
  var items = pool.slice();
  var ws = weights.slice();
  var picked = [];
  k = Math.min(k, items.length);
  for (var n = 0; n < k; n++) {
    var total = ws.reduce(function (s, x) { return s + x; }, 0);
    var r = Math.random() * total;
    var idx = 0;
    for (; idx < ws.length; idx++) {
      r -= ws[idx];
      if (r <= 0) break;
    }
    if (idx >= items.length) idx = items.length - 1;
    picked.push(items[idx]);
    items.splice(idx, 1);
    ws.splice(idx, 1);
  }
  return picked;
}

function buildItems(mode, count) {
  var pool;
  if (mode === 'a1') {
    pool = QUESTIONS.filter(function (q) { return q.exam === 'A-1'; });
    return shuffle(pool).slice(0, count);
  }
  if (mode === 'a2') {
    pool = QUESTIONS.filter(function (q) { return q.exam === 'A-2'; });
    return shuffle(pool).slice(0, count);
  }
  if (mode === 'all') {
    return shuffle(QUESTIONS).slice(0, count);
  }
  if (mode === 'review') {
    return shuffle(reviewPool()).slice(0, count);
  }
  if (mode === 'weak') {
    pool = QUESTIONS.slice();
    var errMap = categoryErrRateMap();
    var weights = pool.map(function (q) { return weightOf(q, errMap); });
    return weightedSample(pool, weights, count);
  }
  return [];
}

/* ===== セッション ===== */

function startSession() {
  var items = buildItems(ui.mode, ui.count);
  if (items.length === 0) {
    if (ui.mode === 'review') {
      alert('復習できる問題がありません。まず他のモードで問題を解いてください。');
    } else {
      alert('出題できる問題がありません。');
    }
    return;
  }
  session = { items: items, idx: 0, correct: 0, answered: [] };
  showView('quiz');
  renderQuestion();
}

function renderQuestion() {
  var q = session.items[session.idx];
  $('#q-total').textContent = session.items.length;
  $('#q-index').textContent = session.idx + 1;
  $('#quiz-progress').style.width = ((session.idx) / session.items.length * 100) + '%';

  $('#q-exam').textContent = q.exam;
  $('#q-cat').textContent = q.category;
  $('#q-text').textContent = q.question;

  var box = $('#q-choices');
  box.innerHTML = '';
  q.choices.forEach(function (c, i) {
    var btn = document.createElement('button');
    btn.className = 'choice';
    btn.type = 'button';
    btn.innerHTML = '<span class="choice__key">' + CHOICE_KEYS[i] + '</span><span>' + escapeHTML(c) + '</span>';
    btn.addEventListener('click', function () { answer(i); });
    box.appendChild(btn);
  });

  $('#q-feedback').hidden = true;
  $('#q-feedback').innerHTML = feedbackSkeleton();
}

function feedbackSkeleton() {
  // renderQuestion で毎回クリアするため、固定の内側HTMLを再設定
  return '' +
    '<div class="feedback__head" id="fb-head"></div>' +
    '<div class="feedback__block"><h3 class="feedback__h">解説</h3><p id="fb-explanation"></p></div>' +
    '<div class="feedback__block" id="fb-notes-block" hidden><h3 class="feedback__h">各選択肢について</h3><ul id="fb-notes"></ul></div>' +
    '<div class="feedback__source" id="fb-source"></div>' +
    '<div class="next-wrap"><button class="btn btn--primary btn--block" id="fb-next">次へ</button></div>';
}

function answer(chosen) {
  var q = session.items[session.idx];
  var ok = (chosen === q.answer);

  // 選択肢ボタンの状態更新(全て無効化、正解/不正解を着色)
  var btns = $all('#q-choices .choice');
  btns.forEach(function (b, i) {
    b.disabled = true;
    if (i === q.answer) b.classList.add('is-correct');
    if (i === chosen && !ok) b.classList.add('is-wrong');
  });

  // 記録
  recordAnswer(q, ok);
  session.correct += ok ? 1 : 0;
  session.answered.push({ id: q.id, ok: ok, chosen: chosen });

  // フィードバック表示
  var fb = $('#q-feedback');
  fb.hidden = false;
  var head = $('#fb-head');
  head.textContent = ok ? '正解' : '不正解 — 正解は「' + CHOICE_KEYS[q.answer] + '」';
  head.className = 'feedback__head ' + (ok ? 'ok' : 'ng');

  $('#fb-explanation').textContent = q.explanation || '';

  // 各選択肢の誤りメモ(空でないものだけ)
  var notes = q.choiceNotes || [];
  var rows = [];
  notes.forEach(function (note, i) {
    if (note && i !== q.answer) {
      rows.push('<li><strong>' + CHOICE_KEYS[i] + '：</strong>' + escapeHTML(note) + '</li>');
    }
  });
  var nb = $('#fb-notes-block');
  if (rows.length) {
    $('#fb-notes').innerHTML = rows.join('');
    nb.hidden = false;
  } else {
    nb.hidden = true;
  }

  $('#fb-source').textContent = '出典: ' + sourceText(q.source);

  $('#quiz-progress').style.width = ((session.idx + 1) / session.items.length * 100) + '%';

  var next = $('#fb-next');
  next.textContent = (session.idx + 1 < session.items.length) ? '次へ' : '結果を見る';
  next.addEventListener('click', nextQuestion);
  next.focus();
  fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function sourceText(src) {
  if (!src) return '不明';
  var t = src.label || '';
  if (src.url) t += '（' + src.url + '）';
  if (src.modified) t += '［改変あり］';
  return t;
}

function nextQuestion() {
  session.idx++;
  if (session.idx >= session.items.length) {
    renderResult();
  } else {
    renderQuestion();
  }
}

/* ===== 記録 ===== */

function recordAnswer(q, ok) {
  var r = records[q.id] || { a: 0, c: 0, last: null, at: 0 };
  r.a += 1;
  if (ok) r.c += 1;
  r.last = ok ? 'o' : 'x';
  r.at = Date.now();
  records[q.id] = r;
  saveJSON(K_RECORDS, records);

  var dk = jstDateKey(Date.now());
  var d = daily[dk] || { n: 0, c: 0 };
  d.n += 1;
  if (ok) d.c += 1;
  daily[dk] = d;
  saveJSON(K_DAILY, daily);
}

/* ===== 結果 ===== */

function renderResult() {
  showView('result');
  var total = session.items.length;
  var correct = session.correct;
  $('#res-correct').textContent = correct;
  $('#res-total').textContent = total;
  $('#res-rate').textContent = '正答率 ' + Math.round(correct / total * 100) + '%';

  var ul = $('#res-review');
  ul.innerHTML = session.answered.map(function (a, i) {
    var q = QById[a.id];
    return '<li><span class="mark ' + (a.ok ? 'ok' : 'ng') + '">' + (a.ok ? '○' : '×') + '</span>' +
      '<span>' + (i + 1) + '. ' + escapeHTML(truncate(q.question, 48)) +
      '<br><span class="muted" style="font-size:11px">' + q.exam + ' ／ ' + escapeHTML(q.category) + '</span></span></li>';
  }).join('');
}

/* ===== 統計 ===== */

function renderStats() {
  var total = 0, correct = 0;
  Object.keys(records).forEach(function (id) {
    total += records[id].a || 0;
    correct += records[id].c || 0;
  });
  $('#st-total').textContent = total;
  $('#st-rate').textContent = (total > 0 ? Math.round(correct / total * 100) : 0) + '%';

  // 科目別
  var examAgg = { 'A-1': { a: 0, c: 0 }, 'A-2': { a: 0, c: 0 } };
  QUESTIONS.forEach(function (q) {
    var r = records[q.id];
    if (!r || !r.a) return;
    if (!examAgg[q.exam]) examAgg[q.exam] = { a: 0, c: 0 };
    examAgg[q.exam].a += r.a;
    examAgg[q.exam].c += r.c;
  });
  $('#st-exam-bars').innerHTML = ['A-1', 'A-2'].map(function (ex) {
    return barRow(ex, examAgg[ex].c, examAgg[ex].a);
  }).join('');

  // カテゴリ別
  var cs = categoryStats();
  $('#st-cat-bars').innerHTML = cs.map(function (s) {
    return barRow(s.cat + ' (' + s.exam + ')', s.correct, s.attempts);
  }).join('');

  renderWeekSpark();
}

function barRow(label, correct, attempts) {
  var pct = attempts > 0 ? Math.round(correct / attempts * 100) : 0;
  var cls = attempts === 0 ? '' : (pct < 60 ? 'low' : (pct < 80 ? 'mid' : 'high'));
  var pctText = attempts > 0 ? pct + '%' : '—';
  return '<div class="barrow">' +
    '<div class="barrow__label"><span>' + escapeHTML(label) + '</span><span class="pct">' + pctText + '</span></div>' +
    '<div class="barrow__track"><div class="barrow__fill ' + cls + '" style="width:' + (attempts > 0 ? pct : 0) + '%"></div></div>' +
    '<div class="barrow__n">' + correct + ' / ' + attempts + ' 問正解</div>' +
    '</div>';
}

function renderWeekSpark() {
  var base = Date.now();
  var cols = [];
  var max = 1;
  for (var i = 6; i >= 0; i--) {
    var key = jstDateKey(base - i * 86400000);
    var d = daily[key] || { n: 0, c: 0 };
    max = Math.max(max, d.n);
    cols.push({ key: key, n: d.n, label: key.slice(5).replace('-', '/') });
  }
  $('#st-week').innerHTML = cols.map(function (c) {
    var h = Math.round(c.n / max * 100);
    return '<div class="spark__col">' +
      '<span class="spark__val">' + c.n + '</span>' +
      '<div class="spark__bar" style="height:' + h + '%"></div>' +
      '<span class="spark__day">' + c.label + '</span></div>';
  }).join('');
}

/* ===== エクスポート / リセット ===== */

function exportRecords() {
  var payload = {
    app: 'sc-exam-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records,
    daily: daily
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'sc-drill-records-' + jstDateKey(Date.now()) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function resetRecords() {
  records = {};
  daily = {};
  localStorage.removeItem(K_RECORDS);
  localStorage.removeItem(K_DAILY);
  closeDialog();
  renderStats();
}

/* ===== モーダル ===== */

var dialogCb = null;
function confirmDialog(title, msg, cb) {
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = msg;
  dialogCb = cb;
  var m = $('#confirm-modal');
  m.hidden = false;
  var ok = $('#confirm-ok');
  // 既存のリスナを置き換えるためクローン
  var fresh = ok.cloneNode(true);
  ok.parentNode.replaceChild(fresh, ok);
  fresh.addEventListener('click', function () {
    var cb = dialogCb;
    closeDialog();
    if (cb) cb();
  });
}
function closeDialog() {
  $('#confirm-modal').hidden = true;
  dialogCb = null;
}

/* ===== 教科書(図解カード) ===== */

var KIND_LABELS = {
  compare: '比較図', flow: '流れ図', steps: '手順図', hierarchy: '階層図',
  chain: '連鎖図', timeline: '時系列', matrix: 'マトリクス', four: '4区分',
  forces: '5フォース', roc: 'ROC曲線', overview: '俯瞰図', recap: 'まとめ図'
};

// フィルタ条件。A-1 チップは A-1 章に加え、A-1(高度共通午前I)由来の計算カードも拾う。
function cardMatchesFilter(c, f) {
  if (f === 'all') return true;
  if (f === 'A-1') return c.category === 'A-1' || (c.category === '計算' && (c.examLevels || []).indexOf('A-1') >= 0);
  if (f === 'A-2') return c.category === 'A-2';
  if (f === '計算') return c.category === '計算';
  return true;
}

function filteredCards() {
  return CARDS.filter(function (c) { return cardMatchesFilter(c, tb.filter); });
}

function setupTextbook() {
  // フィルタチップ
  $all('#tb-filter .chip--filter').forEach(function (b) {
    b.addEventListener('click', function () {
      tb.filter = b.dataset.filter;
      renderTextbook();
    });
  });
  // ビューア操作
  $('#cv-back').addEventListener('click', function () { showView('textbook'); });
  $('#cv-prev').addEventListener('click', function () { goCard(-1); });
  $('#cv-next').addEventListener('click', function () { goCard(1); });

  // 左右スワイプでめくる
  var sx = 0, sy = 0, tracking = false;
  var swipe = $('#cv-swipe');
  swipe.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY; tracking = true;
  }, { passive: true });
  swipe.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goCard(dx < 0 ? 1 : -1); // 左スワイプ=次へ / 右スワイプ=前へ
    }
  }, { passive: true });
}

function renderTextbook() {
  // チップの選択状態
  $all('#tb-filter .chip--filter').forEach(function (b) {
    var on = (b.dataset.filter === tb.filter);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  var box = $('#tb-list');
  if (!CARDS.length) {
    box.innerHTML = '<div class="card"><p class="muted">教科書データを読み込めませんでした。オンラインで再読み込みしてください。</p></div>';
    return;
  }

  var list = filteredCards();
  var html = '';
  var curCh = null;
  list.forEach(function (c) {
    if (c.chapter !== curCh) {
      curCh = c.chapter;
      html += '<h3 class="tb-chapter">' + escapeHTML(curCh) + '</h3>';
    }
    html += '<button class="tb-item" type="button" data-id="' + c.id + '">' +
      '<span class="tb-item__body">' +
        '<span class="tb-item__title">' + escapeHTML(c.title) + '</span>' +
        '<span class="tb-item__essence">' + escapeHTML(c.essence) + '</span>' +
      '</span>' +
      '<span class="tb-item__cat">' + escapeHTML(c.category) + '</span>' +
      '</button>';
  });
  box.innerHTML = html || '<div class="card"><p class="muted">該当するカードがありません。</p></div>';

  $all('#tb-list .tb-item').forEach(function (el) {
    el.addEventListener('click', function () { openCard(parseInt(el.dataset.id, 10)); });
  });
}

function openCard(id) {
  tb.list = filteredCards();
  var i = 0;
  for (var k = 0; k < tb.list.length; k++) {
    if (tb.list[k].id === id) { i = k; break; }
  }
  tb.idx = i;
  showView('card');
  renderCard();
}

function goCard(delta) {
  var n = tb.idx + delta;
  if (n < 0 || n >= tb.list.length) return;
  tb.idx = n;
  renderCard();
}

function renderCard() {
  var c = tb.list[tb.idx];
  if (!c) { showView('textbook'); return; }

  $('#cv-chapter').textContent = c.chapter;
  $('#cv-pos').textContent = (tb.idx + 1) + ' / ' + tb.list.length;
  $('#cv-cat').textContent = c.category;
  $('#cv-kind').textContent = KIND_LABELS[c.kind] || c.kind;
  $('#cv-title').textContent = c.title;
  $('#cv-essence').textContent = c.essence;

  // 図は自前の研究成果物(信頼済み)。インラインSVGをそのまま描画する。
  $('#cv-diagram').innerHTML = c.svg || '';

  $('#cv-keywords').innerHTML = (c.keywords || []).map(function (k) {
    return '<span class="keyword">' + escapeHTML(k) + '</span>';
  }).join('');

  var mw = $('#cv-memory-wrap');
  if (c.memory) { mw.hidden = false; $('#cv-memory').textContent = c.memory; } else { mw.hidden = true; }
  var tw = $('#cv-trap-wrap');
  if (c.trap) { tw.hidden = false; $('#cv-trap').textContent = c.trap; } else { tw.hidden = true; }

  var src = '出典：' + (c.sources || []).map(function (s) {
    return '<a href="' + escapeHTML(s.url) + '" target="_blank" rel="noopener">' + escapeHTML(s.text) + '</a>';
  }).join(' ／ ');
  if (c.supplement) {
    src += '<br><span class="cardview__supp"><a href="' + escapeHTML(c.supplement.url) +
      '" target="_blank" rel="noopener">' + escapeHTML(c.supplement.text) + '</a></span>';
  }
  $('#cv-source').innerHTML = src;

  $('#cv-prev').disabled = (tb.idx <= 0);
  $('#cv-next').disabled = (tb.idx >= tb.list.length - 1);

  window.scrollTo(0, 0);
}

/* ===== 小道具 ===== */

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* 起動 */
document.addEventListener('DOMContentLoaded', init);
