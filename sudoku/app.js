/**
 * 界面与交互：渲染棋盘、处理输入、铅笔笔记、撤销/重做、提示、
 * 计时、进度自动保存与胜负判定。
 * 依赖 sudoku.js 提供的 window.Sudoku。
 */
(function () {
  'use strict';

  // ---------- 游戏状态 ----------
  var solution = [];   // 完整题解
  var givens = [];     // 题面提示数（锁定不可修改）
  var board = [];      // 当前局面
  var notes = [];      // 每格铅笔笔记，9 位掩码（第 d-1 位 = 数字 d）
  var selected = -1;   // 当前选中格索引，-1 表示未选
  var difficulty = 'easy';
  var seconds = 0;
  var timerId = null;
  var finished = false;
  var notesMode = false; // 笔记模式：开启后按数字变成切换铅笔笔记
  var hintsUsed = 0;     // 本局已用提示次数
  var history = [];      // 撤销栈：存整个局面快照，简单且能覆盖多格联动变化
  var redoStack = [];    // 重做栈

  var SAVE_KEY = 'sudoku-save-v1';

  // ---------- DOM ----------
  var boardEl = document.getElementById('board');
  var timerEl = document.getElementById('timer');
  var overlayEl = document.getElementById('overlay');
  var overlayTextEl = document.getElementById('overlayText');
  var againBtn = document.getElementById('again');
  var undoBtn = document.getElementById('undoBtn');
  var redoBtn = document.getElementById('redoBtn');
  var hintBtn = document.getElementById('hintBtn');
  var notesBtn = document.getElementById('notesBtn');
  var themeBtn = document.getElementById('themeBtn');

  // 创建 81 个格子，只建一次，之后只改内容和样式类。
  // 3×3 宫的粗分隔线也在这里一次性定好。
  var cells = [];
  for (var i = 0; i < 81; i++) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.i = i;
    var r0 = (i / 9) | 0, c0 = i % 9;
    if (c0 % 3 === 2 && c0 !== 8) cell.classList.add('sep-r');
    if (r0 % 3 === 2 && r0 !== 8) cell.classList.add('sep-b');
    if (c0 === 8) cell.classList.add('last-col');
    if (r0 === 8) cell.classList.add('last-row');
    boardEl.appendChild(cell);
    cells.push(cell);
  }

  // 数字键盘 1-9 的按钮引用，用于「数字用完置灰」
  var numBtns = {};
  var padBtns = document.querySelectorAll('#numpad button[data-num]');
  for (var p = 0; p < padBtns.length; p++) {
    var padNum = Number(padBtns[p].dataset.num);
    if (padNum > 0) numBtns[padNum] = padBtns[p];
  }

  function bit(d) { return 1 << (d - 1); }

  function boxOf(i) {
    return (((i / 9) | 0) / 3 | 0) * 3 + (((i % 9) / 3) | 0);
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

  // ---------- 撤销 / 重做 ----------
  function snapshot() {
    return { board: board.slice(), notes: notes.slice() };
  }

  // 所有会改动棋面/笔记的操作都走这里：先存快照，再执行，再统一渲染和存档
  function mutate(fn) {
    if (finished) return;
    history.push(snapshot());
    if (history.length > 500) history.shift();
    redoStack.length = 0; // 有了新操作，旧的重做分支作废
    fn();
    render();
    saveGame();
    checkWin();
  }

  function undo() {
    if (finished || history.length === 0) return;
    redoStack.push(snapshot());
    var s = history.pop();
    board = s.board;
    notes = s.notes;
    render();
    saveGame();
  }

  function redo() {
    if (finished || redoStack.length === 0) return;
    history.push(snapshot());
    var s = redoStack.pop();
    board = s.board;
    notes = s.notes;
    render();
    saveGame();
  }

  // ---------- 进度自动保存 ----------
  function saveGame() {
    if (finished) return; // 通关后不再写存档（通关时已清档，避免刷新又存回完成态）
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: 1,
        difficulty: difficulty,
        solution: solution,
        givens: givens,
        board: board,
        notes: notes,
        seconds: seconds,
        hintsUsed: hintsUsed,
      }));
    } catch (e) { /* 存储不可用（如隐私模式）时静默跳过 */ }
  }

  function loadSavedGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !Sudoku.DIFFICULTY[s.difficulty]) return false;
      if (!Array.isArray(s.solution) || !Array.isArray(s.givens) ||
          !Array.isArray(s.board) || !Array.isArray(s.notes)) return false;
      if (s.solution.length !== 81 || s.givens.length !== 81 ||
          s.board.length !== 81 || s.notes.length !== 81) return false;
      difficulty = s.difficulty;
      solution = s.solution;
      givens = s.givens;
      board = s.board;
      notes = s.notes;
      seconds = Number(s.seconds) || 0;
      hintsUsed = Number(s.hintsUsed) || 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  // ---------- 渲染 ----------
  function notesHtml(mask) {
    var html = '<div class="notes">';
    for (var d = 1; d <= 9; d++) {
      html += '<span>' + ((mask & bit(d)) ? d : '') + '</span>';
    }
    return html + '</div>';
  }

  function render() {
    var selRow = selected >= 0 ? (selected / 9) | 0 : -1;
    var selCol = selected >= 0 ? selected % 9 : -1;
    var selBox = selected >= 0 ? boxOf(selected) : -1;
    var selValue = selected >= 0 ? board[selected] : 0;

    for (var i = 0; i < 81; i++) {
      var cell = cells[i];
      var v = board[i];

      if (v !== 0) {
        cell.textContent = String(v);
      } else if (notes[i] !== 0) {
        cell.innerHTML = notesHtml(notes[i]);
      } else {
        cell.textContent = '';
      }

      cell.classList.toggle('given', givens[i] !== 0);
      cell.classList.toggle('user', givens[i] === 0 && v !== 0);
      // 与题解不符 → 红色（这必然也和同行/列/宫里的某个数冲突）
      cell.classList.toggle('wrong', givens[i] === 0 && v !== 0 && v !== solution[i]);

      cell.classList.toggle('selected', i === selected);
      cell.classList.toggle('peer',
        selected >= 0 && i !== selected &&
        ((i / 9 | 0) === selRow || i % 9 === selCol || boxOf(i) === selBox));
      cell.classList.toggle('same',
        selValue !== 0 && v === selValue && i !== selected);
    }

    // 数字在棋盘上集齐 9 个（且都填对）→ 键盘按钮置灰不可选
    for (var d = 1; d <= 9; d++) {
      numBtns[d].classList.toggle('done', isDigitDone(d));
    }

    // 撤销/重做按钮的可用状态
    undoBtn.disabled = history.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  // ---------- 操作 ----------
  // 某个数字是否已用完：棋盘上出现 9 次且都和题解一致。
  // 有填错的格子时不计数，此时键盘按钮保持可用。
  function isDigitDone(d) {
    var used = 0;
    for (var i = 0; i < 81; i++) {
      if (board[i] === d && board[i] === solution[i]) used++;
    }
    return used === 9;
  }

  // 填入正式数字：清掉本格笔记；填对了顺手清掉同行/列/宫里该数字的笔记
  function placeDigit(i, d) {
    mutate(function () {
      board[i] = d;
      notes[i] = 0;
      if (d === solution[i]) clearPeerNotes(i, d);
    });
  }

  function eraseCell(i) {
    if (board[i] === 0 && notes[i] === 0) return; // 没东西可擦，不产生历史记录
    mutate(function () {
      board[i] = 0;
      notes[i] = 0;
    });
  }

  // 提示：优先填当前选中的错误/空格，否则随机挑一格，填入正确答案
  function hint() {
    if (finished) return;
    var candidates = [];
    for (var i = 0; i < 81; i++) {
      if (givens[i] === 0 && board[i] !== solution[i]) candidates.push(i);
    }
    if (candidates.length === 0) return;
    var pick = selected >= 0 && candidates.indexOf(selected) !== -1
      ? selected
      : candidates[Math.floor(Math.random() * candidates.length)];
    var d = solution[pick];
    mutate(function () {
      board[pick] = d;
      notes[pick] = 0;
      clearPeerNotes(pick, d);
      hintsUsed += 1;
    });
    cells[pick].classList.add('hinted');
    setTimeout(function () { cells[pick].classList.remove('hinted'); }, 1000);
  }

  // 清掉 i 的同行/列/宫里数字 d 的铅笔笔记
  function clearPeerNotes(i, d) {
    var r = (i / 9) | 0, c = i % 9, b = boxOf(i);
    var mask = ~bit(d);
    for (var j = 0; j < 81; j++) {
      if (j === i) continue;
      if (((j / 9) | 0) === r || j % 9 === c || boxOf(j) === b) {
        notes[j] &= mask;
      }
    }
  }

  function checkWin() {
    for (var i = 0; i < 81; i++) {
      if (board[i] === 0 || board[i] !== solution[i]) return;
    }
    finished = true;
    stopTimer();
    clearSave(); // 通关后清掉存档，下次打开是新的一局
    playWinWave();
  }

  // 通关动画：按扫雷数字配色给每格设置闪烁色（--flash），
  // 延迟按 行+列 递增，形成从左上到右下的波浪；波浪结束后弹出通关框。
  var WIN_FLASH = ['#60a5fa', '#4ade80', '#f87171', '#818cf8', '#fbbf24',
    '#2dd4bf', '#e879f9', '#94a3b8', '#fb7185'];
  var waveTimerId = null;

  function playWinWave() {
    boardEl.classList.add('win');
    for (var i = 0; i < 81; i++) {
      var d = board[i] || solution[i];
      cells[i].style.setProperty('--flash', WIN_FLASH[d - 1]);
      cells[i].style.animationDelay = (((i / 9) | 0) + (i % 9)) * 40 + 'ms';
    }
    waveTimerId = setTimeout(function () {
      waveTimerId = null;
      boardEl.classList.remove('win');
      overlayTextEl.textContent = '用时 ' + formatTime(seconds) + '，难度「' +
        Sudoku.DIFFICULTY[difficulty].label + '」' +
        (hintsUsed > 0 ? '，用了 ' + hintsUsed + ' 次提示' : '');
      overlayEl.classList.remove('hidden');
    }, 1200);
  }

  function syncDifficultyButtons() {
    var btns = document.querySelectorAll('.diff-btn');
    for (var k = 0; k < btns.length; k++) {
      btns[k].classList.toggle('active', btns[k].dataset.difficulty === difficulty);
    }
  }

  function newGame(diff) {
    difficulty = diff;
    var game = Sudoku.generatePuzzle(diff);
    solution = game.solution;
    givens = game.puzzle;
    board = game.puzzle.slice();
    notes = new Array(81).fill(0);
    selected = -1;
    finished = false;
    hintsUsed = 0;
    history.length = 0;
    redoStack.length = 0;
    // 清理可能还在播放的通关波浪
    if (waveTimerId !== null) {
      clearTimeout(waveTimerId);
      waveTimerId = null;
    }
    boardEl.classList.remove('win');
    for (var w = 0; w < 81; w++) {
      cells[w].style.removeProperty('--flash');
      cells[w].style.removeProperty('animation-delay');
    }
    overlayEl.classList.add('hidden');
    syncDifficultyButtons();
    startTimerFrom(0);
    render();
    saveGame();
  }

  function toggleNotes() {
    notesMode = !notesMode;
    notesBtn.classList.toggle('active', notesMode);
  }

  // 数字键统一入口：n = 1-9 填数/记笔记，0 擦除
  function press(n) {
    if (selected < 0) return;
    if (givens[selected] !== 0) return; // 给定格锁定

    if (n === 0) {
      eraseCell(selected);
      return;
    }

    if (notesMode) {
      if (board[selected] !== 0) return; // 已填数字的格子不记笔记
      mutate(function () { notes[selected] ^= bit(n); });
      return;
    }

    if (isDigitDone(n)) return; // 该数字已用满，填了必错，直接忽略
    if (board[selected] === n) {
      eraseCell(selected); // 再按一次相同数字 = 擦除
    } else {
      placeDigit(selected, n);
    }
  }

  // ---------- 事件 ----------
  boardEl.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    selected = Number(cell.dataset.i);
    render();
  });

  document.getElementById('numpad').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-num]');
    if (!btn) return;
    press(Number(btn.dataset.num));
  });

  document.getElementById('newGame').addEventListener('click', function () {
    newGame(difficulty);
  });

  againBtn.addEventListener('click', function () {
    newGame(difficulty);
  });

  // 深浅色主题切换：逻辑在 shared/theme.js（主题键名统一为 gamebox-theme）
  themeBtn.addEventListener('click', function () {
    window.toggleGameboxTheme();
    window.syncThemeLabel();
  });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  hintBtn.addEventListener('click', hint);
  notesBtn.addEventListener('click', toggleNotes);

  var diffBtns = document.querySelectorAll('.diff-btn');
  for (var d = 0; d < diffBtns.length; d++) {
    diffBtns[d].addEventListener('click', function (e) {
      newGame(e.currentTarget.dataset.difficulty);
    });
  }

  document.addEventListener('keydown', function (e) {
    // 通关弹层打开时，回车/空格直接再来一局
    if (!overlayEl.classList.contains('hidden')) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        newGame(difficulty);
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
    if (e.key === 'n' || e.key === 'N') { toggleNotes(); return; }
    if (e.key === 'h' || e.key === 'H') { hint(); return; }

    if (e.key >= '1' && e.key <= '9') {
      press(Number(e.key));
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      press(0);
      return;
    }

    var moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) {
      e.preventDefault();
      if (selected < 0) {
        selected = 0;
        render();
        return;
      }
      if (e.key === 'ArrowLeft' && selected % 9 === 0) return;
      if (e.key === 'ArrowRight' && selected % 9 === 8) return;
      var next = selected + moves[e.key];
      if (next < 0 || next > 80) return;
      selected = next;
      render();
    }
  });

  // 关闭/刷新页面前把进度存下来
  window.addEventListener('beforeunload', saveGame);

  // ---------- 启动 ----------
  window.syncThemeLabel();

  // 有存档就接着上次的玩，否则开一局新的
  if (loadSavedGame()) {
    finished = false;
    overlayEl.classList.add('hidden');
    syncDifficultyButtons();
    startTimerFrom(seconds);
    render();
  } else {
    newGame(difficulty);
  }
})();
