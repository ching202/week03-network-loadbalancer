@echo off
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"
where node >nul 2>&1
if errorlevel 1 set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
if not exist evidence mkdir evidence
echo Checking Docker engine > evidence\run-state.txt
echo Checking Docker engine...
docker version > evidence\docker-version.txt 2>&1
if errorlevel 1 goto engine_error
docker compose version > evidence\compose-version.txt 2>&1
docker compose config --quiet
if errorlevel 1 goto failed
echo Building and starting project > evidence\run-state.txt
echo Building and starting the three project containers...
docker compose up --build -d --wait --wait-timeout 180
if errorlevel 1 goto failed
echo Running live QA > evidence\run-state.txt
echo Running live QA. Backend-1 will be stopped and restored by the test.
node scripts\qa.mjs
if errorlevel 1 goto failed
docker compose ps > evidence\containers.txt 2>&1
docker compose images --format json > evidence\images.json 2>&1
docker compose logs --no-color --tail 300 > evidence\container-logs.txt 2>&1
echo PASS > evidence\run-state.txt
echo.
echo PASS: Live Docker QA completed. Results are in evidence\qa-latest.json.
echo The project is still running. Browser verification is the next step.
pause
exit /b 0

:engine_error
echo ENGINE NOT READY > evidence\run-state.txt
type evidence\docker-version.txt
echo.
echo Open Docker Desktop and wait for Engine running, then rerun this file.
pause
exit /b 1

:failed
docker compose logs --no-color --tail 300 > evidence\container-logs.txt 2>&1
echo FAILED - inspect the terminal and evidence files > evidence\run-state.txt
echo.
echo A setup or QA step failed. Leave this window open so we can inspect it.
echo Logs were saved to evidence\container-logs.txt.
pause
exit /b 1
