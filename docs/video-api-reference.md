# 视频生成 API 文档

> 供应商：gpt-best  
> Base URL：由用户配置的供应商地址（例：`https://your-provider.com`）  
> 认证：`Authorization: Bearer {{YOUR_API_KEY}}`

本文档涵盖两套视频 API 体系：**v1（OpenAI 兼容）** 和 **v2（Sora2 专用）**。

---

## 体系一：v1 — OpenAI 兼容格式

### 1. 创建视频

- **端点**：`POST /v1/videos`
- **Content-Type**：`multipart/form-data`

#### 请求参数（form-data）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | ✅ | 模型名称，如 `sora-2` |
| `prompt` | string | ✅ | 视频描述文案 |
| `size` | string | ❌ | 视频尺寸，如 `720x1280`、`1280x720` |
| `input_reference` | string | ❌ | 参考图片 URL（图生视频时使用） |
| `seconds` | string | ❌ | 视频时长（秒），如 `"4"` |
| `watermark` | string | ❌ | 是否加水印，`"true"` 或 `"false"` |

#### 请求示例

```bash
curl --location --request POST 'https://your-provider.com/v1/videos' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}' \
  --form 'model="sora-2"' \
  --form 'prompt="基于这张图片生成视频"' \
  --form 'size="720x1280"' \
  --form 'input_reference=@"https://example.com/reference.jpg"' \
  --form 'seconds="4"' \
  --form 'watermark="false"'
```

#### 返回响应

```json
{
  "id": "video_b9d05dda-0f9d-48c2-944e-7c5b47c6a399",
  "object": "video",
  "model": "sora-2",
  "status": "queued"
}
```

---

### 2. 查询视频进度

- **端点**：`GET /v1/videos/{video_id}`
- **Content-Type**：无（GET 请求）

#### 请求示例

```bash
curl --location --request GET 'https://your-provider.com/v1/videos/video_b9d05dda-0f9d-48c2-944e-7c5b47c6a399' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}'
```

#### 返回响应

```json
{
  "id": "video_b9d05dda-0f9d-48c2-944e-7c5b47c6a399",
  "object": "video",
  "model": "sora-2-pro",
  "status": "queued",
  "progress": 0,
  "created_at": 1760679942,
  "seconds": "15",
  "size": "1280x720",
  "error": null,
  "video_url": ""
}
```

#### status 枚举值

| 值 | 含义 |
|---|---|
| `queued` | 排队中 |
| `in_progress` | 生成中 |
| `completed` | 完成，`video_url` 字段有值 |
| `failed` | 失败，查看 `error` 字段 |

---

### 3. 查询视频内容

- **端点**：`GET /v1/videos/{video_id}/content`
- **Content-Type**：无（GET 请求）
- **返回**：视频文件二进制流

#### 请求示例

```bash
curl --location --request GET 'https://your-provider.com/v1/videos/video_b9d05dda-0f9d-48c2-944e-7c5b47c6a399/content' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}'
```

#### 返回

直接返回视频文件的二进制数据（可保存为 .mp4）。

---

## 体系二：v2 — Sora2 专用格式

> **所有 Sora2 操作（文生、图生、故事板、角色客串）都使用同一个端点**，通过请求体中的字段区分功能。

### 4. Sora2 文生视频

- **端点**：`POST /v2/videos/generations`
- **Content-Type**：`application/json`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✅ | 视频描述文案 |
| `model` | string | ✅ | 模型名称，如 `sora-2` |
| `aspect_ratio` | string | ❌ | 宽高比，如 `"16:9"`、`"9:16"`、`"1:1"` |
| `hd` | boolean | ❌ | 是否高清，默认 `false` |
| `duration` | string | ❌ | 视频时长（秒），如 `"5"`、`"10"`、`"15"`、`"20"` |

#### 请求示例

```bash
curl --location --request POST 'https://your-provider.com/v2/videos/generations' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "prompt": "make animate",
    "model": "sora-2",
    "aspect_ratio": "16:9",
    "hd": false,
    "duration": "10"
  }'
```

#### 返回响应

```json
{
  "task_id": "f0aa213c-c09e-4e19-a0e5-c698fe48acf1"
}
```

---

### 5. Sora2 图生视频

- **端点**：`POST /v2/videos/generations`
- **Content-Type**：`application/json`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✅ | 视频描述文案 |
| `model` | string | ✅ | 模型名称，如 `sora-2` |
| `images` | string[] | ✅ | **参考图片 URL 数组**（与文生视频的区别） |
| `aspect_ratio` | string | ❌ | 宽高比，如 `"16:9"` |
| `hd` | boolean | ❌ | 是否高清 |
| `duration` | string | ❌ | 视频时长（秒） |
| `notify_hook` | string | ❌ | 完成后的 Webhook 回调 URL |
| `watermark` | boolean | ❌ | 是否加水印 |
| `private` | boolean | ❌ | 是否私有 |

#### 请求示例

