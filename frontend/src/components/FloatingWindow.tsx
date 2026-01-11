import React from 'react'

export type FloatingWindowLayout = { x: number; y: number; w: number; h: number }

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return n
  return Math.min(hi, Math.max(lo, n))
}

function clampLayoutToViewport(l: FloatingWindowLayout, minW: number, minH: number, margin = 12): FloatingWindowLayout {
  const vw = Math.max(minW, window.innerWidth || 0)
  const vh = Math.max(minH, window.innerHeight || 0)

  const maxW = Math.max(minW, vw - margin * 2)
  const maxH = Math.max(minH, vh - margin * 2)

  const w = clamp(l.w, minW, maxW)
  const h = clamp(l.h, minH, maxH)

  const x = clamp(l.x, 0, Math.max(0, vw - w))
  const y = clamp(l.y, 0, Math.max(0, vh - h))

  return { x, y, w, h }
}

export default function FloatingWindow({
  storageKey,
  defaultLayout,
  minWidth = 320,
  minHeight = 240,
  zIndex = 90,
  background = '#041018',
  title,
  header,
  onContextMenu,
  children,
}: {
  storageKey: string
  defaultLayout: FloatingWindowLayout
  minWidth?: number
  minHeight?: number
  zIndex?: number
  background?: string
  title?: string
  header?: React.ReactNode
  onContextMenu?: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const [layout, setLayout] = React.useState<FloatingWindowLayout>(() =>
    loadJson<FloatingWindowLayout>(storageKey, defaultLayout)
  )

  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startX: number; startY: number; startLeft: number; startTop: number; dragging: boolean } | null>(null)

  React.useEffect(() => {
    setLayout(prev => clampLayoutToViewport(prev, minWidth, minHeight))
    const onResize = () => setLayout(prev => clampLayoutToViewport(prev, minWidth, minHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [minWidth, minHeight])

  React.useEffect(() => {
    saveJson(storageKey, layout)
  }, [layout, storageKey])

  React.useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(entries => {
      const ent = entries[0]
      if (!ent) return
      const cr = ent.contentRect
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setLayout(prev => {
          const next = clampLayoutToViewport({ ...prev, w: Math.round(cr.width), h: Math.round(cr.height) }, minWidth, minHeight)
          if (next.x === prev.x && next.y === prev.y && next.w === prev.w && next.h === prev.h) return prev
          return next
        })
      })
    })
    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [minWidth, minHeight])

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement)?.closest('button,select,input,textarea,a,[role="button"]')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: layout.x, startTop: layout.y, dragging: true }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d?.dragging) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    setLayout(prev => clampLayoutToViewport({ ...prev, x: d.startLeft + dx, y: d.startTop + dy }, minWidth, minHeight))
  }
  const onHeaderPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    d.dragging = false
    dragRef.current = null
    try { ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 24px)',
        minWidth,
        minHeight,
        background,
        color: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 10,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        resize: 'both',
        overflow: 'hidden',
      }}
      onContextMenu={onContextMenu}
    >
      <div
        style={{
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          userSelect: 'none',
          cursor: 'grab',
        }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        {header ?? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ flex: 1 }}>{title ?? 'Window'}</strong>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
