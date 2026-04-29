/**
 * 语义路由器
 *
 * v2.1 — 增强匹配
 * - 50+ 同义词组（按领域分类）
 * - Trigram 模糊匹配（fallback）
 * - Tags 参与评分
 * - CamelCase/kebab-case 拆分 + 缩写展开
 * - 导出 extractKeywords 供其他模块复用
 */
import { loadRecipe } from './storage.js';
import { extractKeywords } from './utils.js';
// ── 同义词映射（按领域分类） ──
const SYNONYMS = {
    // -- Web 前端 --
    'component': ['组件', 'widget', 'element', '控件'],
    'responsive': ['响应式', '自适应', 'adaptive', 'mobile-first'],
    'ssr': ['服务端渲染', 'server-side-rendering', 'server render', '同构'],
    'hydration': ['注水', '水合', 'hydrate'],
    'bundle': ['打包', 'webpack', 'vite', 'rollup', 'build', '构建'],
    'style': ['样式', 'css', 'scss', 'tailwind', 'styling', '美化'],
    'layout': ['布局', '排版', 'grid', 'flexbox'],
    'animation': ['动画', 'transition', '过渡', 'motion'],
    'form': ['表单', 'input', '输入', 'validation', '校验'],
    'modal': ['弹窗', 'dialog', 'popup', '对话框'],
    'table': ['表格', 'grid', 'datagrid', '列表'],
    'chart': ['图表', 'graph', 'echarts', 'd3', '可视化', 'visualization'],
    'lazy': ['懒加载', '延迟加载', 'lazyload', 'defer'],
    'virtual': ['虚拟列表', 'virtual-list', 'virtual-scroll', '虚拟滚动'],
    'i18n': ['国际化', 'internationalization', '多语言', 'locale'],
    'theme': ['主题', 'dark-mode', '暗黑模式', 'skin'],
    'seo': ['搜索优化', 'search-engine', 'meta-tags', 'sitemap'],
    // -- 框架 --
    'vue': ['vue2', 'vue3', 'vuex', 'pinia', 'nuxt'],
    'react': ['react18', 'nextjs', 'next', 'redux', 'zustand'],
    'svelte': ['sveltekit'],
    // -- 后端 --
    'api': ['接口', 'endpoint', 'restful', 'graphql'],
    'database': ['数据库', 'db', 'mysql', 'postgres', 'sqlite', 'mongo', 'prisma'],
    'orm': ['对象关系映射', 'sequelize', 'typeorm', 'drizzle'],
    'queue': ['队列', 'mq', 'kafka', 'rabbitmq', 'message', '消息队列'],
    'cache': ['缓存', 'caching', 'redis', 'memcached'],
    'auth': ['认证', '鉴权', 'authentication', '登录', 'login', 'oauth', 'jwt'],
    'middleware': ['中间件', 'interceptor', '拦截器'],
    'upload': ['上传', 'file-upload', '文件上传', 'multipart'],
    'websocket': ['ws', '长连接', 'socket', '实时通信'],
    // -- DevOps --
    'deploy': ['部署', 'ci', 'cd', 'pipeline', 'release', '发布'],
    'docker': ['容器', 'container', 'k8s', 'kubernetes'],
    'nginx': ['反向代理', 'reverse-proxy', '负载均衡'],
    'monitor': ['监控', 'logging', '日志', 'grafana', 'prometheus', '可观测性'],
    // -- 通用 --
    'error': ['错误', '报错', 'bug', '异常', 'exception', '故障'],
    'config': ['配置', 'configuration', 'settings', '设置', 'env'],
    'key': ['密钥', 'secret', 'token', 'credential'],
    'model': ['模型', 'llm', 'ai'],
    'memory': ['记忆', '存储', 'storage'],
    'context': ['上下文', '语境'],
    'perf': ['性能', 'performance', '优化', 'optimize', '提速'],
    'ad': ['广告', 'advertisement', 'adsense'],
    'test': ['测试', 'testing', '单测', 'unittest', 'jest', 'vitest', 'e2e'],
    'refactor': ['重构', '重写', 'cleanup', '整理'],
    'migration': ['迁移', 'migrate', '升级', 'upgrade'],
    'pagination': ['分页', 'paging', 'infinite-scroll', '无限滚动'],
    'search': ['搜索', 'filter', '过滤', '筛选'],
    'sort': ['排序', 'sorting', 'order'],
    'permission': ['权限', 'rbac', 'acl', '访问控制'],
    'notification': ['通知', 'push', '推送', '消息'],
    'payment': ['支付', 'pay', 'stripe', 'alipay', '微信支付'],
    'provider': ['供应商', '服务商', 'vendor'],
    'routing': ['路由', 'route', '分发'],
    'state': ['状态管理', 'store', '状态'],
    'hook': ['钩子', 'composable', 'use'],
    'cli': ['命令行', 'terminal', '终端'],
    'script': ['脚本', 'automation', '自动化'],
};
// ── 缩写展开表 ──
const ABBREVIATIONS = {
    'cfg': ['config', '配置'],
    'btn': ['button', '按钮'],
    'nav': ['navigation', '导航'],
    'img': ['image', '图片'],
    'env': ['environment', '环境'],
    'req': ['request', '请求'],
    'res': ['response', '响应'],
    'err': ['error', '错误'],
    'msg': ['message', '消息'],
    'util': ['utility', '工具'],
    'fn': ['function', '函数'],
    'cb': ['callback', '回调'],
    'tpl': ['template', '模板'],
    'pkg': ['package', '包'],
    'dep': ['dependency', '依赖'],
    'opt': ['option', '选项'],
    'arg': ['argument', '参数'],
    'str': ['string', '字符串'],
    'num': ['number', '数字'],
    'obj': ['object', '对象'],
    'arr': ['array', '数组'],
    'idx': ['index', '索引'],
    'len': ['length', '长度'],
    'dir': ['directory', '目录'],
    'src': ['source', '源码'],
    'dist': ['distribution', '产物'],
    'tmp': ['temporary', '临时'],
    'init': ['initialize', '初始化'],
    'gen': ['generate', '生成'],
    'fmt': ['format', '格式化'],
    'val': ['validate', '校验'],
};
// extractKeywords 已迁移到 utils.ts，此处重新导出保持兼容
export { extractKeywords } from './utils.js';
// ── CamelCase / kebab-case 拆分 ──
function splitCompoundToken(token) {
    // camelCase → ['camel', 'case']
    const camelParts = token.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
    // kebab-case / snake_case → ['kebab', 'case']
    const kebabParts = token.split(/[-_]/).filter(Boolean);
    return [...new Set([...camelParts, ...kebabParts].map(s => s.toLowerCase()).filter(s => s.length >= 2))];
}
// ── N-gram 模糊匹配（中文短词用 bigram，英文长词用 trigram） ──
/** n-gram 相似度：短字符串（中文双字词）用 bigram，长字符串用 trigram */
function ngramSimilarity(a, b) {
    if (a.length < 2 || b.length < 2)
        return 0;
    // 中文短词或短英文用 bigram
    const n = (a.length <= 3 || b.length <= 3) ? 2 : 3;
    const aGrams = toNgrams(a, n);
    const bGrams = toNgrams(b, n);
    let intersection = 0;
    for (const g of aGrams) {
        if (bGrams.has(g))
            intersection++;
    }
    return intersection / Math.max(aGrams.size, bGrams.size);
}
function toNgrams(s, n) {
    const padded = ' '.repeat(n - 1) + s.toLowerCase() + ' ';
    const grams = new Set();
    for (let i = 0; i < padded.length - (n - 1); i++) {
        grams.add(padded.slice(i, i + n));
    }
    return grams;
}
// ── 查询扩展 ──
function expandQuery(query) {
    // 用 extractKeywords 分词：英文按单词、中文按双字切分
    // 修复：原来用 split(/\s+/) 导致中文整句变成一个 token，同义词扩展全部失效
    const words = extractKeywords(query);
    const expanded = new Set();
    for (const word of words) {
        expanded.add(word);
        // 同义词扩展
        for (const [key, synonyms] of Object.entries(SYNONYMS)) {
            if (word === key || synonyms.includes(word)) {
                expanded.add(key);
                synonyms.forEach(s => expanded.add(s));
            }
        }
        // 缩写展开
        const abbrevExpanded = ABBREVIATIONS[word];
        if (abbrevExpanded) {
            abbrevExpanded.forEach(s => expanded.add(s));
        }
        // 反向：完整词 → 缩写
        for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
            if (full.includes(word)) {
                expanded.add(abbr);
            }
        }
        // CamelCase/kebab-case 拆分
        const parts = splitCompoundToken(word);
        if (parts.length > 1) {
            parts.forEach(p => expanded.add(p));
        }
    }
    return Array.from(expanded);
}
// ── 匹配评分 ──
function calculateScore(triggers, queryTerms, meta) {
    const matched = [];
    let rawScore = 0;
    const lowerTriggers = triggers.map(t => t.toLowerCase());
    // 1. Trigger 匹配（主权重）
    for (const term of queryTerms) {
        for (const trigger of lowerTriggers) {
            if (trigger === term) {
                rawScore += 1.0;
                matched.push(trigger);
            }
            else if (trigger.includes(term) || term.includes(trigger)) {
                rawScore += 0.5;
                matched.push(trigger);
            }
        }
    }
    // 2. Tags 匹配（半权重）
    const lowerTags = (meta.tags || []).map(t => t.toLowerCase());
    for (const term of queryTerms) {
        for (const tag of lowerTags) {
            if (tag === term) {
                rawScore += 0.5;
                matched.push(`tag:${tag}`);
            }
            else if (tag.includes(term) || term.includes(tag)) {
                rawScore += 0.25;
                matched.push(`tag:${tag}`);
            }
        }
    }
    // 3. N-gram fuzzy fallback（当精确/子串匹配为 0 时）
    if (rawScore === 0) {
        for (const term of queryTerms) {
            if (term.length < 2)
                continue;
            for (const trigger of lowerTriggers) {
                if (trigger.length < 2)
                    continue;
                const sim = ngramSimilarity(term, trigger);
                if (sim > 0.4) {
                    rawScore += 0.3 * sim;
                    matched.push(`~${trigger}`);
                }
            }
        }
    }
    if (rawScore === 0)
        return { score: 0, matched: [] };
    // 归一化：按查询词数归一，不惩罚触发词多的 recipe
    let score = rawScore / Math.max(queryTerms.length, 1);
    score *= meta.confidence;
    // 访问频次 boost
    const accessBoost = Math.min(meta.accessCount / 100, 0.2);
    score += accessBoost;
    // 近期访问 boost
    if (meta.lastAccessed) {
        const daysSinceAccess = (Date.now() - new Date(meta.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceAccess < 7)
            score += 0.1;
    }
    // Ebbinghaus 时间衰减：R(t) = e^(-t/S)
    // insight 半衰期长（180天），recipe 半衰期中等（60天），无访问的新 recipe 半衰期短（30天）
    const lastActivity = meta.lastAccessed || meta.updated || meta.created;
    if (lastActivity) {
        const daysSince = (Date.now() - new Date(lastActivity).getTime()) / 86400000;
        const halfLife = meta.type === 'insight' ? 180
            : meta.accessCount > 0 ? 60
                : 30;
        const decay = Math.exp(-daysSince / halfLife);
        // 衰减乘到 score 上，保留最低 0.1 避免完全消失
        score *= Math.max(decay, 0.1);
    }
    return { score: Math.min(score, 1), matched: [...new Set(matched)] };
}
// ── 搜索 recipes ──
export function searchRecipes(index, query, limit = 3) {
    const queryTerms = expandQuery(query);
    const results = [];
    for (const meta of index.recipes) {
        const { score, matched } = calculateScore(meta.triggers, queryTerms, meta);
        if (score > 0) {
            const recipe = loadRecipe(meta.id);
            if (recipe) {
                results.push({
                    recipe,
                    score,
                    matchedTriggers: matched,
                });
            }
        }
    }
    // Related recipe boost: 如果命中的 recipe 有 related 字段，boost 关联 recipe
    for (const result of results) {
        const related = result.recipe.related;
        if (!related)
            continue;
        for (const relatedId of related) {
            const relatedResult = results.find(r => r.recipe.id === relatedId);
            if (relatedResult) {
                relatedResult.score = Math.min(relatedResult.score + 0.2, 1);
            }
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}
