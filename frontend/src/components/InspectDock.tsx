import React from 'react'
import { Responsive, noCompactor, type Layout, type LayoutItem, type ResponsiveLayouts } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

type InspectDockProps = {
  openIds: string[]
  onClose: (id: string) => void
  childrenForId: (id: string) => React.ReactNode
}

type DockBreakpoint = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6'

const STORAGE_KEY = 'stonegate.inspectDock.layouts.v3'
const COLLAPSE_KEY = 'stonegate.inspectDock.collapsed.v1'
const PINS_KEY = 'stonegate.inspectDock.pins.v1'

// Strategy: choose number of columns based on available width, but keep a minimum
// column width so each inspect panel is actually usable.
const MIN_COL_WIDTH_PX = 760
const ROW_HEIGHT = 28
const DEFAULT_PANEL_H_PX = 760
const DEFAULT_H = Math.max(18, Math.ceil(DEFAULT_PANEL_H_PX / ROW_HEIGHT))
const MARGIN: readonly [number, number] = [10, 10]
const CONTAINER_PADDING: readonly [number, number] = [0, 0]

const BREAKPOINTS: Record<DockBreakpoint, number> = {
  c6: MIN_COL_WIDTH_PX * 6,
  c5: MIN_COL_WIDTH_PX * 5,
  c4: MIN_COL_WIDTH_PX * 4,
  c3: MIN_COL_WIDTH_PX * 3,
  c2: MIN_COL_WIDTH_PX * 2,
  c1: 0,
}

const COLS: Record<DockBreakpoint, number> = {
  c6: 6,
  c5: 5,
  c4: 4,
  c3: 3,
  c2: 2,
  c1: 1,
}

function loadPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PINS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map(String))
  } catch {
    return new Set()
  }
}

function savePins(pins: Set<string>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(pins)))
  } catch {}
}

function loadCollapsed(): boolean {
  try {
    return (localStorage.getItem(COLLAPSE_KEY) || 'false') === 'true'
  } catch {
    return false
  }
}

function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? 'true' : 'false')
  } catch {}
}

function loadLayouts(): ResponsiveLayouts<DockBreakpoint> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ResponsiveLayouts<DockBreakpoint>
  } catch {
    return null
  }
}

function saveLayouts(layouts: ResponsiveLayouts<DockBreakpoint>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
  } catch {}
}

function rectsOverlap(a: LayoutItem, b: LayoutItem): boolean {
  const ax2 = (a.x ?? 0) + (a.w ?? 1)
  const ay2 = (a.y ?? 0) + (a.h ?? 1)
  const bx2 = (b.x ?? 0) + (b.w ?? 1)
  const by2 = (b.y ?? 0) + (b.h ?? 1)
  return (a.x ?? 0) < bx2 && ax2 > (b.x ?? 0) && (a.y ?? 0) < by2 && ay2 > (b.y ?? 0)
}

function findNextSlot(existing: LayoutItem[], cols: number, w: number, h: number): { x: number; y: number } {
  const maxY = existing.reduce((m, it) => Math.max(m, (it.y ?? 0) + (it.h ?? 1)), 0)
  for (let y = 0; y <= maxY + h + 2; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const candidate: LayoutItem = { i: '__candidate__', x, y, w, h }
      if (!existing.some((it) => rectsOverlap(candidate, it))) return { x, y }
    }
  }
  return { x: 0, y: maxY + 2 }
}

function ensureLayoutForBreakpoint(openIds: string[], cols: number, pins: Set<string>, current?: Layout): Layout {
  const existing = new Map<string, LayoutItem>()
  for (const item of current ?? []) existing.set(String(item.i), item)

  const next: LayoutItem[] = []

  // First, keep existing items (do not auto-move them).
  for (const id of openIds) {
    const key = String(id)
    const found = existing.get(key)
    if (!found) continue

    const w = Math.max(1, Math.min(cols, Math.floor(found.w ?? 1)))
    const x = Math.max(0, Math.min(cols - w, Math.floor(found.x ?? 0)))
    const h = Math.max(Math.max(16, DEFAULT_H - 6), Math.floor(found.h ?? DEFAULT_H))
    const y = Math.max(0, Math.floor(found.y ?? 0))
    const pinned = pins.has(key)
    next.push({
      ...found,
      i: key,
      x,
      y,
      w,
      h,
      minW: 1,
      minH: Math.max(16, DEFAULT_H - 6),
      maxW: cols,
      isDraggable: !pinned,
      isResizable: true,
    })
  }

  // Then, place new items into the first available slot.
  for (const id of openIds) {
    const key = String(id)
    if (existing.has(key)) continue

    const w = 1
    const h = DEFAULT_H
    const slot = findNextSlot(next, cols, w, h)
    const pinned = pins.has(key)
    next.push({
      i: key,
      x: slot.x,
      y: slot.y,
      w,
      h,
      minW: 1,
      minH: Math.max(16, DEFAULT_H - 6),
      maxW: cols,
      isDraggable: !pinned,
      isResizable: true,
    })
  }

  return next
}

