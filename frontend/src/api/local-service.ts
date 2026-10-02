import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 影像模块的业务编号字段：同一条影像以编号去重，清单页与详情页都按它认记录。
const PHOTO_KEY = 'photo'
const PHOTO_CODE_FIELD = '影像编号'
const PHOTO_DIRECTION_FIELD = '拍摄方向'
const PHOTO_ARCHIVED_AT_FIELD = '归档日期'
const PHOTO_RESHOOT_REASON_FIELD = '重拍原因'
const PHOTO_ARCHIVED_STATUS = '已归档'
const PHOTO_RESHOOT_STATUS = '待重拍'

// 影像归档是单向推进：待整理 → 已整理 → 已归档，已归档一端不允许退回待整理。
// 「标记重拍」是从主线摘出去的旁支，只有已整理 / 已归档能标记，标记后落到待重拍；
// 重拍完的影像从待重拍重新提交整理，不会直接跳回待整理。
const PHOTO_TRANSITIONS: Record<string, string[]> = {
  提交整理: ['待整理', '待重拍'],
  确认归档: ['已整理'],
  标记重拍: ['已整理', '已归档'],
}

// 简报校核模块：标记重拍的结论要落到这张清单里。
const BRIEFING_KEY = 'briefing'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
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

function isPhotoPending(status: string): boolean {
  // 只有真正归档完成的影像不再待处理；待整理、已整理、待重拍都还在流水线上。
  return status !== PHOTO_ARCHIVED_STATUS
}

// 读取影像时顺手清理落盘数据：
// 1. 已经作废（abnormal）的旧条目直接剔除，清单里不再带这些条目；
// 2. 同一影像编号只保留最早登记的一条，重复提交产生的重复记录丢掉后来的；
// 3. pending / abnormal 以当前状态为准重算，修掉归档后仍显示待整理的脏标记。
// 清理结果写回 localStorage，保证刷新、重新进页面拿到的都是同一份。
function normalizePhotoRows(): EntryRow[] {
  const rows = listRows(PHOTO_KEY)
  const seenCodes = new Set<string>()
  const kept: EntryRow[] = []
  let changed = false

  const ordered = [...rows].sort(
    (a, b) => Number(a.id) - Number(b.id),
  )

  for (const row of ordered) {
    const code = String(row[PHOTO_CODE_FIELD] ?? '').trim()
    const isVoid = row.abnormal === true
    const isDuplicate = code !== '' && seenCodes.has(code)
    if (isVoid || isDuplicate) {
      // 作废条目清掉；重复影像只留最早那一条。
      changed = true
      continue
    }
    if (code !== '') {
      seenCodes.add(code)
    }
    const status = String(row.status)
    const pending = isPhotoPending(status)
    const abnormal = false
    if (row.pending !== pending || row.abnormal !== abnormal) {
      changed = true
    }
    kept.push({ ...row, status, pending, abnormal })
  }

  if (changed || kept.length !== rows.length) {
    saveRows(PHOTO_KEY, kept)
  }
  return kept
}

function readRows(key: string): EntryRow[] {
  return key === PHOTO_KEY ? normalizePhotoRows() : listRows(key)
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(readRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情页按编号读取：与清单页走同一份清理后的数据，避免两边影像编号对不上。
export function getEntry(key: string, id: number): EntryRow | undefined {
  return readRows(key).find((row) => Number(row.id) === id)
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

// 标记重拍的结论落到简报校核清单：同一影像编号只维护一条，再次标记重拍时更新结论，
// 不会冒出一模一样的重复简报。
function syncReshootToBriefing(photo: EntryRow, reason: string): void {
  const rows = [...listRows(BRIEFING_KEY)]
  const code = String(photo[PHOTO_CODE_FIELD] ?? '')
  const briefingCode = `BRIE-RP-${code}`
  const index = rows.findIndex((row) => String(row['简报编号'] ?? '') === briefingCode)

  const conclusion = `影像 ${code} 标记重拍，原因：${reason}`
  const base: EntryRow = index >= 0
    ? { ...rows[index] }
    : {
        id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
        status: '待校核',
        pending: true,
        abnormal: false,
        简报编号: briefingCode,
        涉及探方: String(photo['拍摄对象'] ?? ''),
        编写人: String(photo['拍摄人'] ?? ''),
        初稿日期: todayText(),
      }

  base.status = '待校核'
  base.pending = true
  base.abnormal = false
  base['校核意见数'] = 1
  base['校核结论'] = conclusion
  if (base['定稿日期'] === undefined || base['定稿日期'] === '') {
    base['定稿日期'] = ''
  }
  base['简报状态'] = '待校核'

  if (index >= 0) {
    rows[index] = base
  } else {
    rows.push(base)
  }
  saveRows(BRIEFING_KEY, rows)
}

function runPhotoAction(
  meta: ModuleMeta,
  id: number,
  action: string,
  reason: string,
): ActionResult {
  const target = meta.actionTargets[action]
  const rows = readRows(PHOTO_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  const current = String(rows[index].status)
  const allowedFrom = PHOTO_TRANSITIONS[action] ?? []
  if (!allowedFrom.includes(current)) {
    if (current === PHOTO_ARCHIVED_STATUS && target !== PHOTO_RESHOOT_STATUS) {
      return {
        ok: false,
        message: `影像已归档，归档单向推进，不能${action}回到「${target}」`,
      }
    }
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，不能执行「${action}」`,
    }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: isPhotoPending(target),
    abnormal: false,
  }

  if (action === '标记重拍') {
    const trimmed = reason.trim()
    if (!trimmed) {
      return { ok: false, message: '标记重拍必须填写重拍原因' }
    }
    // 退出已归档：清掉归档日期，写清重拍原因；拍摄方向沿用历史影像，不随这次改动改写。
    updated[PHOTO_RESHOOT_REASON_FIELD] = trimmed
    updated[PHOTO_ARCHIVED_AT_FIELD] = ''
    // 显式保留拍摄方向：只沿用原值，不允许被本次动作覆盖。
    updated[PHOTO_DIRECTION_FIELD] = rows[index][PHOTO_DIRECTION_FIELD] ?? ''
  } else if (action === '确认归档') {
    // 归档时记下归档日期；拍摄方向仍沿用历史影像里的值。
    updated[PHOTO_ARCHIVED_AT_FIELD] = todayText()
    updated[PHOTO_DIRECTION_FIELD] = rows[index][PHOTO_DIRECTION_FIELD] ?? ''
  }

  const next = [...rows]
  next[index] = updated
  saveRows(PHOTO_KEY, next)

  if (action === '标记重拍') {
    syncReshootToBriefing(updated, String(updated[PHOTO_RESHOOT_REASON_FIELD] ?? reason.trim()))
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  payload: { reason?: string } = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (key === PHOTO_KEY) {
    return runPhotoAction(meta, id, action, payload.reason ?? '')
  }

  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
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
  for (const row of readRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = meta.key === PHOTO_KEY ? normalizePhotoRows() : rows[meta.key] ?? []
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
