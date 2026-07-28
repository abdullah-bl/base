import { existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { Hono } from 'hono'
import env from '../env.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/**
 * Mount the admin SPA at ADMIN_PATH (default `/_`).
 * Serves built assets from src/admin/dist when present; otherwise a placeholder.
 *
 * For compiled binaries, prefer importing assets with `with { type: "file" }`
 * after a production build (see embedAdminAssets).
 */
export function mountAdminUi(app: Hono): void {
  if (!env.ADMIN_ENABLED) return

  const basePath = env.ADMIN_PATH.replace(/\/$/, '') || '/_'
  const distDir = join(import.meta.dir, 'dist')

  app.get(basePath, (c) => c.redirect(`${basePath}/`))
  app.get(`${basePath}/`, (c) => serveIndex(c, distDir, basePath))
  app.get(`${basePath}/*`, async (c) => {
    const url = new URL(c.req.url)
    let rel = url.pathname.slice(basePath.length)
    if (rel.startsWith('/')) rel = rel.slice(1)
    if (!rel || rel.endsWith('/')) {
      return serveIndex(c, distDir, basePath)
    }

    // Path traversal guard
    if (rel.includes('..') || rel.includes('\\')) {
      return c.text('Forbidden', 403)
    }

    const filePath = join(distDir, rel)
    if (existsSync(filePath)) {
      const ext = extname(filePath)
      const mime = MIME[ext] || 'application/octet-stream'
      const body = readFileSync(filePath)
      const immutable = ext !== '.html'
      return c.body(body, 200, {
        'Content-Type': mime,
        'Cache-Control': immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      })
    }

    // SPA fallback
    return serveIndex(c, distDir, basePath)
  })
}

function serveIndex(c: any, distDir: string, basePath: string) {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) {
    return c.html(
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Base Admin</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e8eaed; display: grid; place-items: center; min-height: 100vh; }
    main { max-width: 36rem; padding: 2rem; }
    code { background: #1c2128; padding: 0.15rem 0.4rem; border-radius: 4px; }
    a { color: #8ab4f8; }
  </style>
</head>
<body>
  <main>
    <h1>Base Admin</h1>
    <p>Admin UI assets are not built yet.</p>
    <p>Run <code>bun run build:admin</code>, then restart the server.</p>
    <p>API is available at <a href="/api/health"><code>/api/health</code></a>. Admin API at <code>/api/admin</code>.</p>
    <p>UI path: <code>${basePath}/</code></p>
  </main>
</body>
</html>`,
      200,
    )
  }
  const html = readFileSync(indexPath, 'utf8')
  return c.html(html, 200)
}
