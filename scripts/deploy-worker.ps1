[CmdletBinding()]
param(
    [switch]$Deploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ExpectedWorkerName = "bms-wip-charts-worker"
$script:ExpectedWorkerUrl = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev"
$script:ExpectedHealthUrl = "$script:ExpectedWorkerUrl/api/health"
$script:ExpectedDifficultyTableUrl = "$script:ExpectedWorkerUrl/difficulty-tables/rc-star"
$script:ExpectedMain = "src/index.ts"
$script:ExpectedDatabaseBinding = "DB"
$script:ExpectedDatabaseName = "wip-bms-charts-db"
$script:ExpectedBucketBinding = "FILES"
$script:ExpectedBucketName = "wip-bms-charts-files"
$script:ExpectedWithdrawalMode = "active"
$script:ExpectedCrons = @(
    "0 18 * * *",
    "0 * * * *"
)
$script:ExpectedRequiredSecrets = @(
    "ADMIN_TOKEN",
    "PASSWORD_HASH_SECRET",
    "ABUSE_HASH_SECRET",
    "WITHDRAWAL_IDEMPOTENCY_SECRET",
    "TURNSTILE_SECRET",
    "TURNSTILE_MODE"
)
$script:ExpectedConfirmation = "DEPLOY bms-wip-charts-worker"
$script:SafeDeployMainInvocationCount = 0
$script:ProductionDeployInvocationCount = 0

function New-DeploySafetyException {
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][string]$Guidance
    )

    $exception = New-Object System.InvalidOperationException($Message)
    $exception.Data["Code"] = $Code
    $exception.Data["Stage"] = $Stage
    $exception.Data["Guidance"] = $Guidance
    return $exception
}

function Throw-DeploySafetyError {
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][string]$Guidance
    )

    throw (New-DeploySafetyException -Code $Code -Stage $Stage -Message $Message -Guidance $Guidance)
}

function Protect-DeployLogText {
    param([AllowEmptyString()][string]$Text)

    if ($null -eq $Text) {
        return ""
    }

    $protected = [string]$Text
    $authorizationPattern = '(?i)(Authorization\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|''[^'']*''|[^\s,;]+)'
    $protected = [regex]::Replace($protected, $authorizationPattern, {
        param($match)
        return $match.Groups[1].Value + "[REDACTED]"
    })

    $secretPattern = '(?i)((?:env\.)?(?:HASH_SECRET|ADMIN_TOKEN|TURNSTILE_SECRET|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*)\s*(?:[:=]|\()\s*)(?:"[^"]*"|''[^'']*''|[^\s,;)]+)'
    $protected = [regex]::Replace($protected, $secretPattern, {
        param($match)
        return $match.Groups[1].Value + "[REDACTED]"
    })

    $r2KeyPattern = '(?i)((?:r2[_\s-]*key|object[_\s-]*key)\s*[:=]\s*)(?:"[^"]*"|''[^'']*''|[^\s,;]+)'
    $protected = [regex]::Replace($protected, $r2KeyPattern, {
        param($match)
        return $match.Groups[1].Value + "[REDACTED]"
    })

    return $protected
}

function Get-DeployPaths {
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    $workerDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "worker"))

    return [pscustomobject]@{
        RepositoryRoot = $repositoryRoot
        WorkerDirectory = $workerDirectory
        WorkerConfigPath = [IO.Path]::GetFullPath((Join-Path $workerDirectory "wrangler.toml"))
        WorkerPackagePath = [IO.Path]::GetFullPath((Join-Path $workerDirectory "package.json"))
        DeployLogDirectory = [IO.Path]::GetFullPath((Join-Path $workerDirectory ".deploy-logs"))
        RootConfigPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "wrangler.jsonc"))
    }
}

function New-DeployRunContext {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][bool]$DeployMode
    )

    if (-not (Test-Path -LiteralPath $Paths.DeployLogDirectory)) {
        New-Item -ItemType Directory -Path $Paths.DeployLogDirectory | Out-Null
    }

    $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
    $baseName = "deploy-worker-$stamp"
    $counter = 0
    do {
        $suffix = if ($counter -eq 0) { "" } else { "-{0:D2}" -f $counter }
        $logPath = Join-Path $Paths.DeployLogDirectory ($baseName + $suffix + ".log")
        $jsonPath = Join-Path $Paths.DeployLogDirectory ($baseName + $suffix + ".json")
        $counter++
    } while ((Test-Path -LiteralPath $logPath) -or (Test-Path -LiteralPath $jsonPath))

    $data = [ordered]@{
        startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        finishedAtUtc = $null
        mode = if ($DeployMode) { "deploy" } else { "check" }
        status = "running"
        branch = $null
        headSha = $null
        originMainSha = $null
        configPath = $Paths.WorkerConfigPath
        configSha256 = $null
        nodeVersion = $null
        wranglerVersion = $null
        expectedWorker = $script:ExpectedWorkerName
        expectedWorkerUrl = $script:ExpectedWorkerUrl
        redirects = @()
        typecheck = "not_run"
        dryRun = "not_run"
        deploy = "not_run"
        currentVersionId = $null
        health = "not_run"
        difficultyTable = "not_run"
        failureStage = $null
        errorCode = $null
    }

    return [pscustomobject]@{
        LogPath = [IO.Path]::GetFullPath($logPath)
        JsonPath = [IO.Path]::GetFullPath($jsonPath)
        Data = $data
    }
}

function Write-DeployLog {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)][ValidateSet("INFO", "OK", "WARN", "ERROR")][string]$Level,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Message,
        [switch]$NoConsole
    )

    $safeMessage = Protect-DeployLogText -Text $Message
    $line = "[{0}] [{1}] {2}" -f (Get-Date).ToUniversalTime().ToString("o"), $Level, $safeMessage
    [IO.File]::AppendAllText($Context.LogPath, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    if (-not $NoConsole) {
        Write-Host $safeMessage
    }
}

function Complete-DeployRunContext {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)][ValidateSet("passed", "failed")][string]$Status,
        [AllowEmptyString()][string]$FailureStage,
        [AllowEmptyString()][string]$ErrorCode
    )

    $Context.Data["finishedAtUtc"] = (Get-Date).ToUniversalTime().ToString("o")
    $Context.Data["status"] = $Status
    $Context.Data["failureStage"] = if ($FailureStage) { $FailureStage } else { $null }
    $Context.Data["errorCode"] = if ($ErrorCode) { $ErrorCode } else { $null }
    $json = $Context.Data | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Context.JsonPath, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
}

function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        $Context,
        [switch]$LogOutput
    )

    $previousErrorAction = $ErrorActionPreference
    $lines = New-Object System.Collections.Generic.List[string]
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $ErrorActionPreference = "Continue"
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            $line = [string]$_
            $lines.Add($line)
            if ($LogOutput -and $null -ne $Context) {
                Write-DeployLog -Context $Context -Level "INFO" -Message $line
            }
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
        Pop-Location
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Lines = $lines.ToArray()
        Output = ($lines.ToArray() -join [Environment]::NewLine)
    }
}

