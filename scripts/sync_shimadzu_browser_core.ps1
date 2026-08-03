param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'
$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path
$target = Join-Path $PSScriptRoot '..\frontend\src\shimadzu-core'
$target = [System.IO.Path]::GetFullPath($target)

$files = @(
    'normalize.mjs',
    'parse-shimadzu.mjs',
    'v2-sample-config.mjs',
    'v2-hit1-stage.mjs',
    'filtering.mjs',
    'duplicate-cas.mjs',
    'v2-screening-stage.mjs',
    'v2-replicate-area-stage.mjs',
    'semiquant.mjs',
    'v2-semiquant-stage.mjs',
    'v2-statistics-stage.mjs',
    'v2-matrix-split-stage.mjs'
)

New-Item -ItemType Directory -Force -Path $target | Out-Null
$manifestFiles = foreach ($name in $files) {
    $source = Join-Path $resolvedSource $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing Shimadzu core source: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $target $name) -Force
    [ordered]@{
        name = $name
        source = "scripts/core/$name"
        sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$manifest = [ordered]@{
    schemaVersion = 'shimadzu-browser-core-1'
    files = @($manifestFiles)
}
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $target 'source-manifest.json'), "$json`n", [System.Text.UTF8Encoding]::new($false))

Write-Output "Synced $($files.Count) Shimadzu core modules to $target"
