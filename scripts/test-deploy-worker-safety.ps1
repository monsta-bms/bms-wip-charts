Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "deploy-worker.ps1")

$script:PassedCount = 0
$script:FailedCount = 0

function Assert-TestTrue {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-TestEqual {
    param(
        $Actual,
        $Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ($Actual -cne $Expected) {
        throw $Message
    }
}

function Assert-TestArrayEqual {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Actual,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ($Actual.Count -ne $Expected.Count) {
        throw ("{0}: expected count {1}, actual {2}" -f $Message, $Expected.Count, $Actual.Count)
    }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ([string]$Actual[$index] -cne [string]$Expected[$index]) {
            throw ("{0}: mismatch at index {1}" -f $Message, $index)
        }
    }
}

function Assert-ThrowsDeployCode {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedCode,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )
    try {
        & $Action | Out-Null
    }
    catch {
        $actualCode = [string]$_.Exception.Data["Code"]
        if ($actualCode -cne $ExpectedCode) {
            throw ("expected error code {0}, actual {1}" -f $ExpectedCode, $actualCode)
        }
        return
    }
    throw ("expected error code was not thrown: " + $ExpectedCode)
}

function Invoke-SafetyTest {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )
    try {
        & $Action
        $script:PassedCount++
        Write-Host ("[PASS] " + $Name)
    }
    catch {
        $script:FailedCount++
        Write-Host ("[FAIL] " + $Name + ": " + (Protect-DeployLogText -Text $_.Exception.Message))
    }
}

function Get-ValidToml {
    return @'
name = "bms-wip-charts-worker"
main = "src/index.ts"
compatibility_date = "2026-06-28"
workers_dev = true

[triggers]
crons = ["0 18 * * *", "0 * * * *"]

[vars]
WITHDRAWAL_CRON_MODE = "active"

[secrets]
required = [
  "ADMIN_TOKEN",
  "PASSWORD_HASH_SECRET",
  "ABUSE_HASH_SECRET",
  "WITHDRAWAL_IDEMPOTENCY_SECRET",
  "TURNSTILE_SECRET",
  "TURNSTILE_MODE"
]

[[d1_databases]]
binding = "DB"
database_name = "wip-bms-charts-db"
database_id = "fixture-database-id"

[[r2_buckets]]
binding = "FILES"
bucket_name = "wip-bms-charts-files"
'@
}

function Set-RequiredArrayDefinition {
    param(
        [Parameter(Mandatory = $true)][string]$Toml,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$RequiredValue
    )
    $pattern = [regex]::new('(?ms)(^\[secrets\]\s*^required\s*=\s*)\[.*?^\]', [Text.RegularExpressions.RegexOptions]::Multiline -bor [Text.RegularExpressions.RegexOptions]::Singleline)
    $evaluator = [Text.RegularExpressions.MatchEvaluator]{
        param($match)
        return $match.Groups[1].Value + $RequiredValue
    }
    $updated = $pattern.Replace($Toml, $evaluator, 1)
    Assert-TestTrue -Condition ($updated -cne $Toml) -Message "required array fixture was not replaced"
    return $updated
}

function ConvertTo-TomlStringArrayFixture {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Values,
        [switch]$TrailingComma
    )
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add("[")
    for ($index = 0; $index -lt $Values.Count; $index++) {
        $escaped = $Values[$index].Replace('\', '\\').Replace('"', '\"')
        $needsComma = $index -lt ($Values.Count - 1) -or $TrailingComma
        $suffix = if ($needsComma) { "," } else { "" }
        [void]$lines.Add(('  "' + $escaped + '"' + $suffix))
    }
    [void]$lines.Add("]")
    return $lines.ToArray() -join "`n"
}

function Write-ConfigFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Assert-ConfigTextAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    Write-ConfigFixture -Path $Path -Content $Content
    $config = Read-WranglerSafetyConfig -Path $Path
    Assert-WranglerSafetyConfig -Config $config | Out-Null
}

