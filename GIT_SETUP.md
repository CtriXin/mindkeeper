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
