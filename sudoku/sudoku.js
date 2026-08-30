/**
 * 数独核心算法：求解器 + 出题器
 *
 * 纯逻辑、不依赖 DOM：浏览器里挂到 window.Sudoku，Node 里可以直接 require。
 *
 * 棋盘统一用长度 81 的一维数组表示，索引 i 对应第 r 行第 c 列：
 *   r = Math.floor(i / 9), c = i % 9
 *   所在宫编号 b = Math.floor(r / 3) * 3 + Math.floor(c / 3)
 * 空格用 0 表示，已填格用 1-9。
 */
(function (root) {
  'use strict';

  var ALL = 0x1ff; // 二进制 9 个 1：表示数字 1-9 全部可用

  // BIT[d] = 数字 d 的位掩码；DIGIT 做反查（掩码 -> 数字）
  var BIT = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256];
  var DIGIT = { 1: 1, 2: 2, 4: 3, 8: 4, 16: 5, 32: 6, 64: 7, 128: 8, 256: 9 };

  function popcount(x) {
    var n = 0;
    while (x) { x &= x - 1; n += 1; }
    return n;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function boxOf(i) {
    var r = (i / 9) | 0, c = i % 9;
    return ((r / 3) | 0) * 3 + ((c / 3) | 0);
  }

  /**
   * 统计棋盘解的个数，数到 limit 个就提前返回，顺便给出找到的第一个解。
   * 求解时每次都挑「候选数最少」的空格先填（MRV 启发式），
   * 这样挖洞过程中做唯一性校验非常快。
   * @param {number[]} board 长度 81，0 表示空格
   * @param {number} limit 最多统计多少个解
   * @returns {{count: number, solution: number[]|null}}
   */
  function countSolutions(board, limit) {
    var grid = board.slice();
    var rows = new Array(9).fill(0);
    var cols = new Array(9).fill(0);
    var boxes = new Array(9).fill(0);
    var empties = [];

    for (var i = 0; i < 81; i++) {
      var v = grid[i];
      if (v === 0) { empties.push(i); continue; }
      var bit = BIT[v];
      var r0 = (i / 9) | 0, c0 = i % 9, b0 = boxOf(i);
      if ((rows[r0] | cols[c0] | boxes[b0]) & bit) {
        return { count: 0, solution: null }; // 题面自身就有冲突
      }
      rows[r0] |= bit; cols[c0] |= bit; boxes[b0] |= bit;
    }

    var count = 0;
    var first = null;

    function dfs(k) {
      if (count >= limit) return;
      if (k === empties.length) {
        count += 1;
        if (first === null) first = grid.slice();
        return;
      }
      // 在剩余空格里挑候选数最少的
      var best = k, bestMask = 0, bestN = 10;
      for (var m = k; m < empties.length; m++) {
        var j = empties[m];
        var mask = ALL & ~(rows[(j / 9) | 0] | cols[j % 9] | boxes[boxOf(j)]);
        var n = popcount(mask);
        if (n < bestN) {
          bestN = n; best = m; bestMask = mask;
          if (n <= 1) break; // 已是最少，不必再找
        }
      }
      if (bestN === 0) return; // 有空格无数可填，此路不通

      // 把挑中的空格换到位置 k，回溯结束后再换回来
      var t = empties[k]; empties[k] = empties[best]; empties[best] = t;
      var idx = empties[k];
      var r = (idx / 9) | 0, c = idx % 9, b = boxOf(idx);

      var mask2 = bestMask;
      while (mask2 && count < limit) {
        var bit2 = mask2 & -mask2;
        mask2 ^= bit2;
        rows[r] |= bit2; cols[c] |= bit2; boxes[b] |= bit2;
        grid[idx] = DIGIT[bit2];
        dfs(k + 1);
        rows[r] ^= bit2; cols[c] ^= bit2; boxes[b] ^= bit2;
        grid[idx] = 0;
      }

      var t2 = empties[k]; empties[k] = empties[best]; empties[best] = t2;
    }

    dfs(0);
    return { count: count, solution: first };
  }

  /** 随机生成一个完整合法终盘：按格回溯，候选数字随机打乱。 */
  function generateSolution(rng) {
    var grid = new Array(81).fill(0);
    var rows = new Array(9).fill(0);
    var cols = new Array(9).fill(0);
    var boxes = new Array(9).fill(0);
    var digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    function dfs(i) {
      if (i === 81) return true;
      var r = (i / 9) | 0, c = i % 9, b = boxOf(i);
      shuffle(digits, rng);
      for (var k = 0; k < 9; k++) {
        var bit = BIT[digits[k]];
        if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
        grid[i] = digits[k];
        if (dfs(i + 1)) return true;
        rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
        grid[i] = 0;
      }
      return false;
    }

    dfs(0);
    return grid;
  }

  /**
   * 难度预设：clues = [最少提示数, 最多提示数]。提示数越少越难。
   * 注意提示数只是难度的粗略近似（同一提示数下题目难度也有波动）。
   */
  var DIFFICULTY = {
    easy:   { label: '简单', clues: [40, 45] },
    medium: { label: '中等', clues: [32, 36] },
    hard:   { label: '困难', clues: [26, 30] },
  };

  /**
   * 生成一局数独：
   * 1. 随机生成完整终盘；
   * 2. 按随机顺序逐格挖洞，每挖一格都用解数计数确认解仍然唯一，否则填回；
   * 3. 一路挖到难度下限的提示数为止。
   * 极少数情况下挖不到目标提示数，则整体重试，最多 20 次。
   * @param {string} difficulty 'easy' | 'medium' | 'hard'
   * @param {function} [rng] 随机源，默认 Math.random；测试时可注入固定种子
   * @returns {{puzzle: number[], solution: number[], clues: number}}
   */
  function generatePuzzle(difficulty, rng) {
    if (!rng) rng = Math.random;
    if (!DIFFICULTY[difficulty]) {
      throw new Error('未知难度: ' + difficulty);
    }
    var minClues = DIFFICULTY[difficulty].clues[0];
    var maxClues = DIFFICULTY[difficulty].clues[1];
    var best = null;

    for (var attempt = 0; attempt < 20; attempt++) {
      var solution = generateSolution(rng);
      var puzzle = solution.slice();
      var order = shuffle(Array.from({ length: 81 }, function (_, i) { return i; }), rng);
      var clues = 81;

      for (var k = 0; k < 81 && clues > minClues; k++) {
        var i = order[k];
        var backup = puzzle[i];
        puzzle[i] = 0;
        if (countSolutions(puzzle, 2).count === 1) {
          clues -= 1;
        } else {
          puzzle[i] = backup; // 挖掉后解不唯一，填回去
        }
      }

      if (!best || clues < best.clues) best = { puzzle: puzzle, solution: solution, clues: clues };
      if (clues <= maxClues) return best;
    }
    return best; // 兜底：实际几乎不会走到
  }

  /**
   * 检查各行/列/宫是否已经「完成」：9 格全部填入且与题解一致。
   * 有空格或填错的单元都算未完成（填错时该单元本来也凑不齐正确的 1-9）。
   * 返回 { rows, cols, boxes }，各为长度 9 的布尔数组，true 表示该单元已完成。
   */
  function completedUnits(board, solution) {
    var rows = new Array(9).fill(true);
    var cols = new Array(9).fill(true);
    var boxes = new Array(9).fill(true);
    for (var i = 0; i < 81; i++) {
      if (board[i] !== 0 && board[i] === solution[i]) continue;
      rows[(i / 9) | 0] = false;
      cols[i % 9] = false;
      boxes[boxOf(i)] = false;
    }
    return { rows: rows, cols: cols, boxes: boxes };
  }

  /** 检查一个填满的棋盘是否是合法终盘（每行/列/宫恰好是 1-9）。 */
  function isSolved(board) {
    for (var unit = 0; unit < 9; unit++) {
      var rowMask = 0, colMask = 0, boxMask = 0;
      for (var k = 0; k < 9; k++) {
        rowMask |= BIT[board[unit * 9 + k]];
        colMask |= BIT[board[k * 9 + unit]];
        var r = ((unit / 3) | 0) * 3 + ((k / 3) | 0);
        var c = (unit % 3) * 3 + (k % 3);
        boxMask |= BIT[board[r * 9 + c]];
      }
      if (rowMask !== ALL || colMask !== ALL || boxMask !== ALL) return false;
    }
    return true;
  }

  var Sudoku = {
    DIFFICULTY: DIFFICULTY,
    countSolutions: countSolutions,
    generateSolution: generateSolution,
    generatePuzzle: generatePuzzle,
    isSolved: isSolved,
    completedUnits: completedUnits,
  };

  root.Sudoku = Sudoku;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sudoku;
})(typeof window !== 'undefined' ? window : globalThis);
