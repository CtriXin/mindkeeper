# Server CC Usage

## 当前 baseline

- host: `82.156.121.141`
- runtime: docker container `claude-code-official`
- host wrapper: `/usr/local/bin/cc-static`
- official version: `2.1.92`
- auth: first-party `claude.ai`
- egress lock: `168.158.184.72`

## 最小使用方法

### 1. 登录服务器

```bash
ssh root@82.156.121.141
```

### 2. 检查出口

```bash
cc-static --print-egress-ip
```

预期输出：

```text
168.158.184.72
```

如果不是这个 IP，`cc-static` 启动会直接拒绝。

### 3. 检查登录状态

```bash
cc-static auth status
```

### 4. 启动官方 cc

```bash
cc-static
```

或直接打印版本：

```bash
cc-static --version
```

## 说明

`cc-static` 已封装：

- 进入 docker 内官方 `claude`
- 强制注入固定代理
- 启动前校验出口 IP
- 出口不对则 fail-closed

## 当前边界

当前只把它作为：

- 服务器上的官方 `cc` runtime

后续本地 `MMS/cc` 对接、MCP 增强和 session 隔离，都在本目录继续开发，不直接改这个 baseline。
