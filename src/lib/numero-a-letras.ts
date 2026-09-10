// Mismo algoritmo que helper/numeroALetras.js de la app RN.
const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

const especiales: Record<number, string> = {
  11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
  16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
  21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
  25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
}

function convertirGrupo(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'

  let r = ''
  const c = Math.floor(n / 100)
  const d = Math.floor((n % 100) / 10)
  const u = n % 10

  if (c > 0) r += centenas[c] + ' '

  const resto = n % 100
  if (resto === 0) return r.trim()

  if (especiales[resto]) {
    r += especiales[resto]
  } else {
    if (d > 0) r += decenas[d]
    if (d > 0 && u > 0) r += ' Y '
    if (u > 0) r += unidades[u]
  }

  return r.trim()
}

export function numeroALetras(monto: number): string {
  const entero = Math.floor(monto)
  const decimal = Math.round((monto - entero) * 100)

  if (entero === 0) {
    return `CERO CON ${String(decimal).padStart(2, '0')}/100`
  }

  const millones = Math.floor(entero / 1000000)
  const miles = Math.floor((entero % 1000000) / 1000)
  const resto = entero % 1000

  let r = ''

  if (millones > 0) {
    if (millones === 1) r += 'UN MILLÓN '
    else r += convertirGrupo(millones) + ' MILLONES '
  }

  if (miles > 0) {
    if (miles === 1) r += 'MIL '
    else r += convertirGrupo(miles) + ' MIL '
  }

  if (resto > 0) r += convertirGrupo(resto)

  return `${r.trim()} CON ${String(decimal).padStart(2, '0')}/100`
}
