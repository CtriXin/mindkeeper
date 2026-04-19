# Claude CLI 固定美国出口 + 进程级 LANG/TZ
# 说明：
# - 127.0.0.1:31001 是本地 SSH tunnel，到 Phoenix(129.146.32.12) 的远端 41001
# - 当前优先尝试 Oracle relay route 1；不可用时回退到 Clash HTTP
# - 故意不直连，避免在错误出口下启动 Claude
# ============================================
CLAUDE_PROXY_PRIMARY="http://127.0.0.1:31001"
CLAUDE_PROXY_PRIMARY_LABEL="Oracle relay via SSH (route 1)"
CLAUDE_PROXY_FALLBACK="http://127.0.0.1:7897"
CLAUDE_PROXY_FALLBACK_LABEL="Clash HTTP"
CLAUDE_WORK_TZ=""
CLAUDE_PROXY_SNAPSHOT_FILE="${HOME}/.cache/claude-proxy-snapshot.env"

_pick_claude_proxy() {
    local proxy="$1"
    local label="$2"
    local ip

    ip=$(curl -sS -x "${proxy}" --connect-timeout 3 --max-time 6 https://api.ipify.org 2>/dev/null || true)
    if [[ -n "${ip}" ]]; then
        REPLY="${proxy}|${label}|${ip}"
        return 0
    fi

    return 1
}

_claude_ip_context() {
    local ip="$1"

    command -v python3 >/dev/null 2>&1 || return 1

    python3 - "$ip" <<'PY' 2>/dev/null
import json
import sys
import urllib.request

ip = sys.argv[1]
with urllib.request.urlopen(f"http://ip-api.com/json/{ip}?fields=timezone,city,regionName,country", timeout=4) as resp:
    data = json.load(resp)

print(data.get("timezone", ""))
print(data.get("city", ""))
print(data.get("regionName", ""))
print(data.get("country", ""))
PY
}

_claude_load_snapshot() {
    local file="$1"

    [[ -f "${file}" ]] || return 1
    source "${file}"
}

_claude_save_snapshot() {
    local file="$1"
    local ip="$2"
    local timezone="$3"
    local location="$4"
    local proxy="$5"
    local proxy_label="$6"

    mkdir -p "${file:h}"
    {
        printf 'CLAUDE_LAST_IP=%q\n' "${ip}"
        printf 'CLAUDE_LAST_IP_TZ=%q\n' "${timezone}"
        printf 'CLAUDE_LAST_GEO=%q\n' "${location}"
        printf 'CLAUDE_LAST_PROXY=%q\n' "${proxy}"
        printf 'CLAUDE_LAST_PROXY_LABEL=%q\n' "${proxy_label}"
    } >| "${file}"
}

claude() {
    local picked proxy proxy_label ip key timezone city region country ip_time location snapshot_status
    local prev_ip prev_ip_tz
    local -a geo_lines

    # 1) 检查代理可用性
    if _pick_claude_proxy "${CLAUDE_PROXY_PRIMARY}" "${CLAUDE_PROXY_PRIMARY_LABEL}"; then
        picked="${REPLY}"
    elif _pick_claude_proxy "${CLAUDE_PROXY_FALLBACK}" "${CLAUDE_PROXY_FALLBACK_LABEL}"; then
        picked="${REPLY}"
    else
        echo "[Claude] 没找到可用的 HTTP proxy。"
        echo "[Claude] 已尝试:"
        echo "  - ${CLAUDE_PROXY_PRIMARY} (${CLAUDE_PROXY_PRIMARY_LABEL})"
        echo "  - ${CLAUDE_PROXY_FALLBACK} (${CLAUDE_PROXY_FALLBACK_LABEL})"
        echo "[Claude] 为避免直连污染，本次不启动。"
        return 1
    fi

    proxy="${picked%%|*}"
    picked="${picked#*|}"
    proxy_label="${picked%%|*}"
    ip="${picked##*|}"

    # 2) 根据 IP 查 TZ
    geo_lines=("${(@f)$(_claude_ip_context "${ip}")}")
    timezone="${geo_lines[1]}"
    [[ -z "${timezone}" ]] && timezone="America/Los_Angeles"

    # 3) 读取快照，对比
    snapshot_status="NEW"
    if _claude_load_snapshot "${CLAUDE_PROXY_SNAPSHOT_FILE}"; then
        prev_ip="${CLAUDE_LAST_IP:-}"
        prev_ip_tz="${CLAUDE_LAST_IP_TZ:-}"
        if [[ "${prev_ip}" == "${ip}" && "${prev_ip_tz}" == "${timezone}" ]]; then
            snapshot_status="MATCH"
        else
            snapshot_status="CHANGED"
        fi
    fi

    # 4) 获取时间（本地 + TZ 对应）
    local local_time=$(date "+%m.%d %H:%M:%S")
    local tz_time=$(TZ="${timezone}" date "+%m.%d %H:%M:%S")

    if [[ "${snapshot_status}" == "MATCH" ]]; then
        # 一致：只显示 IP、TZ、两个时间，跳过检验
        echo "[Claude] IP: ${ip}"
        echo "[Claude] TZ: ${timezone}"
        echo "[Claude] localTime: ${local_time}"
        echo "[Claude] tzTime: ${tz_time}"
    else
        # 不一致/首次：显示完整信息，保存快照
        city="${geo_lines[2]}"
        region="${geo_lines[3]}"
        country="${geo_lines[4]}"
        location="${city}"
        [[ -n "${region}" ]] && location+="${location:+, }${region}"
        [[ -n "${country}" ]] && location+="${location:+, }${country}"
        [[ -z "${location}" ]] && location="unknown"

        echo "[Claude] Proxy: ${proxy} (${proxy_label})"
        echo "[Claude] IP: ${ip}"
        echo "[Claude] TZ: ${timezone}"
        echo "[Claude] Local time: ${local_time}"
        echo "[Claude] TZ time: ${tz_time}"
        echo "[Claude] Geo: ${location}"
        if [[ "${snapshot_status}" == "CHANGED" ]]; then
            echo "[Claude] 变化: ${prev_ip:-无} (${prev_ip_tz:-无}) -> ${ip} (${timezone})"
        fi
        echo "[Claude] 已更新快照"

        _claude_save_snapshot "${CLAUDE_PROXY_SNAPSHOT_FILE}" "${ip}" "${timezone}" "${location}" "${proxy}" "${proxy_label}"
    fi

    echo ""
    printf "按回车启动 Claude，ESC 退出..."
    read -k 1 key
    echo ""

    if [[ "$key" == $'\e' ]]; then
        echo "已取消"
        return 1
    fi

    # 启动：TZ 始终使用 IP 对应的 timezone
    env -u ALL_PROXY -u all_proxy \
        HTTP_PROXY="${proxy}" \
        HTTPS_PROXY="${proxy}" \
        http_proxy="${proxy}" \
        https_proxy="${proxy}" \
        NO_PROXY="127.0.0.1,localhost,::1" \
        no_proxy="127.0.0.1,localhost,::1" \
        TZ="${timezone}" \
        LANG="en_US.UTF-8" \
        LC_ALL="en_US.UTF-8" \
