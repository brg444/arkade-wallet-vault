import { readFileSync } from 'node:fs'
import { parseKitCli, parseRecoveryKit, runKitCliAsync } from '../src/lib/vault/v5/kitCli'

function loadKit(path: string) {
  return parseRecoveryKit(JSON.parse(readFileSync(path, 'utf8')))
}

try {
  const hexOrPath = process.argv[3]
  const argv = [...process.argv.slice(2)]
  if (argv[0] === 'verify' && hexOrPath && !/^[0-9a-fA-F]+$/.test(hexOrPath.replace(/\s+/g, ''))) {
    argv[1] = readFileSync(hexOrPath, 'utf8').trim()
  }
  process.stdout.write(`${await runKitCliAsync(parseKitCli(argv, loadKit))}\n`)
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
