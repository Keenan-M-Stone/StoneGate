#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const srcDir = path.join(repoRoot, 'tools/live-transform-demo')
const dstDir = path.join(repoRoot, 'frontend/public/tools/live-transform-demo')

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const s = path.join(src, ent.name)
    const d = path.join(dst, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

if (!fs.existsSync(srcDir)) {
  console.error(`Missing: ${srcDir}`)
  process.exit(2)
}

fs.rmSync(dstDir, { recursive: true, force: true })
copyDir(srcDir, dstDir)

console.log(`[sync] copied ${srcDir} -> ${dstDir}`)
