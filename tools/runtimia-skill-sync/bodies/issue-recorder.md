---
name: issue-recorder
description: 按需检索历史 issue 证据或从原 Stride task 单向导出索引，不维护第二份任务状态。
---

# Issue Recorder

在原 Stride task 保存需求、结果、证据与原始 walls。需要检索旧项目/撞墙记录时读取原文与当前来源核对；历史 stage、receipt、required_checks 不恢复为新任务闸门。

需要归档时读取已安装 Stride 的 `references/recording.md`，使用 `stride evidence-export` 从原 task 单向生成索引。没有归档请求就继续当前任务，不自动启动旧 recorder、建 issue、补四份手工总结或写 xmem。

历史工具和记录仍保留。只有用户明确维护历史 recorder 时，才按实际 runtime 的 `--help` 读取其旧合同；不用历史路径猜测当前可用命令。Runtimia issue 保留来源、状态和交付链接，不复制整份 task 记录。
