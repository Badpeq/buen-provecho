export const LIMA_TZ = 'America/Lima'

/** Fecha de hoy en hora de Lima → 'YYYY-MM-DD' */
export function limaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: LIMA_TZ })
}

/** Convierte un Date a string de fecha en hora Lima → 'YYYY-MM-DD' */
export function limaDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: LIMA_TZ })
}

/** Formateador de fecha larga en español peruano con zona Lima */
export const limaDateFmt = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day:     'numeric',
  month:   'long',
  timeZone: LIMA_TZ,
})

/** Primera letra mayúscula, resto tal como viene */
export function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
