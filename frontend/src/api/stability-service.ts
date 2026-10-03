import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 稳定性考察领域服务。
// 铁律：考察条件（计划/实测）与考察结果只有一份存储，统一从本服务读写；
// 页面侧栏、详情抽屉、弹窗不允许各自保存副本或临时现算，杜绝「挂旧值 vs 现算」两条取数路径。

export const STABILITY_KEY = 'stability'
const CHANGE_KEY = 'changecontrol'

// 计划条件：方案规定的条件与允差；实测条件与结果：考察当时记录的实测数据。
export const STABILITY_FIELDS = [
  '考察编号',
  '考察批号',
  '计划考察条件',
  '实测考察条件',
  '考察时间点',
  '检验项目',
  '考察结果',
  '考察人',
  '考察状态',
] as const

export const STABILITY_STATUSES = ['待考察', '考察中', '待校准', '已完成', '已终止'] as const
const ACTIVE_STATUSES: string[] = ['待考察', '考察中', '待校准']

// 状态机：只允许逐级推进/在校准回路内流转，任何跳级一律挡回。
const FLOW: Record<string, string[]> = {
  待考察: ['考察中'],
  考察中: ['待校准', '已完成', '已终止'],
  待校准: ['考察中', '已终止'],
  已完成: ['已终止'],
  已终止: [],
}

// 幂等键：同一考察编号在同一时间点的同一检验项目只允许一份结果。
function recordKey(row: Pick<EntryRow, string> | EntryDraft): string {
  return [row['考察编号'], row['考察时间点'], row['检验项目']].map((v) => String(v ?? '').trim()).join('|')
}

export type EntryDraft = {
  考察编号: string
  考察批号: string
  计划考察条件: string
  考察时间点: string
  检验项目: string
  考察人: string
}

export type ResultDraft = {
  实测考察条件: string
  考察结果: string
  考察人: string
}

type ParsedCondition = {
  temperature: number
  tempTolerance: number
  humidity: number
  humTolerance: number
}

// 条件文本格式：25℃±2℃ / 60%RH±5%RH，温湿度用顿号、逗号或空格分隔。
const CONDITION_PATTERN =
  /(-?\d+(?:\.\d+)?)\s*℃\s*±\s*(\d+(?:\.\d+)?)\s*℃[\s,，、;；]*(-?\d+(?:\.\d+)?)\s*%\s*RH\s*±\s*(\d+(?:\.\d+)?)\s*%\s*RH/i

export function parseCondition(text: string): ParsedCondition | null {
  const matched = text.trim().match(CONDITION_PATTERN)
  if (!matched) {
    return null
  }
  return {
    temperature: Number(matched[1]),
    tempTolerance: Number(matched[2]),
    humidity: Number(matched[3]),
    humTolerance: Number(matched[4]),
  }
}

// 精度门槛：温度允差不得宽于 ±2℃，相对湿度允差不得宽于 ±5%RH；
// 写不出可解析的温湿度与允差，同样视为精度不够。
export const TEMP_TOLERANCE_LIMIT = 2
export const HUM_TOLERANCE_LIMIT = 5

export function checkConditionPrecision(text: string): string {
  const parsed = parseCondition(text)
  if (!parsed) {
    return '考察条件须写明「温度±允差℃、湿度±允差%RH」（例：25℃±2℃、60%RH±5%RH），精度信息不足'
  }
  if (parsed.tempTolerance > TEMP_TOLERANCE_LIMIT) {
    return `温度允差 ±${parsed.tempTolerance}℃ 宽于 ±${TEMP_TOLERANCE_LIMIT}℃，考察条件精度不够，退回校准`
  }
  if (parsed.humTolerance > HUM_TOLERANCE_LIMIT) {
    return `湿度允差 ±${parsed.humTolerance}%RH 宽于 ±${HUM_TOLERANCE_LIMIT}%RH，考察条件精度不够，退回校准`
  }
  return ''
}

export type ConflictVerdict =
  | { conflict: false; reason: '' }
  | { conflict: true; reason: string }

