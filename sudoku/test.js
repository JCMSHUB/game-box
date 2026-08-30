/**
 * 核心算法自测脚本：node test.js
 * 批量出题并验证：题解合法、解唯一、提示数与难度区间一致、提示与题解不矛盾、
 * completedUnits 的完成判定。
 * 改动 sudoku.js 的生成逻辑后建议重新跑一遍。
 */
'use strict';

const Sudoku = require('./sudoku.js');

const ROUNDS = 100; // 每个难度出多少局
const diffs = ['easy', 'medium', 'hard'];
let checked = 0;

console.time(`生成 ${ROUNDS * diffs.length} 局`);

for (let n = 0; n < ROUNDS; n++) {
  for (const diff of diffs) {
    const { puzzle, solution, clues } = Sudoku.generatePuzzle(diff);
    const [lo, hi] = Sudoku.DIFFICULTY[diff].clues;

    if (!Sudoku.isSolved(solution)) throw new Error('题解不是合法终盘');
    if (Sudoku.countSolutions(puzzle, 2).count !== 1) throw new Error('题目解不唯一');
    if (clues !== puzzle.filter(v => v !== 0).length) throw new Error('提示数与棋面不符');
    if (clues < lo || clues > hi) {
      throw new Error(`${diff} 提示数越界: ${clues}（应在 ${lo}-${hi}）`);
    }
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] !== 0 && puzzle[i] !== solution[i]) {
        throw new Error(`提示数与题解矛盾 @${i}`);
      }
    }
    checked += 1;
  }
}

console.timeEnd(`生成 ${ROUNDS * diffs.length} 局`);

// ---------- completedUnits：行/列/宫完成判定 ----------

// 题解本身：27 个单元应全部完成
const { solution } = Sudoku.generatePuzzle('medium', Math.random);
const allDone = Sudoku.completedUnits(solution, solution);
for (let u = 0; u < 9; u++) {
  if (!allDone.rows[u] || !allDone.cols[u] || !allDone.boxes[u]) {
    throw new Error(`完整题解的单元 ${u} 应判定为完成`);
  }
}

// 挖空一格：所在行/列/宫不再完成，其余单元不受影响
const partial = solution.slice();
partial[40] = 0; // 第 4 行、第 4 列、中间宫的交点
const withBlank = Sudoku.completedUnits(partial, solution);
for (let u = 0; u < 9; u++) {
  const expect = u !== 4 && u !== 4 && u !== 4; // 行 4 / 列 4 / 宫 4
  if (withBlank.rows[u] !== expect) throw new Error(`挖空后行 ${u} 完成判定错误`);
  if (withBlank.cols[u] !== expect) throw new Error(`挖空后列 ${u} 完成判定错误`);
  if (withBlank.boxes[u] !== expect) throw new Error(`挖空后宫 ${u} 完成判定错误`);
}

// 填错一格（与题解不同的数字）：同样只牵连所在行/列/宫
const wrongBoard = solution.slice();
wrongBoard[0] = solution[0] % 9 + 1; // 换一个别的数字
const withWrong = Sudoku.completedUnits(wrongBoard, solution);
if (withWrong.rows[0] || withWrong.cols[0] || withWrong.boxes[0]) {
  throw new Error('填错的单元不应判定为完成');
}
if (!withWrong.rows[8] || !withWrong.cols[8] || !withWrong.boxes[8]) {
  throw new Error('未受影响的单元应判定为完成');
}

// 空棋盘：全部未完成
const empty = Sudoku.completedUnits(new Array(81).fill(0), solution);
for (let u = 0; u < 9; u++) {
  if (empty.rows[u] || empty.cols[u] || empty.boxes[u]) {
    throw new Error('空棋盘不应有已完成单元');
  }
}

console.log(`OK：${checked} 局全部通过（唯一解 / 题解合法 / 难度区间正确）`);
console.log('OK：completedUnits 判定通过（终盘全完成 / 挖空与填错只牵连所在单元 / 空盘全未完成）');
