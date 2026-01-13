#!/usr/bin/env node
/*
Generates a master error message document from shared/config/errors.json.
- Validates non-overlapping numeric blocks
- Validates each error is in exactly one block
- Supports multiple causes, each with multiple recommended actions

Usage:
  node tools/generate_error_messages.mjs
  node tools/generate_error_messages.mjs --check
  node tools/generate_error_messages.mjs --out docs/Error_Messages.md
*/

import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = { in: 'shared/config/errors.json', out: 'docs/Error_Messages.md', check: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') args.check = true
    else if (a === '--in') args.in = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--help' || a === '-h') {
      args.help = true
    } else {
      throw new Error(`Unknown arg: ${a}`)
    }
  }
  return args
}

function fatal(msg) {
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function normalizeCatalog(raw) {
  const catalog = { ...raw }

  if (!Array.isArray(catalog.blocks) && catalog.ranges && typeof catalog.ranges === 'object') {
    // Backward-compat fallback: create coarse blocks from ranges.
    catalog.blocks = Object.entries(catalog.ranges).map(([origin, r]) => ({
      id: origin.toUpperCase(),
      origin,
      title: origin,
      start: r.start,
      end: r.end,
    }))
  }

  catalog.blocks ??= []
  catalog.errors ??= []

  // Normalize error fields.
  catalog.errors = catalog.errors.map((e) => {
    const out = { ...e }
    // Support legacy `message` field.
    if (out.template == null && typeof out.message === 'string') out.template = out.message
    if (typeof out.code === 'string') out.code = Number(out.code)
    return out
  })

  return catalog
}

function validateCatalog(catalog) {
  assert(Array.isArray(catalog.blocks), 'errors.json: blocks must be an array')
  assert(Array.isArray(catalog.errors), 'errors.json: errors must be an array')

  const originSet = new Set(['frontend', 'backend', 'qec'])

  // Validate blocks and enforce non-overlap.
  const blocks = catalog.blocks.map((b) => ({ ...b }))
  for (const b of blocks) {
    assert(typeof b.id === 'string' && b.id.length > 0, 'block.id required')
    assert(typeof b.origin === 'string' && originSet.has(b.origin), `block.origin invalid for ${b.id}`)
    assert(Number.isInteger(b.start) && Number.isInteger(b.end), `block.start/end must be ints (${b.id})`)
    assert(b.start <= b.end, `block.start must be <= end (${b.id})`)
  }

  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.start <= prev.end) {
      throw new Error(`Overlapping blocks: ${prev.id} (${prev.start}-${prev.end}) overlaps ${cur.id} (${cur.start}-${cur.end})`)
    }
  }

  const blockById = new Map(blocks.map((b) => [b.id, b]))

  // Validate errors.
  const seenCodes = new Map()
  for (const e of catalog.errors) {
    assert(Number.isInteger(e.code), `error.code must be int (got ${e.code})`)
    assert(typeof e.origin === 'string' && originSet.has(e.origin), `error.origin invalid for ${e.code}`)
    assert(typeof e.template === 'string' && e.template.trim().length > 0, `error.template required for ${e.code}`)

    if (seenCodes.has(e.code)) {
      throw new Error(`Duplicate error code ${e.code} (also in ${seenCodes.get(e.code)})`)
    }
    seenCodes.set(e.code, e.id ?? '(unnamed)')

    // Determine block membership.
    const containing = blocks.filter((b) => e.code >= b.start && e.code <= b.end)
    assert(containing.length === 1, `Error ${e.code} must fall into exactly one block; found ${containing.map((b) => b.id).join(', ') || 'none'}`)

    const b = containing[0]
    assert(e.origin === b.origin, `Error ${e.code} origin '${e.origin}' mismatches block '${b.id}' origin '${b.origin}'`)

    if (e.block != null) {
      assert(typeof e.block === 'string' && blockById.has(e.block), `Error ${e.code} references unknown block '${e.block}'`)
      const bb = blockById.get(e.block)
      assert(bb.origin === e.origin, `Error ${e.code} block '${e.block}' origin mismatch`)
      assert(e.code >= bb.start && e.code <= bb.end, `Error ${e.code} block '${e.block}' range mismatch`)
    }

    // Guidance validation: supports multi-cause multi-action.
    const guidance = e.guidance
    assert(Array.isArray(guidance) && guidance.length > 0, `Error ${e.code} guidance[] required (cause/action statements)`)
    for (const g of guidance) {
      assert(typeof g.cause === 'string' && g.cause.trim().length > 0, `Error ${e.code} guidance.cause required`)
      assert(Array.isArray(g.actions) && g.actions.length > 0, `Error ${e.code} guidance.actions[] required`)
      for (const a of g.actions) {
        assert(typeof a === 'string' && a.trim().length > 0, `Error ${e.code} guidance.actions entries must be non-empty strings`)
      }
    }
  }
}

