@echo off
cd /d "%~dp0"
echo Starting Human Host Wiki...
echo.
echo If the browser does not open automatically, open:
echo http://localhost:3000/
echo.
start "" "http://localhost:3000/"
npm run start -- --host 127.0.0.1 --port 3000
pause
