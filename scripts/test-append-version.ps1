<#
.SYNOPSIS
  Manual test script for POST /api/charts/:chartId/versions.

.DESCRIPTION
  This script reads the parent version progressMap from GET /api/charts,
  paints one additional unpainted block, and submits a multipart follow-up post.
  The API is expected to replace the last layer versionId with the created versionId.

.EXAMPLE
  .\scripts\test-append-version.ps1 `
    -chartId "chart_xxx" `
    -parentVersionId "version_xxx" `
    -filePath ".\branch-append.bms"

.EXAMPLE
  .\scripts\test-append-version.ps1 `
    -API_BASE_URL "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
    -chartId "chart_xxx" `
    -parentVersionId "version_xxx" `
    -filePath ".\branch-append.bms" `
    -password "your-password"
#>

[CmdletBinding()]
param(
  [Alias("ApiBaseUrl")]
  [string]$API_BASE_URL = "http://localhost:8787",

  [Parameter(Mandatory = $true)]
  [Alias("ChartId")]
  [string]$chartId,

  [Parameter(Mandatory = $true)]
  [Alias("ParentVersionId")]
  [string]$parentVersionId,

  [Parameter(Mandatory = $true)]
  [Alias("FilePath")]
  [string]$filePath,

  [string]$author = "append-check",
  [string]$comment = "BRANCH-01A-CHECK append test",
  [string]$password = "test-password"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-ApiBaseUrl([string]$value) {
  $trimmed = $value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw "API_BASE_URL is empty. Example: http://localhost:8787"
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

function Set-JsonProperty($object, [string]$name, $value) {
  if ($null -ne $object.PSObject.Properties[$name]) {
    $object.$name = $value
    return
  }

  Add-Member -InputObject $object -MemberType NoteProperty -Name $name -Value $value
}

function Get-PaintedIndexes($progressMap) {
  $painted = New-Object 'System.Collections.Generic.HashSet[int]'

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
        [void]$painted.Add($index)
      }
    }
  }

  return $painted
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
    if (-not $painted.Contains($index)) {
      $nextIndex = $index
      break
    }
  }

  if ($null -eq $nextIndex) {
    throw "No unpainted block is available. The parent progressMap is already fully painted. To check PROGRESS_MAP_UNCHANGED, send the parent progressMap without changes."
  }

  [void]$painted.Add([int]$nextIndex)

  $newLayer = [pscustomobject]@{
    versionId = "pending"
    color = "#2563eb"
    kind = "followup"
    ranges = @(,@([int]$nextIndex, [int]$nextIndex))
  }

  Set-JsonProperty $progressMap "layers" (@(@($progressMap.layers) + $newLayer))
  Set-JsonProperty $progressMap "progress" ([int][Math]::Round(($painted.Count / $targetBlockCount) * 100))

  return [pscustomobject]@{
    ProgressMap = $progressMap
    AddedBlockIndex = [int]$nextIndex
    Progress = [int]$progressMap.progress
  }
}

function New-StringContent([string]$value) {
  return [System.Net.Http.StringContent]::new($value, [System.Text.Encoding]::UTF8)
}

function Invoke-MultipartPost(
  [string]$uri,
  [string]$resolvedFilePath,
  [string]$targetParentVersionId,
  [string]$targetAuthor,
  [string]$progressMapJson,
  [string]$targetComment,
  [string]$targetPassword
) {
  Add-Type -AssemblyName System.Net.Http

  $client = [System.Net.Http.HttpClient]::new()
  $form = [System.Net.Http.MultipartFormDataContent]::new()
  $fileStream = $null

  try {
    $fileStream = [System.IO.File]::OpenRead($resolvedFilePath)
    $fileContent = [System.Net.Http.StreamContent]::new($fileStream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")

    $form.Add($fileContent, "file", [System.IO.Path]::GetFileName($resolvedFilePath))
    $form.Add((New-StringContent $targetParentVersionId), "parentVersionId")
    $form.Add((New-StringContent $targetAuthor), "author")
    $form.Add((New-StringContent $progressMapJson), "progressMap")
    $form.Add((New-StringContent $targetComment), "comment")
    $form.Add((New-StringContent $targetPassword), "password")

    $response = $client.PostAsync($uri, $form).GetAwaiter().GetResult()
    $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    $parsed = $null
    if (-not [string]::IsNullOrWhiteSpace($responseText)) {
      try {
        $parsed = $responseText | ConvertFrom-Json
      } catch {
        $parsed = $null
      }
    }

    return [pscustomobject]@{
      IsSuccess = $response.IsSuccessStatusCode
      StatusCode = [int]$response.StatusCode
      BodyText = $responseText
      Body = $parsed
    }
  } finally {
    if ($null -ne $fileStream) {
      $fileStream.Dispose()
    }
    $form.Dispose()
    $client.Dispose()
  }
}

$apiBaseUrl = ConvertTo-ApiBaseUrl $API_BASE_URL
$resolvedFile = (Resolve-Path -LiteralPath $filePath).ProviderPath

Write-Host "API_BASE_URL: $apiBaseUrl"
Write-Host "chartId: $chartId"
Write-Host "parentVersionId: $parentVersionId"
Write-Host "filePath: $resolvedFile"

$parent = Find-ParentVersion -apiBaseUrl $apiBaseUrl -targetChartId $chartId -targetParentVersionId $parentVersionId
$parentVersion = $parent.Version
$progressMap = Copy-JsonObject $parentVersion.progressMap
$appendMap = Add-OnePaintedBlock $progressMap
$progressMapJson = $appendMap.ProgressMap | ConvertTo-Json -Depth 100 -Compress

Write-Host "Parent displayVersion: $($parentVersion.displayVersion)"
Write-Host "Added block index: $($appendMap.AddedBlockIndex)"
Write-Host "Expected recalculated progress: $($appendMap.Progress)%"

$encodedChartId = [System.Uri]::EscapeDataString($chartId)
$postUrl = "$apiBaseUrl/api/charts/$encodedChartId/versions"
$result = Invoke-MultipartPost `
  -uri $postUrl `
  -resolvedFilePath $resolvedFile `
  -targetParentVersionId $parentVersionId `
  -targetAuthor $author `
  -progressMapJson $progressMapJson `
  -targetComment $comment `
  -targetPassword $password

if ($result.IsSuccess) {
  Write-Host "Append request succeeded." -ForegroundColor Green
  Write-Host "versionId: $($result.Body.versionId)"
  Write-Host "branchPath: $($result.Body.branchPath)"
  Write-Host "progress: $($result.Body.progress)"
  exit 0
}

Write-Host "Append request failed." -ForegroundColor Red
Write-Host "HTTP status: $($result.StatusCode)"

if ($null -ne $result.Body) {
  Write-Host "code: $($result.Body.code)"
  Write-Host "message: $($result.Body.message)"
  Write-Host "detail: $($result.Body.detail)"
} else {
  Write-Host $result.BodyText
}

exit 1
