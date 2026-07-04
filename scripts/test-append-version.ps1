<#
.SYNOPSIS
  Manual test script for POST /api/charts/:chartId/versions.

.DESCRIPTION
  This script reads the parent version progressMap from GET /api/charts,
  paints one additional unpainted block, and submits a multipart follow-up post.
  The API is expected to replace the last layer versionId with the created versionId.

.EXAMPLE
  .\scripts\test-append-version.ps1 `
    -ChartId "chart_xxx" `
    -ParentVersionId "version_xxx" `
    -FilePath ".\branch-append.bms"

.EXAMPLE
  .\scripts\test-append-version.ps1 `
    -ApiBaseUrl "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
    -ChartId "chart_xxx" `
    -ParentVersionId "version_xxx" `
    -FilePath ".\branch-append.bms" `
    -Password "your-password"
#>

[CmdletBinding()]
param(
  [string]$ApiBaseUrl = "http://localhost:8787",

  [Parameter(Mandatory = $true)]
  [string]$ChartId,

  [Parameter(Mandatory = $true)]
  [string]$ParentVersionId,

  [Parameter(Mandatory = $true)]
  [string]$FilePath,

  [string]$Author = "append-check",
  [string]$Comment = "BRANCH-01A-CHECK append test",
  [string]$Password = "test-password"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-ApiBaseUrl([string]$value) {
  $trimmed = $value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw "ApiBaseUrl is empty. Example: http://localhost:8787"
  }

  return $trimmed.TrimEnd("/")
}

function Invoke-JsonGet([string]$uri) {
  try {
    return Invoke-RestMethod -Method Get -Uri $uri
  } catch {
    throw "GET failed: $uri`n$($_.Exception.Message)"
  }
}

function Find-ParentVersion([string]$apiBaseUrl, [string]$targetChartId, [string]$targetParentVersionId) {
  $page = 1
  $pageSize = 200

  while ($true) {
    $uri = "$apiBaseUrl/api/charts?page=$page&pageSize=$pageSize"
    $body = Invoke-JsonGet $uri

    foreach ($entry in @($body.charts)) {
      if ($null -eq $entry.chart -or $entry.chart.id -ne $targetChartId) {
        continue
      }

      foreach ($version in @($entry.versions)) {
        if ($version.id -eq $targetParentVersionId) {
          return [pscustomobject]@{
            Chart = $entry.chart
            Song = $entry.song
            Version = $version
          }
        }
      }
    }

    if ($null -eq $body.pagination -or -not $body.pagination.hasNext) {
      break
    }

    $page += 1
  }

  throw "Parent version not found in GET /api/charts. chartId='$targetChartId', parentVersionId='$targetParentVersionId'. Check chartId, parentVersionId, pagination, and hidden state."
}

function Copy-JsonObject($value) {
  if ($null -eq $value) {
    return $null
  }

  if ($value -is [string]) {
    return $value | ConvertFrom-Json
  }

  return ($value | ConvertTo-Json -Depth 100) | ConvertFrom-Json
}

function Get-PropertyValue($object, [string]$name) {
  if ($null -eq $object) {
    return $null
  }

  $property = $object.PSObject.Properties[$name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Get-NestedPropertyValue($object, [string]$path) {
  if ($null -eq $object -or [string]::IsNullOrWhiteSpace($path)) {
    return $null
  }

  $current = $object
  foreach ($part in $path.Split(".")) {
    $current = Get-PropertyValue $current $part
    if ($null -eq $current) {
      return $null
    }
  }

  return $current
}

function Get-FirstPropertyValue($object, [string[]]$paths) {
  foreach ($path in $paths) {
    $value = Get-NestedPropertyValue $object $path
    if ($null -ne $value) {
      return $value
    }
  }

  return $null
}

function Format-OptionalValue($value) {
  if ($null -eq $value) {
    return "<not returned>"
  }

  $text = [string]$value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return "<not returned>"
  }

  return $text
}

function Format-JsonBody($body, [string]$bodyText) {
  if ($null -ne $body) {
    return ($body | ConvertTo-Json -Depth 100)
  }

  if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
    return $bodyText
  }

  return "<empty response body>"
}

function Test-StubResponse($body) {
  $mode = Get-PropertyValue $body "mode"
  return $null -ne $mode -and ([string]$mode).Trim().ToLowerInvariant() -eq "stub"
}

function Set-JsonProperty($object, [string]$name, $value) {
  Add-Member -InputObject $object -MemberType NoteProperty -Name $name -Value $value -Force
}

