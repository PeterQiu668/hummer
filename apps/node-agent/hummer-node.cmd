@echo off
setlocal
node "%~dp0bin\hummer-node.mjs" %*
exit /b %ERRORLEVEL%
