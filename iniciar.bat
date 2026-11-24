@echo off
chcp 65001 >nul
title Servidor da Barbearia
cd /d "%~dp0"
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:8000"
python servidor\servidor.py
pause
