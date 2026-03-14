# ClashMerge

ClashMerge 是一个个人使用的 Clash 订阅管理器，用来统一管理多个订阅源、合并节点、执行自定义 JavaScript 处理逻辑，并生成新的 Clash YAML 订阅。

## 主要功能

- 管理多个 Clash 订阅源
- 支持远程订阅、本地 YAML、内联 YAML 导入
- 合并多个订阅并去重节点
- 使用 JavaScript 自定义订阅生成逻辑
- 支持顶部配置块自定义最终 YAML 顶层字段
- 自动调度刷新与构建
- 生成受保护的订阅链接
- 提供本地 Web 管理界面
- 支持 Docker Compose 部署

## 项目结构

```text
src/        后端核心逻辑
public/     前端页面
docs/       产品、脚本与部署文档
tests/      测试夹具
scripts/    本地测试脚本
data/       运行数据目录（已忽略，不进仓库）
```

## 快速启动

```powershell
npm.cmd install
npm.cmd start
```

打开：

```text
http://127.0.0.1:3000/
```

## Docker Compose

```bash
docker compose up -d --build
```

首次启动会自动生成随机管理令牌并写入 `data/system.json`。只有在你明确需要固定管理令牌时，才建议设置 `MANAGEMENT_TOKEN` 环境变量覆盖它。

默认配置见：

- [docker-compose.yml](./docker-compose.yml)
- [Dockerfile](./Dockerfile)

## 文档

- [部署说明](./docs/DEPLOYMENT.md)
- [脚本编写说明](./docs/SCRIPTING.md)
- [产品需求文档](./docs/PRD.md)

## 安全说明

- 管理页面与 `/api/*` 需要管理令牌
- 最终订阅链接使用独立订阅令牌保护
- `data/` 目录属于运行态数据，不应提交到仓库
- 推荐通过反向代理对外暴露服务，而不是直接公开 Node 端口

## 当前状态

当前仓库已实现 MVP 主链路：

- 订阅源管理
- 脚本处理
- 配置构建
- 调度刷新
- 日志查看
- 安全加固
- 容器部署

