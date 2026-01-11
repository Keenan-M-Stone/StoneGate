#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const out = { dir: '', host: '127.0.0.1', port: 5173 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') out.dir = argv[++i] ?? ''
    else if (a === '--host') out.host = argv[++i] ?? out.host
    else if (a === '--port') out.port = Number(argv[++i] ?? out.port)
    else if (a === '-h' || a === '--help') {
      console.log('Usage: serve-frontend.mjs --dir <path> [--host 127.0.0.1] [--port 5173]')
      process.exit(0)
    }
  }
  return out
}

const args = parseArgs(process.argv)
const root = args.dir ? path.resolve(args.dir) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist')

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Static dir not found: ${root}`)
  process.exit(1)
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
}

function safeJoin(base, reqPath) {
  const p = path.normalize(reqPath).replace(/^\/+/, '')
  const full = path.join(base, p)
  if (!full.startsWith(base)) return null
  return full
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname

  let full = safeJoin(root, pathname)
  if (!full) {
    res.writeHead(400)
    return res.end('Bad path')
  }

  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA fallback
    full = path.join(root, 'index.html')
  }

  try {
    const ext = path.extname(full).toLowerCase()
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' })
    fs.createReadStream(full).pipe(res)
  } catch (e) {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(args.port, args.host, () => {
  console.log(`Serving ${root} on http://${args.host}:${args.port}`)
})
