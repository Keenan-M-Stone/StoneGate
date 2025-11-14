// src/components/PreviewSVG.tsx
import React from "react";
import { rowY } from "../utils/layoutEngine";

/** Tiny preview used by GateEditDialog */
export const PreviewSVG: React.FC<{ name?: string; symbol?: string; color?: string; selectedQbits: number[]; numQubits: number; }> = ({ name, symbol, color, selectedQbits, numQubits }) => {
  const rows = Math.max(1, numQubits);
  const w = 320;
  const rowSpacing = 28;
  const h = Math.max(40, rows * rowSpacing + 8);
  const leftPad = 12;
  const boxX = 140;
  const boxW = 44;
  const boxH = Math.max(18, Math.min(28, rows * 0.6));
  const gateCenterY = (() => {
    if (selectedQbits.length === 0) return h / 2;
    const ys = selectedQbits.map((q) => leftPad + q * rowSpacing + 6);
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    return avg;
  })();

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      {Array.from({ length: rows }).map((_, i) => {
        const y = leftPad + i * rowSpacing;
        return <line key={i} x1={8} x2={w - 8} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />;
      })}
      {selectedQbits.map((q, idx) => {
        if (q >= rows) return null;
        const y = leftPad + q * rowSpacing;
        const midX = (8 + boxX) / 2;
        const d = `M ${8} ${y} Q ${midX} ${y} ${boxX} ${gateCenterY}`;
        return <path key={idx} d={d} stroke="#0ea5e9" strokeWidth={2} fill="none" />;
      })}
      <rect x={boxX} y={gateCenterY - boxH / 2} width={boxW} height={boxH} rx={4} fill={color} />
      <text x={boxX + boxW / 2} y={gateCenterY + 4} fontSize={12} textAnchor="middle" fill="#fff">{symbol || name || "G"}</text>
    </svg>
  );
};
