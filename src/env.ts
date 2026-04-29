/**
 * env.ts — 环境检测
 *
 * 解决 MMS bridge session 把 HOME 改到隔离路径的问题。
 * BrainKeeper 的 ~/.sce/ 必须指向真实用户目录，不能跟着 session 走。
 */

import { homedir } from 'os';

let _realHome: string | null = null;

export function getRealHome(): string {
  if (_realHome) return _realHome;

  const home = homedir();

  // MMS bridge 特征：HOME 被改成 /Users/<user>/.config/mms/<agent>-gateway/s/<session>
  // 例如：
  // - /Users/<user>/.config/mms/claude-gateway/s/12345
  // - /Users/<user>/.config/mms/codex-gateway/s/67890
  const mmsGatewayMatch = home.match(/^(\/Users\/[^/]+)\/\.config\/mms\/[^/]+-gateway\/s\/[^/]+/);
  if (mmsGatewayMatch) {
    _realHome = mmsGatewayMatch[1];
    return _realHome;
  }

  _realHome = home;
  return _realHome;
}
