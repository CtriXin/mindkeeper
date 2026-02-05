/**
 * JSON 配置生成器 - Mother Core (v3.0)
 */

const fs = require('fs')

function clone(obj) { return JSON.parse(JSON.stringify(obj)) }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function generateRandomValues(config = null) {
    const ranges = config?.randomRanges || {}
    const values = {}
    for (const [key, rangeConfig] of Object.entries(ranges)) {
        if (rangeConfig.min !== undefined && rangeConfig.max !== undefined) values[key] = randomInt(rangeConfig.min, rangeConfig.max)
    }
    for (const [key, rangeConfig] of Object.entries(ranges)) {
        if (rangeConfig.dependsOn && rangeConfig.ranges) {
            const dependValue = values[rangeConfig.dependsOn]
            const targetRange = rangeConfig.ranges[dependValue] || rangeConfig.ranges[1] || { min: 1, max: 10 }
            values[key] = randomInt(targetRange.min, targetRange.max)
        }
    }
    return values
}

function applyPlaceholders(obj, domain, config = null) {
    const randomValues = generateRandomValues(config)
    function processValue(val) {
        if (Array.isArray(val)) return val.map(item => processValue(item))
        if (val && typeof val === 'object') {
            const result = {}
            for (const key of Object.keys(val)) result[key] = processValue(val[key])
            return result
        }
        if (typeof val === 'string') {
            if (val === '${_ads}' || val === '${_ads_file}' || val === '${_ads_content}') return val
            const fullMatch = val.match(/^\$\{(\w+)\}$/)
            if (fullMatch && fullMatch[1] in randomValues) return randomValues[fullMatch[1]]
            let value = val.replace(/\$\{domain\}/g, domain)
            for (const [key, num] of Object.entries(randomValues)) value = value.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(num))
            value = value.replace(/\$\{rand:(\d+)\s*-\s*(\d+)\}/g, (_, a, b) => String(randomInt(Number(a), Number(b))))
            return value
        }
        return val
    }
    return processValue(obj)
}

function deepMerge(target, source) {
    const result = clone(target)
    for (const key of Object.keys(source)) {
        const sourceValue = source[key]
        const targetValue = result[key]
        if (sourceValue === null || sourceValue === undefined) continue
        if (Array.isArray(sourceValue)) result[key] = clone(sourceValue)
        else if (typeof sourceValue === 'object' && typeof targetValue === 'object' && !Array.isArray(targetValue)) result[key] = deepMerge(targetValue, sourceValue)
        else result[key] = clone(sourceValue)
    }
    return result
}

function formatAdSlot(slot, slotData, adsTemplate) {
    const result = {}
    const placeholders = { '${slot}': slot.slot || '', '${client}': slot.client || '', '${style}': slot.style || 'display:block', '${format}': slot.format || 'auto', '${fullWidth}': slot.fullWidth || 'true', '${scriptUrl}': slotData.scriptUrl || '' }
    const fmt = adsTemplate?.slotFormat || { style: '${style}', 'data-ad-client': '${client}', 'data-ad-slot': '${slot}', 'data-ad-format': '${format}', 'data-full-width-responsive': '${fullWidth}', class: 'adsbygoogle' }
    for (const [k, v] of Object.entries(fmt)) result[k] = (typeof v === 'string' && v.startsWith('${')) ? (placeholders[v] || v) : v
    return result
}

function generateAdsenseConfig(slotData, config, adsTemplate = null) {
    const slots = slotData.slots || {}
    const adsense = {}; const wrapperFmt = adsTemplate?.wrapper || { scriptUrl: '${scriptUrl}' }
    const firstSlot = Object.values(slots)[0] || {}
    for (const [k, v] of Object.entries(wrapperFmt)) adsense[k] = v === '${scriptUrl}' ? (slotData.scriptUrl || '') : (v === '${client}' ? (firstSlot.client || '') : v)
    
    if (adsTemplate?.adsense) {
        const applyTpl = (t) => {
            if (Array.isArray(t)) return t.map(applyTpl).filter(Boolean)
            if (typeof t === 'string') { const m = t.match(/^\$\{(\w+)\}$/); return m ? (slots[m[1]] ? formatAdSlot(slots[m[1]], slotData, adsTemplate) : null) : null }
            if (t && typeof t === 'object') { const r = {}; let has = false; for (const [k,v] of Object.entries(t)) { const res = applyTpl(v); if (res) { r[k] = res; has = true } }; return has ? r : null }
            return null
        }
        Object.assign(adsense, applyTpl(adsTemplate.adsense))
    } else {
        const mapping = config.adsMapping?.adsense || {}
        for (const [name, data] of Object.entries(slots)) {
            const path = mapping[name] || name; setPathValue(adsense, path, formatAdSlot(data, slotData, adsTemplate))
        }
    }
    return adsense
}

