# 260804 · LLM 配置上一版回滚

> 背景：docs/situations/260804-llm-config-rollback.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：回滚契约与失败测试

**目标**：锁定 server 快照、回滚校验和 client API/UI 的可测试行为。

**设计**：

- server 内存只保留上一版完整配置和对应的保存后配置，用于陈旧回滚校验。
- 回滚状态只返回是否可用及非敏感摘要，API Key 永不返回。
- 回滚成功才清除快照；保存失败、回滚失败和重建异常保留恢复能力。
- client 回滚入口复用现有模型设置弹窗的配置加载、忙碌拦截、agents 刷新和会话归档。

**验收标准**：

- server 单元测试覆盖首次配置、无变化保存、A→B→C 单槽位、成功回滚清除、陈旧回滚拒绝、失败保留和敏感字段不出 DTO。
- client 测试覆盖 API 类型/调用、回滚按钮状态、未保存草稿丢弃和忙碌状态拦截。

**测试用例**：

- 已配置 A 保存为 B 后可恢复 A（含 API Key）；首次保存没有回滚。
- B 再保存为 C 后只能恢复 B；恢复后再次回滚不可用。
- 当前配置已被改为 C 时，针对 B 的回滚被拒绝且不覆盖 C。
- 回滚或 runner 重建失败时，快照仍可重试。

**验证**：已完成 server 快照服务 4 个单元测试与 controller 5 个场景测试；客户端设置弹窗 3 个测试通过，覆盖摘要展示、草稿丢弃、会话归档和忙碌拦截。

**状态**：已完成

## 阶段 2：server 快照与回滚接口

**目标**：在不改变现有保存接口语义的前提下，提供进程内上一版快照和独立回滚 API。

**设计**：

- 在现有配置服务/控制器边界增加线程安全的瞬态快照管理。
- 扩展 GET 配置响应的回滚可用状态和非敏感摘要。
- 新增 `POST /api/v1/llm-config/rollback`，校验当前配置指纹后恢复并重建 runner。
- 只在配置实际变化且已有完整旧配置时更新槽位；回滚成功后清除槽位。

**验收标准**：

- API Key 仅在 server 内部参与保存/恢复；响应、异常信息和日志不包含 Key。
- server 重启后 GET 报告无回滚快照。
- 并发保存/回滚不会重复重建或覆盖较新的配置。

**测试用例**：同阶段 1 的 server 场景，加上并发重复回滚和 runner 重建异常。

**验证**：`mvn -pl ssh-server-infrastructure -am test` 通过；快照服务 4 个测试、controller 5 个测试通过。`LlmConfigRollbackSnapshot` 的完整配置比较覆盖陈旧回滚，`LlmConfigRollbackSummaryDTO` 未包含 API Key；快照字段为进程内 volatile 单槽位，重启自然失效，controller 的保存/回滚方法同步互斥。

**状态**：已完成

## 阶段 3：client 设置弹窗回滚入口

**目标**：在现有模型设置弹窗中完成回滚展示、确认、请求和结果处理。

**设计**：

- 读取 GET 返回的 `rollbackAvailable` 与上一版摘要；不可用时不展示可操作入口。
- 回滚按钮与保存按钮互斥，点击前确认，确认后丢弃未保存草稿。
- 成功后复用保存后的 agents 刷新、runner 变化处理和活动会话归档；失败保留弹窗并显示错误。
- 不新增 Chat 面板独立状态，也不把 API Key 放入 localStorage 或 client API 类型。

**验收标准**：

- 正在发送消息或存在运行/待确认工具调用时不能回滚。
- A→B 配置失败场景中，用户可从设置弹窗手动恢复 A 并看到回滚入口消失。
- 回滚成功后当前活动会话归档并创建新会话，历史会话保留只读。

**测试用例**：空快照、有效快照、草稿回滚、忙碌拦截、接口失败、成功后的会话归档。

**验证**：客户端 `npm run test:run -- src/components/LlmSettingsModal.test.tsx` 通过 3 个测试，`npm run test:run` 全量通过 137 个测试，`npm run build` 通过。回滚入口只在 GET 返回有效摘要时展示，忙碌期间按钮禁用，成功后刷新 agents 并归档当前会话。

**状态**：已完成

## 阶段 4：全量验证与归档

**目标**：完成 client/server 测试、构建、自我 review，并封存 action 文档。

**设计**：

- 运行受影响的 server 模块测试、client Vitest 全量测试和 client 构建。
- 检查 diff、敏感字段、并发边界、用户既有改动隔离和文档状态。
- 将 action 移入 `docs/actions/done/`，只在对应提交中翻转状态和填写验证。

**验收标准**：

- 相关测试、client 构建和必要的 server 编译通过。
- `git diff --check` 通过，未修改用户已有的 Cargo/手工测试改动。
- action 的验证证据完整，归档路径与 git 一致。

**测试用例**：client `npm run test:run`、`npm run build`；server `mvn -pl ssh-server-infrastructure test` 及必要的编译检查。

**验证**：client 全量测试 137/137、client production build、server infrastructure 及 trigger 测试均通过；`mvn -DskipTests package` 全模块构建成功，`mvn -pl ssh-server-trigger -am test` 的 trigger controller 5 个测试通过，`git diff --check` 通过。仓库现场保留用户已有的 `ssh-client/src-tauri/Cargo.toml` 与 `LlmEndpointManualTest.java` 改动，未纳入本次文件范围；action 将随本次提交移入 `docs/actions/done/`。

**状态**：已完成
