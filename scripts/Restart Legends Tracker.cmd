@echo off
rem Restarts Legends Tracker from source after a rebuild: asks the running copy to quit (it writes its
rem settings and closes its overlays first), waits for it to go, then starts a fresh one. A copy that
rem has not answered after 30 seconds is closed the hard way: only this checkout's Electron processes,
rem found by their command line, never every electron.exe on the PC (another app, a scratch copy).
rem The app is the folder above this one.
for %%I in ("%~dp0..") do set "root=%%~fI"
set "mine=Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('%root%') }"
"%root%\node_modules\electron\dist\electron.exe" "%root%" --quit
set tries=0
:wait
powershell -NoProfile -NonInteractive -Command "if (%mine%) { exit 1 }" && goto start
set /a tries+=1
if %tries% geq 30 (
  echo Legends Tracker did not quit on request; closing it.
  powershell -NoProfile -NonInteractive -Command "%mine% | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  goto start
)
timeout /t 1 /nobreak >nul
goto wait
:start
start "" "%root%\node_modules\electron\dist\electron.exe" "%root%"