function generateAdxConfig(slotData, config, adsTemplate = null) {
    const adsense = { scriptUrl: slotData.scriptUrl || 'https://securepubads.g.doubleclick.net/tag/js/gpt.js' }
    const slots = slotData.slots || {}
    const fmt = (s) => s.format ? { path: s.path || '', format: s.format } : { path: s.path || '', sizes: s.sizes || [[300, 250], [336, 280]], id: s.id || '', style: 'min-width: 300px; min-height: 250px;' }
    if (adsTemplate?.adx) {
        const applyTpl = (t) => {
            if (Array.isArray(t)) return t.map(applyTpl).filter(Boolean)
            if (typeof t === 'string') { const m = t.match(/^\$\{(\w+)\}$/); return m ? (slots[m[1]] ? fmt(slots[m[1]]) : null) : null }
            if (t && typeof t === 'object') { const r = {}; let has = false; for (const [k,v] of Object.entries(t)) { const res = applyTpl(v); if (res) { r[k] = res; has = true } }; return has ? r : null }
            return null
        }
        Object.assign(adsense, applyTpl(adsTemplate.adx))
    } else {
        const mapping = config.adsMapping?.adx || {}
        for (const [name, data] of Object.entries(slots)) {
            setPathValue(adsense, mapping[name] || name, fmt(data))
        }
    }
    return adsense
}

function setPathValue(obj, path, value) {
    const parts = path.split('.'); let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
        const m = parts[i].match(/^(\w+)\[(\d+)\]$/)
        if (m) { const k = m[1], idx = Number(m[2]); if (!cur[k]) cur[k] = []; if (!cur[k][idx]) cur[k][idx] = {}; cur = cur[k][idx] }
        else { if (!cur[parts[i]]) cur[parts[i]] = {}; cur = cur[parts[i]] }
    }
    const last = parts[parts.length - 1]; const m = last.match(/^(\w+)\[(\d+)\]$/)
    if (m) { const k = m[1], idx = Number(m[2]); if (!cur[k]) cur[k] = []; cur[k][idx] = value }
    else cur[last] = value
}

