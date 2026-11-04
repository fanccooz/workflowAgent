# 华荣流程助手

给普通用户用的 Chrome 插件。在已经登录的华荣照明信息平台里，用「流程助手」打开流程；可选接入 **DeepSeek**，在助手窗口里跨流程 / 菜单 / 待办搜索。

流程名称和代码不写死。API Key 只保存在本机浏览器。

## 安装

1. 用 Chrome 打开 `chrome://extensions`。
2. 打开右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `warom-workflow-agent` 这个文件夹本身。
4. 改完代码后在扩展页点「重新加载」，再刷新华荣页面。
5. 打开并登录 `https://test.warom-lighting.com/v2_debug_ouyang/`。

## 配置 DeepSeek（可选）

1. 在扩展卡片点「详细信息」→「扩展程序选项」，或助手面板里的「设置」。
2. 打开「启用 AI 搜索」，填入 DeepSeek API Key。
3. Base URL 默认 `https://api.deepseek.com`，模型默认 `deepseek-chat`。
4. 保存后刷新华荣页面。

不填 Key 时，仍可用规则匹配打开流程（例如「打开请假流程」）。

## 使用

1. 点右下角（或右侧）「流程助手」展开面板。
2. 输入一句话后点「发送」。

行为约定：

- **已配置 DeepSeek**：会话框先与模型对话；模型若判断要办事，再本地匹配/打开/填请假草稿。
- **未配置 AI**：仍可用规则打开流程；带日期事由的请假走本地 Agent。
- **打开某流程**：唯一命中则打开发起弹窗；多名则列出。

## 自测

```bash
node --test tests/intent.test.js tests/extension-match.test.js tests/extension-has-no-catalog.test.js tests/agent.test.js tests/leave-slots.test.js
```

## 习惯建议语后端（可选）

用 Nest 存最近聊天，并由 **DeepSeek 生成一句**填进助手输入框：

```bash
cd server
copy .env.example .env
# 填写 DEEPSEEK_API_KEY
npm install
npx nest start
```

扩展「设置」里填写：后端 `http://localhost:3000`、Token、华荣工号。详见 `server/README.md` 与 `docs/superpowers/specs/2026-11-02-habit-chat-suggestion-design.md`。

## 请假 / 填表 Agent（第一期）

在已登录页面输入例如：`帮我请假，明天到后天，事由开会`

助手会：对话 → 打开请假弹窗 → **把弹窗字段发给 DeepSeek 拆解回填** → 面板「确认提交」。

无 Key 时用本地规则兜底。日期类控件若写不进，需在弹窗手补后再确认提交。
