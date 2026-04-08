# Context

## 强制上下文
- 用户目标：`local official Claude Code CLI + self-hosted gateway + server official runtime pool`
- 用户要求：尽量做到“一个 cc 即可”；本地复杂度尽量隐身
- 安全锚点：服务器持有真实 OAuth / runtime / static egress，服务器是唯一上游真相
- 不再把第三方 relay 当生产主路径
- 后续所有 agent 间通过仓库内文件传递，不靠聊天复制粘贴
