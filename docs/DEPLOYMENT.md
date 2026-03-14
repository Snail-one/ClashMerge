# 部署说明指南

## 一、项目说明

本项目是一个基于 Node.js 的个人 Clash 订阅管理器，提供以下能力：

- Web 管理页面
- 本地管理 API
- 受保护的订阅输出链接

默认监听地址为 `127.0.0.1`，默认端口为 `3000`。

## 二、运行环境

需要满足以下条件：

- Node.js 18 及以上
- npm 9 及以上
- Windows、Linux 或 macOS

如果使用容器部署，则需要：

- Docker
- Docker Compose

## 三、快速启动

Windows PowerShell：

```powershell
npm.cmd install
$env:MANAGEMENT_TOKEN="替换成你自己的高强度管理令牌"
npm.cmd start
```

启动后访问：

```text
http://127.0.0.1:3000/
```

## 四、首次部署步骤

1. 克隆或下载项目代码。
2. 执行 `npm install` 安装依赖。
3. 通过环境变量设置固定的管理令牌 `MANAGEMENT_TOKEN`。
4. 执行 `npm start` 启动服务。
5. 打开管理页面，输入管理令牌登录。

运行数据会保存在 `data/` 目录下，包括：

- `data/system.json`
- `data/cache/`
- `data/output/`
- `data/builds/`
- `data/logs/`

这些内容属于运行态或敏感数据，不应提交到 Git 仓库。

## 五、推荐环境变量

```text
MANAGEMENT_TOKEN=你的高强度管理令牌
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://your-domain.example/
MAX_BUILD_RECORDS=10
MAX_LOG_RETENTION_DAYS=10
MAX_TOTAL_LOG_BYTES=1073741824
REMOTE_SOURCE_TIMEOUT_MS=10000
MAX_REMOTE_SOURCE_BYTES=4194304
TRANSFORM_TIMEOUT_MS=1500
MAX_LOGIN_ATTEMPTS=5
LOGIN_WINDOW_MS=600000
API_RATE_LIMIT_MAX=240
API_RATE_LIMIT_WINDOW_MS=60000
```

可选项：

```text
ALLOW_PRIVATE_REMOTE_SOURCES=true
ALLOWED_LOCAL_SOURCE_ROOTS=G:\code\proxy;D:\clash-sources
```

说明：

- `MANAGEMENT_TOKEN` 的优先级高于 `data/system.json` 中保存的管理令牌。
- `PUBLIC_BASE_URL` 用于生成最终的订阅访问地址。
- `HOST` 控制服务监听地址；本机部署建议保持 `127.0.0.1`。
- `MAX_LOG_RETENTION_DAYS` 控制日志保留天数。
- `MAX_TOTAL_LOG_BYTES` 控制日志总大小上限。

## 六、生产部署建议

当前服务默认只监听 `127.0.0.1`，更推荐的部署方式是：

1. Node 服务继续只绑定本机地址。
2. 在前面加一层反向代理，例如 Nginx 或 Caddy。
3. 只对外暴露反向代理端口。
4. 配置正确的 `PUBLIC_BASE_URL`。

这样比直接暴露 Node 服务更安全。

## 七、Windows 部署示例

```powershell
npm.cmd install
$env:MANAGEMENT_TOKEN="替换成你自己的高强度管理令牌"
$env:PUBLIC_BASE_URL="https://sub.example.com/"
npm.cmd start
```

如果需要长期运行，建议使用以下方式之一：

- 任务计划程序
- NSSM
- 其他 Windows 服务包装工具

## 八、Linux 部署示例

```bash
npm install
export MANAGEMENT_TOKEN='替换成你自己的高强度管理令牌'
export PUBLIC_BASE_URL='https://sub.example.com/'
npm start
```

如果需要长期运行，建议使用：

- `systemd`
- `pm2`

## 九、Docker Compose 部署

项目已经提供以下容器文件：

- [Dockerfile](G:\code\proxy\Dockerfile)
- [docker-compose.yml](G:\code\proxy\docker-compose.yml)
- [.dockerignore](G:\code\proxy\.dockerignore)

### 1. 修改 `docker-compose.yml`

至少需要修改这两个值：

- `MANAGEMENT_TOKEN`
- `PUBLIC_BASE_URL`

例如：

```yaml
environment:
  HOST: 0.0.0.0
  PORT: 3000
  MANAGEMENT_TOKEN: change-this-to-a-long-random-token
  PUBLIC_BASE_URL: https://sub.example.com/
```

说明：

- 容器部署时必须把 `HOST` 设为 `0.0.0.0`，否则容器外无法访问服务。
- `./data:/app/data` 会把运行数据持久化到宿主机当前目录下的 `data/`。

### 2. 启动容器

```bash
docker compose up -d --build
```

### 3. 查看日志

```bash
docker compose logs -f
```

### 4. 停止容器

```bash
docker compose down
```

### 5. 更新容器

```bash
docker compose down
docker compose up -d --build
```

### 6. 访问服务

如果映射端口仍然是 `3000:3000`，则访问：

```text
http://127.0.0.1:3000/
```

如果你通过反向代理对外提供服务，应访问 `PUBLIC_BASE_URL` 对应的地址。

## 十、升级与备份

升级前建议备份以下内容：

- `data/system.json`
- `data/scripts/`
- `data/cache/`（如有需要）
- `data/output/`（如有需要）

升级流程：

```bash
git pull
npm install
npm test
npm start
```

如果是 Docker Compose 部署，则使用：

```bash
docker compose down
docker compose up -d --build
```

## 十一、安全检查项

部署前建议确认以下事项：

- 明确设置 `MANAGEMENT_TOKEN`
- 不要把 `data/` 下的运行数据提交到仓库
- 如果需要局域网或公网访问，优先通过反向代理暴露
- 非必要不要开启 `ALLOW_PRIVATE_REMOTE_SOURCES`
- 设置正确的 `PUBLIC_BASE_URL`
- 定期检查 `data/logs/` 和 `data/builds/` 的内容是否符合预期
