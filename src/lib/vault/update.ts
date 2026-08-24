export function indexAssetName(source: string): string | null {
  const match = source.match(/index-[A-Za-z0-9_-]+\.js/)
  return match ? match[0] : null
}

export function probeIndexUrl(origin: string, now = Date.now()): string {
  return new URL(`/index.html?check=${now}`, origin).toString()
}

export function launchUrl(origin: string, now = Date.now()): string {
  const url = new URL('/index.html', origin)
  url.searchParams.set('v', String(now))
  return url.toString()
}

export async function reloadIfNewerWallet(): Promise<boolean> {
  try {
    const current = indexAssetName(document.documentElement.innerHTML)
    const res = await fetch(probeIndexUrl(location.origin), {
      cache: 'no-store',
      headers: {
        Accept: 'text/html',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      },
    })
    if (!res.ok) return false
    const next = indexAssetName(await res.text())
    if (!current || !next || current === next) return false
    // iOS home-screen PWAs ignore location.reload() and keep the cached start URL.
    location.replace(launchUrl(location.origin))
    return true
  } catch {
    return false
  }
}
