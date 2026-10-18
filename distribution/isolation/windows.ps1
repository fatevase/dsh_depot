param([Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Firewall adapter is restricted to ephemeral GitHub-hosted CI runners' }
$depotJob = Get-Content -Raw -LiteralPath $InputFile | ConvertFrom-Json
$depotGroup = 'dsh-offline-' + [Guid]::NewGuid().ToString('N')
$depotCleanup = "Start-Sleep -Seconds 60; Get-NetFirewallRule -Group '$depotGroup' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"
$depotEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($depotCleanup))
$depotWatchdog = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile','-EncodedCommand',$depotEncoded) -PassThru -WindowStyle Hidden
try {
  $depotAddresses = if ($depotJob.mode -eq 'offline') { @('Any') } else { @('0.0.0.0/2','64.0.0.0/3','96.0.0.0/4','112.0.0.0/5','120.0.0.0/6','124.0.0.0/7','126.0.0.0/8','128.0.0.0/1','::/0') }
  New-NetFirewallRule -DisplayName $depotGroup -Group $depotGroup -Direction Outbound -Action Block -RemoteAddress $depotAddresses -Profile Any | Out-Null
  $depotStart = [Diagnostics.ProcessStartInfo]::new()
  $depotStart.FileName = $depotJob.argv[0]
  foreach ($depotArg in $depotJob.argv | Select-Object -Skip 1) { $depotStart.ArgumentList.Add([string]$depotArg) }
  $depotStart.WorkingDirectory = $depotJob.cwd
  $depotStart.UseShellExecute = $false
  $depotStart.RedirectStandardOutput = $true
  $depotStart.RedirectStandardError = $true
  $depotStart.Environment.Clear()
  foreach ($depotProperty in $depotJob.env.PSObject.Properties) { $depotStart.Environment[$depotProperty.Name] = [string]$depotProperty.Value }
  $depotProcess = [Diagnostics.Process]::Start($depotStart)
  $depotOut = $depotProcess.StandardOutput.ReadToEndAsync(); $depotErr = $depotProcess.StandardError.ReadToEndAsync()
  if (-not $depotProcess.WaitForExit([Math]::Min(45000, [int]$depotJob.timeoutMs))) { $depotProcess.Kill($true); throw 'Isolated command timed out' }
  [Console]::Out.Write($depotOut.Result); [Console]::Error.Write($depotErr.Result)
  $depotExit = $depotProcess.ExitCode
} finally {
  Get-NetFirewallRule -Group $depotGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if ($depotWatchdog -and -not $depotWatchdog.HasExited) { $depotWatchdog.Kill($true) }
}
exit $depotExit
