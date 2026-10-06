//! 新域名自动检测：直连探测、相关域名扩展、规则落盘。
//!
//! 工作流：前端监听 Mihomo 实时连接，对命中 `MATCH`（无规则覆盖）的新域名
//! 调用 [`auto_detect_probe_domain`] 做直连探测；直连失败则判定为需代理，
//! 调用 [`auto_detect_expand_domain`] 扩展相关域名，再经
//! [`auto_detect_add_rules`] 落盘到 `auto-detect/rules.yaml`。
//! enhance 管道在每次生成运行时配置时自动合并该文件（见
//! [`apply_auto_detect_rules`]），无需改动用户已有的全局脚本。

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result};
use regex::Regex;
use serde_yaml_ng::{Mapping, Value};

use super::{CmdResult, CommandFailure};
use crate::utils::dirs;

/// 自动检测规则的目标分组。不存在时由 enhance 管道自动创建。
pub(crate) const AUTO_DETECT_GROUP: &str = "国外新站";
/// 规则文件相对路径：<app_home>/auto-detect/rules.yaml
const RULES_FILE: &str = "rules.yaml";
/// 直连探测超时（秒）。
const PROBE_TIMEOUT_SECS: u64 = 8;

fn auto_detect_dir() -> Result<PathBuf> {
    let dir = dirs::app_home_dir()?.join("auto-detect");
    std::fs::create_dir_all(&dir).context("创建 auto-detect 目录失败")?;
    Ok(dir)
}

fn rules_path() -> Result<PathBuf> {
    Ok(auto_detect_dir()?.join(RULES_FILE))
}

fn normalize_domain(domain: &str) -> String {
    domain.trim().trim_end_matches('.').to_lowercase()
}

/// 读取已保存的规则行（去重、有序）。文件不存在或解析失败时返回空集。
fn read_saved_rules() -> BTreeSet<String> {
    read_string_set("rules")
}

/// 读取忽略名单。
fn read_ignored() -> BTreeSet<String> {
    read_string_set("ignored")
}

fn read_string_set(key: &str) -> BTreeSet<String> {
    let path = match rules_path() {
        Ok(p) => p,
        Err(_) => return BTreeSet::new(),
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return BTreeSet::new(),
    };
    let mapping: Mapping = match serde_yaml_ng::from_str(&text) {
        Ok(m) => m,
        Err(_) => return BTreeSet::new(),
    };
    let mut out = BTreeSet::new();
    if let Some(Value::Sequence(seq)) = mapping.get(Value::from(key)) {
        for v in seq {
            if let Some(s) = v.as_str() {
                let s = s.trim();
                if !s.is_empty() {
                    out.insert(s.to_string());
                }
            }
        }
    }
    out
}

fn write_state(rules: &BTreeSet<String>, ignored: &BTreeSet<String>) -> Result<()> {
    let mut mapping = Mapping::new();
    let seq_of = |set: &BTreeSet<String>| -> Vec<Value> {
        set.iter().map(|s| Value::from(s.as_str())).collect()
    };
    mapping.insert(Value::from("rules"), Value::Sequence(seq_of(rules)));
    if !ignored.is_empty() {
        mapping.insert(Value::from("ignored"), Value::Sequence(seq_of(ignored)));
    }
    let text = serde_yaml_ng::to_string(&mapping).context("序列化规则失败")?;
    std::fs::write(rules_path()?, text).context("写入规则文件失败")?;
    Ok(())
}

fn write_saved_rules(rules: &BTreeSet<String>) -> Result<()> {
    write_state(rules, &read_ignored())
}

/// 直连探测用的 HTTP 客户端：显式禁用代理、限时、限制跳转。
fn direct_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .context("构建探测客户端失败")
}

/// 单次探测：只要拿到任何 HTTP 响应（含 4xx/5xx）即视为直连可达；
/// 只有传输层错误（DNS/TCP/TLS/超时）才视为不可达。
async fn probe_once(client: &reqwest::Client, domain: &str) -> bool {
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{domain}/");
        match client.head(&url).send().await {
            Ok(_) => return true,
            Err(_) => continue,
        }
    }
    false
}