function New-RangeArray([int]$startIndex, [int]$endIndex) {
  $range = New-Object 'object[]' 2
  $range[0] = $startIndex
  $range[1] = $endIndex
  Write-Output -NoEnumerate $range
}

function New-SingleRangeArray($range) {
  $ranges = New-Object 'object[]' 1
  $ranges[0] = $range
  Write-Output -NoEnumerate $ranges
}

function Append-ArrayItem($items, $newItem) {
  $existingItems = @($items)
  $updatedItems = New-Object 'object[]' ($existingItems.Count + 1)

  for ($index = 0; $index -lt $existingItems.Count; $index += 1) {
    $updatedItems[$index] = $existingItems[$index]
  }

  $updatedItems[$existingItems.Count] = $newItem
  Write-Output -NoEnumerate $updatedItems
}

function Get-PaintedIndexes($progressMap) {
  $painted = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($layer in @($progressMap.layers)) {
    foreach ($range in @($layer.ranges)) {
      if ($null -eq $range -or $range.Count -lt 2) {
        continue
      }

      $startIndex = [int]$range[0]
      $endIndex = [int]$range[1]
      if ($startIndex -gt $endIndex) {
        continue
      }

      for ($index = $startIndex; $index -le $endIndex; $index += 1) {
        [void]$painted.Add([int]$index)
      }
    }
  }

  Write-Output -NoEnumerate $painted
}

function Add-OnePaintedBlock($progressMap) {
  if ($null -eq $progressMap) {
    throw "Parent version has no progressMap. Use a parent version created after PROG-04A with progressMap data."
  }

  if ($progressMap.schemaVersion -ne 2 -or $progressMap.blockMode -ne "standardized_measure") {
    throw "Parent progressMap must use schemaVersion=2 and blockMode=standardized_measure."
  }

  $targetBlockCount = [int](Get-PropertyValue $progressMap "targetBlockCount")
  if ($targetBlockCount -le 0) {
    throw "Parent progressMap.targetBlockCount is zero or negative. Cannot add an unpainted block."
  }

  $blocks = @($progressMap.blocks)
  if ($blocks.Count -ne $targetBlockCount) {
    throw "Parent progressMap block count mismatch. blocks=$($blocks.Count), targetBlockCount=$targetBlockCount"
  }

  $painted = Get-PaintedIndexes $progressMap
  $nextIndex = $null
  for ($index = 0; $index -lt $targetBlockCount; $index += 1) {
    if (-not $painted.Contains([int]$index)) {
      $nextIndex = $index
      break
    }
  }

  if ($null -eq $nextIndex) {
    throw "No unpainted block is available. The parent progressMap is already fully painted. To check PROGRESS_MAP_UNCHANGED, send the parent progressMap without changes."
  }

  if (-not $painted.Contains([int]$nextIndex)) {
    [void]$painted.Add([int]$nextIndex)
  }

  $newRange = New-RangeArray -startIndex ([int]$nextIndex) -endIndex ([int]$nextIndex)
  $newLayer = [pscustomobject]@{
    versionId = "pending"
    color = "#2563eb"
    kind = "followup"
    ranges = New-SingleRangeArray $newRange
  }

  $layers = Append-ArrayItem $progressMap.layers $newLayer

  Set-JsonProperty $progressMap "layers" $layers
  Set-JsonProperty $progressMap "progress" ([int][Math]::Round(($painted.Count / $targetBlockCount) * 100))

  return [pscustomobject]@{
    ProgressMap = $progressMap
    AddedBlockIndex = [int]$nextIndex
    Progress = [int]$progressMap.progress
  }
}

