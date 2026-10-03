/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 业务唯一键字段：登记时同值视为重复，只保留一条。 */
  keyField?: string
  /** 登记时允许留空的字段；其余字段必须有值。 */
  optionalFields?: string[]
  /**
   * 动作 -> 允许发起该动作的当前状态。
   * 未配置的模块沿用旧行为（不做逐级校验）；配置后只允许从列出的状态发起，
   * 即状态只能一步步推进，跳级会被挡回。
   */
  actionSources?: Record<string, string[]>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 本次流转后记录所处的状态。 */
  status?: string
  /** 命中了重复提交/重复待办，未重复写库。 */
  idempotent?: boolean
  /** 本次动作是否在变更控制模块登记了待办。 */
  createdTodo?: boolean
}

export type CreateResult = {
  ok: boolean
  message: string
  entry?: EntryRow
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
