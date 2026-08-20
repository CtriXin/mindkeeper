#!/usr/bin/env python3
"""TOMBSTONE (SCMP-DEPLOY-01 / D0-4, 2026-08-20).

本文件不再是生产 SCMP CLI。canonical home 已迁至:

    git@github.com:CtriXin/scmp-deploy.git  (scripts/scmp_cli.py, branch=main)

runtime 解析走 runtime-manifest 的 scmp_cli 组件;不要再从 zhiji  checkout 调用。
"""
import sys

print(
    "FATAL: scmp_cli.py 已迁移至 CtriXin/scmp-deploy (scripts/scmp_cli.py)。\n"
    "zhiji 旧路径已退役(SCMP-DEPLOY-01 / D0-4 tombstone)。\n"
    "请经 runtime-manifest scmp_cli 组件解析 canonical 入口。",
    file=sys.stderr,
)
sys.exit(2)