function Remove-TomlComment {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line)

    $builder = New-Object Text.StringBuilder
    $inSingle = $false
    $inDouble = $false
    $escaped = $false
    for ($index = 0; $index -lt $Line.Length; $index++) {
        $character = $Line[$index]
        if ($escaped) {
            [void]$builder.Append($character)
            $escaped = $false
            continue
        }
        if ($inDouble -and $character -eq '\') {
            [void]$builder.Append($character)
            $escaped = $true
            continue
        }
        if (-not $inDouble -and $character -eq "'") {
            $inSingle = -not $inSingle
            [void]$builder.Append($character)
            continue
        }
        if (-not $inSingle -and $character -eq '"') {
            $inDouble = -not $inDouble
            [void]$builder.Append($character)
            continue
        }
        if (-not $inSingle -and -not $inDouble -and $character -eq '#') {
            break
        }
        [void]$builder.Append($character)
    }
    return $builder.ToString()
}

function Throw-TomlArraySafetyError {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("DEPLOY_CONFIG_ARRAY_UNTERMINATED", "DEPLOY_CONFIG_ARRAY_INVALID")][string]$Code,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key
    )

    $sectionName = if ([string]::IsNullOrEmpty($Section)) { "<root>" } else { $Section }
    $message = if ($Code -ceq "DEPLOY_CONFIG_ARRAY_UNTERMINATED") {
        "TOML配列の閉じ括弧がありません。section=$sectionName key=$Key"
    }
    else {
        "TOML配列が不正です。section=$sectionName key=$Key"
    }
    Throw-DeploySafetyError -Code $Code -Stage "config" -Message $message -Guidance "worker/wrangler.tomlの文字列配列構文を確認してください。"
}

function Get-TomlSafetyArrayScan {
    param([Parameter(Mandatory = $true)][string]$Value)

    $trimmed = $Value.Trim()
    $depth = 0
    $nested = $false
    $invalid = -not $trimmed.StartsWith("[", [StringComparison]::Ordinal)
    $closed = $false
    $inSingle = $false
    $inDouble = $false
    $escaped = $false

    for ($index = 0; -not $invalid -and $index -lt $trimmed.Length; $index++) {
        $character = $trimmed[$index]
        if ($inDouble) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($character -eq '\') {
                $escaped = $true
                continue
            }
            if ($character -eq '"') {
                $inDouble = $false
            }
            continue
        }
        if ($inSingle) {
            if ($character -eq "'") {
                $inSingle = $false
            }
            continue
        }
        if ($character -eq '"') {
            $inDouble = $true
            continue
        }
        if ($character -eq "'") {
            $inSingle = $true
            continue
        }
        if ($character -eq '[') {
            $depth++
            if ($depth -gt 1) {
                $nested = $true
            }
            continue
        }
        if ($character -eq ']') {
            if ($depth -le 0) {
                $invalid = $true
                continue
            }
            $depth--
            if ($depth -eq 0) {
                $closed = $true
                if ($index + 1 -lt $trimmed.Length -and -not [string]::IsNullOrWhiteSpace($trimmed.Substring($index + 1))) {
                    $invalid = $true
                }
                break
            }
        }
    }

    if ($inSingle -or $inDouble -or $escaped) {
        $invalid = $true
    }
    return [pscustomobject]@{
        Closed = $closed
        Nested = $nested
        Invalid = $invalid
    }
}

function ConvertTo-TomlSafetyLogicalLines {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$RawLines)

    $logicalLines = New-Object System.Collections.Generic.List[string]
    $section = ""
    $pendingBuilder = $null
    $pendingKey = ""
    $pendingSection = ""

    foreach ($rawLine in $RawLines) {
        $line = (Remove-TomlComment -Line $rawLine).Trim()
        if ($null -ne $pendingBuilder) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }
            if ($line -match '^\[\[([^\]]+)\]\]$' -or $line -match '^\[([^\]]+)\]$') {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $pendingSection -Key $pendingKey
            }
            [void]$pendingBuilder.Append(" ")
            [void]$pendingBuilder.Append($line)
            $scan = Get-TomlSafetyArrayScan -Value $pendingBuilder.ToString().Substring($pendingBuilder.ToString().IndexOf("=") + 1)
            if ($scan.Invalid -or $scan.Nested) {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $pendingSection -Key $pendingKey
            }
            if ($scan.Closed) {
                [void]$logicalLines.Add($pendingBuilder.ToString())
                $pendingBuilder = $null
                $pendingKey = ""
                $pendingSection = ""
            }
            continue
        }

        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -match '^\[\[([^\]]+)\]\]$') {
            $section = $matches[1]
            [void]$logicalLines.Add($line)
            continue
        }
        if ($line -match '^\[([^\]]+)\]$') {
            $section = $matches[1]
            [void]$logicalLines.Add($line)
            continue
        }
        if ($line -match '^([A-Za-z0-9_.-]+)\s*=\s*(.+)$') {
            $key = $matches[1]
            $rawValue = $matches[2].Trim()
            if ($rawValue.StartsWith("[", [StringComparison]::Ordinal)) {
                $scan = Get-TomlSafetyArrayScan -Value $rawValue
                if ($scan.Invalid -or $scan.Nested) {
                    Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $section -Key $key
                }
                if (-not $scan.Closed) {
                    $pendingBuilder = New-Object Text.StringBuilder
                    [void]$pendingBuilder.Append($line)
                    $pendingKey = $key
                    $pendingSection = $section
                    continue
                }
            }
        }
        [void]$logicalLines.Add($line)
    }

    if ($null -ne $pendingBuilder) {
        Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Section $pendingSection -Key $pendingKey
    }
    return $logicalLines.ToArray()
}

