import ExcelJS from 'exceljs'

type SheetData = {
  name: string
  headers: string[]
  rows: (string | number)[][]
}

type ExcelOpts = {
  titulo?: string
  empresa?: string
}

export async function exportarExcel(data: SheetData[], nombreArchivo: string, opts: ExcelOpts = {}) {
  const wb = new ExcelJS.Workbook()
  wb.creator = opts.empresa || 'AppADM'
  wb.created = new Date()

  for (const sheet of data) {
    const ws = wb.addWorksheet(sheet.name, {
      properties: { defaultColWidth: 15 },
    })

    const totalCols = sheet.headers.length
    let currentRow = 1

    // Empresa
    if (opts.empresa) {
      ws.mergeCells(currentRow, 1, currentRow, totalCols)
      const cell = ws.getCell(currentRow, 1)
      cell.value = opts.empresa
      cell.font = { bold: true, size: 16, name: 'Calibri' }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      ws.getRow(currentRow).height = 30
      currentRow++
    }

    // Título centrado
    if (opts.titulo) {
      ws.mergeCells(currentRow, 1, currentRow, totalCols)
      const cell = ws.getCell(currentRow, 1)
      cell.value = opts.titulo
      cell.font = { bold: true, size: 14, name: 'Calibri' }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(currentRow).height = 26
      currentRow++
    }

    // Separador
    currentRow++

    // Headers
    const headerRow = ws.getRow(currentRow)
    sheet.headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      }
    })
    headerRow.height = 22
    currentRow++

    // Datos
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = ws.getRow(currentRow)
      sheet.rows[r].forEach((val, i) => {
        const cell = row.getCell(i + 1)
        cell.value = val
        cell.font = { size: 10, name: 'Calibri' }
        cell.alignment = { vertical: 'middle' }
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        }
        if (typeof val === 'number' && Math.abs(val) > 10) {
          cell.numFmt = '#,##0.00'
        }
      })
      if (r % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }
        })
      }
      currentRow++
    }

    // Auto-ajustar anchos
    sheet.headers.forEach((h, i) => {
      const maxLen = Math.max(
        h.length,
        ...sheet.rows.map((r) => String(r[i] ?? '').length)
      )
      ws.getColumn(i + 1).width = Math.min(maxLen + 4, 40)
    })

    // Congelar header
    const headerRowIndex = (opts.empresa ? 1 : 0) + (opts.titulo ? 1 : 0) + 1 // after header rows + separator
    ws.views = [{ state: 'frozen', ySplit: headerRowIndex }]
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
