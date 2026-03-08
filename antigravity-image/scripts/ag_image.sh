#!/usr/bin/env bash
set -euo pipefail

DEFAULT_BIN="/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity"
SMART_CROP_ASPECT=""

usage() {
  cat <<'EOF'
用法:
  ag_image.sh [选项] "图片需求"
  echo "图片需求" | ag_image.sh [选项]
  ag_image.sh --fetch-latest [选项]
  ag_image.sh --watch [选项]

选项:
  --out PATH           期望的输出文件路径。脚本会把它写进 prompt。
  --mode MODE          Antigravity chat 模式，默认 ask。
  --add-file PATH      给 chat 追加上下文文件，可重复传。
  --profile NAME       指定 Antigravity profile。
  --restart-antigravity 先退出并重启 Antigravity，再发起 chat。
  --restart-wait SEC   重启后等待 Antigravity 稳定的秒数，默认 12。
  --ready-timeout SEC  启动后等待账号进入可用状态的秒数，默认 30。
  --gui-send-delay SEC chat 窗口拉起后，再等待多少秒进行 GUI 粘贴，默认 4。
  --no-restore-front-app 发送后不要切回原前台应用。
  --keep-antigravity-front 与 --no-restore-front-app 等价，发送后保持 Antigravity 在前台。
  --send-via-gui       不走 chat 注入，改为激活 Antigravity 后直接粘贴并发送 prompt。
  --new-window         在新窗口里打开 chat。
  --reuse-window       复用最近活动窗口，默认行为。
  --maximize           最大化 chat 视图。
  --raw                不包模板，直接把用户 prompt 传给 Antigravity。
  --fetch-latest       不打开 IDE，只抓最近生成的图片。
  --watch              从现在开始监听，直到发现新图片。
  --no-fetch           发 prompt 后不自动抓图。
  --timeout SEC        监听超时秒数，默认 300。
  --settle-sec SEC     发现首张新图后，再等待多少秒静默期以拿到最后一张，默认 25。
  --smart-crop-aspect RATIO 生成后按边框智能裁成目标比例，例如 3:4 或 16:9。
  --lookback-sec SEC   抓最近图片时回看多少秒，默认 1800。
  --dry-run            只打印最终命令和 prompt，不启动 Antigravity。
  --bin PATH           手动指定 antigravity 可执行文件。
  -h, --help           查看帮助。

示例:
  ag_image.sh --out ~/Pictures/poster.png "做一张中文海报，文字清晰可读"
  ag_image.sh --add-file /abs/brief.md "根据 brief 生成小红书封面"
  ag_image.sh --out ~/Pictures/poster.png "做一张中文海报，标题是春季上新"
  ag_image.sh --fetch-latest --out ~/Pictures/poster.png
  ag_image.sh --watch --out ~/Pictures/poster.png --timeout 600
  echo "做一张科技风 banner" | ag_image.sh --dry-run
EOF
}

fail() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

resolve_bin() {
  local manual_bin="${1:-}"
  if [[ -n "$manual_bin" ]]; then
    [[ -x "$manual_bin" ]] || fail "指定的 Antigravity 可执行文件不存在或不可执行: $manual_bin"
    printf '%s\n' "$manual_bin"
    return
  fi

  if command -v antigravity >/dev/null 2>&1; then
    command -v antigravity
    return
  fi

  if [[ -x "$DEFAULT_BIN" ]]; then
    printf '%s\n' "$DEFAULT_BIN"
    return
  fi

  fail "未找到 antigravity CLI。请安装 Antigravity IDE，或用 --bin 指定路径。"
}

default_capture_path() {
  local ext="$1"
  printf '/tmp/ag_capture_%s.%s\n' "$(date +%Y%m%d-%H%M%S)" "$ext"
}

