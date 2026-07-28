import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'

describe('CLI smoke', () => {
  test('version prints 0.1.0', async () => {
    const proc = Bun.spawn(
      ['bun', 'run', 'src/cli/index.ts', 'version'],
      {
        cwd: join(import.meta.dir, '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    expect(code).toBe(0)
    expect(out.trim()).toBe('0.1.0')
  })

  test('help exits non-zero without command match but prints usage for --help', async () => {
    const proc = Bun.spawn(
      ['bun', 'run', 'src/cli/index.ts', '--help'],
      {
        cwd: join(import.meta.dir, '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    expect(code).toBe(0)
    expect(out).toContain('Base CLI')
    expect(out).toContain('schema status')
  })
})
