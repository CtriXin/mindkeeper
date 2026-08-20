# scmp-deploy — TOMBSTONE

**已迁移 (SCMP-DEPLOY-01 / D0-4, 2026-08-20)。** Canonical home:

    git@github.com:CtriXin/scmp-deploy.git  (branch=main)

此目录曾是生产 CLI 的临时住所(zhiji feature branch + 未提交工作树文件),
现只留 tombstone:`scripts/scmp_cli.py` / `service_lookup.py` 为 redirect stub
(打印迁移指引 + exit 2),`scmp_api.py` import 即抛错。runtime 解析请走
runtime-manifest 的 `scmp_cli` 组件。
