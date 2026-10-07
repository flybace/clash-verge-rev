import {
  AddRounded,
  DeleteRounded,
  EditRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, MonacoEditor } from '@/components/base'
import {
  deleteScriptPreset,
  listScriptPresets,
  saveScriptPreset,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'

const SCRIPT_TEMPLATE = `// 脚本预设：覆写订阅配置（与全局扩展脚本同格式）
// main(config) 接收完整配置，返回修改后的配置
function main(config) {
  // 示例：只保留直连
  // config["rules"] = ["MATCH,DIRECT"];
  return config;
}
`

export const SettingScriptPresets = () => {
  const { t } = useTranslation()
  const themeMode = useThemeMode()
  const [presets, setPresets] = useState<IScriptPreset[]>([])
  const [editing, setEditing] = useState<IScriptPreset | null>(null)
  const [name, setName] = useState('')
  const [script, setScript] = useState('')

  const refresh = async () => {
    try {
      setPresets(await listScriptPresets())
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const openNew = () => {
    setEditing({ uid: '', name: '', script: '' })
    setName('')
    setScript(SCRIPT_TEMPLATE)
  }

  const openEdit = (p: IScriptPreset) => {
    setEditing(p)
    setName(p.name)
    setScript(p.script)
  }

  const onSave = async () => {
    if (!editing) return
    if (!name.trim()) {
      showNotice.error(t('settings.scriptPresets.feedback.nameRequired'))
      return
    }
    try {
      await saveScriptPreset({
        uid: editing.uid,
        name: name.trim(),
        script,
      })
      showNotice.success(t('shared.feedback.notifications.common.saveSuccess'))
      setEditing(null)
      await refresh()
    } catch (e) {
      showNotice.error(t('shared.feedback.notifications.common.saveFailed'), e)
    }
  }

  const onDelete = async (p: IScriptPreset) => {
    try {
      await deleteScriptPreset(p.uid)
      await refresh()
    } catch (e) {
      showNotice.error(e)
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('settings.scriptPresets.title')}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddRounded />}
          onClick={openNew}
        >
          {t('shared.actions.new')}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('settings.scriptPresets.hint')}
      </Typography>

      <List dense sx={{ mt: 1 }}>
        {presets.map((p) => (
          <ListItem
            key={p.uid}
            secondaryAction={
              <Box>
                <Tooltip title={t('shared.actions.edit')}>
                  <IconButton size="small" onClick={() => openEdit(p)}>
                    <EditRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('shared.actions.delete')}>
                  <IconButton size="small" onClick={() => void onDelete(p)}>
                    <DeleteRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            }
          >
            <ListItemText
              primary={p.name}
              secondary={t('settings.scriptPresets.lines', {
                count: p.script.split('\n').length,
              })}
            />
          </ListItem>
        ))}
        {presets.length === 0 && (
          <ListItem>
            <ListItemText secondary={t('settings.scriptPresets.empty')} />
          </ListItem>
        )}
      </List>

      <BaseDialog
        title={
          editing?.uid
            ? t('settings.scriptPresets.editTitle')
            : t('settings.scriptPresets.newTitle')
        }
        open={!!editing}
        onOk={() => void onSave()}
        onClose={() => setEditing(null)}
        maxWidth="md"
        fullWidth
        disableEnforceFocus
        contentSx={{ height: '70vh', display: 'flex', flexDirection: 'column' }}
      >
        <TextField
          fullWidth
          size="small"
          label={t('settings.scriptPresets.fields.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 1.5, flexShrink: 0 }}
        />
        <Box
          sx={{
            flex: 1,
            minHeight: 320,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <MonacoEditor
            height="100%"
            language="javascript"
            value={script}
            theme={themeMode === 'light' ? 'light' : 'vs-dark'}
            loading={null}
            options={{ automaticLayout: true, tabSize: 2, minimap: { enabled: false } }}
            onChange={(v) => setScript(v ?? '')}
          />
        </Box>
      </BaseDialog>
    </Box>
  )
}
