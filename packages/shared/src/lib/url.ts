function isNonPublicHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === '0.0.0.0'
    || normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
  )
}

function isUsableBaseUrl(value: string | undefined | null, requestOrigin: string): boolean {
  const raw = (value || '').trim()
  if (!raw) return false
  try {
    const candidate = new URL(raw)
    const requestUrl = new URL(requestOrigin)
    if (!isNonPublicHostname(candidate.hostname)) return true
    return candidate.hostname === requestUrl.hostname
  } catch {
    return false
  }
}

export function isSecureRequest(req: Request): boolean {
  const forwardedProto = (req.headers.get('x-forwarded-proto') || '').trim().toLowerCase()
  if (forwardedProto === 'https') return true
  if (forwardedProto === 'http') return false
  return new URL(req.url).protocol === 'https:'
}

export function shouldUseSecureCookies(req: Request): boolean {
  const forced = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (forced === 'true') return true
  if (forced === 'false') return false
  return isSecureRequest(req)
}

export function getAppBaseUrl(req: Request): string {
  const url = new URL(req.url)
  const requestOrigin = `${url.protocol}//${url.host}`
  if (isUsableBaseUrl(process.env.NEXT_PUBLIC_APP_URL, requestOrigin)) {
    return process.env.NEXT_PUBLIC_APP_URL!.trim()
  }
  if (isUsableBaseUrl(process.env.APP_URL, requestOrigin)) {
    return process.env.APP_URL!.trim()
  }
  return requestOrigin
}

export function toAbsoluteUrl(req: Request, path: string): string {
  return new URL(path, getAppBaseUrl(req)).toString()
}