function ConvertFrom-TomlSafetyValue {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Section
    )

    $trimmed = $Value.Trim()
    if ($trimmed -match '^"((?:\\.|[^"\\])*)"$') {
        return ($matches[1] -replace '\\"', '"' -replace '\\\\', '\')
    }
    if ($trimmed -match "^'([^']*)'$") {
        return $matches[1]
    }
    if ($trimmed -ceq "true") {
        return $true
    }
    if ($trimmed -ceq "false") {
        return $false
    }
    if ($trimmed.StartsWith("[", [StringComparison]::Ordinal)) {
        $scan = Get-TomlSafetyArrayScan -Value $trimmed
        if ($scan.Invalid -or $scan.Nested) {
            Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
        }
        if (-not $scan.Closed) {
            Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Section $Section -Key $Key
        }

        $values = New-Object System.Collections.Generic.List[string]
        $index = 1
        while ($index -lt $trimmed.Length) {
            while ($index -lt $trimmed.Length -and [char]::IsWhiteSpace($trimmed[$index])) {
                $index++
            }
            if ($index -ge $trimmed.Length) {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Section $Section -Key $Key
            }
            if ($trimmed[$index] -eq ']') {
                $index++
                while ($index -lt $trimmed.Length -and [char]::IsWhiteSpace($trimmed[$index])) {
                    $index++
                }
                if ($index -ne $trimmed.Length) {
                    Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
                }
                return ,($values.ToArray())
            }

            $quote = $trimmed[$index]
            if ($quote -ne '"' -and $quote -ne "'") {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
            }
            $index++
            $builder = New-Object Text.StringBuilder
            $stringClosed = $false
            while ($index -lt $trimmed.Length) {
                $character = $trimmed[$index]
                if ($quote -eq '"' -and $character -eq '\') {
                    [void]$builder.Append($character)
                    $index++
                    if ($index -ge $trimmed.Length) {
                        Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
                    }
                    [void]$builder.Append($trimmed[$index])
                    $index++
                    continue
                }
                if ($character -eq $quote) {
                    $stringClosed = $true
                    $index++
                    break
                }
                [void]$builder.Append($character)
                $index++
            }
            if (-not $stringClosed) {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
            }

            $parsedValue = $builder.ToString()
            if ($quote -eq '"') {
                $parsedValue = $parsedValue -replace '\\"', '"' -replace '\\\\', '\'
            }
            [void]$values.Add($parsedValue)

            while ($index -lt $trimmed.Length -and [char]::IsWhiteSpace($trimmed[$index])) {
                $index++
            }
            if ($index -ge $trimmed.Length) {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Section $Section -Key $Key
            }
            if ($trimmed[$index] -eq ',') {
                $index++
                continue
            }
            if ($trimmed[$index] -ne ']') {
                Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_INVALID" -Section $Section -Key $Key
            }
        }
        Throw-TomlArraySafetyError -Code "DEPLOY_CONFIG_ARRAY_UNTERMINATED" -Section $Section -Key $Key
    }
    return $trimmed
}

function Read-WranglerSafetyConfig {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        Throw-DeploySafetyError -Code "DEPLOY_CONFIG_MISSING" -Stage "config" -Message "Worker設定ファイルがありません。" -Guidance "worker/wrangler.tomlを復元してください。"
    }

    try {
        $rawLines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
        $logicalLines = @(ConvertTo-TomlSafetyLogicalLines -RawLines $rawLines)
        $top = @{}
        $triggers = @{}
        $variables = @{}
        $secrets = @{}
        $d1Entries = New-Object System.Collections.Generic.List[object]
        $r2Entries = New-Object System.Collections.Generic.List[object]
        $section = ""
        $currentTable = $null
        $cleanLines = New-Object System.Collections.Generic.List[string]
        $hasAssets = $false
        $hasSite = $false

        foreach ($logicalLine in $logicalLines) {
            $line = $logicalLine.Trim()
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                $cleanLines.Add($line)
            }
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }
            if ($line -match '^\[\[([^\]]+)\]\]$') {
                $section = $matches[1]
                $currentTable = @{}
                if ($section -ceq "d1_databases") {
                    $d1Entries.Add($currentTable)
                }
                elseif ($section -ceq "r2_buckets") {
                    $r2Entries.Add($currentTable)
                }
                continue
            }
            if ($line -match '^\[([^\]]+)\]$') {
                $section = $matches[1]
                $currentTable = $null
                if ($section -ieq "assets") { $hasAssets = $true }
                if ($section -ieq "site") { $hasSite = $true }
                continue
            }
            if ($line -notmatch '^([A-Za-z0-9_.-]+)\s*=\s*(.+)$') {
                Throw-DeploySafetyError -Code "DEPLOY_CONFIG_INVALID" -Stage "config" -Message "TOML設定行を安全に解析できません。" -Guidance "worker/wrangler.tomlの構文を確認してください。"
            }
            $key = $matches[1]
            $value = ConvertFrom-TomlSafetyValue -Value $matches[2] -Key $key -Section $section
            if ($key -ieq "assets" -or $key -imatch '^assets\.') { $hasAssets = $true }
            if ($key -ieq "site" -or $key -imatch '^site\.') { $hasSite = $true }

            if ($section -ceq "triggers") {
                $triggers[$key] = $value
            }
            elseif ($section -ceq "vars") {
                $variables[$key] = $value
            }
            elseif ($section -ceq "secrets") {
                $secrets[$key] = $value
            }
            elseif (($section -ceq "d1_databases" -or $section -ceq "r2_buckets") -and $null -ne $currentTable) {
                $currentTable[$key] = $value
            }
            elseif ([string]::IsNullOrEmpty($section)) {
                $top[$key] = $value
            }
        }

        $cleanText = $cleanLines.ToArray() -join [Environment]::NewLine
        $hasDocsReference = $cleanText -match '(?i)(?<![A-Za-z0-9_-])docs(?![A-Za-z0-9_-])'
        return [pscustomobject]@{
            Path = [IO.Path]::GetFullPath($Path)
            Name = $top["name"]
            Main = $top["main"]
            WorkersDev = $top["workers_dev"]
            Crons = if ($triggers.ContainsKey("crons")) { @($triggers["crons"]) } else { @() }
            WithdrawalMode = $variables["WITHDRAWAL_CRON_MODE"]
            RequiredSecrets = if ($secrets.ContainsKey("required")) { @($secrets["required"]) } else { @() }
            D1 = $d1Entries.ToArray()
            R2 = $r2Entries.ToArray()
            HasAssets = $hasAssets
            HasSite = $hasSite
            HasDocsReference = $hasDocsReference
        }
    }
    catch {
        if ($_.Exception.Data["Code"]) {
            throw
        }
        $parseReason = Protect-DeployLogText -Text $_.Exception.Message
        Throw-DeploySafetyError -Code "DEPLOY_CONFIG_INVALID" -Stage "config" -Message ("Worker設定を解析できません: " + $parseReason) -Guidance "worker/wrangler.tomlの構文と文字コードを確認してください。"
    }
}

