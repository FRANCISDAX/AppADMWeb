# Verificacion del paquete documental del TAP (docs/tap/).
# Uso:  powershell -ExecutionPolicy Bypass -File docs\tap\verificar.ps1
#
# Comprueba, para cada anexo:
#   1. que el HTML existe;
#   2. que enlaza la hoja de estilo compartida (salvo las diapositivas, que traen la suya);
#   3. que tiene portada y pie de documento;
#   4. que las etiquetas <div> estan balanceadas (indicio de HTML bien formado);
#   5. que el PDF se genero y cuantas paginas tiene;
#   6. que las cifras clave aparecen de forma consistente entre anexos.
#
# Se mantiene en ASCII a proposito (PowerShell 5.1 lee como ANSI los .ps1 UTF-8 sin BOM).

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$documentos = @('index','01-arquitectura','02-modelo-datos','03-requerimientos','04-pruebas','05-informe','06-sustentacion')

function Get-PaginasPdf($ruta) {
  $txt = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($ruta))
  return ([regex]::Matches($txt, '/Type\s*/Page[^s]')).Count
}

# Tamano de pagina real del PDF: A4 = 595 x 842 pt, Carta = 612 x 792 pt (tolerancia por redondeo).
function Get-TamanoPdf($ruta) {
  $txt = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($ruta))
  $m = [regex]::Match($txt, '/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)')
  if (-not $m.Success) { return 'sin MediaBox' }
  $w = [math]::Round([double]$m.Groups[3].Value - [double]$m.Groups[1].Value)
  $h = [math]::Round([double]$m.Groups[4].Value - [double]$m.Groups[2].Value)
  $esA4 = ([math]::Abs($w - 595) -le 3 -and [math]::Abs($h - 842) -le 3)
  $esA4H = ([math]::Abs($w - 842) -le 3 -and [math]::Abs($h - 595) -le 3)
  if ($esA4) { return "A4 ($w x $h pt)" }
  if ($esA4H) { return "A4 horizontal ($w x $h pt)" }
  if ([math]::Abs($w - 612) -le 3 -and [math]::Abs($h - 792) -le 3) { return "CARTA ($w x $h pt) - revisar @page" }
  return "$w x $h pt"
}

$faltantes = 0
$problemas = 0
Write-Host "== Paquete documental del TAP ==" -ForegroundColor Cyan

foreach ($d in $documentos) {
  $html = Join-Path $dir "$d.html"
  if (-not (Test-Path $html)) { Write-Host ("[FALTA]  {0}.html" -f $d) -ForegroundColor Yellow; $faltantes++; continue }

  $contenido = [System.IO.File]::ReadAllText($html)
  $avisos = @()

  $esPresentacion = ($d -eq '06-sustentacion')
  if (-not $esPresentacion -and $contenido -notmatch 'href="tap\.css"') { $avisos += 'no enlaza tap.css' }
  if ($esPresentacion -and $contenido -notmatch 'size: A4 landscape') { $avisos += 'las diapositivas no declaran A4 horizontal' }
  if (-not $esPresentacion -and $contenido -notmatch 'class="portada"') { $avisos += 'sin portada' }
  if (-not $esPresentacion -and $contenido -notmatch 'class="pie"') { $avisos += 'sin pie de documento' }

  $abre = ([regex]::Matches($contenido, '<div')).Count
  $cierra = ([regex]::Matches($contenido, '</div>')).Count
  if ($abre -ne $cierra) { $avisos += "div desbalanceados ($abre abren / $cierra cierran)" }

  $pdf = Join-Path $dir "$d.pdf"
  $paginas = 0
  $tamano = 'sin PDF'
  if (Test-Path $pdf) { $paginas = Get-PaginasPdf $pdf; $tamano = Get-TamanoPdf $pdf; if ($tamano -notmatch '^A4') { $avisos += "formato $tamano" } } else { $avisos += 'sin PDF' }

  if ($avisos.Count -eq 0) {
    Write-Host ("[OK]     {0,-20} {1,4} paginas, {2,-22} {3,6:N0} KB" -f "$d.html", $paginas, $tamano, ((Get-Item $html).Length/1KB)) -ForegroundColor Green
  } else {
    Write-Host ("[REVISAR] {0,-20} {1}" -f "$d.html", ($avisos -join '; ')) -ForegroundColor Red
    $problemas++
  }
}

