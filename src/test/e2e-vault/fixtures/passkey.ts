import { expect, test as base, type BrowserContext, type CDPSession, type Page, type Route } from '@playwright/test'
import { buildVaultProgramDescriptor, hashVaultProgramDescriptor } from '../../../lib/vault/program/descriptor'
import { PROGRAM_FIXTURE } from '../../../lib/vault/program/fixtures'
import { recoveryBindingDigest } from '../../../lib/vault/passkeyBinding'
import { bytesToHex } from '../../../lib/vault/hex'
import { POLICY_VERSION } from '../../../lib/vault/constants'
import { SAVINGS_TEMPLATE } from '../../../lib/vault/program/constants'
import type { VaultStatus } from '../../../lib/vault/types'

const ORIGIN = 'http://localhost:3003'
const RP_ID = 'localhost'
const INVITE = 'e2e-passkey-invite-0000000000000000'
const VAULT_ID = PROGRAM_FIXTURE.vaultId

type CDPCredential = {
  credentialId: string
  isResidentCredential: boolean
  rpId?: string
  privateKey: string
  signCount: number
  userHandle?: string
}

type AuthenticatorOptions = {
  protocol: 'ctap2'
  ctap2Version: 'ctap2_1'
  transport: 'internal'
  hasResidentKey: true
  hasUserVerification: true
  hasPrf: true
  isUserVerified: true
  automaticPresenceSimulation: boolean
}

export type VirtualPasskey = {
  abortNextRequest(): Promise<void>
  credentials(): Promise<CDPCredential[]>
  setPresence(enabled: boolean): Promise<void>
}

type PasskeyInstall = {
  binding: string
  bindingDigest: string
  envelopeNonce: string
  envelopeCiphertext: string
  bindingDirectSig: string
  bindingPhoneSig: string
}

export type FakePasskeyAuthorizer = {
  readonly invite: string
  readonly vaultId: string
  clearRecoverGate(): void
  rejectNextRecoveryAsWrongCredential(): void
  releaseRecover(): void
  waitForRecover(): Promise<void>
}

type SecretAuditSnapshot = {
  generated32: string[]
  hkdfInputs: string[]
  hkdfOutputs: string[]
  serviceWorkerMessages: unknown[]
}

export type SecretAudit = {
  assertNoSecretsPersisted(page: Page): Promise<void>
  snapshot(page: Page): Promise<SecretAuditSnapshot>
}

