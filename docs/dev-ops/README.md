# DevOps / 构建 & 开发命令

本目录记录 AI-SSH 客户端（前端，`ssh-client/`）的开发与构建命令。
真正的 SSH 连接、AI 调用、数据持久化将由独立的**后端项目**提供，当前客户端在集成边界处使用 mock 实现。

## 环境要求

- Node.js ≥ 18
- （可选，打包桌面应用）Rust 工具链 + Tauri CLI：`@tauri-apps/cli`（已在 devDependencies）

## 常用命令（在 `ssh-client/` 目录下执行）

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 Vite 前端开发服务器（http://localhost:1420） |
| `npm run build` | `tsc` 类型检查 + Vite 生产构建（产物在 `dist/`） |
| `npm run preview` | 预览生产构建 |
| `npm run test` | 启动 vitest（watch） |
| `npm run test:run` | 运行一次单元测试 |
| `npm run tauri dev` | 以 Tauri 桌面壳启动（自动拉起前端 dev server） |
| `npm run tauri build` | 打包桌面应用 |

## 后端对接预留

前端通过 `src/types/index.ts` 中的 `SshService` / `AiService` 接口与集成层解耦，
当前 mock 实现位于 `src/utils/`（`mockSsh.ts`、`mockAi.ts`）。后端就绪后只需替换这些实现。
数据持久化当前使用 localStorage（Zustand persist，`stores/`），后端就绪后切换为后端 API。
