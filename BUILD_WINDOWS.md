# Windows 打包说明（给 Codex）

本分支 `feat/auto-detect-new-domains` 在 Clash Verge Rev 基础上新增「新域名自动检测」功能。
代码在 Linux 云机上编写，**未经编译验证**（云机无 Rust/Node 构建环境），请在 Windows 上完整构建并修复编译问题后再打包。

## 功能说明

连接页顶部新增「新域名自动检测」面板：

1. 打开开关后，前端监听 Mihomo 实时连接，对命中 `MATCH`（无规则覆盖）的新域名入队；
2. Rust 后端对每个新域名做**直连探测**（HTTPS/HTTP HEAD，8 秒超时，重试 1 次，显式绕过系统代理）；
   - 直连成功 → 标记「直连正常」，不做任何事；
   - 直连失败 → 判定需代理，扩展相关域名（首页 HTML 同站引用 + crt.sh 证书子域名），写入规则文件；
3. 规则落盘到 `<app_data>/auto-detect/rules.yaml`，enhance 管道在每次生成运行时配置时自动前置合并这些规则，并确保「国外新站」分组存在（不存在则自动创建 select 分组）；
4. 批量处理完后只重启一次内核（`restart_core`）使规则生效；
5. 面板中每个域名右侧有「忽略」按钮：删除已加规则并加入忽略名单（持久化在同一 yaml 的 `ignored` 段），不再重复添加——用于纠正探测误判。

**注意**：直连探测是启发式的。开启 TUN 模式时后端流量也会走 Mihomo，探测结果不可靠，此时建议关闭 TUN 或以手动确认为准。

## 新增/修改文件

| 文件 | 说明 |
|---|---|
| `src-tauri/src/cmd/auto_detect.rs` | 新增：7 个 Tauri 命令 + enhance 合并逻辑 + 单测 |
| `src-tauri/src/cmd/mod.rs` | 注册 `auto_detect` 模块 |
| `src-tauri/src/lib.rs` | 注册 7 个命令到 `generate_handler!` |
| `src-tauri/src/enhance/mod.rs` | 全局脚本之后调用 `apply_auto_detect_rules` |
| `src/services/cmds.ts` | 新增 7 个前端命令封装 |
| `src/hooks/use-auto-detect.ts` | 新增：监听/队列/批量处理 hook |
| `src/components/connection/auto-detect-panel.tsx` | 新增：面板 UI |
| `src/pages/connections.tsx` | 接入 hook 与面板 |
| `src/locales/zh/connections.json` / `en` | 新增 `autoDetect` 文案 |

Tauri 命令名（前端 invoke 用）：`auto_detect_probe_domain`、`auto_detect_expand_domain`、
`auto_detect_add_rules`、`auto_detect_list_rules`、`auto_detect_remove_rule`、
`auto_detect_ignore_domain`、`auto_detect_list_ignored`。

## 构建步骤（Windows）

前置：Node.js LTS、pnpm、Rust 1.99.0（按 `rust-toolchain.toml` 自动安装）、WebView2 Runtime（Win10/11 自带）。

```powershell
pnpm install
pnpm typecheck        # 先过 TS 类型检查
pnpm lint             # eslint
cargo check -p clash-verge-rev  # 先过 Rust 检查（目录 src-tauri 下执行更稳）
pnpm build            # 完整打包（含 prebuild 下载 mihomo 内核）
```

`pnpm build` 会触发 `prebuild` 脚本下载对应平台的 mihomo sidecar，无需手动处理。
产物在 `src-tauri/target/release/bundle/`（nsis/msi）。

## 验证功能

1. 安装运行后打开「连接」页，打开「新域名自动检测」开关；
2. 访问一个直连不可达的新站点（命中 MATCH 的），面板应出现该域名 → 探测中 → 已加入国外新站；
3. 检查 `%APPDATA%\<app_id>\auto-detect\rules.yaml` 有新规则；
4. 内核重启后，「规则」页顶部应出现自动检测的规则，「代理组」页应有「国外新站」分组；
5. 点「忽略」按钮，规则应被删除且 `ignored` 段有记录，重启后不再重复添加。

## 已知未验证项（请重点检查）

- Rust 代码未经 `cargo check`，重点看：`serde_yaml_ng::Mapping` 的 `get`/`get_mut` 用法、
  `reqwest::ClientBuilder::no_proxy()`、OnceLock 正则、tauri command 参数名与前端 invoke 一致性；
- `app_home_dir()` 在 Windows 上的路径（含中文用户名）读写是否正常；
- `restart_core` 后 enhance 是否正确合并（看日志有无报错）。
