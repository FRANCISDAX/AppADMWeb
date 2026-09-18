# Genera la version APA del informe: .docx editable + .pdf, con Word.
#
# Uso (desde la raiz del repositorio):
#     powershell -ExecutionPolicy Bypass -File docs\tap\generar-apa-word.ps1
#
# Por que con Word y no con Chrome: el formato APA exige numeracion de paginas en la esquina
# superior derecha, y eso no se puede hacer con CSS (Chrome no soporta los margenes de pagina de
# Paged Media). Word lo inserta como campo numerado en el encabezado.
#
# Formato APA general que pide la institucion:
#   · Papel A4
#   · Margenes de 2.54 cm en los cuatro lados
#   · Times New Roman 12
#   · Interlineado doble
#   · Alineacion a la izquierda
#   · Numeracion de paginas arriba a la derecha
#
# ⚠️ La tipografia, el interlineado y la alineacion vienen de `tap-apa.css`, que la variante HTML
# enlaza: NO se reescriben aqui. Reaplicar el formato a todo el contenido con Word
# (`doc.Content.ParagraphFormat` sobre ~100 tablas) tarda mas de 13 minutos en este documento y no
# aporta nada que la hoja de estilo no haya hecho ya. Word solo hace lo que el CSS no puede:
# margenes de pagina, numeracion y exportacion.
#
# Se mantiene en ASCII a proposito (PowerShell 5.1 lee como ANSI los .ps1 UTF-8 sin BOM).

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = Join-Path $base '05-informe-TAP-APA.html'
$docx = Join-Path $base '05-informe-TAP-APA.docx'
$pdf = Join-Path $base '05-informe-TAP-APA.pdf'

if (-not (Test-Path $origen)) { Write-Host "[FALTA] $origen"; exit 1 }

$wdHeaderFooterPrimary = 1
$wdAlignPageNumberRight = 2
$wdExportFormatPDF = 17
$wdFormatDocumentDefault = 16

Write-Host "1/4 abriendo el HTML en Word..."
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.ScreenUpdating = $false

try {
  $doc = $word.Documents.Open($origen, $false, $false)

  Write-Host "2/4 margenes APA de 2.54 cm y papel A4..."
  $cm = $word.CentimetersToPoints(2.54)
  $ps = $doc.PageSetup
  $ps.TopMargin = $cm
  $ps.BottomMargin = $cm
  $ps.LeftMargin = $cm
  $ps.RightMargin = $cm
  $ps.PageWidth = $word.CentimetersToPoints(21.0)
  $ps.PageHeight = $word.CentimetersToPoints(29.7)

  Write-Host "3/4 numeracion de paginas en la esquina superior derecha..."
  $encabezado = $doc.Sections(1).Headers($wdHeaderFooterPrimary)
  $encabezado.Range.ParagraphFormat.Alignment = $wdAlignPageNumberRight
  $encabezado.PageNumbers.Add($wdAlignPageNumberRight, $true) | Out-Null

  Write-Host "4/4 guardando .docx y .pdf..."
  $doc.SaveAs2($docx, $wdFormatDocumentDefault)
  $doc.SaveAs2($pdf, $wdExportFormatPDF)
  $doc.Close(0)

  $kbDocx = [math]::Round((Get-Item $docx).Length / 1KB)
  $kbPdf = [math]::Round((Get-Item $pdf).Length / 1KB)
  Write-Host "[OK] 05-informe-TAP-APA.docx ($kbDocx KB) y 05-informe-TAP-APA.pdf ($kbPdf KB)"
  Write-Host "     APA: A4, margenes 2.54 cm, Times New Roman 12, interlineado doble, izquierda, numeracion arriba a la derecha."
} catch {
  Write-Host "[FALLO] $($_.Exception.Message)"
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