function ensureLayoutsFor(
  openIds: string[],
  pins: Set<string>,
  current: ResponsiveLayouts<DockBreakpoint> | null,
): ResponsiveLayouts<DockBreakpoint> {
  const base = current ?? ({} as ResponsiveLayouts<DockBreakpoint>)
  const out: any = {}
  ;(Object.keys(COLS) as DockBreakpoint[]).forEach((bp) => {
    out[bp] = ensureLayoutForBreakpoint(openIds, COLS[bp], pins, base[bp])
  })
  return out as ResponsiveLayouts<DockBreakpoint>
}

function clampLayoutItemToCols(item: LayoutItem, cols: number): LayoutItem {
  const w = Math.max(1, Math.min(cols, Math.floor(item.w ?? 1)))
  const x = Math.max(0, Math.min(cols - w, Math.floor(item.x ?? 0)))
  return { ...item, x, w, maxW: cols }
}

function stabilizePinnedLayouts(
  prev: ResponsiveLayouts<DockBreakpoint>,
  next: Partial<ResponsiveLayouts<DockBreakpoint>>,
  pins: Set<string>,
): ResponsiveLayouts<DockBreakpoint> {
  const out: any = { ...prev, ...next }

  ;(Object.keys(COLS) as DockBreakpoint[]).forEach((bp) => {
    const cols = COLS[bp]
    const prevLayout = (prev[bp] ?? []) as LayoutItem[]
    const prevMap = new Map<string, LayoutItem>(prevLayout.map((it) => [String(it.i), it]))

    const nextLayout = ((out[bp] ?? []) as LayoutItem[]).map((it) => {
      const id = String(it.i)
      if (!pins.has(id)) return clampLayoutItemToCols(it, cols)

      const prevItem = prevMap.get(id)
      const stabilized: LayoutItem = {
        ...it,
        x: prevItem?.x ?? it.x,
        y: prevItem?.y ?? it.y,
        isDraggable: false,
        isResizable: true,
      }
      return clampLayoutItemToCols(stabilized, cols)
    })

    out[bp] = nextLayout
  })

  return out as ResponsiveLayouts<DockBreakpoint>
}

