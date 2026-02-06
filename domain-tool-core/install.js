/**
 * Mother Core 安装/初始化脚本 (install.js)
 * 作用：在用户主目录下建立全局锚点文件，解决子项目引用路径问题
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const anchorPath = path.join(os.homedir(), '.domain-tool-core-anchor')

try {
    // 获取当前 Mother Core 所在的绝对路径
    const corePath = path.resolve(__dirname)

    // 写入锚点文件
    fs.writeFileSync(anchorPath, corePath, 'utf8')

    console.log('\n=========================================')
    console.log('✅ Mother Core 全局锚点建立成功！')
    console.log(`📍 路径: ${corePath}`)
    console.log(`📄 锚点文件: ${anchorPath}`)
    console.log('💡 现在你的子项目将能够自动找到中央引擎。')
    console.log('=========================================\n')

} catch (err) {
    console.error('❌ 建立锚点失败:', err.message)
    process.exit(1)
}
