@echo off
rem Starts Legends Tracker without leaving a console window open.
rem The app is the folder above this one.
for %%I in ("%~dp0..") do set "root=%%~fI"
rem Electron 44.7 and later fetch their program on first use, not at npm install: fetched here if missing.
if not exist "%root%\node_modules\electron\dist\electron.exe" node "%root%\node_modules\electron\install.js"
start "" "%root%\node_modules\electron\dist\electron.exe" "%root%"