```bash
curl --location --request POST 'https://your-provider.com/v2/videos/generations' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "prompt": "让图中的人物跳舞",
    "model": "sora-2",
    "images": ["https://example.com/photo.jpg"],
    "aspect_ratio": "16:9",
    "hd": true,
    "duration": "10"
  }'
```

#### 返回响应

```json
{
  "task_id": "f0aa213c-c09e-4e19-a0e5-c698fe48acf1"
}
```

---

### 6. Sora2 故事板视频

- **端点**：`POST /v2/videos/generations`
- **Content-Type**：`application/json`
- **特殊**：prompt 使用 `Shot N:` 格式描述多个场景

#### 请求参数

同文生视频参数，但 `prompt` 格式不同。

#### prompt 格式

```
Shot 1:
duration: 7.5sec
Scene: 飞机起飞

Shot 2:
duration: 7.5sec
Scene: 飞机降落
```

#### 请求示例

```bash
curl --location --request POST 'https://your-provider.com/v2/videos/generations' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "prompt": "Shot 1:\nduration: 7.5sec\nScene: 飞机起飞\n\nShot 2:\nduration: 7.5sec\nScene: 飞机降落",
    "model": "sora-2",
    "aspect_ratio": "16:9",
    "hd": false,
    "duration": "10"
  }'
```

#### 返回响应

```json
{
  "task_id": "f0aa213c-c09e-4e19-a0e5-c698fe48acf1"
}
```

---

### 7. Sora2 使用角色客串

- **端点**：`POST /v2/videos/generations`
- **Content-Type**：`application/json`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✅ | 视频描述文案 |
| `model` | string | ✅ | 模型名称，如 `sora-2` |
| `images` | string[] | ❌ | 参考图片 URL 数组 |
| `aspect_ratio` | string | ❌ | 宽高比 |
| `hd` | boolean | ❌ | 是否高清 |
| `duration` | string | ❌ | 视频时长（秒） |
| `character_url` | string | ✅ | **角色资源 URL**（与图生视频的区别） |
| `character_timestamps` | string | ❌ | 角色出现的时间戳 |
| `notify_hook` | string | ❌ | Webhook 回调 URL |
| `watermark` | boolean | ❌ | 是否加水印 |
| `private` | boolean | ❌ | 是否私有 |

#### 请求示例

```bash
curl --location --request POST 'https://your-provider.com/v2/videos/generations' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "prompt": "角色在海滩上奔跑",
    "model": "sora-2",
    "images": ["https://example.com/scene.jpg"],
    "aspect_ratio": "16:9",
    "hd": true,
    "duration": "10",
    "character_url": "https://example.com/character.jpg",
    "character_timestamps": "0-10"
  }'
```

#### 返回响应

```json
{
  "task_id": "f0aa213c-c09e-4e19-a0e5-c698fe48acf1"
}
```

---

### 8. Sora2 查询任务

- **端点**：`GET /v2/videos/generations/{task_id}`
- **Content-Type**：无（GET 请求）

#### 请求示例

```bash
curl --location --request GET 'https://your-provider.com/v2/videos/generations/f0aa213c-c09e-4e19-a0e5-c698fe48acf1' \
  --header 'Authorization: Bearer {{YOUR_API_KEY}}'
```

#### 返回响应

```json
{
  "task_id": "veo3:1756693796-YQVHH4A3Lg",
  "platform": "google",
  "action": "google-videos",
  "status": "SUCCESS",
  "fail_reason": "",
  "submit_time": 1756693797,
  "start_time": 1756693808,
  "finish_time": 1756693898,
  "progress": "100%",
  "data": {
    "output": "https://filesystem.site/cdn/20250901/018eg2SgUpHMT6EEuQbfeRLWeUhE75.mp4"
  },
  "search_item": ""
}
```

#### status 枚举值

| 值 | 含义 |
|---|---|
| `SUCCESS` | 成功，从 `data.output` 获取视频 URL |
| `FAIL` | 失败，查看 `fail_reason` 字段 |
| 其他 | 进行中，查看 `progress` 字段（如 `"50%"`） |

---

## 两套体系对比

| 维度 | v1（OpenAI 兼容） | v2（Sora2 专用） |
|---|---|---|
| 创建端点 | `POST /v1/videos` | `POST /v2/videos/generations` |
| 请求格式 | form-data | JSON |
| 任务 ID 字段 | `id`（响应体） | `task_id`（响应体） |
| 查询端点 | `GET /v1/videos/{id}` | `GET /v2/videos/generations/{task_id}` |
| 视频 URL 字段 | `video_url` | `data.output` |
| 完成状态 | `completed` | `SUCCESS` |
| 失败状态 | `failed` | `FAIL` |
| 支持图生视频 | `input_reference` 字段 | `images` 数组 |
| 支持故事板 | ❌ | ✅（prompt 用 Shot 格式） |
| 支持角色客串 | ❌ | ✅（`character_url` 字段） |
