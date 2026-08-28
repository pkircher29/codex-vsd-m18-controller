#Requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Stop
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This launcher supports Windows 10 and Windows 11 only."
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$productId = "codex-vsd-m18-controller"
$serverEntry = Join-Path $projectRoot "src\server.js"
$packagePath = Join-Path $projectRoot "package.json"
$installStatePath = Join-Path $projectRoot "windows\install-state.json"
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw "Windows did not provide a per-user Local AppData directory."
}

$runtimeRoot = Join-Path (Join-Path $localAppData "M18Foundry") "runtime"
$instanceStatePath = Join-Path $runtimeRoot "instance.json"
$processStatePath = Join-Path $runtimeRoot "controller-process.json"
$launcherErrorLog = Join-Path $runtimeRoot "launcher-error.log"
$expectedAppVersion = $null
if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
  try {
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $expectedAppVersion = [string]$package.version
  } catch {
    $expectedAppVersion = $null
  }
}

function Write-Utf8JsonAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporaryPath = Join-Path $parent (".{0}.{1}.tmp" -f (Split-Path -Leaf $Path), [Guid]::NewGuid().ToString("N"))
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  try {
    $json = ($Value | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    [IO.File]::WriteAllText($temporaryPath, $json, $utf8WithoutBom)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Read-InstanceDescriptor {
  if (-not (Test-Path -LiteralPath $instanceStatePath -PathType Leaf)) {
    return $null
  }

  try {
    $descriptor = Get-Content -LiteralPath $instanceStatePath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }

  foreach ($property in @("version", "token", "host", "port", "pid")) {
    if ($descriptor.PSObject.Properties.Name -notcontains $property) {
      return $null
    }
  }

  [int]$descriptorPort = 0
  [int]$descriptorProcessId = 0
  $allowedHosts = @("127.0.0.1", "localhost", "::1")
  if (
    [int]$descriptor.version -ne 1 -or
    [string]$descriptor.token -notmatch '^[A-Za-z0-9_-]{43}$' -or
    $allowedHosts -notcontains [string]$descriptor.host -or
    -not [int]::TryParse([string]$descriptor.port, [ref]$descriptorPort) -or
    $descriptorPort -lt 1 -or
    $descriptorPort -gt 65535 -or
    -not [int]::TryParse([string]$descriptor.pid, [ref]$descriptorProcessId) -or
    $descriptorProcessId -lt 1
  ) {
    return $null
  }

  return [pscustomobject]@{
    version = 1
    token = [string]$descriptor.token
    host = [string]$descriptor.host
    port = $descriptorPort
    pid = $descriptorProcessId
  }
}

function Get-ControllerBaseUrl {
  param([Parameter(Mandatory = $true)]$Descriptor)

  $uriHost = if ([string]$Descriptor.host -eq "::1") { "[::1]" } else { [string]$Descriptor.host }
  return "http://${uriHost}:$([int]$Descriptor.port)"
}

function Get-ControllerHealth {
  param([Parameter(Mandatory = $true)]$Descriptor)

  try {
    $headers = @{ "X-VSD-Instance-Token" = [string]$Descriptor.token }
    $response = Invoke-WebRequest `
      -Uri ((Get-ControllerBaseUrl -Descriptor $Descriptor) + "/api/health") `
      -Method Get `
      -Headers $headers `
      -UseBasicParsing `
      -TimeoutSec 1
    if ($response.StatusCode -ne 200) {
      return $null
    }
    $health = $response.Content | ConvertFrom-Json
    foreach ($property in @("ok", "version", "pid")) {
      if ($health.PSObject.Properties.Name -notcontains $property) {
        return $null
      }
    }

    [int]$healthProcessId = 0
    if (
      $health.ok -ne $true -or
      [string]::IsNullOrWhiteSpace([string]$health.version) -or
      -not [int]::TryParse([string]$health.pid, [ref]$healthProcessId) -or
      $healthProcessId -ne [int]$Descriptor.pid -or
      (
        -not [string]::IsNullOrWhiteSpace($expectedAppVersion) -and
        -not [string]::Equals(
          [string]$health.version,
          $expectedAppVersion,
          [StringComparison]::Ordinal
        )
      )
    ) {
      return $null
    }
    return $health
  } catch {
    return $null
  }
}

function Get-HealthyInstanceDescriptor {
  $descriptor = Read-InstanceDescriptor
  if ($null -eq $descriptor) {
    return $null
  }
  if ($null -eq (Get-ControllerHealth -Descriptor $descriptor)) {
    return $null
  }
  return $descriptor
}

function Assert-SupportedNode {
  param([Parameter(Mandatory = $true)][string]$NodePath)

  $versionOutput = (& $NodePath --version 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$versionOutput)) {
    throw "Node.js could not be executed from '$NodePath'."
  }
  if ([string]$versionOutput -notmatch '^v(?<major>\d+)\.(?<minor>\d+)\.') {
    throw "Could not interpret the installed Node.js version '$versionOutput'."
  }
  if ([int]$Matches.major -lt 20 -or ([int]$Matches.major -eq 20 -and [int]$Matches.minor -lt 9)) {
    throw "M18 Foundry requires Node.js 20.9.0 or newer; found '$versionOutput'."
  }
}

function Get-NodeExecutable {
  if (Test-Path -LiteralPath $installStatePath -PathType Leaf) {
    try {
      $installState = Get-Content -LiteralPath $installStatePath -Raw | ConvertFrom-Json
      if (
        $installState.PSObject.Properties.Name -contains "productId" -and
        [string]::Equals([string]$installState.productId, $productId, [StringComparison]::Ordinal) -and
        $installState.PSObject.Properties.Name -contains "nodePath" -and
        -not [string]::IsNullOrWhiteSpace([string]$installState.nodePath) -and
        (Test-Path -LiteralPath ([string]$installState.nodePath) -PathType Leaf)
      ) {
        $savedNodePath = [IO.Path]::GetFullPath([string]$installState.nodePath)
        Assert-SupportedNode -NodePath $savedNodePath
        return $savedNodePath
      }
    } catch {
      Write-Warning "The saved Node.js location is unreadable; checking PATH instead."
    }
  }

  $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) {
    throw "Node.js 20.9.0 or newer is required. Install Node.js, then run M18 Foundry again."
  }
  $nodePath = $nodeCommand.Source
  Assert-SupportedNode -NodePath $nodePath
  return $nodePath
}

function Read-TrackedProcessState {
  if (-not (Test-Path -LiteralPath $processStatePath -PathType Leaf)) {
    return $null
  }

  try {
    $processState = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
  } catch {
    Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
    return $null
  }

  $requiredProperties = @("processId", "launchMarker", "nodePath", "serverEntry", "creationDate")
  foreach ($property in $requiredProperties) {
    if ($processState.PSObject.Properties.Name -notcontains $property) {
      Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
      return $null
    }
  }

  [int]$trackedProcessId = 0
  if (
    -not [int]::TryParse([string]$processState.processId, [ref]$trackedProcessId) -or
    $trackedProcessId -lt 1 -or
    [string]$processState.launchMarker -notmatch '^--windows-launch-id=[0-9a-fA-F-]{36}$' -or
    [string]::IsNullOrWhiteSpace([string]$processState.creationDate)
  ) {
    Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
    return $null
  }
  return $processState
}

function Get-VerifiedTrackedProcess {
  $processState = Read-TrackedProcessState
  if ($null -eq $processState) {
    return $null
  }

  $trackedProcessId = [int]$processState.processId
  $processInfo = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = {0}" -f $trackedProcessId)
  if ($null -eq $processInfo) {
    Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
    return $null
  }

  $expectedServer = [IO.Path]::GetFullPath($serverEntry)
  $savedServer = [IO.Path]::GetFullPath([string]$processState.serverEntry)
  $expectedNode = [IO.Path]::GetFullPath([string]$processState.nodePath)
  $expectedMarker = [string]$processState.launchMarker
  $commandLine = [string]$processInfo.CommandLine
  if (
    -not [string]::Equals($savedServer, $expectedServer, [StringComparison]::OrdinalIgnoreCase) -or
    [string]::IsNullOrWhiteSpace($commandLine) -or
    $commandLine.IndexOf($expectedServer, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
    $commandLine.IndexOf($expectedMarker, [StringComparison]::Ordinal) -lt 0 -or
    [string]::IsNullOrWhiteSpace([string]$processInfo.ExecutablePath) -or
    -not [string]::Equals(
      [IO.Path]::GetFullPath([string]$processInfo.ExecutablePath),
      $expectedNode,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [string]::Equals(
      [string]$processInfo.CreationDate,
      [string]$processState.creationDate,
      [StringComparison]::Ordinal
    )
  ) {
    throw (
      "The saved controller process identity no longer matches. " +
      "No process was stopped; remove '{0}' after verifying the controller is closed." -f $processStatePath
    )
  }
  return $processInfo
}

function Remove-StaleInstanceForProcess {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  $descriptor = Read-InstanceDescriptor
  if ($null -ne $descriptor -and [int]$descriptor.pid -eq $ProcessId) {
    Remove-Item -LiteralPath $instanceStatePath -Force -ErrorAction SilentlyContinue
  }
}

function Stop-TrackedController {
  $processInfo = Get-VerifiedTrackedProcess
  if ($null -eq $processInfo) {
    Write-Host "M18 Foundry has no tracked controller process."
    return
  }

  $trackedProcessId = [int]$processInfo.ProcessId
  Stop-Process -Id $trackedProcessId -Force
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    if ($null -eq (Get-Process -Id $trackedProcessId -ErrorAction SilentlyContinue)) {
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if ($null -ne (Get-Process -Id $trackedProcessId -ErrorAction SilentlyContinue)) {
    throw "The M18 Foundry controller process did not stop."
  }

  Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
  Remove-StaleInstanceForProcess -ProcessId $trackedProcessId
  Write-Host "M18 Foundry controller stopped."
}

function Open-ControllerBrowser {
  param([Parameter(Mandatory = $true)]$Descriptor)

  if ($NoBrowser) {
    return
  }
  $controllerUrl = (Get-ControllerBaseUrl -Descriptor $Descriptor) +
    "/?instance=" + [Uri]::EscapeDataString([string]$Descriptor.token)
  Start-Process -FilePath $controllerUrl | Out-Null
}

function Wait-ForController {
  param(
    [Parameter(Mandatory = $true)][int]$ExpectedProcessId,
    [int]$Attempts = 60
  )

  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    $descriptor = Get-HealthyInstanceDescriptor
    if ($null -ne $descriptor -and [int]$descriptor.pid -eq $ExpectedProcessId) {
      return $descriptor
    }
    if ($null -eq (Get-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue)) {
      return $null
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}

function Start-ControllerProcess {
  $nodeExecutable = Get-NodeExecutable
  if ($serverEntry.Contains('"')) {
    throw "The M18 Foundry installation path cannot contain a quotation mark."
  }

  $launchMarker = "--windows-launch-id={0}" -f ([Guid]::NewGuid().ToString("D"))
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeExecutable
  $startInfo.Arguments = ('"{0}" --headless {1}' -f $serverEntry, $launchMarker)
  $startInfo.WorkingDirectory = $projectRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.EnvironmentVariables["VSD_M18_NO_BROWSER"] = "1"
  $startInfo.EnvironmentVariables["VSD_M18_HOST"] = "127.0.0.1"
  $startInfo.EnvironmentVariables["VSD_M18_PORT"] = "0"
  $startInfo.EnvironmentVariables["NODE_ENV"] = "production"

  $controllerProcess = New-Object System.Diagnostics.Process
  $controllerProcess.StartInfo = $startInfo
  if (-not $controllerProcess.Start()) {
    throw "Windows did not start the M18 Foundry controller process."
  }

  $launchedProcessInfo = $null
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $launchedProcessInfo = Get-CimInstance `
      -ClassName Win32_Process `
      -Filter ("ProcessId = {0}" -f $controllerProcess.Id)
    if (
      $null -ne $launchedProcessInfo -and
      -not [string]::IsNullOrWhiteSpace([string]$launchedProcessInfo.ExecutablePath) -and
      -not [string]::IsNullOrWhiteSpace([string]$launchedProcessInfo.CreationDate)
    ) {
      break
    }
    Start-Sleep -Milliseconds 50
  }
  if (
    $null -eq $launchedProcessInfo -or
    [string]::IsNullOrWhiteSpace([string]$launchedProcessInfo.ExecutablePath) -or
    [string]::IsNullOrWhiteSpace([string]$launchedProcessInfo.CreationDate)
  ) {
    Stop-Process -Id $controllerProcess.Id -Force -ErrorAction SilentlyContinue
    throw "Windows could not verify the newly started controller process."
  }

  $actualNodePath = [IO.Path]::GetFullPath([string]$launchedProcessInfo.ExecutablePath)
  if (-not [string]::Equals($actualNodePath, [IO.Path]::GetFullPath($nodeExecutable), [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Process -Id $controllerProcess.Id -Force -ErrorAction SilentlyContinue
    throw "The newly started controller executable did not match the selected Node.js executable."
  }

  $processState = [ordered]@{
    processId = $controllerProcess.Id
    launchMarker = $launchMarker
    nodePath = $actualNodePath
    serverEntry = [IO.Path]::GetFullPath($serverEntry)
    creationDate = [string]$launchedProcessInfo.CreationDate
    startedAt = [DateTime]::UtcNow.ToString("o")
  }
  try {
    Write-Utf8JsonAtomically -Path $processStatePath -Value $processState
  } catch {
    Stop-Process -Id $controllerProcess.Id -Force -ErrorAction SilentlyContinue
    throw
  }
  return $controllerProcess
}

function Invoke-ControllerLauncher {
  Remove-Item -LiteralPath $launcherErrorLog -Force -ErrorAction SilentlyContinue
  if ($Stop) {
    Stop-TrackedController
    return
  }

  if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
    throw "M18 Foundry is incomplete: '$serverEntry' was not found. Reinstall the application."
  }

  $descriptor = Get-HealthyInstanceDescriptor
  if ($null -ne $descriptor) {
    Open-ControllerBrowser -Descriptor $descriptor
    return
  }

  $trackedProcess = Get-VerifiedTrackedProcess
  if ($null -ne $trackedProcess) {
    $descriptor = Wait-ForController -ExpectedProcessId ([int]$trackedProcess.ProcessId) -Attempts 60
    if ($null -ne $descriptor) {
      Open-ControllerBrowser -Descriptor $descriptor
      return
    }
    if ($null -ne (Get-Process -Id ([int]$trackedProcess.ProcessId) -ErrorAction SilentlyContinue)) {
      throw "The tracked M18 Foundry process is running but did not publish a healthy local instance."
    }
    Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
  }

  $controllerProcess = Start-ControllerProcess
  $descriptor = Wait-ForController -ExpectedProcessId $controllerProcess.Id -Attempts 80
  if ($null -ne $descriptor) {
    Open-ControllerBrowser -Descriptor $descriptor
    return
  }

  if ($null -ne (Get-Process -Id $controllerProcess.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $controllerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
  Remove-StaleInstanceForProcess -ProcessId $controllerProcess.Id
  throw (
    "M18 Foundry did not become ready. Run 'node src\server.js --headless' from " +
    "'$projectRoot' in a PowerShell window to view the startup error."
  )
}

try {
  $currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $maintenanceMutexName = "Local\M18Foundry-Maintenance-{0}" -f $currentUserSid
  $launcherMutexName = "Local\M18Foundry-Launcher-{0}" -f $currentUserSid
  $maintenanceMutex = $null
  $maintenanceMutexAcquired = $false
  $launcherMutex = [Threading.Mutex]::new($false, $launcherMutexName)
  $launcherMutexAcquired = $false
  try {
    if (-not $Stop) {
      $maintenanceMutex = [Threading.Mutex]::new($false, $maintenanceMutexName)
      try {
        $maintenanceMutexAcquired = $maintenanceMutex.WaitOne(0)
      } catch [Threading.AbandonedMutexException] {
        $maintenanceMutexAcquired = $true
      }
      if (-not $maintenanceMutexAcquired) {
        throw "M18 Foundry installation or removal is currently in progress."
      }
    }

    try {
      $launcherMutexAcquired = $launcherMutex.WaitOne(15000)
    } catch [Threading.AbandonedMutexException] {
      $launcherMutexAcquired = $true
    }
    if (-not $launcherMutexAcquired) {
      throw "Another M18 Foundry launch or stop operation is still in progress."
    }
    Invoke-ControllerLauncher
  } finally {
    if ($launcherMutexAcquired) {
      $launcherMutex.ReleaseMutex()
    }
    $launcherMutex.Dispose()
    if ($maintenanceMutexAcquired) {
      $maintenanceMutex.ReleaseMutex()
    }
    if ($null -ne $maintenanceMutex) {
      $maintenanceMutex.Dispose()
    }
  }
} catch {
  $message = $_.Exception.Message
  try {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $errorRecord = "{0} {1}" -f [DateTime]::UtcNow.ToString("o"), $message
    [IO.File]::WriteAllText(
      $launcherErrorLog,
      $errorRecord + [Environment]::NewLine,
      (New-Object System.Text.UTF8Encoding($false))
    )
  } catch {
    # Preserve the original launcher error.
  }

  if (-not $NoBrowser -and -not $Stop) {
    $shell = $null
    try {
      $shell = New-Object -ComObject WScript.Shell
      [void]$shell.Popup(
        "M18 Foundry could not start.`r`n`r`n$message`r`n`r`nSee:`r`n$launcherErrorLog",
        0,
        "M18 Foundry",
        16
      )
    } catch {
      # The launcher error is still available in the runtime log.
    } finally {
      if ($null -ne $shell) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
      }
    }
  }
  throw
}
