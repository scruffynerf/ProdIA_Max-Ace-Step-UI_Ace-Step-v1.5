@echo off
chcp 65001 >nul 2>&1
title ProdIA pro - Setup / Instalacion
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║          ProdIA pro - Instalacion / Installation          ║
echo ║   Python venv + dependencias + Node.js UI                ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

set "ACESTEP_DIR=%~dp0ACE-Step-1.5_"
set "UI_DIR=%~dp0ace-step-ui"
set "VENV=%ACESTEP_DIR%\.venv"
set "PYTHON_EMBED=%ACESTEP_DIR%\python_embeded\python.exe"

REM ─── Detectar Python / Detect Python ─────────────────────────
if exist "%PYTHON_EMBED%" (
    set "PYTHON=%PYTHON_EMBED%"
    echo  [OK] Python embebido encontrado / Embedded Python found.
    goto :PYTHON_FOUND
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('where python') do set "SYS_PYTHON=%%i" & goto :GOT_SYS_PYTHON
    :GOT_SYS_PYTHON
    echo  [OK] Python del sistema encontrado / System Python found: %SYS_PYTHON%
    set "BASE_PYTHON=%SYS_PYTHON%"
    goto :CREATE_VENV
)

py --version >nul 2>&1
if %errorlevel% equ 0 (
    echo  [OK] Python launcher encontrado / Python launcher found.
    set "BASE_PYTHON=py"
    goto :CREATE_VENV
)

echo  [ERROR] No se encontro Python / Python not found.
echo          Instala Python 3.10 o 3.11 desde / Install Python 3.10 or 3.11 from:
echo          https://www.python.org/downloads/
echo          Asegurate de marcar "Add Python to PATH" / Make sure to check "Add Python to PATH"
pause
exit /b 1

:CREATE_VENV
echo.
echo  [1/4] Creando entorno virtual / Creating virtual environment...
if exist "%VENV%" (
    echo       Ya existe, omitiendo creacion / Already exists, skipping creation.
) else (
    "%BASE_PYTHON%" -m venv "%VENV%"
    if %errorlevel% neq 0 (
        echo  [ERROR] No se pudo crear el venv / Could not create venv.
        pause
        exit /b 1
    )
    echo       Creado correctamente / Created successfully.
)
set "PYTHON=%VENV%\Scripts\python.exe"

:PYTHON_FOUND
echo.
echo  [2/4] Instalando dependencias Python / Installing Python dependencies...
echo        Esto puede tardar varios minutos / This may take several minutes...
echo.
"%PYTHON%" -m pip install --upgrade pip >nul 2>&1
"%PYTHON%" -m pip install -r "%ACESTEP_DIR%\requirements.txt"
if %errorlevel% neq 0 (
    echo.
    echo  [AVISO] Algunos paquetes pueden haber fallado / Some packages may have failed.
    echo          Revisa los errores arriba / Check errors above.
    echo          Si es CUDA/torch,
    echo          instala manualmente segun tu GPU:
    echo          https://pytorch.org/get-started/locally/
    echo.
    pause
)

echo.
echo  [3/4] Instalando dependencias Node.js - Frontend / Installing Node.js frontend dependencies...
if exist "%UI_DIR%\node_modules" (
    echo       Ya instaladas, omitiendo / Already installed, skipping.
) else (
    cd /d "%UI_DIR%"
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install fallo / failed.
        pause
        exit /b 1
    )
)

echo.
echo  [4/4] Instalando dependencias Node.js - Backend / Installing Node.js backend dependencies...
if exist "%UI_DIR%\server\node_modules" (
    echo       Ya instaladas, omitiendo / Already installed, skipping.
) else (
    cd /d "%UI_DIR%\server"
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install fallo / failed.
        pause
        exit /b 1
    )
)

cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║   Instalacion completada / Installation completed        ║
echo ╠══════════════════════════════════════════════════════════╣
echo ║                                                          ║
echo ║   Ahora ejecuta / Now run: iniciar_todo.bat              ║
echo ║                                                          ║
echo ║   NOTA: Los modelos de IA se descargan la primera vez.   ║
echo ║   NOTE: AI models are downloaded the first time.         ║
echo ║                                                          ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
pause
