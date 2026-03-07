param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [ValidateRange(1, 100)]
    [int]$Quality = 85,

    [switch]$Recurse,
    [switch]$DeletePng,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$magick = Get-Command magick -ErrorAction SilentlyContinue

if (-not $magick) {
    throw 'ImageMagick `magick` was not found on PATH.'
}

$searchOptions = @{
    LiteralPath = $resolvedPath
    Filter = '*.png'
    File = $true
}

if ($Recurse) {
    $searchOptions.Recurse = $true
}

$pngFiles = @(Get-ChildItem @searchOptions)

if ($pngFiles.Count -eq 0) {
    Write-Host "No PNG files found in $resolvedPath"
    exit 0
}

$convertedCount = 0

foreach ($pngFile in $pngFiles) {
    $jpgPath = [System.IO.Path]::ChangeExtension($pngFile.FullName, '.jpg')

    if ((Test-Path -LiteralPath $jpgPath) -and -not $Force) {
        throw "Refusing to overwrite existing file: $jpgPath"
    }

    & $magick.Source $pngFile.FullName `
        -background white `
        -alpha remove `
        -alpha off `
        -quality $Quality `
        $jpgPath

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $jpgPath)) {
        throw "Conversion failed for $($pngFile.FullName)"
    }

    if ($DeletePng) {
        Remove-Item -LiteralPath $pngFile.FullName -Force
    }

    $convertedCount += 1
    Write-Host "Converted $($pngFile.Name) -> $([System.IO.Path]::GetFileName($jpgPath))"
}

Write-Host "Converted $convertedCount PNG file(s) in $resolvedPath"
