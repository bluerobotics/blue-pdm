#!/usr/bin/env node
/**
 * Release script - creates a git tag from package.json version and pushes it
 * Usage: npm run release
 */

const { execSync } = require('child_process')
const pkg = require('../package.json')

const version = `v${pkg.version}`

console.log(`\n🚀 Creating release ${version}\n`)

try {
  // Commit any pending changes
  try {
    execSync(`git add -A && git commit -m "chore: Release ${version}"`, { stdio: 'inherit' })
  } catch {
    console.log('No changes to commit')
  }

  // Delete existing tag if it exists (local and remote)
  try {
    execSync(`git tag -d ${version}`, { stdio: 'pipe' })
    console.log(`Deleted existing local tag ${version}`)
  } catch {
    // Tag didn't exist locally
  }

  try {
    execSync(`git push origin :refs/tags/${version}`, { stdio: 'pipe' })
    console.log(`Deleted existing remote tag ${version}`)
  } catch {
    // Tag didn't exist remotely
  }

  // Create new tag
  execSync(`git tag ${version}`, { stdio: 'inherit' })
  console.log(`Created tag ${version}`)

  // Push everything
  execSync('git push origin main', { stdio: 'inherit' })
  execSync(`git push origin ${version}`, { stdio: 'inherit' })

  console.log(`\n✅ Released ${version}`)
  console.log(`\nGitHub Actions will now build and create the release.`)
  console.log(`Watch progress at: https://github.com/bluerobotics/bluePDM/actions\n`)

} catch (error) {
  console.error('\n❌ Release failed:', error.message)
  process.exit(1)
}

