// src/components/GateLayer.tsx
import React from "react";
import { GateModel } from "../state/useCircuitStore";
import { gateCenterForQbits, compositeBox, atomicCircle } from "../utils/layoutEngine";

export const GateLayer: React.FC<{ gates: GateModel[]; onEdit?: (g: GateModel) => void; selectedIds?: string[] }> = ({ gates, onEdit, selectedIds = [] }) => {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", width: "100%", zIndex: 10 }}>
      <svg width="100%" height="100%">
        {gates.map((g) => {
          const center = gateCenterForQbits(g.column ?? 0, g.qbits);
          if ((g as any).type === "composite") {
            const box = compositeBox(center.x, center.y, Math.max(1, g.qbits.length - 1));
            return (
              <g key={g.id}>
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={box.rx} fill={(g as any).color ?? "#8b5cf6"} stroke={selectedIds.includes(g.id) ? "#111827" : "transparent"} strokeWidth={selectedIds.includes(g.id) ? 2 : 0} />
              </g>
            );
          } else {
            const c = atomicCircle(center.x, center.y);
            return (
              <g key={g.id}>
                <circle cx={c.cx} cy={c.cy} r={c.r} fill={(g as any).color ?? "#2563eb"} stroke={selectedIds.includes(g.id) ? "#111827" : "transparent"} strokeWidth={selectedIds.includes(g.id) ? 2 : 0} />
              </g>
            );
          }
        })}
      </svg>
    </div>
  );
};
