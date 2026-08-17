import { describe, expect, it } from 'vitest'
import { indexAssetName } from './update'

describe('indexAssetName', () => {
  it('reads the hashed wallet bundle name', () => {
    expect(indexAssetName('<script type="module" src="/assets/index-DFjjFn5j.js">')).toBe('index-DFjjFn5j.js')
  })

  it('returns null when the page has no wallet bundle', () => {
    expect(indexAssetName('<html></html>')).toBeNull()
  })
})