copy_image_to_output() {
  local src="$1"
  local dest="${2:-}"
  local src_ext="${src##*.}"
  local dest_ext=""
  local adjusted_dest=""
  local src_ext_lc=""
  local dest_ext_lc=""

  src_ext_lc="$(printf '%s' "$src_ext" | tr '[:upper:]' '[:lower:]')"

  if [[ -z "$dest" ]]; then
    dest="$(default_capture_path "$src_ext")"
  else
    dest_ext="${dest##*.}"
    dest_ext_lc="$(printf '%s' "$dest_ext" | tr '[:upper:]' '[:lower:]')"
    if [[ "$dest" == *.* && "$dest_ext_lc" != "$src_ext_lc" ]]; then
      adjusted_dest="${dest%.*}.$src_ext"
      printf '输出扩展名与真实图片格式不一致，已调整为: %s\n' "$adjusted_dest"
      dest="$adjusted_dest"
    fi
  fi

  cp "$src" "$dest"
  if [[ -n "$SMART_CROP_ASPECT" ]]; then
    smart_crop_output_image "$dest" "$SMART_CROP_ASPECT"
  fi
  printf '已获取图片: %s\n' "$dest"
}

smart_crop_output_image() {
  local path="$1"
  local ratio="$2"
  local crop_script="/Users/xin/auto-skills/antigravity-image/scripts/crop_center_panel.py"
  local tmp_output=""
  local log_file=""
  local ext=""

  [[ -f "$crop_script" ]] || {
    printf '提示: 未找到智能裁剪脚本，保留原图。\n' >&2
    return 0
  }

  ext="${path##*.}"
  ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$ext" || "$ext" == "$path" ]]; then
    ext="png"
  fi
  tmp_output="$(mktemp "/tmp/ag_smart_crop_XXXXXX.${ext}")"
  log_file="$(mktemp /tmp/ag_smart_crop_log_XXXXXX.txt)"
  if ! python3 "$crop_script" --aspect "$ratio" "$path" "$tmp_output" >"$log_file" 2>&1; then
    printf '提示: 智能裁剪失败，保留原图。日志: %s\n' "$(tr '\n' ' ' <"$log_file" | sed 's/[[:space:]]\+/ /g')" >&2
    rm -f "$tmp_output" "$log_file"
    return 0
  fi

  cp "$tmp_output" "$path"
  printf '已智能裁剪为 %s: %s\n' "$ratio" "$path"
  rm -f "$tmp_output" "$log_file"
}

launch_antigravity_detached() {
  local -a cmd=("$@")
  local launch_log="/tmp/ag_image_antigravity_$(date +%Y%m%d-%H%M%S).log"
  local pid=""

  nohup "${cmd[@]}" >"$launch_log" 2>&1 &
  pid="$!"
  disown "$pid" 2>/dev/null || true

  printf '已后台启动 Antigravity CLI'
  if [[ -n "$pid" ]]; then
    printf '，PID=%s' "$pid"
  fi
  printf '，日志: %s\n' "$launch_log"
}

restart_antigravity_app() {
  local settle_sec="${1:-12}"
  local deadline=0

  printf '正在重启 Antigravity...\n'
  osascript -e 'tell application "Antigravity" to quit' >/dev/null 2>&1 || true

  deadline="$(( $(date +%s) + 15 ))"
  while pgrep -f '/Applications/Antigravity.app/Contents/' >/dev/null 2>&1; do
    if (( $(date +%s) >= deadline )); then
      printf 'Antigravity 未在预期时间内退出，尝试强制结束残留进程。\n'
      pkill -f '/Applications/Antigravity.app/Contents/' >/dev/null 2>&1 || true
      break
    fi
    sleep 1
  done

  printf '正在重新打开 Antigravity，并等待 %s 秒让扩展宿主稳定。\n' "$settle_sec"
  open -a "/Applications/Antigravity.app" >/dev/null 2>&1 || true
  deadline="$(( $(date +%s) + 20 ))"
  while ! pgrep -f '/Applications/Antigravity.app/Contents/' >/dev/null 2>&1; do
    if (( $(date +%s) >= deadline )); then
      break
    fi
    sleep 1
  done

  sleep "$settle_sec"
}

get_frontmost_app() {
  osascript <<'EOF' 2>/dev/null || true
tell application "System Events"
  repeat with p in application processes
    try
      if frontmost of p is true then
        set appName to name of p as text
        set bundleId to ""
        try
          set bundleId to bundle identifier of p as text
        end try
        return appName & "||" & bundleId
      end if
    end try
  end repeat
end tell
EOF
}

