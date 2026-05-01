# AI Infinite Canvas 代码地图（分级 + 坐标）

说明：本文件用于“改动前定位边界”，避免误改。  
规则：先看分级，再看位置，再动代码。

---

## 🔴 红色（禁止直接改）

### R1. 前后端执行契约
- `services/aiService.ts:10` `executeNode(...)`（请求体字段）
- `backend/main.py:487` `@app.post("/execute")`
- `backend/main.py:488` `execute_node(...)`
- 关键关注：`node_id / node_type / config / inputs / api_key / base_url` 与返回 `output/meta`

### R2. 工作流核心执行入口
- `store.ts:927` `executeWorkflow`
- `store.ts:1249` `executeSingleNode`
- 关键关注：执行入口、节点状态回写、结果落盘时机

### R3. 节点核心结构定义
- `types.ts:90` `NodeData`
- `types.ts:93` `config`
- `types.ts:102` `status`
- 关键关注：节点基础字段与状态枚举兼容性

### R4. 工作流结构兼容
- `store.ts:200` `persistWorkflowIndex`
- `store.ts:75` `saveWorkflowPayload`
- `store.ts:87` `loadWorkflowPayload`
- 关键关注：保存/加载结构稳定性与旧数据兼容

---

## 🟡 黄色（先确认再改）

### Y1. 自动跳过与依赖策略
- `store.ts:1099` `canUseOwnPrompt`
- `store.ts:1111` `shouldAutoSkipForNoInput`
- `store.ts:1062` 依赖未满足判断
- 影响：节点是否执行、是否跳过、用户体感变化大

### Y2. 图像节点核心策略
- `backend/main.py:596` 有图输入分支（强制 image-edit）
- `backend/main.py:639` 同步 `images.edit`
- `backend/main.py:655` `run_async_edit(...)` 异步兜底
- 影响：结果一致性、失败率、供应商兼容性

### Y3. 生成路由与 fallback
- `backend/main.py:674` 无图文生图入口
- `backend/main.py:694` `images.generate`
- `backend/main.py:717` `run_async_generation(...)`
- 影响：不同模型/代理行为差异、输出可预期性

### Y4. 安全与权限
- `store.ts:1260` 节点锁校验
- `config/security.ts:3` 开发口令读取
- `config/security.ts:5` 保险箱口令读取
- 影响：安全边界与访问控制

### Y5. 持久化与历史策略
- `store.ts:112` 图像历史 DB
- `store.ts:126` 读取历史
- `store.ts:139` 写入历史
- 影响：历史保留、容量、迁移与性能

---

## 🟢 绿色（可直接改）

### G1. 画布与页面展示
- `App.tsx:69` 画布主视图与面板装配
- `App.tsx:58` 快捷节点目录展示
- `components/*` 各面板样式与交互文案

### G2. 节点展示层
- `nodes/BaseNode.tsx:73` 基础节点壳层
- `nodes/implementations/*.tsx` 各节点 UI
- 影响边界：只改展示，不改输入输出结构

### G3. 日志/提示文案
- `store.ts:337` `addLog(...)`
- `components/NoticeStack.tsx` 提示展示
- `components/TerminalOutput.tsx` 日志呈现

---

## 改动前检查清单（每次 30 秒）

1. 我改的是红/黄/绿哪层？  
2. 是否触碰了执行入口或契约字段？  
3. 是否会改变“有图/无图”的生成行为？  
4. 是否会影响旧工作流读取？  
5. 提交说明里是否写了层级和验证结果？

---

## 推荐协作方式

- 红层：先提案再开发  
- 黄层：先给影响说明再开发  
- 绿层：可直接开发，但不得越界触碰红黄层
