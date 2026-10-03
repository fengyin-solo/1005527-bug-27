import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { checkCondition, checkResultAgainstCondition } from '@/api/stability-domain'
import type {
  ActionResult,
  CreateResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const STABILITY_KEY = 'stability'
const CHANGE_CONTROL_KEY = 'changecontrol'

// 稳定性考察的动作会反映到变更控制待办：同一条考察、同一个动作只登记一个未关闭待办。
const STABILITY_TODO_CODE: Record<string, string> = {
  提交考察: 'STAB-SUBMIT',
  退回校准: 'STAB-CALIBRATE',
  确认完成: 'STAB-COMPLETE',
  终止考察: 'STAB-TERMINATE',
}

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

function isFinalStatus(meta: ModuleMeta, status: string): boolean {
  return status === meta.statuses[meta.statuses.length - 1]
}

/** 登记一条记录：必填校验、业务键去重，写库后只以库中这一行为读数源。 */
export function createEntry(key: string, values: Record<string, string>): CreateResult {
  const meta = moduleMeta(key)
  const payload: Record<string, string> = {}
  for (const field of meta.fields) {
    payload[field] = (values[field] ?? '').trim()
  }
  const optional = new Set(meta.optionalFields ?? [])
  for (const field of meta.fields) {
    if (!payload[field] && !optional.has(field)) {
      return { ok: false, message: `「${field}」为必填项，请补全后再登记` }
    }
  }
  const rows = listRows(key)
  if (meta.keyField) {
    const keyValue = payload[meta.keyField]
    if (keyValue && rows.some((row) => String(row[meta.keyField as string] ?? '') === keyValue)) {
      return { ok: false, message: `${meta.entity}的${meta.keyField}「${keyValue}」已存在，同一${meta.keyField}只登记一条` }
    }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const initialStatus = meta.statuses[0]
  const entry: EntryRow = {
    id,
    status: initialStatus,
    pending: !isFinalStatus(meta, initialStatus),
    abnormal: false,
    ...payload,
  }
  // 稳定性考察的「考察状态」列与规范状态同源，由系统回填，不允许手填成另一份值。
  if (key === STABILITY_KEY) {
    entry['考察状态'] = initialStatus
  }
  saveRows(key, [...rows, entry])
  return { ok: true, message: `${meta.entity}已登记，编号「${payload[meta.fields[0]] ?? id}」`, entry }
}

type EntryPatch = Partial<Omit<EntryRow, 'id'>> & { [field: string]: string | number | boolean }

function patchEntry(key: string, id: number, patch: EntryPatch): EntryRow {
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    throw new Error(`没有找到编号为 ${id} 的记录`)
  }
  const updated: EntryRow = { ...rows[index], ...patch }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return updated
}

function nextChangeControlId(): number {
  return listRows(CHANGE_CONTROL_KEY).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 把稳定性考察的动作反映到变更控制的待办。
 * 同一条考察、同一动作在待评估/评估中（未关闭）状态下只存在一条；重复提交不再登记。
 */
function ensureChangeControlTodo(input: {
  study: EntryRow
  action: string
  category: string
  content: string
  risk: string
}): boolean {
  const { study, action, category, content, risk } = input
  const code = STABILITY_TODO_CODE[action] ?? 'STAB-ACTION'
  const studyNo = String(study['考察编号'] ?? '')
  const todos = listRows(CHANGE_CONTROL_KEY)
  const existsOpen = todos.some(
    (row) =>
      String(row['来源模块'] ?? '') === STABILITY_KEY &&
      String(row['来源编号'] ?? '') === studyNo &&
      String(row['待办编码'] ?? '') === code &&
      (row.status === '待评估' || row.status === '评估中'),
  )
  if (existsOpen) {
    return false
  }
  const sequence = String(nextChangeControlId()).padStart(3, '0')
  const today = new Date().toISOString().slice(0, 10)
  const todo: EntryRow = {
    id: nextChangeControlId(),
    status: '待评估',
    pending: true,
    abnormal: false,
    变更编号: `CC-STAB-${sequence}`,
    变更类别: category,
    涉及工序: '稳定性考察',
    变更内容: content,
    风险评估: risk,
    审批人: '',
    生效日期: today,
    变更状态: '',
    来源模块: STABILITY_KEY,
    来源编号: studyNo,
    待办编码: code,
  }
  saveRows(CHANGE_CONTROL_KEY, [...todos, todo])
  return true
}

function todoContent(action: string, study: EntryRow): { category: string; content: string; risk: string } {
  const studyNo = String(study['考察编号'] ?? '')
  const batchNo = String(study['考察批号'] ?? '')
  const condition = String(study['考察条件'] ?? '')
  switch (action) {
    case '提交考察':
      return {
        category: '稳定性考察条件确认',
        content: `稳定性考察 ${studyNo}（批号 ${batchNo}）已提交，考察条件「${condition}」请评估确认`,
        risk: '考察条件偏离将影响有效期判定，须先确认条件再放行数据',
      }
    case '退回校准':
      return {
        category: '稳定性考察条件校准',
        content: `稳定性考察 ${studyNo}（批号 ${batchNo}）考察条件精度不足，需校准后重新提交，原条件「${condition}」`,
        risk: '条件精度不够会导致考察结果无法判定，须校准设备与条件后再继续',
      }
    case '确认完成':
      return {
        category: '稳定性考察结论评审',
        content: `稳定性考察 ${studyNo}（批号 ${batchNo}）已完成，考察结果「${String(study['考察结果'] ?? '')}」，请评审结论`,
        risk: '考察结论直接关联有效期与放行，须评审通过后方可归档',
      }
    case '终止考察':
      return {
        category: '稳定性考察终止评审',
        content: `稳定性考察 ${studyNo}（批号 ${batchNo}）被终止，请评审终止原因及后续处置`,
        risk: '考察终止可能影响在有效期产品的质量承诺，须评估处置措施',
      }
    default:
      return {
        category: '稳定性考察',
        content: `稳定性考察 ${studyNo} 触发动作「${action}」，请评估`,
        risk: '待评估',
      }
  }
}

/**
 * 稳定性考察动作编排：
 * 1. 逐级推进（跳级挡回）；2. 提交时校验条件精度、回填考察结果并与条件比对（冲突以在库条件为准）；
 * 3. 重复提交只记一次；4. 动作反映到变更控制待办（同样幂等）。
 */
function runStabilityAction(id: number, action: string, payload?: Record<string, string>): ActionResult {
  const meta = moduleMeta(STABILITY_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const study = getEntry(STABILITY_KEY, id)
  if (!study) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(study.status)
  if (current === target || (action === '提交考察' && current !== '待考察')) {
    // 同一份考察重复提交只记一次：不再写库、不再登记待办。
    return {
      ok: true,
      idempotent: true,
      status: current,
      message: `${meta.entity}「${String(study['考察编号'] ?? id)}」已提交过，当前状态「${current}」，不重复记录`,
    }
  }
  const allowed = meta.actionSources?.[action]
  if (allowed && !allowed.includes(current)) {
    return {
      ok: false,
      status: current,
      message: `状态不能从「${current}」跳到「${target}」，请按 ${allowed.join('、')} → ${target} 一步步推进`,
    }
  }

  if (action === '提交考察') {
    const condition = String(study['考察条件'] ?? '')
    const conditionCheck = checkCondition(condition)
    if (!conditionCheck.ok) {
      // 精度不够：退回校准，并在变更控制登记一条校准待办（同样只记一次）。
      const createdTodo = ensureChangeControlTodo({
        study,
        action: '退回校准',
        ...todoContent('退回校准', study),
      })
      return {
        ok: false,
        status: current,
        createdTodo,
        message: createdTodo
          ? `${conditionCheck.message}；已在变更控制登记一条校准待办`
          : `${conditionCheck.message}；变更控制中已有该考察的校准待办，不重复登记`,
      }
    }
    const result = (payload?.['考察结果'] ?? '').trim()
    const testItem = (payload?.['检验项目'] ?? '').trim()
    const analyst = (payload?.['考察人'] ?? '').trim()
    if (!result) {
      return { ok: false, status: current, message: '提交考察前须填写考察结果读数' }
    }
    const resultCheck = checkResultAgainstCondition(condition, result)
    if (!resultCheck.ok) {
      return { ok: false, status: current, message: resultCheck.message }
    }
    const patch: Partial<EntryRow> = { 考察结果: result }
    if (testItem) {
      patch['检验项目'] = testItem
    }
    if (analyst) {
      patch['考察人'] = analyst
    }
    const updated = patchEntry(STABILITY_KEY, id, {
      ...patch,
      status: target,
      考察状态: target,
      pending: !isFinalStatus(meta, target),
      abnormal: false,
    })
    const createdTodo = ensureChangeControlTodo({
      study: updated,
      action,
      ...todoContent(action, updated),
    })
    return {
      ok: true,
      status: target,
      createdTodo,
      message: createdTodo
        ? `考察已提交，状态推进至「${target}」，并已在变更控制登记待办`
        : `考察已提交，状态推进至「${target}」；变更控制待办已存在，不重复登记`,
    }
  }

  // 确认完成：考察结果必须已在提交时写库，只留这一份，完成时不另算。
  if (action === '确认完成' && !String(study['考察结果'] ?? '').trim()) {
    return { ok: false, status: current, message: '考察结果尚未写库，请先提交考察并填写考察结果' }
  }

  const updated = patchEntry(STABILITY_KEY, id, {
    status: target,
    考察状态: target,
    pending: !isFinalStatus(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  })
  const createdTodo = ensureChangeControlTodo({
    study: updated,
    action,
    ...todoContent(action, updated),
  })
  return {
    ok: true,
    status: target,
    createdTodo,
    message: createdTodo
      ? `${meta.entity}已${action}，当前状态「${target}」，并已在变更控制登记待办`
      : `${meta.entity}已${action}，当前状态「${target}」；变更控制待办已存在，不重复登记`,
  }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  payload?: Record<string, string>,
): ActionResult {
  if (key === STABILITY_KEY) {
    return runStabilityAction(id, action, payload)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
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
  const allowed = meta.actionSources?.[action]
  if (allowed && !allowed.includes(current)) {
    return {
      ok: false,
      message: `状态不能从「${current}」跳到「${target}」，请按 ${allowed.join('、')} → ${target} 一步步推进`,
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isFinalStatus(meta, target),
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
  for (const row of listRows(key)) {
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
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
