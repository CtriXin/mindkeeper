/**
 * Excel 解析器 - Mother Core
 */

const ExcelJS = require('exceljs')

/**
 * 基础默认映射 (Base Mapping)
 */
const BASE_MAPPING = {
    '_key': ['域名', 'domain', '新域名', 'Site Address'],
    'firebase': ['Firebase', 'Firebase信息', 'Firebase Info'],
    'siteName': ['网站标题', '网站名称', 'Title', 'Site Name'],
    'IAMEMAIL': ['邮箱', 'Email', 'Contact us', 'Contact Us', 'CONTACT US'],
    '_ads_content': ['Ads.txt', 'ads.txt', 'Ads'],
    '_ads_group': ['ads.txt group', 'adsGroup', 'Ads Group', 'group'],
    '_adsense_script': ['验证代码', 'script', 'Script']
}

/**
 * 将单元格值转换为文本
 */
function cellToText(cellValue) {
    if (!cellValue) return ''
    if (typeof cellValue === 'string') return cellValue
    if (typeof cellValue === 'number') return String(cellValue)
    if (cellValue.text && cellValue.text.richText) return cellValue.text.richText.map(r => r.text).join('')
    if (cellValue.richText) return cellValue.richText.map(r => r.text).join('')
    if (cellValue.result !== undefined) return String(cellValue.result)
    if (cellValue.hyperlink && cellValue.text && typeof cellValue.text === 'string') return cellValue.text
    return ''
}

/**
 * 规范化文本，用于模糊匹配
 */
function normalizeText(text) {
    return String(text || '').toLowerCase().replace(/[\s:：]/g, '')
}

/**
 * 获取表头映射
 */
function getHeaderMap(headerRow) {
    const map = new Map()
    if (!headerRow || !headerRow.values) return map
    headerRow.values.forEach((value, index) => {
        if (!value) return
        const text = cellToText(value).trim()
        if (text) {
            map.set(text, index)
            map.set(normalizeText(text), index)
        }
    })
    return map
}

/**
 * 根据映射关系查找列索引
 */
function findColIndex(headerMap, mappingKeys) {
    const keys = Array.isArray(mappingKeys) ? mappingKeys : [mappingKeys]
    for (const key of keys) {
        if (headerMap.has(key)) return headerMap.get(key)
        const normalized = normalizeText(key)
        if (headerMap.has(normalized)) return headerMap.get(normalized)
    }
    return null
}

/**
 * 查找匹配的工作表
 */
function findSheet(workbook, sheetNames) {
    const names = Array.isArray(sheetNames) ? sheetNames : [sheetNames]
    for (const name of names) {
        const sheet = workbook.getWorksheet(name)
        if (sheet) return sheet
    }
    return null
}

/**
 * 解析域名配置工作表
 */
function parseDomainSheet(sheet, userMapping) {
    const headerRow = sheet.getRow(1)
    const headerMap = getHeaderMap(headerRow)
    const domains = {}
    const finalMapping = { ...userMapping }
    
    for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r)
        const domainKeyIdx = findColIndex(headerMap, Object.keys(finalMapping).filter(k => finalMapping[k] === '_key')) 
                           || findColIndex(headerMap, BASE_MAPPING._key)
        const domain = domainKeyIdx ? cellToText(row.getCell(domainKeyIdx).value).trim() : ''
        if (!domain) continue

        const config = {}
        for (const [header, fieldPath] of Object.entries(finalMapping)) {
            if (fieldPath === '_key') continue
            const idx = findColIndex(headerMap, header)
            if (idx) {
                const value = cellToText(row.getCell(idx).value).trim()
                if (value) {
                    if (fieldPath.startsWith('_')) config[fieldPath] = value
                    else setNestedValue(config, fieldPath, value)
                }
            }
        }

        for (const [fieldPath, aliasList] of Object.entries(BASE_MAPPING)) {
            const hasValue = fieldPath.startsWith('_') ? config[fieldPath] : getValueByPath(config, fieldPath)
            if (!hasValue) {
                const idx = findColIndex(headerMap, aliasList)
                if (idx) {
                    const value = cellToText(row.getCell(idx).value).trim()
                    if (value) {
                        if (fieldPath.startsWith('_')) config[fieldPath] = value
                        else setNestedValue(config, fieldPath, value)
                    }
                }
            }
        }
        
        if (config.firebase && typeof config.firebase === 'string') config.firebase = parseKeyValueText(config.firebase)
        if (config._adsense_script) {
            const scriptUrl = extractScriptUrl(config._adsense_script)
            if (scriptUrl) setNestedValue(config, 'adsense.scriptUrl', scriptUrl)
        }
        domains[domain] = config
    }
    return domains
}

