import { useCallback, useEffect, useRef, useState } from 'react'

import {
  autoDetectAddRules,
  autoDetectExpandDomain,
  autoDetectIgnoreDomain,
  autoDetectListIgnored,
  autoDetectListRules,
  autoDetectProbeDomain,
  restartCore,
} from '@/services/cmds'

export type AutoDetectStatus =
  | 'queued'
  | 'probing'
  | 'direct-ok'
  | 'added'
  | 'failed'

export interface AutoDetectEntry {
  domain: string
  status: AutoDetectStatus
  added: number
  updatedAt: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isIpLiteral = (h: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')

const ENABLED_STORAGE_KEY = 'clash-verge-rev:auto-detect-enabled'

const loadEnabled = (): boolean => {
  try {
    return localStorage.getItem(ENABLED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 新域名自动检测：监听命中 MATCH（无规则覆盖）的新域名，
 * 直连探测失败则判定需代理，扩展相关域名后自动加入 Proxy 分组。
 * 开关状态持久化到 localStorage，切换页面/重启后保持。
 */
export function useAutoDetect(active: IConnectionsItem[]) {
  const [enabled, setEnabledState] = useState<boolean>(loadEnabled)
  const [entries, setEntries] = useState<AutoDetectEntry[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const ignoredRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<string[]>([])
  const busyRef = useRef(false)

  const upsert = useCallback(
    (domain: string, patch: Partial<AutoDetectEntry>) => {
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.domain === domain)
        const base: AutoDetectEntry = {
          domain,
          status: 'queued',
          added: 0,
          updatedAt: Date.now(),
        }
        const next = { ...base, ...(idx >= 0 ? prev[idx] : {}), ...patch }
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = next
          return copy
        }
        return [next, ...prev].slice(0, 100)
      })
    },
    [],
  )

  const processOne = useCallback(
    async (domain: string): Promise<number> => {
      upsert(domain, { status: 'probing' })
      try {
        const directOk = await autoDetectProbeDomain(domain)
        if (directOk) {
          upsert(domain, { status: 'direct-ok' })
          return 0
        }
        const lines = await autoDetectExpandDomain(domain)
        const added = await autoDetectAddRules(lines)
        upsert(domain, { status: 'added', added })
        return added
      } catch {
        upsert(domain, { status: 'failed' })
        return 0
      }
    },
    [upsert],
  )

  const pump = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      // 已有规则的域名直接跳过
      const known = new Set(
        (await autoDetectListRules().catch(() => [] as string[]))
          .map((l) => l.split(',')[1])
          .filter(Boolean),
      )
      let totalAdded = 0
      while (queueRef.current.length > 0) {
        const domain = queueRef.current.shift()
        if (!domain) continue
        if (known.has(domain) || ignoredRef.current.has(domain)) {
          upsert(domain, { status: 'direct-ok' })
          continue
        }
        totalAdded += await processOne(domain)
        await sleep(800)
      }
      // 批量处理完只重启一次内核
      if (totalAdded > 0) {
        await restartCore().catch(() => {})
      }
    } finally {
      busyRef.current = false
    }
  }, [processOne, upsert])

  // 开关打开时加载忽略名单
  useEffect(() => {
    if (!enabled) return
    autoDetectListIgnored()
      .then((list) => {
        ignoredRef.current = new Set(list)
      })
      .catch(() => {})
  }, [enabled ])

  // 监听新连接：命中 MATCH 的未知域名入队
  useEffect(() => {
    if (!enabled) return
    const fresh: string[] = []
    for (const c of active) {
      const host = (c.metadata?.host || '').trim().toLowerCase()
      if (!host || isIpLiteral(host)) continue
      if (c.rule !== 'MATCH') continue
      if (seenRef.current.has(host)) continue
      seenRef.current.add(host)
      fresh.push(host)
    }
    if (fresh.length > 0) {
      queueRef.current.push(...fresh)
      setEntries((prev) =>
        [
          ...fresh.map(
            (domain): AutoDetectEntry => ({
              domain,
              status: 'queued',
              added: 0,
              updatedAt: Date.now(),
            }),
          ),
          ...prev,
        ].slice(0, 100),
      )
      void pump()
    }
  }, [enabled, active, pump])

  /** 忽略域名：删除已加规则并加入忽略名单（不再自动添加）。 */
  const ignoreDomain = useCallback(
    async (domain: string) => {
      try {
        await autoDetectIgnoreDomain(domain)
        ignoredRef.current.add(domain)
        setEntries((prev) => prev.filter((e) => e.domain !== domain))
      } catch {
        /* 忽略 */
      }
    },
    [],
  )

  /** 开关：同步写入 localStorage，切换页面/重启后保持。 */
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, v ? '1' : '0')
    } catch {
      /* 忽略 */
    }
  }, [])

  return { enabled, setEnabled, entries, ignoreDomain }
}
