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
  [string]$Password = "test-password",
  [switch]$WriteDebugProgressMap
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

function Test-IntegerLike($value) {
  if ($null -eq $value) {
    return $false
  }

  try {
    [void][int]$value
    return $true
  } catch {
    return $false
  }
}

function New-IntPairArray([int]$startIndex, [int]$endIndex) {
  $range = New-Object 'object[]' 2
  $range[0] = [int]$startIndex
  $range[1] = [int]$endIndex
  Write-Output -NoEnumerate $range
}

function Set-JsonProperty($object, [string]$name, $value) {
  Add-Member -InputObject $object -MemberType NoteProperty -Name $name -Value $value -Force
}

function Normalize-RangeArray($rangeValue, [int]$layerIndex, [int]$rangeIndex) {
  $rangeItems = @($rangeValue)
  if ($rangeItems.Count -ne 2) {
    throw "ProgressMap layer $layerIndex range $rangeIndex must contain exactly two values."
  }

  if (-not (Test-IntegerLike $rangeItems[0]) -or -not (Test-IntegerLike $rangeItems[1])) {
    throw "ProgressMap layer $layerIndex range $rangeIndex must contain numeric start and end indexes."
  }

  return New-IntPairArray -startIndex ([int]$rangeItems[0]) -endIndex ([int]$rangeItems[1])
}

function Normalize-RangesArray($rangesValue, [int]$layerIndex) {
  if ($null -eq $rangesValue) {
    throw "ProgressMap layer $layerIndex is missing ranges."
  }

  $rangeItems = @($rangesValue)

  if ($rangeItems.Count -eq 2 -and (Test-IntegerLike $rangeItems[0]) -and (Test-IntegerLike $rangeItems[1])) {
    $singleRange = Normalize-RangeArray -rangeValue $rangeItems -layerIndex $layerIndex -rangeIndex 0
    $singleRanges = New-Object 'object[]' 1
    $singleRanges[0] = $singleRange
    Write-Output -NoEnumerate $singleRanges
    return
  }

  if ($rangeItems.Count -lt 1) {
    throw "ProgressMap layer $layerIndex ranges must contain at least one range."
  }

  $normalizedRanges = New-Object 'object[]' $rangeItems.Count
  for ($rangeIndex = 0; $rangeIndex -lt $rangeItems.Count; $rangeIndex += 1) {
    $normalizedRanges[$rangeIndex] = Normalize-RangeArray -rangeValue $rangeItems[$rangeIndex] -layerIndex $layerIndex -rangeIndex $rangeIndex
  }

  Write-Output -NoEnumerate $normalizedRanges
}

function Normalize-ProgressMapArrays($progressMap) {
  $layersValue = Get-PropertyValue $progressMap "layers"
  if ($null -eq $layersValue) {
    throw "ProgressMap is missing layers."
  }

  $layerItems = @($layersValue)
  if ($layerItems.Count -lt 1) {
    throw "ProgressMap layers must contain at least one layer."
  }

  $normalizedLayers = New-Object 'object[]' $layerItems.Count
  for ($layerIndex = 0; $layerIndex -lt $layerItems.Count; $layerIndex += 1) {
    $layer = $layerItems[$layerIndex]
    $ranges = Normalize-RangesArray -rangesValue (Get-PropertyValue $layer "ranges") -layerIndex $layerIndex
    Set-JsonProperty $layer "ranges" ([object[]]$ranges)
    $normalizedLayers[$layerIndex] = $layer
  }

  Set-JsonProperty $progressMap "layers" ([object[]]$normalizedLayers)
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

  Normalize-ProgressMapArrays $progressMap

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

  $newRange = New-IntPairArray -startIndex ([int]$nextIndex) -endIndex ([int]$nextIndex)
  $newRanges = New-Object 'object[]' 1
  $newRanges[0] = $newRange

  $newLayer = [pscustomobject]@{
    versionId = "pending"
    color = "#2563eb"
    kind = "followup"
  }
  Set-JsonProperty $newLayer "ranges" ([object[]]$newRanges)

  $existingLayers = @($progressMap.layers)
  $updatedLayers = New-Object 'object[]' ($existingLayers.Count + 1)
  for ($layerIndex = 0; $layerIndex -lt $existingLayers.Count; $layerIndex += 1) {
    $updatedLayers[$layerIndex] = $existingLayers[$layerIndex]
  }
  $updatedLayers[$existingLayers.Count] = $newLayer

  Set-JsonProperty $progressMap "layers" ([object[]]$updatedLayers)
  Normalize-ProgressMapArrays $progressMap
  Set-JsonProperty $progressMap "progress" ([int][Math]::Round(($painted.Count / $targetBlockCount) * 100))

  return [pscustomobject]@{
    ProgressMap = $progressMap
    AddedBlockIndex = [int]$nextIndex
    Progress = [int]$progressMap.progress
  }
}

