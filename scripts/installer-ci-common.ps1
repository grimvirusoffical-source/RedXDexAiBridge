$ErrorActionPreference = 'Stop'
# Never execute an installer, capture a window, or clean an installation on a developer PC.
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or -not $env:RUNNER_TEMP) {
  throw 'Installer runtime checks run only on an isolated Windows GitHub Actions runner.'
}
$script:RunnerTempRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path.TrimEnd('\')
function New-InstallerTestRoot([string]$Label) {
  if ($Label -notmatch '^[a-z-]+$') { throw 'Invalid test directory label.' }
  $target = Join-Path $script:RunnerTempRoot ('redx-' + $Label + '-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $target | Out-Null
  Assert-InstallerTestRoot $target
  return $target
}
function Assert-InstallerTestRoot([string]$Target) {
  $resolved = (Resolve-Path -LiteralPath $Target).Path.TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($resolved) -ine $script:RunnerTempRoot -or [IO.Path]::GetFileName($resolved) -notmatch '^redx-[a-z-]+-[a-f0-9]{32}$') {
    throw 'Refusing installer operation outside its unique RUNNER_TEMP directory.'
  }
  if ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Test root is a reparse point.' }
}
function Remove-InstallerTestRoot([string]$Target) {
  Assert-InstallerTestRoot $Target
  if (Get-ChildItem -LiteralPath $Target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) {
    throw 'Refusing recursive cleanup containing a reparse point.'
  }
  Remove-Item -LiteralPath $Target -Recurse -Force
}
