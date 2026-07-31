$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$oldCanonicalPath = 'E:\codex\FlavorThresholdDB'
$failures = [System.Collections.Generic.List[string]]::new()

foreach ($relativePath in @('PROJECT_HISTORY.md', 'RELEASE_WORKFLOW.md')) {
    $content = Get-Content -Raw (Join-Path $projectRoot $relativePath)
    if ($content.Contains($oldCanonicalPath)) {
        $failures.Add("$relativePath still declares the former project path")
    }
}

$launcher = Get-Content -Raw (Join-Path $projectRoot 'start_local.cmd')
foreach ($requiredText in @('CODEX_NODE_BIN', 'CODEX_PYTHON_EXE', 'Node.js was not found', '--check')) {
    if (-not $launcher.Contains($requiredText)) {
        $failures.Add("start_local.cmd is missing runtime handling: $requiredText")
    }
}

$package = Get-Content -Raw (Join-Path $projectRoot 'frontend\package.json') | ConvertFrom-Json
if ($package.scripts.build -notmatch 'create-static-routes') {
    $failures.Add('frontend build does not create static direct-route entries')
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'Migration integrity checks passed.'
