@echo off
rem dev 后端启动器（260825 dev 沙盒隔离，见 docs/situations/260825-dev-sandbox-isolation.md）
rem 与 ssh-client/scripts/tauri.cmd 配对：注入同一 AI_SSH_HOME 数据根 + 独立端口
rem 8092，与常驻安装版（sidecar 8091 + ~/.ai-ssh + H2 文件锁）彻底分流。
rem 用法：ssh-server\scripts\dev-backend.cmd   （single profile + H2 落 .ai-ssh-dev）
setlocal

set "AI_SSH_HOME=%USERPROFILE%\.ai-ssh-dev"
set "SERVER_PORT=8092"

cd /d "%~dp0..\ssh-server-app"
call mvn spring-boot:run
exit /b %ERRORLEVEL%
