#Requires -Version 5.1

[CmdletBinding()]
param(
  [string]$InstallRoot,
  [switch]$EnableAutoStart,
  [switch]$DisableAutoStart,
  [switch]$Launch,
  [switch]$Uninstall,
  [switch]$PurgeData
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$initialLocation = (Get-Location).Path

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This installer supports Windows 10 and Windows 11 only."
}

if ($EnableAutoStart -and $DisableAutoStart) {
  throw "Use either -EnableAutoStart or -DisableAutoStart, not both."
}
if ($PurgeData -and -not $Uninstall) {
  throw "-PurgeData is valid only with -Uninstall."
}
if ($Uninstall -and ($EnableAutoStart -or $DisableAutoStart -or $Launch)) {
  throw "-Uninstall cannot be combined with auto-start or launch options."
}

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$productId = "codex-vsd-m18-controller"
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$roamingAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$programsFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$startupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)

foreach ($folder in @($localAppData, $roamingAppData, $userProfile, $programsFolder, $startupFolder)) {
  if ([string]::IsNullOrWhiteSpace($folder)) {
    throw "Windows did not provide all required per-user shell folders."
  }
}

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $installedState = Join-Path $sourceRoot "windows\install-state.json"
  if (Test-Path -LiteralPath $installedState -PathType Leaf) {
    $InstallRoot = $sourceRoot
  } else {
    $InstallRoot = Join-Path $localAppData "Programs\M18Foundry"
  }
}

function Get-NormalizedChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $fullPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd("\")
  $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd("\")
  $prefix = $fullParent + [IO.Path]::DirectorySeparatorChar
  if (
    $fullPath.Length -le $fullParent.Length -or
    -not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "$Label must be a child of '$fullParent'."
  }
  return $fullPath
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Copy-InstallPayload {
  param([Parameter(Mandatory = $true)][string]$Destination)

  $requiredFiles = @("package.json", "package-lock.json", "LICENSE")
  foreach ($relativePath in $requiredFiles) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "The installation source is missing '$relativePath'."
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $Destination $relativePath) -Force
  }

  foreach ($relativePath in @("README.md", "THIRD_PARTY_NOTICES.md")) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
      Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $Destination $relativePath) -Force
    }
  }

  foreach ($relativePath in @("src", "public")) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
      throw "The installation source is missing the '$relativePath' directory."
    }
    Copy-DirectoryContents -Source $sourcePath -Destination (Join-Path $Destination $relativePath)
  }

  foreach ($relativePath in @("assets", "windows")) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (Test-Path -LiteralPath $sourcePath -PathType Container) {
      Copy-DirectoryContents -Source $sourcePath -Destination (Join-Path $Destination $relativePath)
    }
  }

  $destinationScripts = Join-Path $Destination "scripts"
  New-Item -ItemType Directory -Path $destinationScripts -Force | Out-Null
  foreach ($scriptName in @("install-windows.ps1", "open-controller.ps1")) {
    $sourcePath = Join-Path (Join-Path $sourceRoot "scripts") $scriptName
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "The installation source is missing 'scripts\$scriptName'."
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $destinationScripts $scriptName) -Force
  }
}

function Get-ToolPath {
  param([Parameter(Mandatory = $true)][string]$CommandName)

  $command = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "'$CommandName' was not found on PATH. Install the required Windows prerequisite and try again."
  }
  return $command.Source
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

