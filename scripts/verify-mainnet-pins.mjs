const expectedOperator = {
  network: 'bitcoin',
  signerPubkey: '038202bebddeb1f7442803897a85eaf3ce9254d07df0172fc3725ab5f0d097779c',
  forfeitPubkey: '03b43a8363118c084a04d4f6a50ebfa58e81957f8cceceb2aee0ab64c9fd2d9977',
  checkpointTapscript: '039e0440b27520b43a8363118c084a04d4f6a50ebfa58e81957f8cceceb2aee0ab64c9fd2d9977ac',
  unilateralExitDelay: '605184',
  boardingExitDelay: '7776256',
}
const expectedEmulator = {
  version: 'v0.0.7',
  signerPubkey: '0239c196415da47b26456a101daaa12ba9e445bfe153197f1e2b750bf40e52092e',
}

async function requireJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

function verify(label, actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (String(actual[key] ?? '') !== value) throw new Error(`${label} ${key} no longer matches the release pin`)
  }
}

const [operator, emulator] = await Promise.all([
  requireJson('https://arkade.computer/v1/info'),
  requireJson('https://mainnet-signer.invalid/v1/info'),
])
verify('Operator', operator, expectedOperator)
verify('Emulator', emulator, expectedEmulator)
console.log(`mainnet pins verified against Operator ${operator.version} and Emulator ${emulator.version}`)
