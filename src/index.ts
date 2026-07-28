import { bootstrap } from './server/bootstrap.js'

async function main() {
  // Import collections FIRST — registers them before the Hono app loads
  await import('../collections.js')
  await bootstrap({ serve: true })
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})
