import { serve } from '@hono/node-server'
import env from './env.js'

// Import collections FIRST — this registers them before the Hono app loads
import '../collections.js'

// Now import the app (it reads registered collections on load)
import app from './server/hono-app.js'
import { autoMigrate } from './db/migrate.js'

const PORT = env.PORT

async function main() {
  // Run migrations before starting server
  await autoMigrate()

  const server = serve({
    fetch: app.fetch,
    port: PORT,
  })

  console.log('🚀 Base BaaS Server started')
  console.log(`   Port: ${PORT}`)
  console.log(`   Database: ${env.DATABASE_URL}`)
  console.log(`   Version: 0.1.0`)
  console.log('')
  console.log(`Health check: http://localhost:${PORT}/api/health`)
  console.log(`Auth: http://localhost:${PORT}/api/auth/sign-up/email`)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`)
    server.close((err: unknown) => {
      if (err) {
        console.error('❌ Error closing server:', err)
        process.exit(1)
      }
      console.log('✅ Server closed successfully')
      process.exit(0)
    })

    setTimeout(() => {
      console.error('❌ Forced shutdown after timeout')
      process.exit(1)
    }, 10000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})
