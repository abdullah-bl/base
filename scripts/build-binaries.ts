#!/usr/bin/env bun
/**
 * Cross-compile Base CLI for common targets.
 */
export {}

const targets = [
  { target: 'bun-linux-x64', outfile: 'dist/base-linux-x64' },
  { target: 'bun-linux-arm64', outfile: 'dist/base-linux-arm64' },
  { target: 'bun-darwin-arm64', outfile: 'dist/base-darwin-arm64' },
  { target: 'bun-windows-x64', outfile: 'dist/base-windows-x64.exe' },
] as const

for (const t of targets) {
  console.log(`Building ${t.outfile} (${t.target})...`)
  const proc = Bun.spawn(
    [
      'bun',
      'build',
      '--compile',
      '--minify',
      `--target=${t.target}`,
      'src/cli/index.ts',
      `--outfile=${t.outfile}`,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const code = await proc.exited
  if (code !== 0) {
    console.error(`Failed building ${t.outfile}`)
    process.exit(code)
  }
}

console.log('✅ All binaries built in dist/')
