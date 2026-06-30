# Run from the consuming project root: .\prototype-orchestrator\setup.ps1 web|mobile
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('web','mobile')]
  [string]$Stack
)

$orchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $orchDir
$targetDir = Join-Path $projectRoot '.claude'

if (Test-Path $targetDir) {
  Write-Host "Removing existing .claude at $targetDir"
  Remove-Item $targetDir -Recurse -Force
}

New-Item -ItemType Directory -Path $targetDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetDir 'agents') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetDir 'skills') | Out-Null

Copy-Item -Path (Join-Path $orchDir '.claude\settings.json') -Destination $targetDir -Force
Copy-Item -Path (Join-Path $orchDir 'claude-setup\common\agents\*') -Destination (Join-Path $targetDir 'agents') -Recurse -Force
Copy-Item -Path (Join-Path $orchDir 'claude-setup\common\skills\*') -Destination (Join-Path $targetDir 'skills') -Recurse -Force
Copy-Item -Path (Join-Path $orchDir "claude-setup\$Stack\agents\*") -Destination (Join-Path $targetDir 'agents') -Recurse -Force
Copy-Item -Path (Join-Path $orchDir "claude-setup\$Stack\skills\*") -Destination (Join-Path $targetDir 'skills') -Recurse -Force

Write-Host ".claude created at $targetDir with stack: $Stack"

Set-Location $orchDir
npm install
Write-Host "Prototype Orchestrator ready."
