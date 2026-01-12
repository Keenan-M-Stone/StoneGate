import React from 'react'

type UpdateAsset = {
  name: string
  url: string
}

type UpdateInfo = {
  latestVersion?: string
  publishedAt?: string
  releaseUrl?: string
  downloadUrl?: string
  notesUrl?: string
  assets?: UpdateAsset[]
}

function openUrl(url: string, newTab: boolean) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return

  if (newTab) {
    const win = window.open(trimmed, '_blank', 'noopener,noreferrer')
    if (win) return
  }

  window.location.assign(trimmed)
}

function parseUpdateInfo(input: any): UpdateInfo {
  if (!input || typeof input !== 'object') return {}

  // GitHub releases API shape
  if (typeof input.tag_name === 'string') {
    const assets: UpdateAsset[] = Array.isArray(input.assets)
      ? input.assets
          .map((a: any) => {
            const name = typeof a?.name === 'string' ? a.name : ''
            const url = typeof a?.browser_download_url === 'string' ? a.browser_download_url : ''
            if (!name || !url) return null
            return { name, url }
          })
          .filter(Boolean)
      : []

    return {
      latestVersion: input.tag_name,
      publishedAt: typeof input.published_at === 'string' ? input.published_at : undefined,
      releaseUrl: typeof input.html_url === 'string' ? input.html_url : undefined,
      notesUrl: typeof input.html_url === 'string' ? input.html_url : undefined,
      assets,
      downloadUrl: assets.length > 0 ? assets[0].url : undefined,
    }
  }

  // Existing/legacy manifest shape
  const info: UpdateInfo = {}
  if (typeof input.latestVersion === 'string') info.latestVersion = input.latestVersion
  if (typeof input.version === 'string' && !info.latestVersion) info.latestVersion = input.version
  if (typeof input.publishedAt === 'string') info.publishedAt = input.publishedAt
  if (typeof input.downloadUrl === 'string') info.downloadUrl = input.downloadUrl
  if (typeof input.notesUrl === 'string') info.notesUrl = input.notesUrl
  if (typeof input.releaseUrl === 'string') info.releaseUrl = input.releaseUrl
  if (Array.isArray(input.assets)) {
    info.assets = input.assets
      .map((a: any) => {
        const name = typeof a?.name === 'string' ? a.name : ''
        const url = typeof a?.url === 'string' ? a.url : ''
        if (!name || !url) return null
        return { name, url }
      })
      .filter(Boolean)
  }
  return info
}

