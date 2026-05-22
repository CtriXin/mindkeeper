# cc-consult-first

`cc-consult-first` 是一个 consult-first 的最小本地 client。

目标不是把远端官方 `Claude Code` 当成本地主进程，而是把它收成：

- 本地国产 LLM / 本地 `cc` 随时可调用的 `consult brain`
- 明确带 `device_id / workspace_id / session_id` 的 sticky consult lane
- 可先独立落地，不阻塞完整 `Broker + Local Runner` 主线

## 当前命令

- `npm run doctor`
  - 检查环境变量和当前隔离键
- `npm run consult -- "你的问题"`
  - 走远端 `POST /v1/chat/completions` 或 `POST /v1/responses`
- `npm run session:state -- --session demo-1`
  - 查看当前 sticky session 状态
- `npm test`
  - 跑最小单测

## 环境变量

```bash
export CC_CONSULT_BASE_URL='http://23.95.30.199:28082'
export CC_CONSULT_BEARER_TOKEN='YOUR_TOKEN'
export CC_CONSULT_MODEL='claude-opus-4-6'
export CC_CONSULT_DEVICE_ID='mac'
export CC_CONSULT_WORKSPACE_ID='company'
export CC_CONSULT_SESSION_ID='demo-001'
```

说明：

- `CC_CONSULT_BASE_URL` 可以直接填 service root，也可以填 `/consult_opus` 或 `/v1/chat/completions`，程序会自动收口到 root。
- 默认 endpoint 是 `chat.completions`。
- 同一轮 consult 想保持 sticky，就固定 `device/workspace/session`。
- 如果当前目录没有显式设置环境变量，程序会自动尝试读取：
  - `./.env.local`
  - `../cc-mcp-bridge/.env.local`

## 开箱即用

如果你的 sibling `cc-mcp-bridge/` 里已经有可用的 `.env.local`，现在可以直接运行：

```bash
npm run doctor
npm run consult -- "请先用一句话判断 remote consult 现在是否可用"
```

## 最短示例

```bash
npm run consult -- "请用 consult 方式分析这个报错"
```

如果想把较长上下文单独放文件里：

```bash
npm run consult -- --context-file ./tmp/context.md "请先给结论，再给三条判断依据"
```