function Assert-WranglerSafetyConfig {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.Name -cne $script:ExpectedWorkerName) {
        Throw-DeploySafetyError -Code "DEPLOY_WORKER_NAME_MISMATCH" -Stage "config" -Message "Worker名が固定期待値と一致しません。" -Guidance "nameをbms-wip-charts-workerへ戻してください。"
    }
    if ($Config.Main -cne $script:ExpectedMain) {
        Throw-DeploySafetyError -Code "DEPLOY_MAIN_MISMATCH" -Stage "config" -Message "Worker entrypointが固定期待値と一致しません。" -Guidance "mainをsrc/index.tsへ戻してください。"
    }
    if ($Config.WorkersDev -ne $true) {
        Throw-DeploySafetyError -Code "DEPLOY_CONFIG_INVALID" -Stage "config" -Message "workers_devがtrueではありません。" -Guidance "本番Worker設定を確認してください。"
    }

    $database = @($Config.D1 | Where-Object { $_["binding"] -ceq $script:ExpectedDatabaseBinding })
    if ($database.Count -ne 1 -or $database[0]["database_name"] -cne $script:ExpectedDatabaseName -or [string]::IsNullOrWhiteSpace([string]$database[0]["database_id"])) {
        Throw-DeploySafetyError -Code "DEPLOY_D1_MISMATCH" -Stage "config" -Message "D1 binding、database名、またはdatabase_idが固定期待値と一致しません。" -Guidance "DB -> wip-bms-charts-dbとdatabase_idを確認してください。"
    }

    $bucket = @($Config.R2 | Where-Object { $_["binding"] -ceq $script:ExpectedBucketBinding })
    if ($bucket.Count -ne 1 -or $bucket[0]["bucket_name"] -cne $script:ExpectedBucketName) {
        Throw-DeploySafetyError -Code "DEPLOY_R2_MISMATCH" -Stage "config" -Message "R2 bindingまたはbucket名が固定期待値と一致しません。" -Guidance "FILES -> wip-bms-charts-filesを確認してください。"
    }

    if ($Config.WithdrawalMode -cne $script:ExpectedWithdrawalMode) {
        Throw-DeploySafetyError -Code "DEPLOY_WITHDRAWAL_MODE_MISMATCH" -Stage "config" -Message "WITHDRAWAL_CRON_MODEがactiveではありません。" -Guidance "意図した緊急停止でないことを確認してactiveへ戻してください。"
    }

    $actualRequiredSecrets = @($Config.RequiredSecrets | ForEach-Object { [string]$_ })
    $expectedSecretSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($expectedSecret in $script:ExpectedRequiredSecrets) {
        [void]$expectedSecretSet.Add($expectedSecret)
    }
    $secretCounts = [System.Collections.Generic.Dictionary[string, int]]::new([StringComparer]::Ordinal)
    foreach ($actualSecret in $actualRequiredSecrets) {
        if ($secretCounts.ContainsKey($actualSecret)) {
            $secretCounts[$actualSecret]++
        }
        else {
            $secretCounts[$actualSecret] = 1
        }
    }
    $missingSecrets = @($script:ExpectedRequiredSecrets | Where-Object { -not $secretCounts.ContainsKey($_) })
    $extraSecrets = @($secretCounts.Keys | Where-Object { -not [string]::IsNullOrEmpty($_) -and -not $expectedSecretSet.Contains($_) } | Sort-Object -CaseSensitive)
    $duplicateSecrets = @($secretCounts.Keys | Where-Object { -not [string]::IsNullOrEmpty($_) -and $secretCounts[$_] -gt 1 } | Sort-Object -CaseSensitive)
    $hasEmptySecret = @($actualRequiredSecrets | Where-Object { [string]::IsNullOrEmpty($_) }).Count -gt 0
    if ($actualRequiredSecrets.Count -ne $script:ExpectedRequiredSecrets.Count -or $missingSecrets.Count -gt 0 -or $extraSecrets.Count -gt 0 -or $duplicateSecrets.Count -gt 0 -or $hasEmptySecret) {
        $missingText = if ($missingSecrets.Count -eq 0) { "none" } else { $missingSecrets -join "," }
        $extraText = if ($extraSecrets.Count -eq 0) { "none" } else { $extraSecrets -join "," }
        $duplicateText = if ($duplicateSecrets.Count -eq 0) { "none" } else { $duplicateSecrets -join "," }
        $message = "RequiredSecretsが固定期待値と一致しません。expectedCount={0} actualCount={1} missing={2} extra={3} duplicate={4}" -f $script:ExpectedRequiredSecrets.Count, $actualRequiredSecrets.Count, $missingText, $extraText, $duplicateText
        Throw-DeploySafetyError -Code "DEPLOY_REQUIRED_SECRETS_MISMATCH" -Stage "config" -Message $message -Guidance "[secrets] requiredのSecret名だけを確認してください。Secret値は取得・表示しないでください。"
    }

    $actualCrons = @($Config.Crons)
    if ($actualCrons.Count -ne $script:ExpectedCrons.Count) {
        Throw-DeploySafetyError -Code "DEPLOY_CRON_MISMATCH" -Stage "config" -Message "Cron本数が固定期待値と一致しません。" -Guidance "2本のCron式と余分なCronがないことを確認してください。"
    }
    for ($index = 0; $index -lt $script:ExpectedCrons.Count; $index++) {
        if ($actualCrons[$index] -cne $script:ExpectedCrons[$index]) {
            Throw-DeploySafetyError -Code "DEPLOY_CRON_MISMATCH" -Stage "config" -Message "Cron式が固定期待値と一致しません。" -Guidance "0 18 * * *と0 * * * *を順番も含めて確認してください。"
        }
    }

    if ($Config.HasAssets -or $Config.HasSite -or $Config.HasDocsReference) {
        Throw-DeploySafetyError -Code "DEPLOY_ASSETS_DETECTED" -Stage "config" -Message "API Worker設定に静的assets、site、またはdocs参照を検出しました。" -Guidance "静的Worker設定をAPI Worker設定から除去してください。"
    }

    return $true
}

function Get-RedirectConfigInfo {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$WorkerConfigPath
    )

    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        $parsed = $raw | ConvertFrom-Json
        $keys = @($parsed.PSObject.Properties.Name)
        $hasUnexpectedKeys = @($keys | Where-Object { $_ -cne "configPath" }).Count -gt 0
        $configPath = [string]$parsed.configPath
        if ([string]::IsNullOrWhiteSpace($configPath)) {
            throw "missing configPath"
        }
        $baseDirectory = Split-Path -Parent $Path
        $resolved = if ([IO.Path]::IsPathRooted($configPath)) {
            [IO.Path]::GetFullPath($configPath)
        }
        else {
            [IO.Path]::GetFullPath((Join-Path $baseDirectory $configPath))
        }
        return [pscustomobject]@{
            Path = [IO.Path]::GetFullPath($Path)
            ResolvedConfigPath = $resolved
            IsValid = -not $hasUnexpectedKeys
            TargetsApiWorker = $resolved.Equals([IO.Path]::GetFullPath($WorkerConfigPath), [StringComparison]::OrdinalIgnoreCase)
        }
    }
    catch {
        return [pscustomobject]@{
            Path = [IO.Path]::GetFullPath($Path)
            ResolvedConfigPath = $null
            IsValid = $false
            TargetsApiWorker = $false
        }
    }
}

