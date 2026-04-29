/**
 * env.ts — 环境检测
 *
 * 解决 MMS bridge session 把 HOME 改到隔离路径的问题。
 * BrainKeeper 的 ~/.sce/ 必须指向真实用户目录，不能跟着 session 走。
 */
export declare function getRealHome(): string;
