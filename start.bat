@echo off
REM ===========================================================================
REM  MAD DELIVERY HQ - start the app
REM
REM    start.bat          development mode (hot reload, best for looking around)
REM    start.bat prod     production mode  (builds first, then serves)
REM
REM  Run setup.bat once before this.
REM ===========================================================================
setlocal
cd /d "%~dp0"

REM Business timezone. Reports, attendance and the daily reward all bucket the
REM day at Asia/Dhaka midnight - keep this set so a UTC machine agrees with them.
set TZ=Asia/Dhaka

echo.
echo  ============================================
echo    MAD DELIVERY HQ
echo  ============================================
echo.

REM --- Preconditions -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js not found. Install it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [X] Dependencies are missing.
    echo      Run  setup.bat  first.
    echo.
    pause
    exit /b 1
)

if not exist ".env.local" (
    echo  [X] .env.local is missing.
    echo      Run  setup.bat  first.
    echo.
    pause
    exit /b 1
)

if not exist "prisma\dev.db" (
    echo  [!] No database found - creating it now...
    call npx prisma migrate deploy
    call npm run seed
    echo.
)

REM --- Mode ----------------------------------------------------------------
if /i "%~1"=="prod" goto production

echo  Mode      : development ^(hot reload^)
echo  Timezone  : %TZ%
echo  URL       : http://localhost:3000
echo.
echo  Sign in with any demo account - password:  Admin12345@##
echo    super_admin / branch_manager / rider / customer
echo    accounts / marketing / management
echo.
echo  Press Ctrl+C to stop the server.
echo.
call npm run dev
goto end

:production
echo  Mode      : production
echo  Timezone  : %TZ%
echo.
echo  Building ^(this takes about a minute^)...
call npm run build
if errorlevel 1 (
    echo.
    echo  [X] Build failed - see the errors above.
    pause
    exit /b 1
)
echo.
echo  Build complete. Serving on http://localhost:3000
echo  Press Ctrl+C to stop the server.
echo.
call npm run start

:end
endlocal
