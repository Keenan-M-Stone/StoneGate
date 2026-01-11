import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function stonegateAdminDevApi() {
  return {
    name: 'stonegate-admin-dev-api',
    apply: 'serve',
    configureServer(server: any) {
      const isLoopback = (addr: string | undefined) => {
        if (!addr) return false
        return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
      }

      const readJsonBody = (req: any) =>
        new Promise<any>((resolve, reject) => {
          let buf = ''
          req.on('data', (c: any) => {
            buf += String(c)
            if (buf.length > 1024 * 1024) {
              reject(new Error('body too large'))
            }
          })
          req.on('end', () => {
            if (!buf) return resolve(null)
            try {
              resolve(JSON.parse(buf))
            } catch (e) {
              reject(e)
            }
          })
          req.on('error', reject)
        })

      server.middlewares.use('/__stonegate_admin', async (req: any, res: any, next: any) => {
        try {
          if (!isLoopback(req.socket?.remoteAddress)) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }

          // Lazy import so TS doesn't need types for the .mjs module.
          const mod = await import(new URL('./scripts/stonegate-admin-lib.mjs', import.meta.url).href)

          if (req.method === 'GET' && req.url?.startsWith('/instances')) {
            const instances = mod.listInstances({ quiet: true })
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, instances }))
            return
          }

          if (req.method === 'POST' && req.url?.startsWith('/kill')) {
            const body = await readJsonBody(req)
            const pids = Array.isArray(body?.pids)
              ? body.pids.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n) && n > 0)
              : []

            const safeOnly = !!body?.safeOnly
            const forceUnsafe = !!body?.forceUnsafe
            const dryRun = !!body?.dryRun

            const result = mod.killPids(pids, { safeOnly, forceUnsafe, dryRun })
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(result))
            return
          }

          next()
        } catch (e: any) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stonegateAdminDevApi()],
})
