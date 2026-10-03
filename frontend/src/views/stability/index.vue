<template>
  <section class="page" data-module="stability">
    <header class="page-head">
      <div>
        <h2>稳定性考察管理</h2>
        <p class="page-desc">维护稳定性考察记录，围绕考察编号、考察批号、考察条件、考察时间点做登记、筛选与状态流转。考察条件与考察结果统一写库，列表、详情、弹窗只从库中同一行取值。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记稳定性考察记录</button>
        <button class="btn" type="button" @click="exportRows">导出稳定性考察清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in displayColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in displayColumns" :key="column">
            <button v-if="column === '考察编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</template>
          </td>
          <td><span class="badge">{{ row.status }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!canRun(action, row)"
              :class="{ 'action-disabled': !canRun(action, row) }"
              @click="openSubmit(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="displayColumns.length + 2" class="empty-state">暂无稳定性考察数据，可先登记稳定性考察记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条稳定性考察记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <!-- 登记弹窗 -->
    <div v-if="createVisible" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <div class="modal-head">
          <h3>登记稳定性考察记录</h3>
          <button class="modal-close" type="button" @click="closeCreate">×</button>
        </div>
        <div class="modal-body">
          <p class="form-hint">
            考察条件须写明温度、相对湿度的中心值与允差（如：25℃±2℃，60%RH±5%）；精度不够将在提交时退回校准。
            同一考察编号只能登记一条，重复登记会被挡回。考察状态由系统按状态机回填。
          </p>
          <div class="form-grid">
            <label v-for="field in requiredFields" :key="field" class="form-field">
              <span>{{ field }}<em class="req">*</em></span>
              <input v-model="createForm[field]" :placeholder="fieldPlaceholder(field)" />
            </label>
            <label v-for="field in optionalFields" :key="field" class="form-field">
              <span>{{ field }}（可后补）</span>
              <input v-model="createForm[field]" :placeholder="`选填：${field}`" />
            </label>
          </div>
          <p v-if="createError" class="source-note error-text">{{ createError }}</p>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存登记</button>
        </div>
      </div>
    </div>

    <!-- 提交考察弹窗：考察结果在这一步写库，与库中考察条件比对，冲突以在库条件为准 -->
    <div v-if="submitVisible" class="modal-mask" @click.self="closeSubmit">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ submitAction }} · {{ submitForm['考察编号'] }}</h3>
          <button class="modal-close" type="button" @click="closeSubmit">×</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid">
            <div class="detail-item full">
              <span>考察条件（库中登记值，以此为准）</span>
              <strong>{{ submitForm['考察条件'] }}</strong>
            </div>
            <div class="detail-item">
              <span>考察批号</span>
              <strong>{{ submitForm['考察批号'] }}</strong>
            </div>
            <div class="detail-item">
              <span>考察时间点</span>
              <strong>{{ submitForm['考察时间点'] }}</strong>
            </div>
          </div>
          <p class="form-hint" style="margin-top: 12px;">
            考察结果须含温度、湿度读数（如：温度25.3℃，湿度62%RH）。结果超出条件允差会被挡回，
            条件与结果冲突时以登记在库的考察条件为准。
          </p>
          <div class="form-grid">
            <label class="form-field full">
              <span>考察结果<em class="req">*</em></span>
              <textarea v-model="submitForm['考察结果']" placeholder="温度25.3℃，湿度62%RH"></textarea>
            </label>
            <label class="form-field">
              <span>检验项目（可补填）</span>
              <input v-model="submitForm['检验项目']" placeholder="如：性状、含量、有关物质" />
            </label>
            <label class="form-field">
              <span>考察人（可补填）</span>
              <input v-model="submitForm['考察人']" placeholder="考察人" />
            </label>
          </div>
          <p v-if="submitError" class="source-note error-text">{{ submitError }}</p>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeSubmit">取消</button>
          <button class="btn primary" type="button" @click="confirmSubmit">{{ submitAction }}</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗：整页只此一个实例，数据按编号读库中同一行，不再现算 -->
    <div v-if="detailId !== null" class="modal-mask" @click.self="closeDetail">
      <div class="modal wide">
        <div class="modal-head">
          <h3>考察详情 · {{ detailEntry?.['考察编号'] ?? '' }}</h3>
          <button class="modal-close" type="button" @click="closeDetail">×</button>
        </div>
        <div class="modal-body" v-if="detailEntry">
          <div class="detail-grid">
            <div v-for="field in displayColumns" :key="field" class="detail-item" :class="{ full: field === '考察条件' || field === '考察结果' }">
              <span>{{ field }}</span>
              <strong>{{ detailEntry[field] === '' ? '待填写' : (detailEntry[field] ?? '—') }}</strong>
            </div>
            <div class="detail-item">
              <span>当前状态</span>
              <strong><span class="badge">{{ detailEntry.status }}</span></strong>
            </div>
            <div class="detail-item">
              <span>数据来源</span>
              <strong>库中登记值（与列表同源）</strong>
            </div>
          </div>
          <p class="source-note">
            考察条件与考察结果同一份：列表、侧栏、弹窗均读库中该编号这一行，刷新、返回列表不会跳数；
            条件与结果冲突时，以登记在库的考察条件为准；条件精度不够时退回校准。
          </p>
          <p v-if="detailMessage" class="source-note" :class="detailOk ? 'notice-text' : 'error-text'">{{ detailMessage }}</p>
        </div>
        <div class="modal-foot">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            :disabled="!canRun(action, detailEntry)"
            @click="openSubmit(action, detailEntry)"
          >
            {{ action }}
          </button>
          <button class="btn primary" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stability')
