# 260816 · Agent CLI 参数适配层

## 原始需求（用户原话）

> 当前claude和codex启动任务的ask参数依赖当前机子的claude和codex版本，随着官方的更新可能会飘逸，甚至现在可能就已经对不上了。查询官方文档或者命令help查询对应的ask参数有哪些。我想应该增加检测机制和适配层通过枚举映射来进行维护，Claude/Codex 的三档并不是天然同义；用同一中文标签掩盖差异会制造错误安全感。核实情况后grill me 确定方案。

> （grill 后补充核实）codex的ask permission在写入时没有申请权限 是否这一档的参数已经失效。claude和codex的ask permission档位都必须传入手动确认参数。

## 背景（决策时事实，2026-08-16 本机实测）

- Claude 2.1.233：`--permission-mode` 合法值 `acceptEdits/auto/bypassPermissions/manual/dontAsk/plan`，choices 列表已无 `default` 但实测仍被接受（无效值则硬拒启）；官方文档明确 **`default` 是 Manual 模式的 config 值**（= 只读外全部手动确认），`manual` 为 CLI 别名。`--effort` 值域 `low/medium/high/xhigh/max`。
- Codex 0.144.6：权限为两正交轴 `-s`（read-only/workspace-write/danger-full-access）× `-a`（untrusted/on-request/never）+ 整体旁路 flag。
- 迁移来的映射：claude 三档传参显式且当前正确；**codex ask 档不传任何参数**（吃 CLI 默认值，为最大漂移源）。
- codex「ask 写入不询问」根因：用户 `~/.codex/config.toml` 中多条 `trust_level = "trusted"`（含 `d:\`、`E:\` 整盘根）——trusted 项目下 TUI 对工作区写默认免审批，短路了档位语义。对照实验：无 flag 的 exec 模式默认只读沙箱（拒写）。

## 决议

- **Q1 UI 模型 → 统一三档 + 差异副标题**：保留 ask/auto_edit/full_access 统一抽象，但每 agent×档位配一句真实行为描述（如 Codex ask=「只读沙箱，非信任命令需确认」），不再让同标签掩盖语义差异。
- **Q2 检测机制 → 版本号映射表**：Rust 编译期常量，每 agent 一组「semver 门槛 → flag 组合」条目；复用现有带缓存的 `detect_*_version`。help 文本探测因格式非契约而弃用。
- **Q3 兜底 → 安全侧回退**：表不命中时 ask/auto_edit 降为不带权限 flag + toast 警示；full_access 降为 ask 档 + 强警示。映射过期不得静默放行危险档，也不阻断干活。
- **Q4 覆盖范围 → 权限三档 + 思考深度档**（同构枚举→版本化参数问题）；model/resume/fork/--settings 维持现状。
- **Q5 透明度 → 副标题 + tooltip 透出实际 flag 原文**：映射表元数据直接序列化进 tooltip，适配层对错一眼可验。
- **ask 档显式传参（用户最终确认）**：claude ask=`--permission-mode default`（官方=Manual 模式）；codex ask=`-s read-only -a untrusted`（修订，不再裸奔吃默认值）。
- **codex 信任层透出**：检测当前项目在 codex trusted 列表时，ask 档副标题追加「该项目已被 Codex 标记为受信任，实际审批会更宽松」警示；不代改用户 config。

## 影响范围

- ssh-client：新增 `src-tauri/src/coding/agent_compat.rs`（映射表+解析+兜底）、命令 `coding_get_permission_catalog`、事件 `coding:compat-warning`；pty.rs build_claude_cmd/build_codex_cmd 改为查表消费；前端 AgentPermSelector 副标题+tooltip+信任警示，i18n 词条；Rust/前端单测。
- 文档：action 追加为 260815 行动计划的阶段 6。
