export function toLocalISODate(date = new Date()) {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function monthBounds(monthValue) {
  const [year, month] = monthValue.split('-').map(Number)
  const start = `${monthValue}-01`
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  return { start, endExclusive: next }
}

export function currentMonthValue() {
  return toLocalISODate().slice(0, 7)
}

export function formatMonth(monthValue) {
  const [year, month] = monthValue.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function formatDate(dateString) {
  if (!dateString) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateString}T00:00:00Z`))
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Number(value || 0))
}

export function formatHours(value) {
  const amount = Number(value || 0)
  return Number.isInteger(amount) ? `${amount}` : amount.toFixed(2).replace(/0$/, '')
}
