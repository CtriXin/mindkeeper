# Agent Alignment Checklist

把下面内容发给另一个 agent，对齐是否冲突。

## 1. 共同前置

- 是否都建立在同一个 server-side official `cc` baseline 之上？
- 是否都默认服务器入口是 `cc-static`？
- 是否都不打算改坏当前 official `cc` baseline？

## 2. 主架构判断

请明确你的方案属于哪一类：

- `MCP-first enhancement`
- `Broker + Local Runner`
- `API relay`
- `ssh/tmux shell`
- 其他

## 3. 关键边界

请明确是否会碰下面任一项：

- 服务器 official `cc` runtime 本体
- 服务器 OAuth/auth 存储方式
- 本地 `MMS/cc` 启动入口
- 本地文件读写/命令执行权限模型
- `device_id/workspace_id/session_id` 语义
- `mac/macmini` 隔离
- `company/personal` 隔离

## 4. 如果你的方案是 Broker 类

请回答：

- `new session` 是否等价远端新 session？
- tool execution 在本地还是在服务器？
- `url + device_key` 的职责是什么？
- 是否计划按设备统计？

## 5. 冲突点快速判断

如果你的方案出现下面任一条，请标出来：

- 要把自己的 session 语义声明成唯一真相源，并覆盖另一条线
- 要改 server baseline 才能成立
- 要把本地执行改成服务器执行
- 要复用 `newapi/CRS`
- 要让多设备共享同一 live session writer
- 要改现有 `device/workspace/session` 主键语义
- 要重复建设一整套已经存在的 chat/stream/auth/logging 服务层
- 要绕过 runner advertise 的 capability / `writable_scope`

## 5.1 默认值核对

- 你的默认 `workspace_id` 是什么？
- 是否和 `personal/company` 的另一侧默认值不同？
- 联调时是否会显式传入 `workspace_id`，避免误判为 session 串味？

## 6. 你准备先做什么

请给出：

- 第一阶段目标
- 需要改的目录
- 会不会影响主线
