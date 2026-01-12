import React, { useRef, useEffect, useMemo, useState, type ReactNode } from "react";

export interface PanZoomProps {
  children: ReactNode;
  contentWidth: number;
  contentHeight: number;
  enableMiniMap?: boolean;
  miniMapContent?: ReactNode;
  overlay?: ReactNode;
  contextMenuItems?: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  onViewStateChange?: (s: { scale: number; offset: { x: number; y: number }; containerSize: { width: number; height: number } }) => void;
  buildMode?: boolean;
  style?: React.CSSProperties;
  className?: string;
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}

/* ------------------------------------------------------------------
   Hook: usePanZoom
   ------------------------------------------------------------------ */
export function usePanZoom(
  initialScale = 1,
  contentWidth?: number,
  contentHeight?: number,
  options?: {
    contextMenuItems?: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  }
) {
  const [scale, setScale] = useState(initialScale);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  /* -----------------------------
       Mouse Wheel (Zoom)
     ----------------------------- */
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // ctrl+wheel only
    e.preventDefault();

    const delta = -e.deltaY;
    const zoomFactor = 1 + delta * 0.0015;

    const rect = ref.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setScale(prev => {
      const next = Math.min(4, Math.max(0.15, prev * zoomFactor));
      const k = next / prev;

      setOffset(o => ({
        x: cx - k * (cx - o.x),
        y: cy - k * (cy - o.y),
      }));
      return next;
    });
  };

  /* -----------------------------
        Mouse Drag (Pan)
     ----------------------------- */
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;

    // Allow child UIs (nodes, controls, minimap) to opt out of starting a pan.
    // Hold Alt to force panning even when starting inside a node/control.
    if (e.button === 0 && !e.altKey) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-panzoom-no-pan="true"]')) return;
    }

    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;

    lastPos.current = { x: e.clientX, y: e.clientY };

    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  };

  const onMouseUp = () => {
    dragging.current = false;
  };

  /* ---------------------------------------
       Context Menu: Fit + Reset zoom
     --------------------------------------- */
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();

    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";
    menu.style.padding = "6px 10px";
    menu.style.background = "#222";
    menu.style.color = "white";
    menu.style.borderRadius = "6px";
    menu.style.zIndex = "99999";
    menu.style.fontSize = "13px";
    menu.style.boxShadow = "0 2px 6px rgba(0,0,0,0.35)";
    menu.style.cursor = "pointer";

    const addItem = (label: string, fn: () => void) => {
      const div = document.createElement("div");
      div.innerText = label;
      div.style.padding = "4px 6px";
      div.onmouseenter = () => (div.style.background = "#333");
      div.onmouseleave = () => (div.style.background = "transparent");
      div.onclick = () => {
        fn();
        document.body.removeChild(menu);
      };
      menu.appendChild(div);
    };

    addItem("🔍 Fit to screen", () => fitToScreen());
    addItem("🔁 Reset zoom", () => reset());

    const extra = options?.contextMenuItems ?? [];
    for (const item of extra) {
      if (!item || !item.label) continue;
      addItem(item.label, () => {
        if (item.disabled) return;
        item.onClick();
      });
    }

    document.body.appendChild(menu);

    const remove = () => {
      if (document.body.contains(menu)) document.body.removeChild(menu);
      window.removeEventListener("click", remove);
    };
    window.addEventListener("click", remove);
  };

  const fitToScreen = React.useCallback(() => {
    if (!ref.current) return;
    const w = containerSize.width || ref.current.getBoundingClientRect().width;
    const h = containerSize.height || ref.current.getBoundingClientRect().height;
    const cw = contentWidth ?? 0;
    const ch = contentHeight ?? 0;
    if (!w || !h || !cw || !ch) return;

    const next = Math.min(w / cw, h / ch) * 0.95;
    const nx = (w - cw * next) / 2;
    const ny = (h - ch * next) / 2;
    setScale(next);
    setOffset({ x: nx, y: ny });
  }, [containerSize.width, containerSize.height, contentWidth, contentHeight]);

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  /* -------------------------------
      Attach listeners
     ------------------------------- */
  useEffect(() => {
    const el = ref.current!;
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setContainerSize({ width: cr.width, height: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return {
    ref,
    scale,
    offset,
    setScale,
    setOffset,
    fitToScreen,
    reset,
    containerSize,
  };
}

/* ------------------------------------------------------------------
   Component: MiniMap
   ------------------------------------------------------------------ */
export function MiniMap({
  scale,
  offset,
  contentWidth,
  contentHeight,
  containerWidth,
  containerHeight,
  content,
  buildMode,
  onRecenter,
}: {
  scale: number;
  offset: { x: number; y: number };
  contentWidth: number;
  contentHeight: number;
  containerWidth: number;
  containerHeight: number;
  content?: ReactNode;
  buildMode?: boolean;
  onRecenter?: (worldX: number, worldY: number) => void;
}) {
  const mapSize = 180;

  const viewW = Math.max(1, containerWidth);
  const viewH = Math.max(1, containerHeight);

  // viewport in world coordinates (content space)
  const vxW = -offset.x / scale;
  const vyW = -offset.y / scale;
  const vwW = viewW / scale;
  const vhW = viewH / scale;

  const viewCx = vxW + vwW / 2;
  const viewCy = vyW + vhW / 2;

  const inside =
    viewCx >= 0 &&
    viewCy >= 0 &&
    viewCx <= contentWidth &&
    viewCy <= contentHeight;

  const showArrow = buildMode && !inside;

  const clampedVx = Math.max(0, Math.min(vxW, contentWidth));
  const clampedVy = Math.max(0, Math.min(vyW, contentHeight));
  const clampedVw = Math.max(0, Math.min(vwW, contentWidth - clampedVx));
  const clampedVh = Math.max(0, Math.min(vhW, contentHeight - clampedVy));

  const arrow = useMemo(() => {
    if (!showArrow) return null;
    const cx = contentWidth / 2;
    const cy = contentHeight / 2;
    const dx = viewCx - cx;
    const dy = viewCy - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // place arrow near minimap border in world coords
    const margin = Math.max(contentWidth, contentHeight) * 0.06;
    const bx = cx + ux * (Math.min(contentWidth, contentHeight) / 2 - margin);
    const by = cy + uy * (Math.min(contentWidth, contentHeight) / 2 - margin);

    const size = Math.max(contentWidth, contentHeight) * 0.04;
    // triangle arrow head
    const leftx = bx - uy * size - ux * size * 0.2;
    const lefty = by + ux * size - uy * size * 0.2;
    const rightx = bx + uy * size - ux * size * 0.2;
    const righty = by - ux * size - uy * size * 0.2;
    const tipx = bx + ux * size * 1.6;
    const tipy = by + uy * size * 1.6;

    return {
      bx,
      by,
      leftx,
      lefty,
      rightx,
      righty,
      tipx,
      tipy,
    };
  }, [showArrow, viewCx, viewCy, contentWidth, contentHeight]);

  const onClick = (e: React.MouseEvent) => {
    if (!onRecenter) return;
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    onRecenter(px * contentWidth, py * contentHeight);
  };

  return (
    <div
      data-panzoom-no-pan="true"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: mapSize,
        height: mapSize,
        background: "#111",
        border: "1px solid #555",
        borderRadius: 6,
        zIndex: 999,
        opacity: 0.85,
      }}
      onClick={onClick}
      title={showArrow ? "Off schematic: click to recenter" : "Click to recenter"}
    >
      <svg
        width={mapSize}
        height={mapSize}
        viewBox={`0 0 ${contentWidth} ${contentHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        <rect x={0} y={0} width={contentWidth} height={contentHeight} fill="#0b1222" />
        <g opacity={0.9}>{content}</g>

        {!showArrow && (
          <rect
            x={clampedVx}
            y={clampedVy}
            width={clampedVw}
            height={clampedVh}
            fill="none"
            stroke="#39f"
            strokeWidth={Math.max(2, Math.max(contentWidth, contentHeight) * 0.003)}
          />
        )}

        {showArrow && arrow && (
          <g>
            <line
              x1={contentWidth / 2}
              y1={contentHeight / 2}
              x2={arrow.bx}
              y2={arrow.by}
              stroke="#ffcc33"
              strokeWidth={Math.max(2, Math.max(contentWidth, contentHeight) * 0.003)}
              opacity={0.9}
            />
            <polygon
              points={`${arrow.leftx},${arrow.lefty} ${arrow.rightx},${arrow.righty} ${arrow.tipx},${arrow.tipy}`}
              fill="#ffcc33"
              opacity={0.95}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------
   Component: PanZoomContainer
   ------------------------------------------------------------------ */
export function PanZoomContainer({
  children,
  contentWidth,
  contentHeight,
  enableMiniMap = true,
  miniMapContent,
  overlay,
  contextMenuItems,
  onViewStateChange,
  buildMode,
  style,
  className,
  containerProps,
}: PanZoomProps) {
  const pz = usePanZoom(1, contentWidth, contentHeight, { contextMenuItems });

  useEffect(() => {
    onViewStateChange?.({ scale: pz.scale, offset: pz.offset, containerSize: pz.containerSize });
  }, [pz.scale, pz.offset, pz.containerSize.width, pz.containerSize.height, onViewStateChange]);

  // Fit to full schematic by default, and re-fit when content grows (esp. in build mode)
  const lastContent = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    pz.fitToScreen();
  }, [pz.containerSize.width, pz.containerSize.height, pz.fitToScreen]);

  useEffect(() => {
    const prev = lastContent.current;
    lastContent.current = { w: contentWidth, h: contentHeight };
    if (!prev) return;
    const grew = contentWidth > prev.w + 1 || contentHeight > prev.h + 1;
    if (grew && buildMode) {
      pz.fitToScreen();
    }
  }, [contentWidth, contentHeight, buildMode, pz.fitToScreen]);

  const recenterTo = (worldX: number, worldY: number) => {
    const w = pz.containerSize.width;
    const h = pz.containerSize.height;
    if (!w || !h) return;
    const x = w / 2 - worldX * pz.scale;
    const y = h / 2 - worldY * pz.scale;
    pz.setOffset({ x, y });
  };

  const {
    style: containerStyle,
    className: containerClassName,
    ...containerRest
  } = containerProps ?? {};

  return (
    <div
      {...containerRest}
      style={{
        width: "100%",
        height: "70vh",
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        background: "#020615",
        outline: "none",
        ...(containerStyle as any),
        ...style,
      }}
      className={[className, containerClassName].filter(Boolean).join(" ")}
      ref={pz.ref}
    >
      {/* Transform wrapper */}
      <div
        style={{
          transform: `translate(${pz.offset.x}px, ${pz.offset.y}px) scale(${pz.scale})`,
          transformOrigin: "0 0",
          width: contentWidth,
          height: contentHeight,
        }}
      >
        {children}
      </div>

      {overlay ? (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 70 }}>
          <div style={{ pointerEvents: 'auto' }}>{overlay}</div>
        </div>
      ) : null}

      {enableMiniMap && (
        <MiniMap
          scale={pz.scale}
          offset={pz.offset}
          contentWidth={contentWidth}
          contentHeight={contentHeight}
          containerWidth={pz.containerSize.width}
          containerHeight={pz.containerSize.height}
          content={miniMapContent}
          buildMode={buildMode}
          onRecenter={recenterTo}
        />
      )}
    </div>
  );
}
