# scmp-deploy (no UI)

## 作用

在不打开 SCMP 图形界面的情况下，通过接口完成：登录拿 token -> 查询服务/流水线 -> 触发 deploy。

## 文件结构

- `scripts/scmp_cli.py`：主 CLI（包含交互式 deploy）
- `scripts/scmp_api.py`：HTTP 调用与 token 文件读写
- `../bin/deploy`：全局命令入口（建议加到 PATH）

## 首次使用

1) 登录（会保存 token 到 `~/.scmp_token.json`，不会保存密码）：

```bash
python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py login --share-id "<share_id>" --prompt-password

# 如需明文输入密码(可见/有回显):
# python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py login --plain-password --share-id "<share_id>" --prompt-password
# 或设置 env: SCMP_PLAIN_PASSWORD=1
```

2) 执行部署（交互式输入 branch/version，可选 tag/path/DEPLOY）：

```bash
deploy <server-name>
```

## PATH 设置（zsh）

把 `/Users/xin/auto-skills/bin` 加入 PATH 后，就能在任意目录直接用 `deploy`：

```bash
echo 'export PATH="/Users/xin/auto-skills/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```
