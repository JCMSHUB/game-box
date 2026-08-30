/**
 * 界面与交互：渲染棋盘、落子、人机/双人对战、悔棋/重做、提示、
 * 计时、进度自动保存与胜负判定。
 * 依赖 gomoku.js 提供的 window.Gomoku。
 */
(function () {
  'use strict';

  var SIZE = Gomoku.SIZE;
  var TOTAL = SIZE * SIZE;

  // ---------- 游戏状态 ----------
  var board = [];        // 当前局面：0 空 / 1 黑 / 2 白
  var moves = [];        // 落子序列 [{i, player}]，悔棋/重做直接在其上增删
  var redoMoves = [];    // 被悔掉的手（后进先出），供重做
  var mode = 'pve';      // 'pve' 人机 | 'pvp' 双人
  var difficulty = 'medium';
  var playerColor = 1;   // 人机模式下玩家执黑先行，AI 执白
  var current = 1;       // 当前该走的一方
  var lastMove = -1;
  var seconds = 0;
  var timerId = null;
  var finished = false;
  var aiTimerId = null;  // AI 思考的延时器
  var winLine = [];      // 获胜连线上的格子
  var overlayTimerId = null;
  var cursor = 7 * SIZE + 7; // 键盘虚拟光标，默认天元

  var SAVE_KEY = 'gomoku-save-v1';
  var PREF_KEY = 'gomoku-pref-v1';
  var STATS_KEY = 'gomoku-stats-v1';
  var confirmAction = null; // 确认弹层「确定」后要执行的动作

  // ---------- DOM ----------
  var boardEl = document.getElementById('board');
  var statusEl = document.getElementById('status');
  var timerEl = document.getElementById('timer');
  var overlayEl = document.getElementById('overlay');
  var overlayTitleEl = document.getElementById('overlayTitle');
  var overlayTextEl = document.getElementById('overlayText');
  var againBtn = document.getElementById('again');
  var reviewBtn = document.getElementById('review');
  var undoBtn = document.getElementById('undoBtn');
  var redoBtn = document.getElementById('redoBtn');
  var hintBtn = document.getElementById('hintBtn');
  var modeGroupEl = document.getElementById('modeGroup');
  var diffGroupEl = document.getElementById('diffGroup');
  var confirmOverlayEl = document.getElementById('confirmOverlay');
  var confirmTextEl = document.getElementById('confirmText');
  var confirmOkBtn = document.getElementById('confirmOk');
  var confirmCancelBtn = document.getElementById('confirmCancel');
  var statsBtn = document.getElementById('statsBtn');
  var statsOverlayEl = document.getElementById('statsOverlay');
  var statsContentEl = document.getElementById('statsContent');
  var statsClearBtn = document.getElementById('statsClear');
  var statsCloseBtn = document.getElementById('statsClose');
  var themeBtn = document.getElementById('themeBtn');

  // 创建 225 个格子，只建一次，之后只改内容和样式类
  var cells = [];
  for (var i = 0; i < TOTAL; i++) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.i = i;
    var r0 = (i / SIZE) | 0, c0 = i % SIZE;
    // 星位：四角星 + 天元
    if ((r0 === 3 || r0 === 11) && (c0 === 3 || c0 === 11)) cell.classList.add('star');
    if (r0 === 7 && c0 === 7) cell.classList.add('star');
    boardEl.appendChild(cell);
    cells.push(cell);
  }

  function formatTime(s) {
    var m = String(Math.floor(s / 60)).padStart(2, '0');
    var ss = String(s % 60).padStart(2, '0');
    return m + ':' + ss;
  }

  // ---------- 计时 ----------
  function startTimerFrom(from) {
    stopTimer();
    seconds = from;
    timerEl.textContent = formatTime(seconds);
    timerId = setInterval(function () {
      seconds += 1;
      timerEl.textContent = formatTime(seconds);
      if (seconds % 5 === 0) saveGame(); // 定期把计时进度写进存档
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // ---------- AI ----------
  function isAiTurn() {
    return mode === 'pve' && current !== playerColor;
  }

  function cancelAi() {
    if (aiTimerId !== null) {
      clearTimeout(aiTimerId);
      aiTimerId = null;
    }
  }

  function scheduleAiIfNeeded() {
    if (finished || !isAiTurn()) return;
    updateStatus(); // 显示「AI 思考中…」
    aiTimerId = setTimeout(makeAiMove, 300);
  }

  function makeAiMove() {
    aiTimerId = null;
    if (finished) return;
    var mv = Gomoku.findBestMove(board, current, difficulty);
    if (mv < 0) return;
    redoMoves.length = 0;
    commitMove({ i: mv, player: current });
  }

  // ---------- 落子 ----------
  // 所有落子（玩家 / AI / 重做）最终都走这里：改棋面、渲染、存档、判胜负
  function commitMove(m) {
    board[m.i] = m.player;
    moves.push(m);
    lastMove = m.i;
    render();
    saveGame();

    var win = Gomoku.checkWin(board, m.i);
    if (win) { endGame(win); return; }
    if (Gomoku.isBoardFull(board)) { endGame(null); return; }
    current = 3 - m.player;
    updateStatus();
    scheduleAiIfNeeded();
  }

  // 重做时复手：与 commitMove 相同但不清理重做栈、由 redo 统一决定是否再调度 AI
  function replayMove(m) {
    board[m.i] = m.player;
    moves.push(m);
    lastMove = m.i;
    render();
    saveGame();
    var win = Gomoku.checkWin(board, m.i);
    if (win) { endGame(win); return; }
    if (Gomoku.isBoardFull(board)) { endGame(null); return; }
    current = 3 - m.player;
  }

  // ---------- 悔棋 / 重做 ----------
  // 终局后也允许悔棋：回到局中继续下（复盘续战）
  function undo() {
    if (moves.length === 0) return;
    cancelAi();
    var wasFinished = finished;
    var steps = 1;
    if (mode === 'pve') {
      // 最后一手是 AI（轮到玩家）→ 一次退两步回到玩家落子前；
      // 最后一手是玩家（AI 还没回，比如思考中悔棋）→ 只退一步
      steps = moves[moves.length - 1].player === playerColor ? 1 : 2;
    }
    steps = Math.min(steps, moves.length);
    while (steps-- > 0) redoMoves.push(moves.pop());
    rebuildFromMoves();

    // 从终局回到局中：清掉连线高亮、恢复计时和存档
    if (wasFinished) {
      finished = false;
      winLine = [];
      boardEl.classList.remove('win');
      for (var w = 0; w < TOTAL; w++) {
        cells[w].style.removeProperty('animation-delay');
      }
      startTimerFrom(seconds);
    }

    render();
    saveGame();
    updateStatus();
    scheduleAiIfNeeded();
  }

  function redo() {
    if (finished || redoMoves.length === 0) return;
    replayMove(redoMoves.pop());
    // 人机模式把存下的 AI 原手一并重做，避免 AI 重新思考走出不同的棋
    if (!finished && mode === 'pve' && isAiTurn() && redoMoves.length) {
      replayMove(redoMoves.pop());
    }
    render();
    updateStatus();
    scheduleAiIfNeeded(); // 重做栈里没有 AI 原手可回放时（如思考中悔棋），才会真正重新思考
  }

  function rebuildFromMoves() {
    board = Gomoku.createBoard();
    for (var k = 0; k < moves.length; k++) {
      board[moves[k].i] = moves[k].player;
    }
    lastMove = moves.length ? moves[moves.length - 1].i : -1;
    current = moves.length ? 3 - moves[moves.length - 1].player : 1;
  }

  // ---------- 进度自动保存 ----------
  function saveGame() {
    if (finished) return; // 终局后不再写存档（终局时已清档）
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: 1,
        mode: mode,
        difficulty: difficulty,
        playerColor: playerColor,
        moves: moves,
        seconds: seconds,
      }));
    } catch (e) { /* 存储不可用（如隐私模式）时静默跳过 */ }
  }

  function loadSavedGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1) return false;
      if (s.mode !== 'pve' && s.mode !== 'pvp') return false;
      if (!Gomoku.DIFFICULTY[s.difficulty] || !Array.isArray(s.moves)) return false;

      // 逐手回放并校验：索引合法、先后手交替、不能已有胜局（终局时存档已被清掉）
      var b = Gomoku.createBoard();
      var expect = 1;
      for (var k = 0; k < s.moves.length; k++) {
        var m = s.moves[k];
        if (!m || m.player !== expect || !(m.i >= 0 && m.i < TOTAL) || b[m.i] !== 0) return false;
        b[m.i] = m.player;
        if (Gomoku.checkWin(b, m.i)) return false;
        expect = 3 - expect;
      }

      board = b;
      moves = s.moves;
      mode = s.mode;
      difficulty = s.difficulty;
      playerColor = mode === 'pve' && s.playerColor === 2 ? 2 : 1;
      current = moves.length ? 3 - moves[moves.length - 1].player : 1;
      lastMove = moves.length ? moves[moves.length - 1].i : -1;
      seconds = Number(s.seconds) || 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  // ---------- 渲染 ----------
  function render() {
    for (var i = 0; i < TOTAL; i++) {
      var cell = cells[i];
      var v = board[i];
      cell.classList.toggle('black', v === 1);
      cell.classList.toggle('white', v === 2);
      cell.classList.toggle('empty', v === 0);
      cell.classList.toggle('last', i === lastMove);
      cell.classList.toggle('win-line', winLine.indexOf(i) !== -1);
      cell.classList.toggle('cursor', i === cursor);
    }

    // 悔棋/重做终局后仍可用（复盘续战）；提示在终局后无意义
    undoBtn.disabled = moves.length === 0;
    redoBtn.disabled = redoMoves.length === 0;
    hintBtn.disabled = finished || isAiTurn();
  }

  function updateStatus() {
    boardEl.classList.toggle('turn-black', !finished && current === 1);
    boardEl.classList.toggle('turn-white', !finished && current === 2);
    boardEl.classList.toggle('locked', !finished && isAiTurn());

    if (finished) {
      statusEl.textContent = '对局结束';
      return;
    }

    var dot = '<span class="dot ' + (current === 1 ? 'black' : 'white') + '"></span>';
    if (isAiTurn()) {
      statusEl.innerHTML = dot + 'AI 思考中…';
    } else if (mode === 'pve') {
      statusEl.innerHTML = dot + '轮到你落子（' + (current === 1 ? '黑棋' : '白棋') + '）';
    } else {
      statusEl.innerHTML = dot + '轮到' + (current === 1 ? '黑方' : '白方') + '落子';
    }
  }

  function syncButtons() {
    var modeBtns = modeGroupEl.querySelectorAll('.diff-btn');
    for (var k = 0; k < modeBtns.length; k++) {
      modeBtns[k].classList.toggle('active', modeBtns[k].dataset.mode === mode);
    }
    var diffBtns = diffGroupEl.querySelectorAll('.diff-btn');
    for (var d = 0; d < diffBtns.length; d++) {
      diffBtns[d].classList.toggle('active', diffBtns[d].dataset.difficulty === difficulty);
    }
    // 双人模式下 AI 难度无关紧要，整组禁用
    diffGroupEl.classList.toggle('disabled', mode === 'pvp');
  }

  // ---------- 提示 ----------
  // 用困难档 AI 给当前行动方推荐一手，仅高亮不代下
  function hint() {
    if (finished || isAiTurn()) return;
    var mv = Gomoku.findBestMove(board, current, 'hard');
    if (mv < 0) return;
    var cell = cells[mv];
    cell.classList.add('hinted');
    setTimeout(function () { cell.classList.remove('hinted'); }, 1000);
  }

  // ---------- 终局 ----------
  function endGame(win) {
    finished = true;
    stopTimer();
    cancelAi();
    recordResult(win); // 记入战绩
    clearSave(); // 终局后清掉存档，下次打开是新的一局
    winLine = win ? win.line : [];
    render();
    updateStatus();
    showOverlay(win);
  }

  function showOverlay(win) {
    if (win) playWinPulse();

    var title;
    if (!win) {
      title = '🤝 平局';
    } else if (mode === 'pve') {
      title = win.winner === playerColor ? '🎉 你赢了！' : '🤖 AI 获胜';
    } else {
      title = win.winner === 1 ? '⚫ 黑方获胜' : '⚪ 白方获胜';
    }

    var detail = '用时 ' + formatTime(seconds) + ' · ';
    detail += mode === 'pvp' ? '双人对战'
      : 'AI「' + Gomoku.DIFFICULTY[difficulty].label + '」';

    overlayTimerId = setTimeout(function () {
      overlayTimerId = null;
      overlayTitleEl.textContent = title;
      overlayTextEl.textContent = detail;
      overlayEl.classList.remove('hidden');
    }, win ? 1100 : 0);
  }

  function playWinPulse() {
    boardEl.classList.add('win');
    for (var k = 0; k < winLine.length; k++) {
      cells[winLine[k]].style.animationDelay = k * 90 + 'ms';
    }
  }

  // ---------- 战绩统计 ----------
  function loadStats() {
    try {
      var s = JSON.parse(localStorage.getItem(STATS_KEY));
      return s && s.version === 1 ? s : {
        version: 1,
        pve: { easy: {}, medium: {}, hard: {} },
        pvp: {},
      };
    } catch (e) {
      return { version: 1, pve: { easy: {}, medium: {}, hard: {} }, pvp: {} };
    }
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // 终局时记录：人机按难度累计胜/负/和，双人累计黑胜/白胜/和
  function recordResult(win) {
    var stats = loadStats();
    if (mode === 'pve') {
      var d = stats.pve[difficulty] || {};
      d.played = (d.played || 0) + 1;
      if (!win) {
        d.drawn = (d.drawn || 0) + 1;
      } else if (win.winner === playerColor) {
        d.won = (d.won || 0) + 1;
      } else {
        d.lost = (d.lost || 0) + 1;
      }
      stats.pve[difficulty] = d;
    } else {
      var p = stats.pvp;
      p.played = (p.played || 0) + 1;
      if (!win) {
        p.drawn = (p.drawn || 0) + 1;
      } else if (win.winner === 1) {
        p.blackWon = (p.blackWon || 0) + 1;
      } else {
        p.whiteWon = (p.whiteWon || 0) + 1;
      }
    }
    saveStats(stats);
  }

  function statsHtml() {
    var stats = loadStats();
    var pveRows = '';
    var pveTotal = 0;
    ['easy', 'medium', 'hard'].forEach(function (k) {
      var d = stats.pve[k] || {};
      var played = d.played || 0;
      pveTotal += played;
      pveRows += '<tr><td>' + Gomoku.DIFFICULTY[k].label + '</td><td>' + played + '</td><td>' +
        (d.won || 0) + '</td><td>' + (d.lost || 0) + '</td><td>' + (d.drawn || 0) + '</td></tr>';
    });

    var pvp = stats.pvp || {};
    var html = '';
    if (pveTotal === 0 && !(pvp.played > 0)) {
      return '<p class="stats-empty">还没有对局记录，下一局后会自动记录。</p>';
    }
    if (pveTotal > 0) {
      html += '<p class="stats-section">人机对战</p>' +
        '<table class="stats-table"><tr><th>难度</th><th>对局</th><th>胜</th><th>负</th><th>和</th></tr>' +
        pveRows + '</table>';
    }
    if (pvp.played > 0) {
      html += '<p class="stats-section">双人对战</p>' +
        '<table class="stats-table"><tr><th>对局</th><th>黑胜</th><th>白胜</th><th>和</th></tr>' +
        '<tr><td>' + pvp.played + '</td><td>' + (pvp.blackWon || 0) + '</td><td>' +
        (pvp.whiteWon || 0) + '</td><td>' + (pvp.drawn || 0) + '</td></tr></table>';
    }
    return html;
  }

  function showStats() {
    statsContentEl.innerHTML = statsHtml();
    statsOverlayEl.classList.remove('hidden');
  }

  function clearStats() {
    try { localStorage.removeItem(STATS_KEY); } catch (e) {}
    showStats(); // 清空后刷新弹层内容
  }

  // ---------- 二次确认 ----------
  // 有进行中的进度时，开新局/切模式/切难度先弹确认，防止误触丢局
  function askConfirm(text, action) {
    confirmTextEl.textContent = text;
    confirmAction = action;
    confirmOverlayEl.classList.remove('hidden');
  }

  function settleConfirm(ok) {
    var action = confirmAction;
    confirmAction = null;
    confirmOverlayEl.classList.add('hidden');
    if (ok && action) action();
  }

  function requestNewGame(m, diff) {
    if (!finished && moves.length > 0) {
      askConfirm('正在进行' + (mode === 'pve' ? '人机' : '双人') +
        '对局，开新局后进度将丢失', function () { newGame(m, diff); });
      return;
    }
    newGame(m, diff);
  }

  // ---------- 新对局 ----------
  function newGame(m, diff) {
    mode = m;
    difficulty = diff;
    savePref(); // 记住模式和难度，下次打开按偏好开局
    board = Gomoku.createBoard();
    moves = [];
    redoMoves = [];
    current = 1;
    lastMove = -1;
    finished = false;
    winLine = [];
    cursor = 7 * SIZE + 7;
    cancelAi();
    if (overlayTimerId !== null) {
      clearTimeout(overlayTimerId);
      overlayTimerId = null;
    }
    boardEl.classList.remove('win');
    for (var w = 0; w < TOTAL; w++) {
      cells[w].style.removeProperty('animation-delay');
    }
    overlayEl.classList.add('hidden');
    confirmOverlayEl.classList.add('hidden');
    syncButtons();
    startTimerFrom(0);
    render();
    updateStatus();
    saveGame();
  }

  // ---------- 模式/难度偏好 ----------
  function savePref() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        version: 1,
        mode: mode,
        difficulty: difficulty,
      }));
    } catch (e) { /* 存储不可用（如隐私模式）时静默跳过 */ }
  }

  function loadPref() {
    try {
      var s = JSON.parse(localStorage.getItem(PREF_KEY));
      if (!s) return null;
      return {
        mode: s.mode === 'pve' || s.mode === 'pvp' ? s.mode : null,
        difficulty: Gomoku.DIFFICULTY[s.difficulty] ? s.difficulty : null,
      };
    } catch (e) {
      return null;
    }
  }

  // ---------- 事件 ----------
  // 落子统一入口（点击 / 键盘回车共用）：校验通过后在光标处落子
  function playAt(i) {
    if (finished || isAiTurn()) return;
    if (board[i] !== 0) return;
    cursor = i;
    redoMoves.length = 0; // 新的一手让旧的重做分支作废
    commitMove({ i: i, player: current });
  }

  boardEl.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    playAt(Number(cell.dataset.i));
  });

  document.getElementById('newGame').addEventListener('click', function () {
    requestNewGame(mode, difficulty);
  });

  againBtn.addEventListener('click', function () {
    newGame(mode, difficulty); // 终局弹层里再来一局，无需确认
  });

  // 回顾棋局：只收起弹层，保留连线高亮，可继续悔棋复盘
  reviewBtn.addEventListener('click', function () {
    overlayEl.classList.add('hidden');
  });

  modeGroupEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.diff-btn');
    if (!btn) return;
    requestNewGame(btn.dataset.mode, difficulty);
  });

  diffGroupEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.diff-btn');
    if (!btn) return;
    requestNewGame(mode, btn.dataset.difficulty);
  });

  confirmOkBtn.addEventListener('click', function () { settleConfirm(true); });
  confirmCancelBtn.addEventListener('click', function () { settleConfirm(false); });
  confirmOverlayEl.addEventListener('click', function (e) {
    if (e.target === confirmOverlayEl) settleConfirm(false);
  });

  statsBtn.addEventListener('click', showStats);
  statsCloseBtn.addEventListener('click', function () {
    statsOverlayEl.classList.add('hidden');
  });
  statsClearBtn.addEventListener('click', function () {
    askConfirm('将清除全部对局记录，无法恢复', clearStats);
  });
  statsOverlayEl.addEventListener('click', function (e) {
    if (e.target === statsOverlayEl) statsOverlayEl.classList.add('hidden');
  });

  // 深浅色主题切换：逻辑在 shared/theme.js（主题键名统一为 gamebox-theme）
  themeBtn.addEventListener('click', function () {
    window.toggleGameboxTheme();
    window.syncThemeLabel();
  });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  hintBtn.addEventListener('click', hint);

  document.addEventListener('keydown', function (e) {
    // 战绩弹层：Esc 关闭
    if (!statsOverlayEl.classList.contains('hidden')) {
      if (e.key === 'Escape') statsOverlayEl.classList.add('hidden');
      return;
    }

    // 切局确认弹层：回车确认开新局，Esc 取消
    if (!confirmOverlayEl.classList.contains('hidden')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        settleConfirm(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        settleConfirm(false);
      }
      return;
    }

    // 胜负弹层：回车/空格再来一局，Esc 回顾棋局
    if (!overlayEl.classList.contains('hidden')) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        newGame(mode, difficulty);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        overlayEl.classList.add('hidden');
      }
      return;
    }

    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      hint();
      return;
    }

    // 方向键移动虚拟光标，回车/空格在光标处落子
    var r = (cursor / SIZE) | 0, c = cursor % SIZE;
    if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); cursor -= SIZE; render(); return; }
    if (e.key === 'ArrowDown' && r < SIZE - 1) { e.preventDefault(); cursor += SIZE; render(); return; }
    if (e.key === 'ArrowLeft' && c > 0) { e.preventDefault(); cursor -= 1; render(); return; }
    if (e.key === 'ArrowRight' && c < SIZE - 1) { e.preventDefault(); cursor += 1; render(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      playAt(cursor);
    }
  });

  // 关闭/刷新页面前把进度存下来
  window.addEventListener('beforeunload', saveGame);

  // ---------- 启动 ----------
  window.syncThemeLabel();

  // 按上次偏好恢复模式和难度
  var pref = loadPref();
  if (pref) {
    if (pref.mode) mode = pref.mode;
    if (pref.difficulty) difficulty = pref.difficulty;
  }

  // 有存档就接着上次的下，否则按偏好开一局新的
  if (loadSavedGame()) {
    finished = false;
    overlayEl.classList.add('hidden');
    syncButtons();
    startTimerFrom(seconds);
    render();
    updateStatus();
    scheduleAiIfNeeded(); // 恢复时若正好轮到 AI，让它继续思考
  } else {
    newGame(mode, difficulty);
  }
})();
