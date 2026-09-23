@echo off
REM ===========================================================================
REM  MAD DELIVERY HQ - one-time setup
REM  Run this ONCE (or after pulling changes that touch the database schema).
REM  To start the app afterwards, use start.bat
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  ============================================
echo    MAD DELIVERY HQ - Setup
echo  ============================================
echo.

REM --- 1. Node check -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js is not installed, or not on your PATH.
    echo      Install the LTS build from https://nodejs.org then run setup.bat again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo  [1/5] Node.js %NODEVER% found.

REM --- 2. Environment files ------------------------------------------------
REM Prisma CLI reads .env ; the Next.js runtime reads .env.local. Both needed.
if not exist ".env" (
    copy /y ".env.example" ".env" >nul
    echo  [2/5] Created .env from .env.example
) else (
    echo  [2/5] .env already exists - left untouched.
)
if not exist ".env.local" (
    copy /y ".env.example" ".env.local" >nul
    echo        Created .env.local from .env.example
) else (
    echo        .env.local already exists - left untouched.
)

REM --- 3. Dependencies -----------------------------------------------------
echo  [3/5] Installing dependencies ^(this takes a minute the first time^)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  [X] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
)

REM --- 4. Database ---------------------------------------------------------
echo  [4/5] Creating the database and applying migrations...
call npx prisma migrate deploy
if errorlevel 1 (
    echo.
    echo  [X] Database migration failed.
    pause
    exit /b 1
)
call npx prisma generate
if errorlevel 1 (
    echo.
    echo  [X] Prisma client generation failed.
    pause
    exit /b 1
)

REM --- 5. Demo data --------------------------------------------------------
echo  [5/5] Seeding demo data ^(branches, menu, orders, accounts^)...
call npm run seed
if errorlevel 1 (
    echo.
    echo  [X] Seeding failed.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo    Setup complete.
echo  ============================================
echo.
echo   Next step:  double-click  start.bat
echo.
echo   Then open:  http://localhost:3000
echo.
echo   Demo logins - password for ALL accounts is:  Admin12345@##
echo.
echo     Super Admin      super_admin      superadmin@example.com
echo     Branch Manager   branch_manager   branchmanager@example.com
echo     Rider            rider            rider@example.com
echo     Customer         customer         customer@example.com
echo     Accounts         accounts         accounts@example.com
echo     Marketing        marketing        marketing@example.com
echo     Management       management       management@example.com
echo.
echo   You can sign in with the username, the email, or a phone number.
echo.
echo   OPTIONAL - the app runs fully without these, each one degrades
echo   gracefully. Add them to .env.local only when you want them live:
echo     BARIKOI_API_KEY                   address search + pin lookup (maps work without it)
echo     BKASH_APP_KEY / SECRET / ...      live bKash instead of record-and-verify
echo     VAPID_PUBLIC_KEY / PRIVATE_KEY    phone push instead of in-app only
echo     SMS_PROVIDER / SMS_API_KEY        real OTP SMS instead of dev codes
echo.
pause
endlocal
