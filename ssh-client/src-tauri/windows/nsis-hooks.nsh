!macro KillEmbeddedJavaSidecar
  DetailPrint "Stopping embedded Java sidecar if it is still running..."

  FileOpen $0 "$TEMP\ssh-client-kill-embedded-java.ps1" w
  FileWrite $0 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
  FileWrite $0 "$$installDir = $$args[0]$\r$\n"
  FileWrite $0 "$$javaPath = [System.IO.Path]::GetFullPath((Join-Path $$installDir 'resources\runtime\bin\java.exe'))$\r$\n"
  FileWrite $0 "Get-CimInstance Win32_Process | Where-Object {$\r$\n"
  FileWrite $0 "  $$_.Name -in @('java.exe', 'javaw.exe') -and$\r$\n"
  FileWrite $0 "  -not [string]::IsNullOrWhiteSpace($$_.ExecutablePath) -and$\r$\n"
  FileWrite $0 "  ([System.IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$javaPath)$\r$\n"
  FileWrite $0 "} | ForEach-Object {$\r$\n"
  FileWrite $0 "  Stop-Process -Id $$_.ProcessId -Force$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileWrite $0 "Start-Sleep -Milliseconds 800$\r$\n"
  FileClose $0

  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\ssh-client-kill-embedded-java.ps1" "$INSTDIR"'
  Delete "$TEMP\ssh-client-kill-embedded-java.ps1"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillEmbeddedJavaSidecar
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillEmbeddedJavaSidecar
!macroend
