import { describe, expect, it } from 'vitest'
import { Themes } from '../types'
import { applyVaultTheme, loadVaultTheme, saveVaultTheme } from './prefs'

describe('vault prefs', () => {
  it('persists theme and toggles the dark palette', () => {
    window.localStorage.clear()
    document.documentElement.classList.remove('palette-dark')
    saveVaultTheme(Themes.Dark)
    expect(loadVaultTheme()).toBe(Themes.Dark)
    expect(document.documentElement.classList.contains('palette-dark')).toBe(true)
    applyVaultTheme(Themes.Light)
    expect(document.documentElement.classList.contains('palette-dark')).toBe(false)
  })
})