function Get-DeploymentArtifactState {
    param([Parameter(Mandatory = $true)]$Paths)

    $redirectPaths = @(
        (Join-Path $Paths.RepositoryRoot ".wrangler\deploy\config.json"),
        (Join-Path $Paths.WorkerDirectory ".wrangler\deploy\config.json")
    )
    $redirects = New-Object System.Collections.Generic.List[object]
    foreach ($redirectPath in $redirectPaths) {
        if (Test-Path -LiteralPath $redirectPath) {
            $redirects.Add((Get-RedirectConfigInfo -Path $redirectPath -WorkerConfigPath $Paths.WorkerConfigPath))
        }
    }
    return [pscustomobject]@{
        RootConfigExists = Test-Path -LiteralPath $Paths.RootConfigPath
        Redirects = $redirects.ToArray()
    }
}

function Assert-DeploymentArtifactState {
    param([Parameter(Mandatory = $true)]$State)

    if ($State.RootConfigExists) {
        Throw-DeploySafetyError -Code "DEPLOY_ROOT_CONFIG_DETECTED" -Stage "artifacts" -Message "リポジトリ直下にwrangler.jsoncを検出しました。" -Guidance "誤生成物か確認し、安全な手順で除去してください。"
    }
    foreach ($redirect in @($State.Redirects)) {
        if (-not $redirect.IsValid -or -not $redirect.TargetsApiWorker) {
            Throw-DeploySafetyError -Code "DEPLOY_REDIRECT_CONFIG_DETECTED" -Stage "artifacts" -Message "API Worker以外を指す、または不正なWrangler redirect設定を検出しました。" -Guidance "redirect設定を手動確認してください。自動削除は行いません。"
        }
    }
    return $true
}

function Assert-GitSafetyState {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][bool]$DeployMode
    )

    if (-not $State.IsRepository) {
        Throw-DeploySafetyError -Code "DEPLOY_REPO_NOT_FOUND" -Stage "git" -Message "Git repositoryを確認できません。" -Guidance "正しいrepositoryで再実行してください。"
    }
    if ($State.HasConflicts) {
        Throw-DeploySafetyError -Code "DEPLOY_GIT_DIRTY" -Stage "git" -Message "未解決conflictがあります。" -Guidance "conflictを解消してから再実行してください。"
    }
    if ($State.Branch -cne "main") {
        Throw-DeploySafetyError -Code "DEPLOY_BRANCH_INVALID" -Stage "git" -Message "現在branchがmainではありません。" -Guidance "mainへ切り替え、同期状態を確認してください。"
    }

    $warnings = New-Object System.Collections.Generic.List[string]
    if ($State.IsDirty) {
        if ($DeployMode) {
            Throw-DeploySafetyError -Code "DEPLOY_GIT_DIRTY" -Stage "git" -Message "作業ツリーがcleanではありません。" -Guidance "変更を確認・commitしてから再実行してください。"
        }
        $warnings.Add("作業ツリーに未commit変更があります。検査のみ継続します。")
    }
    if ($State.AheadCount -gt 0 -and $State.BehindCount -gt 0) {
        if ($DeployMode) {
            Throw-DeploySafetyError -Code "DEPLOY_DIVERGED" -Stage "git" -Message "HEADとorigin/mainが分岐しています。" -Guidance "履歴を安全に統合してから再実行してください。"
        }
        $warnings.Add("HEADとorigin/mainが分岐しています。検査のみ継続します。")
    }
    elseif ($State.AheadCount -gt 0) {
        if ($DeployMode) {
            Throw-DeploySafetyError -Code "DEPLOY_NOT_PUSHED" -Stage "git" -Message "未push commitがあります。" -Guidance "mainをpushし、origin/mainと一致させてください。"
        }
        $warnings.Add("未push commitがあります。検査のみ継続します。")
    }
    elseif ($State.BehindCount -gt 0) {
        if ($DeployMode) {
            Throw-DeploySafetyError -Code "DEPLOY_BEHIND_ORIGIN" -Stage "git" -Message "HEADがorigin/mainより遅れています。" -Guidance "mainを更新し、origin/mainと一致させてください。"
        }
        $warnings.Add("HEADがorigin/mainより遅れています。検査のみ継続します。")
    }
    return $warnings.ToArray()
}

function Get-GitSafetyState {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)]$Context
    )

    $rootResult = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("rev-parse", "--show-toplevel") -WorkingDirectory $Paths.RepositoryRoot
    if ($rootResult.ExitCode -ne 0 -or $rootResult.Lines.Count -ne 1) {
        return [pscustomobject]@{ IsRepository = $false; HasConflicts = $false; IsDirty = $false; Branch = $null; HeadSha = $null; OriginMainSha = $null; AheadCount = 0; BehindCount = 0 }
    }
    $reportedRoot = [IO.Path]::GetFullPath($rootResult.Lines[0].Trim())
    if (-not $reportedRoot.Equals($Paths.RepositoryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject]@{ IsRepository = $false; HasConflicts = $false; IsDirty = $false; Branch = $null; HeadSha = $null; OriginMainSha = $null; AheadCount = 0; BehindCount = 0 }
    }

    $status = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("status", "--porcelain") -WorkingDirectory $Paths.RepositoryRoot
    $branch = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("branch", "--show-current") -WorkingDirectory $Paths.RepositoryRoot
    $head = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("rev-parse", "HEAD") -WorkingDirectory $Paths.RepositoryRoot
    if ($status.ExitCode -ne 0 -or $branch.ExitCode -ne 0 -or $head.ExitCode -ne 0) {
        Throw-DeploySafetyError -Code "DEPLOY_REPO_NOT_FOUND" -Stage "git" -Message "Git状態を取得できません。" -Guidance "Git repositoryとgit.exeを確認してください。"
    }

    $fetch = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("fetch", "origin") -WorkingDirectory $Paths.RepositoryRoot
    if ($fetch.ExitCode -ne 0) {
        Throw-DeploySafetyError -Code "DEPLOY_GIT_FETCH_FAILED" -Stage "git" -Message "git fetch originに失敗しました。" -Guidance "ネットワークとorigin設定を確認してください。"
    }
    $origin = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("rev-parse", "refs/remotes/origin/main") -WorkingDirectory $Paths.RepositoryRoot
    $counts = Invoke-NativeCapture -FilePath "git.exe" -Arguments @("rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main") -WorkingDirectory $Paths.RepositoryRoot
    if ($origin.ExitCode -ne 0 -or $counts.ExitCode -ne 0 -or $counts.Lines.Count -ne 1) {
        Throw-DeploySafetyError -Code "DEPLOY_GIT_FETCH_FAILED" -Stage "git" -Message "origin/mainとの関係を取得できません。" -Guidance "origin/mainが存在することを確認してください。"
    }
    $parts = @($counts.Lines[0].Trim() -split '\s+')
    if ($parts.Count -ne 2) {
        Throw-DeploySafetyError -Code "DEPLOY_GIT_FETCH_FAILED" -Stage "git" -Message "Git同期件数を解析できません。" -Guidance "git rev-listの出力を確認してください。"
    }

    return [pscustomobject]@{
        IsRepository = $true
        HasConflicts = @($status.Lines | Where-Object { $_ -match '^(DD|AU|UD|UA|DU|AA|UU)\s' }).Count -gt 0
        IsDirty = $status.Lines.Count -gt 0
        Branch = $branch.Lines[0].Trim()
        HeadSha = $head.Lines[0].Trim()
        OriginMainSha = $origin.Lines[0].Trim()
        AheadCount = [int]$parts[0]
        BehindCount = [int]$parts[1]
    }
}

