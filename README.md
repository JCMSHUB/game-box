# 游戏盒子 Game Box

自娱自乐的 web 小游戏合集。零依赖、零构建，每个游戏是一个独立文件夹，
双击其 `index.html` 或用任意静态服务器即可游玩。

## 目录结构

```
game-box/
├── index.html      # 盒子首页（游戏入口卡片）
├── shared/
│   └── theme.js    # 共享的深浅色主题脚本（各游戏统一引入）
├── sudoku/         # 数独
│   ├── index.html
│   ├── style.css
│   ├── sudoku.js   # 核心算法（求解器 + 出题器），不依赖 DOM
│   ├── app.js      # 界面与交互
│   └── test.js     # 算法自测：node test.js
└── gomoku/         # 五子棋
    ├── index.html
    ├── style.css
    ├── gomoku.js   # 核心算法（胜负判定 + AI 走子），不依赖 DOM
    ├── app.js      # 界面与交互
    ├── test.js     # 算法自测：node test.js
    └── app.test.js # 交互回归检查：node app.test.js
```

## 本地运行

```bash
# 静态服务（推荐，可玩盒子首页）
python3 -m http.server 8763 --directory game-box
# 浏览器打开 http://127.0.0.1:8763/

# 或者直接双击某个游戏的 index.html
```

## 本地测试

在项目根目录执行，无需安装依赖：

```bash
node sudoku/test.js       # 数独算法
node gomoku/test.js       # 五子棋算法
node gomoku/app.test.js   # 五子棋提示、复盘战绩与存档恢复
```

交互回归检查使用模拟页面、存储和定时器运行实际游戏脚本；发布前还需在浏览器中检查实际操作。

## 新增游戏的约定

1. 根目录建一个以游戏命名的文件夹，`index.html` + 样式 + 逻辑自包含；
2. 核心算法与界面分离：算法文件不碰 DOM，便于用 Node 批量自测；
3. 在 `<head>` 的样式表之前引入 `../shared/theme.js`，
   样式表提供 `:root` / `:root[data-theme="dark"]` 两套 CSS 变量；
4. 在首页 `index.html` 加一张游戏卡片。

## 路线图

- [x] 数独：三档难度、铅笔笔记、撤销/重做、提示、暂停、进度自动保存、战绩统计、深浅色主题、通关动画
- [x] 五子棋：人机/双人对战、三档 AI（窗口扫描评分 + 困难档搜索）、悔棋/重做、终局复盘、提示、键盘操作、进度自动保存、战绩统计、深浅色主题
- [ ] 更多游戏（暂缓，优先打磨现有游戏）
