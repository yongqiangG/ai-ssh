@echo off
setlocal

rem 260825 dev 沙盒隔离：数据根切到 .ai-ssh-dev，与常驻安装版(~/.ai-ssh)的
rem 库/配置/任务数据/手机伴侣(18080)彻底分流;web-companion debug 默认 18081。
rem 仅 dev 走本脚本,安装版零感知。后端配套 scripts(dev-backend.cmd) 同款注入。
set "AI_SSH_HOME=%USERPROFILE%\.ai-ssh-dev"

set "MSVC_TOOLS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
set "WINSDK=C:\Program Files (x86)\Windows Kits\10"

set "PATH=%USERPROFILE%\.cargo\bin;%MSVC_TOOLS%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%MSVC_TOOLS%\include;%WINSDK%\Include\10.0.26100.0\ucrt;%WINSDK%\Include\10.0.26100.0\shared;%WINSDK%\Include\10.0.26100.0\um;%WINSDK%\Include\10.0.26100.0\winrt;%WINSDK%\Include\10.0.26100.0\cppwinrt"
set "LIB=%MSVC_TOOLS%\lib\x64;%WINSDK%\Lib\10.0.26100.0\ucrt\x64;%WINSDK%\Lib\10.0.26100.0\um\x64;%WINSDK%\Debuggers\lib\x64"
set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=%MSVC_TOOLS%\bin\Hostx64\x64\link.exe"
set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"
set "CXX_x86_64_pc_windows_msvc=%MSVC_TOOLS%\bin\Hostx64\x64\cl.exe"
set "CC_x86_64_pc_windows_msvc=%MSVC_TOOLS%\bin\Hostx64\x64\cl.exe"

node "%~dp0..\node_modules\@tauri-apps\cli\tauri.js" %*
exit /b %ERRORLEVEL%