function renderMarkdown(catalog) {
  const blocks = [...catalog.blocks].sort((a, b) => a.start - b.start)
  const errors = [...catalog.errors].sort((a, b) => a.code - b.code)

  const byBlock = new Map(blocks.map((b) => [b.id, []]))
  for (const e of errors) {
    const b = blocks.find((bb) => e.code >= bb.start && e.code <= bb.end)
    byBlock.get(b.id).push(e)
  }

  const lines = []
  lines.push('# Error Messages (Master Catalog)')
  lines.push('')
  lines.push('This document is generated from `shared/config/errors.json`. Do not edit it manually.')
  lines.push('')
  lines.push('## Numbering blocks')
  lines.push('')
  for (const b of blocks) {
    lines.push(`- ${b.start}-${b.end}: ${b.title} (${b.origin})`)
  }
  lines.push('')

  lines.push('## Errors')
  lines.push('')

  for (const b of blocks) {
    const list = byBlock.get(b.id) ?? []
    lines.push(`### ${b.start}-${b.end} — ${b.title}`)
    lines.push('')
    if (b.description) {
      lines.push(b.description)
      lines.push('')
    }

    if (list.length === 0) {
      lines.push('_No errors currently catalogued in this block._')
      lines.push('')
      continue
    }

    for (const e of list) {
      const form = `Error ${e.code}: ${e.template}`
      const anchor = `${e.code}`
      lines.push(`#### ${anchor} — ${e.summary ?? ''}`.trim())
      lines.push('')
      lines.push('**Message form**')
      lines.push(`- \`${form}\``)
      lines.push('')

      for (const g of e.guidance) {
        lines.push('**Cause**')
        lines.push(`- ${g.cause}`)
        lines.push('')
        lines.push('**Action**')
        for (const a of g.actions) {
          lines.push(`- ${a}`)
        }
        lines.push('')
      }

      if (e.notes) {
        lines.push('**Notes**')
        if (Array.isArray(e.notes)) {
          for (const n of e.notes) lines.push(`- ${n}`)
        } else {
          lines.push(`- ${e.notes}`)
        }
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    process.stdout.write('Usage: node tools/generate_error_messages.mjs [--check] [--in <path>] [--out <path>]\n')
    return
  }

  const repoRoot = process.cwd()
  const inPath = path.resolve(repoRoot, args.in)
  const rawText = await fs.readFile(inPath, 'utf8')
  const raw = JSON.parse(rawText)
  const catalog = normalizeCatalog(raw)

  validateCatalog(catalog)

  if (args.check) {
    process.stdout.write('OK: error catalog validation passed.\n')
    return
  }

  const outMd = renderMarkdown(catalog)
  const outPath = path.resolve(repoRoot, args.out)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, outMd, 'utf8')
  process.stdout.write(`Wrote ${path.relative(repoRoot, outPath)}\n`)
}

main().catch((err) => fatal(err?.stack || String(err)))
