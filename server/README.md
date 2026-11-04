# 华荣流程助手 · 习惯建议语服务

Nest.js + SQLite（Node 内置 `node:sqlite`，无需编译原生模块）。根据用户最近聊天，用 **DeepSeek** 生成一句填进扩展聊天框的建议语。

## 启动

```bash
cd server
copy .env.example .env
# 编辑 .env：填入 DEEPSEEK_API_KEY、EXTENSION_TOKEN
npm install
npx nest start
```

需要 Node.js 22+（本机建议 24）。

默认：`http://localhost:3000/api`

## 接口

- `POST /api/events/chat`  
  `{ "waromUserId": "工号", "content": "用户输入", "role": "user" }`
- `GET /api/suggestions/chat-box?waromUserId=工号`
- `POST /api/tasks/plan`  
  `{ "waromUserId": "工号", "utterance": "用户原话" }` → DeepSeek 拆步并写入 SQLite
- `GET /api/tasks/:runId`
- `POST /api/tasks/:runId/start`
- `PATCH /api/tasks/:runId/steps/:seq`  
  `{ "status": "done|failed|skipped", "resultMessage": "...", "finalizeRun": true }`
- `POST /api/tasks/:runId/steps/:seq/act`  
  `{ "lastError": "...", "pageSummary": {} }` → 失败时再问 DeepSeek 如何补救

请求头：`X-Extension-Token: 与 EXTENSION_TOKEN 相同`
