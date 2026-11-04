# DeepSeek 跨模块搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 流程助手接入 DeepSeek：本地先搜流程/菜单/待办，模型理解和排序；说打开某流程时直接打开且不与菜单混排。

**Architecture:** 内容脚本收集候选并识别 scope；background 用存储的 Key 调 DeepSeek；结果按类型执行或分块展示。

**Tech Stack:** Chrome MV3、DeepSeek OpenAI 兼容 API、chrome.storage.local

## Global Constraints

- Key 只存 `chrome.storage.local`，不进仓库
- 默认 provider：deepseek；baseUrl：`https://api.deepseek.com`；model：`deepseek-chat`
- `scope=workflow` 时只处理流程；列表分「流程 / 菜单 / 待办」块
- 无 Key 退回现有流程规则匹配
- 不创建提交除非用户要求

---

### Task 1: 意图与候选工具 + 测试

**Files:**
- Create: `extension/intent.js`
- Test: `tests/intent.test.js`

### Task 2: 选项页 + background 调 DeepSeek

**Files:**
- Create: `extension/options.html`, `extension/options.js`, `extension/options.css`, `extension/background.js`
- Modify: `manifest.json`

### Task 3: 内容脚本接入 AI 流程

**Files:**
- Modify: `extension/content.js`, `README.md`