/// 直连探测：返回 `true` 表示直连可用（无需代理），`false` 表示直连失败（需代理）。
/// IP 字面量与空域名直接返回 `true`（不处理）。
#[tauri::command]
pub async fn auto_detect_probe_domain(domain: String) -> CmdResult<bool> {
    let domain = normalize_domain(&domain);
    if domain.is_empty() || domain.parse::<std::net::IpAddr>().is_ok() {
        return Ok(true);
    }
    let client = direct_client().map_err(CommandFailure::plain)?;
    if probe_once(&client, &domain).await {
        return Ok(true);
    }
    // 重试一次，避免把瞬时抖动误判为需代理
    tokio::time::sleep(Duration::from_secs(2)).await;
    Ok(probe_once(&client, &domain).await)
}

/// 简化版 eTLD+1：取最后两段（如 `a.b.muse.ai` -> `muse.ai`）。
fn root_domain(domain: &str) -> String {
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() >= 2 {
        labels[labels.len() - 2..].join(".")
    } else {
        domain.to_string()
    }
}

fn href_src_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)(?:href|src)\s*=\s*["']https?://([^/"'?\s#]+)"#)
            .expect("href/src 正则非法")
    })
}

/// 从 HTML 中粗粒度提取 href/src 引用的主机名。
fn extract_hosts(html: &str) -> Vec<String> {
    href_src_regex()
        .captures_iter(html)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_lowercase()))
        .collect()
}