function Invoke-NpmCleanInstall {
  param(
    [Parameter(Mandatory = $true)][string]$NpmPath,
    [Parameter(Mandatory = $true)][string]$Prefix
  )

  Write-Host "Installing locked npm dependencies..."
  Push-Location -LiteralPath $Prefix
  try {
    & $NpmPath ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Read-InstanceDescriptor {
  $instanceStatePath = Join-Path $runtimeRoot "instance.json"
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
  if (
    [int]$descriptor.version -ne 1 -or
    [string]$descriptor.token -notmatch '^[A-Za-z0-9_-]{43}$' -or
    @("127.0.0.1", "localhost", "::1") -notcontains [string]$descriptor.host -or
    -not [int]::TryParse([string]$descriptor.port, [ref]$descriptorPort) -or
    $descriptorPort -lt 1 -or
    $descriptorPort -gt 65535 -or
    -not [int]::TryParse([string]$descriptor.pid, [ref]$descriptorProcessId) -or
    $descriptorProcessId -lt 1
  ) {
    return $null
  }

  return [pscustomobject]@{
    token = [string]$descriptor.token
    host = [string]$descriptor.host
    port = $descriptorPort
    pid = $descriptorProcessId
  }
}

function Get-HealthyInstanceDescriptor {
  $descriptor = Read-InstanceDescriptor
  if ($null -eq $descriptor) {
    return $null
  }

  try {
    $uriHost = if ([string]$descriptor.host -eq "::1") { "[::1]" } else { [string]$descriptor.host }
    $headers = @{ "X-VSD-Instance-Token" = [string]$descriptor.token }
    $response = Invoke-WebRequest `
      -Uri ("http://${uriHost}:$([int]$descriptor.port)/api/health") `
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
      $healthProcessId -ne [int]$descriptor.pid
    ) {
      return $null
    }
    return $descriptor
  } catch {
    return $null
  }
}

function Get-ActiveInstanceProcessId {
  $lockPath = Join-Path $runtimeRoot "controller.lock"
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    return $null
  }
  try {
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    if (
      $lock.PSObject.Properties.Name -notcontains "pid" -or
      $lock.PSObject.Properties.Name -notcontains "token" -or
      [string]$lock.token -notmatch '^[A-Za-z0-9_-]{43}$'
    ) {
      return $null
    }
    [int]$lockProcessId = 0
    if (-not [int]::TryParse([string]$lock.pid, [ref]$lockProcessId) -or $lockProcessId -lt 1) {
      return $null
    }
    if ($null -ne (Get-Process -Id $lockProcessId -ErrorAction SilentlyContinue)) {
      return $lockProcessId
    }
  } catch {
    return $null
  }
  return $null
}

function New-ShellShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Description
  )

  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $shell = $null
  $shortcut = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    $shortcut.Save()
  } finally {
    if ($null -ne $shortcut) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    if ($null -ne $shell) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
  }
}

function Test-ManagedShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$ExpectedTargetPath,
    [Parameter(Mandatory = $true)][string]$ExpectedArguments,
    [Parameter(Mandatory = $true)][string]$ExpectedDescription
  )

  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    return $false
  }

  $shell = $null
  $shortcut = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    return (
      [string]::Equals(
        [IO.Path]::GetFullPath([string]$shortcut.TargetPath),
        [IO.Path]::GetFullPath($ExpectedTargetPath),
        [StringComparison]::OrdinalIgnoreCase
      ) -and
      [string]::Equals(
        [string]$shortcut.Arguments,
        $ExpectedArguments,
        [StringComparison]::Ordinal
      ) -and
      [string]::Equals(
        [string]$shortcut.Description,
        $ExpectedDescription,
        [StringComparison]::Ordinal
      )
    )
  } catch {
    return $false
  } finally {
    if ($null -ne $shortcut) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    if ($null -ne $shell) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
  }
}

function Remove-ManagedShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$ExpectedTargetPath,
    [Parameter(Mandatory = $true)][string]$ExpectedArguments,
    [Parameter(Mandatory = $true)][string]$ExpectedDescription,
    [string]$ExpectedParent
  )

  if (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) {
    if (Test-ManagedShortcut `
      -ShortcutPath $ShortcutPath `
      -ExpectedTargetPath $ExpectedTargetPath `
      -ExpectedArguments $ExpectedArguments `
      -ExpectedDescription $ExpectedDescription) {
      Remove-Item -LiteralPath $ShortcutPath -Force
    } else {
      Write-Warning "Preserving '$ShortcutPath' because it no longer matches the managed M18 Foundry shortcut."
    }
  }
  if (
    -not [string]::IsNullOrWhiteSpace($ExpectedParent) -and
    (Test-Path -LiteralPath $ExpectedParent -PathType Container) -and
    $null -eq (Get-ChildItem -LiteralPath $ExpectedParent -Force | Select-Object -First 1)
  ) {
    Remove-Item -LiteralPath $ExpectedParent -Force -ErrorAction SilentlyContinue
  }
}

