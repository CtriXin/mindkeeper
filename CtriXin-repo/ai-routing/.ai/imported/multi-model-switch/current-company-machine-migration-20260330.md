# 公司新机器迁移执行方案（2026-03-30）

## 目标

在**不影响个人自用机器**的前提下，完成一套新的公司标准环境：

- `newapi`：以**个人正常版本**为准
- `CRS`：以 `/Users/xin/auto-skills/CtriXin-repo/quota-aware-routing` 为准
- `OAuth` 账户：合并个人 `CRS` + 公司 `CRS` 中所有可用账户
- 切换原则：**先可用、再统一、最后启用 quota-aware**

你的个人机器定位：

- 继续自用，不迁走，不替换
- 先升级成“标准样板机”
- 作为公司新机器上线前的验证环境

---

## 已确认事实

### 1. 问题根因收敛

- `MMS` 不是主锅
- `MMS -> codex -> gpt-5.4 -> newapi5-4` 已确认是纯 `/v1/responses`
- `CRS` 不是主锅
- 公司 `libre` 这台 `newapi` 会改写 `prompt_cache_key`
- 个人机器对应的 `newapi` 不会改写 `prompt_cache_key`
- `libre` 的问题不只在 `channel 12`，`channel 13` 实验后同样复现

### 2. 这意味着什么

- 公司新机器上的 `newapi` **不要继承 libre 的实现**
- 应直接使用你个人机器那套“正常保留 `prompt_cache_key`”的 `newapi`
- 公司的 `CRS` 可以升级，但第一阶段不要把 quota-aware 全开

---

## 总体策略

### 原则

1. 先做**新机器并行环境**
2. 不原地替换公司现网 `newapi / CRS`
3. 先迁账户，再迁用户 token，再切流
4. `quota-aware` 先部署代码，后启用策略
5. 每个阶段都必须可回退

### 版本基线

- `newapi`：
  - 以**个人正常版本**为准
  - 这是标准上游
  - libre 只作为问题环境和参考，不作为模板

- `CRS`：
  - 以 `quota-aware-routing` 项目为准
  - 但第一阶段只跑**兼容模式**
  - 不改变现有 sticky key 语义
  - 不引入新的 account_affinity 生命周期

---

## Phase 0：准备阶段（只读 + 备份）

### Step 0.1：冻结边界

- 新机器部署目标：
  - `newapi`
  - `CRS`
- 不纳入本轮：
  - `open-webui`
  - `librechat`
  - 其他 sidecar 服务

### Step 0.2：收集当前资产

#### 个人机器

- 记录 `newapi` 镜像名 / 创建时间 / 入口二进制路径
- 记录 `CRS` 版本 / commit / 镜像 / 配置
- 记录现有 OAuth 账户：
  - Claude
  - OpenAI
  - Gemini（如需）

#### 公司机器

- `libre`：
  - 记录当前 `newapi` 镜像 / 构建来源
  - 保留为问题样本环境
- 公司 `CRS`：
  - 导出所有可用账户
  - 不立即删除旧账户

### Step 0.3：备份

- 备份个人 `CRS` 数据
- 备份公司 `CRS` 数据
- 备份公司 `libre newapi` 数据库
- 备份内容至少包括：
  - 账户
  - key / group 绑定
  - 关键配置

---

## Phase 1：先升级你的个人 CRS（作为样板机）

### 目标

让你的机器成为：

- 新版 `CRS` 样板机
- 后续公司新机器的部署基线

### Step 1.1：部署新版 CRS

- 项目来源：
  - `/Users/xin/auto-skills/CtriXin-repo/quota-aware-routing`
- 第一阶段要求：
  - 兼容模式
  - 保留现有 sticky 语义
  - 保留：
    - Claude: `metadata.user_id`
    - OpenAI: `session_id / prompt_cache_key`
- 先不要启用：
  - 用户偏好排序
  - quota score 排序
  - 新的 account affinity 生命周期

### Step 1.2：升级后验证

必须逐项验证：

- `private(/claude)` 正常
- `privateopenai(/openai)` 正常
- `xin/newapi -> CRS` 正常
- direct CRS 正常
- `prompt_cache_key` 不被改写
- `cached_tokens` 正常命中
- Claude 账户登录态不丢
- OpenAI 账户直连可用

### Step 1.3：保留验证记录

- 记录：
  - 镜像/tag
  - commit
  - 验证结果
  - 回退方法

---

## Phase 2：在公司新机器部署干净环境

### 目标

新机器上建立一套**干净的新环境**，而不是复制 libre 的问题状态。

### Step 2.1：部署新 CRS

