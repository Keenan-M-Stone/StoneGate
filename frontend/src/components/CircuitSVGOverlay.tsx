// src/components/CircuitSVGOverlay.tsx
import React from "react";
import { GateModel, QubitBundle } from "../state/useCircuitStore";
import { columnX, rowY, bundleY, gateCenterForQbits, connectorPathFor, bundleToGatePath } from "../utils/layoutEngine";

export const CircuitSVGOverlay: React.FC<{
  gates: GateModel[];
  bundles: QubitBundle[];
  numQubits: number;
}> = ({ gates, bundles, numQubits }) => {
  // compute gate centers for grouped gates that span multiple qubits.
  const gateCenters = gates.map((g) => ({ id: g.id, center: gateCenterForQbits(g.column ?? 0, g.qbits), qbits: g.qbits }));

  // bundle connectors: for each bundle -> for all gates that touch any qbit in bundle add a path
  const bundlePaths: { d: string; color: string }[] = [];
  bundles.forEach((b) => {
    gateCenters.forEach((gc) => {
      const overlap = gc.qbits.some((q) => b.qbits.includes(q));
      if (!overlap) return;
      bundlePaths.push({ d: bundleToGatePath(b.qbits[0], gc.center), color: b.color ?? "#0ea5e9" });
    });
  });

  // per-qubit connectors for grouped gates
  const qubitConnectorPaths: { d: string; color: string }[] = [];
  gateCenters.forEach((gc) => {
    const gateColor = "#6b7280"; // default connector color
    gc.qbits.forEach((q) => {
      qubitConnectorPaths.push({ d: connectorPathFor(q, gc.center), color: gateColor });
    });
  });

  const height = Math.max(200, numQubits * 80 + 40);

  return (
    <svg style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 5 }} width="100%" height={height}>
      {/* bundle paths under everything (so bundle header and gate markers appear above) */}
      {bundlePaths.map((p, i) => <path key={`bp-${i}`} d={p.d} stroke={p.color} strokeWidth={2.4} fill="none" strokeLinecap="round" opacity={0.95} />)}
      {/* per-qubit connectors */}
      {qubitConnectorPaths.map((p, i) => <path key={`qp-${i}`} d={p.d} stroke={p.color} strokeWidth={2} fill="none" strokeLinecap="round" />)}
    </svg>
  );
};
