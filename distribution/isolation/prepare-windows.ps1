$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Only ephemeral GitHub-hosted CI runners are permitted' }
$depotOutput = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/distribution/isolation'))
New-Item -ItemType Directory -Force $depotOutput | Out-Null
$depotVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$depotVs = & $depotVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $depotVs) { throw 'Visual C++ build tools are required on the Windows CI runner' }
$depotCompilerEnv = Join-Path $depotVs 'Common7/Tools/VsDevCmd.bat'
$depotSource = Join-Path $PSScriptRoot 'windows-wfp.cpp'
$depotExe = Join-Path $depotOutput 'dsh-network-guard.exe'
$depotObject = Join-Path $depotOutput 'dsh-network-guard.obj'
$depotCommand = '"' + $depotCompilerEnv + '" -arch=x64 -host_arch=x64 && cl.exe /nologo /std:c++17 /EHsc /W4 /MT /DUNICODE /D_UNICODE /Fo"' + $depotObject + '" /Fe"' + $depotExe + '" "' + $depotSource + '"'
& cmd.exe /d /s /c $depotCommand
if ($LASTEXITCODE -ne 0) { throw 'Network guard compilation failed' }