restore_frontmost_app() {
  local app_info="${1:-}"
  local app_name=""
  local bundle_id=""

  [[ -n "$app_info" ]] || return 0

  app_name="${app_info%%||*}"
  if [[ "$app_info" == *"||"* ]]; then
    bundle_id="${app_info#*||}"
  fi

  if [[ -n "$bundle_id" && "$bundle_id" != "com.google.antigravity" ]]; then
    osascript -e "tell application id \"$bundle_id\" to activate" >/dev/null 2>&1 || true
    return 0
  fi

  if [[ -n "$app_name" && "$app_name" != "Electron" && "$app_name" != "Antigravity" ]]; then
    osascript -e "tell application \"$app_name\" to activate" >/dev/null 2>&1 || true
  fi
}

activate_antigravity_frontmost() {
  osascript -e 'tell application "Antigravity" to activate' >/dev/null 2>&1 || true
}

dismiss_account_setup_dialog() {
  local result=""
  local label=""

  result="$(osascript <<'EOF' 2>/dev/null || true
tell application "Antigravity" to activate
delay 0.2
tell application "System Events"
  set targetProc to missing value
  repeat with p in application processes
    try
      if bundle identifier of p is "com.google.antigravity" then
        set targetProc to p
        exit repeat
      end if
    end try
  end repeat
  if targetProc is missing value then
    return "NONE"
  end if

  tell targetProc
    if not (exists window 1) then
      return "NONE"
    end if

    try
      if exists sheet 1 of window 1 then
        repeat with b in buttons of sheet 1 of window 1
          try
            set btnName to name of b as text
            if btnName is in {"OK", "确定", "好", "确认", "继续", "知道了", "Close"} then
              click b
              return "CLICKED||" & btnName
            end if
          end try
        end repeat
      end if
    end try

    try
      repeat with b in buttons of window 1
        try
          set btnName to name of b as text
          if btnName is in {"OK", "确定", "好", "确认", "继续", "知道了", "Close"} then
            click b
            return "CLICKED||" & btnName
          end if
        end try
      end repeat
    end try
  end tell
end tell
return "NONE"
EOF
)"

  if [[ "$result" == CLICKED\|\|* ]]; then
    label="${result#CLICKED||}"
    printf '已自动关闭可能阻塞输入的弹窗: %s\n' "$label"
    return 0
  fi

  return 1
}

focus_antigravity_input_box() {
  local result=""

  result="$(osascript <<'EOF' 2>/dev/null || true
tell application "Antigravity" to activate
delay 0.2
tell application "System Events"
  set targetProc to missing value
  repeat with p in application processes
    try
      if bundle identifier of p is "com.google.antigravity" then
        set targetProc to p
        exit repeat
      end if
    end try
  end repeat
  if targetProc is missing value then
    return "NONE"
  end if

  tell targetProc
    if not (exists window 1) then
      return "NONE"
    end if

    set winPos to position of window 1
    set winSize to size of window 1
    set winX to item 1 of winPos
    set winY to item 2 of winPos
    set winW to item 1 of winSize
    set winH to item 2 of winSize

    set clickX to winX + (winW div 4)
    if clickX > (winX + 220) then
      set clickX to winX + 220
    end if
    if clickX < (winX + 120) then
      set clickX to winX + 120
    end if

    set clickY to winY + winH - 105
    if clickY < (winY + 260) then
      set clickY to winY + (winH div 2)
    end if

    click at {clickX, clickY}
    delay 0.2
    return (clickX as text) & "," & (clickY as text)
  end tell
end tell
EOF
)"

  if [[ -n "$result" && "$result" != "NONE" ]]; then
    printf '已尝试聚焦聊天输入框: %s\n' "$result"
    return 0
  fi

  return 1
}

verify_prompt_in_input() {
  local expected_prompt="$1"
  local copied_text=""

  osascript <<'EOF' >/dev/null 2>&1 || return 1
tell application "Antigravity" to activate
delay 0.2
tell application "System Events"
  keystroke "a" using command down
  delay 0.15
  keystroke "c" using command down
end tell
EOF

  copied_text="$(pbpaste 2>/dev/null || true)"
  [[ "$copied_text" == "$expected_prompt" ]]
}

press_enter_to_send() {
  osascript <<'EOF' >/dev/null 2>&1 || return 1
tell application "Antigravity" to activate
delay 0.1
tell application "System Events"
  key code 124
  delay 0.1
  key code 36
end tell
EOF
}

