import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
// 数据结构/示例数据调整时升版本，旧浏览器里的残留数据会被新种子整体替换，避免旧值与新规则并存。
const STORAGE_VERSION = 2
const VERSION_KEY = 'pharma-cleanroom:entries:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeSeed(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
  return fallback
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_ROWS)
  }
  const version = window.localStorage.getItem(VERSION_KEY)
  if (version !== String(STORAGE_VERSION)) {
    return writeSeed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return writeSeed()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...clone(SEED_ROWS), ...parsed }
  } catch {
    return writeSeed()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
