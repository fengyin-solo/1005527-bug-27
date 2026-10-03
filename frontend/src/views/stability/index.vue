<template>
  <section class="page" data-module="stability">
    <header class="page-head">
      <div>
        <h2>稳定性考察管理</h2>
        <p class="page-desc">
          考察条件（计划/实测）与考察结果统一写库、单份存储；列表、详情、弹窗同源读取。状态逐级推进，冲突以实测结果为准并联动变更控制。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记稳定性考察记录</button>
        <button class="btn" type="button" @click="exportRows">导出稳定性考察清单</button>
      </div>
    </header>

    <div class="rule-banner">
      <strong>业务规则（已固化）：</strong>
      <span>① 计划考察条件 / 实测考察条件 / 考察结果一次写库，考察结果只存一份，各处读取同源；</span>
      <span>② 状态只能逐级推进：待考察 → 考察中 → 已完成，条件不达标走「考察中 ⇄ 待校准」回路，跳级一律挡回；</span>
      <span>③ 同一考察编号 + 时间点 + 检验项目重复提交只记一次；</span>
      <span>④ 条件与结果冲突时<em>以实测考察结果为准</em>，并在变更控制生成评估待办，闭环前不得完成；</span>
      <span>⑤ 条件精度门槛：温度允差 ≤±2℃、湿度允差 ≤±5%RH，精度不够退回校准。</span>
    </div>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item change-legend">变更控制未决待办：{{ openChangeCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table stability-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in groupedRows" :key="group.no">
          <tr class="group-row" @click="openDetail(group.rows[0].id)">
            <td :colspan="columns.length + 2">
              <span class="group-caret">▸</span>
              考察编号 {{ group.no }}
              <span class="group-meta">批号 {{ group.lot }} · {{ group.rows.length }} 个时间点/检验项目</span>
            </td>
          </tr>
          <tr
            v-for="row in group.rows"
            :key="String(row.id)"
            :class="{ selected: selectedId === row.id, conflict: row['条件冲突'] }"
            @click="openDetail(row.id)"
          >
            <td class="cell-sub">{{ row['考察编号'] }}</td>
            <td>{{ row['考察批号'] ?? '—' }}</td>
            <td>{{ row['计划考察条件'] ?? '—' }}</td>
            <td>{{ row['实测考察条件'] || '待实测' }}</td>
            <td>{{ row['考察时间点'] ?? '—' }}</td>
            <td>{{ row['检验项目'] ?? '—' }}</td>
            <td>{{ row['考察结果'] || '—' }}</td>
            <td>{{ row['考察人'] ?? '—' }}</td>
            <td>
              <span class="status-pill" :data-status="row.status">{{ row.status }}</span>
              <span v-if="row['条件冲突']" class="conflict-flag">冲突待评估</span>
            </td>
            <td class="row-actions" @click.stop>
              <template v-for="action in availableActions(row)" :key="action.key">
                <button class="link" type="button" @click="runAction(action.key, row)">
                  {{ action.label }}
                </button>
              </template>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无稳定性考察数据，可先登记稳定性考察记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条考察时间点记录（{{ groupedRows.length }} 个考察编号，同编号分组展示，不重复成两份）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <!-- 详情抽屉：不挂旧值，打开即按 id 从同一份 store 现读，写入后立即同步 -->
    <aside v-if="detailRow" class="drawer-mask" @click.self="closeDetail">
      <div class="drawer">
        <header class="drawer-head">
          <h3>考察详情 · {{ detailRow['考察编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ muted: !detailRow[field] }">{{ detailRow[field] || (field === '实测考察条件' || field === '考察结果' ? '尚未录入' : '—') }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd><span class="status-pill" :data-status="detailRow.status">{{ detailRow.status }}</span></dd>
          <dt>冲突裁定</dt>
          <dd>
            <template v-if="detailRow['条件冲突']">
              <p class="conflict-text">{{ detailRow['冲突说明'] }}</p>
              <p class="rule-text">规则：条件与结果冲突时以实测考察结果为准，计划条件不覆盖实测值。</p>
            </template>
            <span v-else class="muted">无冲突</span>
          </dd>
          <dt>关联变更控制</dt>
          <dd>
            <ul v-if="detailChanges.length" class="change-list">
              <li v-for="change in detailChanges" :key="change.no">
                <RouterLink class="link" to="/changecontrol">{{ change.no }}</RouterLink>
                <span class="status-pill" :data-status="change.status">{{ change.status }}</span>
                <span class="muted">{{ change.content }}</span>
              </li>
            </ul>
            <span v-else class="muted">无</span>
          </dd>
        </dl>
        <footer class="drawer-actions">
          <template v-for="action in availableActions(detailRow)" :key="action.key">
            <button class="btn" :class="{ primary: action.key === 'complete' }" type="button" @click="runAction(action.key, detailRow)">
              {{ action.label }}
            </button>
          </template>
        </footer>
      </div>
    </aside>

    <!-- 登记弹窗 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记稳定性考察记录</h3>
        <label v-for="field in createFields" :key="field" class="modal-field">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="field === '计划考察条件' ? '例：25℃±2℃、60%RH±5%RH' : `请输入${field}`" />
        </label>
        <p class="modal-hint">复合键：考察编号 + 考察时间点 + 检验项目，重复登记会被挡回。</p>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <footer class="modal-actions">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="submit">登记入库</button>
        </footer>
      </form>
    </div>

    <!-- 录入结果弹窗 -->
    <div v-if="resultTarget" class="modal-mask" @click.self="resultTarget = null">
      <form class="modal" @submit.prevent="submitResult">
        <h3>录入考察结果 · {{ resultTarget['考察编号'] }}（{{ resultTarget['考察时间点'] }}·{{ resultTarget['检验项目'] }}）</h3>
        <p class="modal-hint">
          计划考察条件：{{ resultTarget['计划考察条件'] }}（只读基准，不允许修改）。
          实测条件与结果是唯一结果来源，冲突时以实测为准并转变更控制。
        </p>
        <label class="modal-field">
          <span>实测考察条件</span>
          <input v-model="resultForm.实测考察条件" placeholder="例：25.4℃±1℃、61%RH±3%RH" />
        </label>
        <label class="modal-field">
          <span>考察结果</span>
          <textarea v-model="resultForm.考察结果" rows="3" placeholder="请填写实测结果与判定"></textarea>
        </label>
        <label class="modal-field">
          <span>考察人</span>
          <input v-model="resultForm.考察人" />
        </label>
        <p v-if="resultError" class="error-text">{{ resultError }}</p>
        <footer class="modal-actions">
          <button class="btn" type="button" @click="resultTarget = null">取消</button>
          <button class="btn primary" type="submit">保存结果</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, filterRows } from '@/api/local-service'
import {
  STABILITY_FIELDS,
  completeEntry,
  createStabilityEntry,
  findRow,
  getStabilityRows,
  hasOpenChange,
  linkedChangeSummary,
  recordResult,
  returnToCalibrate,
  submitEntry,
  terminateEntry,
} from '@/api/stability-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const session = useSessionStore()

// 列头沿用模块字段，字段写库与展示一一对应；考察结果只有一列、一份存储。
const columns = [...STABILITY_FIELDS]
const detailFields = [...STABILITY_FIELDS].filter((field) => field !== '考察状态')
const filterFields = ['考察编号', '考察批号', '计划考察条件']
const statuses = ['待考察', '考察中', '待校准', '已完成', '已终止']

// 单一数据源：所有展示都经 version 从 store 现读，任何写动作 bumpVersion 后全页同步。
// 侧栏（列表）不再挂旧快照，详情抽屉也不另存副本——根治「两边读出来不是一个值、刷新跳数」。
const version = ref(0)
const rows = computed<EntryRow[]>(() => {
  void version.value
  return filterRows(getStabilityRows(), filters)
})
const total = computed(() => rows.value.length)

const filters = reactive<Record<string, string>>({})
const errorMessage = ref('')
const noticeMessage = ref('')
const selectedId = ref<number | null>(null)

function bump() {
  version.value += 1
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  bump()
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function exportRows() {
  downloadEntries('stability')
}

// 同一考察编号分组：同编号的多个时间点在一个分组下渲染，弹窗/列表不会把同编号显示成两份独立记录。
const groupedRows = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows.value) {
    const no = String(row['考察编号'] ?? `#${row.id}`)
    const list = map.get(no) ?? []
    list.push(row)
    map.set(no, list)
  }
  return [...map.entries()].map(([no, groupRows]) => ({
    no,
    lot: String(groupRows[0]['考察批号'] ?? '—'),
    rows: groupRows,
  }))
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: getStabilityRows().filter((row) => {
      void version.value
      return String(row.status) === status
    }).length,
  })),
)

