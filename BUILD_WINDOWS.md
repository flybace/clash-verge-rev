# Windows 打包说明（给 Codex）

本分支 `feat/auto-detect-new-domains` 在 Clash Verge Rev 基础上新增两个功能。
代码在 Linux 云机上编写，**未经编译验证**（云机无 Rust/Node 构建环境），请在 Windows 上完整构建并修复编译问题后再打包。

## 功能一：新域名自动检测

连接页顶部新增「新域名自动检测」面板：

1. 打开开关后，前端监听 Mihomo 实时连接，对命中 `MATCH`（无规则覆盖）的新域名入队；
2. Rust 后端对每个新域名做**直连探测**（HTTPS/HTTP HEAD，8 秒超时，重试 1 次，显式绕过系统代理）；
   - 直连成功 → 标记「直连正常」，不做任何事；
   - 直连失败 → 判定需代理，扩展相关域名（首页 HTML 同站引用 + crt.sh 证书子域名），写入规则文件；
3. 规则落盘到 `<app_data>/auto-detect/rules.yaml`，enhance 管道在每次生成运行时配置时自动前置合并这些规则；
   目标分组为 **Proxy**（不再自建「国外新站」分组；旧版本已写入的「国外新站」规则在读取时自动迁移为 Proxy）；
4. 批量处理完后只重启一次内核（`restart_core`）使规则生效；
5. 面板中每个域名右侧有「忽略」按钮：删除已加规则并加入忽略名单（持久化在同一 yaml 的 `ignored` 段），不再重复添加——用于纠正探测误判。

**注意**：直连探测是启发式的。开启 TUN 模式时后端流量也会走 Mihomo，探测结果不可靠，此时建议关闭 TUN 或以手动确认为准。

6. **手动检测**：面板下方有手动输入框，可输入网址/域名 → 点「检测」做直连探测 → 显示结果（直连正常 / 建议走代理）→
   自选目标分组（下拉框列出当前配置的所有分组，默认 Proxy）→ 点「加入分组」写入规则并重启内核。
7. 开关状态持久化到 localStorage，切换页面/重启应用后保持开启。
8. **代理可用性自动检测**：直连失败后，不再盲加到 Proxy，而是用 Mihomo 延迟测试 API
   （`delayProxyByName`，自定义 URL）逐个试 Proxy 分组里的节点（当前选中优先，最多 6 个，8 秒超时），
   找到第一个能打开该域名的节点，规则直接指向该节点名（如 `DOMAIN-SUFFIX,x.com,日本节点`）；
   所有节点都打不开则不加规则、标记「代理也打不开」。零重启、零打扰。

## 本轮修复（2026-10-07 用户实测反馈）

1. 自动检测开关切页面就关闭 → 开关状态改存 localStorage，持久化。
2. 脚本预设编辑窗口显示不正常 → 对话框改用 `maxWidth="md"` 加宽（BaseDialog 新增 `maxWidth`/`fullWidth` 参数），
   Monaco 容器改用 flex 布局 + `disableEnforceFocus`，避免焦点陷阱和尺寸测量错误。
3. 订阅对话框/导入行看不到预设下拉 → 预设区始终显示（无预设时显示提示文字，导入行下拉 disabled），
   对话框内由复选框组改为下拉多选框。
4. 自动检测目标分组由「国外新站」改为 **Proxy**（用户要求：无脚本规则覆盖的新域名直接进 Proxy）。

## 功能二：脚本预设

把原来"全局扩展脚本"的手工覆写能力做成**可复用的预设**：

1. **设置页**新增「脚本预设」区：新建/编辑/删除预设，每个预设 = 名称 + 一段 JS（与全局扩展脚本同格式，`main(config)`）。
   预设存于 `<app_data>/script_presets.yaml`。
2. **订阅页导入行**：新增预设多选下拉框，导入新订阅时可直接勾选多个预设挂载。
3. **订阅编辑对话框**：新增「脚本预设」多选框，可修改已订阅的挂载。
4. enhance 管道执行顺序：订阅自身脚本 → 挂载的预设（按选择顺序）→ 自动检测规则合并。
   预设脚本异常只记日志跳过，不中断后续。

Tauri 命令名（前端 invoke 用）：`list_script_presets`、`save_script_preset`、`delete_script_preset`。

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