// 表格不重复展示「考察状态」列：它与「当前状态」同源同步，避免一份状态两处读。
const displayColumns = meta.fields.filter((field) => field !== '考察状态')
const requiredFields = ['考察编号', '考察批号', '考察条件', '考察时间点']
// 考察状态由系统回填，不进登记表单；它只在校验白名单里（见 modules.ts optionalFields）。
const optionalFields = (meta.optionalFields ?? []).filter((field) => field !== '考察状态')
const actions = ['提交考察', '确认完成', '终止考察']
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['考察编号', '考察批号', '考察条件']

const stats = computed(() => [
  { label: '待考察批次', value: rows.value.filter((row) => row.status === '待考察').length },
  { label: '考察中批次', value: rows.value.filter((row) => row.status === '考察中').length },
  { label: '已完成考察数', value: rows.value.filter((row) => row.status === '已完成').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 动作只允许从状态机登记的来源状态发起；页面与服务层同一套规则。
function canRun(action: string, row: EntryRow | undefined | null): boolean {
  if (!row) {
    return false
  }
  const allowed = meta.actionSources?.[action] ?? []
  return allowed.includes(String(row.status))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '稳定性考察列表读取失败'
  }
}

function emptyForm(fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, '']))
}

// 登记弹窗
const createVisible = ref(false)
const createForm = ref<Record<string, string>>(emptyForm([...requiredFields, ...optionalFields]))
const createError = ref('')

function openCreate() {
  createForm.value = emptyForm([...requiredFields, ...optionalFields])
  createError.value = ''
  createVisible.value = true
}

function closeCreate() {
  createVisible.value = false
}

function fieldPlaceholder(field: string): string {
  if (field === '考察条件') {
    return '如：25℃±2℃，60%RH±5%'
  }
  if (field === '考察时间点') {
    return '如：2026-10-03'
  }
  return field
}

function submitCreate() {
  createError.value = ''
  const result = createEntry(meta.key, createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createVisible.value = false
  reload()
  noticeMessage.value = result.message
}

// 提交考察弹窗（确认完成/终止考察直接执行，无需填结果）
const submitVisible = ref(false)
const submitAction = ref('')
const submitId = ref<number | null>(null)
const submitForm = ref<Record<string, string>>({})
const submitError = ref('')

function openSubmit(action: string, row: EntryRow | undefined) {
  if (!canRun(action, row)) {
    errorMessage.value = `「${action}」在当前状态下不可执行，状态只能一步步推进`
    return
  }
  const target = row as EntryRow
  closeDetail()
  submitAction.value = action
  submitId.value = Number(target.id)
  submitError.value = ''
  if (action === '提交考察') {
    // 弹窗里回显的是库中这一行的登记值，不做任何现算。
    submitForm.value = {
      考察编号: String(target['考察编号'] ?? ''),
      考察批号: String(target['考察批号'] ?? ''),
      考察条件: String(target['考察条件'] ?? ''),
      考察时间点: String(target['考察时间点'] ?? ''),
      检验项目: String(target['检验项目'] ?? ''),
      考察结果: String(target['考察结果'] ?? ''),
      考察人: String(target['考察人'] ?? ''),
    }
    submitVisible.value = true
    return
  }
  executeAction(action)
}

function closeSubmit() {
  submitVisible.value = false
  submitId.value = null
}

function confirmSubmit() {
  executeAction(submitAction.value, {
    考察结果: submitForm.value['考察结果'] ?? '',
    检验项目: submitForm.value['检验项目'] ?? '',
    考察人: submitForm.value['考察人'] ?? '',
  })
}

function executeAction(action: string, payload?: Record<string, string>) {
  if (submitId.value === null) {
    return
  }
  const result = applyAction(meta.key, submitId.value, action, payload)
  if (!result.ok) {
    // 精度退回校准、结果冲突这类拦截：提交弹窗开着就显示在弹窗里，否则显示在页脚。
    reload()
    if (submitVisible.value) {
      submitError.value = result.message
    } else {
      errorMessage.value = result.message
    }
    return
  }
  const wasDetailOpen = detailId.value !== null
  submitVisible.value = false
  submitId.value = null
  reload()
  if (wasDetailOpen) {
    detailMessage.value = result.message
    detailOk.value = result.ok
  } else {
    noticeMessage.value = result.message
  }
}

// 详情弹窗：只保留一个实例，按 id 从库里取，刷新/返回都还是同一份。
const detailId = ref<number | null>(null)
const detailMessage = ref('')
const detailOk = ref(true)

const detailEntry = computed<EntryRow | undefined>(() =>
  detailId.value === null ? undefined : getEntry(meta.key, detailId.value),
)

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
  detailMessage.value = ''
  detailOk.value = true
}

function closeDetail() {
  detailId.value = null
  detailMessage.value = ''
}

onMounted(reload)
</script>
