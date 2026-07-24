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

[[d1_databases]]
binding = "DB"
database_name = "wip-bms-charts-db"
database_id = "fixture-database-id"

[[r2_buckets]]
binding = "FILES"
bucket_name = "wip-bms-charts-files"
'@
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

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDirectory = [IO.Path]::GetFullPath((Join-Path $tempBase ("deploy-worker-safety-tests-" + [Guid]::NewGuid().ToString("N"))))
if (-not $tempDirectory.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "TEST_TEMP_PATH_INVALID"
}
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
$configPath = Join-Path $tempDirectory "wrangler.toml"

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
