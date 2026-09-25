@echo off
rem UltraGame Studio: editor de juegos 2D/3D. Doble clic para abrirlo.
title UltraGame Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instalalo desde https://nodejs.org ^(version 18 o superior^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node tools\studio-server.js %*
if errorlevel 1 pause
