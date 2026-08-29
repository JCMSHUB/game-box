/**
 * 核心算法自测脚本：node test.js
 * 覆盖：胜负判定（四方向/长连/四连不算胜）、AI 必胜必防下限、
 * 中等以上会挡活三、AI 互弈合法性冒烟、固定种子可复现、耗时上限。
 * 改动 gomoku.js 的判定或 AI 逻辑后建议重新跑一遍。
 */
'use strict';

const Gomoku = require('./gomoku.js');

// mulberry32：可复现的种子随机源
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function at(board, r, c) { return board[r * Gomoku.SIZE + c]; }
function set(board, r, c, v) { board[r * Gomoku.SIZE + c] = v; }
function pos(r, c) { return r * Gomoku.SIZE + c; }

const diffs = ['easy', 'medium', 'hard'];
let checked = 0;

// ---------- 胜负判定 ----------

// 横/竖/两条斜线各摆一组五连，从连线上任一点判定都应成立
const cases = [
  { cells: [[7, 4], [7, 5], [7, 6], [7, 7], [7, 8]], name: '横向五连' },
  { cells: [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7]], name: '纵向五连' },
  { cells: [[4, 4], [5, 5], [6, 6], [7, 7], [8, 8]], name: '主对角五连' },
  { cells: [[4, 10], [5, 9], [6, 8], [7, 7], [8, 6]], name: '副对角五连' },
];

for (const { cells, name } of cases) {
  for (const probe of cells) {
    const board = Gomoku.createBoard();
    for (const [r, c] of cells) set(board, r, c, 1);
    const win = Gomoku.checkWin(board, pos(probe[0], probe[1]));
    if (!win || win.winner !== 1) throw new Error(`${name} 未判胜`);
    if (win.line.length !== 5) throw new Error(`${name} 连线长度错误: ${win.line.length}`);
    checked++;
  }
}

// 六连（长连）也算胜，连线应包含全部六子
{
  const board = Gomoku.createBoard();
  for (let c = 4; c <= 9; c++) set(board, 7, c, 2);
  const win = Gomoku.checkWin(board, pos(7, 6));
  if (!win || win.winner !== 2 || win.line.length !== 6) throw new Error('长连判定错误');
  checked++;
}

// 只有四连不算胜
{
  const board = Gomoku.createBoard();
  for (let c = 4; c <= 7; c++) set(board, 7, c, 1);
  if (Gomoku.checkWin(board, pos(7, 7)) !== null) throw new Error('四连误判为胜');
  checked++;
}

// 和棋判定：满盘为满，空盘不为满
{
  const full = Gomoku.createBoard().fill(1);
  if (!Gomoku.isBoardFull(full)) throw new Error('满盘未判定为满');
  if (Gomoku.isBoardFull(Gomoku.createBoard())) throw new Error('空盘误判为满');
  checked++;
}

// ---------- AI 走子 ----------

// 空盘第一手应下天元
{
  const mv = Gomoku.findBestMove(Gomoku.createBoard(), 1, 'hard', seeded(1));
  if (mv !== pos(7, 7)) throw new Error(`空盘应下天元，实际下了 ${mv}`);
  checked++;
}

// 己方一手成五：所有难度都必须直接拿下
for (const diff of diffs) {
  const board = Gomoku.createBoard();
  for (let c = 3; c <= 6; c++) set(board, 7, c, 2); // 白棋四连
  set(board, 7, 2, 1);                              // 左端被黑棋堵住
  const mv = Gomoku.findBestMove(board, 2, diff, seeded(2));
  if (mv !== pos(7, 7)) throw new Error(`${diff} 未拿下成五点（下了 ${mv}）`);
  checked++;
}

// 对方一手成五：所有难度都必须堵
for (const diff of diffs) {
  const board = Gomoku.createBoard();
  for (let c = 3; c <= 6; c++) set(board, 7, c, 1); // 黑棋四连
  set(board, 7, 2, 2);                              // 左端被白棋堵住
  const mv = Gomoku.findBestMove(board, 2, diff, seeded(3));
  if (mv !== pos(7, 7)) throw new Error(`${diff} 未堵对方成五点（下了 ${mv}）`);
  checked++;
}

// 中等/困难要会挡活三（下在两端之一），否则活三变活四必败
for (const diff of ['medium', 'hard']) {
  const board = Gomoku.createBoard();
  for (let c = 6; c <= 8; c++) set(board, 7, c, 1); // 黑棋活三
  set(board, 3, 3, 2);                              // 白棋远处散子
  const mv = Gomoku.findBestMove(board, 2, diff, seeded(4));
  if (mv !== pos(7, 5) && mv !== pos(7, 9)) {
    throw new Error(`${diff} 未挡活三（下了 ${mv}）`);
  }
  checked++;
}

// ---------- AI 互弈冒烟 ----------

// 各种难度组合对弈：每步必须落在空点，终局判定与最后一手一致，且能在盘满前结束
console.time('AI 互弈 15 局');
const combos = [
  ['easy', 'medium'], ['medium', 'hard'], ['hard', 'easy'],
  ['easy', 'easy'], ['hard', 'hard'],
];
let hardWorst = 0;

for (let n = 0; n < 15; n++) {
  const [blackDiff, whiteDiff] = combos[n % combos.length];
  const rng = seeded(100 + n);
  const board = Gomoku.createBoard();
  let player = 1;
  let win = null;

  for (let move = 0; move < Gomoku.SIZE * Gomoku.SIZE; move++) {
    const t0 = Date.now();
    const mv = Gomoku.findBestMove(board, player, player === 1 ? blackDiff : whiteDiff, rng);
    if (player === 1 && blackDiff === 'hard' || player === 2 && whiteDiff === 'hard') {
      hardWorst = Math.max(hardWorst, Date.now() - t0);
    }
    if (mv < 0 || mv >= 225 || board[mv] !== 0) {
      throw new Error(`第 ${move} 手非法落点: ${mv}`);
    }
    board[mv] = player;
    win = Gomoku.checkWin(board, mv);
    if (win) break;
    if (Gomoku.isBoardFull(board)) break; // 和棋
    player = 3 - player;
  }

  const total = board.filter(v => v !== 0).length;
  if (win && win.winner !== player) throw new Error('胜方与最后一手不一致');
  if (!win && total < 225) throw new Error('未终局就停止走子');
  if (total > 225) throw new Error('步数越界');
  checked++;
}
console.timeEnd('AI 互弈 15 局');
if (hardWorst > 200) throw new Error(`困难档单手耗时过高: ${hardWorst}ms`);

// ---------- 可复现性 ----------

// 同一 seed 下 hard 互弈的整局走法应完全一致
function playSeededGame(seed) {
  const rng = seeded(seed);
  const board = Gomoku.createBoard();
  const moves = [];
  let player = 1;
  for (let move = 0; move < 225; move++) {
    const mv = Gomoku.findBestMove(board, player, 'hard', rng);
    if (mv < 0) break;
    moves.push(mv);
    board[mv] = player;
    if (Gomoku.checkWin(board, mv) || Gomoku.isBoardFull(board)) break;
    player = 3 - player;
  }
  return moves;
}

const g1 = playSeededGame(42);
const g2 = playSeededGame(42);
if (JSON.stringify(g1) !== JSON.stringify(g2)) throw new Error('固定种子下走法不可复现');
if (g1.length < 10) throw new Error('hard 互弈整局过短，疑似异常');
checked++;

console.log(`OK：${checked} 项全部通过（胜负判定 / AI 必胜必防 / 挡活三 / 互弈合法 / 可复现 / 困难档 ${hardWorst}ms）`);
