import type { EntryRow } from '@/data/types'

// 稳定性考察的领域规则：考察条件与考察结果同源（都读库中同一行），冲突时以「登记在库的考察条件」为准。
// 这里不做任何现算兜底：条件解析不出来就是精度不够，结果对不上条件就是冲突，由服务层挡回。

export type Point = {
  /** 中心点（℃ 或 %） */
  center: number
  /** 允差（半宽，>=0） */
  tolerance: number
}

export type ConditionCheck = {
  ok: boolean
  message: string
  temperature?: Point
  humidity?: Point
}

export type ResultCheck = {
  ok: boolean
  message: string
}

// 温度：25℃±2℃ / 25°C ±2 均可，允差必须有值。
const TEMPERATURE_RE = /(-?\d+(?:\.\d+)?)\s*[℃°c]\s*[±\+\-]\s*(\d+(?:\.\d+)?)/i
// 湿度：60%RH±5% / 相对湿度60%±5 / 60 ± 5 % 均可。
const HUMIDITY_RE = /(\d+(?:\.\d+)?)\s*%?\s*(?:RH|相对湿度)?\s*[±\+\-]\s*(\d+(?:\.\d+)?)\s*%?/i

function parsePoint(raw: string, re: RegExp): Point | undefined {
  const matched = raw.match(re)
  if (!matched) {
    return undefined
  }
  const center = Number(matched[1])
  const tolerance = Number(matched[2])
  if (!Number.isFinite(center) || !Number.isFinite(tolerance) || tolerance < 0) {
    return undefined
  }
  return { center, tolerance }
}

/** 考察条件必须同时给出温度、湿度的中心值与允差，否则精度不够，退回校准。 */
export function checkCondition(condition: string): ConditionCheck {
  const text = condition.trim()
  if (!text) {
    return { ok: false, message: '考察条件为空，无法判定，请退回校准后重新登记' }
  }
  const temperature = parsePoint(text, TEMPERATURE_RE)
  if (!temperature) {
    return {
      ok: false,
      message: '考察条件精度不够：温度须写明中心值与允差（如 25℃±2℃），请退回校准',
    }
  }
  const humidity = parsePoint(text, HUMIDITY_RE)
  if (!humidity) {
    return {
      ok: false,
      message: '考察条件精度不够：相对湿度须写明中心值与允差（如 60%RH±5%），请退回校准',
    }
  }
  return { ok: true, message: '', temperature, humidity }
}

// 结果读数：温度 25.3℃、湿度 62%RH（相对湿度62% / RH62）均可。湿度必须带湿度标识，避免误读到温度数。
const TEMPERATURE_RESULT_RE = /(-?\d+(?:\.\d+)?)\s*[℃°c]/i
const HUMIDITY_RESULT_RE = /(?:相对湿度|湿度|RH)\s*[:：]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*%\s*RH/i

function parseResult(result: string): { temperature?: number; humidity?: number } {
  const temperatureMatch = result.match(TEMPERATURE_RESULT_RE)
  const humidityMatch = result.match(HUMIDITY_RESULT_RE)
  const humidityRaw = humidityMatch ? humidityMatch[1] ?? humidityMatch[2] : undefined
  return {
    temperature: temperatureMatch ? Number(temperatureMatch[1]) : undefined,
    humidity: humidityRaw !== undefined ? Number(humidityRaw) : undefined,
  }
}

/**
 * 考察结果与考察条件冲突时，以登记在库的考察条件为准：
 * 结果读数必须落在条件允差内，读不出数值同样挡回，不允许结果覆盖条件。
 */
export function checkResultAgainstCondition(condition: string, result: string): ResultCheck {
  const conditionCheck = checkCondition(condition)
  if (!conditionCheck.ok) {
    return { ok: false, message: conditionCheck.message }
  }
  const text = result.trim()
  if (!text) {
    return { ok: false, message: '考察结果为空，请先填写温度与湿度读数' }
  }
  const measured = parseResult(text)
  if (measured.temperature === undefined || measured.humidity === undefined) {
    return {
      ok: false,
      message: '考察结果须包含温度与湿度读数（如 温度25.3℃，湿度62%RH）',
    }
  }
  const temperature = conditionCheck.temperature as Point
  const humidity = conditionCheck.humidity as Point
  if (Math.abs(measured.temperature - temperature.center) > temperature.tolerance) {
    return {
      ok: false,
      message: `温度读数 ${measured.temperature}℃ 超出考察条件 ${condition} 的允差；考察条件与考察结果冲突时以登记在库的考察条件为准，请校准后重试`,
    }
  }
  if (Math.abs(measured.humidity - humidity.center) > humidity.tolerance) {
    return {
      ok: false,
      message: `湿度读数 ${measured.humidity}%RH 超出考察条件 ${condition} 的允差；考察条件与考察结果冲突时以登记在库的考察条件为准，请校准后重试`,
    }
  }
  return { ok: true, message: '' }
}

/** 提取条件摘要用于待办描述，失败时原样返回。 */
export function conditionSummary(row: EntryRow): string {
  const condition = String(row['考察条件'] ?? '').trim()
  const check = checkCondition(condition)
  if (!check.ok) {
    return condition || '（考察条件缺失）'
  }
  return condition
}
