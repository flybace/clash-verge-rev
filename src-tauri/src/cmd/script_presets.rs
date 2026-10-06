//! 脚本预设的前端命令：列表 / 保存 / 删除。

use super::{CmdResult, CommandFailure};
use crate::config::{ScriptPreset, script_presets};

/// 列出全部脚本预设。
#[tauri::command]
pub async fn list_script_presets() -> CmdResult<Vec<ScriptPreset>> {
    Ok(script_presets::list_presets())
}

/// 新增或更新脚本预设，返回落盘后的预设（含 uid）。
#[tauri::command]
pub async fn save_script_preset(preset: ScriptPreset) -> CmdResult<ScriptPreset> {
    script_presets::save_preset(preset).map_err(CommandFailure::plain)
}

/// 删除脚本预设。注意：已挂载该预设的订阅需手动移除挂载（不做级联删除）。
#[tauri::command]
pub async fn delete_script_preset(uid: String) -> CmdResult<()> {
    script_presets::delete_preset(uid.trim()).map_err(CommandFailure::plain)
}
