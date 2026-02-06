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
- **Engine Version**: 2.6.0
- **Anchor File**: `~/.domain-tool-core-anchor`
