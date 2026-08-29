# 游戏盒子项目约定

## 技术底线

- 零依赖、零构建：只用原生 HTML/CSS/JS，不引入 npm 包、框架或打包步骤
- 每个游戏一个独立文件夹（如 `sudoku/`），双击其 `index.html` 必须可玩

## 代码结构

- 核心算法与界面分离：算法文件（如 `sudoku/sudoku.js`）不碰 DOM，以便用 Node 批量自测
- 改动核心算法后必须重跑该游戏的自测脚本（如 `node sudoku/test.js`）
- 界面交互代码放各游戏的 `app.js`；每个游戏自带完整样式表

## 主题与共享资源

- 各游戏 `<head>` 在样式表之前引入 `../shared/theme.js`
- 样式表提供 `:root` 与 `:root[data-theme="dark"]` 两套 CSS 变量
- 主题偏好统一存 localStorage 键 `gamebox-theme`；游戏进度/战绩用各自键名（如 `sudoku-save-v1`）
- 新增游戏时：建独立文件夹 + 在根目录 `index.html` 加一张入口卡片 + 更新 `README.md` 路线图

## 其他

- 界面文案使用简体中文
- 提交信息用中文简述改动（如"数独：新增暂停功能"）
