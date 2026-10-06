//! 脚本预设：用户在设置页预先配置的覆写脚本，可在新增/编辑订阅时多选挂载。
//!
//! 每个预设是一段与全局扩展脚本同格式的 JS（`main(config) -> config`），
//! enhance 管道按挂载顺序依次执行。持久化于 `<app_home>/script_presets.yaml`。

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::utils::{dirs, help};

const PRESETS_FILE: &str = "script_presets.yaml";

/// 单个脚本预设。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScriptPreset {
    pub uid: String,
    pub name: String,
    #[serde(default)]
    pub script: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct PresetFile {
    #[serde(default)]
    presets: Vec<ScriptPreset>,
}

fn presets_path() -> Result<PathBuf> {
    Ok(dirs::app_home_dir()?.join(PRESETS_FILE))
}

fn read_file() -> PresetFile {
    let path = match presets_path() {
        Ok(p) => p,
        Err(_) => return PresetFile::default(),
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return PresetFile::default(),
    };
    serde_yaml_ng::from_str(&text).unwrap_or_default()
}

fn write_file(file: &PresetFile) -> Result<()> {
    let text = serde_yaml_ng::to_string(file).context("序列化脚本预设失败")?;
    std::fs::write(presets_path()?, text).context("写入脚本预设文件失败")?;
    Ok(())
}

/// 列出全部预设（按名称排序，稳定展示）。
pub fn list_presets() -> Vec<ScriptPreset> {
    let mut presets = read_file().presets;
    presets.sort_by(|a, b| a.name.cmp(&b.name));
    presets
}

/// 按 uid 取单个预设。
pub fn get_preset(uid: &str) -> Option<ScriptPreset> {
    read_file().presets.into_iter().find(|p| p.uid == uid)
}

/// 新增或更新预设；uid 为空时自动生成。返回落盘后的预设（含 uid）。
pub fn save_preset(mut preset: ScriptPreset) -> Result<ScriptPreset> {
    if preset.uid.trim().is_empty() {
        preset.uid = help::get_uid("p");
    }
    if preset.name.trim().is_empty() {
        preset.name = preset.uid.clone();
    }
    let mut file = read_file();
    match file.presets.iter_mut().find(|p| p.uid == preset.uid) {
        Some(existing) => *existing = preset.clone(),
        None => file.presets.push(preset.clone()),
    }
    write_file(&file)?;
    Ok(preset)
}

/// 删除预设；不存在时视为成功。
pub fn delete_preset(uid: &str) -> Result<()> {
    let mut file = read_file();
    let before = file.presets.len();
    file.presets.retain(|p| p.uid != uid);
    if file.presets.len() != before {
        write_file(&file)?;
    }
    Ok(())
}