function Test-DeployConfirmation {
    param([AllowEmptyString()][string]$InputText)
    return $InputText -ceq $script:ExpectedConfirmation
}

function Test-ProductionDeployRequested {
    param(
        [Parameter(Mandatory = $true)][bool]$DeployMode,
        [AllowEmptyString()][string]$Confirmation
    )
    return $DeployMode -and (Test-DeployConfirmation -InputText $Confirmation)
}

function Test-StaticWorkerTargetInOutput {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Output)

    $staticName = '(?<![A-Za-z0-9-])bms-wip-charts(?![A-Za-z0-9-])'
    $staticUrl = [regex]::Escape("https://bms-wip-charts.monsta3228gsl.workers.dev") + '(?![A-Za-z0-9.-])'
    return ($Output -match $staticName) -or ($Output -match $staticUrl)
}

function Test-AssetsInOutput {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Output)

    return $Output -match '(?im)\bBuilding list of assets\b|\bassets directory\b|\bstatic assets\b|(?<![A-Za-z0-9_-])docs(?![A-Za-z0-9_-])'
}

function Assert-WranglerDryRunOutput {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Output)

    if ((Test-AssetsInOutput -Output $Output) -or (Test-StaticWorkerTargetInOutput -Output $Output)) {
        Throw-DeploySafetyError -Code "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Stage "dry_run_output" -Message "dry-run出力に静的Workerまたはassetsを検出しました。" -Guidance "configパスとWrangler redirect設定を確認してください。"
    }
    $checks = @(
        '(?im)env\.DB\b.*wip-bms-charts-db',
        '(?im)env\.FILES\b.*wip-bms-charts-files',
        '(?im)(?:env\.)?WITHDRAWAL_CRON_MODE\b.*[\("'']active[\)"'']'
    )
    foreach ($check in $checks) {
        if ($Output -notmatch $check) {
            Throw-DeploySafetyError -Code "DEPLOY_DRY_RUN_TARGET_MISMATCH" -Stage "dry_run_output" -Message "dry-run出力に固定bindingまたはactive modeがありません。" -Guidance "worker/wrangler.tomlとdry-run出力を確認してください。"
        }
    }
    return $true
}

function Assert-WranglerDeployOutput {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Output)

    if ((Test-AssetsInOutput -Output $Output) -or (Test-StaticWorkerTargetInOutput -Output $Output)) {
        Throw-DeploySafetyError -Code "DEPLOY_TARGET_MISMATCH" -Stage "deploy_output" -Message "deploy出力に静的Workerまたはassetsを検出しました。" -Guidance "Cloudflare dashboardを確認し、追加操作前にログを保全してください。"
    }
    $worker = [regex]::Escape($script:ExpectedWorkerName)
    if ($Output -notmatch "(?im)Uploaded\s+$worker(?![A-Za-z0-9-])" -or
        $Output -notmatch "(?im)Deployed\s+$worker(?![A-Za-z0-9-]).*triggers" -or
        $Output -notmatch [regex]::Escape($script:ExpectedWorkerUrl)) {
        Throw-DeploySafetyError -Code "DEPLOY_TARGET_MISMATCH" -Stage "deploy_output" -Message "deploy出力のWorker名またはURLが固定期待値と一致しません。" -Guidance "Cloudflare dashboardと安全ログを確認してください。"
    }
    foreach ($cron in $script:ExpectedCrons) {
        if ($Output -notmatch ("(?im)schedule\s*:\s*" + [regex]::Escape($cron))) {
            Throw-DeploySafetyError -Code "DEPLOY_TARGET_MISMATCH" -Stage "deploy_output" -Message "deploy出力に期待するCronがありません。" -Guidance "Cron反映状態をCloudflare dashboardで確認してください。"
        }
    }
    $versionId = $null
    if ($Output -match '(?im)Current Version ID\s*:\s*([A-Za-z0-9-]+)') {
        $versionId = $matches[1]
    }
    if ([string]::IsNullOrWhiteSpace($versionId)) {
        Throw-DeploySafetyError -Code "DEPLOY_TARGET_MISMATCH" -Stage "deploy_output" -Message "deploy出力からCurrent Version IDを確認できません。" -Guidance "Cloudflare dashboardと安全ログを確認してください。"
    }
    return [pscustomobject]@{ VersionId = $versionId }
}

function Assert-HealthResponse {
    param(
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ContentType,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Body
    )

    if ($StatusCode -ne 200 -or $ContentType -notmatch '(?i)application/json') {
        Throw-DeploySafetyError -Code "DEPLOY_HEALTH_FAILED" -Stage "health" -Message "health応答のstatusまたはContent-Typeが不正です。" -Guidance "固定health URLを手動確認してください。"
    }
    try {
        $json = $Body | ConvertFrom-Json
    }
    catch {
        Throw-DeploySafetyError -Code "DEPLOY_HEALTH_FAILED" -Stage "health" -Message "health応答をJSONとして解析できません。" -Guidance "固定health URLを手動確認してください。"
    }
    if ($json.status -cne "ok" -or $json.service -cne $script:ExpectedWorkerName) {
        Throw-DeploySafetyError -Code "DEPLOY_HEALTH_FAILED" -Stage "health" -Message "health応答のstatusまたはserviceが固定期待値と一致しません。" -Guidance "誤Workerへ反映されていないか確認してください。"
    }
    return $true
}

function Assert-DifficultyTableResponse {
    param(
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ContentType,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Body
    )

    if ($StatusCode -ne 200 -or $ContentType -notmatch '(?i)text/html') {
        Throw-DeploySafetyError -Code "DEPLOY_DIFFICULTY_TABLE_CHECK_FAILED" -Stage "difficulty_table" -Message "難易度表応答のstatusまたはContent-Typeが不正です。" -Guidance "固定難易度表URLを手動確認してください。"
    }
    foreach ($marker in @("リサイクルセンター RC★", '<meta name="bmstable"', "header.json", "data.json")) {
        if (-not $Body.Contains($marker)) {
            Throw-DeploySafetyError -Code "DEPLOY_DIFFICULTY_TABLE_CHECK_FAILED" -Stage "difficulty_table" -Message "難易度表HTMLに必須要素がありません。" -Guidance "固定難易度表URLとWorkerログを確認してください。"
        }
    }
    return $true
}