/**
 * 解析广告位工作表
 */
function parseAdsSheet(sheet) {
    const headerRow1 = sheet.getRow(1)
    const headerRow2 = sheet.getRow(2)
    const header1Values = headerRow1.values || []
    const header2Values = headerRow2.values || []
    const domainCols = []
    for (let c = 1; c < header1Values.length; c++) {
        const val = cellToText(header1Values[c]).trim()
        if (val.includes('.')) {
            const col2 = cellToText(header2Values[c]).trim()
            const col2Next = cellToText(header2Values[c + 1]).trim()
            if (col2 === '广告位名称' || col2Next === 'head' || col2Next === '广告位header') {
                domainCols.push({ domain: val, nameCol: c, headCol: c + 1, bodyCol: c + 2 })
            }
        }
    }
    const adsByDomain = {}
    for (let r = 3; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r)
        for (const { domain, nameCol, headCol, bodyCol } of domainCols) {
            const slotName = cellToText(row.getCell(nameCol).value).trim()
            const headCode = cellToText(row.getCell(headCol).value).trim()
            const bodyCode = cellToText(row.getCell(bodyCol).value).trim()
            if (!slotName && !headCode) continue
            if (!adsByDomain[domain]) adsByDomain[domain] = { type: null, scriptUrl: '', slots: {} }
            const slotData = parseAdCode(headCode, bodyCode)
            if (!adsByDomain[domain].type) adsByDomain[domain].type = slotData.type
            if (!adsByDomain[domain].scriptUrl && slotData.scriptUrl) adsByDomain[domain].scriptUrl = slotData.scriptUrl
            const normalizedName = normalizeSlotName(slotName, domain)
            if (normalizedName) adsByDomain[domain].slots[normalizedName] = slotData
        }
    }
    return adsByDomain
}

function parseAdCode(headCode, bodyCode) {
    const result = { type: null, scriptUrl: '', raw: { head: headCode, body: bodyCode } }
    const scriptMatch = headCode.match(/src="([^"]+)"/i)
    if (scriptMatch) result.scriptUrl = scriptMatch[1].replace(/""/g, '"')
    if (headCode.includes('googletag') || headCode.includes('defineSlot') || headCode.includes('defineOutOfPageSlot')) {
        result.type = 'adx'
        const slotMatch = headCode.match(/defineSlot\(\s*['"]([^'"]+)['"]\s*,\s*(\[[\s\S]*?\])\s*,\s*['"]([^'"]+)['"]\s*\)/i)
        if (slotMatch) { result.path = slotMatch[1]; result.sizes = parseSizes(slotMatch[2]); result.id = slotMatch[3] }
        const outMatch = headCode.match(/defineOutOfPageSlot\(\s*['"]([^'"]+)['"]\s*,\s*googletag\.enums\.OutOfPageFormat\.([A-Z_]+)\s*\)/i)
        if (outMatch) { result.path = outMatch[1]; result.format = outMatch[2] }
        const idMatch = bodyCode.match(/id=['"]([^'"]+)['"]/i)
        if (idMatch && !result.id) result.id = idMatch[1]
    } else if (headCode.includes('adsbygoogle') || headCode.includes('data-ad-slot')) {
        result.type = 'adsense'
        const styleMatch = headCode.match(/style="([^"]+)"/i)
        const clientMatch = headCode.match(/data-ad-client="([^"]+)"/i)
        const slotMatch = headCode.match(/data-ad-slot="([^"]+)"/i)
        const formatMatch = headCode.match(/data-ad-format="([^"]+)"/i)
        const fullMatch = headCode.match(/data-full-width-responsive="([^"]+)"/i)
        result.style = styleMatch ? styleMatch[1] : 'display:block'
        result.client = clientMatch ? clientMatch[1] : ''
        result.slot = slotMatch ? slotMatch[1] : ''
        result.format = formatMatch ? formatMatch[1] : 'auto'
        result.fullWidth = fullMatch ? fullMatch[1] : 'true'
    }
    return result
}

