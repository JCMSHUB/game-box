/** 交互回归检查：node gomoku/app.test.js（只使用 Node 内置模块）。 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const html = read('index.html');
const core = read('gomoku.js');
const app = read('app.js');
const SAVE = 'gomoku-save-v1';
const STATS = 'gomoku-stats-v1';

// 仅模拟交互脚本使用的 DOM 接口；游戏算法、状态和事件处理均运行原文件。
class Element {
  constructor() {
    this.dataset = {};
    this.children = [];
    this.events = {};
    this.disabled = false;
    this.style = { removeProperty() {} };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, on = !classes.has(name)) {
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    };
  }
  addEventListener(name, fn) { this.events[name] = fn; }
  appendChild(child) { this.children.push(child); }
  querySelectorAll() { return []; } // 本组检查不操作模式/难度按钮组
  closest() { return this; }
  click() { if (!this.disabled) this.events.click({ target: this }); }
}

function session(mode = 'pvp', storage = new Map()) {
  const nodes = new Map();
  for (const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element();
    const classes = match[0].match(/\bclass="([^"]*)"/);
    if (classes) node.classList.add(...classes[1].split(/\s+/));
    nodes.set(match[1], node);
  }
  const get = id => {
    assert.ok(nodes.has(id), '页面缺少元素：' + id);
    return nodes.get(id);
  };
  const document = new Element();
  document.getElementById = get;
  document.createElement = () => new Element();
  const window = new Element();
  window.syncThemeLabel = () => {};
  if (!storage.has('gomoku-pref-v1')) {
    storage.set('gomoku-pref-v1', JSON.stringify({ version: 1, mode, difficulty: 'easy' }));
  }
  let now = 0, nextId = 0;
  const timers = new Map();
  function schedule(fn, ms, repeat = false) {
    const id = ++nextId;
    timers.set(id, { fn, due: now + ms, ms, repeat });
    return id;
  }
  const context = vm.createContext({
    window, document,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setTimeout: schedule,
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true),
    clearInterval: id => timers.delete(id),
  });
  vm.runInContext(core, context, { filename: 'gomoku.js' });
  context.Gomoku = window.Gomoku;
  vm.runInContext(app, context, { filename: 'app.js' });

  return {
    get, storage,
    click: id => get(id).click(),
    play: i => get('board').events.click({ target: get('board').children[i] }),
    key: key => document.events.keydown({ key, preventDefault() {} }),
    saved: () => JSON.parse(storage.get(SAVE)),
    stats: () => JSON.parse(storage.get(STATS)),
    reload() {
      window.events.beforeunload();
      return session(mode, storage);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.repeat) timer.due += timer.ms; else timers.delete(id);
        timer.fn();
      }
      now = end;
    },
  };
}

// 黑白各有一条四连，轮到黑方；双方都还没有获胜。
const opening = [105, 120, 106, 121, 107, 122, 108, 123];
function nearWin(mode) {
  const storage = new Map([[SAVE, JSON.stringify({
    version: 1, mode, difficulty: 'easy', playerColor: 1, seconds: 20,
    moves: opening.map((i, k) => ({ i, player: k % 2 + 1 })),
    // 有意不带 resultRecorded，验证旧版存档兼容性。
  })]]);
  return session(mode, storage);
}

function review(game) {
  game.advance(1100);
  assert.equal(game.get('overlay').classList.contains('hidden'), false);
  game.click('review');
}

test('提示在玩家/AI 回合切换时更新，点击和快捷键遵守同一规则', () => {
  const game = session('pve');
  assert.equal(game.get('hintBtn').disabled, false);
  game.play(112);
  assert.equal(game.get('hintBtn').disabled, true, '等待 AI 时禁用提示');
  game.key('h');
  assert.equal(game.get('board').children.some(c => c.classList.contains('hinted')), false);
  game.advance(300);
  assert.match(game.get('status').innerHTML, /轮到你落子/);
  assert.equal(game.get('hintBtn').disabled, false, 'AI 回应后恢复提示');
  const moves = game.saved().moves;
  game.click('hintBtn');
  assert.equal(game.get('board').children.filter(c => c.classList.contains('hinted')).length, 1);
  assert.deepEqual(game.saved().moves, moves, '提示只高亮，不落子');
  game.click('undoBtn');
  assert.equal(game.get('hintBtn').disabled, false);
  game.click('redoBtn');
  assert.equal(game.get('hintBtn').disabled, false);
  assert.deepEqual(game.saved().moves, moves, '重做恢复原先的人机两手');
});

test('存档恢复和 AI 思考期间悔棋/重做保持提示状态正确', () => {
  let game = session('pve');
  game.play(112);
  game = game.reload();
  assert.equal(game.get('hintBtn').disabled, true);
  game.click('undoBtn');
  assert.equal(game.get('hintBtn').disabled, false);
  game.click('redoBtn');
  assert.equal(game.get('hintBtn').disabled, true);
  game.advance(300);
  assert.equal(game.get('hintBtn').disabled, false);
  game = game.reload();
  assert.equal(game.get('hintBtn').disabled, false);
});

for (const mode of ['pvp', 'pve']) {
  test(mode + '：旧存档可结束，反复悔棋重做只记首次结果，新游戏重新计数', () => {
    const game = nearWin(mode);
    assert.equal(game.get('hintBtn').disabled, false);
    assert.equal(game.get('board').children.filter(c => c.classList.contains('black')).length, 4);
    game.play(109);
    assert.equal(game.get('hintBtn').disabled, true);
    const first = game.stats();
    assert.equal(mode === 'pvp' ? first.pvp.blackWon : first.pve.easy.won, 1);
    for (let n = 0; n < 3; n++) {
      review(game);
      game.click('undoBtn');
      assert.equal(game.get('hintBtn').disabled, false);
      game.click('redoBtn');
      assert.equal(game.get('hintBtn').disabled, true);
      assert.deepEqual(game.stats(), first, '回放同一个胜局不增加战绩');
    }
    game.advance(1100);
    game.click('again');
    assert.equal(game.saved().resultRecorded, false);
    assert.equal(game.get('hintBtn').disabled, false);
    // 双人局按点击下完；人机局用现有算法的推荐手与简单 AI 对弈。
    if (mode === 'pvp') {
      [...opening, 109].forEach(game.play);
    } else {
      const Gomoku = require('./gomoku.js');
      for (let n = 0; n < 113 && game.storage.has(SAVE); n++) {
        const board = Gomoku.createBoard();
        for (const m of game.saved().moves) board[m.i] = m.player;
        game.play(Gomoku.findBestMove(board, 1, 'medium', () => 0.5));
        game.advance(300);
      }
    }
    assert.equal(game.storage.has(SAVE), false, '新局正常结束');
    const stats = game.stats();
    assert.equal(mode === 'pvp' ? stats.pvp.played : stats.pve.easy.played, 2);
  });

  test(mode + '：悔棋后刷新并改变胜方，仍保留首次结果', () => {
    let game = nearWin(mode);
    game.play(109);
    const first = game.stats();
    review(game);
    game.click('undoBtn');
    assert.equal(game.saved().resultRecorded, true);
    game = game.reload();
    assert.equal(game.get('hintBtn').disabled, false);
    game.play(0); // 黑方让开成五点，白方下一手获胜。
    if (mode === 'pve') game.advance(300); else game.play(124);
    game.advance(1100);
    assert.match(game.get('overlayTitle').textContent, mode === 'pve' ? /AI 获胜/ : /白方获胜/);
    assert.deepEqual(game.stats(), first);
  });

  test(mode + '：清空战绩后复盘不会补回旧结果', () => {
    const game = nearWin(mode);
    game.play(109);
    review(game);
    game.click('statsBtn');
    game.click('statsClear');
    game.click('confirmOk');
    game.click('statsClose');
    assert.equal(game.storage.has(STATS), false);
    game.click('undoBtn');
    game.click('redoBtn');
    assert.equal(game.storage.has(STATS), false);
  });
}

test('双人局双方回合都能使用提示', () => {
  const game = session('pvp');
  for (const i of [112, 127]) {
    game.play(i);
    assert.equal(game.get('hintBtn').disabled, false);
    game.click('hintBtn');
    assert.equal(game.get('board').children.some(c => c.classList.contains('hinted')), true);
    game.advance(1000);
  }
});
