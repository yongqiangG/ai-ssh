# F4. 自然语言转命令（inline AI，Ctrl+K）

> 来源：AI-OPS-PRODUCT 功能池（迁移入档）。**2026-07-21 grill 砍出本期**：不加快捷键心智负担；替代路径=ChatPanel 问 + 命令块插入终端。重启此项前需先推翻该决议（见 situations/260721-three-iterations Q15）。

- **交互**：终端内按 `Ctrl+K` → 输入行上方浮出自然语言输入条（AI 渐变描边，视觉上与普通输入区分）→ 输入「找出占用 8080 端口的进程并杀掉」→ AI 返回命令预填入终端当前行并高亮 → 用户可编辑，回车才执行，Esc 取消。
- **价值**：用户不离开终端、不切面板，「AI 味」进入核心工作流；Warp 已验证该路线。
- **技术要点**：快捷键与 xterm 按键处理的冲突需处理（`attachCustomKeyEventHandler`）。
