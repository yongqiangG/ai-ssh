@echo off
setlocal

rem 260825 dev sandbox isolation (docs/situations/260825-dev-sandbox-isolation.md)
rem DEV ONLY (build-personal.sh / tauri build are not affected):
rem   AI_SSH_HOME -> %USERPROFILE%\.ai-ssh-dev   data root (H2/tasks/web.json)
rem   sidecar port 8092 + web-companion 18081     debug-build defaults in code
rem   identifier  com.johnny.ai-ssh.dev           single-instance lock,
rem                                                WebView2 profile dir and
rem                                                appdata all split from the
rem                                                installed release build
if /i "%~1"=="dev" (
    set "AI_SSH_HOME=%USERPROFILE%\.ai-ssh-dev"
    node "%~dp0..\node_modules\@tauri-apps\cli\tauri.js" %* --config src-tauri/tauri.dev.conf.json
    exit /b %ERRORLEVEL%
)

set "MSVC_TOOLS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
set "WINSDK=C:\Program Files (x86)\Windows Kits\10"

set "PATH=%USERPROFILE%\.cargo\bin;%MSVC_TOOLS%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%MSVC_TOOLS%\include;%WINSDK%\Include\10.0.26100.0\ucrt;%WINSDK%\Include\10.0.26100.0\shared;%WINSDK%\Include\10.0.26100.0\um;%WINSDK%\Include\10.0.26100.0\winrt;%WINSDK%\Include\10.0.26100.0\cppwinrt"
set "LIB=%MSVC_TOOLS%\lib\x64;%WINSDK%\Lib\10.0.26100.0\ucrt\x64;%WINSDK%\Lib\10.0.26100.0\um\x64;%WINSDK%\Debuggers\lib\x64"
set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=%MSVC_TOOLS%\bin\Hostx64\x64\link.exe"
set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"
set "CXX_x86_64_pc_windows_msvc=%MSVC_TOOLS%\bin\x64\cl.exe"
set "CC_x86_64_pc_windows_msvc=%MSVC_TOOLS%\bin\x64\cl.exe"

node "%~dp0..\node_modules\@tauri-apps\cli\tauri.js" %*
exit /b %ERRORLEVEL%
