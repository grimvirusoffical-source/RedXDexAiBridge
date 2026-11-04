[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputFull=[IO.Path]::GetFullPath($OutputFile)
if ([IO.Path]::GetExtension($outputFull) -ne '.zip') { throw 'Output must be a new ZIP file' }
if (Test-Path -LiteralPath $outputFull) { throw 'Output exists; choose a new filename' }
if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($outputFull)) -PathType Container)) { throw 'Output parent must exist' }
$entries=[ordered]@{
 'README.md'='distribution/chatgpt-plugin/README.md'
 'scripts/export-chatgpt-plugin.cjs'='scripts/export-chatgpt-plugin.cjs'
 'distribution/chatgpt-plugin/template/plugin.json'='distribution/chatgpt-plugin/template/plugin.json'
 'distribution/chatgpt-plugin/template/.codex-plugin/plugin.json'='distribution/chatgpt-plugin/template/.codex-plugin/plugin.json'
 'distribution/chatgpt-plugin/template/skills/red-xai-task-router/SKILL.md'='distribution/chatgpt-plugin/template/skills/red-xai-task-router/SKILL.md'
 'distribution/chatgpt-plugin/template/assets/bridge-icon.png'='distribution/chatgpt-plugin/template/assets/bridge-icon.png'
}
$manifest=Get-Content -LiteralPath (Join-Path $repoRoot $entries['distribution/chatgpt-plugin/template/plugin.json']) -Raw | ConvertFrom-Json
$version=[string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Template version must be explicit SemVer' }
$hashes=@()
foreach($name in $entries.Keys) {
 $source=Join-Path $repoRoot $entries[$name]
 $item=Get-Item -LiteralPath $source
 if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected source entry' }
 if ([IO.Path]::GetExtension($source) -ne '.png') {
  $text=Get-Content -LiteralPath $source -Raw
  if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com|\b[A-Z]{3,16}-[A-Z0-9]*[0-9][A-Z0-9]{3,16}\b') { throw 'Personal endpoint or device data found in public toolkit' }
 }
 $hashes+=[ordered]@{path=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$sourceCommit=(& git -C $repoRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot verify source commit' }
$workingTreeDirty=-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain | Out-String))
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect source state' }
$provenance=[ordered]@{
 version=$version
 sourceRepository='https://github.com/grimvirusoffical-source/RedXDexAiBridge'
 sourceCommit=$sourceCommit
 sourceWorkingTreeDirty=$workingTreeDirty
 endpointBoundPluginIncluded=$false
 files=$hashes
} | ConvertTo-Json -Depth 8
$package=[ordered]@{name='red-xai-bridge-plugin-setup';version=$version;private=$true;engines=[ordered]@{node='>=20'}} | ConvertTo-Json -Depth 4
$stream=$null
$archive=$null
try {
 $stream=[IO.File]::Open($outputFull,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $archive=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
 foreach($name in $entries.Keys) {
  $entry=$archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime=[DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
  $inputStream=[IO.File]::OpenRead((Join-Path $repoRoot $entries[$name]))
  $entryStream=$entry.Open()
  try { $inputStream.CopyTo($entryStream) } finally { $entryStream.Dispose();$inputStream.Dispose() }
 }
 foreach($pair in @(@{name='package.json';text=$package},@{name='PROVENANCE.json';text=$provenance})) {
  $entry=$archive.CreateEntry($pair.name,[IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime=[DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
  $entryStream=$entry.Open()
  $writer=New-Object IO.StreamWriter($entryStream,(New-Object Text.UTF8Encoding($false)))
  try { $writer.Write($pair.text+[Environment]::NewLine) } finally { $writer.Dispose() }
 }
} finally {
 if ($archive) { $archive.Dispose() }
 if ($stream) { $stream.Dispose() }
}
@{
 file=$outputFull
 version=$version
 bytes=(Get-Item -LiteralPath $outputFull).Length
 sha256=(Get-FileHash -LiteralPath $outputFull -Algorithm SHA256).Hash.ToLowerInvariant()
 entries=$entries.Count+2
 sourceCommit=$sourceCommit
 sourceWorkingTreeDirty=$workingTreeDirty
} | ConvertTo-Json -Depth 4
