param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$DatabaseName = "conce_restore_$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($DatabaseName -cnotmatch '^conce_restore_[a-z0-9_]+$') {
  throw 'El destino debe ser una base aislada cuyo nombre comience con conce_restore_.'
}
$source = (Resolve-Path -LiteralPath $BackupFile -ErrorAction Stop).Path
$checksumFile = "$source.sha256"
if (-not (Test-Path -LiteralPath $checksumFile)) { throw 'Falta el archivo .sha256 del respaldo.' }
$expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
if ($expected -cne $actual) { throw 'El SHA-256 del respaldo no coincide.' }

$projectRoot = Split-Path -Parent $PSScriptRoot
$remote = "/tmp/conce-restore-$(New-Guid).dump"
Push-Location $projectRoot
try {
  $container = (& docker compose ps -q postgres | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or -not $container) { throw 'PostgreSQL de Compose no está en ejecución.' }
  $container = $container.Trim()
  $dbUser = (& docker exec $container printenv POSTGRES_USER | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $dbUser) { throw 'No se pudo obtener POSTGRES_USER.' }

  # The restricted database name makes this read-only existence query safe to interpolate.
  $exists = (& docker exec $container psql -U $dbUser -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la base de destino.' }
  if ($exists -eq '1') { throw 'La base aislada ya existe; no se sobrescribirá.' }

  try {
    & docker cp $source "${container}:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo al contenedor.' }
    & docker exec $container pg_restore --list $remote | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'El archivo no es un respaldo PostgreSQL válido.' }

    & docker exec $container createdb -U $dbUser -T template0 $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada.' }
    # No --clean or --create: this restores only into the new, empty database above.
    & docker exec $container pg_restore -U $dbUser -d $DatabaseName --no-owner --no-acl --exit-on-error --single-transaction $remote
    if ($LASTEXITCODE -ne 0) { throw "Falló la restauración; $DatabaseName queda aislada para diagnóstico." }
    $migrations = (& docker exec $container psql -U $dbUser -d $DatabaseName -Atqc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Se restauró el archivo, pero falló la verificación del historial Prisma.' }
    Write-Output "Restauración aislada correcta: $DatabaseName ($migrations migraciones registradas)."
  }
  finally {
    & docker exec $container rm -f $remote | Out-Null
  }
}
finally {
  Pop-Location
}
