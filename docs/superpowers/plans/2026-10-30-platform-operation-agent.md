# 平台操作 Agent（请假竖切）Implementation Plan

> **For agentic workers:** 按任务顺序实现；步骤用 checkbox 跟踪。用户要求少读长文，实现时以本计划与 spec 为准。

**Goal:** 扩展内规则状态机 + 固定工具：任意页导航到流程列表、打开请假、按原话填草稿、确认后提交。

**Architecture:** `extension/agent.js` 编排；`extension/tools/*.js` 与 `extension/skills/leave.js` 提供工具；`content.js` 挂载面板并调用 `runLeaveTask` / 现有打开能力。

**Tech Stack:** Chrome MV3、现有 DeepSeek background、Node `node:test`。

## Global Constraints

- 提交必须带面板生成的 `confirmToken`
- 缺字段不追问；工具循环 ≤12 步
- 不把 API Key 写入仓库

## 文件

- Create: `extension/agent.js` — 状态机 `nextAction(state, observation)` / `applyToolResult`
- Create: `extension/skills/leave.js` — 抽槽、必填、label 映射
- Create: `extension/tools.js` — 聚合 DOM 工具（observe/goto/open/fill/submit）
- Create: `tests/agent.test.js`、`tests/leave-slots.test.js`
- Modify: `extension/content.js`、`manifest.json` content_scripts 顺序
- Modify: `extension/background.js` — 可选 `warom-extract-slots`

---

### Task 1: Agent 状态机（纯逻辑）

**Files:** Create `extension/agent.js`；Test `tests/agent.test.js`

**Produces:** `createTask(utterance)`, `nextAction(task, observation)`, `applyResult(task, toolName, result)`

- [ ] 写失败测试：未登录 → stop login；不在列表 → goto；在列表无弹窗 → open；有弹窗 → extract；已抽槽 → fill；filled → await_confirm；有 token 且 ready → submit
- [ ] 实现最小状态机并通过测试

### Task 2: 请假抽槽

**Files:** Create `extension/skills/leave.js`；Test `tests/leave-slots.test.js`

**Produces:** `extractSlots(utterance, nowDate)`, `requiredFields`, `isReady(slots, filled)`

- [ ] 测试：明天/后天、事由、无日期则空
- [ ] 实现规则抽槽（相对日期）

### Task 3: DOM 工具 + 接入 content

**Files:** Create `extension/tools.js`；Modify `content.js`、`manifest.json`

- [ ] `observe_page` / `goto_workflow_list` / 包装现有 open
- [ ] 面板增加步骤日志与「确认提交」
- [ ] 含日期/事由的请假话术走 `runLeaveTask`

### Task 4: 填表 + 确认提交

**Files:** Modify `tools.js`、`skills/leave.js`、`content.js`

- [ ] `fill_leave_form` 按 label 填
- [ ] `submit_workflow` 校验 confirmToken
- [ ] 必填未满禁用确认按钮
