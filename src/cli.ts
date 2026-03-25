#!/usr/bin/env node
/**
 * MindKeeper CLI
 *
 * 人类友好的命令行界面
 *
 * 用法:
 *   brain list              列出所有知识
 *   brain search <query>    搜索知识
 *   brain show <id>         显示完整内容
 *   brain add               交互式添加知识
 *   brain rm <id>           删除知识
 *   brain stats             统计信息
 *   brain export            导出为 Markdown
 *   brain rebuild           重建索引
 */

import { loadIndex, saveIndex, loadUnit, saveUnit, deleteUnit, listUnitFiles, metaFromUnit } from './storage.js';
import { search } from './router.js';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
MindKeeper CLI - 你的 AI 认知图书馆

用法:
  mindkeeper list [--project=xxx]   列出所有知识
  mindkeeper search <query>         搜索知识
  mindkeeper show <id>              显示完整内容
  mindkeeper add                    交互式添加知识
  mindkeeper rm <id>                删除知识
  mindkeeper stats                  统计信息
  mindkeeper export [--format=md]   导出知识库
  mindkeeper rebuild                从文件重建索引

示例:
  mindkeeper search "provider routing"
  mindkeeper show tauri-ipc
  mindkeeper list --project=mms
`);
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const index = loadIndex();

  switch (command) {
    case 'list':
    case 'ls': {
      const projectFilter = args.find(a => a.startsWith('--project='))?.split('=')[1];
      let units = index.units;

      if (projectFilter) {
        units = units.filter(u => u.project === projectFilter);
      }

      if (units.length === 0) {
        console.log('知识库为空');
        return;
      }

      console.log(`共 ${units.length} 条知识:\n`);
      for (const u of units) {
        const project = u.project ? `[${u.project}]` : '';
        const accessed = u.accessCount > 0 ? `(访问 ${u.accessCount} 次)` : '';
        console.log(`  ${u.id.padEnd(25)} ${u.summary} ${project} ${accessed}`);
      }
      break;
    }

    case 'search':
    case 's': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.log('用法: brain search <query>');
        return;
      }

      const results = search(index, query);
      if (results.length === 0) {
        console.log('未找到相关知识');
        return;
      }

      console.log(`找到 ${results.length} 条相关知识:\n`);
      for (const r of results) {
        console.log(`  [${r.score.toFixed(2)}] ${r.unit.id}: ${r.unit.summary}`);
        console.log(`         触发词: ${r.matchedTriggers.join(', ')}\n`);
      }
      break;
    }

    case 'show':
    case 'cat': {
      const id = args[1];
      if (!id) {
        console.log('用法: brain show <id>');
        return;
      }

      const unit = loadUnit(id);
      if (!unit) {
        console.log(`知识 "${id}" 不存在`);
        return;
      }

      console.log(`\n# ${unit.summary}\n`);
      console.log(`ID: ${unit.id}`);
      console.log(`触发词: ${unit.triggers.join(', ')}`);
      if (unit.project) console.log(`项目: ${unit.project}`);
      console.log(`置信度: ${unit.confidence}`);
      console.log(`创建时间: ${unit.created}`);
      if (unit.lastAccessed) console.log(`最后访问: ${unit.lastAccessed}`);
      console.log(`访问次数: ${unit.accessCount}`);
      console.log(`\n---\n`);
      console.log(unit.content);
      break;
    }

    case 'add': {
      console.log('交互式添加知识\n');

      const id = await prompt('ID (英文，用于文件名): ');
      if (!id) return;

      if (index.units.find(u => u.id === id)) {
        console.log(`知识 "${id}" 已存在`);
        return;
      }

      const summary = await prompt('一句话摘要: ');
      const triggersStr = await prompt('触发词 (逗号分隔): ');
      const triggers = triggersStr.split(',').map(t => t.trim()).filter(Boolean);
      const project = await prompt('来源项目 (可选): ');
      const confidenceStr = await prompt('置信度 0-1 (默认 0.8): ');
      const confidence = confidenceStr ? parseFloat(confidenceStr) : 0.8;

      console.log('\n输入内容 (Markdown，输入 EOF 结束):');
      const lines: string[] = [];
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      for await (const line of rl) {
        if (line === 'EOF') break;
        lines.push(line);
      }
      const content = lines.join('\n');

      const unit = {
        id,
        triggers,
        summary,
        content,
        project: project || undefined,
        confidence,
        created: new Date().toISOString(),
        accessCount: 0,
      };

      saveUnit(unit);
      index.units.push(metaFromUnit(unit));
      saveIndex(index);

      console.log(`\n已添加知识: ${id}`);
      break;
    }

    case 'rm':
    case 'remove':
    case 'delete': {
      const id = args[1];
      if (!id) {
        console.log('用法: brain rm <id>');
        return;
      }

      const deleted = deleteUnit(id);
      if (!deleted) {
        console.log(`知识 "${id}" 不存在`);
        return;
      }

      index.units = index.units.filter(u => u.id !== id);
      saveIndex(index);
      console.log(`已删除知识: ${id}`);
      break;
    }

    case 'stats': {
      const units = index.units;
      const projects = new Set(units.map(u => u.project).filter(Boolean));
      const totalAccess = units.reduce((sum, u) => sum + u.accessCount, 0);

      console.log(`\nMindKeeper 统计\n`);
      console.log(`  知识总数: ${units.length}`);
      console.log(`  涉及项目: ${projects.size}`);
      console.log(`  总访问次数: ${totalAccess}`);
      console.log(`  索引更新时间: ${index.updated}`);

      if (units.length > 0) {
        const mostAccessed = [...units].sort((a, b) => b.accessCount - a.accessCount).slice(0, 5);
        console.log(`\n  最常访问:`);
        for (const u of mostAccessed) {
          if (u.accessCount > 0) {
            console.log(`    ${u.id}: ${u.accessCount} 次`);
          }
        }
      }
      break;
    }

    case 'export': {
      console.log('# MindKeeper 知识库导出\n');
      console.log(`导出时间: ${new Date().toISOString()}\n`);

      for (const meta of index.units) {
        const unit = loadUnit(meta.id);
        if (!unit) continue;

        console.log(`## ${unit.summary}\n`);
        console.log(`- ID: ${unit.id}`);
        console.log(`- 触发词: ${unit.triggers.join(', ')}`);
        if (unit.project) console.log(`- 项目: ${unit.project}`);
        console.log(`\n${unit.content}\n`);
        console.log('---\n');
      }
      break;
    }

    case 'rebuild': {
      console.log('重建索引...\n');

      const files = listUnitFiles();
      const newUnits = [];

      for (const id of files) {
        const unit = loadUnit(id);
        if (unit) {
          newUnits.push(metaFromUnit(unit));
          console.log(`  + ${id}`);
        }
      }

      index.units = newUnits;
      saveIndex(index);

      console.log(`\n已重建索引，共 ${newUnits.length} 条知识`);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
  }
}

main().catch(console.error);
