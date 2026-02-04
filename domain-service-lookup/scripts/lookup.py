#!/usr/bin/env python3
import sys
import subprocess
import os
import json
import re

# Configuration / 配置
SERVICE_LOOKUP_SCRIPT = "/Users/xin/auto-skills/scmp-deploy/scripts/service_lookup.py"
SEARCH_ROOT = "/Users/xin"

def run_service_lookup(domain):
    """Runs the external service lookup script. / 运行外部服务查询脚本。"""
    cmd = [sys.executable, SERVICE_LOOKUP_SCRIPT]
    try:
        # Pipe the domain as input / 将域名作为输入传递
        process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate(input=f"{domain}\n")
        
        if process.returncode != 0:
            print(f"Error running service lookup (运行服务查询出错): {stderr}")
            sys.exit(1)
            
        return stdout
    except Exception as e:
        print(f"Failed to run service lookup (运行服务查询失败): {e}")
        sys.exit(1)

def parse_lookup_output(output):
    """Extracts Service, Git URL, and Branch from output. / 从输出中提取服务名、Git URL 和分支。"""
    service = None
    branch = None
    git_url = None
    
    for line in output.splitlines():
        if line.startswith("Service:"):
            service = line.split(":", 1)[1].strip()
        elif line.startswith("Latest Branch:"):
            branch = line.split(":", 1)[1].strip()
        elif line.startswith("Git URL:"):
            git_url = line.split(":", 1)[1].strip()
            
    return service, branch, git_url

def get_git_remote_url(repo_path):
    """Gets the remote origin URL of a git repo. / 获取 git 仓库的远程 origin URL。"""
    try:
        result = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"], 
            cwd=repo_path, 
            capture_output=True, 
            text=True
        )
        return result.stdout.strip()
    except:
        return None

def normalize_git_url(url):
    """Normalizes Git URL for comparison. / 标准化 Git URL 以进行比较。"""
    if not url: 
        return ""
    # Remove .git suffix / 移除 .git 后缀
    if url.endswith(".git"):
        url = url[:-4]
    # Remove protocol prefix (http://, https://, git@) / 移除协议前缀
    url = re.sub(r'^(https?://|git@)', '', url)
    # Replace : with / for ssh style (github.com:user/repo -> github.com/user/repo)
    url = url.replace(':', '/')
    return url.strip()

