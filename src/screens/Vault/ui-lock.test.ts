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
    const content = read('src/components/Content.tsx')
    expect(content).toContain('VaultRefresher')
    expect(app).toContain("navigate('settings')")
    const nav = read('src/screens/Vault/PillNav.tsx')
    expect(nav).toMatch(/hwsign/)
  })

  it('requires recovery chrome and pins v5 staged copy', () => {
    expect(existsSync(resolve(root, 'src/screens/Vault/onboard/Recovery.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'src/screens/Vault/Recover.tsx'))).toBe(true)
    const app = read('src/VaultApp.tsx')
    expect(app).toContain('VaultRecovery')
    expect(app).toContain('VaultRecover')
    const keys = read('src/screens/Vault/Keys.tsx')
    expect(keys).toMatch(/title='Recovery'/)
    expect(keys).toMatch(/This device/)
    expect(keys).toMatch(/start a hold/)
    const enroll = read('src/lib/vault/tenantEnrollment.ts')
    expect(enroll).toMatch(/recoveryXOnly/)
    expect(enroll).toMatch(/recoveryPoP/)
    const proof = read('src/lib/vault/v5/enroll.ts')
    expect(proof).toMatch(/this client enrolls v5 only/)
    const constants = read('src/lib/vault/v5/constants.ts')
    expect(constants).toContain('arkade-vault/v5')
    expect(constants).toContain('phone-hww-recovery-staged-v5')
    const settings = read('src/screens/Vault/Settings.tsx')
    expect(settings).toMatch(/Recover/)
    expect(settings).toMatch(/Recovery Kit/)
  })

  it('collapses the obsolete Savings page and keeps the live spend path', () => {
    expect(existsSync(resolve(root, 'src/screens/Vault/Savings.tsx'))).toBe(false)
    const app = read('src/VaultApp.tsx')
    expect(app).not.toMatch(/VaultSavings/)
    expect(app).not.toMatch(/navigate\('savings'\)/)
    expect(existsSync(resolve(root, 'src/lib/vault/savingsSpend.ts'))).toBe(true)
    expect(existsSync(resolve(root, 'src/lib/vault/savingsQr.ts'))).toBe(true)
    const home = read('src/screens/Vault/Home.tsx')
    expect(home).toContain('account-savings')
    expect(home).not.toMatch(/Phone can spend/)
    expect(home).not.toMatch(/Hardware only/)
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