const statsCards = computed(() => {
  void version.value
  const all = getStabilityRows()
  const count = (status: string) => all.filter((row) => String(row.status) === status).length
  return [
    { label: '待考察批次', value: count('待考察') },
    { label: '考察中批次', value: count('考察中') },
    { label: '待校准批次', value: count('待校准') },
    { label: '已完成考察数', value: count('已完成') },
  ]
})

const openChangeCount = computed(() => {
  void version.value
  const seen = new Set<string>()
  for (const row of getStabilityRows()) {
    if (!hasOpenChange(row)) {
      continue
    }
    for (const change of linkedChangeSummary(row)) {
      if (['待评估', '评估中'].includes(change.status)) {
        seen.add(change.no)
      }
    }
  }
  return seen.size
})

// 详情：始终按 id 从 store 读同一行，抽屉里不缓存字段。
const detailRow = computed<EntryRow | null>(() => {
  void version.value
  return selectedId.value === null ? null : findRow(selectedId.value) ?? null
})
const detailChanges = computed(() => (detailRow.value ? linkedChangeSummary(detailRow.value) : []))

function openDetail(id: number) {
  selectedId.value = id
  bump()
}

function closeDetail() {
  selectedId.value = null
}

// 按状态机只放出当前可执行的动作，跳级按钮直接不出现；服务端仍有同样的守卫兜底。
function availableActions(row: EntryRow): { key: string; label: string }[] {
  const actions: { key: string; label: string }[] = []
  switch (String(row.status)) {
    case '待考察':
      actions.push({ key: 'submit', label: '提交考察' })
      break
    case '考察中':
      actions.push({ key: 'result', label: '录入结果' })
      actions.push({ key: 'calibrate', label: '退回校准' })
      actions.push({ key: 'complete', label: '确认完成' })
      break
    case '待校准':
      actions.push({ key: 'result', label: '校准后重录结果' })
      break
    default:
      break
  }
  if (!['已完成', '已终止'].includes(String(row.status))) {
    actions.push({ key: 'terminate', label: '终止考察' })
  }
  return actions
}