function Assert-ProgressMapJsonShape([string]$json) {
  $parsed = $null
  try {
    $parsed = $json | ConvertFrom-Json
  } catch {
    throw "JSON validation failed: progressMap must be valid JSON before POST. $($_.Exception.Message)"
  }

  $layersValue = Get-PropertyValue $parsed "layers"
  if ($null -eq $layersValue) {
    throw "JSON validation failed: progressMap.layers is missing."
  }

  if (-not ($layersValue -is [System.Array])) {
    throw "JSON validation failed: progressMap.layers must serialize as a JSON array."
  }

  $layers = @($layersValue)
  if ($layers.Count -lt 1) {
    throw "JSON validation failed: progressMap.layers must contain at least one layer."
  }

  for ($layerIndex = 0; $layerIndex -lt $layers.Count; $layerIndex += 1) {
    $rangesValue = Get-PropertyValue $layers[$layerIndex] "ranges"
    if ($null -eq $rangesValue) {
      throw "JSON validation failed: progressMap.layers[$layerIndex].ranges is missing."
    }

    if (-not ($rangesValue -is [System.Array])) {
      throw "JSON validation failed: progressMap.layers[$layerIndex].ranges must serialize as a JSON array."
    }

    $ranges = @($rangesValue)
    if ($ranges.Count -lt 1) {
      throw "JSON validation failed: progressMap.layers[$layerIndex].ranges must contain at least one range."
    }

    for ($rangeIndex = 0; $rangeIndex -lt $ranges.Count; $rangeIndex += 1) {
      $range = $ranges[$rangeIndex]
      if (-not ($range -is [System.Array])) {
        throw "JSON validation failed: progressMap.layers[$layerIndex].ranges[$rangeIndex] must serialize as a JSON array."
      }

      $rangeItems = @($range)
      if ($rangeItems.Count -ne 2) {
        throw "JSON validation failed: progressMap.layers[$layerIndex].ranges[$rangeIndex] must contain exactly two values."
      }

      if (-not (Test-IntegerLike $rangeItems[0]) -or -not (Test-IntegerLike $rangeItems[1])) {
        throw "JSON validation failed: progressMap.layers[$layerIndex].ranges[$rangeIndex] must contain numeric values."
      }
    }
  }

  $firstRanges = @((Get-PropertyValue $layers[0] "ranges"))
  $firstRange = @($firstRanges[0])

  return [pscustomobject]@{
    LayersIsArray = $true
    LayerCount = [int]$layers.Count
    FirstRangesIsArray = $true
    FirstRangeLength = [int]$firstRange.Count
  }
}

function ConvertTo-ProgressMapJson($progressMap) {
  Normalize-ProgressMapArrays $progressMap
  $json = $progressMap | ConvertTo-Json -Depth 50 -Compress
  $trimmedJson = $json.TrimStart()

  if (-not $trimmedJson.StartsWith("{")) {
    throw "JSON validation failed: progressMap JSON must start with '{'. Actual prefix: $($trimmedJson.Substring(0, [Math]::Min(20, $trimmedJson.Length)))"
  }

  $shape = Assert-ProgressMapJsonShape $json

  return [pscustomobject]@{
    Json = $json
    Shape = $shape
  }
}

function Get-PreviewText([string]$value, [int]$maxLength) {
  if ($value.Length -le $maxLength) {
    return $value
  }

  return $value.Substring(0, $maxLength)
}

function Write-ProgressMapTempFile([string]$progressMapJson) {
  $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("bms-wip-progress-map-" + [System.Guid]::NewGuid().ToString("N") + ".json")
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tempPath, $progressMapJson, $utf8NoBom)
  return $tempPath
}

function Write-DebugProgressMapFile([string]$progressMapJson) {
  $debugPath = Join-Path $PSScriptRoot "debug-progressMap.json"
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($debugPath, $progressMapJson, $utf8NoBom)
  return $debugPath
}

function Invoke-CurlMultipartPost(
  [string]$uri,
  [string]$resolvedFilePath,
  [string]$targetParentVersionId,
  [string]$targetAuthor,
  [string]$progressMapTempPath,
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
    "-F", "progressMap=<$progressMapTempPath;type=application/json",
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
$progressMapJsonResult = ConvertTo-ProgressMapJson $appendMap.ProgressMap
$progressMapJson = $progressMapJsonResult.Json
$progressMapShape = $progressMapJsonResult.Shape
$progressMapPreview = Get-PreviewText $progressMapJson 200

Write-Host "Parent displayVersion: $($parentVersion.displayVersion)"
Write-Host "Added block index: $($appendMap.AddedBlockIndex)"
Write-Host "Expected recalculated progress: $($appendMap.Progress)%"
Write-Host "progressMapJson preview: $progressMapPreview"
Write-Host "progressMapJson layers array: $($progressMapShape.LayersIsArray); layers count: $($progressMapShape.LayerCount); first ranges array: $($progressMapShape.FirstRangesIsArray); first range length: $($progressMapShape.FirstRangeLength)"

if ($WriteDebugProgressMap) {
  $debugProgressMapPath = Write-DebugProgressMapFile $progressMapJson
  Write-Host "Debug progressMap JSON: $debugProgressMapPath"
}

$encodedChartId = [System.Uri]::EscapeDataString($ChartId)
$postUrl = "$apiBaseUrl/api/charts/$encodedChartId/versions"
$progressMapTempPath = $null

try {
  $progressMapTempPath = Write-ProgressMapTempFile $progressMapJson
  $result = Invoke-CurlMultipartPost `
    -uri $postUrl `
    -resolvedFilePath $resolvedFile `
    -targetParentVersionId $ParentVersionId `
    -targetAuthor $Author `
    -progressMapTempPath $progressMapTempPath `
    -targetComment $Comment `
    -targetPassword $Password
} finally {
  if (-not [string]::IsNullOrWhiteSpace($progressMapTempPath) -and (Test-Path -LiteralPath $progressMapTempPath)) {
    Remove-Item -LiteralPath $progressMapTempPath -Force -ErrorAction SilentlyContinue
  }
}

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
