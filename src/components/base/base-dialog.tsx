import { CloseRounded } from '@mui/icons-material'
import {
  Button,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  type SxProps,
  type Theme,
} from '@mui/material'
import { ReactNode } from 'react'

interface Props {
  title: ReactNode
  open: boolean
  okBtn?: ReactNode
  cancelBtn?: ReactNode
  disableEnforceFocus?: boolean
  disableOk?: boolean
  disableCancel?: boolean
  disableFooter?: boolean
  contentSx?: SxProps<Theme>
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false
  fullWidth?: boolean
  children?: ReactNode
  loading?: boolean
  onOk?: () => void
  onCancel?: () => void
  onClose?: () => void
}

export interface DialogRef {
  open: () => void
  close: () => void
}

export const BaseDialog: React.FC<Props> = ({
  open,
  title,
  children,
  okBtn,
  cancelBtn,
  disableEnforceFocus,
  contentSx,
  maxWidth,
  fullWidth,
  disableCancel,
  disableOk,
  disableFooter,
  loading,
  onOk,
  onCancel,
  onClose,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableEnforceFocus={disableEnforceFocus}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
        {onClose && (
          <IconButton
            size="small"
            edge="end"
            aria-label="Close dialog"
            title="Close"
            onClick={onClose}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent sx={contentSx}>{children}</DialogContent>

      {!disableFooter && (
        <DialogActions>
          {!disableCancel && (
            <Button variant="outlined" onClick={onCancel}>
              {cancelBtn}
            </Button>
          )}
          {!disableOk && (
            <Button loading={loading} variant="contained" onClick={onOk}>
              {okBtn}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}
