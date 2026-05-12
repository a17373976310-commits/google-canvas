# AI Infinite Canvas

这是当前恢复出来的旧版项目基线，已经整理到可继续启动、排查和补内容的状态。

## 当前状态

- 项目目录已从 GitHub 旧仓库恢复到 `F:\awei2\aweia\aweib`
- 前端 `npm install` 已完成
- 前端 `npm run build` 已通过
- 后端依赖导入正常，`/health` 接口可返回 `200`
- Vite 本地开发服务可正常响应

注意：这不是你丢失前的最新本地版本，而是一个可运行的恢复基线。后续可以在这个基础上慢慢补回较新的内容。

## 运行要求

- Node.js `22.x` 到 `24.x`
- npm `10+`
- Python `3.11+`

## 一键启动

优先使用：

```bat
一键启动项目.bat
```

这个脚本会做几件事：

- 检查 `node`、`npm`、`python`
- 如缺少 `.env.local`，自动生成一个本地开发模板
- 如缺少 `node_modules`，自动执行 `npm install`
- 如缺少后端依赖，自动执行 `pip install -r backend\requirements.txt`
- 拉起前端和后端两个窗口

启动后地址：

- 前端：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:8000/health`

## 手动启动

前端：

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

后端：

```bash
python -m pip install -r backend/requirements.txt
python backend/main.py
```

## 环境变量

如果项目根目录没有 `.env.local`，启动脚本会自动创建。最少会包含这些字段：

```env
VITE_GEMINI_API_KEY=
VITE_BACKEND_URL=http://127.0.0.1:8000
VITE_DEV_MODE_PASSWORD=change-this-password
VITE_NODE_VAULT_PASSWORD=change-this-password
VITE_EXECUTE_TIMEOUT_MS=0
```

如果后端后续要接第三方兼容接口，再补这些：

```env
THIRD_PARTY_API_KEY=
THIRD_PARTY_BASE_URL=
OPENAI_TIMEOUT_SECONDS=60
HTTP_REQUEST_TIMEOUT_SECONDS=30
```

## 目录说明

- `backend/`：FastAPI 后端
- `components/`：前端组件
- `nodes/`：节点逻辑
- `services/`：前端服务层
- `public/`：静态资源
- `history/`：历史记录和生成结果

## 说明

项目已经改为使用仓库内的 `.npm-cache`，避免继续依赖系统全局 npm 缓存，减少 C 盘缓存问题的影响。
