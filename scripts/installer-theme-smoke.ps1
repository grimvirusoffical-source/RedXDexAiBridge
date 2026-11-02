. (Join-Path $PSScriptRoot 'installer-ci-common.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$root = New-InstallerTestRoot 'installer-theme'
try {
  $cache = Join-Path $env:LOCALAPPDATA 'electron-builder/Cache'
  $compiler = @(Get-ChildItem -LiteralPath $cache -Filter makensis.exe -File -Recurse | Where-Object { $_.Directory.Name -ne 'Bin' })
  $plugins = @(Get-ChildItem -LiteralPath $cache -Filter nsDialogs.dll -File -Recurse | Where-Object { $_.Directory.Name -eq 'x86-unicode' })
  if ($compiler.Count -ne 1 -or $plugins.Count -ne 1) { throw 'Expected one electron-builder NSIS compiler/plugin bundle.' }
  $exe = Join-Path $root 'theme-fixture.exe'
  $steps = Join-Path $root 'fixture-steps.nsh'
  $stepText = 1..20 | ForEach-Object { "File /oname=fixture-$_.svg `"$repo\build\installer-theme\x.svg`"`nSleep 150" }
  $stepText | Set-Content -LiteralPath $steps
  & $compiler[0].FullName '/V2' "/X!addplugindir /x86-unicode `"$($plugins[0].Directory.FullName)`"" "/DBUILD_RESOURCES_DIR=$repo\build" "/DREDX_THEME_EXE=$exe" "/DREDX_THEME_TARGET=$root\fixture files" "/DREDX_THEME_STEPS=$steps" (Join-Path $PSScriptRoot 'installer-theme-harness.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme fixture did not compile.' }
  $capture = Join-Path $root 'theme-capture.exe'
  $csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  & $csc /nologo /optimize+ /target:exe /reference:System.Drawing.dll "/out:$capture" (Join-Path $PSScriptRoot 'installer-theme-capture.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme capture helper did not compile.' }
  & $capture $exe (Join-Path $repo 'build/installer-theme/progress-sprite.bmp') (Join-Path $repo 'verification/installer-theme')
  if ($LASTEXITCODE -ne 0) { throw 'Installer theme runtime inspection failed.' }
} finally {
  Remove-InstallerTestRoot $root
}
