/**
 * 五子棋核心算法：胜负判定 + AI 走子
 *
 * 纯逻辑、不依赖 DOM：浏览器里挂到 window.Gomoku，Node 里可以直接 require。
 *
 * 棋盘统一用长度 225 的一维数组表示（15×15），索引 i 对应第 r 行第 c 列：
 *   r = Math.floor(i / 15), c = i % 15
 * 空点用 0 表示，黑子 1，白子 2。
 * 规则采用自由规则：无禁手，先连成五子或以上者胜。
 */
(function (root) {
  'use strict';

  var SIZE = 15;
  var TOTAL = SIZE * SIZE;

  // 四个方向的行列增量：横、竖、两条斜线
  var DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  // 棋型分值表。保证相对次序：成五 > 堵对方成五 > 活四 > 冲四 > 活三 > 眠三 > 活二…
  // 同一格的多方向分值直接相加，这样双活三、冲四带活三这类组合威胁会自然冒尖。
  var SCORE = {
    FIVE: 10000000,    // 连五（已成）
    LIVE_FOUR: 1000000,  // 活四：两端都空
    RUSH_FOUR: 100000,   // 冲四：一端被堵，仍有一手成五
    LIVE_THREE: 50000,   // 活三：两端都空，下一手成活四
    SLEEP_THREE: 2000,   // 眠三
    LIVE_TWO: 3000,      // 活二
    SLEEP_TWO: 500,      // 眠二
    LIVE_ONE: 100,       // 活一
  };

  var DIFFICULTY = {
    easy: { label: '简单' },
    medium: { label: '中等' },
    hard: { label: '困难' },
  };

  function idx(r, c) { return r * SIZE + c; }

  function inBoard(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function createBoard() {
    return new Array(TOTAL).fill(0);
  }

  /**
   * 从刚落的第 i 手出发检查是否连成五子（长连也算胜）。
   * @returns {{winner: number, line: number[]}|null} line 为获胜连线上的格子索引；
   *          未分胜负返回 null。
   */
  function checkWin(board, i) {
    var player = board[i];
    if (!player) return null;
    var r0 = (i / SIZE) | 0, c0 = i % SIZE;

    for (var d = 0; d < 4; d++) {
      var dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];
      var line = [i];
      // 从落点向两侧延伸，收集同色连子
      for (var sign = -1; sign <= 1; sign += 2) {
        var r = r0 + dr * sign, c = c0 + dc * sign;
        while (inBoard(r, c) && board[idx(r, c)] === player) {
          line.push(idx(r, c));
          r += dr * sign; c += dc * sign;
        }
      }
      if (line.length >= 5) {
        line.sort(function (a, b) { return a - b; });
        return { winner: player, line: line };
      }
    }
    return null;
  }

  function isBoardFull(board) {
    for (var i = 0; i < TOTAL; i++) {
      if (board[i] === 0) return false;
    }
    return true;
  }

  // ---------- AI ----------

  /**
   * 候选剪枝：只考虑与已有棋子切比雪夫距离 ≤ 2 的空点。
   * 空盘时返回天元。
   */
  function candidates(board) {
    var near = new Array(TOTAL).fill(false);
    var list = [];
    var hasStone = false;

    for (var i = 0; i < TOTAL; i++) {
      if (board[i] === 0) continue;
      hasStone = true;
      var r0 = (i / SIZE) | 0, c0 = i % SIZE;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var r = r0 + dr, c = c0 + dc;
          if (!inBoard(r, c)) continue;
          var j = idx(r, c);
          if (board[j] === 0 && !near[j]) {
            near[j] = true;
            list.push(j);
          }
        }
      }
    }
    if (!hasStone) return [idx(7, 7)];
    return list;
  }

  /**
   * 假设 player 在 i 点落子，统计该方向上形成的棋型分值。
   * 以 i 为中心向两侧数连续同色子，open 为两端空头的个数（出界或对方子视为被堵）。
   * 间隔棋型（如 ●●_●）在评估空点本身时自然被算作高威胁，无需特判。
   */
  function dirShape(board, i, player, dr, dc) {
    var r0 = (i / SIZE) | 0, c0 = i % SIZE;
    var count = 1;
    var open = 0;

    for (var sign = -1; sign <= 1; sign += 2) {
      var r = r0 + dr * sign, c = c0 + dc * sign;
      while (inBoard(r, c) && board[idx(r, c)] === player) {
        count += 1;
        r += dr * sign; c += dc * sign;
      }
      if (inBoard(r, c) && board[idx(r, c)] === 0) open += 1;
    }

    if (count >= 5) return SCORE.FIVE;
    if (count === 4) return open === 2 ? SCORE.LIVE_FOUR : (open === 1 ? SCORE.RUSH_FOUR : 0);
    if (count === 3) return open === 2 ? SCORE.LIVE_THREE : (open === 1 ? SCORE.SLEEP_THREE : 0);
    if (count === 2) return open === 2 ? SCORE.LIVE_TWO : (open === 1 ? SCORE.SLEEP_TWO : 0);
    if (count === 1) return open === 2 ? SCORE.LIVE_ONE : 0;
    return 0; // 两端全被堵死的子没有发展
  }

  /** 假设 player 在 i 落子后的四方向棋型总分（进攻视角）。 */
  function moveScore(board, i, player) {
    var total = 0;
    for (var d = 0; d < 4; d++) {
      total += dirShape(board, i, player, DIRECTIONS[d][0], DIRECTIONS[d][1]);
    }
    return total;
  }

  /** 综合评估在 i 落子的价值：己方进攻分 + 对方在此落子的威胁分 × 防守权重。 */
  function evalMove(board, i, player) {
    return moveScore(board, i, player) + DEFENSE * moveScore(board, i, 3 - player);
  }

  var DEFENSE = 0.9;

  /** 收集 cands 里「落子即成五」的点。 */
  function fivePoints(board, cands, player) {
    var list = [];
    for (var k = 0; k < cands.length; k++) {
      if (moveScore(board, cands[k], player) >= SCORE.FIVE) list.push(cands[k]);
    }
    return list;
  }

  function pick(list, rng) {
    return list[Math.floor(rng() * list.length)];
  }

  /**
   * 简单难度：成五必下、对方成五必堵，其余基本随机下在棋子附近，
   * 会无视活三/冲四之类的威胁，新手也能赢。
   */
  function easyMove(board, player, cands, rng) {
    // 轻微的中心偏好让棋形看起来不那么散乱
    var best = -1, bestScore = -1;
    for (var k = 0; k < cands.length; k++) {
      var i = cands[k];
      var r = (i / SIZE) | 0, c = i % SIZE;
      var s = rng() * 100 + (14 - (Math.abs(r - 7) + Math.abs(c - 7)));
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }

  /** 中等难度：完整启发式评估（进攻 + 防守），取最高分。 */
  function mediumMove(board, player, cands, rng) {
    var best = -1, bestScore = -Infinity;
    for (var k = 0; k < cands.length; k++) {
      var s = evalMove(board, cands[k], player) + rng() * 100;
      if (s > bestScore) { bestScore = s; best = cands[k]; }
    }
    return best;
  }

  /**
   * 困难难度：在启发式前几名里做两层搜索——
   * 我下 i 之后对手必然挑它收益最大的一手，用对手的最佳收益惩罚我的选择，
   * 避免送出「我进一步、对方成大威胁」的坏棋。
   */
  function hardMove(board, player, cands, rng) {
    var ranked = cands.map(function (i) {
      return { i: i, s: evalMove(board, i, player) };
    }).sort(function (a, b) { return b.s - a.s; });

    var top = ranked.slice(0, 12);
    var opp = 3 - player;
    var best = -1, bestScore = -Infinity;

    for (var t = 0; t < top.length; t++) {
      var m = top[t];
      board[m.i] = player;

      var oppCands = candidates(board);
      var oppBest = 0;
      for (var k = 0; k < oppCands.length; k++) {
        var v = evalMove(board, oppCands[k], opp);
        if (v > oppBest) oppBest = v;
      }
      board[m.i] = 0;

      // 已能成五的选择无需再看对手
      var s = m.s >= SCORE.FIVE ? m.s + SCORE.FIVE : m.s - oppBest;
      s += rng() * 30;
      if (s > bestScore) { bestScore = s; best = m.i; }
    }
    return best;
  }

  /**
   * AI 主入口：给当前局面挑一手。
   * @param {number[]} board 长度 225
   * @param {number} player 要走子的一方（1 黑 / 2 白）
   * @param {string} difficulty 'easy' | 'medium' | 'hard'
   * @param {function} [rng] 随机源，默认 Math.random；测试时可注入固定种子
   * @returns {number} 落点索引；棋盘已满返回 -1
   */
  function findBestMove(board, player, difficulty, rng) {
    if (!rng) rng = Math.random;
    if (!DIFFICULTY[difficulty]) {
      throw new Error('未知难度: ' + difficulty);
    }

    var cands = candidates(board);
    if (cands.length === 0) return -1;

    // 所有难度共同的下限：能一步成五先下，否则堵住对方的一步成五
    var myFive = fivePoints(board, cands, player);
    if (myFive.length) return pick(myFive, rng);
    var oppFive = fivePoints(board, cands, 3 - player);
    if (oppFive.length) {
      // 多个堵点时挑一个顺带发展自己的
      var best = oppFive[0], bestScore = -1;
      for (var k = 0; k < oppFive.length; k++) {
        var s = moveScore(board, oppFive[k], player) + rng() * 100;
        if (s > bestScore) { bestScore = s; best = oppFive[k]; }
      }
      return best;
    }

    if (difficulty === 'easy') return easyMove(board, player, cands, rng);
    if (difficulty === 'medium') return mediumMove(board, player, cands, rng);
    return hardMove(board, player, cands, rng);
  }

  var Gomoku = {
    SIZE: SIZE,
    DIFFICULTY: DIFFICULTY,
    SCORE: SCORE,
    createBoard: createBoard,
    checkWin: checkWin,
    isBoardFull: isBoardFull,
    candidates: candidates,
    moveScore: moveScore,
    findBestMove: findBestMove,
  };

  root.Gomoku = Gomoku;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gomoku;
})(typeof window !== 'undefined' ? window : globalThis);