/// 扩展相关域名：同根域名子域（首页 HTML）+ 证书透明日志子域（crt.sh）。
async fn expand_related(client: &reqwest::Client, domain: &str) -> BTreeSet<String> {
    let mut subs = BTreeSet::new();
    subs.insert(domain.to_string());
    let root = root_domain(domain);
    let suffix = format!(".{root}");

    let is_same_root = |h: &str| h == root || h.ends_with(suffix.as_str());

    // 1) 首页 HTML 里的同站引用
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{domain}/");
        let html = match client.get(&url).send().await {
            Ok(resp) => match resp.text().await {
                Ok(t) => t,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        for host in extract_hosts(&html) {
            if is_same_root(&host) {
                subs.insert(host);
            }
        }
        break;
    }

    // 2) crt.sh 证书透明日志补全子域名（直连可访问，尽力而为）
    let crt_url = format!("https://crt.sh/?q=%25.{root}&output=json");
    if let Ok(resp) = client.get(&crt_url).send().await {
        if let Ok(list) = resp.json::<Vec<serde_json::Value>>().await {
            for item in list {
                if let Some(name) = item.get("name_value").and_then(|v| v.as_str()) {
                    for n in name.split('\n') {
                        let n = n.trim().trim_start_matches("*.");
                        let n = normalize_domain(n);
                        if !n.is_empty() && is_same_root(&n) {
                            subs.insert(n);
                        }
                    }
                }
            }
        }
    }

    subs
}

/// 扩展相关域名，返回待写入的规则行（`DOMAIN-SUFFIX,<host>,国外新站`）。
#[tauri::command]
pub async fn auto_detect_expand_domain(domain: String) -> CmdResult<Vec<String>> {
    let domain = normalize_domain(&domain);
    if domain.is_empty() {
        return Ok(vec![]);
    }
    let client = direct_client().map_err(CommandFailure::plain)?;
    let subs = expand_related(&client, &domain).await;
    Ok(subs
        .into_iter()
        .map(|s| format!("DOMAIN-SUFFIX,{s},{AUTO_DETECT_GROUP}"))
        .collect())
}

/// 追加规则行（自动去重、强制目标分组），返回本次新增条数。
#[tauri::command]
pub async fn auto_detect_add_rules(lines: Vec<String>) -> CmdResult<usize> {
    let mut saved = read_saved_rules();
    let before = saved.len();
    for line in lines {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split(',');
        match (parts.next(), parts.next()) {
            (Some("DOMAIN-SUFFIX"), Some(d)) if !d.trim().is_empty() => {
                let d = normalize_domain(d);
                saved.insert(format!("DOMAIN-SUFFIX,{d},{AUTO_DETECT_GROUP}"));
            }
            _ => continue,
        }
    }
    write_saved_rules(&saved).map_err(CommandFailure::plain)?;
    Ok(saved.len() - before)
}

/// 列出已保存的自动检测规则（供前端展示/去重）。
#[tauri::command]
pub async fn auto_detect_list_rules() -> CmdResult<Vec<String>> {
    Ok(read_saved_rules().into_iter().collect())
}

/// 删除一条自动检测规则（用于纠正误判），返回是否确实删掉了。
#[tauri::command]
pub async fn auto_detect_remove_rule(line: String) -> CmdResult<bool> {
    let mut saved = read_saved_rules();
    let removed = saved.remove(line.trim());
    if removed {
        write_saved_rules(&saved).map_err(CommandFailure::plain)?;
    }
    Ok(removed)
}

/// 将域名加入忽略名单：不再自动检测/添加该域名（用于纠正误判）。
#[tauri::command]
pub async fn auto_detect_ignore_domain(domain: String) -> CmdResult<()> {
    let domain = normalize_domain(&domain);
    if domain.is_empty() {
        return Ok(());
    }
    // 同时删掉已为其添加的规则
    let mut saved = read_saved_rules();
    saved.retain(|l| l.split(',').nth(1) != Some(domain.as_str()));
    let mut ignored = read_ignored();
    ignored.insert(domain);
    write_state(&saved, &ignored).map_err(CommandFailure::plain)?;
    Ok(())
}

/// 列出忽略名单。
#[tauri::command]
pub async fn auto_detect_list_ignored() -> CmdResult<Vec<String>> {
    Ok(read_ignored().into_iter().collect())
}

fn ensure_group(config: &mut Mapping) {
    let key = Value::from("proxy-groups");
    let seq = match config.get_mut(&key) {
        Some(Value::Sequence(seq)) => seq,
        _ => return, // 没有分组定义就不动，避免写坏配置
    };
    let exists = seq.iter().any(|g| match g {
        Value::Mapping(m) => {
            m.get("name").and_then(|n| n.as_str()) == Some(AUTO_DETECT_GROUP)
        }
        _ => false,
    });
    if exists {
        return;
    }
    let mut m = Mapping::new();
    m.insert(Value::from("name"), Value::from(AUTO_DETECT_GROUP));
    m.insert(Value::from("type"), Value::from("select"));
    m.insert(
        Value::from("proxies"),
        Value::Sequence(vec![Value::from("Proxy"), Value::from("DIRECT")]),
    );
    seq.push(Value::Mapping(m));
}

/// enhance 管道调用：在全局脚本之后合并自动检测规则（前置最高优先级），
/// 并确保目标分组存在。规则文件不存在或为空时无操作。
pub(crate) fn apply_auto_detect_rules(config: &mut Mapping) {
    let saved = read_saved_rules();
    if saved.is_empty() {
        return;
    }
    let key = Value::from("rules");
    let mut merged: Vec<Value> = saved.into_iter().map(|s| Value::from(s.as_str())).collect();
    match config.get_mut(&key) {
        Some(Value::Sequence(seq)) => {
            let mut old = std::mem::take(seq);
            merged.append(&mut old);
            *seq = merged;
        }
        _ => {
            config.insert(key, Value::Sequence(merged));
        }
    }
    ensure_group(config);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_domain() {
        assert_eq!(root_domain("auth.muse.ai"), "muse.ai");
        assert_eq!(root_domain("muse.ai"), "muse.ai");
        assert_eq!(root_domain("a.b.c.example.com"), "example.com");
    }

    #[test]
    fn test_normalize_domain() {
        assert_eq!(normalize_domain(" Auth.Muse.AI. "), "auth.muse.ai");
    }

    #[test]
    fn test_extract_hosts() {
        let html = r#"<a href="https://auth.muse.ai/login">x</a><img src='http://cdn.muse.ai/a.png'>"#;
        let hosts = extract_hosts(html);
        assert!(hosts.contains(&"auth.muse.ai".to_string()));
        assert!(hosts.contains(&"cdn.muse.ai".to_string()));
    }

    #[test]
    fn test_apply_auto_detect_rules_prepends() {
        // 空文件时无操作
        let mut config = Mapping::new();
        apply_auto_detect_rules(&mut config);
        assert!(config.get(Value::from("rules")).is_none());
    }
}
