const { execSync } = require('child_process')

let commitHash = 'unknown'
try {
  commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().substring(0, 8)
  try {
    execSync('git diff-index --quiet HEAD --')
  } catch {
    commitHash = `${commitHash}-dirty`
  }
} catch (error) {
  console.warn('Git commit is unknown:', error.message)
}

process.env.VITE_GIT_COMMIT = commitHash
console.log(`VITE_GIT_COMMIT=${commitHash}`)
