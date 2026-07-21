# 可选 master password 加密档

> 来源：2026-07-21 规划 grill 候选池（迁移入档）

对齐 Xshell/Tabby 实践：KDF + 锁定/解锁流 + 忘记恢复路径。为本机凭据库加一层用户口令加密（当前为本机密钥 AES-GCM，无用户口令参与）。
