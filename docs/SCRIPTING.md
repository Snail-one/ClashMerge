# Clash 脚本开发文档

本文档面向给本项目编写订阅处理脚本的开发者。当前生效脚本文件是 `data/scripts/default.js`，系统在每次手动构建或自动调度构建时都会执行它。

## 1. 执行时机

脚本会在以下场景执行：

- 页面点击“立即构建”
- 调用 `POST /api/build`
- 自动调度触发构建
- 命令行执行 `npm.cmd run build`

执行顺序固定为：

`拉取订阅 -> 解析 YAML -> 合并节点 -> 生成默认分组 -> 执行 transform -> 输出最终 YAML`

## 2. 最小脚本模板

```js
function transform(config, context) {
  return config;
}

module.exports = { transform };
```

要求：

- 必须导出 `transform`
- 必须返回一个对象
- 推荐直接修改并返回 `config`
- 不要依赖文件系统、网络或 Node 内置模块

## 3. `config` 结构

进入脚本时，`config` 已经是合并后的 Clash 配置对象：

```js
{
  mixedPort: 7890,
  allowLan: true,
  mode: "rule",
  logLevel: "info",
  ipv6: true,
  proxies: [],
  "proxy-groups": [],
  rules: []
}
```

### 3.1 `config.proxies`

每个节点示例：

```js
{
  name: "HK-A",
  type: "ss",
  server: "hk.example.com",
  port: 443,
  cipher: "aes-128-gcm",
  password: "pass",
  __meta: {
    sourceId: "src_xxx",
    sourceName: "机场A"
  }
}
```

说明：

- `__meta` 是系统附加的来源信息，方便按来源过滤或重命名
- 最终输出 YAML 时，`__meta` 会被自动移除

### 3.2 `config["proxy-groups"]`

脚本执行前，系统已经自动生成默认分组：

- `节点选择`
- `自动选择`
- `全部节点`
- `香港节点` / `日本节点` / `新加坡节点` / `美国节点`（命中时才生成）

你可以直接覆盖整个 `proxy-groups`，也可以在现有基础上增删。

## 4. `context` 结构

```js
{
  generatedAt: "2026-03-14T10:00:00.000Z",
  sourceCount: 3,
  errors: [],
  reason: "manual"
}
```

字段说明：

- `generatedAt`：本次生成时间
- `sourceCount`：启用订阅数量
- `errors`：拉取失败的订阅错误列表
- `reason`：触发来源，可能是 `manual` 或 `scheduler`

## 5. 常见写法

### 5.1 过滤指定地区节点

```js
function transform(config) {
  config.proxies = config.proxies.filter(proxy =>
    proxy.name.includes("HK") || proxy.name.includes("SG")
  );
  return config;
}

module.exports = { transform };
```

### 5.2 给节点加来源前缀

```js
function transform(config) {
  config.proxies = config.proxies.map(proxy => ({
    ...proxy,
    name: `[${proxy.__meta.sourceName}] ${proxy.name}`
  }));
  return config;
}

module.exports = { transform };
```

### 5.3 只保留某个订阅源的节点

```js
function transform(config) {
  config.proxies = config.proxies.filter(proxy =>
    proxy.__meta.sourceName === "机场A"
  );
  return config;
}

module.exports = { transform };
```

### 5.4 重建代理组

```js
function transform(config) {
  const all = config.proxies.map(proxy => proxy.name);
  const hk = config.proxies
    .filter(proxy => proxy.name.includes("HK"))
    .map(proxy => proxy.name);

  config["proxy-groups"] = [
    {
      name: "节点选择",
      type: "select",
      proxies: ["自动选择", "香港节点", ...all]
    },
    {
      name: "自动选择",
      type: "url-test",
      url: "http://www.gstatic.com/generate_204",
      interval: 300,
      proxies: all
    },
    {
      name: "香港节点",
      type: "select",
      proxies: hk
    }
  ];

  return config;
}

module.exports = { transform };
```

## 6. 推荐约定

推荐把脚本写成三个阶段：

1. 过滤节点
2. 统一改名
3. 重建分组

例如：

```js
function transform(config) {
  const proxies = config.proxies
    .filter(proxy => proxy.name.includes("HK") || proxy.name.includes("JP"))
    .map(proxy => ({
      ...proxy,
      name: `${proxy.__meta.sourceName} | ${proxy.name}`
    }));

  config.proxies = proxies;
  config["proxy-groups"] = [
    {
      name: "节点选择",
      type: "select",
      proxies: proxies.map(proxy => proxy.name)
    }
  ];

  return config;
}

module.exports = { transform };
```

## 7. 注意事项

- 节点改名后，代理组里必须使用改名后的名称
- 如果你过滤了 `proxies`，最好同步调整 `proxy-groups`
- 节点名称应保持唯一，否则客户端体验会很差
- 脚本运行在 `vm` 沙箱里，超时约 1 秒
- 脚本报错会直接导致本次构建失败

## 8. 调试建议

建议开发脚本时按这个顺序：

1. 先只打印日志，不改结构
2. 再做节点过滤
3. 最后再重建代理组

可直接在脚本里使用：

```js
console.log(config.proxies.length);
console.log(context);
```

## 9. 当前限制

- 当前只支持一个默认脚本：`data/scripts/default.js`
- 暂时没有多脚本方案切换
- 暂时没有脚本单独试运行接口
- 自动调度与手动构建都会执行同一份脚本

## 10. 建议开发流程

1. 在页面里编辑脚本
2. 点击“保存脚本”
3. 手动点一次“立即构建”验证结果
4. 查看页面中的 YAML 输出和构建状态
5. 确认没问题后再依赖自动调度