export default function AppHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const docsUrl = `${import.meta.env.BASE_URL}docs/index.html`

  const githubLatestReleaseUrl = 'https://api.github.com/repos/Keenan-M-Stone/StoneGate/releases/latest'
  const updateUrlStorageKey = 'stonegate.help.updateUrl'

  const cfg = (() => {
    try {
      return (globalThis as any).__STONEGATE_CONFIG__ || {}
    } catch {
      return {}
    }
  })()

  const defaultManifestUrl = typeof cfg.update_manifest_url === 'string' ? cfg.update_manifest_url : ''

  const initialManifestUrl = (() => {
    try {
      const stored = globalThis.localStorage?.getItem(updateUrlStorageKey)
      if (typeof stored === 'string' && stored.trim()) return stored.trim()
    } catch {
      // ignore
    }

    const cfgUrl = String(defaultManifestUrl || '').trim()
    if (cfgUrl) return cfgUrl
    return githubLatestReleaseUrl
  })()

  const [manifestUrl, setManifestUrl] = React.useState<string>(initialManifestUrl)
  const [updateState, setUpdateState] = React.useState<{ loading: boolean; error: string; latest: UpdateInfo | null; sourceUrl: string }>({
    loading: false,
    error: '',
    latest: null,
    sourceUrl: '',
  })

  React.useEffect(() => {
    try {
      const trimmed = String(manifestUrl || '').trim()
      if (!trimmed) {
        globalThis.localStorage?.removeItem(updateUrlStorageKey)
        return
      }
      globalThis.localStorage?.setItem(updateUrlStorageKey, trimmed)
    } catch {
      // ignore
    }
  }, [manifestUrl])

  const latest = updateState.latest

  if (!open) return null

  async function checkForUpdates() {
    const url = String(manifestUrl || '').trim() || githubLatestReleaseUrl

    setUpdateState({ loading: true, error: '', latest: null, sourceUrl: url })
    try {
      const resp = await fetch(url, { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      setUpdateState({ loading: false, error: '', latest: parseUpdateInfo(json), sourceUrl: url })
    } catch (e: any) {
      setUpdateState({ loading: false, error: String(e?.message || e), latest: null, sourceUrl: url })
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 260,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 70,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(860px, 94vw)',
          maxHeight: '84vh',
          overflow: 'auto',
          background: '#071827',
          color: '#e6eef8',
          borderRadius: 10,
          padding: 12,
          border: '1px solid rgba(255,255,255,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Help</h3>
            <div style={{ opacity: 0.8, fontSize: 12 }}>StoneGate frontend build info + quick pointers</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Build</h4>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12, opacity: 0.95 }}>
            <div>version: {__STONEGATE_FE_VERSION__}</div>
            <div>commit: {__STONEGATE_FE_COMMIT__}</div>
            <div>built: {__STONEGATE_FE_BUILD_TIME__}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Documentation</h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => openUrl(docsUrl, true)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(180,220,255,0.18)', background: '#0b2436', color: 'inherit' }}
            >
              Open docs…
            </button>
            <button
              onClick={() => openUrl(`${docsUrl}#Troubleshooting.md`, true)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(180,220,255,0.18)', background: '#0b2436', color: 'inherit' }}
            >
              Troubleshooting & errors…
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.82 }}>
            Troubleshooting contains quick cause → action notes for common UI error codes.
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Updates</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12, opacity: 0.9 }}>
              Update URL (optional):{' '}
              <input
                type="text"
                value={manifestUrl}
                onChange={(e) => setManifestUrl((e.target as HTMLInputElement).value)}
                placeholder={githubLatestReleaseUrl}
                style={{ width: 420, maxWidth: '80vw', marginLeft: 6 }}
              />
            </label>
            <button
              onClick={() => setManifestUrl(githubLatestReleaseUrl)}
              title="Reset the update URL to the default GitHub Releases endpoint"
            >
              Reset to GitHub
            </button>
            <button onClick={checkForUpdates} disabled={updateState.loading}>
              {updateState.loading ? 'Checking…' : 'Check for updates'}
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            If the URL is blank, StoneGate checks GitHub Releases for Keenan-M-Stone/StoneGate.
          </div>

          {updateState.error && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#ffb4b4' }}>
              {updateState.error}
            </div>
          )}

          {latest && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
              <div>latest: {String(latest.latestVersion || '(unknown)')}</div>
              {latest.publishedAt && <div>published: {String(latest.publishedAt)}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                {latest.releaseUrl && (
                  <button
                    onClick={() => openUrl(String(latest.releaseUrl), true)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(180,220,255,0.18)', background: '#0b2436', color: 'inherit' }}
                  >
                    Open release…
                  </button>
                )}
                {latest.downloadUrl && (
                  <button
                    onClick={() => openUrl(String(latest.downloadUrl), true)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(180,220,255,0.18)', background: '#0b2436', color: 'inherit' }}
                  >
                    Download…
                  </button>
                )}
              </div>

              {latest.assets && latest.assets.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ opacity: 0.9, marginBottom: 6 }}>assets:</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {latest.assets.slice(0, 10).map((a) => (
                      <button
                        key={a.url}
                        onClick={() => openUrl(a.url, true)}
                        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(180,220,255,0.18)', background: '#0b2436', color: 'inherit' }}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 8, opacity: 0.8 }}>
                current: {__STONEGATE_FE_VERSION__}
              </div>
            </div>
          )}

          {!defaultManifestUrl && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Tip: set <code>__STONEGATE_CONFIG__.update_manifest_url</code> in <code>stonegate-config.js</code> so this can auto-check.
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Tips</h4>
          <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9, fontSize: 13, lineHeight: 1.5 }}>
            <li>
              <strong>Build Mode</strong> enables build-only helpers like auto-loading backend schematics on connect (if toggled).
            </li>
            <li>
              <strong>Diagnostics</strong> shows frontend actions (left) and backend log broadcasts (right). Use filters to spot external commands.
            </li>
            <li>
              <strong>Instance Manager</strong> is dev-only and only available when running <code>pnpm dev</code>.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