function runAction(key: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const id = Number(row.id)
  let result: { ok: boolean; message: string } | null = null
  switch (key) {
    case 'submit':
      result = submitEntry(id)
      break
    case 'complete':
      result = completeEntry(id)
      break
    case 'calibrate':
      result = returnToCalibrate(id)
      break
    case 'terminate':
      result = terminateEntry(id)
      break
    case 'result':
      openResultForm(row)
      return
    default:
      return
  }
  applyResult(result)
}

function applyResult(result: { ok: boolean; message: string } | null) {
  if (!result) {
    return
  }
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
  bump()
}

// 登记弹窗
const createOpen = ref(false)
const createError = ref('')
const createFields = ['考察编号', '考察批号', '计划考察条件', '考察时间点', '检验项目', '考察人']
const createForm = reactive<Record<string, string>>({})

function openCreate() {
  for (const field of createFields) {
    createForm[field] = ''
  }
  createForm['考察人'] = session.operator
  createError.value = ''
  createOpen.value = true
}

function submitCreate() {
  const result = createStabilityEntry({
    考察编号: createForm['考察编号'] ?? '',
    考察批号: createForm['考察批号'] ?? '',
    计划考察条件: createForm['计划考察条件'] ?? '',
    考察时间点: createForm['考察时间点'] ?? '',
    检验项目: createForm['检验项目'] ?? '',
    考察人: createForm['考察人'] ?? '',
  })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  applyResult(result)
}

