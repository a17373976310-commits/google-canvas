# AWEI License Server

轻量授权与版本管理服务。第一版用于验证：

- 客户授权码是否有效
- 设备是否允许使用
- 后台是否能备注/禁用设备
- 客户端是否需要提示新版下载

## 本地运行

```powershell
cd license_server
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
$env:LICENSE_ADMIN_TOKEN="your-admin-token"
uvicorn app:app --host 0.0.0.0 --port 8787
```

打开：

```text
http://127.0.0.1:8787/admin
```

后台页面会要求输入 `LICENSE_ADMIN_TOKEN`。

## 健康检查

```powershell
curl http://127.0.0.1:8787/health
```

## 客户端激活示例

```powershell
curl -X POST http://127.0.0.1:8787/client/activate `
  -H "Content-Type: application/json" `
  -d "{\"license_key\":\"AWEI-...\",\"device_id\":\"device-001\",\"hostname\":\"PC-001\",\"os_name\":\"Windows\",\"app_version\":\"1.0.0\"}"
```

## Zeabur 环境变量

推荐在 Zeabur 新建一个独立服务，Root Directory 选择：

```text
license_server
```

如果 Zeabur 识别到 Dockerfile，就会按 Dockerfile 启动。

部署时至少配置：

```text
LICENSE_ADMIN_TOKEN=换成你的强密码
LICENSE_DB_PATH=/data/license_server.db
```

如果 Zeabur 没有持久化磁盘，SQLite 数据会丢。正式使用建议给服务挂载持久化卷，或后面改成 Postgres。

部署后测试：

```text
https://你的授权服务域名/health
```
