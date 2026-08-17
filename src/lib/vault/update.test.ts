import { describe, expect, it } from 'vitest'
import { indexAssetName, launchUrl, probeIndexUrl } from './update'

describe('indexAssetName', () => {
  it('reads the hashed wallet bundle name', () => {
    expect(indexAssetName('<script type="module" src="/assets/index-DFjjFn5j.js">')).toBe('index-DFjjFn5j.js')
  })

  it('returns null when the page has no wallet bundle', () => {
    expect(indexAssetName('<html></html>')).toBeNull()
  })
})

describe('PWA update probe', () => {
  it('asks Vercel for index.html, not the in-app route', () => {
    expect(probeIndexUrl('https://arkade-vault-demo.vercel.app', 1700000000000)).toBe(
      'https://arkade-vault-demo.vercel.app/index.html?check=1700000000000',
    )
  })

  it('reloads with a cache-busting query so iOS does not keep the old start URL', () => {
    expect(launchUrl('https://arkade-vault-demo.vercel.app', '/', 1700000000000)).toBe(
      'https://arkade-vault-demo.vercel.app/?v=1700000000000',
    )
    expect(launchUrl('https://arkade-vault-demo.vercel.app', '/?check=1#home', 9)).toBe(
      'https://arkade-vault-demo.vercel.app/?v=9',
    )
  })
})
