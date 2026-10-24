<#
  Fetch the county Board of Elections' absentee / early-voting file from the
  state platform and, when it has changed, commit and push it - only the CSV.

  WHY THIS RUNS ON lvp-01 AND NOT IN GITHUB ACTIONS
  lookup.boe.ohio.gov sits behind Cloudflare, which answers GitHub's runners
  (datacenter addresses) with HTTP 403 but serves a home connection normally.
  So the download happens here, and the push of the new CSV triggers
  .github/workflows/check-absentee.yml, which merges, geocodes, builds,
  commits voters.json and deploys - all on GitHub.

  Run by hand (Windows PowerShell 5):
    powershell -ExecutionPolicy Bypass -File C:\projects\{{REPO}}\react-app\scripts\refresh-absentee.ps1

  Registered as a scheduled task by register-absentee-task.ps1 in this folder.
  Log: %LOCALAPPDATA%\CountyVoters\<repo>-absentee.log

  It only ever stages and commits the absentee CSV. Anything else you have
  uncommitted in the repo is left alone (git pull uses --autostash). A commit
  that an earlier run made but could not push is pushed on the next run.
#>
$ErrorActionPreference = 'Stop'

$App    = Split-Path -Parent $PSScriptRoot          # ...\react-app
$Repo   = Split-Path -Parent $App                   # ...\{{REPO}}
$Name   = Split-Path -Leaf $Repo
$LogDir = Join-Path $env:LOCALAPPDATA 'CountyVoters'
$Log    = Join-Path $LogDir "$Name-absentee.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Say($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $Log -Value $line
}

# Run a native command line (git, node) through cmd.exe, with cmd doing the
# 2>&1. That matters: Windows PowerShell 5 turns anything a native command
# writes to stderr into an error record, and git writes ordinary progress and
# warnings there ("From https://github.com/...", "CRLF will be replaced by
# LF"). Merged by cmd, PowerShell only ever sees plain text, and the exit code
# alone decides success. Returns the output lines.
function Run([string]$what, [string]$cmdline) {
  $out = & cmd.exe /d /c "$cmdline 2>&1"
  $code = $LASTEXITCODE
  foreach ($l in @($out)) { if ("$l".Trim()) { Say "  $l" } }
  if ($code -ne 0) { throw "$what failed (exit $code)" }
  return $out
}

function Push-Waiting {
  $ahead = [int]((Run 'git rev-list' 'git rev-list --count origin/main..HEAD') | Select-Object -Last 1)
  if ($ahead -gt 0) {
    Say "Pushing $ahead local commit(s)"
    Run 'git push' 'git push origin HEAD:main' | Out-Null
    Say "Pushed. GitHub will merge, geocode, build and deploy."
  }
  return $ahead
}

try {
  Set-Location $Repo
  $current = Get-ChildItem -Path (Join-Path $Repo 'SourceData') -Filter '*absentee*.csv' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $current) {
    Say "No *absentee*.csv in SourceData - no election in progress; nothing to do."
    exit 0
  }
  $rel = "SourceData/$($current.Name)"

  # Bring the local repo up to date first: the workflow commits voters.json
  # back to main after every refresh.
  Say "git pull --rebase --autostash"
  Run 'git pull' 'git pull --rebase --autostash origin main' | Out-Null

  # Fetch, retrying network trouble (the PC may have just woken up).
  $tmp = Join-Path $env:TEMP "$Name-absentee-latest.csv"
  $fetch = Join-Path $App 'scripts\fetch-absentee-platform.mjs'
  $ok = $false
  for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    Say "Fetching from the state platform (attempt $attempt)"
    try {
      Run 'fetch' "node `"$fetch`" `"--out=$tmp`"" | Out-Null
      $ok = $true
    } catch {
      Say "  $($_.Exception.Message)"
      if ($attempt -lt 3) { Start-Sleep -Seconds (60 * $attempt) }
    }
  }
  if (-not $ok) {
    # Still push anything an earlier run left behind.
    Push-Waiting | Out-Null
    throw "fetch failed three times"
  }

  $info = Join-Path $App 'scripts\absentee-file-info.mjs'
  $old = (Run 'file info' "node `"$info`" `"$($current.FullName)`"" | Select-Object -Last 1) | ConvertFrom-Json
  $new = (Run 'file info' "node `"$info`" `"$tmp`"" | Select-Object -Last 1) | ConvertFrom-Json
  Say ("repo:  through {0}, {1} voters, {2} returned" -f $old.latestDate, $old.voters, $old.returned)
  Say ("Board: through {0}, {1} voters, {2} returned" -f $new.latestDate, $new.voters, $new.returned)

  if ($new.sha256 -eq $old.sha256) {
    Say "Unchanged."
    if ((Push-Waiting) -eq 0) { Say "Nothing to push." }
    exit 0
  }
  if ($new.latestDate -lt $old.latestDate) {
    Say "The Board's file is OLDER than the committed one - not replacing it."
    Push-Waiting | Out-Null
    exit 0
  }

  Copy-Item -Force $tmp $current.FullName
  $msgFile = Join-Path $env:TEMP "$Name-absentee-commit.txt"
  @(
    "Absentee file from the Board - data through $($new.latestDate)",
    "",
    "$($new.voters) voters issued a ballot, $($new.returned) returned.",
    "Fetched on lvp-01 by refresh-absentee.ps1; check-absentee.yml merges and deploys."
  ) | Set-Content -Path $msgFile -Encoding ASCII
  Run 'git add' "git add -- `"$rel`"" | Out-Null
  Run 'git commit' "git commit -F `"$msgFile`" -- `"$rel`"" | Out-Null
  Push-Waiting | Out-Null
}
catch {
  Say "FAILED: $($_.Exception.Message)"
  exit 1
}
