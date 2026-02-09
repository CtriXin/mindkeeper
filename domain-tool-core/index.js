/**
 * 域名配置工具 - 中央引擎 Mother Core (v2.6)
 * 增加 ads/ads_file 智能注释提示
 */

const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const readline = require('readline')
const { parseExcel, readExistingConfig, writeConfig } = require('./lib/generator')

const colors = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', red: '\x1b[31m', cyan: '\x1b[36m' }
function log(message, color = 'reset') { console.log(`${colors[color]}${message}${colors.reset}`) }

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => rl.question(`${colors.yellow}${question} (y/N): ${colors.reset}`, answer => {
        rl.close(); resolve(answer.toLowerCase() === 'y')
    }))
}

const ALIAS_DB = {
    '_key': ['域名', 'domain', '新域名', 'Site Address', '主页URL'],
    'siteName': ['网站标题', '网站名称', 'Title', 'Site Name', '网页名'],
    'IAMEMAIL': ['邮箱', 'Email', 'Contact us', 'Contact Us', 'CONTACT US', 'IAMEMAIL'],
    'ABOUTUS': ['About us', 'About Us', 'ABOUT US', '网站描述', '网站总描述'],
    'meta.title': ['主页<title>', '主页标题', 'SEO Title', 'meta.title'],
    'meta.des': ['主页<description>', '主页描述', 'SEO Description', 'meta.des'],
    'firebase': ['Firebase', 'Firebase信息', 'Firebase Info', 'firebase'],
    '_ads_content': ['Ads.txt', 'ads.txt', 'Ads'],
    '_ads_group': ['ads.txt group', 'adsGroup', 'Ads Group', 'group'],
    '_adsense_script': ['验证代码', 'script', 'Script']
}

function smartMatch(targetPath, headers) {
    const aliases = ALIAS_DB[targetPath] || [targetPath.split('.').pop()]
    for (const alias of aliases) {
        const found = headers.find(h => {
            const nh = String(h).toLowerCase().replace(/[\s:：]/g, '')
            const na = alias.toLowerCase().replace(/[\s:：]/g, '')
            return nh === na || nh.includes(na) || na.includes(nh)
        })
        if (found) return found
    }
    return null
}

function generateTemplate(obj) {
    if (Array.isArray(obj)) return []
    if (obj !== null && typeof obj === 'object') {
        const res = {}
        for (const key in obj) {
            if (key === 'adsense') { res[key] = {}; continue }
            if (key === 'firebase') { res[key] = {}; continue }
            res[key] = generateTemplate(obj[key])
        }
        return res
    }
    return ""
}

function getAdsPaths(adsObj, prefix = '') {
    let paths = []
    for (let key in adsObj) {
        if (key === 'scriptUrl') continue
        const val = adsObj[key]
        const currentPath = prefix ? `${prefix}.${key}` : key
        if (Array.isArray(val)) {
            val.forEach((_, i) => paths.push(`${currentPath}[${i}]`))
        } else if (val !== null && typeof val === 'object' && !val.path && !val.slot) {
            paths = paths.concat(getAdsPaths(val, currentPath))
        } else {
            paths.push(currentPath)
        }
    }
    return paths
}