def find_repo_by_git_url(target_git_url):
    """Finds the repo directory by checking git remotes. / 通过检查 git remote 查找仓库目录。"""
    print(f"🔎 Searching for local repo matching git url: {target_git_url} (正在搜索匹配 git url 的本地仓库)")
    
    normalized_target = normalize_git_url(target_git_url)
    
    # 1. First try simple name match (optimization) / 首先尝试简单的名称匹配（优化）
    # Use 'find' to get candidate directories / 使用 'find' 获取候选目录
    # -maxdepth 2 should cover standard layouts like /Users/xin/repo-name
    cmd = ["find", SEARCH_ROOT, "-maxdepth", "2", "-type", "d", "-name", ".git"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        git_dirs = result.stdout.strip().splitlines()
        
        for git_dir in git_dirs:
            repo_path = os.path.dirname(git_dir)
            remote_url = get_git_remote_url(repo_path)
            
            if remote_url:
                normalized_remote = normalize_git_url(remote_url)
                # Check if target is part of remote or vice versa to be safe
                # usually exact match after normalization is best
                if normalized_target in normalized_remote or normalized_remote in normalized_target:
                     return repo_path
    except Exception as e:
        print(f"Error finding repo (查找仓库出错): {e}")

    return None

def extract_ts_config(file_path, domain):
    """Extracts configuration from web-configs.ts. / 从 web-configs.ts 提取配置。"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            
        # Looking for 'domain.com': { ... }
        # simplified approach: find line with domain, then iterate to count braces
        # 寻找 'domain.com': { ... } 
        # 简化方法：找到包含域名的行，然后迭代计数括号
        
        # Try different quote styles / 尝试不同的引号样式
        p1 = f"'{domain}': {{ "
        p2 = f'"{domain}": {{'
        p3 = f"'{domain}':{{ "
        p4 = f'"{domain}":{{'

        start_idx = content.find(p1)
        if start_idx == -1:
            start_idx = content.find(p2)
        if start_idx == -1:
             start_idx = content.find(p3)
        if start_idx == -1:
             start_idx = content.find(p4)

            
        if start_idx == -1:
            return None
            
        # Move to the first opening brace / 移动到第一个左大括号
        brace_start = content.find('{', start_idx)
        
        brace_count = 0
        end_idx = -1
        
        for i in range(brace_start, len(content)):
            if content[i] == '{':
                brace_count += 1
            elif content[i] == '}':
                brace_count -= 1
                
            if brace_count == 0:
                end_idx = i + 1
                break
                
        if end_idx != -1:
            raw_obj = content[start_idx:end_idx]
            return raw_obj
            
    except Exception as e:
        print(f"Error reading config file (读取配置文件出错): {e}")
    return None

def main():
    if len(sys.argv) < 2:
        print("Usage: lookup.py <domain> / 用法: lookup.py <域名>")
        sys.exit(1)
        
    domain = sys.argv[1]
    
    print(f"🔍 Looking up service for {domain}... (正在查找 {domain} 的服务...)")
    output = run_service_lookup(domain)
    service, branch, git_url = parse_lookup_output(output)
    
    if not service or not branch:
        print("❌ Could not determine service or branch. (无法确定服务或分支)")
        # Print a snippet of output to help debug / 打印部分输出以帮助调试
        print(output[:500])
        sys.exit(1)
        
    print(f"✅ Found Service (找到服务): {service}")
    print(f"✅ Target Branch (目标分支): {branch}")
    print(f"✅ Git URL (Git 地址): {git_url}")
    
    repo_path = None
    if git_url:
        repo_path = find_repo_by_git_url(git_url)
    
    # Fallback to name search if git url search failed (just in case)
    if not repo_path:
        print("⚠️ Git URL search failed, falling back to name search... (Git URL 搜索失败，回退到名称搜索...)")
        # Reuse old find logic inline here for fallback
        cmd = ["find", SEARCH_ROOT, "-maxdepth", "3", "-type", "d", "-name", service]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            paths = res.stdout.strip().splitlines()
            if paths:
                repo_path = paths[0]
        except:
            pass

    if not repo_path:
        print(f"❌ Local repository for {service} not found in {SEARCH_ROOT} (在 {SEARCH_ROOT} 中未找到 {service} 的本地仓库)")
        sys.exit(1)
        
    print(f"📂 Repo found at (仓库位置): {repo_path}")
    
    # Git Checkout
    print(f"🔄 Switching to branch {branch}... (正在切换到分支 {branch}...)")
    subprocess.run(["git", "checkout", branch], cwd=repo_path, check=False) 
    
    # Config Lookup
    print(f"🔎 Searching for configuration... (正在搜索配置...)")
    
    found = False
    
    # 1. Try JSON
    try:
        grep_cmd = ["grep", "-r", "-l", domain, ".", "--include=*.json"]
        grep_res = subprocess.run(grep_cmd, cwd=repo_path, capture_output=True, text=True)
        
        if grep_res.stdout:
            json_files = grep_res.stdout.strip().splitlines()
            for jf in json_files:
                print(f"📄 Found in JSON file (在 JSON 文件中找到): {jf}")
                try:
                    with open(os.path.join(repo_path, jf), 'r') as f:
                        data = json.load(f)
                        print(json.dumps(data, indent=2))
                        found = True
                except:
                    print("Error reading JSON file (读取 JSON 文件出错).")
    except Exception:
        pass

    if found:
        return

    # 2. Try web-configs.ts
    ts_config_path = os.path.join(repo_path, "app/web-configs.ts")
    if os.path.exists(ts_config_path):
        config_content = extract_ts_config(ts_config_path, domain)
        if config_content:
            print("\n📜 Configuration Found (extracted from web-configs.ts) (在 web-configs.ts 中找到配置):")
            print(config_content)
            found = True

    if not found:
        print("⚠️ Configuration not found in standard locations (*.json or app/web-configs.ts). (在标准位置 *.json 或 app/web-configs.ts 中未找到配置)")

if __name__ == "__main__":
    main()
