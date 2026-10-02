import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 每个模块的第一个字段都是编号列。同一编号重复提交只留最早那一条，
// 多出来的作废条目直接从落盘数据里清掉，清单、导出和看板读到的都是
// 清理后的这份，刷新或重新进入页面也不会再冒出来。
function dedupeRows(key: string): EntryRow[] {
  const meta = moduleMeta(key)
  const codeField = meta.fields[0]
  const rows = listRows(key)
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const code = String(row[codeField] ?? '').trim()
    if (code !== '' && seen.has(code)) {
      continue
    }
    if (code !== '') {
      seen.add(code)
    }
    kept.push(row)
  }
  if (kept.length !== rows.length) {
    saveRows(key, kept)
  }
  return kept
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(dedupeRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 重拍结论同步落到简报校核的清单里，校核环节能直接看到这条影像要重拍。
function recordRetakeBriefing(photo: EntryRow, date: string): void {
  const rows = dedupeRows('briefing')
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = String(photo['影像编号'] ?? '')
  const conclusion: EntryRow = {
    id,
    status: '待校核',
    pending: true,
    abnormal: false,
    简报编号: `BRIE-${String(id).padStart(4, '0')}`,
    涉及探方: String(photo['拍摄对象'] ?? ''),
    编写人: String(photo['拍摄人'] ?? ''),
    初稿日期: date,
    校核意见数: '1',
    校核结论: `影像${code}标记重拍，已退出已归档，待重新拍摄`,
    定稿日期: '',
    简报状态: '待校核',
  }
  saveRows('briefing', [...rows, conclusion])
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = dedupeRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 流转单向推进：只能依次走到下一个状态，已经归档的那一端不允许回到待整理。
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex >= 0 && targetIndex >= 0) {
    if (targetIndex < currentIndex) {
      return { ok: false, message: `${meta.entity}流转单向推进，「${current}」不允许回到「${target}」` }
    }
    if (targetIndex > currentIndex + 1) {
      return { ok: false, message: `${meta.entity}得依次流转，不能从「${current}」直接跳到「${target}」` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const date = today()
  if (meta.key === 'photo') {
    if (action === '确认归档') {
      // 归档结论只写进「归档状态」，拍摄方向沿用历史影像里的原值，不跟着改写。
      updated['归档状态'] = `已归档（${date}）`
    }
    if (action === '标记重拍') {
      // 标记重拍：把影像退出已归档，并把原因写清。
      updated['归档状态'] = '已退出归档'
      updated['重拍原因'] = `因标记重拍退出已归档，待重新拍摄（登记日期 ${date}）`
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (meta.key === 'photo' && action === '标记重拍') {
    recordRetakeBriefing(updated, date)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of dedupeRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = dedupeRows(meta.key)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
