import { create } from 'zustand'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'frontend' | 'backend'

export type LogLine = {
  id: string
  ts: string
  level: LogLevel
  source: LogSource
  message: string
  meta?: Record<string, any>
}

const FE_PERSIST_KEY = 'stonegate.logs.frontend.persist'
const BE_PERSIST_KEY = 'stonegate.logs.backend.persist'
const FE_LOGS_KEY = 'stonegate.logs.frontend.v1'
const BE_LOGS_KEY = 'stonegate.logs.backend.v1'

const MAX_LINES = 2000

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function readBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return v === 'true'
  } catch {
    return fallback
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function del(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

type LogState = {
  frontendLogs: LogLine[]
  backendLogs: LogLine[]
  persistFrontend: boolean
  persistBackend: boolean

  logFrontend: (message: string, level?: LogLevel, meta?: Record<string, any>) => void
  logBackend: (message: string, level?: LogLevel, meta?: Record<string, any>) => void

  clearFrontend: () => void
  clearBackend: () => void

  setPersistFrontend: (on: boolean) => void
  setPersistBackend: (on: boolean) => void
}

export const useLogStore = create<LogState>((set, get) => {
  const persistFrontend = readBool(FE_PERSIST_KEY, false)
  const persistBackend = readBool(BE_PERSIST_KEY, false)

  const initialFrontend = persistFrontend ? readJson<LogLine[]>(FE_LOGS_KEY, []) : []
  const initialBackend = persistBackend ? readJson<LogLine[]>(BE_LOGS_KEY, []) : []

  const push = (arr: LogLine[], line: LogLine) => {
    const next = [...arr, line]
    if (next.length > MAX_LINES) return next.slice(next.length - MAX_LINES)
    return next
  }

  const maybePersist = () => {
    const s = get()
    if (s.persistFrontend) writeJson(FE_LOGS_KEY, s.frontendLogs)
    if (s.persistBackend) writeJson(BE_LOGS_KEY, s.backendLogs)
  }

  return {
    frontendLogs: initialFrontend,
    backendLogs: initialBackend,
    persistFrontend,
    persistBackend,

    logFrontend: (message, level = 'info', meta) => {
      set(state => ({
        frontendLogs: push(state.frontendLogs, { id: newId(), ts: nowIso(), level, source: 'frontend', message, meta }),
      }))
      maybePersist()
    },

    logBackend: (message, level = 'info', meta) => {
      set(state => ({
        backendLogs: push(state.backendLogs, { id: newId(), ts: nowIso(), level, source: 'backend', message, meta }),
      }))
      maybePersist()
    },

    clearFrontend: () => {
      set({ frontendLogs: [] })
      del(FE_LOGS_KEY)
    },

    clearBackend: () => {
      set({ backendLogs: [] })
      del(BE_LOGS_KEY)
    },

    setPersistFrontend: (on) => {
      set({ persistFrontend: on })
      try { localStorage.setItem(FE_PERSIST_KEY, on ? 'true' : 'false') } catch {}
      if (on) writeJson(FE_LOGS_KEY, get().frontendLogs)
      else del(FE_LOGS_KEY)
    },

    setPersistBackend: (on) => {
      set({ persistBackend: on })
      try { localStorage.setItem(BE_PERSIST_KEY, on ? 'true' : 'false') } catch {}
      if (on) writeJson(BE_LOGS_KEY, get().backendLogs)
      else del(BE_LOGS_KEY)
    },
  }
})

// Convenience helpers for non-hook call sites.
export const logFrontend = (message: string, level: LogLevel = 'info') => {
  try {
    useLogStore.getState().logFrontend(message, level)
  } catch {}
}

export const logBackend = (message: string, level: LogLevel = 'info', meta?: Record<string, any>) => {
  try {
    useLogStore.getState().logBackend(message, level, meta)
  } catch {}
}