function Invoke-WranglerDryRun {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)]$Context
    )

    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $outDirectory = [IO.Path]::GetFullPath((Join-Path $tempBase ("bms-wip-worker-dry-run-" + [Guid]::NewGuid().ToString("N"))))
    if (-not $outDirectory.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-DeploySafetyError -Code "DEPLOY_DRY_RUN_FAILED" -Stage "dry_run" -Message "dry-run一時パスが安全範囲外です。" -Guidance "TEMP環境を確認してください。"
    }
    New-Item -ItemType Directory -Path $outDirectory | Out-Null
    try {
        $result = Invoke-NativeCapture -FilePath "npx.cmd" -Arguments @("wrangler", "deploy", "--config", $Paths.WorkerConfigPath, "--dry-run", "--outdir", $outDirectory) -WorkingDirectory $Paths.WorkerDirectory -Context $Context -LogOutput
        if ($result.ExitCode -ne 0) {
            Throw-DeploySafetyError -Code "DEPLOY_DRY_RUN_FAILED" -Stage "dry_run" -Message "Wrangler dry-runに失敗しました。" -Guidance "画面と安全ログのdry-run出力を確認してください。"
        }
        Assert-WranglerDryRunOutput -Output $result.Output | Out-Null
        return $result
    }
    finally {
        if (Test-Path -LiteralPath $outDirectory) {
            $resolved = [IO.Path]::GetFullPath($outDirectory)
            if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
                throw "DRY_RUN_TEMP_CLEANUP_PATH_INVALID"
            }
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

function Invoke-ProductionDeployment {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)]$Context
    )

    $script:ProductionDeployInvocationCount++
    $result = Invoke-NativeCapture -FilePath "npx.cmd" -Arguments @("wrangler", "deploy", "--config", $Paths.WorkerConfigPath) -WorkingDirectory $Paths.WorkerDirectory -Context $Context -LogOutput
    if ($result.ExitCode -ne 0) {
        Throw-DeploySafetyError -Code "DEPLOY_COMMAND_FAILED" -Stage "deploy" -Message "Wrangler deploy commandに失敗しました。" -Guidance "安全ログを確認し、再実行前にCloudflareの反映状態を確認してください。"
    }
    $validation = Assert-WranglerDeployOutput -Output $result.Output
    return [pscustomobject]@{ Command = $result; Validation = $validation }
}

function Invoke-HealthCheck {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $script:ExpectedHealthUrl -TimeoutSec 30
        $contentType = [string]$response.Headers["Content-Type"]
        Assert-HealthResponse -StatusCode ([int]$response.StatusCode) -ContentType $contentType -Body ([string]$response.Content) | Out-Null
    }
    catch {
        if ($_.Exception.Data["Code"]) { throw }
        Throw-DeploySafetyError -Code "DEPLOY_HEALTH_FAILED" -Stage "health" -Message "固定health URLへのGETに失敗しました。" -Guidance "ネットワークと本番Workerの状態を手動確認してください。自動rollbackは行いません。"
    }
}

function Invoke-DifficultyTableCheck {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $script:ExpectedDifficultyTableUrl -TimeoutSec 30
        $contentType = [string]$response.Headers["Content-Type"]
        Assert-DifficultyTableResponse -StatusCode ([int]$response.StatusCode) -ContentType $contentType -Body ([string]$response.Content) | Out-Null
    }
    catch {
        if ($_.Exception.Data["Code"]) { throw }
        Throw-DeploySafetyError -Code "DEPLOY_DIFFICULTY_TABLE_CHECK_FAILED" -Stage "difficulty_table" -Message "固定難易度表URLへのGETに失敗しました。" -Guidance "ネットワークと難易度表routeを手動確認してください。自動rollbackは行いません。"
    }
}