function Invoke-CurlMultipartPost(
  [string]$uri,
  [string]$resolvedFilePath,
  [string]$targetParentVersionId,
  [string]$targetAuthor,
  [string]$progressMapJson,
  [string]$targetComment,
  [string]$targetPassword
) {
  $curlCommand = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($null -eq $curlCommand) {
    throw "curl.exe was not found. Install curl or use Windows built-in curl.exe."
  }

  $curlArgs = @(
    "-sS",
    "-w", "`nHTTP_STATUS:%{http_code}",
    "-X", "POST",
    $uri,
    "-F", "file=@$resolvedFilePath;type=application/octet-stream",
    "-F", "parentVersionId=$targetParentVersionId",
    "-F", "author=$targetAuthor",
    "-F", "progressMap=$progressMapJson",
    "-F", "comment=$targetComment",
    "-F", "password=$targetPassword"
  )

  $output = & $curlCommand.Source @curlArgs 2>&1
  $curlExitCode = $LASTEXITCODE
  $outputText = ($output | ForEach-Object { [string]$_ }) -join "`n"

  $statusCode = 0
  $bodyText = $outputText
  $statusMatch = [regex]::Match($outputText, "(?s)^(.*)\r?\nHTTP_STATUS:(\d{3})\s*$")
  if ($statusMatch.Success) {
    $bodyText = $statusMatch.Groups[1].Value
    $statusCode = [int]$statusMatch.Groups[2].Value
  }

  $parsed = $null
  if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
    try {
      $parsed = $bodyText | ConvertFrom-Json
    } catch {
      $parsed = $null
    }
  }

  return [pscustomobject]@{
    IsSuccess = ($curlExitCode -eq 0 -and $statusCode -ge 200 -and $statusCode -lt 300)
    StatusCode = $statusCode
    BodyText = $bodyText
    Body = $parsed
    CurlExitCode = $curlExitCode
  }
}

$apiBaseUrl = ConvertTo-ApiBaseUrl $ApiBaseUrl
$resolvedFile = (Resolve-Path -LiteralPath $FilePath).ProviderPath

Write-Host "API_BASE_URL: $apiBaseUrl"
Write-Host "chartId: $ChartId"
Write-Host "parentVersionId: $ParentVersionId"
Write-Host "filePath: $resolvedFile"

$parent = Find-ParentVersion -apiBaseUrl $apiBaseUrl -targetChartId $ChartId -targetParentVersionId $ParentVersionId
$parentVersion = $parent.Version
$progressMap = Copy-JsonObject $parentVersion.progressMap
$appendMap = Add-OnePaintedBlock $progressMap
$progressMapJson = $appendMap.ProgressMap | ConvertTo-Json -Depth 100 -Compress

Write-Host "Parent displayVersion: $($parentVersion.displayVersion)"
Write-Host "Added block index: $($appendMap.AddedBlockIndex)"
Write-Host "Expected recalculated progress: $($appendMap.Progress)%"

$encodedChartId = [System.Uri]::EscapeDataString($ChartId)
$postUrl = "$apiBaseUrl/api/charts/$encodedChartId/versions"
$result = Invoke-CurlMultipartPost `
  -uri $postUrl `
  -resolvedFilePath $resolvedFile `
  -targetParentVersionId $ParentVersionId `
  -targetAuthor $Author `
  -progressMapJson $progressMapJson `
  -targetComment $Comment `
  -targetPassword $Password

if ($result.IsSuccess) {
  if (Test-StubResponse $result.Body) {
    Write-Host "API returned stub response. Deploy or route implementation is not active." -ForegroundColor Red
    Write-Host "Full response body:"
    Write-Host (Format-JsonBody $result.Body $result.BodyText)
    exit 1
  }

  Write-Host "Append request succeeded." -ForegroundColor Green
  Write-Host "Full response body:"
  Write-Host (Format-JsonBody $result.Body $result.BodyText)

  $versionId = Get-FirstPropertyValue $result.Body @("versionId", "id", "version.id", "data.versionId", "data.version.id")
  $branchPath = Get-FirstPropertyValue $result.Body @("branchPath", "branch_path", "version.branchPath", "version.branch_path", "data.branchPath", "data.branch_path", "data.version.branchPath", "data.version.branch_path")
  $progress = Get-FirstPropertyValue $result.Body @("progress", "version.progress", "data.progress", "data.version.progress")

  Write-Host "versionId: $(Format-OptionalValue $versionId)"
  Write-Host "branchPath: $(Format-OptionalValue $branchPath)"
  Write-Host "progress: $(Format-OptionalValue $progress)"
  exit 0
}

Write-Host "Append request failed." -ForegroundColor Red
Write-Host "HTTP status: $($result.StatusCode)"
if ($result.CurlExitCode -ne 0) {
  Write-Host "curlExitCode: $($result.CurlExitCode)"
}

if ($null -ne $result.Body) {
  $errorCode = Get-PropertyValue $result.Body "code"
  $errorMessage = Get-PropertyValue $result.Body "message"
  $errorDetail = Get-PropertyValue $result.Body "detail"
  Write-Host "code: $(Format-OptionalValue $errorCode)"
  Write-Host "message: $(Format-OptionalValue $errorMessage)"
  Write-Host "detail: $(Format-OptionalValue $errorDetail)"
} else {
  Write-Host $result.BodyText
}

exit 1