type Fixtures = {
  authorizer: FakePasskeyAuthorizer
  passkey: VirtualPasskey
  secretAudit: SecretAudit
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function publicStatus() {
  return {
    network: 'mutinynet',
    clientOrigin: ORIGIN,
    rpId: RP_ID,
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    enrollmentMode: 'token',
  }
}

class FakeAuthorizer implements FakePasskeyAuthorizer {
  readonly invite = INVITE
  readonly vaultId = VAULT_ID

  private enrolled = false
  private passkeyLoginAvailable = false
  private proposed?: Record<string, string>
  private descriptor?: ReturnType<typeof buildVaultProgramDescriptor>
  private install?: PasskeyInstall
  private challengeCounter = 0
  private recoverGate?: { promise: Promise<void>; release: () => void }
  private recoverSeen?: { promise: Promise<void>; resolve: () => void }
  private wrongRecovery = false

  constructor(private readonly page: Page) {}

  async installRoutes() {
    await this.page.route('**/v1/**', async (route) => this.handle(route))
    await this.page.route('**/esplora/**', async (route) => {
      const url = route.request().url()
      if (/\/address\/[^/]+\/(utxo|txs)$/.test(url)) return json(route, [])
      if (/\/tx\/[0-9a-f]+\/status$/.test(url)) return json(route, { confirmed: false })
      return json(route, { error: 'not found' }, 404)
    })
  }

  clearRecoverGate() {
    let release: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    this.recoverGate = { promise, release }
    let seen: () => void = () => undefined
    const seenPromise = new Promise<void>((resolve) => {
      seen = resolve
    })
    this.recoverSeen = { promise: seenPromise, resolve: seen }
  }

  releaseRecover() {
    this.recoverGate?.release()
    this.recoverGate = undefined
  }

  rejectNextRecoveryAsWrongCredential() {
    this.wrongRecovery = true
  }

  async waitForRecover() {
    if (!this.recoverSeen) throw new Error('recover gate was not installed')
    await this.recoverSeen.promise
  }

  private status(vaultId = VAULT_ID): VaultStatus {
    const proposed = this.proposed
    const descriptor = this.descriptor
    return {
      enrolled: this.enrolled,
      network: 'mutinynet',
      clientOrigin: ORIGIN,
      rpId: RP_ID,
      vaultId,
      templateVersion: SAVINGS_TEMPLATE,
      policyVersion: POLICY_VERSION,
      externalOwnerWalletPub: descriptor?.keys.hardware || PROGRAM_FIXTURE.hardwarePub,
      vaultCosignerBasePub: PROGRAM_FIXTURE.vaultCosignerBase,
      arkadeCosignerBasePub: PROGRAM_FIXTURE.arkadeCosignerBase,
      arkadeCosignerOrigin: PROGRAM_FIXTURE.arkadeCosigner.origin,
      arkadeCosignerVersion: PROGRAM_FIXTURE.arkadeCosigner.version,
      savingsAddress: descriptor?.savings.address || 'tb1psavings',
      savingsScript: descriptor?.savings.script || `5120${'11'.repeat(32)}`,
      periodAllowance: 100_000,
      periodSpent: 0,
      periodRemaining: 100_000,
      txCap: 50_000,
      absoluteFeeCap: 5_000,
      feerateCapSatVb: 10,
      phoneBip340Pub: proposed?.phoneBip340Pub,
      phoneDirectP256: proposed?.phoneDirectP256,
      passkeyLoginAvailable: this.passkeyLoginAvailable,
      enrollmentMode: 'token',
      vtxoVaultCosignerPub: PROGRAM_FIXTURE.vaultCosignerBase,
      vtxoExitDelay: 4608,
      vtxoExitDelayUnit: 'seconds',
      spendingArkAddress: 'tark1spending',
      spendingArkScript: `5120${'22'.repeat(32)}`,
      vtxoDelegatePub: PROGRAM_FIXTURE.arkadeCosignerBase,
      vtxoBoardingActive: false,
      vtxoBoardingProgram: 'vault-board-v1',
      vtxoBoardingAddress: 'tb1pboarding',
      vtxoBoardingScript: `5120${'33'.repeat(32)}`,
      vtxoBoardingExitDelay: 604_672,
      vtxoBoardingExitDelayUnit: 'seconds',
    }
  }

  private recoveryBinding(body: { envelopeNonce: string; envelopeCiphertext: string }) {
    if (!this.proposed) throw new Error('passkey was not proposed')
    const status = this.status()
    return JSON.stringify({
      version: 3,
      credentialId: this.proposed.credentialId,
      webauthnP256: this.proposed.webauthnP256,
      phoneDirectP256: status.phoneDirectP256,
      phoneBip340Pub: status.phoneBip340Pub,
      externalOwnerWalletPub: status.externalOwnerWalletPub,
      vaultCosignerBasePub: status.vaultCosignerBasePub,
      arkadeCosignerBasePub: status.arkadeCosignerBasePub,
      arkadeCosignerOrigin: status.arkadeCosignerOrigin,
      arkadeCosignerVersion: status.arkadeCosignerVersion,
      clientOrigin: status.clientOrigin,
      rpId: status.rpId,
      network: status.network,
      vaultId: status.vaultId,
      templateVersion: status.templateVersion,
      policyVersion: status.policyVersion,
      savingsAddress: status.savingsAddress,
      savingsScript: status.savingsScript,
      vtxoVaultCosignerPub: status.vtxoVaultCosignerPub,
      vtxoExitDelay: status.vtxoExitDelay,
      vtxoExitDelayUnit: status.vtxoExitDelayUnit,
      spendingArkAddress: status.spendingArkAddress,
      spendingArkScript: status.spendingArkScript,
      vtxoDelegatePub: status.vtxoDelegatePub,
      vtxoBoardingActive: status.vtxoBoardingActive,
      vtxoBoardingProgram: status.vtxoBoardingProgram,
      vtxoBoardingAddress: status.vtxoBoardingAddress,
      vtxoBoardingScript: status.vtxoBoardingScript,
      vtxoBoardingExitDelay: status.vtxoBoardingExitDelay,
      vtxoBoardingExitDelayUnit: status.vtxoBoardingExitDelayUnit,
      recipientDustSats: 330,
      txRecipientCapSats: status.txCap,
      periodAllowanceSats: status.periodAllowance,
      absoluteFeeCapSats: status.absoluteFeeCap,
      feerateCapSatVb: status.feerateCapSatVb,
      envelopeNonce: body.envelopeNonce,
      envelopeCiphertext: body.envelopeCiphertext,
    })
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const body = request.method() === 'POST' ? ((await request.postDataJSON()) as Record<string, string>) : undefined

    if (path === '/v1/status' && request.method() === 'GET') {
      const requestedVault = url.searchParams.get('vault')
      return json(route, requestedVault ? this.status(requestedVault) : publicStatus())
    }
    if (path === '/v1/enroll/start') {
      return json(route, {
        handle: 'e2e-enrollment-handle',
        vaultId: VAULT_ID,
        challenge: '01'.repeat(32),
        rpId: RP_ID,
        userId: bytesToHex(new TextEncoder().encode(VAULT_ID)),
        userName: 'vault-e2e',
      })
    }
    if (path === '/v1/enroll/propose' && body) {
      this.proposed = body
      this.descriptor = buildVaultProgramDescriptor({
        vaultId: VAULT_ID,
        network: 'mutinynet',
        phonePub: body.phoneBip340Pub,
        hardwarePub: PROGRAM_FIXTURE.hardwarePub,
        phoneDirectP256: body.phoneDirectP256,
        vaultCosignerBase: PROGRAM_FIXTURE.vaultCosignerBase,
        arkadeCosignerBase: PROGRAM_FIXTURE.arkadeCosignerBase,
        arkadeCosigner: PROGRAM_FIXTURE.arkadeCosigner,
      })
      return json(route, {
        vaultId: VAULT_ID,
        descriptorHash: hashVaultProgramDescriptor(this.descriptor),
        descriptor: this.descriptor,
      })
    }
    if (path === '/v1/enroll/finish') {
      this.enrolled = true
      return json(route, {})
    }
    if (path === '/v1/passkey/challenge') {
      this.challengeCounter += 1
      return json(route, {
        challengeId: `challenge-${this.challengeCounter}`,
        challenge: this.challengeCounter.toString(16).padStart(2, '0').repeat(32),
        ...(body?.vaultId === VAULT_ID && this.proposed?.credentialId
          ? { allowCredentialId: this.proposed.credentialId }
          : {}),
      })
    }
    if (path === '/v1/passkey/binding' && body) {
      const binding = this.recoveryBinding({
        envelopeNonce: body.envelopeNonce,
        envelopeCiphertext: body.envelopeCiphertext,
      })
      return json(route, { binding, bindingDigest: bytesToHex(recoveryBindingDigest(binding)) })
    }
    if (path === '/v1/passkey/install' && body) {
      const binding = body.binding
      this.install = {
        binding,
        bindingDigest: bytesToHex(recoveryBindingDigest(binding)),
        envelopeNonce: body.envelopeNonce,
        envelopeCiphertext: body.envelopeCiphertext,
        bindingDirectSig: body.bindingDirectSig,
        bindingPhoneSig: body.bindingPhoneSig,
      }
      this.passkeyLoginAvailable = true
      return json(route, {})
    }
    if (path === '/v1/passkey/recover') {
      this.recoverSeen?.resolve()
      if (this.recoverGate) await this.recoverGate.promise
      if (!this.install) return json(route, { error: 'passkey sign-in has not been enabled' }, 409)
      if (this.wrongRecovery) {
        this.wrongRecovery = false
        const binding = JSON.stringify({ ...JSON.parse(this.install.binding), credentialId: 'ff'.repeat(32) })
        return json(route, {
          ...this.install,
          binding,
          bindingDigest: bytesToHex(recoveryBindingDigest(binding)),
        })
      }
      return json(route, this.install)
    }
    if (path === '/v1/map') return json(route, { error: 'not found' }, 404)
    return json(route, { error: 'not found' }, 404)
  }
}

async function addAuthenticator(cdp: CDPSession, presence: boolean): Promise<string> {
  const options: AuthenticatorOptions = {
    protocol: 'ctap2',
    ctap2Version: 'ctap2_1',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    hasPrf: true,
    isUserVerified: true,
    automaticPresenceSimulation: presence,
  }
  const result = await cdp.send('WebAuthn.addVirtualAuthenticator', { options })
  return result.authenticatorId
}

async function installSecretAudit(context: BrowserContext) {
  await context.addInitScript(() => {
    type Audit = SecretAuditSnapshot
    const audit: Audit = {
      generated32: [],
      hkdfInputs: [],
      hkdfOutputs: [],
      serviceWorkerMessages: [],
    }
    Object.defineProperty(globalThis, '__vaultSecretAudit', { value: audit, configurable: false })
    const toHex = (value: BufferSource) => {
      const bytes = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    const random = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = ((array: ArrayBufferView | null) => {
      const result = random(array)
      if (result?.byteLength === 32) audit.generated32.push(toHex(result as ArrayBufferView<ArrayBuffer>))
      return result
    }) as Crypto['getRandomValues']
    const importKey = crypto.subtle.importKey.bind(crypto.subtle)
    crypto.subtle.importKey = (async (...args: Parameters<SubtleCrypto['importKey']>) => {
      const algorithm = args[2]
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (name === 'HKDF' && !(args[1] instanceof CryptoKey)) audit.hkdfInputs.push(toHex(args[1] as BufferSource))
      return importKey(...args)
    }) as SubtleCrypto['importKey']
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle)
    crypto.subtle.deriveBits = (async (...args: Parameters<SubtleCrypto['deriveBits']>) => {
      const result = await deriveBits(...args)
      const algorithm = args[0]
      if ((typeof algorithm === 'string' ? algorithm : algorithm.name) === 'HKDF') {
        audit.hkdfOutputs.push(toHex(result))
      }
      return result
    }) as SubtleCrypto['deriveBits']
    const originalPostMessage = ServiceWorker.prototype.postMessage
    ServiceWorker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      try {
        audit.serviceWorkerMessages.push(structuredClone(message))
      } catch {
        audit.serviceWorkerMessages.push(String(message))
      }
      return originalPostMessage.call(this, message, options as never)
    }
  })
}

