import { spawn, type ChildProcess } from 'node:child_process'
import { RESTART_EXIT_CODE } from './restart.js'

/**
 * Process supervisor: keeps a worker alive and restarts it when the worker
 * exits with RESTART_EXIT_CODE (requested from Admin UI).
 *
 * Usage: BASE_ROLE=supervisor bun run src/cli/index.ts serve
 * Or: base serve (CLI detects and supervises by default)
 */
export async function runSupervisor(opts: {
  workerArgs: string[]
  execPath?: string
  cwd?: string
}): Promise<never> {
  const execPath = opts.execPath || process.execPath
  let child: ChildProcess | null = null
  let shuttingDown = false
  let restarts = 0

  const boot = () => {
    const env = {
      ...process.env,
      BASE_SUPERVISED: '1',
      BASE_ROLE: 'worker',
    }
    child = spawn(execPath, opts.workerArgs, {
      cwd: opts.cwd || process.cwd(),
      env,
      stdio: 'inherit',
    })

    child.on('exit', (code, signal) => {
      if (shuttingDown) {
        process.exit(code ?? 0)
        return
      }

      if (code === RESTART_EXIT_CODE) {
        restarts += 1
        console.log(
          `\n🔄 Supervisor: worker requested restart (count=${restarts}). Relaunching…\n`,
        )
        setTimeout(boot, 250)
        return
      }

      if (signal) {
        console.error(`Supervisor: worker killed by ${signal}`)
        process.exit(1)
      }

      console.error(`Supervisor: worker exited with code ${code}`)
      process.exit(code ?? 1)
    })
  }

  const shutdown = (signal: string) => {
    shuttingDown = true
    console.log(`\n📴 Supervisor received ${signal}, stopping worker…`)
    if (child && !child.killed) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL')
        process.exit(0)
      }, 5000)
    } else {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  boot()

  // Keep supervisor event loop alive
  await new Promise(() => {})
  return undefined as never
}
