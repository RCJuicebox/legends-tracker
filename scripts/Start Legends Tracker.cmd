@echo off
rem Starts Legends Tracker without leaving a console window open.
rem The app is the folder above this one.
for %%I in ("%~dp0..") do set "root=%%~fI"
start "" "%root%\node_modules\electron\dist\electron.exe" "%root%"