// 冲突裁定规则（先定，再落库）：
// 计划考察条件是方案值，实测考察条件与考察结果是当时实测值；两者不一致时，一律以实测考察结果为准，
// 计划值不得覆盖实测值。实测中心值落到计划允差区间之外即判冲突，必须走变更控制评估，
// 冲突未处理前不得完成考察。
export function judgeConflict(plannedText: string, measuredText: string): ConflictVerdict {
  const planned = parseCondition(plannedText)
  const measured = parseCondition(measuredText)
  if (!planned || !measured) {
    return { conflict: false, reason: '' }
  }
  if (Math.abs(measured.temperature - planned.temperature) > planned.tempTolerance) {
    return {
      conflict: true,
      reason: `实测温度 ${measured.temperature}℃ 超出计划 ${planned.temperature}℃±${planned.tempTolerance}℃；按规则以实测结果为准，需经变更控制评估后方可完成`,
    }
  }
  if (Math.abs(measured.humidity - planned.humidity) > planned.humTolerance) {
    return {
      conflict: true,
      reason: `实测湿度 ${measured.humidity}%RH 超出计划 ${planned.humidity}%RH±${planned.humTolerance}%RH；按规则以实测结果为准，需经变更控制评估后方可完成`,
    }
  }
  return { conflict: false, reason: '' }
}

export function getStabilityRows(): EntryRow[] {
  return listRows(STABILITY_KEY)
}

export function findRow(id: number): EntryRow | undefined {
  return getStabilityRows().find((row) => Number(row.id) === id)
}

