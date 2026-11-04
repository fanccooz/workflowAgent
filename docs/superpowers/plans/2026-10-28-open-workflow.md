# 流程发起技能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安装一个个人技能，在已登录的目标信息平台任意页面上，按用户说法打开发起弹窗。

**Architecture:** 匹配、查询方案选择和地址拼接放在 `match-workflow.js`，用虚构流程做单元测试。`SKILL.md` 只描述如何在已登录页面拉取当前列表、调用脚本、改 hash。技能目录不保存真实流程名称或代码。

**Tech Stack:** Node.js 内置 `node:test`，Cursor 个人技能目录。

## Global Constraints

- 技能路径：`~/.cursor/skills/open-workflow\SKILL.md`
- 不放进 `~/.cursor/skills-cursor/`
- `SKILL.md` 不设置 `disable-model-invocation`
- 技能目录中的文件不包含截图里的流程名称、代码、主视图对照
- 列表接口：`POST /app/api/system/entity-query-solution/task-form-view-query/WorkflowDefinition`
- 查询方案接口：`POST /app/api/system/entity-query-solution/get-task-form-view-solutions/WorkflowDefinition`
- 页面查询方案代码为 `1`，请求体里的 `solution` 使用该方案的 ID
- `DisableStatus` 为 `1` 表示已禁用
- 打开地址：`https://platform.example.com/app/#/workflow/workflow-base/agent?code=` 加上当前代码
- 不输入、不保存密码，回复里不写请求头或令牌
- 不创建 git 提交，用户没有要求提交

---

### Task 1: 匹配脚本

**Files:**
- Create: `~/.cursor/skills/open-workflow\scripts\match-workflow.js`
- Test: `~/.cursor/skills/open-workflow\scripts\match-workflow.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `buildCandidates(utterance)`, `matchWorkflows(utterance, rows)`, `selectSolution(solutions, solutionCode)`, `projectRows(rawRows, columns)`, `buildQuery(solutionId, columnFields, start, end)`, `nextRange(rowCount, loadedCount, pageSize)`, `openUrl(code)`

- [ ] **Step 1: 写失败测试**

测试只用虚构流程：出差申请 `10021`、用印申请 `10022`、采购申请 `10023`、已禁用的离职申请 `10024`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test ~/.cursor/skills/open-workflow\scripts\match-workflow.test.js`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现脚本**

单字「请」只在后面接着另一句客套话时去掉，避免把「请假」拆开。多字客套话按长度从长到去掉掉。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test ~/.cursor/skills/open-workflow\scripts\match-workflow.test.js`
Expected: PASS

### Task 2: 技能说明与名单扫描

**Files:**
- Create: `~/.cursor/skills/open-workflow\SKILL.md`
- Test: `<repo>\tests\skill-has-no-catalog.test.js`

**Interfaces:**
- Consumes: Task 1 的命令行：`node match-workflow.js --utterance <文字> --rows <临时json> [--columns <临时json>]`
- Produces: 个人技能，用户说打开某条流程时自动采用

- [ ] **Step 1: 写名单扫描测试**

扫描技能目录，禁止出现截图中的名称、主视图和代码。

- [ ] **Step 2: 写 SKILL.md**

- [ ] **Step 3: 运行两个测试**

Run: `node --test ~/.cursor/skills/open-workflow\scripts\match-workflow.test.js <repo>\tests\skill-has-no-catalog.test.js`
Expected: PASS

- [ ] **Step 4: 不提交**

用户没有要求创建提交。