function parseSizes(text) {
    const sizes = []; const re = /\[(\d+)\s*,\s*(\d+)\]/g; let match
    while ((match = re.exec(text))) sizes.push([Number(match[1]), Number(match[2])])
    return sizes
}

function normalizeSlotName(name, domain) {
    const raw = String(name || '').trim()
    if (!raw) return ''
    if (domain && raw.startsWith(`${domain}_`)) return raw.slice(domain.length + 1)
    if (domain && raw.startsWith(`${domain}-`)) return raw.slice(domain.length + 1)
    return raw
}

/**
 * 解析键值对文本 (增强版：支持标准文本、JSON、以及 Firebase JS 代码片段)
 */
function parseKeyValueText(text) {
    if (!text || String(text).trim() === '') return {}
    
    let raw = String(text).trim()

    // 1. 如果包含 firebaseConfig = { ... }，提取大括号内容
    if (raw.includes('firebaseConfig') || raw.includes('const') || raw.includes('initializeApp')) {
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) raw = match[0]
    }

    // 2. 清理：去掉外层引号，处理转义
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        raw = raw.slice(1, -1)
    }
    raw = raw.replace(/\\"/g, '"')

    // 3. 尝试 JSON 解析
    if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
            // 先尝试标准 JSON
            return JSON.parse(raw)
        } catch {
            // 如果 JSON 报错，可能是 JS 对象格式（没双引号），进入下方的正则提取
        }
    }

    // 4. 通用正则提取：匹配 key: "value" 或 key: value
    const result = {}
    // 正则解释：匹配 键名 : 匹配双引号、单引号或无引号的值（直到逗号、换行或结束）
    const re = /"?(\w+)"?\s*:\s*["']?([^"',\n\r]+)["']?/g
    let match
    while ((match = re.exec(raw))) {
        const key = match[1]
        let value = match[2].trim()
        // 进一步清理值末尾的逗号或分号
        value = value.replace(/[;,]$/, '').trim()
        result[key] = value
    }

    return result
}

function extractScriptUrl(code) {
    const match = code.match(/src="([^"]+)"/i)
    return match ? match[1].replace(/""/g, '"') : ''
}

function getValueByPath(obj, path) {
    return path.split('.').reduce((prev, curr) => prev?.[curr], obj)
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.'); let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]; const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
        if (arrayMatch) {
            const key = arrayMatch[1]; const index = Number(arrayMatch[2])
            if (!current[key]) current[key] = []
            if (!current[key][index]) current[key][index] = {}
            current = current[key][index]
        } else {
            if (!current[part]) current[part] = {}
            current = current[part]
        }
    }
    const lastPart = parts[parts.length - 1]; const arrayMatch = lastPart.match(/^(\w+)\[(\d+)\]$/)
    if (arrayMatch) {
        const key = arrayMatch[1]; const index = Number(arrayMatch[2])
        if (!current[key]) current[key] = []
        current[key][index] = value
    } else current[lastPart] = value
}

async function parseExcel(filePath, config) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const domainSheet = findSheet(workbook, config.sheets.domain)
    let domains = {}
    if (domainSheet) domains = parseDomainSheet(domainSheet, config.mapping)
    let adsenseData = {}; let adxData = {}
    const adsenseSheet = findSheet(workbook, config.sheets.adsense)
    if (adsenseSheet) adsenseData = parseAdsSheet(adsenseSheet)
    const adxSheet = findSheet(workbook, config.sheets.adx)
    if (adxSheet) adxData = parseAdsSheet(adxSheet)
    const adsData = {}
    const allDomains = new Set([...Object.keys(adsenseData), ...Object.keys(adxData)])
    for (const domain of allDomains) {
        if (adsenseData[domain] && Object.keys(adsenseData[domain].slots || {}).length > 0) {
            adsData[domain] = adsenseData[domain]; adsData[domain].type = 'adsense'
        } else if (adxData[domain]) {
            adsData[domain] = adxData[domain]; adsData[domain].type = 'adx'
        }
    }
    return { domains, adsData }
}

module.exports = {
    parseExcel,
    parseDomainSheet,
    parseAdsSheet,
    parseAdCode,
    cellToText,
    getHeaderMap,
    findColIndex,
    setNestedValue,
    parseKeyValueText
}