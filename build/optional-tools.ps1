# Red-XAI Bridge optional tools
# Runs ONLY when a user explicitly opts in during the normal Windows installer.
# Silent app updates do not invoke this script.
param([Parameter(Mandatory=$true)][ValidateSet('node','git','gh')][string]$Tool)
$ErrorActionPreference='Stop'
$packages=@{node='OpenJS.NodeJS.LTS';git='Git.Git';gh='GitHub.cli'}
$commands=@{node='node.exe';git='git.exe';gh='gh.exe'}
$extra=@{
 node=@("$env:ProgramFiles\nodejs\node.exe","$env:LOCALAPPDATA\Programs\nodejs\node.exe")
 git=@("$env:ProgramFiles\Git\cmd\git.exe","$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")
 gh=@("$env:ProgramFiles\GitHub CLI\gh.exe","$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe")
}
function IsInstalled {
 if(Get-Command $commands[$Tool] -ErrorAction SilentlyContinue){return $true}
 foreach($candidate in $extra[$Tool]){if(Test-Path -LiteralPath $candidate){return $true}}
 return $false
}
if(IsInstalled){exit 0}
$winget=Get-Command winget.exe -ErrorAction SilentlyContinue
if(!$winget){Write-Output 'Windows Package Manager (winget) is unavailable. The Bridge remains installed; install the optional tool separately.';exit 2}
$package=$packages[$Tool]
try {
 & $winget.Source install --id $package --exact --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
 $result=$LASTEXITCODE
 if($result -ne 0){Write-Output ('Optional '+$Tool+' installer returned '+$result);exit 3}
 Write-Output ('Optional '+$Tool+' installation initiated successfully. Restart your terminal to refresh PATH.')
 exit 0
} catch {Write-Output ('Optional '+$Tool+' installation failed. The Bridge itself remains installed.');exit 4}
