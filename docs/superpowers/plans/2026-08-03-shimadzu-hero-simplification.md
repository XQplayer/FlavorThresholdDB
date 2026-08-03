# Shimadzu Hero Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简岛津分析页首屏，只保留产品标识、主标题和动态浏览器引擎状态卡。

**Architecture:** 保持现有 React 组件结构与状态数据流不变，只移除两组静态 JSX，并针对缩短后的内容调整同一组件样式。增加源码级布局契约测试，防止被删除的重复信息重新进入首屏，同时确认动态引擎状态仍保留。

**Tech Stack:** React 19、CSS、Node.js `node:test`、Vite、ESLint

---

### Task 1: 建立首屏内容契约

**Files:**
- Create: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: 写入失败测试**

测试读取 `ShimadzuAnalysisPage.jsx`，断言指定说明段落和 `shimadzu-hero-facts` 不存在，同时断言 `shimadzu-hero-status`、`engine.title` 和 `engine.detail` 仍存在。

- [ ] **Step 2: 验证测试先失败**

Run: `pnpm exec node --test src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`

Expected: FAIL，失败原因是旧说明段落或 `shimadzu-hero-facts` 仍存在。

- [ ] **Step 3: 将布局测试加入回归命令**

在 `test:shimadzu-browser` 的 `node --test` 文件列表中加入 `src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`。

### Task 2: 精简 JSX 与首屏尺寸

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`

- [ ] **Step 1: 移除重复内容**

删除 `.shimadzu-hero-copy` 内的说明 `<p>` 和完整的 `.shimadzu-hero-facts` 定义列表，保留 kicker、`h1` 与 `.shimadzu-hero-status`。

- [ ] **Step 2: 删除失效样式并收紧布局**

删除 `.shimadzu-hero-copy > p`、`.shimadzu-hero-facts` 及其移动端规则；将桌面首屏改为约 250 px 的紧凑高度，减少上下内边距和列间距，并让标题与状态卡垂直居中。

- [ ] **Step 3: 验证契约测试通过**

Run: `pnpm exec node --test src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`

Expected: PASS，1 test、0 fail。

### Task 3: 本地完整验证

**Files:**
- Verify only

- [ ] **Step 1: 运行岛津回归测试**

Run: `pnpm run test:shimadzu-browser`

Expected: 全部测试通过，0 fail。

- [ ] **Step 2: 运行静态检查与生产构建**

Run: `pnpm run lint`

Expected: exit 0。

Run: `pnpm run build`

Expected: exit 0，生成 `frontend/dist`。

- [ ] **Step 3: 检查改动边界并本地提交**

Run: `git diff --check && git status --short`

Expected: 只包含设计、计划、布局测试、页面 JSX、页面 CSS 和测试脚本变更；不推送、不发布。
