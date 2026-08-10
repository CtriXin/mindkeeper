# scmp-deploy (no UI)

## 作用

在不打开 SCMP 图形界面的情况下，通过接口完成：登录拿 token -> 查询服务/流水线 -> 触发 deploy。

## 文件结构

- `scripts/scmp_cli.py`：主 CLI（包含交互式 deploy）
- `scripts/scmp_api.py`：HTTP 调用与 token 文件读写
- `../bin/deploy`：全局命令入口（建议加到 PATH）

## 首次使用

1) 保存全局 SCMP 登录配置（LDAP/share_id 写入 config，密码写入 macOS Keychain）：

```bash
scmp-auth setup

# 查看状态，不会输出密码或完整 token
scmp-auth status
```

2) 执行部署（交互式输入 branch/version，可选 tag/path/DEPLOY）：

```bash
deploy <server-name>
```

## PATH 设置（zsh）

把 `/Users/xin/auto-skills/bin` 加入 PATH 后，就能在任意目录直接用 `scmp-auth`、`lookup` 和 `deploy`：

```bash
echo 'export PATH="/Users/xin/auto-skills/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```
