/** Wallet hosts allowed to call the mainnet gateway. Keep in sync with productionDomains. */
export const MAINNET_WALLET_HOSTS = ['app.getvaulted.xyz', 'rc.getvaulted.xyz'] as const

export function isMainnetWalletHost(value: unknown): boolean {
  const host = String(value || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0]
  return (MAINNET_WALLET_HOSTS as readonly string[]).includes(host)
}