function Remove-AppOwnedDataDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$AllowedParents,
    [Parameter(Mandatory = $true)][string]$ExpectedLeaf
  )

  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd("\")
  if (-not [string]::Equals((Split-Path -Leaf $fullPath), $ExpectedLeaf, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning "Preserving unexpected data path '$fullPath'."
    return
  }

  $allowed = $false
  foreach ($parent in $AllowedParents) {
    $fullParent = [IO.Path]::GetFullPath($parent).TrimEnd("\")
    if ($fullPath.StartsWith($fullParent + "\", [StringComparison]::OrdinalIgnoreCase)) {
      $allowed = $true
      break
    }
  }
  if (-not $allowed) {
    Write-Warning "Preserving app data outside the expected user directories: '$fullPath'."
    return
  }

  Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-ManagedInstallRoot {
  param([Parameter(Mandatory = $true)][string]$Path)

  $statePath = Join-Path $Path "windows\install-state.json"
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    return $false
  }
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    return (
      $state.PSObject.Properties.Name -contains "productId" -and
      $state.PSObject.Properties.Name -contains "installRoot" -and
      [string]::Equals([string]$state.productId, $productId, [StringComparison]::Ordinal) -and
      [string]::Equals(
        [IO.Path]::GetFullPath([string]$state.installRoot).TrimEnd("\"),
        [IO.Path]::GetFullPath($Path).TrimEnd("\"),
        [StringComparison]::OrdinalIgnoreCase
      )
    )
  } catch {
    return $false
  }
}

$InstallRoot = Get-NormalizedChildPath -Path $InstallRoot -Parent $localAppData -Label "InstallRoot"
$sourceIsInstallRoot = [string]::Equals(
  [IO.Path]::GetFullPath($sourceRoot).TrimEnd("\"),
  $InstallRoot,
  [StringComparison]::OrdinalIgnoreCase
)
$installRootPathExists = Test-Path -LiteralPath $InstallRoot
$installRootExists = Test-Path -LiteralPath $InstallRoot -PathType Container
if ($installRootPathExists -and -not $installRootExists) {
  throw "InstallRoot '$InstallRoot' exists but is not a directory; no files were changed."
}
$installRootHasEntries = $installRootExists -and $null -ne (
  Get-ChildItem -LiteralPath $InstallRoot -Force | Select-Object -First 1
)
if ($installRootExists -and $installRootHasEntries -and -not (Test-ManagedInstallRoot -Path $InstallRoot)) {
  throw (
    "InstallRoot '$InstallRoot' already exists but is not a verified M18 Foundry installation. " +
    "Choose an empty path under Local AppData; no files were changed."
  )
}
$runtimeRoot = Join-Path (Join-Path $localAppData "M18Foundry") "runtime"
$startMenuDirectory = Join-Path $programsFolder "M18 Foundry"
$startMenuShortcut = Join-Path $startMenuDirectory "M18 Foundry.lnk"
$startupShortcut = Join-Path $startupFolder "M18 Foundry.lnk"
$installedLauncher = Join-Path $InstallRoot "scripts\open-controller.ps1"
$powerShellPath = [IO.Path]::GetFullPath((Join-Path $PSHOME "powershell.exe"))
$launcherArguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $installedLauncher
$startupLauncherArguments = $launcherArguments + " -NoBrowser"
$startMenuDescription = "Configure and control a VSDinside or Mirabox M18 Stream Dock"
$startupDescription = "Start the M18 Foundry controller at user sign-in"
$startMenuShortcutExists = Test-Path -LiteralPath $startMenuShortcut -PathType Leaf
$startMenuShortcutIsManaged = Test-ManagedShortcut `
  -ShortcutPath $startMenuShortcut `
  -ExpectedTargetPath $powerShellPath `
  -ExpectedArguments $launcherArguments `
  -ExpectedDescription $startMenuDescription
$startupShortcutExists = Test-Path -LiteralPath $startupShortcut -PathType Leaf
$autoStartWasEnabled = Test-ManagedShortcut `
  -ShortcutPath $startupShortcut `
  -ExpectedTargetPath $powerShellPath `
  -ExpectedArguments $startupLauncherArguments `
  -ExpectedDescription $startupDescription

if (-not $Uninstall -and $startMenuShortcutExists -and -not $startMenuShortcutIsManaged) {
  throw "The Start Menu path '$startMenuShortcut' is occupied by an unmanaged shortcut; it was not overwritten."
}
if ($EnableAutoStart -and $startupShortcutExists -and -not $autoStartWasEnabled) {
  throw "The Startup path '$startupShortcut' is occupied by an unmanaged shortcut; it was not overwritten."
}

$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$maintenanceMutexName = "Local\M18Foundry-Maintenance-{0}" -f $currentUserSid
$maintenanceMutex = [Threading.Mutex]::new($false, $maintenanceMutexName)
$maintenanceMutexAcquired = $false
try {
  try {
    $maintenanceMutexAcquired = $maintenanceMutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $maintenanceMutexAcquired = $true
  }
  if (-not $maintenanceMutexAcquired) {
    throw "Another M18 Foundry installation or removal is already in progress."
  }

if ($Uninstall) {
  if (Test-Path -LiteralPath $installedLauncher -PathType Leaf) {
    Write-Host "Stopping the installed controller if it is running..."
    & $installedLauncher -Stop
  }

  $remainingInstance = Get-HealthyInstanceDescriptor
  if ($null -ne $remainingInstance) {
    throw ((
      "A controller process (PID {0}) is still serving a private local instance on port {1}. " +
      "Close that untracked instance before uninstalling."
    ) -f $remainingInstance.pid, $remainingInstance.port)
  }
  $activeInstanceProcessId = Get-ActiveInstanceProcessId
  if ($null -ne $activeInstanceProcessId) {
    throw (
      "M18 Foundry process PID $activeInstanceProcessId is still starting or unhealthy. " +
      "Close it before uninstalling; no files were removed."
    )
  }

  Remove-ManagedShortcut `
    -ShortcutPath $startMenuShortcut `
    -ExpectedTargetPath $powerShellPath `
    -ExpectedArguments $launcherArguments `
    -ExpectedDescription $startMenuDescription `
    -ExpectedParent $startMenuDirectory
  Remove-ManagedShortcut `
    -ShortcutPath $startupShortcut `
    -ExpectedTargetPath $powerShellPath `
    -ExpectedArguments $startupLauncherArguments `
    -ExpectedDescription $startupDescription

  Set-Location ([IO.Path]::GetTempPath())
  if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  Remove-Item -LiteralPath $runtimeRoot -Recurse -Force -ErrorAction SilentlyContinue

  if ($PurgeData) {
    $allowedDataParents = @($userProfile, $localAppData)
    Remove-AppOwnedDataDirectory `
      -Path (Join-Path $roamingAppData "M18Foundry") `
      -AllowedParents $allowedDataParents `
      -ExpectedLeaf "M18Foundry"
    Remove-AppOwnedDataDirectory `
      -Path (Join-Path $localAppData "M18Foundry") `
      -AllowedParents $allowedDataParents `
      -ExpectedLeaf "M18Foundry"
  }

  Write-Host "M18 Foundry was uninstalled for the current user."
  if (-not $PurgeData) {
    Write-Host "Configuration and uploaded artwork were preserved. Use -Uninstall -PurgeData to remove them."
  }
  return
}

$nodePath = Get-ToolPath -CommandName "node.exe"
$npmPath = Get-ToolPath -CommandName "npm.cmd"
Assert-SupportedNode -NodePath $nodePath

$installParent = Split-Path -Parent $InstallRoot
New-Item -ItemType Directory -Path $installParent -Force | Out-Null
$transactionId = [Guid]::NewGuid().ToString("N")
$stagingRoot = Join-Path $installParent (".M18Foundry-staging-{0}" -f $transactionId)
$backupRoot = Join-Path $installParent (".M18Foundry-backup-{0}" -f $transactionId)
$wantAutoStart = if ($EnableAutoStart) {
  $true
} elseif ($DisableAutoStart) {
  $false
} else {
  $autoStartWasEnabled
}
$hadPreviousInstall = $false
$installationSwapped = $false
$installationCompleted = $false

try {
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  Copy-InstallPayload -Destination $stagingRoot
  Invoke-NpmCleanInstall -NpmPath $npmPath -Prefix $stagingRoot

  $package = Get-Content -LiteralPath (Join-Path $stagingRoot "package.json") -Raw | ConvertFrom-Json
  $installState = [ordered]@{
    productId = $productId
    version = [string]$package.version
    nodePath = [IO.Path]::GetFullPath($nodePath)
    installRoot = $InstallRoot
    installedAt = [DateTime]::UtcNow.ToString("o")
  }
  $installStateJson = ($installState | ConvertTo-Json) + [Environment]::NewLine
  [IO.File]::WriteAllText(
    (Join-Path $stagingRoot "windows\install-state.json"),
    $installStateJson,
    (New-Object System.Text.UTF8Encoding($false))
  )

  if (Test-Path -LiteralPath $installedLauncher -PathType Leaf) {
    Write-Host "Stopping the previous installed controller..."
    & $installedLauncher -Stop
  }
  $remainingInstance = Get-HealthyInstanceDescriptor
  if ($null -ne $remainingInstance) {
    throw ((
      "A controller process (PID {0}) is still serving a private local instance on port {1}. " +
      "Close that untracked instance before reinstalling."
    ) -f $remainingInstance.pid, $remainingInstance.port)
  }
  $activeInstanceProcessId = Get-ActiveInstanceProcessId
  if ($null -ne $activeInstanceProcessId) {
    throw (
      "M18 Foundry process PID $activeInstanceProcessId is still starting or unhealthy. " +
      "Close it before reinstalling; the prior installation is unchanged."
    )
  }

  $hadPreviousInstall = Test-Path -LiteralPath $InstallRoot
  if ($sourceIsInstallRoot) {
    Set-Location ([IO.Path]::GetTempPath())
  }
  if ($hadPreviousInstall) {
    Move-Item -LiteralPath $InstallRoot -Destination $backupRoot
  }
  try {
    Move-Item -LiteralPath $stagingRoot -Destination $InstallRoot
    $installationSwapped = $true
  } catch {
    if ($hadPreviousInstall -and (Test-Path -LiteralPath $backupRoot)) {
      Move-Item -LiteralPath $backupRoot -Destination $InstallRoot
    }
    throw
  }

  if (
    (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf) -and
    -not (Test-ManagedShortcut `
      -ShortcutPath $startMenuShortcut `
      -ExpectedTargetPath $powerShellPath `
      -ExpectedArguments $launcherArguments `
      -ExpectedDescription $startMenuDescription)
  ) {
    throw "The Start Menu shortcut changed during installation and was not overwritten."
  }
  New-ShellShortcut `
    -Path $startMenuShortcut `
    -TargetPath $powerShellPath `
    -Arguments $launcherArguments `
    -WorkingDirectory $InstallRoot `
    -Description $startMenuDescription

  if ($wantAutoStart) {
    if (
      (Test-Path -LiteralPath $startupShortcut -PathType Leaf) -and
      -not (Test-ManagedShortcut `
        -ShortcutPath $startupShortcut `
        -ExpectedTargetPath $powerShellPath `
        -ExpectedArguments $startupLauncherArguments `
        -ExpectedDescription $startupDescription)
    ) {
      throw "The Startup shortcut changed during installation and was not overwritten."
    }
    New-ShellShortcut `
      -Path $startupShortcut `
      -TargetPath $powerShellPath `
      -Arguments $startupLauncherArguments `
      -WorkingDirectory $InstallRoot `
      -Description $startupDescription
  } else {
    Remove-ManagedShortcut `
      -ShortcutPath $startupShortcut `
      -ExpectedTargetPath $powerShellPath `
      -ExpectedArguments $startupLauncherArguments `
      -ExpectedDescription $startupDescription
  }
  $installationCompleted = $true

  if (Test-Path -LiteralPath $backupRoot) {
    try {
      Remove-Item -LiteralPath $backupRoot -Recurse -Force
    } catch {
      Write-Warning "The prior installation remains at '$backupRoot' because Windows reported it in use."
    }
  }
} finally {
  if ($installationSwapped -and -not $installationCompleted) {
    Write-Warning "Installation did not complete; restoring the previous verified installation."
    try {
      Set-Location ([IO.Path]::GetTempPath())
      if (Test-ManagedInstallRoot -Path $InstallRoot) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force
      }
      if ($hadPreviousInstall -and (Test-Path -LiteralPath $backupRoot -PathType Container)) {
        Move-Item -LiteralPath $backupRoot -Destination $InstallRoot
      } elseif (-not $hadPreviousInstall) {
        Remove-ManagedShortcut `
          -ShortcutPath $startMenuShortcut `
          -ExpectedTargetPath $powerShellPath `
          -ExpectedArguments $launcherArguments `
          -ExpectedDescription $startMenuDescription `
          -ExpectedParent $startMenuDirectory
        Remove-ManagedShortcut `
          -ShortcutPath $startupShortcut `
          -ExpectedTargetPath $powerShellPath `
          -ExpectedArguments $startupLauncherArguments `
          -ExpectedDescription $startupDescription
      }
    } catch {
      Write-Warning "Automatic rollback failed: $($_.Exception.Message)"
      Write-Warning "The previous installation, if any, remains at '$backupRoot'."
    }
  }
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "M18 Foundry is installed for the current user at '$InstallRoot'."
Write-Host "Open it from the Start Menu under 'M18 Foundry'."
if ($wantAutoStart) {
  Write-Host "Login auto-start is enabled for this user; it starts the controller without opening a browser."
} else {
  Write-Host "Login auto-start is disabled. Re-run with -EnableAutoStart to opt in."
}

} finally {
  if (Test-Path -LiteralPath $initialLocation -PathType Container) {
    Set-Location -LiteralPath $initialLocation -ErrorAction SilentlyContinue
  }
  if ($maintenanceMutexAcquired) {
    $maintenanceMutex.ReleaseMutex()
  }
  $maintenanceMutex.Dispose()
}

if ($Launch) {
  & $installedLauncher
}
