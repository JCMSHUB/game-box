/**
 * 游戏盒子共享主题脚本
 * 在页面渲染前把 data-theme 设到 <html> 上（避免刷新闪色）：
 * 优先用玩家上次的选择（localStorage: sudoku-theme → 逐步迁移为 gamebox-theme），
 * 否则跟随系统 prefers-color-scheme。各游戏的 index.html 在 <link> 样式表之前引入。
 *
 * 各游戏的样式表需提供 :root 与 :root[data-theme="dark"] 两套 CSS 变量。
 * 切换按钮的约定：页面里放 id="themeBtn" 的按钮并调用 window.syncThemeLabel()，
 * 切换逻辑可参考 sudoku/app.js。
 */
(function () {
  'use strict';

  var KEY = 'gamebox-theme';
  var LEGACY_KEY = 'sudoku-theme'; // 数独早期版本用的键，读一次做迁移
  var t;

  try {
    t = localStorage.getItem(KEY);
    if (t !== 'dark' && t !== 'light') {
      t = localStorage.getItem(LEGACY_KEY);
      if (t === 'dark' || t === 'light') {
        localStorage.setItem(KEY, t); // 迁移到统一键名
        localStorage.removeItem(LEGACY_KEY);
      }
    }
  } catch (e) { /* 存储不可用时退回系统偏好 */ }

  if (t !== 'dark' && t !== 'light') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  document.documentElement.dataset.theme = t;

  // 供各游戏切换主题：返回切换后的主题名
  window.toggleGameboxTheme = function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) {}
    return next;
  };

  // 供各游戏刷新按钮图标：约定深色显 ☀️、浅色显 🌙
  window.syncThemeLabel = function () {
    var btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  };
})();
