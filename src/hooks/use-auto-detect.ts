import { useCallback, useEffect, useRef, useState } from 'react'
import { delayProxyByName } from 'tauri-plugin-mihomo-api'

import {
  autoDetectAddSite,
  autoDetectIgnoreDomain,
  autoDetectListIgnored,
  autoDetectListRules,
  autoDetectProbeDomain,
  restartCore,
} from '@/services/cmds'
import type { ProxyViewV1 } from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'

export type AutoDetectStatus =
  | 'queued'
  | 'probing'
  | 'direct-ok'
  | 'proxy-testing'
  | 'added'
  | 'proxy-failed'
  | 'failed'

export interface AutoDetectEntry {
  domain: string
  status: AutoDetectStatus
  added: number
  /** 自动创建的站点分组名（added 时） */
  group?: string
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
 * 新域名自动检测：监听命中 MATCH（无规则覆盖）的新域名。
 * 直连探测失败后，自动用代理逐个试出哪个节点能通，规则直接指向该节点；
 * 所有代理都打不开则不加规则。开关状态持久化到 localStorage。
 */
export function useAutoDetect(
  active: IConnectionsItem[],
  proxyView: ProxyViewV1 | undefined,
) {
  const [enabledState, setEnabledState] = useState<boolean>(loadEnabled)
  const [entries, setEntries] = useState<AutoDetectEntry[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const ignoredRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<string[]>([])
  const busyRef = useRef(false)
  // proxyView 引用（避免闭包过期）
  const proxyViewRef = useRef(proxyView)
  proxyViewRef.current = proxyView

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

  /** 代理可用性检测：用 Mihomo 延迟测试 API（自定义 URL）逐个试节点，
   * 返回所有能打开该域名的节点（按延迟从低到高）；都打不开返回空数组。
   * 当前选中的节点优先试，最多试 6 个，单个 8 秒超时。 */
  const findWorkingNodes = useCallback(
    async (domain: string): Promise<string[]> => {
      const view = proxyViewRef.current
      const proxyGroup = view?.groups.find((g) => g.name === 'Proxy')
      if (!proxyGroup) return []
      const nodeNames = proxyGroup.members
        .filter((m) => m.kind === 'node')
        .map((m) => m.name)
      if (nodeNames.length === 0) return []
      // 当前选中的节点优先
      const current = proxyGroup.now
      const ordered =
        current && nodeNames.includes(current)
          ? [current, ...nodeNames.filter((n) => n !== current)]
          : nodeNames
      const testUrl = `https://${domain}/`
      const timeout = 8000
      const working: Array<{ node: string; delay: number }> = []
      for (const node of ordered.slice(0, 6)) {
        try {
          const result = await delayProxyByName(node, testUrl, timeout)
          if (classifyDelay(result.delay, timeout) === 'measured') {
            working.push({ node, delay: result.delay })
          }
        } catch {
          continue
        }
      }
      working.sort((a, b) => a.delay - b.delay)
      return working.map((w) => w.node)
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
        // 直连失败：自动用代理逐个试，找出能通的节点
        upsert(domain, { status: 'proxy-testing' })
        const nodes = await findWorkingNodes(domain)
        if (nodes.length === 0) {
          upsert(domain, { status: 'proxy-failed' })
          return 0
        }
        // 按网站名自动建组（select 类型，成员为测通的节点），规则指向该组
        const group = await autoDetectAddSite(domain, nodes)
        const added = await autoDetectListRules()
          .then((ls) => ls.filter((l) => l.endsWith(`,${group}`)).length)
          .catch(() => 0)
        upsert(domain, { status: 'added', added, group })
        return added
      } catch {
        upsert(domain, { status: 'failed' })
        return 0
      }
    },
    [upsert, findWorkingNodes],
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
    if (!enabledState) return
    autoDetectListIgnored()
      .then((list) => {
        ignoredRef.current = new Set(list)
      })
      .catch(() => {})
  }, [enabledState])

  // 监听新连接：命中 MATCH 的未知域名入队
  useEffect(() => {
    if (!enabledState) return
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
      queueMicrotask(() => {
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
      })
      void pump()
    }
  }, [enabledState, active, pump])

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

  return { enabled: enabledState, setEnabled, entries, ignoreDomain }
}
