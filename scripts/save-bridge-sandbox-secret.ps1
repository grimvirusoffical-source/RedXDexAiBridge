param(
 [Parameter(Mandatory=$true)][ValidateSet('sandbox-api','sandbox-webhook')][string]$Kind,
 [Parameter(Mandatory=$true)][string]$Path,
 [string]$Account='acct_1USFfGEKYCPRlM5G'
)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'This private prompt requires Windows DPAPI.'}
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
if($Account -notmatch '^acct_[A-Za-z0-9]+$'){throw 'A Sandbox account ID is required.'}
$target=[IO.Path]::GetFullPath($Path)
$directory=[IO.Path]::GetDirectoryName($target)
for($cursor=$directory;$cursor;){
 if(Test-Path -LiteralPath (Join-Path $cursor '.git')){throw 'Choose a private location outside any Git checkout.'}
 if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Choose a private directory without junctions or symbolic links.'}
 $parent=[IO.Path]::GetDirectoryName($cursor)
 if($parent -eq $cursor){break}
 $cursor=$parent
}
if(Test-Path -LiteralPath $target){throw 'The destination already exists. Choose a new filename; existing credentials are preserved.'}
$prompt=if($Kind -eq 'sandbox-api'){'Enter the Sandbox restricted API key (rk_test_). Input is hidden'}else{'Enter the Sandbox webhook signing secret (whsec_). Input is hidden'}
$secret=Read-Host -Prompt $prompt -AsSecureString
$pointer=[IntPtr]::Zero
try{
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $valid=if($Kind -eq 'sandbox-api'){$plain -cmatch '^rk_test_[A-Za-z0-9]{16,512}$'}else{$plain -cmatch '^whsec_[A-Za-z0-9]{16,512}$'}
 if(-not $valid){throw 'The value does not match the selected Sandbox credential type. Nothing was saved.'}
 $plain=$null
 $envelope=@{version=1;protection='windows-dpapi-current-user';mode='sandbox';kind=$Kind;account=$Account;ciphertext=(ConvertFrom-SecureString $secret)}
 [IO.Directory]::CreateDirectory($directory) | Out-Null
 $access=[Security.AccessControl.FileSecurity]::new()
 $access.SetAccessRuleProtection($true,$false)
 $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $access.SetOwner($owner)
 $access.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','Allow'))
 $access.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','Allow'))
 # Apply the private ACL when creating the new file. A write-only stream does
 # not carry permission to change its ACL after creation on all Windows hosts.
 if($PSVersionTable.PSEdition -eq 'Core'){
  $stream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($target),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$access)
 }else{
  $stream=[IO.FileStream]::new($target,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$access)
 }
 try{
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($envelope | ConvertTo-Json -Compress))
  $stream.Write($bytes,0,$bytes.Length)
 }finally{$stream.Dispose()}
 Write-Host 'Saved an encrypted, current-user Sandbox credential with a private file ACL. No credential value was displayed.'
}finally{
 $plain=$null
 if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 if($secret){$secret.Dispose()}
}
