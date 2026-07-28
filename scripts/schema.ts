#!/usr/bin/env bun
/**
 * Schema evolution CLI
 *
 *   bun run schema:status   — dry-run plan
 *   bun run schema:apply    — apply additive migrations
 */
import { initDb } from '../src/db/client.js'
import { autoMigrate } from '../src/db/migrate.js'
import { applyEvolution, formatPlan } from '../src/schema/evolve.js'
import { getRegisteredCollections } from '../src/schema/registry.js'

// Register user collections
import '../collections.js'

const cmd = process.argv[2] || 'status'

async function main() {
  await initDb()
  await autoMigrate()

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )

  if (cmd === 'status' || cmd === 'dry-run') {
    const plan = await applyEvolution(collections, { dryRun: true })
    console.log(formatPlan(plan))
    if (plan.blocked.length > 0) {
      process.exitCode = 1
    }
    return
  }

  if (cmd === 'apply') {
    console.log(
      '⚠️  Ensure you have a backup (Litestream / file copy) before applying.',
    )
    const plan = await applyEvolution(collections, { dryRun: false })
    console.log(formatPlan(plan))
    console.log('✅ Schema evolution applied')
    return
  }

  console.error(`Unknown command: ${cmd}`)
  console.error('Usage: bun run scripts/schema.ts [status|apply]')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
