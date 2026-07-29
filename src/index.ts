import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { bootstrap } from './server/bootstrap.js'

async function main() {
  // Optional legacy seed — DB-backed schema is source of truth after first import
  const collectionsPath = resolve(process.cwd(), 'collections.ts')
  if (existsSync(collectionsPath)) {
    await import('../collections.js')
  }
  await bootstrap({ serve: true })
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})
