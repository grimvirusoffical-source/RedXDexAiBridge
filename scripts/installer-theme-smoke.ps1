. (Join-Path $PSScriptRoot 'installer-ci-common.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$root = New-InstallerTestRoot 'installer-theme'
try {
  $cache = Join-Path $env:LOCALAPPDATA 'electron-builder/Cache'
  $compiler = @(Get-ChildItem -LiteralPath $cache -Filter makensis.exe -File -Recurse | Where-Object { $_.Directory.Name -ne 'Bin' })
  if ($compiler.Count -ne 1) { throw 'Expected one electron-builder NSIS compiler.' }
  $exe = Join-Path $root 'theme-fixture.exe'
  node (Join-Path $PSScriptRoot 'check-installer-helper.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Source-built installer artwork privilege verification failed.' }
  $steps = Join-Path $root 'fixture-steps.nsh'
  $stepText = 1..20 | ForEach-Object { "File /oname=fixture-$_.svg `"$repo\build\installer-theme\x.svg`"`nSleep 500" }
  $stepText | Set-Content -LiteralPath $steps
  & $compiler[0].FullName '/V2' '/WX' "/DBUILD_RESOURCES_DIR=$repo\build" "/DREDX_THEME_EXE=$exe" "/DREDX_THEME_TARGET=$root\fixture files" "/DREDX_THEME_STEPS=$steps" (Join-Path $PSScriptRoot 'installer-theme-harness.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme fixture did not compile.' }
  # electron-builder first compiles an uninstaller wrapper. It must remain free of
  # installer-only callbacks and unused code under the same strict warning policy.
  & $compiler[0].FullName '/V2' '/WX' '/DBUILD_UNINSTALLER' "/DBUILD_RESOURCES_DIR=$repo\build" "/DREDX_THEME_EXE=$root\uninstaller-wrapper-fixture.exe" "/DREDX_THEME_TARGET=$root\unused wrapper target" "/DREDX_THEME_STEPS=$steps" (Join-Path $PSScriptRoot 'installer-theme-harness.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Uninstaller wrapper theme compile regression failed.' }
  $capture = Join-Path $root 'theme-capture.exe'
  $csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  & $csc /nologo /optimize+ /target:exe /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$capture" (Join-Path $PSScriptRoot 'installer-theme-capture.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme capture helper did not compile.' }
  & $capture $exe (Join-Path $repo 'build/installer-theme/progress-sprite.bmp') (Join-Path $repo 'verification/installer-theme')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme runtime inspection failed.' }
  $fallback = Join-Path $root 'theme-fallback-fixture.exe'
  & $compiler[0].FullName '/V2' '/WX' '/DREDX_THEME_INVALID_SPRITE' "/DBUILD_RESOURCES_DIR=$repo\build" "/DREDX_THEME_EXE=$fallback" "/DREDX_THEME_TARGET=$root\fallback files" "/DREDX_THEME_STEPS=$steps" (Join-Path $PSScriptRoot 'installer-theme-harness.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Installer native fallback fixture did not compile.' }
  & $capture $fallback (Join-Path $repo 'build/installer-theme/progress-sprite.bmp') (Join-Path $repo 'verification/installer-theme-fallback') 'fallback'
  if ($LASTEXITCODE -ne 0) { throw 'Installer native progress fallback inspection failed.' }
  & $capture $exe (Join-Path $repo 'build/installer-theme/progress-sprite.bmp') (Join-Path $repo 'verification/installer-theme-termination') 'terminate'
  if ($LASTEXITCODE -ne 0) { throw 'Installer drawing-process termination fallback failed.' }
} finally {
  Remove-InstallerTestRoot $root
}
