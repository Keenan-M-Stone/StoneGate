import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
      continue
    }

    // Keep it simple: copy everything verbatim.
    fs.copyFileSync(srcPath, destPath)
  }
}

const repoRoot = path.resolve(__dirname, '..', '..')
const srcDocs = path.join(repoRoot, 'docs')
const destDocs = path.join(repoRoot, 'frontend', 'public', 'docs-src')

if (!fs.existsSync(srcDocs)) {
  console.error(`[sync] docs folder not found: ${srcDocs}`)
  process.exit(1)
}

// Clean destination to avoid stale files.
fs.rmSync(destDocs, { recursive: true, force: true })

// Prefer a symlink to avoid redundant copies of docs.
// Source-of-truth stays in /docs; the frontend serves it from /public/docs-src.
try {
  // Use a relative link so it survives moves of the repo folder.
  const relTarget = path.relative(path.dirname(destDocs), srcDocs)
  fs.symlinkSync(relTarget, destDocs, 'dir')
  console.log(`[sync] linked ${destDocs} -> ${relTarget} (source-of-truth: ${srcDocs})`)
} catch (e) {
  // Fallback for environments that don't support symlinks well.
  copyDir(srcDocs, destDocs)
  console.log(`[sync] copied ${srcDocs} -> ${destDocs} (symlink unavailable: ${String(e?.message ?? e)})`)
}
