#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let cur = path.resolve(here, '..', '..')
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, 'frontend')) && fs.existsSync(path.join(cur, 'docs'))) return cur
    cur = path.dirname(cur)
  }
  return path.resolve(here, '..', '..')
}

function parseWizardMarkdown(md) {
  const lines = md.split(/\r?\n/)
  let title = 'Installation Wizard'

  /** @type {{ title: string; steps: string[] }[]} */
  const sections = []
  let cur = null

  const pushSection = () => {
    if (!cur) return
    // drop empty sections
    if (cur.steps.length === 0) return
    sections.push(cur)
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue

    if (line.startsWith('# ')) {
      title = line.slice(2).trim() || title
      continue
    }

    if (line.startsWith('## ')) {
      pushSection()
      cur = { title: line.slice(3).trim() || 'Section', steps: [] }
      continue
    }

    if (line.startsWith('- ')) {
      if (!cur) cur = { title: 'Steps', steps: [] }
      cur.steps.push(line.slice(2).trim())
      continue
    }
  }

  pushSection()

  return { title, sections }
}

function emitTs({ title, sections }) {
  const safe = (s) => JSON.stringify(String(s))
  const out = []
  out.push('// Generated file. Do not edit by hand.')
  out.push('// Source: docs/installation-wizard.md')
  out.push(`export const INSTALL_WIZARD = {`)
  out.push(`  title: ${safe(title)},`)
  out.push(`  generatedAt: ${safe(new Date().toISOString())},`)
  out.push(`  sections: [`)
  for (const sec of sections) {
    out.push(`    { title: ${safe(sec.title)}, steps: [`)
    for (const step of sec.steps) out.push(`      ${safe(step)},`)
    out.push('    ] },')
  }
  out.push('  ],')
  out.push('} as const')
  out.push('')
  out.push('export type InstallWizard = typeof INSTALL_WIZARD')
  out.push('')
  return out.join('\n')
}

function main() {
  const root = repoRoot()
  const src = path.join(root, 'docs', 'installation-wizard.md')
  const dst = path.join(root, 'frontend', 'src', 'generated', 'installWizard.ts')

  const md = fs.readFileSync(src, 'utf8')
  const parsed = parseWizardMarkdown(md)

  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, emitTs(parsed), 'utf8')

  process.stdout.write(`OK: wrote ${path.relative(root, dst)}\n`)
}

main()
