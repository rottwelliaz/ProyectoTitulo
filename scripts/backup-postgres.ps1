param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$directory = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$fileName = "conce-barber-club-$stamp-$(New-Guid).dump"
$destination = Join-Path $directory $fileName
$remote = "/tmp/$fileName"

Push-Location $projectRoot
try {
  $container = (& docker compose ps -q postgres | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or -not $container) { throw 'PostgreSQL de Compose no está en ejecución.' }
  $container = $container.Trim()

  try {
    # pg_dump writes a custom-format file inside the container. docker cp keeps its bytes intact on Windows.
    & docker exec $container sh -ceu 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl --file="$1"; pg_restore --list "$1" >/dev/null' sh $remote
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump o pg_restore --list falló.' }
    & docker cp "${container}:$remote" $destination
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo al equipo.' }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $fileName" -Encoding ascii
    Write-Output "Respaldo verificado: $destination"
    Write-Output "SHA-256: $hash"
  }
  finally {
    & docker exec $container rm -f $remote | Out-Null
  }
}
finally {
  Pop-Location
}
