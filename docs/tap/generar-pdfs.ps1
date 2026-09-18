# Genera los PDF del paquete documental del TAP con Chrome en modo sin interfaz.
#
# Uso (desde la raiz del repositorio, en una terminal de PowerShell):
#     powershell -ExecutionPolicy Bypass -File docs\tap\generar-pdfs.ps1
# o, parado en docs\tap:
#     .\generar-pdfs.ps1
#
# Notas tecnicas:
#  - Chrome necesita la ruta de salida ABSOLUTA (con ruta relativa falla con
#    "Failed to write file ... El sistema no puede encontrar la ruta especificada").
#  - El script se mantiene en ASCII a proposito: la consola de Windows PowerShell 5.1
#    interpreta como ANSI los archivos UTF-8 sin BOM y los acentos rompen el parseo.

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$urlBase = "file:///" + ($dir -replace '\\', '/')

$documentos = @(
  'index',
  '01-arquitectura',
  '02-modelo-datos',
  '03-requerimientos',
  '04-pruebas',
  '05-informe',
  '05-informe-TAP',
  '06-sustentacion',
  '08-cronograma-y-costos'
)

foreach ($d in $documentos) {
  $html = Join-Path $dir "$d.html"
  if (-not (Test-Path $html)) { Write-Host "- salteado (no existe): $d.html"; continue }
  $pdf = Join-Path $dir "$d.pdf"
  & $chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" "$urlBase/$d.html" 2>&1 | Out-Null
  if (Test-Path $pdf) {
    $kb = [math]::Round((Get-Item $pdf).Length / 1KB)
    Write-Host "[OK] $d.pdf ($kb KB)"
  } else {
    Write-Host "[FALLO] $d.pdf"
  }
}