function persist(rows: EntryRow[]): void {
  saveRows(STABILITY_KEY, rows)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function changeRows(): EntryRow[] {
  return listRows(CHANGE_KEY)
}

function changeIdOf(row: EntryRow, kind: 'calibrate' | 'conflict'): string {
  return `STAB-${String(row.id).padStart(4, '0')}-${kind === 'calibrate' ? 'CAL' : 'CFL'}`
}

// 动作联动变更控制待办：同一条考察、同一类待办只建一次（按来源编号幂等去重）。
function ensureChangeTodo(input: {
  source: EntryRow
  kind: 'calibrate' | 'conflict'
  content: string
  risk: string
}): EntryRow {
  const rows = changeRows()
  const changeNo = changeIdOf(input.source, input.kind)
  const existing = rows.find((row) => String(row['变更编号']) === changeNo)
  if (existing) {
    return existing
  }
  const todo: EntryRow = {
    id: nextId(rows),
    status: '待评估',
    pending: true,
    abnormal: false,
    变更编号: changeNo,
    变更类别: input.kind === 'calibrate' ? '设备/条件校准' : '稳定性条件偏离',
    涉及工序: `稳定性考察 ${input.source['考察编号']}`,
    变更内容: input.content,
    风险评估: input.risk,
    审批人: '待分派',
    生效日期: '',
    变更状态: '待评估',
  }
  saveRows(CHANGE_KEY, [...rows, todo])
  return todo
}

function linkedChanges(row: EntryRow): EntryRow[] {
  if (!row['关联变更']) {
    return []
  }
  const ids = String(row['关联变更']).split(',').map((v) => v.trim()).filter(Boolean)
  return changeRows().filter((change) => ids.includes(String(change['变更编号'])))
}

function attachChangeId(row: EntryRow, changeNo: string): EntryRow {
  const ids = String(row['关联变更'] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  if (ids.includes(changeNo)) {
    return row
  }
  return { ...row, 关联变更: [...ids, changeNo].join(',') }
}

// 关联变更是否仍有未决待办（待评估/评估中）。已批准或已拒绝视为已处理。
export function hasOpenChange(row: EntryRow): boolean {
  return linkedChanges(row).some((change) => ['待评估', '评估中'].includes(String(change.status)))
}

export function linkedChangeSummary(row: EntryRow): { no: string; status: string; content: string }[] {
  return linkedChanges(row).map((change) => ({
    no: String(change['变更编号']),
    status: String(change.status),
    content: String(change['变更内容'] ?? ''),
  }))
}

// 登记考察：计划条件当场验精度，复合键去重，所有字段一次写库。
export function createStabilityEntry(draft: EntryDraft): ActionResult {
  const required: (keyof EntryDraft)[] = ['考察编号', '考察批号', '计划考察条件', '考察时间点', '检验项目', '考察人']
  for (const field of required) {
    if (!draft[field].trim()) {
      return { ok: false, message: `${field}不能为空` }
    }
  }
  if (!/^STAB-\d{4,}$/i.test(draft.考察编号.trim())) {
    return { ok: false, message: '考察编号格式应为 STAB-0001' }
  }
  const precisionError = checkConditionPrecision(draft.计划考察条件)
  if (precisionError) {
    return { ok: false, message: `登记被挡回：${precisionError}` }
  }
  const rows = getStabilityRows()
  const normalized: EntryDraft = {
    考察编号: draft.考察编号.trim().toUpperCase(),
    考察批号: draft.考察批号.trim(),
    计划考察条件: draft.计划考察条件.trim(),
    考察时间点: draft.考察时间点.trim(),
    检验项目: draft.检验项目.trim(),
    考察人: draft.考察人.trim(),
  }
  if (rows.some((row) => recordKey(row) === recordKey(normalized))) {
    return { ok: false, message: '该考察编号在此时间点的检验项目已登记，同一份考察不重复登记' }
  }
  const row: EntryRow = {
    id: nextId(rows),
    status: '待考察',
    pending: true,
    abnormal: false,
    ...normalized,
    实测考察条件: '',
    考察结果: '',
    考察状态: '待考察',
    已提交: false,
    条件冲突: false,
    冲突说明: '',
    关联变更: '',
  }
  persist([...rows, row])
  return { ok: true, message: `考察 ${normalized.考察编号} 已登记，当前状态「待考察」` }
}

function assertFlow(row: EntryRow, target: string): ActionResult | null {
  const allowed = FLOW[String(row.status)] ?? []
  if (!allowed.includes(target)) {
    return {
      ok: false,
      message: `当前为「${row.status}」，不能跳到「${target}」，状态只能逐步推进`,
    }
  }
  return null
}

function saveOne(rows: EntryRow[], id: number, updated: EntryRow): void {
  const index = rows.findIndex((row) => Number(row.id) === id)
  const next = [...rows]
  next[index] = updated
  persist(next)
}

// 提交考察：只能从待考察进入考察中；重复提交只记一次（幂等：已提交不再重复建数、不重复联动）。
export function submitEntry(id: number): ActionResult {
  const rows = getStabilityRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  // 终态记录不允许再提交；其余已提交过的重复点击只记一次（幂等成功、不重复写库）。
  if (['已完成', '已终止'].includes(String(row.status))) {
    return { ok: false, message: `当前为「${row.status}」，不能再提交考察` }
  }
  if (row['已提交']) {
    return { ok: true, message: '该考察已提交过，重复提交只记一次，未重复写库' }
  }
  const blocked = assertFlow(row, '考察中')
  if (blocked) {
    return blocked
  }
  saveOne(rows, id, { ...row, status: '考察中', 考察状态: '考察中', 已提交: true })
  return { ok: true, message: `考察 ${row['考察编号']} 已提交，当前状态「考察中」` }
}

// 录入结果（也用于校准后重录）：实测条件与结果直接写库，只有这一份。
// 实测条件精度不够 → 退回待校准并在变更控制挂校准待办；
// 与计划条件冲突 → 以实测结果为准入库，同时挂变更控制评估待办，未决前不能完成。
export function recordResult(id: number, draft: ResultDraft): ActionResult {
  const rows = getStabilityRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  if (!['考察中', '待校准'].includes(String(row.status))) {
    return { ok: false, message: `当前为「${row.status}」，不能录入考察结果` }
  }
  if (!draft.考察结果.trim()) {
    return { ok: false, message: '考察结果不能为空' }
  }

  const precisionError = checkConditionPrecision(draft.实测考察条件)
  if (precisionError) {
    if (String(row.status) === '考察中') {
      const blocked = assertFlow(row, '待校准')
      if (blocked) {
        return blocked
      }
      const change = ensureChangeTodo({
        source: row,
        kind: 'calibrate',
        content: `稳定性考察 ${row['考察编号']}（${row['考察时间点']}·${row['检验项目']}）实测考察条件精度不够：${precisionError}，请校准培养箱/稳定性考察箱后重新实测。`,
        risk: '条件精度不足可能使稳定性数据不可用，需评估对在研/已上市批次的影响。',
      })
      saveOne(rows, id, {
        ...attachChangeId(row, String(change['变更编号'])),
        status: '待校准',
        考察状态: '待校准',
        实测考察条件: draft.实测考察条件.trim(),
        考察人: draft.考察人.trim() || String(row['考察人'] ?? ''),
        条件冲突: false,
        冲突说明: precisionError,
      })
      return {
        ok: false,
        message: `${precisionError}；已退回「待校准」，并在变更控制生成校准待办 ${change['变更编号']}`,
      }
    }
    return { ok: false, message: `校准后实测条件仍不达标：${precisionError}` }
  }

  const verdict = judgeConflict(String(row['计划考察条件'] ?? ''), draft.实测考察条件)
  let updated: EntryRow = {
    ...row,
    实测考察条件: draft.实测考察条件.trim(),
    考察结果: draft.考察结果.trim(),
    考察人: draft.考察人.trim() || String(row['考察人'] ?? ''),
  }

  if (verdict.conflict) {
    // 规则已定：冲突时以实测结果为准——实测值照常落库，不回退到计划值；
    // 同时挂变更控制待办，未评估完成不得确认完成。
    const change = ensureChangeTodo({
      source: row,
      kind: 'conflict',
      content: `${verdict.reason} 考察编号 ${row['考察编号']}，时间点 ${row['考察时间点']}，检验项目 ${row['检验项目']}。`,
      risk: '实际考察条件偏离方案，可能影响货架期/贮存条件结论，需质量评估并确定处置。',
    })
    updated = {
      ...attachChangeId(updated, String(change['变更编号'])),
      条件冲突: true,
      冲突说明: verdict.reason,
      abnormal: true,
    }
    if (String(row.status) === '待校准') {
      const back = assertFlow(updated, '考察中')
      if (back) {
        return back
      }
      updated = { ...updated, status: '考察中', 考察状态: '考察中' }
    }
    saveOne(rows, id, updated)
    return {
      ok: true,
      message: `考察结果已按实测值入库（冲突时以实测为准）；与计划条件存在冲突，已生成变更控制待办 ${change['变更编号']}，评估闭环前不能确认完成`,
    }
  }

  updated = { ...updated, 条件冲突: false, 冲突说明: '', abnormal: false }
  if (String(row.status) === '待校准') {
    // 校准后重录达标：回到考察中，再按顺序完成。
    const back = assertFlow(updated, '考察中')
    if (back) {
      return back
    }
    updated = { ...updated, status: '考察中', 考察状态: '考察中' }
  }
  saveOne(rows, id, updated)
  return { ok: true, message: '考察结果已写库（单份），实测条件与计划条件一致' }
}

// 退回校准：考察中 → 待校准，并挂变更控制校准待办。
export function returnToCalibrate(id: number): ActionResult {
  const rows = getStabilityRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  const blocked = assertFlow(row, '待校准')
  if (blocked) {
    return blocked
  }
  const change = ensureChangeTodo({
    source: row,
    kind: 'calibrate',
    content: `稳定性考察 ${row['考察编号']}（${row['考察时间点']}·${row['检验项目']}）考察条件精度/设备状态存疑，退回校准。`,
    risk: '考察设备未经校准会使全部时间点数据失效，需评估数据是否有效。',
  })
  saveOne(rows, id, {
    ...attachChangeId(row, String(change['变更编号'])),
    status: '待校准',
    考察状态: '待校准',
    pending: true,
    冲突说明: row['冲突说明'] || '已退回校准',
  })
  return { ok: true, message: `已退回「待校准」，变更控制待办 ${change['变更编号']}` }
}

// 确认完成：考察中 → 已完成。必须已有结果、无未决冲突待办，且只能逐级到达。
export function completeEntry(id: number): ActionResult {
  const rows = getStabilityRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  const blocked = assertFlow(row, '已完成')
  if (blocked) {
    return blocked
  }
  if (!String(row['考察结果'] ?? '').trim()) {
    return { ok: false, message: '尚未录入考察结果，不能确认完成' }
  }
  if (row['条件冲突'] && hasOpenChange(row)) {
    return { ok: false, message: '实测条件与计划条件冲突，按规则以实测结果为准；关联变更控制待办尚未闭环，暂不能完成' }
  }
  saveOne(rows, id, { ...row, status: '已完成', 考察状态: '已完成', pending: false })
  return { ok: true, message: `考察 ${row['考察编号']} 已完成` }
}

// 终止考察：活动状态可终止，终止为终态。
export function terminateEntry(id: number): ActionResult {
  const rows = getStabilityRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  const blocked = assertFlow(row, '已终止')
  if (blocked) {
    return blocked
  }
  saveOne(rows, id, { ...row, status: '已终止', 考察状态: '已终止', pending: false })
  return { ok: true, message: `考察 ${row['考察编号']} 已终止` }
}

export function isActive(row: EntryRow): boolean {
  return ACTIVE_STATUSES.includes(String(row.status))
}
