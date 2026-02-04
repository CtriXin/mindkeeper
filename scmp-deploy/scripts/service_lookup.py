#!/usr/bin/env python3
"""
Service/Domain Lookup Script.

1.  Asks for Service Name or Domain.
2.  If Domain: runs `rf getcf {domain}` to find the feServer (Service Name).
3.  Searches SCMP for the Service Name to get Git URL.
4.  Checks the first pipeline's current run to get the latest branch.
"""

import json
import subprocess
import sys
import os
from urllib.parse import quote

# Ensure local imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from scmp_api import SCMPApi, ensure_daily_token
except ImportError:
    print("Error: Could not import scmp_api. Make sure scmp_api.py is in the same directory.", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://scmp.adsconflux.xyz"


def _die(msg):
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def _load_token():
    # ensure_daily_token handles env vars, file loading, freshness check, and interactive login
    return ensure_daily_token(BASE_URL)


def resolve_domain(domain):
    print(f"Resolving domain: {domain}...")
    try:
        # User requested 'rf getcf {domain-name}' (converted to lower case)
        cmd = ["rf", "getcf", domain.lower()]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
             # Sometimes tools output extra text before JSON. Try to find '{'
             stdout = result.stdout
             idx = stdout.find('{')
             if idx != -1:
                 data = json.loads(stdout[idx:])
             else:
                 raise

        if not data.get("success"):
            _die(f"rf command returned error: {data.get('msg')}")

        dns_records = data.get("data", {}).get("dns", [])
        if not dns_records:
            _die(f"No DNS records found for {domain}")

        # Find first feServer
        for record in dns_records:
            fe_server = record.get("feServer")
            if fe_server:
                print(f"Found feServer: {fe_server}")
                return fe_server

        _die(f"No 'feServer' field found in DNS records for {domain}")

    except subprocess.CalledProcessError as e:
        _die(f"Failed to execute 'rf': {e}\nStderr: {e.stderr}")
    except json.JSONDecodeError:
        _die(f"Failed to parse 'rf' output as JSON.\nOutput: {result.stdout}")
    except FileNotFoundError:
        _die("'rf' command not found. Please ensure it is installed and in your PATH.")


def get_service_info(api, service_name):
    print(f"Searching for service: {service_name}...")
    keyword_q = quote(service_name)
    # Using defaults Group=FE, Project=fe as per requirements
    path = (
        "/larke-serving/api/v1/groups/FE/projects/fe/services"
        f"?group=FE&project=fe&keyword={keyword_q}&is_star=false&enable_page=true&page=1&limit=10"
    )
    resp = api.get_json(path)
    if resp.status != 200:
        _die(f"Service search failed: HTTP {resp.status} - {resp.body}")

    result = resp.body.get("result", [])
    if not isinstance(result, list):
         result = []

    if not result:
        _die(f"Service '{service_name}' not found.")

    # Pick best match (exact > shortest containing > first)
    picked = None
    for item in result:
        if str(item.get("name", "")) == service_name:
            picked = item
            break

    if not picked:
        candidates = [r for r in result if service_name in str(r.get("name", ""))]
        if candidates:
            candidates.sort(key=lambda r: len(str(r.get("name", ""))))
            picked = candidates[0]
        elif result:
            picked = result[0]

    if not picked:
        _die(f"Could not determine service for '{service_name}'")

    real_name = picked.get("name")
    if real_name != service_name:
        print(f"Selected Service: {real_name}")

    git_url = (
        picked.get("ci") or {}
    ).get("git_url")
    return real_name, git_url


def get_latest_branch(api, service_name):
    # List pipelines to get the first one
    group = "FE"
    project = "fe"

    path = (
        f"/ci/api/v2/groups/{group}/projects/{project}/services/{quote(service_name)}/pipelines"
        f"?pipelineName=&order=run_time&page=1&limit=1"
    )
    resp = api.get_json(path)
    if resp.status != 200:
        _die(f"Pipeline list failed: HTTP {resp.status}")

    result = resp.body.get("result", [])
    if not result:
        _die(f"No pipelines found for {service_name}")

    pipeline_name = result[0].get("name")

    # Get current run to find branch
    cur_path = f"/ci/api/v2/groups/{group}/projects/{project}/services/{quote(service_name)}/pipelines/{quote(pipeline_name)}/currentPipelineRun"
    resp = api.get_json(cur_path)
    if resp.status != 200:
        _die(f"currentPipelineRun failed: HTTP {resp.status}")

    # Extract branch
    body = resp.body
    res = body.get("result") or {{}}
    spec = (res.get("spec") or {{}}) if isinstance(res, dict) else {{}}
    params = spec.get("params") or []

    branch = None
    for p in params:
        if p.get("name") == "branch":
            branch = p.get("value")
            break

    return branch

def main():
    print("-" * 40)
    print("SCMP 服务/域名快速查询工具")
    print("1. 输入服务名: 直接查询 Git 地址和最新分支")
    print("2. 输入域名: 自动解析 feServer 后查询对应服务")
    print("-" * 40)
    
    print("\n请输入服务名 (如: ptc-301-gb) 或域名 (如: example.com):")
    try:
        user_input = input("> ").strip()
    except EOFError:
        return

    if not user_input:
        _die("Empty input.")

    service_name = user_input

    # Simple heuristic: if it contains a dot and no spaces, treat as domain
    if "." in user_input and " " not in user_input:
        service_name = resolve_domain(user_input)

    token = _load_token()
    api = SCMPApi(BASE_URL, token)

    real_name, git_url = get_service_info(api, service_name)
    branch = get_latest_branch(api, real_name)

    print("\n" + "=" * 40)
    print(f"Service:       {real_name}")
    print(f"Git URL:       {git_url}")
    print(f"Latest Branch: {branch}")
    print("=" * 40 + "\n")


if __name__ == "__main__":
    main()