function Read-ConfigTextFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    Write-ConfigFixture -Path $Path -Content $Content
    return Read-WranglerSafetyConfig -Path $Path
}

function Assert-ConfigTextRejected {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content,
        [Parameter(Mandatory = $true)][string]$Code
    )
    Write-ConfigFixture -Path $Path -Content $Content
    Assert-ThrowsDeployCode -ExpectedCode $Code -Action {
        $config = Read-WranglerSafetyConfig -Path $Path
        Assert-WranglerSafetyConfig -Config $config | Out-Null
    }
}

function New-GitFixtureState {
    param(
        [bool]$Dirty = $false,
        [int]$Ahead = 0,
        [int]$Behind = 0,
        [string]$Branch = "main",
        [bool]$Conflicts = $false
    )
    return [pscustomobject]@{
        IsRepository = $true
        HasConflicts = $Conflicts
        IsDirty = $Dirty
        Branch = $Branch
        HeadSha = "head"
        OriginMainSha = "origin"
        AheadCount = $Ahead
        BehindCount = $Behind
    }
}

function Get-BatchFileSafetyState {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )
    $bytes = [IO.File]::ReadAllBytes($Path)
    $nonAsciiCount = @($bytes | Where-Object { $_ -gt 127 }).Count
    $lineFeedCount = 0
    $bareLineFeedCount = 0
    for ($index = 0; $index -lt $bytes.Length; $index++) {
        if ($bytes[$index] -eq 10) {
            $lineFeedCount++
            if ($index -eq 0 -or $bytes[$index - 1] -ne 13) {
                $bareLineFeedCount++
            }
        }
    }
    return [pscustomobject]@{
        Path = $Path
        Text = [Text.Encoding]::ASCII.GetString($bytes)
        NonAsciiCount = $nonAsciiCount
        HasUtf8Bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
        LineFeedCount = $lineFeedCount
        BareLineFeedCount = $bareLineFeedCount
    }
}