// 录入结果弹窗
const resultTarget = ref<EntryRow | null>(null)
const resultError = ref('')
const resultForm = reactive({ 实测考察条件: '', 考察结果: '', 考察人: '' })

function openResultForm(row: EntryRow) {
  resultTarget.value = row
  resultForm.实测考察条件 = String(row['实测考察条件'] ?? '')
  resultForm.考察结果 = String(row['考察结果'] ?? '')
  resultForm.考察人 = String(row['考察人'] ?? '') || session.operator
  resultError.value = ''
  // 打开时再同步一次，保证弹窗与列表同源
  bump()
}

function submitResult() {
  if (!resultTarget.value) {
    return
  }
  const result = recordResult(Number(resultTarget.value.id), {
    实测考察条件: resultForm.实测考察条件,
    考察结果: resultForm.考察结果,
    考察人: resultForm.考察人,
  })
  if (!result.ok) {
    resultError.value = result.message
    // 精度挡回会改状态（待校准），刷新弹窗目标与全页数据
    bump()
    const latest = findRow(Number(resultTarget.value?.id ?? -1))
    resultTarget.value = latest ?? null
    return
  }
  resultTarget.value = null
  applyResult(result)
}

onMounted(reload)
</script>

<style scoped>
.rule-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  background: #eef5ff;
  border: 1px solid #b9d4fb;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #334155;
  margin-bottom: 12px;
}
.rule-banner strong {
  color: #1f4fb0;
}
.rule-banner em {
  font-style: normal;
  color: #b42318;
  font-weight: 600;
}
.change-legend {
  background: #fff2e8;
  color: #b54708;
}
.stability-table .group-row td {
  background: #f1f5fb;
  font-weight: 600;
  cursor: pointer;
}
.group-caret {
  color: var(--brand);
  margin-right: 6px;
}
.group-meta {
  font-weight: 400;
  color: var(--muted);
  font-size: 12px;
  margin-left: 10px;
}
.stability-table tbody tr.selected > td {
  background: #e8f0fe;
}
.stability-table tbody tr.conflict > td {
  background: #fef3f2;
}
.cell-sub {
  color: var(--muted);
  padding-left: 22px;
}
.status-pill {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #e2e8f0;
  color: #334155;
}
.status-pill[data-status='考察中'] {
  background: #dbeafe;
  color: #1d4ed8;
}
.status-pill[data-status='待校准'] {
  background: #ffedd5;
  color: #c2410c;
}
.status-pill[data-status='已完成'] {
  background: #dcfce7;
  color: #15803d;
}
.status-pill[data-status='已终止'],
.status-pill[data-status='已拒绝'] {
  background: #fee2e2;
  color: #b91c1c;
}
.status-pill[data-status='待评估'],
.status-pill[data-status='评估中'] {
  background: #fef9c3;
  color: #a16207;
}
.conflict-flag {
  margin-left: 6px;
  color: #b42318;
  font-size: 12px;
}
.notice-text {
  color: #15803d;
}
.drawer-mask,
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.modal-mask {
  justify-content: center;
  align-items: flex-start;
  padding-top: 60px;
}
.drawer {
  width: 480px;
  max-width: 92vw;
  height: 100%;
  background: #fff;
  padding: 16px 18px;
  overflow-y: auto;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.18);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drawer-head h3,
.modal h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px 10px;
  margin: 12px 0;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.muted {
  color: #94a3b8;
}
.conflict-text {
  color: #b42318;
  margin: 0 0 4px;
}
.rule-text {
  color: #b54708;
  margin: 0;
  font-size: 12px;
}
.change-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.drawer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.modal {
  width: 520px;
  max-width: 94vw;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
}
.modal-field {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
}
.modal-field span {
  display: block;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field input,
.modal-field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
.modal-hint {
  font-size: 12px;
  color: var(--muted);
  background: #f8fafc;
  border-radius: 6px;
  padding: 6px 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
