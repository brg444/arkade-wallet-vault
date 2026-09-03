const [canonicalUrl, deploymentTarget] = process.argv.slice(2)

if (!canonicalUrl || !deploymentTarget) {
  throw new Error('usage: pnpm verify:deployment <canonical-url> <deployment-url-or-index-asset>')
}

async function indexAsset(origin) {
  const response = await fetch(new URL(`/index.html?verify=${Date.now()}`, origin), {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
  })
  if (!response.ok) throw new Error(`${origin} returned ${response.status}`)
  const match = (await response.text()).match(/index-[A-Za-z0-9_-]+\.js/)
  if (!match) throw new Error(`${origin} has no versioned index bundle`)
  return match[0]
}

const canonicalAsset = await indexAsset(canonicalUrl)
const deploymentAsset = /^index-[A-Za-z0-9_-]+\.js$/.test(deploymentTarget)
  ? deploymentTarget
  : await indexAsset(deploymentTarget)

if (canonicalAsset !== deploymentAsset) {
  throw new Error(`canonical alias is stale: ${canonicalAsset} != ${deploymentAsset}`)
}

console.log(`verified ${canonicalAsset}`)