send_prompt_via_gui() {
  local prompt="$1"
  local activate_delay="${2:-1.5}"
  local restore_front_app="${3:-1}"
  local prompt_file=""
  local error_file=""
  local clipboard_backup_file=""
  local previous_front_app=""
  local attempt=0
  local verified=0

  prompt_file="$(mktemp -t ag_image_prompt)"
  error_file="$(mktemp -t ag_image_gui_error)"
  clipboard_backup_file="$(mktemp -t ag_image_clipboard)"
  printf '%s' "$prompt" >"$prompt_file"
  pbpaste >"$clipboard_backup_file" 2>/dev/null || true
  pbcopy <"$prompt_file"
  if [[ "$restore_front_app" -eq 1 ]]; then
    previous_front_app="$(get_frontmost_app)"
  fi

  activate_antigravity_frontmost
  dismiss_account_setup_dialog >/dev/null 2>&1 || true
  for attempt in 1 2 3; do
    focus_antigravity_input_box || true
    if ! osascript <<EOF >/dev/null 2>"$error_file"
tell application "Antigravity" to activate
delay ${activate_delay}
tell application "Antigravity" to activate
delay 0.6
tell application "System Events"
  delay 0.1
  keystroke "v" using command down
end tell
EOF
    then
      rm -f "$prompt_file" "$clipboard_backup_file"
      fail "GUI 自动粘贴失败: $(tr '\n' ' ' <"$error_file" | sed 's/[[:space:]]\\+/ /g')"
    fi

    sleep 0.4
    if verify_prompt_in_input "$prompt"; then
      verified=1
      printf '已验证 prompt 已进入输入框。\n'
      break
    fi

    printf '第 %s 次输入框校验失败，准备重试聚焦和粘贴。\n' "$attempt" >&2
    pbcopy <"$prompt_file"
    sleep 0.3
  done

  if [[ "$verified" -ne 1 ]]; then
    [[ -f "$clipboard_backup_file" ]] && pbcopy <"$clipboard_backup_file" >/dev/null 2>&1 || true
    rm -f "$prompt_file" "$clipboard_backup_file"
    fail "GUI 自动发送失败: prompt 没有稳定进入 Antigravity 输入框。"
  fi

  if ! press_enter_to_send; then
    [[ -f "$clipboard_backup_file" ]] && pbcopy <"$clipboard_backup_file" >/dev/null 2>&1 || true
    rm -f "$prompt_file" "$clipboard_backup_file"
    fail "GUI 自动发送失败: 无法在确认输入后执行发送。"
  fi

  sleep 0.3
  dismiss_account_setup_dialog || true
  [[ -f "$clipboard_backup_file" ]] && pbcopy <"$clipboard_backup_file" >/dev/null 2>&1 || true
  rm -f "$error_file"
  rm -f "$prompt_file" "$clipboard_backup_file"
  if [[ "$restore_front_app" -eq 1 ]]; then
    sleep 0.2
    restore_frontmost_app "$previous_front_app"
  fi
  printf '已通过 GUI 粘贴并发送 prompt。\n'
}

detect_antigravity_issue() {
  local logs_root="/Users/xin/Library/Application Support/Antigravity/logs"
  local since_epoch="${1:-0}"
  local issue=""
  local recent_lines=""

  [[ -d "$logs_root" ]] || return 1

  recent_lines="$(
    while IFS= read -r -d '' log_file; do
      local mtime="0"
      mtime="$(stat -f '%m' "$log_file" 2>/dev/null || printf '0')"
      if (( mtime < since_epoch )); then
        continue
      fi
      tail -n 120 "$log_file" 2>/dev/null | sed "s#^#$log_file:#"
    done < <(
      find "$logs_root" -type f \
        \( -name 'Antigravity.log' -o -name 'exthost.log' -o -name 'renderer.log' \) \
        -mmin -3 -print0 2>/dev/null
    )
  )" || true

  issue="$(printf '%s\n' "$recent_lines" | rg 'channel is full|SendActionToChatPanel' -S 2>/dev/null | tail -n 1)" || true
  if [[ -z "$issue" ]]; then
    issue="$(printf '%s\n' "$recent_lines" | rg 'An unknown error occurred|loadCodeAssist.*EOF' -S 2>/dev/null | tail -n 1)" || true
  fi

  [[ -n "$issue" ]] || return 1
  printf '%s\n' "$issue"
}

