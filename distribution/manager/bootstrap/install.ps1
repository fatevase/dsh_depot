$ErrorActionPreference = 'Stop'
$DepotNode = Join-Path $PSScriptRoot 'runtime\node.exe'
if (Test-Path -LiteralPath $DepotNode) {
    $Expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime\node.sha256') -Raw).Trim()
    if ((Get-FileHash -LiteralPath $DepotNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) { throw 'Node SHA256 mismatch' }
} else {
    $DepotNode = (Get-Command node.exe -ErrorAction Stop).Source
}
$Rows = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'payload.sha256')
if ($Rows.Count -ne 3) { throw 'Invalid payload inventory' }
foreach ($Row in $Rows) {
    if ($Row -notmatch '^([a-f0-9]{64})  (core\.mjs|manager\.tgz|bundle\.json)$') { throw 'Invalid payload row' }
    $Expected = $Matches[1]; $Name = $Matches[2]
    if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) { throw 'Payload SHA256 mismatch' }
}
& $DepotNode (Join-Path $PSScriptRoot 'core.mjs') @args
exit $LASTEXITCODE