async function run(localConfig, args = {}) {
    log('\n🚗 域名工具中央引擎 (Mother Core) 启动...\n', 'cyan')

    const inputDir = localConfig.paths?.inputDir || path.join(process.cwd(), 'input')
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'))
    const inputFile = args.input || (files.length > 0 ? path.join(inputDir, files.sort((a, b) => fs.statSync(path.join(inputDir, b)).mtime.getTime() - fs.statSync(path.join(inputDir, a)).mtime.getTime())[0]) : null)

    if (!inputFile) { log(`❌ 未能找到 Excel 文件`, 'red'); process.exit(1) }
    log(`📄 目标文件: ${path.basename(inputFile)}`, 'blue')

    const shouldGenSuggest = await ask("💡 步骤 1: 是否根据现有数据生成 'suggested-config.js' (配置参考助手)？")
    if (shouldGenSuggest) {
        const outputPath = args.output || localConfig.paths?.output
        if (fs.existsSync(outputPath)) {
            const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
            const lastDomain = Object.keys(existing).pop()
            if (lastDomain) {
                const referenceData = existing[lastDomain]
                const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(inputFile)
                const headers = workbook.getWorksheet(localConfig.sheets?.domain?.[0] || '域名配置')?.getRow(1).values.filter(Boolean).map(v => String(v).trim()) || []

                let mappingLines = []
                const basicPaths = ['siteName', 'siteIcon', 'IAMEMAIL', 'IAmURL', 'ABOUTUS', 'meta.title', 'meta.des', 'firebase', 'ads_file']
                basicPaths.forEach(p => {
                    const match = smartMatch(p, headers)
                    let comment = '// TODO: 检查此项'
                    if (p === 'ads_file') {
                        comment = "// TODO: 若这列是 'group_11' 这种 ID，用 'ads_file'；若是 'google.com, pub-xxx' 这种内容，请将此处改为 'ads'"
                    }
                    mappingLines.push(`        '${match || 'TODO_填入表头'}': '${p}', ${comment}`)
                })

                // 提取顶层广告位并识别数组类型
                const adsData = referenceData.adsense || {}
                const adsLines = []

                Object.keys(adsData).filter(k => k !== 'scriptUrl').forEach(adKey => {
                    const value = adsData[adKey]

                    if (Array.isArray(value)) {
                        // 数组类型广告位：为每个元素生成索引映射
                        value.forEach((_, index) => {
                            adsLines.push(`            '${adKey}[${index}]': '\${TODO_填入Excel列名_${index + 1}}', // TODO: 数组广告位 ${adKey} 的第 ${index + 1} 个元素`)
                        })
                    } else {
                        // 单个对象广告位
                        adsLines.push(`            '${adKey}': '\${TODO_填入Excel列名}', // TODO: 对应Excel表格中的列名`)
                    }
                })

                const adsLinesStr = adsLines.join('\n')

                const templateObj = generateTemplate(referenceData)
                templateObj.siteIcon = "/icon/${siteIcon}.svg"
                templateObj.IAmURL = "${domain}"

                const templateStr = JSON.stringify(templateObj, null, 8).replace(/\"/g, "'")
                const scaffold = `/**
 * 🛠️ 配置零件 (v2.6)
 */

// --- 零件 1: Mapping ---
/*
    mapping: {
${mappingLines.join('\n')}
    },
    adsMapping: {
        adsense: {
${adsLinesStr}
        }
    }
*/

// --- 零件 2: Template ---
/*
    template: ${templateStr.slice(0, -1).replace(/'ads_file': ''/, "'ads_file': '${_ads_file}', // TODO: 若使用内容模式，请删掉此行并改用 'ads': '${_ads_content}'")}    }
*/
`
                fs.writeFileSync(path.join(process.cwd(), 'suggested-config.js'), scaffold)
                log("\n✅ 已产出 suggested-config.js！", 'green')
                log("👉 请打开此文件，将生成的代码块分别贴回你的 'config.js' 中，调整无误后再继续运行命令生成结果。\n", 'cyan')

                const continueNow = await ask("已经手动更新完 config.js 并决定现在就开始执行生成吗？")
                if (!continueNow) { log("👋 好的，请在修改完 config.js 后再次运行命令。", 'yellow'); return }
            }
        }
    } else {
        const readyToRun = await ask("🚀 步骤 2: 准备好解析 Excel 并生成最终输出了吗？")
        if (!readyToRun) { log("👋 好的，请在修改完 config.js 后再次运行命令。", 'yellow'); return }
    }

    log('\n📊 正在执行解析与生成...', 'blue')
    const parsedData = await require('./lib/excel-parser').parseExcel(inputFile, localConfig)
    const result = require('./lib/generator').generateConfig(parsedData, localConfig, {
        existingConfig: require('./lib/generator').readExistingConfig(localConfig.paths?.output),
        adsOnly: args.adsOnly, targetDomains: args.domains
    })

    if (args.preview) {
        const previewFile = path.join(process.cwd(), 'preview-output.json')
        const currentDomains = new Set([...Object.keys(parsedData.domains), ...Object.keys(parsedData.adsData)])
        const previewResult = {}
        currentDomains.forEach(d => { if (result[d]) previewResult[d] = result[d] })
        fs.writeFileSync(previewFile, JSON.stringify(previewResult, null, 2))
        log(`\n📋 预览完成 -> preview-output.json`, 'green')
    } else {
        require('./lib/generator').writeConfig(localConfig.paths?.output, result)
        log(`\n✅ 正式生成成功！`, 'green')
    }
}

module.exports = run