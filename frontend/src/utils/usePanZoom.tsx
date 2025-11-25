import React, { useRef, useEffect, useState, ReactNode } from "react";

export interface PanZoomProps {
  children: ReactNode;
  contentWidth: number;
  contentHeight: number;
  enableMiniMap?: boolean;
}

/* ------------------------------------------------------------------
   Hook: usePanZoom
   ------------------------------------------------------------------ */
export function usePanZoom(initialScale = 1) {
  const [scale, setScale] = useState(initialScale);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

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

    document.body.appendChild(menu);

    const remove = () => {
      if (document.body.contains(menu)) document.body.removeChild(menu);
      window.removeEventListener("click", remove);
    };
    window.addEventListener("click", remove);
  };

  const fitToScreen = () => {
    if (!ref.current) return;
    const wrapper = ref.current.parentElement!;
    const rect = wrapper.getBoundingClientRect();

    const scaleX = rect.width / (ref.current.scrollWidth || rect.width);
    const scaleY = rect.height / (ref.current.scrollHeight || rect.height);
    const next = Math.min(scaleX, scaleY) * 0.95;

    setScale(next);
    setOffset({ x: 20, y: 20 });
  };

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

  return {
    ref,
    scale,
    offset,
    setScale,
    setOffset,
    fitToScreen,
    reset,
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
}: {
  scale: number;
  offset: { x: number; y: number };
  contentWidth: number;
  contentHeight: number;
}) {
  const mapSize = 180;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  const vx = (-offset.x / scale) / contentWidth;
  const vy = (-offset.y / scale) / contentHeight;
  const vw = viewW / (contentWidth * scale);
  const vh = viewH / (contentHeight * scale);

  return (
    <div
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
    >
      <div
        style={{
          position: "absolute",
          left: `${vx * mapSize}px`,
          top: `${vy * mapSize}px`,
          width: `${vw * mapSize}px`,
          height: `${vh * mapSize}px`,
          border: "2px solid #39f",
          borderRadius: 4,
          pointerEvents: "none",
        }}
      />
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
}: PanZoomProps) {
  const pz = usePanZoom(1);

  return (
    <div
      style={{
        width: "100%",
        height: "70vh",
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        background: "#020615",
      }}
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

      {enableMiniMap && (
        <MiniMap
          scale={pz.scale}
          offset={pz.offset}
          contentWidth={contentWidth}
          contentHeight={contentHeight}
        />
      )}
    </div>
  );
}
