# Convierte documentos del paquete a Word (.docx) usando Word por COM.
#
# Uso (desde la raiz del repositorio):
#     powershell -ExecutionPolicy Bypass -File docs\tap\generar-docx.ps1
#
# Para que sirve: el informe del TAP se entrega en la plantilla de la institucion. El .docx
# permite pegar el contenido, actualizar el indice con numeros de pagina automaticos y
# reemplazar las marcas [COMPLETAR: ...].
#
# Limitaciones (importante):
#  - Word recompone el documento con su propio motor: la paginacion NO coincide con la del PDF
#    (medido: 62 paginas en Chrome contra 54 en Word para el mismo informe).
#  - Los diagramas hechos con CSS (el Gantt del Anexo 8, los diagramas de capas del Anexo 1)
#    pueden desarmarse en Word: conviene insertarlos como imagen tomada del PDF.
#
# Se mantiene en ASCII a proposito (PowerShell 5.1 lee como ANSI los .ps1 UTF-8 sin BOM).

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$documentos = @('05-informe-TAP')   # agregar aqui otros nombres sin extension si se necesitan

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

foreach ($d in $documentos) {
  $html = Join-Path $base "$d.html"
  $docx = Join-Path $base "$d.docx"
  if (-not (Test-Path $html)) { Write-Host "- salteado (no existe): $d.html"; continue }
  try {
    $doc = $word.Documents.Open($html, $false, $true)   # ConfirmConversions = false, ReadOnly = true
    $doc.SaveAs2($docx, 16)                             # 16 = wdFormatDocumentDefault (.docx)
    try { $pag = $doc.ComputeStatistics(2) } catch { $pag = 'n/d' }
    $palabras = $doc.ComputeStatistics(0)
    $doc.Close(0)
    $kb = [math]::Round((Get-Item $docx).Length / 1KB)
    Write-Host "[OK] $d.docx ($kb KB, $pag paginas segun Word, $palabras palabras)"
  } catch {
    Write-Host "[FALLO] $d.docx -> $($_.Exception.Message)"
  }
}

$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