Write-Host ""
Write-Host "== Cifras clave (deben ser coherentes entre anexos) ==" -ForegroundColor Cyan
$cifras = @{ 'pruebas automatizadas (195)' = '195'; 'colecciones (16)' = '16 colecciones'; 'lineas de codigo (25 373)' = '25 373'; 'paginas de la app (27)' = '27 p' }
foreach ($c in $cifras.Keys) {
  $donde = @()
  foreach ($d in $documentos) {
    $html = Join-Path $dir "$d.html"
    if ((Test-Path $html) -and ([System.IO.File]::ReadAllText($html) -match [regex]::Escape($cifras[$c]))) { $donde += $d }
  }
  if ($donde.Count -eq 0) { Write-Host ("  {0,-32} no aparece en ningun anexo" -f $c) }
  else { Write-Host ("  {0,-32} {1}" -f $c, ($donde -join ', ')) }
}

Write-Host ""
if ($faltantes -gt 0) { Write-Host "$faltantes anexo(s) sin generar todavia." -ForegroundColor Yellow }
if ($problemas -gt 0) { Write-Host "$problemas anexo(s) con observaciones." -ForegroundColor Red }

# ─── Comprobacion del alcance del paquete (lo que el objetivo exige) ─────────────────────────
Write-Host ""
Write-Host "== Alcance del paquete ==" -ForegroundColor Cyan

function Leer($nombre) {
  $p = Join-Path $dir $nombre
  if (Test-Path $p) { return [System.IO.File]::ReadAllText($p) } else { return '' }
}
function Contar($texto, $patron) { return ([regex]::Matches($texto, $patron)).Count }

$fallos = 0
function Exigir($descripcion, $condicion, $detalle) {
  if ($condicion) { Write-Host ("  [OK]      {0} {1}" -f $descripcion, $detalle) -ForegroundColor Green }
  else { Write-Host ("  [FALLA]   {0} {1}" -f $descripcion, $detalle) -ForegroundColor Red; $script:fallos++ }
}

$modelo = Leer '02-modelo-datos.html'
$req    = Leer '03-requerimientos.html'
$pruebas = Leer '04-pruebas.html'
$informe = Leer '05-informe.html'
$slides  = Leer '06-sustentacion.html'
$guion   = Leer 'guion-sustentacion.md'

