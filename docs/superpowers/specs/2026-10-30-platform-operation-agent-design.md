# 平台操作 Agent（请假竖切）设计

日期：2026-10-30

## 目标

在现有 Chrome 扩展上做成平台操作 Agent 第一期竖切：

1. 任意已登录页可多步导航到流程定义列表并打开流程  
2. 请假：按用户原话能填的字段写入草稿（不追问）  
3. 面板「确认提交」后才点提交；必填空着则禁用/拦截  

不做：通用任意表单 AI 乱点、自动提交、待办审批、服务端。

## 架构

- **UI**：面板先 DeepSeek 多轮对话，再展示执行结果、确认提交  
- **对话优先（已配 Key）**：`warom-ai-chat` 返回 `{ reply, action }`；再按 action 调本地工具  
- **编排**：规则状态机 + 工具循环（≤12 步）  
- **工具**：`observe_page`、`goto_workflow_list`、`open_workflow`、`ai_fill_form`、`check_required`、`submit_workflow`（需 confirmToken）

## 填表策略

- 打开弹窗后采集页面字段 label，交给 DeepSeek（`warom-ai-fill-form`）按用户原话生成 `{fills: {label: value}}`  
- 扩展按 label 写入；回读失败则标「未生效需手补」  
- 无 Key / 调用失败时用 `leave.js` 规则抽槽兜底  
- 必填以页面 `is-required` / `*` 为准；没有标记时启发式检查日期与事由类字段  

## 失败反思重试

- 工具可恢复失败时（进列表失败、打开失败、填表硬失败）调用 `warom-ai-reflect`  
- 模型返回 `retry` / `ask_user` / `stop`；`retry` 最多 2 次  
- 无 Key 或反思失败：本地兜底（刷新列表 / 短词「请假」重试）

## 状态机（摘要）

`observe` → 未登录 stop → 不在列表则 goto → open 请假 → extract → fill → check → await_confirm →（用户确认）submit → done
