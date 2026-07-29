import type { EffectiveRuntime } from '../settings/resolve.js'

export type OAuthProviderId =
  | 'github'
  | 'google'
  | 'discord'
  | 'microsoft'
  | 'apple'

export interface OAuthProviderPublic {
  id: OAuthProviderId
  name: string
  enabled: boolean
  configured: boolean
  callbackPath: string
}

const PROVIDER_META: Record<
  OAuthProviderId,
  { name: string }
> = {
  github: { name: 'GitHub' },
  google: { name: 'Google' },
  discord: { name: 'Discord' },
  microsoft: { name: 'Microsoft' },
  apple: { name: 'Apple' },
}

export function buildSocialProviders(
  runtime: EffectiveRuntime,
): Record<string, { clientId: string; clientSecret: string }> | undefined {
  const out: Record<string, { clientId: string; clientSecret: string }> = {}

  for (const id of Object.keys(PROVIDER_META) as OAuthProviderId[]) {
    const cfg = runtime.oauth[id]
    if (
      cfg.enabled &&
      cfg.clientId &&
      cfg.clientSecret
    ) {
      out[id] = {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

export function listOAuthProvidersPublic(
  runtime: EffectiveRuntime,
  publicUrl: string,
): OAuthProviderPublic[] {
  const base = publicUrl.replace(/\/$/, '')
  return (Object.keys(PROVIDER_META) as OAuthProviderId[]).map((id) => {
    const cfg = runtime.oauth[id]
    const configured = Boolean(cfg.clientId && cfg.clientSecret)
    return {
      id,
      name: PROVIDER_META[id].name,
      enabled: Boolean(cfg.enabled && configured),
      configured,
      callbackPath: `${base}/api/auth/callback/${id}`,
    }
  })
}