async function persistentBrowserState(page: Page) {
  return page.evaluate(async () => {
    const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const serializable = (value: unknown, seen = new WeakSet<object>()): unknown => {
      if (value instanceof ArrayBuffer) return bytesToHex(new Uint8Array(value))
      if (ArrayBuffer.isView(value)) {
        return bytesToHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      }
      if (Array.isArray(value)) return value.map((item) => serializable(item, seen))
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[circular]'
        seen.add(value)
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item, seen)]))
      }
      return value
    }
    const databases: Record<string, unknown> = {}
    if (indexedDB.databases) {
      for (const database of await indexedDB.databases()) {
        if (!database.name) continue
        const name = database.name
        databases[name] = await new Promise<Record<string, unknown[]>>((resolve) => {
          const request = indexedDB.open(name)
          request.onerror = () => resolve({})
          request.onsuccess = () => {
            const db = request.result
            const stores: Record<string, unknown[]> = {}
            const names = Array.from(db.objectStoreNames)
            if (!names.length) {
              db.close()
              resolve(stores)
              return
            }
            const transaction = db.transaction(names, 'readonly')
            for (const storeName of names) {
              const getAll = transaction.objectStore(storeName).getAll()
              getAll.onsuccess = () => {
                stores[storeName] = getAll.result.map((value) => serializable(value))
              }
            }
            transaction.oncomplete = () => {
              db.close()
              resolve(stores)
            }
            transaction.onerror = () => {
              db.close()
              resolve(stores)
            }
          }
        })
      }
    }
    const cacheState: Record<string, unknown[]> = {}
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name)
      cacheState[name] = await Promise.all(
        (await cache.keys()).map(async (request) => {
          const response = await cache.match(request)
          return {
            url: request.url,
            body: response ? bytesToHex(new Uint8Array(await response.arrayBuffer())) : '',
          }
        }),
      )
    }
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      databases,
      caches: cacheState,
    }
  })
}

