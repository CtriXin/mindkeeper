# 🛠️ Mother Core 维护手册

## 🛑 关键：移动目录后必读

当你**移动** `domain-tool-core` 文件夹到其他位置，或者**重命名**父级文件夹时，子项目的路径引用会失效。

### 1. 为什么会失效？
子项目通常使用硬编码的路径或者相对路径（如 `require('../../../../auto-skills/domain-tool-core')`）。一旦 Mother Core 移动，这些路径就变成了“死链”。

### 2. 解决方案：全局锚点 (Global Anchor)
我们引入了“锚点”机制。子项目不再寻找 Mother Core 所在的文件夹，而是读取你电脑主目录下的一个隐藏文件：`~/.domain-tool-core-anchor`。

### 3. 如何操作？

**每当你移动了 Mother Core 的位置，请务必执行以下命令：**

```bash
# 1. 切换到 Mother Core 新的目录
cd /你的/新路径/domain-tool-core

# 2. 执行安装脚本更新锚点
node install.js
```

### 4. 子项目如何适配？
确保子项目的 `index.js` 使用以下逻辑读取 Mother Core：

```javascript
const fs = require('fs')
const path = require('path')
const os = require('os')

function resolveMotherCore() {
    const anchorPath = path.join(os.homedir(), '.domain-tool-core-anchor')
    if (fs.existsSync(anchorPath)) {
        const corePath = fs.readFileSync(anchorPath, 'utf8').trim()
        return require(corePath)
    }
    throw new Error('❌ 未找到 Mother Core 锚点，请在 core 目录运行 node install.js')
}
```

---

## 📈 版本信息
- **Engine Version**: 2.7.0
- **Anchor File**: `~/.domain-tool-core-anchor`

---

## 🔄 功能迭代历史

### v2.7.0 (2026-02-09) - 配置语法标准化

#### ✨ 新增功能
1. **新的配置映射语法**
   - 统一使用占位符语法：`'output_key': '${excel_column}'`
   - 左侧：最终 JSON 输出的 key
   - 右侧：Excel 表头中的列名（去除域名前缀后）
   - 示例：`'list_top': '${list_1}'` 表示 Excel 的 `list_1` 列映射到输出的 `list_top` 字段

2. **suggested-config.js 增强**
   - 自动识别数组类型广告位（如 categories, ranking）
   - 为数组元素生成带索引的映射提示
   - 示例：`'categories[0]': '${TODO_填入Excel列名_1}'`

3. **旧格式检测机制**
   - 自动检测不兼容的旧格式配置
   - 提供详细的错误信息和升级指引
   - 抛出明确的错误，防止静默失败

#### 🔨 重构改进
1. **移除向后兼容代码**
   - 删除两遍处理逻辑（处理新语法 + 处理旧语法）
   - 简化为单遍循环，只支持新占位符语法
   - 代码行数减少 ~40%，逻辑更清晰

2. **性能优化**
   - 移除 `usedSlots` Set 跟踪
   - 减少一次完整的 slots 遍历
   - 提升配置生成速度

#### ⚠️ 破坏性变更
- **不再支持旧格式配置**：`'excel_column': 'output_key'`
- 使用旧格式会抛出错误并提示升级
- **不影响** `ads-template.js` 的使用（走独立代码路径）

#### 📝 升级指南
如果子项目使用旧格式，需要修改 `config.js`：

**旧格式（不再支持）**:
```javascript
adsMapping: {
    adsense: {
        'home_1': 'home_1',        // ❌
        'list_top': 'list_1'       // ❌
    }
}
```

**新格式（必须使用）**:
```javascript
adsMapping: {
    adsense: {
        'home_1': '${home_1}',     // ✅
        'list_top': '${list_1}'    // ✅
    },
    adx: {
        'list_top': '${list_1}',         // ✅ 单个对象
        'categories[0]': '${list_2}',    // ✅ 数组元素
        'categories[1]': '${list_3}'     // ✅ 数组元素
    }
}
```

快速生成参考配置：
```bash
node tools/domain-tool/index.js
# 选择 y 生成 suggested-config.js
```

---

### v2.6.0 - 三层广告模板系统
- 支持 `ads-template.js` 自定义广告位结构
- 分离广告位映射、字段格式、外层结构

---

## 📋 计划项

### 短期计划
- [ ] 考虑为 suggested-config.js 添加更详细的使用说明和示例
- [ ] 评估是否需要支持配置验证工具（在生成前检查配置格式）
- [ ] 收集用户反馈，改进错误提示信息

### 中期计划
- [ ] 探索配置可视化工具（GUI 配置编辑器）
- [ ] 考虑支持配置模板继承（减少重复配置）
- [ ] 研究是否需要支持更复杂的映射规则（如条件映射）

### 长期计划
- [ ] 评估是否需要支持多种输出格式（JSON, YAML, etc.）
- [ ] 考虑开发配置迁移工具（自动升级旧格式到新格式）

---

## ⚠️ 潜在风险

### 高风险
1. **子项目配置兼容性**
   - **风险**：现有使用旧格式的子项目会立即失败
   - **缓解措施**：
     - 提供清晰的错误信息和升级指引
     - suggested-config.js 自动生成正确格式
     - 保留本次更新前的代码版本（可回退）
   - **建议**：在升级前通知所有子项目维护者

2. **意外的配置边界情况**
   - **风险**：某些特殊的广告位配置可能未被测试覆盖
   - **缓解措施**：
     - 保持 `--preview` 模式进行测试
     - 在正式部署前检查 preview-output.json
   - **建议**：建立测试用例覆盖常见的配置模式

### 中风险
1. **数组广告位索引越界**
   - **风险**：如果 Excel 数据变化导致数组元素数量改变
   - **缓解措施**：suggested-config.js 会根据实际数据生成正确的索引
   - **建议**：保持 Excel 数据结构的一致性

2. **配置文件路径错误**
   - **风险**：如果移动 Mother Core 后未更新锚点文件
   - **缓解措施**：已有明确的警告信息和操作指引
   - **建议**：在 MAINTENANCE.md 顶部保留锚点机制说明

### 低风险
1. **ads-template 与 adsMapping 混用**
   - **风险**：用户可能不清楚两者的优先级
   - **缓解措施**：代码逻辑清晰（ads-template 优先）
   - **建议**：在文档中说明两种配置方式的区别和优先级

2. **Excel 列名变更**
   - **风险**：如果 Excel 表头改变，映射会失效
   - **缓解措施**：regenerate suggested-config.js 会反映最新的列名
   - **建议**：保持 Excel 表头的稳定性

---

## 🔍 调试指南

### 配置不生效？
1. 检查配置语法是否使用新格式 `'${...}'`
2. 运行 `node tools/domain-tool/index.js` 重新生成 suggested-config.js
3. 对比 suggested-config.js 和 config.js 找出差异
4. 使用 `--preview` 模式查看输出

### 广告位缺失？
1. 检查 Excel 中是否有对应的列
2. 确认列名前缀是否正确（会自动去除域名前缀）
3. 检查 adsMapping 中是否有该广告位的映射
4. 查看 preview-output.json 确认实际输出

### 数组广告位不正确？
1. 确认使用了数组语法 `'categories[0]': '${list_2}'`
2. 检查 Excel 中是否有足够的列（list_2, list_3 等）
3. 查看 suggested-config.js 中数组的长度是否正确

---

## 📞 支持与维护

如果遇到问题或有改进建议：
1. 检查本文档的相关章节
2. 查看 suggested-config.js 获取配置提示
3. 检查错误信息中的升级指引
4. 联系 Mother Core 维护者
