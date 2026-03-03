# Git 配置与安全指南

此文档记录了本项目的 Git 仓库配置、推送逻辑以及安全隔离措施。

---

## 1. 仓库信息
- **GitHub 远程地址**: `https://github.com/CtriXin/agent-skills.git`
- **主要分支**: `main`

## 2. 安全隔离与隐私保护

为了防止公司敏感信息泄露到公网，本项目使用了 `.gitignore` 进行严格隔离：

| 文件夹/文件 | 处理逻辑 | 原因 |
| :--- | :--- | :--- |
| `scmp-deploy/` | **仅本地版本控制** | 包含公司内部部署逻辑和 URL |
| `node_modules/` | 排除 | 标准依赖项 |
| `__pycache__` | 排除 | Python 缓存 |
| `.DS_Store` | 排除 | macOS 系统文件 |

> [!IMPORTANT]
> **本地与远程的区别**：
> 虽然 `scmp-deploy/` 被忽略（不会上传到 GitHub），但它在本地 Git 中仍然有版本历史。你可以通过 `git status` 看到它，但 `git push` 不会带走它。

---

## 3. SSH 配置方法 (免密推送)

如果当前使用 HTTPS 需要频繁输入密码，推荐切换到 SSH：

### 第一步：检查并生成 SSH Key
```bash
# 检查是否存在旧的密钥
ls -al ~/.ssh

# 生成新密钥 (如果需要)
ssh-keygen -t ed25519 -C "your_email@example.com"
```

### 第二步：添加公钥到 GitHub
1. 执行 `pbcopy < ~/.ssh/id_ed25519.pub` 复制公钥。
2. 登录 GitHub → **Settings** → **SSH and GPG keys** → **New SSH key**。
3. 粘贴并保存。

### 第三步：切换仓库链接
```bash
git remote set-url origin git@github.com:CtriXin/agent-skills.git
```

---

## 4. 日常操作命令汇总

### 提交更新
```bash
git add .
git commit -m "更新说明"
git push
```

### 查看历史与对比
```bash
# 查看简洁历史
git log --oneline

# 对比改动（确认 AI 是否改错敏感文件）
git diff HEAD^
```

### 回滚敏感目录
即便 `scmp-deploy/` 没在远程，本地依然可以找回：
```bash
git checkout <commit-id> -- scmp-deploy/
```

---

## 5. 实施记录 (Implementation Plan)
本次配置由 AI (Antigravity) 协助完成：
- **日期**: 2026-02-06
- **操作项**: 初始化 Git、配置 `.gitignore`、添加远程 origin、完成首次推送。

## 6. Worktree 管理工具 (`bin/wt`)

我们提供了一个交互式的 `bin/wt` 脚本，用于快捷管理 Git worktree，并支持保存中文描述。

### 主要功能

- **`wt`** (或 `wt create`): 交互式建立 worktree。
  - 支持模糊搜索分支（按提交时间降序，优先显示最近的分支）
  - **支持键盘 `↑` / `↓` 箭头选择分支**，按回车确认。
  - **自动冲突处理**：若分支已被占用，自动递增 `_wt_N` 后缀（如 `main_wt_1`）创建新分支，无需手动改名。
  - 自动在当前项目父目录生成规范的 worktree 目录 (`项目名--自定义名`)
  - 支持输入简短描述（如 "修复登录缺陷"）
- **`wt branch`**: 查看分支，按最后提交时间倒序排列。
- **`wt list`**: 查看所有 worktree，并显示对应的描述信息。
- **`wt remove`**: 交互式安全移除 worktree 并清理元数据。
- **`wt -h`**: 查看完整的帮助信息。

> [!TIP]
> **描述信息存储在哪？**
> `wt` 脚本会在仓库根目录生成 `.worktree-meta.json` 文件用于存储自定义描述，此文件已在 `.gitignore` 配置中忽略，不会提交到远程。
>
> **详细开发日志 (Walkthrough)**
> 关于此脚本开发过程的技术文档与变更日志，请参阅：
> [📜 2026-03-03 开发日志 (docs/changelog/2026-03-03.md)](docs/changelog/2026-03-03.md)
> 更多文档见：[📚 项目知识库 (docs/README.md)](docs/README.md)
