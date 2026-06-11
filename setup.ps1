# Run from the consuming project root: .\prototype-orchestrator\setup.ps1
$orchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $orchDir

if (Test-Path "$projectRoot\.claude") {
  Write-Host ".claude already exists — skipping"
} else {
  New-Item -ItemType Junction -Path "$projectRoot\.claude" -Target "$orchDir\.claude"
  Write-Host "Linked .claude -> $orchDir\.claude"
}

Set-Location $orchDir
npm install
Write-Host "Prototype Orchestrator ready."