Exigir 'Anexo 2 cubre las colecciones' ((Contar $modelo 'tbl[A-Z]') -ge 16) ("(referencias a colecciones: {0})" -f (Contar $modelo 'tbl[A-Z]'))
Exigir 'Anexo 2 describe el ciclo de vida del documento' (($modelo -match 'PENDIENTE') -and ($modelo -match 'cancelado') -and ($modelo -match 'anulada')) ''
Exigir 'Anexo 3: requerimientos funcionales' ((Contar $req 'RF-\d+') -ge 100) ("(RF: {0})" -f (Contar $req 'RF-\d+'))
Exigir 'Anexo 3: requerimientos no funcionales' ((Contar $req 'RNF-\d{2}') -ge 20) ("(RNF: {0})" -f (Contar $req 'RNF-\d{2}'))
Exigir 'Anexo 3: casos de uso' ((Contar $req 'CU-\d{2}') -ge 15) ("(CU: {0})" -f (Contar $req 'CU-\d{2}'))
Exigir 'Anexo 3: historias de usuario' ((Contar $req 'HU-\d{2}') -ge 15) ("(HU: {0})" -f (Contar $req 'HU-\d{2}'))
Exigir 'Anexo 4: inventario de las 195 pruebas' (($pruebas -match '195')) ''
Exigir 'Anexo 4: incidencias documentadas' ((Contar $pruebas 'INC-\d{2}') -ge 8) ("(INC: {0})" -f (Contar $pruebas 'INC-\d{2}'))
Exigir 'Anexo 4: casos de prueba de aceptacion' ((Contar $pruebas 'CP-\d{2}') -ge 15) ("(CP: {0})" -f (Contar $pruebas 'CP-\d{2}'))
Exigir 'Anexo 4: matriz de trazabilidad y limitaciones' (($pruebas -match 'trazabilidad') -and ($pruebas -match 'Limitaciones|limitaciones')) ''
Exigir 'Anexo 5: los cinco capitulos' (($informe -match 'Cap.tulo V|Conclusiones') -and ($informe -match 'Cap.tulo IV|Resultados') -and ($informe -match 'Cap.tulo III|Desarrollo') -and ($informe -match 'Cap.tulo II|Marco te.rico') -and ($informe -match 'Cap.tulo I[^IV]|Planteamiento')) ''
Exigir 'Anexo 5: marcas para el tesista' ((Contar $informe '\[COMPLETAR') -ge 10) ("([COMPLETAR: {0}])" -f (Contar $informe '\[COMPLETAR'))
Exigir 'Anexo 6: diapositivas de sustentacion' ((Contar $slides 'class="slide') -ge 18) ("(diapositivas: {0})" -f (Contar $slides 'class="slide'))
Exigir 'Anexo 6: guion de la defensa' (($guion.Length -gt 3000) -and ((Contar $guion '\?\*?\*?') -ge 10)) ("(guion: {0:N0} KB)" -f ($guion.Length/1KB))

# ─── El paquete se imprime y se entrega: no puede filtrar credenciales ──────────────────────
# ⚠️ `Get-ChildItem -Include` SIN `-Recurse` no devuelve nada (comprobacion vacua): se enumeran
# los archivos y se filtra por extension. Y los patrones buscan **valores con forma de secreto**,
# no la palabra "contrasena": los anexos describen el inicio de sesion con correo y contrasena,
# y eso no es una fuga. El script no se escanea a si mismo (contiene la lista de patrones).
$sensibles = @(
  'password\s*[:=]\s*\S',            # asignacion real de una clave
  'AIza[0-9A-Za-z_\-]{20,}',         # clave de API de Google
  'sk-[A-Za-z0-9]{20,}',             # clave de API con formato de token
  'Bearer\s+[A-Za-z0-9._\-]{20,}',   # token en una cabecera
  '"private_key"',                   # campos de una cuenta de servicio
  '"client_email"',
  'BEGIN [A-Z ]*PRIVATE KEY',
  '\.p12', 'adminsdk', 'fbsvc', 'accessKeys', 'administ_accessKeys',
  '192\.168\.\d+\.\d+'               # direcciones internas de la red del negocio
)
$fugas = @()
$revisados = 0
foreach ($f in (Get-ChildItem $dir -File | Where-Object { $_.Extension -in @('.html','.md','.css') -and $_.Name -ne 'verificar.ps1' })) {
  $revisados++
  $texto = [System.IO.File]::ReadAllText($f.FullName)
  foreach ($p in $sensibles) {
    if ($texto -match $p) { $fugas += ("{0} [{1}]" -f $f.Name, $p) }
  }
}
Exigir "Sin credenciales ni datos sensibles ($revisados archivos revisados)" ($fugas.Count -eq 0) ("({0})" -f (($fugas | Select-Object -Unique) -join ', '))

Write-Host ""
if ($faltantes -eq 0 -and $problemas -eq 0 -and $fallos -eq 0) {
  Write-Host "Paquete COMPLETO: documentacion generada, PDF al dia y alcance cubierto." -ForegroundColor Green
} else {
  Write-Host ("Pendiente: {0} anexo(s) sin generar, {1} con observaciones, {2} comprobacion(es) del alcance sin cumplir." -f $faltantes, $problemas, $fallos) -ForegroundColor Yellow
}
