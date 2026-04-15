/**
 * MindKeeper 核心类型定义
 *
 * v2 — Recipe 驱动
 * 知识不再是自由 markdown，而是结构化 Recipe：
 * steps / files / gotchas / corrections + changelog
 */
// ── 工具名 ──
export const TOOLS = {
    /** 任务完成后提取 recipe */
    LEARN: 'brain_learn',
    /** 根据任务描述召回 recipe */
    RECALL: 'brain_recall',
    /** 列出所有 recipe */
    LIST: 'brain_list',
    /** 轻量启动入口 */
    BOOTSTRAP: 'brain_bootstrap',
    /** 蒸馏 checkpoint */
    CHECKPOINT: 'brain_checkpoint',
    /** 追加持续工作片段 */
    FRAGMENT: 'brain_fragment',
    /** 绑定 issue-tracking issue */
    LINK_ISSUE: 'brain_link_issue',
    /** 同步 digest 到 issue-tracking */
    SYNC_ISSUE: 'brain_sync_issue',
    /** 列出 threads */
    THREADS: 'brain_threads',
    /** 读写项目看板 */
    BOARD: 'brain_board',
    /** 扫描项目信号 */
    CHECK: 'brain_check',
};
// ── Board（项目看板） ──
export const QUADRANT_KEYS = ['q1', 'q2', 'q3', 'q4'];
export const QUADRANT_LABELS = {
    q1: '紧急+重要',
    q2: '重要+不紧急',
    q3: '紧急+不重要',
    q4: '不紧急+不重要',
};