function Invoke-SafeWorkerDeploy {
    param([Parameter(Mandatory = $true)][bool]$DeployMode)

    $script:SafeDeployMainInvocationCount++
    $paths = Get-DeployPaths
    $context = $null
    try {
        $context = New-DeployRunContext -Paths $paths -DeployMode $DeployMode
        Write-DeployLog -Context $context -Level "INFO" -Message ("Safe Worker deployを開始します。mode=" + $context.Data["mode"])

        if (-not (Test-Path -LiteralPath (Join-Path $paths.RepositoryRoot ".git"))) {
            Throw-DeploySafetyError -Code "DEPLOY_REPO_NOT_FOUND" -Stage "paths" -Message "Repository rootを確認できません。" -Guidance "scripts/deploy-worker.ps1の配置を確認してください。"
        }
        if (-not (Test-Path -LiteralPath $paths.WorkerPackagePath)) {
            Throw-DeploySafetyError -Code "DEPLOY_CONFIG_MISSING" -Stage "paths" -Message "worker/package.jsonがありません。" -Guidance "repositoryのworkerディレクトリを確認してください。"
        }
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Repository: " + $paths.RepositoryRoot)

        $artifactState = Get-DeploymentArtifactState -Paths $paths
        Assert-DeploymentArtifactState -State $artifactState | Out-Null
        $context.Data["redirects"] = @($artifactState.Redirects | ForEach-Object {
            [ordered]@{ path = $_.Path; target = $_.ResolvedConfigPath; valid = $_.IsValid; targetsApiWorker = $_.TargetsApiWorker }
        })
        foreach ($redirect in @($artifactState.Redirects)) {
            Write-DeployLog -Context $context -Level "WARN" -Message ("Wrangler redirect設定を検出しました。path=" + $redirect.Path + " target=" + $redirect.ResolvedConfigPath)
        }

        $config = Read-WranglerSafetyConfig -Path $paths.WorkerConfigPath
        Assert-WranglerSafetyConfig -Config $config | Out-Null
        $context.Data["configSha256"] = (Get-FileHash -LiteralPath $paths.WorkerConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Worker: " + $script:ExpectedWorkerName)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Config: " + $paths.WorkerConfigPath)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Main: " + $script:ExpectedMain)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] D1: " + $script:ExpectedDatabaseBinding + " -> " + $script:ExpectedDatabaseName)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] R2: " + $script:ExpectedBucketBinding + " -> " + $script:ExpectedBucketName)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Withdrawal mode: " + $script:ExpectedWithdrawalMode)
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Required secret name count: " + $config.RequiredSecrets.Count)
        foreach ($cron in $script:ExpectedCrons) {
            Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Cron: " + $cron)
        }
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Static assets: none"

        $gitState = Get-GitSafetyState -Paths $paths -Context $context
        $warnings = @(Assert-GitSafetyState -State $gitState -DeployMode $DeployMode)
        $context.Data["branch"] = $gitState.Branch
        $context.Data["headSha"] = $gitState.HeadSha
        $context.Data["originMainSha"] = $gitState.OriginMainSha
        Write-DeployLog -Context $context -Level "OK" -Message ("[OK] Branch: " + $gitState.Branch)
        foreach ($warning in $warnings) {
            Write-DeployLog -Context $context -Level "WARN" -Message ("[WARN] " + $warning)
        }

        $nodeVersion = Invoke-NativeCapture -FilePath "node.exe" -Arguments @("--version") -WorkingDirectory $paths.WorkerDirectory
        if ($nodeVersion.ExitCode -ne 0 -or $nodeVersion.Lines.Count -ne 1) {
            Throw-DeploySafetyError -Code "DEPLOY_TYPECHECK_FAILED" -Stage "versions" -Message "Node.js versionを取得できません。" -Guidance "Node.jsを確認してください。"
        }
        $context.Data["nodeVersion"] = $nodeVersion.Lines[0].Trim()
        $wranglerPackagePath = Join-Path $paths.WorkerDirectory "node_modules\wrangler\package.json"
        if (-not (Test-Path -LiteralPath $wranglerPackagePath)) {
            Throw-DeploySafetyError -Code "DEPLOY_TYPECHECK_FAILED" -Stage "versions" -Message "ローカルWranglerがありません。" -Guidance "workerでnpm installを実行してから再実行してください。"
        }
        $wranglerPackage = Get-Content -LiteralPath $wranglerPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $context.Data["wranglerVersion"] = [string]$wranglerPackage.version

        $typecheck = Invoke-NativeCapture -FilePath "npx.cmd" -Arguments @("tsc", "--noEmit") -WorkingDirectory $paths.WorkerDirectory -Context $context -LogOutput
        if ($typecheck.ExitCode -ne 0) {
            $context.Data["typecheck"] = "failed"
            Throw-DeploySafetyError -Code "DEPLOY_TYPECHECK_FAILED" -Stage "typecheck" -Message "TypeScript検査に失敗しました。" -Guidance "画面と安全ログのtypecheck出力を確認してください。"
        }
        $context.Data["typecheck"] = "passed"
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] TypeScript: passed"

        Invoke-WranglerDryRun -Paths $paths -Context $context | Out-Null
        $context.Data["dryRun"] = "passed"
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Wrangler dry-run: passed"

        if (-not $DeployMode) {
            Write-DeployLog -Context $context -Level "OK" -Message "検査のみ完了。本番デプロイは実行していません。"
            Complete-DeployRunContext -Context $context -Status "passed" -FailureStage "" -ErrorCode ""
            return 0
        }

        $confirmation = Read-Host ("本番デプロイする場合は『" + $script:ExpectedConfirmation + "』と完全一致で入力")
        if (-not (Test-ProductionDeployRequested -DeployMode $true -Confirmation $confirmation)) {
            Throw-DeploySafetyError -Code "DEPLOY_CONFIRMATION_CANCELED" -Stage "confirmation" -Message "確認文字列が完全一致しないため中止しました。" -Guidance "対象とGit同期状態を再確認してください。"
        }

        $finalArtifactState = Get-DeploymentArtifactState -Paths $paths
        Assert-DeploymentArtifactState -State $finalArtifactState | Out-Null
        $finalConfig = Read-WranglerSafetyConfig -Path $paths.WorkerConfigPath
        Assert-WranglerSafetyConfig -Config $finalConfig | Out-Null
        $finalConfigHash = (Get-FileHash -LiteralPath $paths.WorkerConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($finalConfigHash -cne $context.Data["configSha256"]) {
            Throw-DeploySafetyError -Code "DEPLOY_CONFIG_INVALID" -Stage "pre_deploy" -Message "確認待ちの間にWorker設定が変更されました。" -Guidance "変更内容を確認し、最初から再実行してください。"
        }
        $finalGitState = Get-GitSafetyState -Paths $paths -Context $context
        Assert-GitSafetyState -State $finalGitState -DeployMode $true | Out-Null
        $context.Data["headSha"] = $finalGitState.HeadSha
        $context.Data["originMainSha"] = $finalGitState.OriginMainSha
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Final config and Git sync: verified"

        $deployment = Invoke-ProductionDeployment -Paths $paths -Context $context
        $context.Data["deploy"] = "passed"
        $context.Data["currentVersionId"] = $deployment.Validation.VersionId
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Wrangler deploy output: verified"

        Invoke-HealthCheck
        $context.Data["health"] = "passed"
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Health: passed"

        Invoke-DifficultyTableCheck
        $context.Data["difficultyTable"] = "passed"
        Write-DeployLog -Context $context -Level "OK" -Message "[OK] Difficulty table: passed"

        Complete-DeployRunContext -Context $context -Status "passed" -FailureStage "" -ErrorCode ""
        Write-Host "正しいAPI Workerへのデプロイと固定URL確認が完了しました。"
        return 0
    }
    catch {
        $exception = $_.Exception
        $code = if ($exception.Data["Code"]) { [string]$exception.Data["Code"] } else { "DEPLOY_UNKNOWN_ERROR" }
        $stage = if ($exception.Data["Stage"]) { [string]$exception.Data["Stage"] } else { "unknown" }
        $guidance = if ($exception.Data["Guidance"]) { [string]$exception.Data["Guidance"] } else { "安全ログと現在の設定を確認してから再実行してください。" }
        $message = Protect-DeployLogText -Text $exception.Message
        if ($null -ne $context) {
            if ($context.Data["typecheck"] -eq "not_run" -and $stage -eq "typecheck") { $context.Data["typecheck"] = "failed" }
            if ($context.Data["dryRun"] -eq "not_run" -and $stage -like "dry_run*") { $context.Data["dryRun"] = "failed" }
            if ($context.Data["deploy"] -eq "not_run" -and $stage -like "deploy*") { $context.Data["deploy"] = "failed" }
            if ($context.Data["health"] -eq "not_run" -and $stage -eq "health") { $context.Data["health"] = "failed" }
            if ($context.Data["difficultyTable"] -eq "not_run" -and $stage -eq "difficulty_table") { $context.Data["difficultyTable"] = "failed" }
            Write-DeployLog -Context $context -Level "ERROR" -Message ("[ERROR] code=" + $code + " stage=" + $stage + " cause=" + $message)
            Complete-DeployRunContext -Context $context -Status "failed" -FailureStage $stage -ErrorCode $code
        }
        Write-Host ("エラーコード: " + $code)
        Write-Host ("失敗段階: " + $stage)
        Write-Host ("原因: " + $message)
        if ($null -ne $context) {
            Write-Host ("ログ: " + $context.LogPath)
        }
        Write-Host ("再実行前の確認事項: " + $guidance)
        return 1
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    exit (Invoke-SafeWorkerDeploy -DeployMode ([bool]$Deploy))
}
