[CmdletBinding()]
param(
    [ValidateSet('start', 'check', 'stop')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$FrontendRoot = Join-Path $ProjectRoot 'frontend'
$RuntimeRoot = Join-Path $ProjectRoot '_local\runtime'
$FrontendPort = 5174
$ProxyPort = 8787
$FrontendUrl = "http://127.0.0.1:$FrontendPort/FlavorThresholdDB/aroma-threshold/"
$ProxyHealthUrl = "http://127.0.0.1:$ProxyPort/health"

function Resolve-RuntimeExecutable {
    param([string]$CommandName, [string]$BundledPath)
    if (Test-Path -LiteralPath $BundledPath) { return $BundledPath }
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notlike '*\Microsoft\WindowsApps\*') { return $command.Source }
    throw "Required runtime '$CommandName' was not found."
}

function Get-ListeningProcesses {
    param([int]$Port)
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue } |
        Where-Object { $_ })
}

function Test-ProjectProcess {
    param($Process, [ValidateSet('frontend', 'proxy')] [string]$Kind)
    if (-not $Process -or -not $Process.CommandLine) { return $false }
    $commandLine = [string]$Process.CommandLine
    if ($commandLine.IndexOf($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    if ($Kind -eq 'proxy') { return $commandLine -match 'fema_proxy_server\.py' }
    return $commandLine -match 'vite(?:\.js)?' -and $commandLine -match '(?:--port\D+)?5174'
}

function Get-ProjectProcesses {
    param([ValidateSet('frontend', 'proxy')] [string]$Kind)
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        Test-ProjectProcess -Process $_ -Kind $Kind
    })
}

function Assert-PortAvailableOrOwned {
    param([int]$Port, [ValidateSet('frontend', 'proxy')] [string]$Kind)
    foreach ($process in Get-ListeningProcesses -Port $Port) {
        if (-not (Test-ProjectProcess -Process $process -Kind $Kind)) {
            throw "Refusing to manage port $Port because PID $($process.ProcessId) is not owned by this project."
        }
    }
}

function Wait-ForHttp200 {
    param([string]$Url, [int]$TimeoutSeconds = 45)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 350
    }
    throw "Timed out waiting for HTTP 200 from $Url. Last error: $lastError"
}

function Stop-ConfirmedProcess {
    param($Process)
    if (-not $Process) { return }
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
}

function Remove-StaleOrDuplicateProjectProcesses {
    param([int]$Port, [ValidateSet('frontend', 'proxy')] [string]$Kind)
    $all = @(Get-ProjectProcesses -Kind $Kind)
    $desiredPids = @(Get-ListeningProcesses -Port $Port |
        Where-Object { Test-ProjectProcess -Process $_ -Kind $Kind } |
        Select-Object -ExpandProperty ProcessId -Unique)
    $isSingleDesiredProcess = $all.Count -eq 1 -and $desiredPids.Count -eq 1 -and $all[0].ProcessId -eq $desiredPids[0]
    if ($all.Count -gt 0 -and -not $isSingleDesiredProcess) {
        foreach ($process in $all) { Stop-ConfirmedProcess -Process $process }
        Start-Sleep -Milliseconds 500
    }
}

function Stop-ProjectRuntime {
    $processes = @(@(Get-ProjectProcesses -Kind frontend) + @(Get-ProjectProcesses -Kind proxy)) |
        Sort-Object ProcessId -Unique
    foreach ($process in $processes) { Stop-ConfirmedProcess -Process $process }
    if (Test-Path -LiteralPath $RuntimeRoot) {
        Get-ChildItem -LiteralPath $RuntimeRoot -Filter '*.pid' -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Write-Output "Stopped $($processes.Count) confirmed FlavorThresholdDB process(es)."
}

function Write-ProjectPid {
    param([string]$Name, [int]$ProcessId)
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $RuntimeRoot "$Name.pid") -Value $ProcessId -Encoding ascii
}

function Start-ProjectRuntime {
    Remove-StaleOrDuplicateProjectProcesses -Port $ProxyPort -Kind proxy
    Remove-StaleOrDuplicateProjectProcesses -Port $FrontendPort -Kind frontend
    Assert-PortAvailableOrOwned -Port $ProxyPort -Kind proxy
    Assert-PortAvailableOrOwned -Port $FrontendPort -Kind frontend

    $python = Resolve-RuntimeExecutable -CommandName 'python' -BundledPath (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
    $node = Resolve-RuntimeExecutable -CommandName 'node' -BundledPath (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    $viteEntry = Join-Path $FrontendRoot 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $viteEntry)) { throw "Vite is missing at $viteEntry. Run pnpm install in frontend first." }

    $proxyListeners = @(Get-ListeningProcesses -Port $ProxyPort | Where-Object { Test-ProjectProcess -Process $_ -Kind proxy })
    if ($proxyListeners.Count -eq 0) {
        New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
        $proxy = Start-Process -FilePath $python -ArgumentList @((Join-Path $ProjectRoot 'fema_proxy_server.py')) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeRoot 'proxy.out.log') -RedirectStandardError (Join-Path $RuntimeRoot 'proxy.err.log') -PassThru
        Write-ProjectPid -Name 'proxy' -ProcessId $proxy.Id
    } else {
        Write-Output "Reusing FlavorThresholdDB proxy PID $($proxyListeners[0].ProcessId)."
    }

    $frontendListeners = @(Get-ListeningProcesses -Port $FrontendPort | Where-Object { Test-ProjectProcess -Process $_ -Kind frontend })
    if ($frontendListeners.Count -eq 0) {
        New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
        $frontend = Start-Process -FilePath $node -ArgumentList @($viteEntry, '--host', '127.0.0.1', '--port', '5174', '--strictPort') -WorkingDirectory $FrontendRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeRoot 'frontend.out.log') -RedirectStandardError (Join-Path $RuntimeRoot 'frontend.err.log') -PassThru
        Write-ProjectPid -Name 'frontend' -ProcessId $frontend.Id
    } else {
        Write-Output "Reusing FlavorThresholdDB frontend PID $($frontendListeners[0].ProcessId)."
    }

    Wait-ForHttp200 -Url $ProxyHealthUrl
    Wait-ForHttp200 -Url $FrontendUrl
    Write-Output "FlavorThresholdDB is ready: $FrontendUrl"
    Write-Output "Data proxy is ready: http://127.0.0.1:$ProxyPort"
}

function Test-ProjectRuntime {
    Assert-PortAvailableOrOwned -Port $ProxyPort -Kind proxy
    Assert-PortAvailableOrOwned -Port $FrontendPort -Kind frontend
    $proxy = @(Get-ListeningProcesses -Port $ProxyPort | Where-Object { Test-ProjectProcess -Process $_ -Kind proxy })
    $frontend = @(Get-ListeningProcesses -Port $FrontendPort | Where-Object { Test-ProjectProcess -Process $_ -Kind frontend })
    if ($proxy.Count -ne 1) { throw "Expected exactly one project proxy on port $ProxyPort; found $($proxy.Count)." }
    if ($frontend.Count -ne 1) { throw "Expected exactly one project frontend on port $FrontendPort; found $($frontend.Count)." }
    Wait-ForHttp200 -Url $ProxyHealthUrl -TimeoutSeconds 10
    Wait-ForHttp200 -Url $FrontendUrl -TimeoutSeconds 10
    Write-Output 'FlavorThresholdDB runtime check passed.'
}

switch ($Action) {
    'start' { Start-ProjectRuntime }
    'check' { Test-ProjectRuntime }
    'stop' { Stop-ProjectRuntime }
}
