export function indexAssetName(source: string): string | null {
  const match = source.match(/index-[A-Za-z0-9_-]+\.js/)
  return match ? match[0] : null
}

export async function reloadIfNewerWallet(): Promise<boolean> {
  try {
    const current = indexAssetName(document.documentElement.innerHTML)
    const href = new URL(location.href)
    href.searchParams.set('check', String(Date.now()))
    const res = await fetch(href.toString(), {
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    })
    if (!res.ok) return false
    const next = indexAssetName(await res.text())
    if (!current || !next || current === next) return false
    location.reload()
    return true
  } catch {
    return false
  }
}
