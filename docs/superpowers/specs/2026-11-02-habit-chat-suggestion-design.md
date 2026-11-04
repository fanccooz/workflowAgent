# 习惯建议语（Nest + DeepSeek → 聊天框）设计

日期：2026-11-02

## 目标

按华荣工号沉淀最近聊天；Nest 调用 DeepSeek 生成一句建议语；扩展打开助手面板时填入聊天输入框。

第一期不做：Vue3 重写、习惯报告页、表单预填、DeepSeek 全量服务端代理。

## 架构

- 扩展：读工号、上报聊天、拉建议、写入 textarea；本机 DeepSeek 仍负责对话/打开/填表/反思
- Nest.js + SQLite：存事件、缓存建议；**仅「生成建议语」走服务端 DeepSeek**
- 建议语必须由 DeepSeek 生成，禁止规则拼接成句

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/events/chat` | body: `{ waromUserId, content, role? }` |
| GET | `/api/suggestions/chat-box?waromUserId=&refresh=` | 返回 `{ suggestion, source, cached }` |

头：可选 `X-Extension-Token`（与服务器 `EXTENSION_TOKEN` 一致）。

## 表

- `chat_events`：id, warom_user_id, role, content, created_at
- `suggestion_cache`：warom_user_id (PK), suggestion, updated_at, based_on_event_id

## §3 工号 / 刷新 / 错误

### 工号读取（扩展，按序尝试）

1. 设置页可手动填写「华荣工号」（优先）
2. 页面常见位置：顶栏用户名节点、`localStorage`/`sessionStorage` 含 user/emp/staff 的键、`window` 上常见 userInfo
3. 都失败：不上报、不拉建议；面板 hint 提示去设置里填工号；不阻断原 Agent

### 建议语何时刷新

- 面板从收起→展开，且输入框为空时拉取
- 缓存存在且 `based_on_event_id` 等于该用户最新 user 事件 id → 直接返回缓存
- 否则 Nest 调 DeepSeek 生成并更新缓存
- `refresh=1` 强制重生成
- DeepSeek 超时/失败 → `suggestion: ""`，扩展保持空输入框

### 上报时机

- 用户点发送且有 `waromUserId` 时，异步 POST 用户原文（不必等 Agent 跑完）
- 可选：助手 `reply` 再 POST 一条 role=assistant（第一期可只上报 user）

### 错误处理

| 情况 | 行为 |
|------|------|
| 后端不可达 | 静默跳过上报/建议；不影响对话与打开流程 |
| 无工号 | 跳过习惯功能 |
| 聊天不足（如 &lt; 3 条 user） | 不调 DeepSeek，返回空建议 |
| Token 不匹配 | 401，扩展可在日志提示检查设置 |

### 测试

- Nest：事件写入、缓存命中、不足条数不调模型（mock DeepSeek）
- 扩展：有建议且输入框空才填入；用户已输入则不覆盖

## 目录

- `server/`：Nest 应用
- 扩展：`options` 增加 backendUrl、waromUserId、extensionToken；`content.js` 接上报与预填