- 直接用你在 Phase 1 验证通过的版本
- 这是公司新机器的 `CRS` 基线
- 不复用公司旧 `CRS` 容器
- 不原地升级旧 `CRS`

### Step 2.2：部署新 newapi

- 直接用你个人机器上正常的 `newapi` 版本
- 明确不要使用 libre 当前有 bug 的那套实现

### Step 2.3：只保留干净 channel

建议保留：

- `CRS-OpenAI`
- `CRS-Claude`
- `GLM`
- `MiniMax`
- `Kimi`
- `阿里百炼`

明确不要带过去：

- `crs-openai-vvip`
- `test`
- 历史实验 channel
- 任何为了排障临时创建的 token/channel

---

## Phase 3：迁移 OAuth 账户（不重新网页 OAuth）

### 目标

把以下账户合并进新 CRS：

#### Claude

- `fish`
- `b2`
- `Claude-MAX-abelsun810@gmail.com`
- 公司 CRS 里所有其他可用 Claude 账户

#### OpenAI

- 个人 CRS 中可用的 OpenAI 账户
- 公司 CRS 中可用的 OpenAI 账户
- 最终形成统一可调度池

### Step 3.1：迁移方式

- 不要求 A/B 共用 `ENCRYPTION_KEY`
- 走“明文导出 -> 目标端 admin API 重建”
- 已有脚本：
  - `scripts/crs_openai_account_migrate.py`
- Claude 后续按同样原则补迁移脚本或复用导入逻辑

### Step 3.2：迁移原则

- 先迁账户，不先迁旧 key 绑定
- 先保证账户能用
- 后续再重建 key / group / provider

### Step 3.3：账户验收

- 每个账户至少验证：
  - token 可刷新
  - proxy 可用
  - 能实际返回一次最小请求

---

## Phase 4：重建 newapi token / group / channel

### 目标

在新机器重新设计 token 与 group，不把旧问题原样搬过去。

### Step 4.1：分离 Responses 与 Compatible 语义

不要再混：

- `/v1/responses`
- `/v1/messages`
- OpenAI compatible

建议至少分成：

- Responses 专用 token / channel
- Compatible/Claude-style 专用 token / channel

### Step 4.2：重建关键 token

优先创建：

- 管理员调试 token
- 你自己的 `MMS` 专用 token
- 小流量验证 token

### Step 4.3：重建 group

- 新机器 group 重新设计，不复刻 libre 的历史混乱命名
- 但在 quota-aware 真正启用前，group 仍先保持简单

---

## Phase 5：联调与灰度验证

### Step 5.1：MMS 对照

新机器上必须完成这些对照：

1. `companycrsopenai`（direct CRS）
2. `newapi -> CRS`
3. Claude direct
4. Claude via newapi（如保留）

### Step 5.2：关键验收项

- `/v1/responses` 的 `prompt_cache_key` 不被改写
- 第 2 次大输入请求能命中 `cached_tokens`
- sticky/account 不漂移
- direct 与 relay 的 cache 行为一致

### Step 5.3：灰度切流

- 先你自己
- 再少量公司内部用户
- 最后整体切流

---

## Phase 6：再启用 quota-aware

### 目标

在新机器链路稳定后，再逐步打开 quota-aware 特性。

### 允许做的增强

- 用户识别
- 轻量偏好
- quota-aware 排序

### 暂时不要碰的

- Claude sticky key 语义
- OpenAI sticky / `prompt_cache_key` 语义
- 重新设计 scheduler 主流程
- account affinity 生命周期

### 启用方式

- 先灰度
- 保留 fallback 到旧逻辑
- 每开一项就回归一次 `Responses cache`

---

## 最小 TODO（执行顺序）

### P0

1. 个人机器升级新版 `CRS`
2. 验证新版 `CRS` 不回归
3. 锁定个人机器 `newapi` 正常版本
4. 准备公司新机器

### P1

5. 公司新机器部署：
   - 干净 `CRS`
   - 干净 `newapi`
6. 迁移个人 + 公司 OAuth 账户
7. 创建最小 token / channel
8. 跑 direct/newapi 对照

### P2

9. 小范围灰度
10. 开始整理 libre 与正常版 `newapi` 的实现差异
11. 再逐步启用 quota-aware

---

## 回退原则

- 旧公司 `CRS/newapi` 不立即下线
- 新机器切流前必须保留回退入口
- 任一阶段失败：
  - 回到旧机器
  - 不在半成品状态继续叠加改动

---

## 一句话执行策略

**先把你的个人机器升级成标准样板机，再把同版本 `CRS + newapi` 干净地部署到公司新机器，先迁账户、后迁 token、最后启用 quota-aware。**
