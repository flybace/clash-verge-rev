import {
  DeleteForeverRounded,
  InfoOutlineRounded,
  RadarRounded,
  SearchRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  AutoDetectEntry,
  AutoDetectStatus,
} from '@/hooks/use-auto-detect'
import { useProxiesData } from '@/providers/app-data-context'
import {
  autoDetectAddManualRule,
  autoDetectProbeDomain,
  restartCore,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'


const STATUS_COLOR: Record<AutoDetectStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  queued: 'default',
  probing: 'info',
  'direct-ok': 'success',
  'proxy-testing': 'info',
  added: 'warning',
  'proxy-failed': 'error',
  failed: 'error',
}

/** 从用户输入中提取域名：支持裸域名或完整 URL。 */
const extractDomain = (input: string): string => {
  const s = input.trim().toLowerCase()
  if (!s) return ''
  try {
    // 带协议头的按 URL 解析
    if (s.includes('://')) return new URL(s).hostname.trim().replace(/\.$/, '')
  } catch {
    /* 继续按裸域名处理 */
  }
  return s
    .split('/')[0]
    .split(':')[0]
    .split('?')[0]
    .trim()
    .replace(/\.$/, '')
}

interface Props {
  enabled: boolean
  setEnabled: (v: boolean) => void
  entries: AutoDetectEntry[]
  ignoreDomain: (domain: string) => void
}

export const AutoDetectPanel = ({
  enabled,
  setEnabled,
  entries,
  ignoreDomain,
}: Props) => {
  const { t } = useTranslation()
  const { proxyView } = useProxiesData()

  // 手动检测
  const [manualInput, setManualInput] = useState('')
  const [manualProbing, setManualProbing] = useState(false)
  const [manualResult, setManualResult] = useState<
    'idle' | 'direct-ok' | 'need-proxy' | 'error'
  >('idle')
  const [manualGroup, setManualGroup] = useState('Proxy')
  const [manualAdding, setManualAdding] = useState(false)

  const groupNames = useMemo(() => {
    const names = (proxyView?.groups ?? []).map((g) => g.name).filter(Boolean)
    const base = ['Proxy', 'DIRECT']
    for (const n of names) if (!base.includes(n)) base.push(n)
    return base
  }, [proxyView])

  const onManualProbe = async () => {
    const domain = extractDomain(manualInput)
    if (!domain) {
      showNotice.error(t('connections.autoDetect.manual.inputRequired'))
      return
    }
    setManualProbing(true)
    setManualResult('idle')
    try {
      const directOk = await autoDetectProbeDomain(domain)
      setManualResult(directOk ? 'direct-ok' : 'need-proxy')
    } catch {
      setManualResult('error')
    } finally {
      setManualProbing(false)
    }
  }

  const onManualAdd = async () => {
    const domain = extractDomain(manualInput)
    if (!domain || !manualGroup) return
    setManualAdding(true)
    try {
      await autoDetectAddManualRule(domain, manualGroup)
      await restartCore().catch(() => {})
      showNotice.success(
        t('connections.autoDetect.manual.added', {
          domain,
          group: manualGroup,
        }),
      )
      setManualInput('')
      setManualResult('idle')
    } catch (e) {
      showNotice.error(t('connections.autoDetect.manual.addFailed'), e)
    } finally {
      setManualAdding(false)
    }
  }

  return (
    <Box
      sx={{
        mx: '10px',
        mb: 0.5,
        px: 1.5,
        py: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <RadarRounded fontSize="small" color="primary" />
        <Typography variant="subtitle2">
          {t('connections.autoDetect.title')}
        </Typography>
        <Tooltip title={t('connections.autoDetect.hint')}>
          <InfoOutlineRounded fontSize="small" color="disabled" />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {entries.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t('connections.autoDetect.detected', { count: entries.length })}
          </Typography>
        )}
        <Switch
          size="small"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </Box>
      {entries.length > 0 && (
        <Box
          sx={{
            mt: 1,
            maxHeight: 160,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          {entries.map((e) => (
            <Box
              key={e.domain}
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', fontSize: 13 }}
              >
                {e.domain}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={STATUS_COLOR[e.status]}
                label={t(`connections.autoDetect.status.${e.status}`)}
              />
              {e.status === 'added' && e.added > 0 && (
                <Typography variant="caption" color="text.secondary">
                  +{e.added}
                </Typography>
              )}
              {e.status === 'added' && e.group && (
                <Typography variant="caption" color="text.secondary">
                  → {e.group}
                </Typography>
              )}
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('connections.autoDetect.ignore')}>
                <IconButton size="small" onClick={() => ignoreDomain(e.domain)}>
                  <DeleteForeverRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}

      {/* 手动检测：输入网址 -> 探测 -> 自选分组添加 */}
      <Box
        sx={{
          mt: 1,
          pt: 1,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <TextField
          size="small"
          sx={{ flex: '1 1 180px', minWidth: 140 }}
          placeholder={t('connections.autoDetect.manual.placeholder')}
          value={manualInput}
          onChange={(e) => {
            setManualInput(e.target.value)
            setManualResult('idle')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void onManualProbe()
            }
          }}
          slotProps={{
            input: {
              endAdornment: manualProbing ? (
                <CircularProgress size={16} />
              ) : undefined,
            },
          }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<SearchRounded />}
          disabled={manualProbing || !manualInput.trim()}
          onClick={() => void onManualProbe()}
        >
          {t('connections.autoDetect.manual.probe')}
        </Button>
        {manualResult === 'direct-ok' && (
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={t('connections.autoDetect.manual.directOk')}
          />
        )}
        {manualResult === 'need-proxy' && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={t('connections.autoDetect.manual.needProxy')}
          />
        )}
        {manualResult === 'error' && (
          <Chip
            size="small"
            color="error"
            variant="outlined"
            label={t('connections.autoDetect.manual.probeFailed')}
          />
        )}
        {manualResult !== 'idle' && manualResult !== 'error' && (
          <>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>
                {t('connections.autoDetect.manual.group')}
              </InputLabel>
              <Select
                value={manualGroup}
                label={t('connections.autoDetect.manual.group')}
                onChange={(e) => setManualGroup(e.target.value)}
              >
                {groupNames.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="contained"
              disabled={manualAdding}
              onClick={() => void onManualAdd()}
            >
              {t('connections.autoDetect.manual.add')}
            </Button>
          </>
        )}
      </Box>
    </Box>
  )
}
