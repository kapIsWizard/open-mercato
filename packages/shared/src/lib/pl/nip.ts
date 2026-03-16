export function sanitizePolishTaxIdInput(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\D+/g, '').slice(0, 10)
}

export function normalizePolishTaxId(value: string | null | undefined): string | null {
  const sanitized = sanitizePolishTaxIdInput(value)
  return sanitized.length ? sanitized : null
}

export function isValidPolishTaxId(value: string | null | undefined): boolean {
  const normalized = normalizePolishTaxId(value)
  if (!normalized || normalized.length !== 10) return false
  if (/^0{10}$/.test(normalized)) return false
  const digits = normalized.split('').map((digit) => Number(digit))
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const checksum = weights.reduce((sum, weight, index) => sum + weight * (digits[index] ?? 0), 0) % 11
  return checksum !== 10 && checksum === digits[9]
}
