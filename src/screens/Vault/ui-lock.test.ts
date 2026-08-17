import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('vault UI lock', () => {
  it('keeps the restyle screens that Vercel deploys from git', () => {
    expect(existsSync(resolve(root, 'src/screens/Vault/PillNav.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'src/screens/Vault/Settings.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'src/screens/Vault/Refresher.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'src/icons/Vault.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'src/lib/vault/prefs.ts'))).toBe(true)
  })

  it('mounts pill nav and settings from VaultApp', () => {
    const app = read('src/VaultApp.tsx')
    expect(app).toContain('VaultPillNav')
    expect(app).toContain('VaultSettings')
    expect(app).toContain('has-pill-navbar')
  })

  it('rejects the retired singleton home chrome', () => {
    const home = read('src/screens/Vault/Home.tsx')
    expect(home).toContain('account-switcher')
    expect(home).toContain('available today')
    expect(home).not.toMatch(/Phone may spend/)
    expect(home).not.toMatch(/Mutinynet · live coins/)
    expect(home).not.toMatch(/Daily path ready/)
    expect(home).not.toMatch(/Open Mutinynet faucet/)
  })
})