export default function InspectDock({ openIds, onClose, childrenForId }: InspectDockProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState<number>(() => {
    if (typeof window === 'undefined') return 1200
    return Math.max(320, window.innerWidth - 24)
  })

  const [currentBp, setCurrentBp] = React.useState<DockBreakpoint>('c2')
  const [pins, setPins] = React.useState<Set<string>>(() => loadPins())

  const [layouts, setLayouts] = React.useState<ResponsiveLayouts<DockBreakpoint>>(() => ensureLayoutsFor(openIds, pins, loadLayouts()))
  const layoutsRef = React.useRef(layouts)
  const isInteractingRef = React.useRef(false)
  const [collapsed, setCollapsed] = React.useState<boolean>(() => loadCollapsed())
  const prevLenRef = React.useRef<number>(openIds.length)

  React.useEffect(() => {
    layoutsRef.current = layouts
  }, [layouts])

  React.useEffect(() => {
    saveCollapsed(collapsed)
  }, [collapsed])

  React.useEffect(() => {
    const prevLen = prevLenRef.current
    const nextLen = openIds.length
    prevLenRef.current = nextLen
    if (prevLen === 0 && nextLen > 0) setCollapsed(false)
    if (prevLen > 0 && nextLen === 0) setCollapsed(true)
  }, [openIds.length])

  React.useEffect(() => {
    setLayouts((prev) => {
      const next = ensureLayoutsFor(openIds, pins, prev)
      saveLayouts(next)
      return next
    })
  }, [openIds.join(','), pins])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => setContainerWidth(Math.max(320, el.clientWidth))
    update()

    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (openIds.length === 0) return null

  const togglePin = (id: string) => {
    const key = String(id)
    setPins((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      savePins(next)
      return next
    })

    setLayouts((prev) => {
      const src = prev[currentBp]?.find((it) => String(it.i) === key)
      const srcItem: LayoutItem = src ? { ...src } : { i: key, x: 0, y: 0, w: 1, h: DEFAULT_H }
      const nextPinned = !(pins.has(key))

      const out: any = { ...prev }
      ;(Object.keys(COLS) as DockBreakpoint[]).forEach((bp) => {
        const cols = COLS[bp]
        const layout = (out[bp] ? [...out[bp]] : []) as LayoutItem[]
        const idx = layout.findIndex((it) => String(it.i) === key)
        if (idx >= 0) {
          const merged = { ...layout[idx], x: srcItem.x, y: srcItem.y, w: srcItem.w, h: srcItem.h, isDraggable: !nextPinned, isResizable: true }
          layout[idx] = clampLayoutItemToCols(merged, cols)
        } else {
          const placed = clampLayoutItemToCols({ ...srcItem, i: key, isDraggable: !nextPinned, isResizable: true }, cols)
          layout.push(placed)
        }
        out[bp] = layout
      })

      saveLayouts(out as ResponsiveLayouts<DockBreakpoint>)
      return out as ResponsiveLayouts<DockBreakpoint>
    })
  }


  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        marginTop: 12,
        background: 'rgba(2, 10, 18, 0.65)',
        border: '1px solid rgba(70, 120, 160, 0.25)',
        borderRadius: 10,
        backdropFilter: 'blur(6px)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setCollapsed((v) => !v)}
            style={{
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#e6eef8',
            }}
            title={collapsed ? 'Expand dock' : 'Collapse dock'}
          >
            {collapsed ? '▾' : '▴'}
          </button>
          <div style={{ fontWeight: 700, color: '#e6eef8' }}>Inspect Dock</div>
          <div style={{ color: '#9bb3c7', fontSize: 12 }}>{openIds.length} panel{openIds.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ color: '#9bb3c7', fontSize: 12 }}>{collapsed ? 'Collapsed' : 'Drag to rearrange. Resize snaps to columns.'}</div>
      </div>

      {!collapsed && (
        <div style={{ padding: 8, overflow: 'auto' }}>
          <Responsive<DockBreakpoint>
            width={containerWidth}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            layouts={layouts}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={CONTAINER_PADDING}
            // Stable behavior: don't compact other items while resizing.
            compactor={noCompactor}
            dragConfig={{ handle: '.inspect-panel-title' }}
            resizeConfig={{ handles: ['e', 's', 'se'] }}
            onBreakpointChange={(bp) => setCurrentBp(bp as DockBreakpoint)}
            onLayoutChange={(_layout, nextLayouts) => {
              if (!isInteractingRef.current) return
              setLayouts((prev) => stabilizePinnedLayouts(prev, nextLayouts as Partial<ResponsiveLayouts<DockBreakpoint>>, pins))
            }}
            onDragStart={() => {
              isInteractingRef.current = true
            }}
            onDragStop={() => {
              isInteractingRef.current = false
              saveLayouts(layoutsRef.current)
            }}
            onResizeStart={() => {
              isInteractingRef.current = true
            }}
            onResizeStop={() => {
              isInteractingRef.current = false
              saveLayouts(layoutsRef.current)
            }}
          >
            {openIds.map((id) => (
              <div key={id} style={{ borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div
                  className="inspect-panel-title"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: '#0b2436',
                    color: '#e6eef8',
                    cursor: pins.has(String(id)) ? 'default' : 'move',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => togglePin(id)}
                      style={{
                        cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: pins.has(String(id)) ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: '#e6eef8',
                      }}
                      title={pins.has(String(id)) ? 'Unpin (allow dragging)' : 'Pin (lock position; still resizable)'}
                    >
                      {pins.has(String(id)) ? 'Pinned' : 'Pin'}
                    </button>
                    <button onClick={() => onClose(id)} style={{ cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1, minHeight: 0, background: '#071827', overflow: 'hidden' }}>{childrenForId(id)}</div>
              </div>
            ))}
          </Responsive>
        </div>
      )}
    </div>
  )
}