function generateDomainConfig(domain, domainData, adsData, config, existingConfig = null, adsTemplate = null) {
    let result = applyPlaceholders(clone(config.template || {}), domain, config)
    if (existingConfig) result = deepMerge(result, existingConfig)
    if (domainData) result = deepMerge(result, domainData)

    const adsCfg = config.adsFile || {}
    const adsGroup = domainData?._ads_group || null
    const adsContent = domainData?._ads_content || null
    let groupNum = null; let isGrp = false
    if (adsGroup) { const m = String(adsGroup).match(/(\d+)/); if (m) { groupNum = m[1]; isGrp = true } }
    if (!isGrp && adsContent) { const m = String(adsContent).match(adsCfg.groupPattern || /^group[_\s]*(\d+)$/i); if (m) { groupNum = m[1]; isGrp = true } }

    const hasAds = result.hasOwnProperty('ads'); const hasAdsFile = result.hasOwnProperty('ads_file')
    const adsTpl = adsCfg.adsFileTemplate || 'src/utils/config/adstxt/group_${group}.txt'

    if (isGrp) {
        if (hasAdsFile) result.ads_file = adsTpl.replace(/\$\{group\}/g, groupNum)
        if (hasAds) result.ads = adsTpl.replace(/\$\{group\}/g, groupNum)
    } else if (adsContent) {
        if (hasAds) result.ads = adsContent
    } else {
        if (hasAds) result.ads = adsCfg.defaultValue || 'success'
    }

    if (adsData) {
        const adsType = adsData.type || config.advanced?.defaultAdsType || 'adx'
        const adsense = adsType === 'adsense' ? generateAdsenseConfig(adsData, config, adsTemplate) : generateAdxConfig(adsData, config, adsTemplate)
        result.adsense = result.adsense ? deepMerge(result.adsense, adsense) : adsense
        if (result.adsense && result.adsense.ads === '${_ads}') result.adsense.ads = result.ads || ''
    }
    if (!result.IAmURL) result.IAmURL = domain

    // --- 健康检查 (Health Check) ---
    const issues = []
    const checkValue = (val, path) => {
        if (typeof val === 'string' && val.includes('${') && val.includes('}') && !path.includes('_')) issues.push(`[占位符残留] 路径 "${path}" 的值仍然包含未解析的占位符: ${val}`)
        else if (Array.isArray(val)) val.forEach((v, i) => checkValue(v, `${path}[${i}]`))
        else if (val && typeof val === 'object') Object.keys(val).forEach(k => checkValue(val[k], `${path}.${k}`))
    }
    checkValue(result, domain)
    // 优先级丢失报警：核心判断！
    if (isGrp && !hasAdsFile) {
        issues.push(`\x1b[41m\x1b[37m[优先级报错]\x1b[0m Excel 中存在组号 (Group), 但配置 Template 中漏掉了 'ads_file' 字段！`)
    }
    if (issues.length > 0) {
        console.log(`\n\x1b[31m⚠️  配置异常警告 (${domain}):\x1b[0m`)
        issues.forEach(msg => console.log(`   - ${msg}`))
    }

    const clean = (obj) => {
        if (Array.isArray(obj)) obj.forEach(clean)
        else if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => { if (k.startsWith('_')) delete obj[k]; else clean(obj[k]) })
    }
    // 最后清理
    if (result.ads === '${_ads}' || result.ads === '${_ads_file}') delete result.ads
    if (result.ads_file === '${_ads_file}') delete result.ads_file
    clean(result)
    return result
}

function generateConfig(parsedData, config, options = {}) {
    const { domains, adsData } = parsedData; const { existingConfig = null, adsOnly = false, targetDomains = null, adsTemplate = null } = options
    let result = (existingConfig && config.advanced?.preserveExistingDomains) ? clone(existingConfig) : {}
    let toProcess = targetDomains ? new Set(targetDomains) : new Set([...Object.keys(domains), ...Object.keys(adsData)])
    
    // 跨域名重复性校验存储
    const uniqueStore = { firebase: new Map(), siteName: new Map(), IAMEMAIL: new Map() }

    for (const domain of toProcess) {
        const domainData = domains[domain] || null; const ads = adsData[domain] || null
        if (!domainData && !ads) continue
        const existing = result[domain] || null
        let final;
        if (adsOnly && existing) {
            const type = ads.type || config.advanced?.defaultAdsType || 'adx'
            const adsense = type === 'adsense' ? generateAdsenseConfig(ads, config, adsTemplate) : generateAdxConfig(ads, config, adsTemplate)
            final = { ...existing, adsense: deepMerge(existing.adsense || {}, adsense) }
        } else {
            final = generateDomainConfig(domain, domainData, ads, config, existing, adsTemplate)
        }
        result[domain] = final

        // --- 深度重复校验 ---
        const checkDuplicate = (data, label) => {
            if (!data) return
            const strValue = (typeof data === 'object') ? JSON.stringify(data) : String(data).trim()
            if (strValue.length < 10) return // 忽略太短的值
            if (uniqueStore[label].has(strValue)) {
                console.log(`\n\x1b[43m\x1b[30m[重复报警]\x1b[0m 域名 "${domain}" 的 ${label} 数据与 "${uniqueStore[label].get(strValue)}" 完全一致！请检查 Excel 是否公式拉错。`)
            } else {
                uniqueStore[label].set(strValue, domain)
            }
        }
        if (!adsOnly) {
            checkDuplicate(final.firebase, 'Firebase')
            checkDuplicate(final.siteName, 'siteName')
            checkDuplicate(final.IAMEMAIL, 'IAMEMAIL')
        }
    }
    return result
}

function readExistingConfig(f) { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null } catch { return null } }
function writeConfig(f, c) { fs.writeFileSync(f, JSON.stringify(c, null, 2), 'utf8'); console.log(`✓ 配置已写入: ${f}`) }

module.exports = { generateConfig, readExistingConfig, writeConfig, deepMerge, applyPlaceholders, clone }