@echo off
setlocal DisableDelayedExpansion
set "DEPOT_ROOT=%~dp0"
set "DEPOT_NODE=%~dp0runtime\node.exe"
if not exist "%DEPOT_NODE%" goto lite
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); $p=Join-Path $env:DEPOT_ROOT 'runtime\node.exe'; $e=(Get-Content -LiteralPath (Join-Path $env:DEPOT_ROOT 'runtime\node.sha256') -Raw).Trim(); if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $e) { Write-Error 'Node SHA256 mismatch'; exit 2 }"
if errorlevel 1 exit /b 2
goto run
:lite
set "DEPOT_NODE="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined DEPOT_NODE set "DEPOT_NODE=%%N"
if defined DEPOT_NODE goto run
echo RUNTIME_MISSING: Use the full bundle or install Node ^>=24. 1>&2
exit /b 2
:run
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); $lines=Get-Content -LiteralPath (Join-Path $env:DEPOT_ROOT 'payload.sha256'); if ($lines.Count -ne 3) {exit 2}; foreach ($line in $lines) {if ($line -notmatch '^([a-f0-9]{64})  (core\.mjs|manager\.tgz|bundle\.json)$') {exit 2}; $expected=$Matches[1]; $name=$Matches[2]; if ((Get-FileHash -LiteralPath (Join-Path $env:DEPOT_ROOT $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {exit 2}}"
if errorlevel 1 exit /b 2
"%DEPOT_NODE%" "%DEPOT_ROOT%core.mjs" %*
exit /b %errorlevel%
