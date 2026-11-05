# 流程助手

Chrome MV3 扩展 + Nest 习惯服务。在已登录的信息平台里，用「流程助手」打开流程、筛选列表、请假填表；可选 DeepSeek。

扩展前端为 **Vue 3 + TypeScript**（Vite + CRX 构建）。

## 扩展：安装

```bash
cd extension
npm install
npm run build
```

1. Chrome 打开 `chrome://extensions`
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 **`extension/dist`**
4. 改代码后执行 `npm run build`，再在扩展页点「重新加载」，并刷新平台页面
5. 打开并登录你的信息平台（默认匹配 `https://test.warom-lighting.com/v2_debug_ouyang/`，可在 `extension/manifest.config.ts` 修改）

开发时可在 `extension` 目录执行 `npm run dev`（CRX/Vite 热更新）。

## 扩展环境变量

```bash
cd extension
copy .env.example .env
# 填写 VITE_DEEPSEEK_API_KEY=...
npm run build
```

- `.env` 仅本机（已 gitignore）；`.env.example` 只放空占位
- 构建时注入为默认 Key；「扩展选项」里保存的值优先写入 `chrome.storage`

## 配置 DeepSeek（可选）

1. 扩展「详细信息」→「扩展程序选项」，或面板「设置」
2. 启用 AI，填写 DeepSeek API Key（若 `.env` 已配则可留空）
3. 保存后刷新平台页

## 习惯建议语 / 任务拆步后端（可选）

```bash
cd server
copy .env.example .env
# 填写 DEEPSEEK_API_KEY、EXTENSION_TOKEN
npm install
npx nest start
```

扩展设置里填写：后端 `http://localhost:3000`、Token、工号。

启用后端后：**DeepSeek 拆步 → SQLite 落库 → 逐步执行 → 失败再 Act**。

## 自测

```bash
cd extension
npm test
```

## 目录

- `extension/src` — Vue/TS 源码
- `extension/dist` — 构建产物（加载此目录）
- `server` — Nest 习惯 / 任务服务
