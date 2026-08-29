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
    FIVE: 10000000,      // 连五（已成）
    LIVE_FOUR: 1000000,  // 活四：两端都空
    RUSH_FOUR: 100000,   // 冲四：一端被堵，仍有一手成五
    LIVE_THREE: 50000,   // 活三：下一手能成活四
    SLEEP_THREE: 2000,   // 眠三：下一手只能成冲四
    LIVE_TWO: 800,       // 活二
    SLEEP_TWO: 100,      // 眠二
    LIVE_ONE: 30,        // 活一
  };

  // 防守权重：对方在同一个点落子的威胁分按此折扣计入我方评估，
  // 使得「自己成活四」优先于「堵对方活四」，但堵成五仍优先于自己活四。
  var DEFENSE = 0.9;

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

  // ---------- 打分：窗口扫描 ----------

  /**
   * 棋型模式表，按分值从高到低排列，命中即返回该分值（首个匹配生效，
   * 所以高分棋型优先；'011110' 里虽然也含 '11110'，但活四先查）。
   * 含跳棋型：跳四 11011 等、跳活三 010110/011010 等。
   */
  var PATTERNS = [
    ['11111', SCORE.FIVE],
    ['011110', SCORE.LIVE_FOUR],
    ['01111', SCORE.RUSH_FOUR], ['11110', SCORE.RUSH_FOUR],
    ['11011', SCORE.RUSH_FOUR], ['10111', SCORE.RUSH_FOUR], ['11101', SCORE.RUSH_FOUR],
    ['011100', SCORE.LIVE_THREE], ['001110', SCORE.LIVE_THREE],
    ['010110', SCORE.LIVE_THREE], ['011010', SCORE.LIVE_THREE],
    ['211100', SCORE.SLEEP_THREE], ['001112', SCORE.SLEEP_THREE],
    ['211010', SCORE.SLEEP_THREE], ['010112', SCORE.SLEEP_THREE],
    ['210110', SCORE.SLEEP_THREE], ['011012', SCORE.SLEEP_THREE],
    ['10011', SCORE.SLEEP_THREE], ['11001', SCORE.SLEEP_THREE], ['10101', SCORE.SLEEP_THREE],
    ['001100', SCORE.LIVE_TWO], ['010100', SCORE.LIVE_TWO],
    ['001010', SCORE.LIVE_TWO], ['011000', SCORE.LIVE_TWO], ['000110', SCORE.LIVE_TWO],
    ['211000', SCORE.SLEEP_TWO], ['000112', SCORE.SLEEP_TWO],
    ['210100', SCORE.SLEEP_TWO], ['001012', SCORE.SLEEP_TWO],
    ['10001', SCORE.SLEEP_TWO],
    ['010', SCORE.LIVE_ONE],
  ];

  /**
   * 假设 player 在 i 点落子，取该方向上以 i 为中心的前后各 4 格窗口，
   * 映射成 9 字符串（'1'=己方 '2'=对方 '0'=空 '#'=出界，中心视为己方），
   * 按模式表取最高匹配棋型的分值。
   * 经过该点的所有棋型（连五跨度 5、活四跨度 6、跳活三跨度 6…）都落在 9 格窗口内。
   */
  function lineScore(board, i, player, dr, dc) {
    var r0 = (i / SIZE) | 0, c0 = i % SIZE;
    var s = '';
    for (var k = -4; k <= 4; k++) {
      if (k === 0) { s += '1'; continue; }
      var r = r0 + dr * k, c = c0 + dc * k;
      if (!inBoard(r, c)) { s += '#'; continue; }
      var v = board[idx(r, c)];
      s += v === 0 ? '0' : (v === player ? '1' : '2');
    }
    for (var p = 0; p < PATTERNS.length; p++) {
      if (s.indexOf(PATTERNS[p][0]) !== -1) return PATTERNS[p][1];
    }
    return 0; // 四个方向全被堵死
  }

  /** 假设 player 在 i 落子后的四方向棋型总分（进攻视角）。 */
  function pointScore(board, i, player) {
    var total = 0;
    for (var d = 0; d < 4; d++) {
      total += lineScore(board, i, player, DIRECTIONS[d][0], DIRECTIONS[d][1]);
    }
    return total;
  }

  /** 综合评估在 i 落子的价值：己方进攻分 + 对方在此落子的威胁分 × 防守权重。 */
  function gain(board, i, player) {
    return pointScore(board, i, player) + DEFENSE * pointScore(board, i, 3 - player);
  }

  // ---------- 候选与搜索 ----------

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

  /** 全部候选按 gain 从高到低排序。 */
  function rankByGain(board, cands, player) {
    var list = [];
    for (var k = 0; k < cands.length; k++) {
      list.push({ i: cands[k], g: gain(board, cands[k], player) });
    }
    list.sort(function (a, b) { return b.g - a.g; });
    return list;
  }

  /** 收集 cands 里「落子即成五」的点。 */
  function fivePoints(board, cands, player) {
    var list = [];
    for (var k = 0; k < cands.length; k++) {
      if (pointScore(board, cands[k], player) >= SCORE.FIVE) list.push(cands[k]);
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
      var s = gain(board, cands[k], player) + rng() * 100;
      if (s > bestScore) { bestScore = s; best = cands[k]; }
    }
    return best;
  }

  /**
   * negamax 节点：返回轮到 player 走时 player 的最佳净值，
   * α-β 剪枝。候选按「攻防合计分」排序（保证堵点进入分支），
   * 但节点净值只累加「进攻分」——防守权重只是选择偏置，
   * 若参与代数会把「对方不得不堵我」错算成对方的巨大收益，毒化整棵树。
   * depth=0 时返回 0（净值只由路径上的进攻分构成）。
   */
  function negamax(board, player, depth, alpha, beta) {
    if (depth === 0) return 0;
    var cands = candidates(board);
    if (cands.length === 0) return 0;

    var ranked = rankByGain(board, cands, player);
    var branch = Math.min(ranked.length, 8);
    var best = -Infinity;

    for (var k = 0; k < branch; k++) {
      var m = ranked[k];
      var attack = pointScore(board, m.i, player);
      var v;
      if (attack >= SCORE.FIVE) {
        v = attack; // 一手成五，到此为止
      } else {
        board[m.i] = player;
        v = attack - negamax(board, 3 - player, depth - 1, -beta, -alpha);
        board[m.i] = 0;
      }
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // 剪枝
    }
    return best;
  }

  /**
   * 困难难度：根节点取增益前 14 名做 3 层 negamax（我-对手-我），
   * 能直接成五的点跳过搜索立即返回；同分候选用微小随机扰动打散。
   */
  function hardMove(board, player, cands, rng) {
    var top = rankByGain(board, cands, player).slice(0, 14);
    var best = -1, bestScore = -Infinity;

    for (var t = 0; t < top.length; t++) {
      var m = top[t];
      var v;
      if (m.g >= SCORE.FIVE) {
        v = m.g + SCORE.FIVE; // 直接赢，无需搜索
      } else {
        board[m.i] = player;
        v = m.g - negamax(board, 3 - player, 2, -Infinity, Infinity);
        board[m.i] = 0;
      }
      v += rng() * 30;
      if (v > bestScore) { bestScore = v; best = m.i; }
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
        var s = pointScore(board, oppFive[k], player) + rng() * 100;
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
    pointScore: pointScore,
    gain: gain,
    findBestMove: findBestMove,
  };

  root.Gomoku = Gomoku;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gomoku;
})(typeof window !== 'undefined' ? window : globalThis);
