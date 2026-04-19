# Claude 完全隔离脚本

> 执行时直接看 [EXECUTE.md](./EXECUTE.md)

---

## 项目结构

```
claudefxxk/
├── EXECUTE.md              ⭐ 执行手册（执行时只看这个）
├── README.md               # 本文档
├── v3/                     # 当前交付（v3.7.1）
│   ├── claude-nuke-and-restore.sh      # 主脚本：清理+恢复
│   ├── backup-missing-to-safe-zone.sh  # 备份脚本
│   ├── 交付清单.md
│   ├── 差异简报-v2.md
│   └── ...
├── discussions/            # 各 Agent 讨论底稿
│   ├── gpt.md
│   ├── glm.md
│   ├── gemini.md
│   ├── qwen.md
│   └── minimax.md
├── archive/                # 历史版本和旧文档
│   ├── summary-v1.md
│   ├── summary-v2.md
│   ├── Claude清理整理报告.md
│   └── ...
├── backups/                # 脚本自动生成的备份
└── .ai/
    └── agent-release-notes.md
```

---

## 快速开始

```bash
cd v3
./backup-missing-to-safe-zone.sh     # Step 1: 备份
./claude-nuke-and-restore.sh          # Step 2: 执行（输入 ISOLATE）
```

详细步骤、检查清单、阶段说明见 [EXECUTE.md](./EXECUTE.md)。

---

## 版本

- **v3.7.1** — 当前交付，支持 DRY_RUN=1
- 迭代记录见 `.ai/agent-release-notes.md`