detect_auth_setup_issue() {
  local since_epoch="${1:-0}"
  local logs_root="/Users/xin/Library/Application Support/Antigravity/logs"
  local issue=""
  local recent_lines=""

  [[ -d "$logs_root" ]] || return 1

  recent_lines="$(
    while IFS= read -r -d '' log_file; do
      local mtime="0"
      mtime="$(stat -f '%m' "$log_file" 2>/dev/null || printf '0')"
      if (( mtime < since_epoch )); then
        continue
      fi
      tail -n 120 "$log_file" 2>/dev/null | sed "s#^#$log_file:#"
    done < <(
      find "$logs_root" -type f \
        \( -name 'Antigravity.log' -o -name 'auth.log' -o -name 'cloudcode.log' -o -name '*Antigravity Cockpit.log' \) \
        -print0 2>/dev/null
    )
  )" || true

  issue="$(
    printf '%s\n' "$recent_lines" | rg \
      'Error initializing AntigravityAuthMainService|fetchUserInfo failed|oauth2/v2/userinfo failed|Client network socket disconnected before secure TLS connection was established|Cache\(userInfo\).*EOF|Cache\(peopleInfo\).*userinfo.*EOF|GetUserStatus \(unknown\): .*fetchUserInfo|There was an unexpected issue setting up your account' \
      -S 2>/dev/null | tail -n 1
  )" || true

  [[ -n "$issue" ]] || return 1
  printf '%s\n' "$issue"
}

detect_authorized_state() {
  local since_epoch="${1:-0}"
  local logs_root="/Users/xin/Library/Application Support/Antigravity/logs"
  local ready=""
  local recent_lines=""

  [[ -d "$logs_root" ]] || return 1

  recent_lines="$(
    while IFS= read -r -d '' log_file; do
      local mtime="0"
      mtime="$(stat -f '%m' "$log_file" 2>/dev/null || printf '0')"
      if (( mtime < since_epoch )); then
        continue
      fi
      tail -n 80 "$log_file" 2>/dev/null | sed "s#^#$log_file:#"
    done < <(
      find "$logs_root" -type f \
        \( -name '*Antigravity Cockpit.log' -o -name 'renderer.log' \) \
        -print0 2>/dev/null
    )
  )" || true

  ready="$(
    printf '%s\n' "$recent_lines" | rg \
      'Local Antigravity connection detected in authorized mode|\[ModelList:authorized\] count=' \
      -S 2>/dev/null | tail -n 1
  )" || true

  [[ -n "$ready" ]] || return 1
  printf '%s\n' "$ready"
}

wait_for_antigravity_ready() {
  local timeout_sec="$1"
  local since_epoch="$2"
  local now_epoch="0"
  local issue=""
  local ready=""
  local warned_issue=0
  local last_issue=""

  printf '等待 Antigravity 账号进入可用状态，最多 %s 秒。\n' "$timeout_sec"

  while true; do
    ready="$(detect_authorized_state "$since_epoch")" || true
    if [[ -n "$ready" ]]; then
      printf '检测到 Antigravity 已进入 authorized 状态。\n'
      return 0
    fi

    issue="$(detect_auth_setup_issue "$since_epoch")" || true
    if [[ -n "$issue" ]]; then
      last_issue="$issue"
      if [[ "$warned_issue" -eq 0 ]]; then
        printf '检测到账号初始化异常，但先不打断流程: %s\n' "$issue" >&2
        warned_issue=1
      fi
    fi

    now_epoch="$(date +%s)"
    if (( now_epoch - since_epoch >= timeout_sec )); then
      if [[ -n "$last_issue" ]]; then
        printf '%s\n' "$last_issue"
        return 2
      fi
      return 1
    fi
    sleep 2
  done
}