function Invoke-BatchParserFixture {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$FixturePath,
        [Parameter(Mandatory = $true)][int]$MockExitCode
    )
    $sourceText = [IO.File]::ReadAllText($SourcePath, [Text.Encoding]::ASCII)
    $mockCommand = "cmd.exe /D /C exit /b $MockExitCode"
    $fixtureText = [regex]::Replace($sourceText, '(?m)^powershell\.exe [^\r\n]+', $mockCommand)
    Assert-TestTrue -Condition ($fixtureText -cne $sourceText) -Message "PowerShell command was not replaced in the batch fixture"
    [IO.File]::WriteAllText($FixturePath, $fixtureText, [Text.Encoding]::ASCII)

    $previousNoPause = $env:SAFE_WORKER_DEPLOY_NO_PAUSE
    try {
        $env:SAFE_WORKER_DEPLOY_NO_PAUSE = "1"
        $outputLines = @(& $env:ComSpec /D /C "call `"$FixturePath`"" 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $previousNoPause) {
            Remove-Item Env:SAFE_WORKER_DEPLOY_NO_PAUSE -ErrorAction SilentlyContinue
        }
        else {
            $env:SAFE_WORKER_DEPLOY_NO_PAUSE = $previousNoPause
        }
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($outputLines | ForEach-Object { [string]$_ }) -join "`n"
    }
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDirectory = [IO.Path]::GetFullPath((Join-Path $tempBase ("deploy-worker-safety-tests-" + [Guid]::NewGuid().ToString("N"))))
if (-not $tempDirectory.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "TEST_TEMP_PATH_INVALID"
}
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
$configPath = Join-Path $tempDirectory "wrangler.toml"
$repositoryRoot = (Get-DeployPaths).RepositoryRoot

$dryRunOutput = @'
Total Upload: 100 KiB / gzip: 20 KiB
Your Worker has access to the following bindings:
env.DB (wip-bms-charts-db) D1 Database
env.FILES (wip-bms-charts-files) R2 Bucket
env.WITHDRAWAL_CRON_MODE ("active") Environment Variable
--dry-run: exiting now.
'@

$deployOutput = @'
Uploaded bms-wip-charts-worker (1.23 sec)
Deployed bms-wip-charts-worker triggers (0.45 sec)
  https://bms-wip-charts-worker.monsta3228gsl.workers.dev
  schedule: 0 18 * * *
  schedule: 0 * * * *
Current Version ID: 11111111-2222-3333-4444-555555555555
'@

try {
    Invoke-SafetyTest "01 valid config is allowed" {
        Assert-ConfigTextAllowed -Path $configPath -Content (Get-ValidToml)
    }
    Invoke-SafetyTest "02 wrong Worker name is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('name = "bms-wip-charts-worker"', 'name = "bms-wip-charts"')) -Code "DEPLOY_WORKER_NAME_MISMATCH"
    }
    Invoke-SafetyTest "03 wrong main is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('main = "src/index.ts"', 'main = "docs/index.js"')) -Code "DEPLOY_MAIN_MISMATCH"
    }
    Invoke-SafetyTest "04 wrong D1 binding is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('binding = "DB"', 'binding = "OTHER_DB"')) -Code "DEPLOY_D1_MISMATCH"
    }
    Invoke-SafetyTest "05 wrong D1 name is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('database_name = "wip-bms-charts-db"', 'database_name = "other-db"')) -Code "DEPLOY_D1_MISMATCH"
    }
    Invoke-SafetyTest "06 wrong R2 binding is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('binding = "FILES"', 'binding = "ASSETS"')) -Code "DEPLOY_R2_MISMATCH"
    }
    Invoke-SafetyTest "07 wrong R2 name is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('bucket_name = "wip-bms-charts-files"', 'bucket_name = "other-files"')) -Code "DEPLOY_R2_MISMATCH"
    }
    Invoke-SafetyTest "08 non-active withdrawal mode is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('WITHDRAWAL_CRON_MODE = "active"', 'WITHDRAWAL_CRON_MODE = "observe"')) -Code "DEPLOY_WITHDRAWAL_MODE_MISMATCH"
    }
    Invoke-SafetyTest "09 missing Cron is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('crons = ["0 18 * * *", "0 * * * *"]', 'crons = ["0 * * * *"]')) -Code "DEPLOY_CRON_MISMATCH"
    }
    Invoke-SafetyTest "10 extra Cron is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('crons = ["0 18 * * *", "0 * * * *"]', 'crons = ["0 18 * * *", "0 * * * *", "30 * * * *"]')) -Code "DEPLOY_CRON_MISMATCH"
    }
    Invoke-SafetyTest "11 assets table is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml) + "`n[assets]`ndirectory = `"docs`"") -Code "DEPLOY_ASSETS_DETECTED"
    }
    Invoke-SafetyTest "12 site table is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml) + "`n[site]`nbucket = `"docs`"") -Code "DEPLOY_ASSETS_DETECTED"
    }
    Invoke-SafetyTest "13 docs reference is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml) + "`ncustom_output = `"./docs`"") -Code "DEPLOY_ASSETS_DETECTED"
    }
    Invoke-SafetyTest "14 root wrangler.jsonc is rejected" {
        $state = [pscustomobject]@{ RootConfigExists = $true; Redirects = @() }
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_ROOT_CONFIG_DETECTED" -Action { Assert-DeploymentArtifactState -State $state }
    }
    Invoke-SafetyTest "15 valid dry-run output is allowed" {
        Assert-WranglerDryRunOutput -Output $dryRunOutput | Out-Null
    }
    Invoke-SafetyTest "16 assets dry-run output is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Action { Assert-WranglerDryRunOutput -Output ($dryRunOutput + "`nBuilding list of assets") }
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Action { Assert-WranglerDryRunOutput -Output ($dryRunOutput + "`ndocs") }
    }
    Invoke-SafetyTest "17 static Worker name is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Action { Assert-WranglerDryRunOutput -Output ($dryRunOutput + "`nDeployed bms-wip-charts") }
    }
    Invoke-SafetyTest "18 static Worker URL is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Action { Assert-WranglerDryRunOutput -Output ($dryRunOutput + "`nhttps://bms-wip-charts.monsta3228gsl.workers.dev") }
    }
    Invoke-SafetyTest "19 valid deploy output is allowed" {
        $result = Assert-WranglerDeployOutput -Output $deployOutput
        Assert-TestEqual -Actual $result.VersionId -Expected "11111111-2222-3333-4444-555555555555" -Message "version id mismatch"
    }
    Invoke-SafetyTest "20 valid health response is allowed" {
        Assert-HealthResponse -StatusCode 200 -ContentType "application/json; charset=utf-8" -Body '{"status":"ok","service":"bms-wip-charts-worker"}' | Out-Null
    }
    Invoke-SafetyTest "21 wrong health service is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_HEALTH_FAILED" -Action { Assert-HealthResponse -StatusCode 200 -ContentType "application/json" -Body '{"status":"ok","service":"bms-wip-charts"}' }
    }
    Invoke-SafetyTest "22 confirmation requires exact text" {
        Assert-TestTrue -Condition (Test-DeployConfirmation -InputText "DEPLOY bms-wip-charts-worker") -Message "exact confirmation rejected"
        foreach ($invalid in @("", "y", "DEPLOY bms-wip-charts", "DEPLOY bms-wip-charts-worker ", "deploy bms-wip-charts-worker")) {
            Assert-TestTrue -Condition (-not (Test-DeployConfirmation -InputText $invalid)) -Message "invalid confirmation allowed"
        }
    }
    Invoke-SafetyTest "23 Worker-name substring is not a false positive" {
        Assert-TestTrue -Condition (-not (Test-StaticWorkerTargetInOutput -Output "Uploaded bms-wip-charts-worker")) -Message "API Worker was mistaken for static Worker"
        Assert-WranglerDryRunOutput -Output ($dryRunOutput + "`nWorker: bms-wip-charts-worker") | Out-Null
    }
    Invoke-SafetyTest "24 no-argument path never requests production deploy" {
        Assert-TestTrue -Condition (-not (Test-ProductionDeployRequested -DeployMode $false -Confirmation "DEPLOY bms-wip-charts-worker")) -Message "check mode requested deploy"
        Assert-TestEqual -Actual $script:SafeDeployMainInvocationCount -Expected 0 -Message "dot-source invoked main"
        Assert-TestEqual -Actual $script:ProductionDeployInvocationCount -Expected 0 -Message "dot-source invoked production deploy"
    }
    Invoke-SafetyTest "25 pseudo secrets are redacted from logs" {
        $logPath = Join-Path $tempDirectory "redaction.log"
        $context = [pscustomobject]@{ LogPath = $logPath }
        Write-DeployLog -Context $context -Level "INFO" -NoConsole -Message "ADMIN_TOKEN=fake-admin-value HASH_SECRET=fake-hash-value TURNSTILE_SECRET=fake-turnstile-value env.EXTRA_API_TOKEN(`"fake-parenthesized-value`") Authorization: Bearer fake-bearer-value R2_KEY=private/object.bms"
        $logged = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
        foreach ($forbidden in @("fake-admin-value", "fake-hash-value", "fake-turnstile-value", "fake-parenthesized-value", "fake-bearer-value", "private/object.bms")) {
            Assert-TestTrue -Condition (-not $logged.Contains($forbidden)) -Message "sensitive fixture was written"
        }
    }
    Invoke-SafetyTest "26 dirty Git state rejects deploy" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_GIT_DIRTY" -Action { Assert-GitSafetyState -State (New-GitFixtureState -Dirty $true) -DeployMode $true }
    }
    Invoke-SafetyTest "27 unpushed Git state rejects deploy" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_NOT_PUSHED" -Action { Assert-GitSafetyState -State (New-GitFixtureState -Ahead 1) -DeployMode $true }
    }
    Invoke-SafetyTest "28 behind Git state rejects deploy" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_BEHIND_ORIGIN" -Action { Assert-GitSafetyState -State (New-GitFixtureState -Behind 1) -DeployMode $true }
    }
    Invoke-SafetyTest "29 diverged Git state rejects deploy" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DIVERGED" -Action { Assert-GitSafetyState -State (New-GitFixtureState -Ahead 1 -Behind 1) -DeployMode $true }
    }
    Invoke-SafetyTest "30 workers_dev false is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('workers_dev = true', 'workers_dev = false')) -Code "DEPLOY_CONFIG_INVALID"
    }
    Invoke-SafetyTest "31 empty D1 database_id is rejected" {
        Assert-ConfigTextRejected -Path $configPath -Content ((Get-ValidToml).Replace('database_id = "fixture-database-id"', 'database_id = ""')) -Code "DEPLOY_D1_MISMATCH"
    }
    Invoke-SafetyTest "32 unsafe redirect is rejected" {
        $redirect = [pscustomobject]@{ Path = "fixture"; ResolvedConfigPath = "static"; IsValid = $true; TargetsApiWorker = $false }
        $state = [pscustomobject]@{ RootConfigExists = $false; Redirects = @($redirect) }
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_REDIRECT_CONFIG_DETECTED" -Action { Assert-DeploymentArtifactState -State $state }
    }
    Invoke-SafetyTest "33 API Worker redirect is allowed" {
        $redirect = [pscustomobject]@{ Path = "fixture"; ResolvedConfigPath = "api"; IsValid = $true; TargetsApiWorker = $true }
        $state = [pscustomobject]@{ RootConfigExists = $false; Redirects = @($redirect) }
        Assert-DeploymentArtifactState -State $state | Out-Null
    }
    Invoke-SafetyTest "34 valid difficulty table response is allowed" {
        $html = '<html><head><meta name="bmstable"></head><body>リサイクルセンター RC★ header.json data.json</body></html>'
        Assert-DifficultyTableResponse -StatusCode 200 -ContentType "text/html; charset=utf-8" -Body $html | Out-Null
    }
    Invoke-SafetyTest "35 incomplete difficulty table response is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DIFFICULTY_TABLE_CHECK_FAILED" -Action { Assert-DifficultyTableResponse -StatusCode 200 -ContentType "text/html" -Body "header.json data.json" }
    }
    Invoke-SafetyTest "36 dry-run without active mode is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Action { Assert-WranglerDryRunOutput -Output ($dryRunOutput.Replace('env.WITHDRAWAL_CRON_MODE ("active") Environment Variable', 'env.WITHDRAWAL_CRON_MODE ("observe") Environment Variable')) }
    }
    Invoke-SafetyTest "37 unresolved Git conflict is rejected" {
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_GIT_DIRTY" -Action { Assert-GitSafetyState -State (New-GitFixtureState -Conflicts $true) -DeployMode $false }
    }
    Invoke-SafetyTest "38 deploy output without Version ID is rejected" {
        $withoutVersion = $deployOutput -replace '(?m)^Current Version ID:.*$', ''
        Assert-ThrowsDeployCode -ExpectedCode "DEPLOY_TARGET_MISMATCH" -Action { Assert-WranglerDeployOutput -Output $withoutVersion }
    }
    Invoke-SafetyTest "39 resolved deployment paths are absolute and fixed" {
        $paths = Get-DeployPaths
        Assert-TestTrue -Condition ([IO.Path]::IsPathRooted($paths.RepositoryRoot)) -Message "repository path is not absolute"
        Assert-TestTrue -Condition ([IO.Path]::IsPathRooted($paths.WorkerConfigPath)) -Message "config path is not absolute"
        Assert-TestTrue -Condition ($paths.WorkerConfigPath.EndsWith('worker\wrangler.toml', [StringComparison]::OrdinalIgnoreCase)) -Message "config path is not fixed"
    }
    Invoke-SafetyTest "40 batch wrappers are ASCII CRLF without BOM" {
        foreach ($wrapperName in @("deploy-worker-check.bat", "deploy-worker.bat")) {
            $state = Get-BatchFileSafetyState -Path (Join-Path $repositoryRoot $wrapperName)
            Assert-TestEqual -Actual $state.NonAsciiCount -Expected 0 -Message "$wrapperName contains non-ASCII bytes"
            Assert-TestTrue -Condition (-not $state.HasUtf8Bom) -Message "$wrapperName contains a UTF-8 BOM"
            Assert-TestTrue -Condition ($state.LineFeedCount -gt 0) -Message "$wrapperName has no line endings"
            Assert-TestEqual -Actual $state.BareLineFeedCount -Expected 0 -Message "$wrapperName contains bare LF line endings"
            Assert-TestTrue -Condition (-not $state.Text.Contains("chcp")) -Message "$wrapperName changes the code page"
            Assert-TestTrue -Condition ($state.Text.Contains("if not defined SAFE_WORKER_DEPLOY_NO_PAUSE pause")) -Message "$wrapperName does not preserve interactive pause"
        }
    }
    Invoke-SafetyTest "41 batch wrappers call only the fixed PowerShell entry point" {
        $checkText = (Get-BatchFileSafetyState -Path (Join-Path $repositoryRoot "deploy-worker-check.bat")).Text
        $deployText = (Get-BatchFileSafetyState -Path (Join-Path $repositoryRoot "deploy-worker.bat")).Text
        $checkCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-worker.ps1"'
        $deployCommand = $checkCommand + ' -Deploy'
        Assert-TestTrue -Condition ($checkText.Contains($checkCommand)) -Message "check wrapper does not call the fixed PowerShell script"
        Assert-TestTrue -Condition (-not $checkText.Contains($deployCommand)) -Message "check wrapper requests production deployment"
        Assert-TestTrue -Condition ($deployText.Contains($deployCommand)) -Message "deploy wrapper does not call the fixed PowerShell script with -Deploy"
    }
    Invoke-SafetyTest "42 cmd.exe parses both wrappers and preserves exit codes" {
        foreach ($wrapperName in @("deploy-worker-check.bat", "deploy-worker.bat")) {
            $fixturePath = Join-Path $tempDirectory ("fixture-" + $wrapperName)
            $result = Invoke-BatchParserFixture -SourcePath (Join-Path $repositoryRoot $wrapperName) -FixturePath $fixturePath -MockExitCode 7
            Assert-TestEqual -Actual $result.ExitCode -Expected 7 -Message "$wrapperName did not preserve the failure exit code"
            foreach ($parserError in @("ExecutionPolicy", "is not recognized", "内部コマンドまたは外部コマンド", "was unexpected at this time", "予期しない", "The syntax of the command is incorrect", "構文が誤っています")) {
                Assert-TestTrue -Condition (-not $result.Output.Contains($parserError)) -Message "$wrapperName produced a cmd.exe parser error"
            }
        }
    }
    Invoke-SafetyTest "43 deploy wrapper cannot deploy without exact confirmation" {
        Assert-TestTrue -Condition (-not (Test-ProductionDeployRequested -DeployMode $true -Confirmation "")) -Message "empty confirmation requested production deploy"
        Assert-TestTrue -Condition (-not (Test-ProductionDeployRequested -DeployMode $true -Confirmation "y")) -Message "short confirmation requested production deploy"
        Assert-TestEqual -Actual $script:ProductionDeployInvocationCount -Expected 0 -Message "batch safety tests invoked production deploy"
    }
    Invoke-SafetyTest "44 current wrangler.toml is parsed and allowed" {
        $currentConfig = Read-WranglerSafetyConfig -Path (Join-Path $repositoryRoot "worker\wrangler.toml")
        Assert-WranglerSafetyConfig -Config $currentConfig | Out-Null
        Assert-TestArrayEqual -Actual @($currentConfig.RequiredSecrets) -Expected @($script:ExpectedRequiredSecrets) -Message "current required secrets mismatch"
    }
    Invoke-SafetyTest "45 one-line crons array remains supported" {
        $parsed = Read-ConfigTextFixture -Path $configPath -Content (Get-ValidToml)
        Assert-TestArrayEqual -Actual @($parsed.Crons) -Expected @($script:ExpectedCrons) -Message "one-line crons mismatch"
    }
    Invoke-SafetyTest "46 multiline required array is parsed" {
        $parsed = Read-ConfigTextFixture -Path $configPath -Content (Get-ValidToml)
        Assert-TestArrayEqual -Actual @($parsed.RequiredSecrets) -Expected @($script:ExpectedRequiredSecrets) -Message "multiline required secrets mismatch"
    }
    Invoke-SafetyTest "47 multiline required array permits trailing comma" {
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $script:ExpectedRequiredSecrets -TrailingComma
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextAllowed -Path $configPath -Content $fixture
    }
    Invoke-SafetyTest "48 array element line permits trailing comment" {
        $requiredValue = @(
            "[",
            '  "ADMIN_TOKEN", # admin binding name',
            '  "PASSWORD_HASH_SECRET", # password hash binding name',
            '  "ABUSE_HASH_SECRET",',
            '  "WITHDRAWAL_IDEMPOTENCY_SECRET",',
            '  "TURNSTILE_SECRET",',
            '  "TURNSTILE_MODE" # mode binding name',
            "]"
        ) -join "`n"
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextAllowed -Path $configPath -Content $fixture
    }
    Invoke-SafetyTest "49 hash inside quoted array string is not a comment" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '["name#fragment"] # array comment'
        $parsed = Read-ConfigTextFixture -Path $configPath -Content $fixture
        Assert-TestArrayEqual -Actual @($parsed.RequiredSecrets) -Expected @("name#fragment") -Message "quoted hash was truncated"
    }
    Invoke-SafetyTest "50 brackets and escaped quote inside string do not close array" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '["escaped quote \" with [brackets]"]'
        $parsed = Read-ConfigTextFixture -Path $configPath -Content $fixture
        Assert-TestArrayEqual -Actual @($parsed.RequiredSecrets) -Expected @('escaped quote " with [brackets]') -Message "quoted brackets or escape were parsed incorrectly"
    }
    Invoke-SafetyTest "51 empty array is parsed" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '[]'
        $parsed = Read-ConfigTextFixture -Path $configPath -Content $fixture
        Assert-TestEqual -Actual @($parsed.RequiredSecrets).Count -Expected 0 -Message "empty array was not empty"
    }
    Invoke-SafetyTest "52 unterminated array is rejected with fixed code" {
        $fixture = "[secrets]`nrequired = [`n  `"ADMIN_TOKEN`""
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED"
    }
    Invoke-SafetyTest "53 nested array is rejected with fixed code" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '[["ADMIN_TOKEN"]]'
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_INVALID"
    }
    Invoke-SafetyTest "54 numeric array element is rejected with fixed code" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '[123]'
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_INVALID"
    }
    Invoke-SafetyTest "55 missing comma is rejected with fixed code" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '["ADMIN_TOKEN" "PASSWORD_HASH_SECRET"]'
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_INVALID"
    }
    Invoke-SafetyTest "56 missing required secret name is rejected" {
        $names = @($script:ExpectedRequiredSecrets | Where-Object { $_ -cne "TURNSTILE_MODE" })
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH"
    }
    Invoke-SafetyTest "57 extra required secret name is rejected" {
        $names = @($script:ExpectedRequiredSecrets) + @("EXTRA_SECRET")
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH"
    }
    Invoke-SafetyTest "58 duplicate required secret name is rejected" {
        $names = @($script:ExpectedRequiredSecrets) + @("ADMIN_TOKEN")
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH"
    }
    Invoke-SafetyTest "59 parser errors do not expose secret token or hash values" {
        $adminValue = "fixture-admin-token-sensitive-value"
        $tokenValue = "fixture-turnstile-token-sensitive-value"
        $hashValue = "fixture-password-hash-sensitive-value"
        $fixture = "[vars]`nADMIN_TOKEN = `"$adminValue`"`nTURNSTILE_SECRET = `"$tokenValue`"`nPASSWORD_HASH_SECRET = `"$hashValue`"`n[secrets]`nrequired = [`n  `"ADMIN_TOKEN`""
        Write-ConfigFixture -Path $configPath -Content $fixture
        $caught = $null
        try {
            Read-WranglerSafetyConfig -Path $configPath | Out-Null
        }
        catch {
            $caught = $_.Exception
        }
        Assert-TestTrue -Condition ($null -ne $caught) -Message "sensitive parser fixture was not rejected"
        Assert-TestEqual -Actual ([string]$caught.Data["Code"]) -Expected "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Message "sensitive parser fixture error code mismatch"
        $logPath = Join-Path $tempDirectory "parser-sensitive-error.log"
        $context = [pscustomobject]@{ LogPath = $logPath }
        Write-DeployLog -Context $context -Level "ERROR" -NoConsole -Message ("code=" + $caught.Data["Code"] + " cause=" + $caught.Message + " guidance=" + $caught.Data["Guidance"])
        $logged = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
        foreach ($forbidden in @($adminValue, $tokenValue, $hashValue)) {
            Assert-TestTrue -Condition (-not $logged.Contains($forbidden)) -Message "parser error log exposed a sensitive fixture value"
        }
    }
    Invoke-SafetyTest "60 empty required secret name is rejected" {
        $names = @($script:ExpectedRequiredSecrets) + @("")
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH"
    }
    Invoke-SafetyTest "61 required secret order is ignored" {
        $names = @("TURNSTILE_MODE", "TURNSTILE_SECRET", "WITHDRAWAL_IDEMPOTENCY_SECRET", "ABUSE_HASH_SECRET", "PASSWORD_HASH_SECRET", "ADMIN_TOKEN")
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextAllowed -Path $configPath -Content $fixture
    }
    Invoke-SafetyTest "62 section header inside array is rejected" {
        $fixture = "[secrets]`nrequired = [`n[vars]`nWITHDRAWAL_CRON_MODE = `"active`""
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_INVALID"
    }
    Invoke-SafetyTest "63 inline table array element is rejected" {
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue '[{ name = "ADMIN_TOKEN" }]'
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_CONFIG_ARRAY_INVALID"
    }
    Invoke-SafetyTest "64 required secret names are case-sensitive" {
        $names = @($script:ExpectedRequiredSecrets | ForEach-Object { if ($_ -ceq "ADMIN_TOKEN") { "admin_token" } else { $_ } })
        $requiredValue = ConvertTo-TomlStringArrayFixture -Values $names
        $fixture = Set-RequiredArrayDefinition -Toml (Get-ValidToml) -RequiredValue $requiredValue
        Assert-ConfigTextRejected -Path $configPath -Content $fixture -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH"
    }
}
finally {
    if (Test-Path -LiteralPath $tempDirectory) {
        $resolved = [IO.Path]::GetFullPath($tempDirectory)
        if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
            throw "TEST_TEMP_CLEANUP_PATH_INVALID"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Write-Host ("Safe Worker deploy tests: passed={0} failed={1} total={2}" -f $script:PassedCount, $script:FailedCount, ($script:PassedCount + $script:FailedCount))
if ($script:FailedCount -gt 0) {
    exit 1
}