export const test = base.extend<Fixtures>({
  secretAudit: async ({ context }, use) => {
    await installSecretAudit(context)
    await use({
      snapshot: (page) =>
        page.evaluate(
          () => (globalThis as typeof globalThis & { __vaultSecretAudit: SecretAuditSnapshot }).__vaultSecretAudit,
        ),
      assertNoSecretsPersisted: async (page) => {
        const audit = await page.evaluate(
          () => (globalThis as typeof globalThis & { __vaultSecretAudit: SecretAuditSnapshot }).__vaultSecretAudit,
        )
        const persistent = JSON.stringify(await persistentBrowserState(page)).toLowerCase()
        const messages = JSON.stringify(audit.serviceWorkerMessages).toLowerCase()
        const secrets = [...audit.generated32, ...audit.hkdfInputs, ...audit.hkdfOutputs].filter(
          (secret) => secret.length === 64 && !/^0+$/.test(secret),
        )
        expect(secrets.length).toBeGreaterThan(0)
        for (const secret of new Set(secrets)) {
          expect(persistent).not.toContain(secret.toLowerCase())
          expect(messages).not.toContain(secret.toLowerCase())
        }
        expect(messages).not.toMatch(/phone.?secret|phone.?scalar|private.?key|prf.?secret|session.?scalar/)
      },
    })
  },
  passkey: async ({ context, page }, use) => {
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    const authenticatorId = await addAuthenticator(cdp, true)
    const api: VirtualPasskey = {
      abortNextRequest: () =>
        page.evaluate(() => {
          const container = navigator.credentials
          const original = container.get.bind(container)
          Object.defineProperty(container, 'get', {
            configurable: true,
            value: async (...args: Parameters<CredentialsContainer['get']>) => {
              Object.defineProperty(container, 'get', { configurable: true, value: original })
              void args
              throw new DOMException('The operation was aborted.', 'AbortError')
            },
          })
        }),
      credentials: async () => {
        const result = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
        return result.credentials as CDPCredential[]
      },
      setPresence: async (enabled) => {
        await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
          authenticatorId,
          enabled,
        })
      },
    }
    await use(api)
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => undefined)
    await cdp.detach()
  },
  authorizer: async ({ page }, use) => {
    const service = new FakeAuthorizer(page)
    await service.installRoutes()
    await use(service)
  },
})

export async function reachPasskeySetup(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Spending and Savings, together')).toBeVisible()
  await page.getByRole('button', { name: 'Set up a new vault' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('hardware-pub').fill(PROGRAM_FIXTURE.hardwarePub)
  await page.getByRole('button', { name: 'Use this hardware key' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'Review setup' }).click()
  await page.getByRole('button', { name: 'Secure this device' }).click()
  await expect(page.getByTestId('enrollment-token')).toBeVisible()
}

export async function enrollVaultWithPasskey(page: Page, authorizer: FakePasskeyAuthorizer) {
  await reachPasskeySetup(page)
  await page.getByTestId('enrollment-token').fill(authorizer.invite)
  await page.getByRole('button', { name: 'Secure this device' }).click()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
}

export { expect }
