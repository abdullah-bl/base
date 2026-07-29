import { connect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { EffectiveRuntime } from '../settings/resolve.js'

export interface AuthEmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSendResult {
  ok: boolean
  error?: string
  preview?: AuthEmailMessage
}

/** In-memory capture for tests / when email disabled */
const outbox: AuthEmailMessage[] = []

export function getEmailOutbox(): AuthEmailMessage[] {
  return [...outbox]
}

export function clearEmailOutbox(): void {
  outbox.length = 0
}

export function renderVerificationEmail(opts: {
  user: { email: string; name?: string | null }
  url: string
  brandName: string
  brandColor: string
}): AuthEmailMessage {
  const name = opts.user.name || opts.user.email
  const subject = `Verify your email — ${opts.brandName}`
  const text = `Hi ${name},\n\nVerify your email for ${opts.brandName}:\n${opts.url}\n\nIf you did not sign up, ignore this message.`
  const html = baseLayout({
    brandName: opts.brandName,
    brandColor: opts.brandColor,
    title: 'Verify your email',
    body: `<p>Hi ${escapeHtml(name)},</p>
      <p>Confirm your email address to activate your ${escapeHtml(opts.brandName)} account.</p>
      <p style="margin:24px 0"><a href="${escapeAttr(opts.url)}" style="background:${escapeAttr(opts.brandColor)};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Verify email</a></p>
      <p style="color:#64748b;font-size:13px">Or open this link:<br/>${escapeHtml(opts.url)}</p>`,
  })
  return { to: opts.user.email, subject, html, text }
}

export function renderResetPasswordEmail(opts: {
  user: { email: string; name?: string | null }
  url: string
  brandName: string
  brandColor: string
}): AuthEmailMessage {
  const name = opts.user.name || opts.user.email
  const subject = `Reset your password — ${opts.brandName}`
  const text = `Hi ${name},\n\nReset your password for ${opts.brandName}:\n${opts.url}\n\nIf you did not request this, ignore this message.`
  const html = baseLayout({
    brandName: opts.brandName,
    brandColor: opts.brandColor,
    title: 'Reset your password',
    body: `<p>Hi ${escapeHtml(name)},</p>
      <p>We received a request to reset your ${escapeHtml(opts.brandName)} password.</p>
      <p style="margin:24px 0"><a href="${escapeAttr(opts.url)}" style="background:${escapeAttr(opts.brandColor)};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Reset password</a></p>
      <p style="color:#64748b;font-size:13px">Or open this link:<br/>${escapeHtml(opts.url)}</p>`,
  })
  return { to: opts.user.email, subject, html, text }
}

function baseLayout(opts: {
  brandName: string
  brandColor: string
  title: string
  body: string
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${escapeAttr(opts.brandColor)}">${escapeHtml(opts.brandName)}</div>
    <div style="padding:24px">${opts.body}</div>
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

export async function sendAuthEmail(
  runtime: EffectiveRuntime,
  message: AuthEmailMessage,
): Promise<EmailSendResult> {
  outbox.push(message)

  if (!runtime.email.enabled) {
    console.info(
      `[email:dev] To=${message.to} Subject=${message.subject} (email disabled — captured in outbox)`,
    )
    return { ok: true, preview: message }
  }

  if (!runtime.email.host) {
    return { ok: false, error: 'SMTP host not configured', preview: message }
  }

  try {
    await sendSmtp(runtime, message)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      preview: message,
    }
  }
}

async function sendSmtp(
  runtime: EffectiveRuntime,
  message: AuthEmailMessage,
): Promise<void> {
  const host = runtime.email.host
  const port = runtime.email.port
  const secure = runtime.email.secure
  const user = runtime.email.user
  const pass = runtime.email.password
  const from = runtime.email.from
  const replyTo = runtime.email.replyTo

  const socket = await openSocket(host, port, secure)
  const read = createReader(socket)

  const greet = await read()
  if (!greet.startsWith('220')) throw new Error(`SMTP greet failed: ${greet}`)

  await writeExpect(socket, read, `EHLO localhost\r\n`, '250')

  if (user) {
    await writeExpect(socket, read, `AUTH LOGIN\r\n`, '334')
    await writeExpect(
      socket,
      read,
      `${Buffer.from(user).toString('base64')}\r\n`,
      '334',
    )
    await writeExpect(
      socket,
      read,
      `${Buffer.from(pass).toString('base64')}\r\n`,
      '235',
    )
  }

  await writeExpect(socket, read, `MAIL FROM:<${from}>\r\n`, '250')
  await writeExpect(socket, read, `RCPT TO:<${message.to}>\r\n`, '250')
  await writeExpect(socket, read, `DATA\r\n`, '354')

  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="base-boundary"',
    '',
    '--base-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text,
    '',
    '--base-boundary',
    'Content-Type: text/html; charset=utf-8',
    '',
    message.html,
    '',
    '--base-boundary--',
    '.',
  ]
    .filter((l) => l !== undefined)
    .join('\r\n')

  await writeExpect(socket, read, `${headers}\r\n`, '250')
  await writeExpect(socket, read, `QUIT\r\n`, '221')
  socket.end()
}

function openSocket(
  host: string,
  port: number,
  secure: boolean,
): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const sock = secure
      ? tlsConnect({ host, port, servername: host }, () => resolve(sock))
      : connect({ host, port }, () => resolve(sock))
    sock.setEncoding('utf8')
    sock.on('error', reject)
  })
}

function createReader(socket: import('node:net').Socket) {
  let buffer = ''
  const queue: Array<(s: string) => void> = []

  socket.on('data', (chunk) => {
    buffer += String(chunk)
    if (buffer.includes('\n')) {
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      // SMTP multi-line: wait until last line of response
      const joined = lines.join('\n')
      if (queue.length) {
        const cb = queue.shift()!
        cb(joined)
      }
    }
  })

  return () =>
    new Promise<string>((resolve) => {
      queue.push(resolve)
    })
}

async function writeExpect(
  socket: import('node:net').Socket,
  read: () => Promise<string>,
  data: string,
  expectCode: string,
): Promise<string> {
  socket.write(data)
  const resp = await read()
  if (!resp.includes(expectCode)) {
    throw new Error(`SMTP expected ${expectCode}, got: ${resp}`)
  }
  return resp
}
