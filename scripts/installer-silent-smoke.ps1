. (Join-Path $PSScriptRoot 'installer-ci-common.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $repo "dist/RedXDexAiBridge-$version-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Expected versioned Windows installer is missing.' }
$root = New-InstallerTestRoot 'installer-smoke'
$target = Join-Path $root 'installed app with spaces'
$output = Join-Path $repo 'verification/installer'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$process = $null
try {
  # NSIS requires /D to be the last unquoted argument, including paths with spaces.
  $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$target" -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Silent installer exceeded the three minute limit.' }
  if ($process.ExitCode -ne 0) { throw "Silent installer failed with exit code $($process.ExitCode)." }
  $asar = Join-Path $target 'resources/app.asar'
  $native = Join-Path $target 'resources/redxdex-control.exe'
  $executable = Join-Path $target 'RedXDexAiBridge.exe'
  foreach ($file in @($asar, $native, $executable)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -le 0) { throw 'Installer did not produce a required application file.' }
  }
  if ((Get-FileHash -LiteralPath $native).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo 'build/redxdex-control.exe')).Hash) { throw 'Installed native helper differs from the compiled helper.' }
  if ((Get-FileHash -LiteralPath $asar).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo 'dist/win-unpacked/resources/app.asar')).Hash) { throw 'Installed ASAR differs from the packaged application.' }
  if ((Get-FileHash -LiteralPath $executable).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo 'dist/win-unpacked/RedXDexAiBridge.exe')).Hash) { throw 'Installed executable differs from the packaged application.' }
  $versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
  # Win32 fixed resources use four numeric parts, while package.json uses SemVer.
  $resourceVersion = @($versionInfo.ProductMajorPart, $versionInfo.ProductMinorPart, $versionInfo.ProductBuildPart, $versionInfo.ProductPrivatePart) -join '.'
  @{ expectedVersion=$version; productVersion=$versionInfo.ProductVersion; fileVersion=$versionInfo.FileVersion; fixedProductVersion=$resourceVersion; executableHashVerified=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'installed-version.json')
  if ($resourceVersion -ne "$version.0") { throw "Installed executable resource version '$resourceVersion' (text '$($versionInfo.ProductVersion)') does not match '$version.0'." }
  $env:BRIDGE_TEST_ASAR = $asar
  node -e 'const fs=require("node:fs"),a=require("@electron/asar"),p=JSON.parse(a.extractFile(process.env.BRIDGE_TEST_ASAR,"package.json"));if(p.version!==require("./package.json").version||p.main!=="app/main.cjs")throw Error("Installed ASAR metadata mismatch");for(const file of ["app/sign-in.html","app/sign-in.js","app/preload.cjs"])if(!a.extractFile(process.env.BRIDGE_TEST_ASAR,file).length)throw Error("Missing installed login file");'
  if ($LASTEXITCODE -ne 0) { throw 'Installed ASAR metadata check failed.' }
  # A hidden fixture uses the installed sign-in page and preload, with synthetic IPC responses.
  # It never starts the installed app's production server or signs in a real account.
  & (Join-Path $repo 'node_modules/.bin/electron.cmd') (Join-Path $repo 'scripts/login-interaction-smoke.cjs') 2>&1 | Tee-Object -FilePath (Join-Path $output 'installed-login.log')
  if ($LASTEXITCODE -ne 0) { throw 'Installed sign-in interaction regression failed.' }
  @{ version=$version; silentExitCode=$process.ExitCode; installedArchiveVerified=$true; nativeHelperVerified=$true; executableVersionVerified=$true; installedLoginPassed=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'silent-install.json')
} finally {
  Remove-Item Env:BRIDGE_TEST_ASAR -ErrorAction SilentlyContinue
  if ($process -and -not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
  Remove-InstallerTestRoot $root
}
