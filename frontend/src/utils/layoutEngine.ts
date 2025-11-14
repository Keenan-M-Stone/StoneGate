// src/utils/layoutEngine.ts
export const LEFT_MARGIN = 120;
export const COL_WIDTH = 120;
export const ROW_HEIGHT = 80;
export const GATE_W = 72;
export const GATE_H = 40;

export type Point = { x: number; y: number };

// Compute x for column
export function columnX(col = 0) {
  return LEFT_MARGIN + col * COL_WIDTH;
}

// Compute vertical center Y for a qubit row index
export function rowY(q: number) {
  return 40 + q * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// Compute bundle header Y (compact)
export function bundleY(bundleHeadRow: number) {
  // slightly above center of first qubit
  return rowY(bundleHeadRow) - ROW_HEIGHT * 0.25;
}

// Gate center for grouped gate: center between min/max participating qbits
export function gateCenterForQbits(column: number, qbits: number[]) {
  const min = Math.min(...qbits);
  const max = Math.max(...qbits);
  const x = columnX(column) + GATE_W / 2;
  const y = (rowY(min) + rowY(max)) / 2;
  return { x, y };
}

// Straight (traditional) connector: vertical then horizontal small joint
export function straightConnectorPath(qRow: number, gateCenter: Point) {
  const sy = rowY(qRow);
  const sx = LEFT_MARGIN - 8; // left side
  const mx = sx + (gateCenter.x - sx) * 0.5;
  // path from left-> gate center with slight curve at end
  return `M ${sx} ${sy} L ${mx} ${sy} L ${gateCenter.x} ${gateCenter.y}`;
}

// Bezier connector (for bundles / long spans)
export function bezierConnectorPath(qRow: number, gateCenter: Point) {
  const sy = rowY(qRow);
  const sx = LEFT_MARGIN - 8;
  const midX = (sx + gateCenter.x) / 2;
  return `M ${sx} ${sy} C ${midX} ${sy} ${midX} ${gateCenter.y} ${gateCenter.x} ${gateCenter.y}`;
}

// Small helper to choose path style
export function connectorPathFor(qRow: number, gateCenter: Point) {
  const dy = Math.abs(rowY(qRow) - gateCenter.y);
  // if qubits separated by more than ~1.5 rows use bezier else straight
  if (dy > ROW_HEIGHT * 1.5) return bezierConnectorPath(qRow, gateCenter);
  return straightConnectorPath(qRow, gateCenter);
}

// For bundle paths: from bundle header to gate center with arc-like bezier
export function bundleToGatePath(bundleHeadRow: number, gateCenter: Point) {
  const fromX = LEFT_MARGIN - 24;
  const fromY = bundleY(bundleHeadRow);
  const midX = (fromX + gateCenter.x) / 2;
  return `M ${fromX} ${fromY} C ${midX} ${fromY - 8} ${midX} ${gateCenter.y + 8} ${gateCenter.x} ${gateCenter.y}`;
}

// Return a rectangle for composite box (centered at cx,cy)
export function compositeBox(cx: number, cy: number, qspanRows: number) {
  const w = GATE_W;
  const h = Math.max(GATE_H, (qspanRows + 0.2) * (ROW_HEIGHT / 1.8));
  return { x: cx - w / 2, y: cy - h / 2, w, h, rx: 8 };
}

// Return circle placement for atomic gate
export function atomicCircle(cx: number, cy: number) {
  const r = Math.min(GATE_W, GATE_H) / 2 - 6;
  return { cx, cy, r };
}