find_latest_image_since() {
  local since_epoch="$1"
  local private_tmp="/private/tmp"
  local temp_dir="/var/folders/f_/5d2twg6n6jg7wry6_mg4m15c0000gn/T"
  local gemini_brain="/Users/xin/.gemini/antigravity/brain"
  local path=""

  path="$(
    find "$private_tmp" "$temp_dir" "$gemini_brain" -type f \
      \( -iname 'imagen_output_*' -o -iname '*imagen*' -o -iname '*generated*' -o -iname '*image_output*' -o -iname 'ai_*' -o -iname '*infographic*' \) \
      \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
      -print0 2>/dev/null \
      | xargs -0 stat -f '%m|%N' 2>/dev/null \
      | awk -F '|' -v since="$since_epoch" '$1 >= since { print }' \
      | sort -nr -k1,1 \
      | head -n 1 \
      | cut -d'|' -f2-
  )" || true
  if [[ -n "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  path="$(
    find "$private_tmp" "$temp_dir" "$gemini_brain" -type f \
      \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
      -print0 2>/dev/null \
      | xargs -0 stat -f '%m|%N' 2>/dev/null \
      | awk -F '|' -v since="$since_epoch" '$1 >= since { print }' \
      | sort -nr -k1,1 \
      | head -n 1 \
      | cut -d'|' -f2-
  )" || true
  if [[ -n "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  path="$(
    find "/Users/xin/Downloads" "/Users/xin/Desktop" "/Users/xin/Pictures" -type f \
      \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
      -print0 2>/dev/null \
      | xargs -0 stat -f '%m|%N' 2>/dev/null \
      | awk -F '|' -v since="$since_epoch" '$1 >= since { print }' \
      | sort -nr -k1,1 \
      | head -n 1 \
      | cut -d'|' -f2-
  )" || true
  if [[ -n "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  return 1
}

fetch_latest_image() {
  local out_path="$1"
  local since_epoch="$2"
  local latest=""

  latest="$(find_latest_image_since "$since_epoch")" || true
  [[ -n "$latest" ]] || fail "没有找到符合条件的新图片。你可以调大 --lookback-sec，或先在 Antigravity 里完成生图。"

  copy_image_to_output "$latest" "$out_path"
}

watch_for_image() {
  local out_path="$1"
  local timeout_sec="$2"
  local start_epoch="${3:-}"
  local intro_message="${4:-}"
  local skip_issue_check="${5:-0}"
  local settle_sec="${6:-25}"
  local now_epoch
  local latest=""
  local stable_latest=""
  local stable_since=""
  local issue=""
  local warned_auth_issue=0

  if [[ -z "$start_epoch" ]]; then
    start_epoch="$(date +%s)"
  fi

  printf '开始监听新图片，超时 %s 秒。\n' "$timeout_sec"
  if [[ -n "$intro_message" ]]; then
    printf '%s\n' "$intro_message"
  else
    printf '现在去 Antigravity 里自己输入 prompt 并生成；抓到图片后我会自动拷出来。\n'
  fi

  while true; do
    latest="$(find_latest_image_since "$start_epoch")" || true
    if [[ -n "$latest" ]]; then
      if [[ -z "$stable_latest" || "$latest" != "$stable_latest" ]]; then
        stable_latest="$latest"
        stable_since="$(date +%s)"
        printf '检测到新图片，进入静默观察期 %s 秒: %s\n' "$settle_sec" "$stable_latest"
      fi

      now_epoch="$(date +%s)"
      if (( now_epoch - stable_since >= settle_sec )); then
        copy_image_to_output "$stable_latest" "$out_path"
        return 0
      fi
    fi

    issue="$(detect_auth_setup_issue "$start_epoch")" || true
    if [[ -n "$issue" && "$warned_auth_issue" -eq 0 ]]; then
      printf '提示: 检测到账号初始化异常日志，但继续等待图片，因为这类错误经常不影响后续 chat 生图。\n' >&2
      warned_auth_issue=1
    fi

    if [[ "$skip_issue_check" -ne 1 ]]; then
      issue="$(detect_antigravity_issue "$start_epoch")" || true
      if [[ -n "$issue" ]]; then
        fail "Antigravity 当前实例异常，消息没有真正发送到聊天面板: $issue"
      fi
    fi

    now_epoch="$(date +%s)"
    if (( now_epoch - start_epoch >= timeout_sec )); then
      if [[ -n "$stable_latest" ]]; then
        printf '监听在静默观察期内超时，回退使用最后检测到的图片。\n' >&2
        copy_image_to_output "$stable_latest" "$out_path"
        return 0
      fi
      fail "监听超时，没有发现新图片。"
    fi
    sleep 2
  done
}

build_prompt() {
  local raw_prompt="$1"
  local out_path="$2"

  if [[ -z "$out_path" ]]; then
    printf '%s\n' "$raw_prompt"
    return
  fi

  cat <<EOF
$raw_prompt

如果当前能力支持直接导出最终图片，优先保存到：
$out_path
EOF
}

print_dry_run() {
  local prompt="$1"
  shift
  local -a cmd=("$@")
  local prompt_index=$((${#cmd[@]} - 1))
  local i

  printf '命令预览:\n'
  printf '  '
  for ((i = 0; i < prompt_index; i++)); do
    printf '%q ' "${cmd[i]}"
  done
  printf '%s\n\n' '<PROMPT>'
  printf '最终 Prompt:\n%s\n' "$prompt"
}

main() {
  local out_path=""
  local mode="ask"
  local window_flag="--reuse-window"
  local window_flag_set=0
  local maximize=0
  local raw=0
  local auto_fetch=1
  local fetch_latest=0
  local watch_mode=0
  local timeout_sec=300
  local settle_sec=25
  local smart_crop_aspect=""
  local lookback_sec=1800
  local ready_timeout_sec=30
  local gui_send_delay_sec=4
  local restore_front_app=1
  local dry_run=0
  local manual_bin=""
  local profile=""
  local restart_antigravity=0
  local restart_wait_sec=12
  local send_via_gui=0
  local has_add_files=0
  local -a add_files=()
  local -a positional=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --out)
        [[ $# -ge 2 ]] || fail "--out 缺少参数"
        out_path="$2"
        shift 2
        ;;
      --mode)
        [[ $# -ge 2 ]] || fail "--mode 缺少参数"
        mode="$2"
        shift 2
        ;;
      --add-file)
        [[ $# -ge 2 ]] || fail "--add-file 缺少参数"
        has_add_files=1
        add_files+=("$2")
        shift 2
        ;;
      --profile)
        [[ $# -ge 2 ]] || fail "--profile 缺少参数"
        profile="$2"
        shift 2
        ;;
      --restart-antigravity)
        restart_antigravity=1
        shift
        ;;
      --restart-wait)
        [[ $# -ge 2 ]] || fail "--restart-wait 缺少参数"
        restart_wait_sec="$2"
        shift 2
        ;;
      --ready-timeout)
        [[ $# -ge 2 ]] || fail "--ready-timeout 缺少参数"
        ready_timeout_sec="$2"
        shift 2
        ;;
      --gui-send-delay)
        [[ $# -ge 2 ]] || fail "--gui-send-delay 缺少参数"
        gui_send_delay_sec="$2"
        shift 2
        ;;
      --no-restore-front-app)
        restore_front_app=0
        shift
        ;;
      --keep-antigravity-front)
        restore_front_app=0
        shift
        ;;
      --send-via-gui)
        send_via_gui=1
        shift
        ;;
      --new-window)
        window_flag="--new-window"
        window_flag_set=1
        shift
        ;;
      --reuse-window)
        window_flag="--reuse-window"
        window_flag_set=1
        shift
        ;;
      --maximize)
        maximize=1
        shift
        ;;
      --raw)
        raw=1
        shift
        ;;
      --fetch-latest)
        fetch_latest=1
        shift
        ;;
      --watch)
        watch_mode=1
        shift
        ;;
      --no-fetch)
        auto_fetch=0
        shift
        ;;
      --timeout)
        [[ $# -ge 2 ]] || fail "--timeout 缺少参数"
        timeout_sec="$2"
        shift 2
        ;;
      --settle-sec)
        [[ $# -ge 2 ]] || fail "--settle-sec 缺少参数"
        settle_sec="$2"
        shift 2
        ;;
      --smart-crop-aspect)
        [[ $# -ge 2 ]] || fail "--smart-crop-aspect 缺少参数"
        smart_crop_aspect="$2"
        shift 2
        ;;
      --lookback-sec)
        [[ $# -ge 2 ]] || fail "--lookback-sec 缺少参数"
        lookback_sec="$2"
        shift 2
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      --bin)
        [[ $# -ge 2 ]] || fail "--bin 缺少参数"
        manual_bin="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do
          positional+=("$1")
          shift
        done
        ;;
      -*)
        fail "未知参数: $1"
        ;;
      *)
        positional+=("$1")
        shift
        ;;
    esac
  done

  if [[ "$fetch_latest" -eq 1 && "$watch_mode" -eq 1 ]]; then
    fail "--fetch-latest 和 --watch 不能同时使用。"
  fi

  SMART_CROP_ASPECT="$smart_crop_aspect"

  if [[ "$fetch_latest" -eq 1 ]]; then
    fetch_latest_image "$out_path" "$(( $(date +%s) - lookback_sec ))"
    exit 0
  fi

  if [[ "$watch_mode" -eq 1 ]]; then
    watch_for_image "$out_path" "$timeout_sec" "" "" 0 "$settle_sec"
    exit 0
  fi

  local prompt=""
  if [[ ${#positional[@]} -gt 0 ]]; then
    prompt="${positional[*]}"
  elif [[ ! -t 0 ]]; then
    prompt="$(cat)"
  fi

  prompt="${prompt#"${prompt%%[![:space:]]*}"}"
  prompt="${prompt%"${prompt##*[![:space:]]}"}"
  [[ -n "$prompt" ]] || fail "缺少图片需求。"

  local antigravity_bin
  antigravity_bin="$(resolve_bin "$manual_bin")"

  if [[ "$restart_antigravity" -eq 1 && "$window_flag_set" -eq 0 && "$send_via_gui" -eq 0 ]]; then
    window_flag="--new-window"
  fi

  local final_prompt="$prompt"
  if [[ "$raw" -eq 0 ]]; then
    if [[ "$send_via_gui" -eq 1 ]]; then
      final_prompt="$(build_prompt "$prompt" "")"
    else
      final_prompt="$(build_prompt "$prompt" "$out_path")"
    fi
  fi

  local -a cmd=("$antigravity_bin" "chat" "--mode" "$mode" "$window_flag")

  if [[ "$maximize" -eq 1 ]]; then
    cmd+=("--maximize")
  fi

  if [[ -n "$profile" ]]; then
    cmd+=("--profile" "$profile")
  fi

  if [[ "$has_add_files" -eq 1 ]]; then
    local add_file
    for add_file in "${add_files[@]}"; do
      cmd+=("--add-file" "$add_file")
    done
  fi

  if [[ "$send_via_gui" -eq 0 ]]; then
    cmd+=("$final_prompt")
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    print_dry_run "$final_prompt" "${cmd[@]}"
    exit 0
  fi

  if [[ "$restart_antigravity" -eq 1 ]]; then
    restart_antigravity_app "$restart_wait_sec"
  fi

  local launch_epoch
  launch_epoch="$(date +%s)"
  launch_antigravity_detached "${cmd[@]}"

  if [[ "$send_via_gui" -eq 1 ]]; then
    local ready_status=0
    local ready_message=""

    ready_message="$(wait_for_antigravity_ready "$ready_timeout_sec" "$launch_epoch" 2>&1)" || ready_status="$?"
    if [[ "$ready_status" -eq 2 ]]; then
      printf '%s\n' "$ready_message"
      printf '提示: 账号初始化日志有异常，但这通常不影响后续 chat 生图，继续发送 prompt。\n' >&2
    elif [[ "$ready_status" -ne 0 ]]; then
      [[ -n "$ready_message" ]] && printf '%s\n' "$ready_message"
      printf '在 %s 秒内未检测到账号 ready 日志，继续尝试发送 prompt。\n' "$ready_timeout_sec"
    else
      [[ -n "$ready_message" ]] && printf '%s\n' "$ready_message"
    fi

    printf '等待 chat 界面稳定 %s 秒后执行 GUI 粘贴。\n' "$gui_send_delay_sec"
    sleep "$gui_send_delay_sec"
    send_prompt_via_gui "$final_prompt" "1.5" "$restore_front_app"
  fi

  if [[ "$auto_fetch" -eq 1 ]]; then
    watch_for_image "$out_path" "$timeout_sec" "$launch_epoch" "脚本已把 prompt 发给 Antigravity，正在等待生成后的新图片。" "$send_via_gui" "$settle_sec"
  fi
}

main "$@"
