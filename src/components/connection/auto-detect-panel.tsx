import {
  DeleteForeverRounded,
  InfoOutlinedRounded,
  RadarRounded,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

import type {
  AutoDetectEntry,
  AutoDetectStatus,
} from '@/hooks/use-auto-detect'

const STATUS_COLOR: Record<AutoDetectStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  queued: 'default',
  probing: 'info',
  'direct-ok': 'success',
  added: 'warning',
  failed: 'error',
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
          <InfoOutlinedRounded fontSize="small" color="disabled" />
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
    </Box>
  )
}
