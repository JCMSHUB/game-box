/**
 * 核心算法自测脚本：node test.js
 * 批量出题并验证：题解合法、解唯一、提示数与难度区间一致、提示与题解不矛盾。
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
console.log(`OK：${checked} 局全部通过（唯一解 / 题解合法 / 难度区间正确）`);
