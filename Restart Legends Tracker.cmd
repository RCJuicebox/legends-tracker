@echo off
rem Restarts Legends Tracker from source after a rebuild: asks the running copy to quit (it writes its
rem settings and closes its overlays first), waits for it to go, then starts a fresh one. A copy that
rem has not answered after 30 seconds is closed the hard way.
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --quit
set tries=0
:wait
tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul || goto start
set /a tries+=1
if %tries% geq 30 (
  echo Legends Tracker did not quit on request; closing it.
  taskkill /f /im electron.exe >nul 2>&1
  goto start
)
timeout /t 1 /nobreak >nul
goto wait
:start
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
