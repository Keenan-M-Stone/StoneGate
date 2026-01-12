import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/+esm'

const DEFAULT_DOC = 'Troubleshooting.md'

function qs(sel) {
  return document.querySelector(sel)
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function fetchText(url) {
  const resp = await fetch(url, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.text()
}

function setActive(navEl, name) {
  for (const a of navEl.querySelectorAll('a')) {
    a.classList.toggle('active', a.getAttribute('data-doc') === name)
  }
}

async function loadNav() {
  const navEl = qs('#nav')
  const contentEl = qs('#content')

  // Keep this list explicit so we don't need directory listing.
  const docs = [
    'Troubleshooting.md',
    'Software_Specifications.md',
    'Tooling.md',
    'DEVELOPER.md',
    'installer.md',
  ]

  navEl.innerHTML = docs
    .map((d) => `<a class="doclink" href="#${encodeURIComponent(d)}" data-doc="${escapeHtml(d)}">${escapeHtml(d)}</a>`)
    .join('')

  async function render(docName) {
    const name = docName || DEFAULT_DOC
    setActive(navEl, name)
    try {
      contentEl.className = ''
      contentEl.innerHTML = '<div class="badge">Loading…</div>'
      const md = await fetchText(`../docs-src/${encodeURIComponent(name)}`)
      contentEl.innerHTML = marked.parse(md)
    } catch (e) {
      contentEl.className = ''
      contentEl.innerHTML = `<pre>Failed to load ${escapeHtml(name)}\n\n${escapeHtml(e?.message || e)}</pre>`
    }
  }

  window.addEventListener('hashchange', () => {
    const h = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''))
    render(h)
  })

  const initial = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''))
  await render(initial)
}

loadNav()
