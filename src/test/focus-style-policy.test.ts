import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = import.meta.glob('../**/*.css')
const components = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true })

// Vaulted's design excludes focus boxes, rings and field halos. Native focus remains functional.
describe('focus decoration policy', () => {
  it('keeps outlines, rings and border highlights out of CSS focus states', () => {
    const violations: string[] = []
    for (const path of Object.keys(styles)) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      for (const [, selector, body] of String(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/:focus(?:-visible|-within)?\b/.test(selector)) continue
        for (const [, property, value] of body.matchAll(
          /(outline(?:-\w+)?|box-shadow|border(?:-\w+)?)\s*:\s*([^;]+)/g,
        )) {
          if (!/^(none|0)(?:\s*!important)?$/.test(value.trim())) {
            violations.push(`${path}: ${selector.trim()} { ${property}: ${value.trim()} }`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps focus ring utilities out of shared controls', () => {
    const violations: string[] = []
    for (const [path, source] of Object.entries(components)) {
      if (path.endsWith('.test.tsx')) continue
      const cues = String(source).match(
        /(?:focus|focus-visible|focus-within):(?:ring-[^\s'"]+|outline-(?!none)[^\s'"]+|border-ring)/g,
      )
      if (cues) violations.push(`${path}: ${cues.join(' ')}`)
    }
    expect(violations).toEqual([])
  })
})
