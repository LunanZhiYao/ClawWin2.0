export function credentialFetchTimeoutMs(): number {
  return 25_000
}

export function opensearchPostTimeoutMs(): number {
  return 60_000
}

export function abortSignalAfterMs(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}
