// src/components/CircuitEditor.tsx
import React, { useCallback, useEffect, useRef, useState, JSX } from "react";
import { useDrag, useDrop } from "react-dnd";
import { wrapDndRef } from "../utils/dndRefHelpers";
import {
  useCircuitStore,
  GateModel,
  CircuitModel,
  CompositeGate,
  AtomicGate,
  QubitBundle,
} from "../state/useCircuitStore";

import { GateEditDialog } from "./GateEditDialog";

/* Layout constants */
const LEFT_MARGIN = 120;
const COL_WIDTH = 120;
const ROW_HEIGHT = 80;
const GATE_W = 72;
const GATE_H = 40;

/* GateView signature note:
   GateView must accept a registerRef prop. See inline GateView below (adapted from your component).
*/

/* ---------------- GateView (modified to register DOM node) ---------------- */

const GateView: React.FC<{
  gate: GateModel;
  selected: boolean;
  onSelect: (id: string, multi?: boolean) => void;
  onEdit: (g: GateModel) => void;
  registerRef?: (id: string, el: HTMLDivElement | null) => void; // NEW
}> = ({ gate, selected, onSelect, onEdit, registerRef }) => {
  const removeGate = useCircuitStore((s) => s.removeGate);
  const duplicateGate = useCircuitStore((s) => s.duplicateGate);
  const selectedGateIds = useCircuitStore((s) => s.selectedGateIds);

  const [{ isDragging }, dragRef] = useDrag({
    type: "GATE",
    item: {
      id: gate.id,
      selectedIds: selectedGateIds.includes(gate.id) ? selectedGateIds : [gate.id],
      type: "GATE",
    },
    collect: (m) => ({ isDragging: m.isDragging() }),
  });

  // combined ref: dnd + register measurement
  const localRef = useRef<HTMLDivElement | null>(null);
  const refHandler = useCallback(
    (node: HTMLDivElement | null) => {
      // attach DnD ref to node
      dragRef(node);
      // keep local ref
      localRef.current = node;
      // call registerRef to let parent measure
      if (registerRef) registerRef(gate.id, node);
    },
    [dragRef, gate.id, registerRef]
  );

  // If node size changes after mount, parent won't know; use ResizeObserver if available.
  useEffect(() => {
    if (!localRef.current || !registerRef) return;
    const el = localRef.current;
    if (typeof (window as any).ResizeObserver !== "undefined") {
      const ro = new (window as any).ResizeObserver(() => registerRef(gate.id, el));
      ro.observe(el);
      return () => ro.disconnect();
    }
    // fallback: nothing
    return;
  }, [registerRef, gate.id]);

  const isComposite = (gate as any).type === "composite";
  const bundleHeight = isComposite ? (gate.qbits.length * ROW_HEIGHT - 8) : GATE_H;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected) onSelect(gate.id);
    (window as any).__openContextAt?.(e, "gate", gate.id);
  };

  return (
    <div
      ref={refHandler}
      onClick={(e) => { e.stopPropagation(); onSelect(gate.id, e.ctrlKey || e.metaKey); }}
      onContextMenu={handleContextMenu}
      style={{
        display: "inline-block",
        padding: "6px 10px",
        margin: "4px",
        borderRadius: 6,
        background: selected ? "#9333ea" : (gate as any).color ?? "#2563eb",
        color: "white",
        opacity: isDragging ? 0.5 : 1,
        cursor: "grab",
        userSelect: "none",
        position: "relative",
        height: bundleHeight,
        minWidth: GATE_W,
      }}
    >
      {isComposite && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(147,51,234,0.12)", borderRadius: 6, pointerEvents: "none" }} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative", zIndex: 1 }}>
        <span style={{ fontWeight: 700 }}>{(gate as any).symbol || gate.name}</span>
        {selected && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={(ev) => { ev.stopPropagation(); onEdit(gate); }} title="Edit">✎</button>
            <button onClick={(ev) => { ev.stopPropagation(); duplicateGate(gate.id); }} title="Duplicate">⧉</button>
            <button onClick={(ev) => { ev.stopPropagation(); removeGate(gate.id); }} title="Delete">✕</button>
            {isComposite && (
              <button onClick={(ev) => {
                ev.stopPropagation();
                const subGates = (gate as CompositeGate).subCircuit.gates;
                subGates.forEach((g) => {
                  const mappedQbits = g.qbits.map((q) => gate.qbits[q]);
                  useCircuitStore.getState().addGate({
                    ...g,
                    id: crypto.randomUUID(),
                    column: (gate.column ?? 0) + (g.column ?? 0),
                    qbits: mappedQbits,
                  } as GateModel);
                });
                useCircuitStore.getState().removeGate(gate.id);
              }}>🔽</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------- QubitLine ---------------- (unchanged except openContextAt prop) ---------------- */

const QubitLine: React.FC<{
  index: number;
  gates: GateModel[];
  selectedGateIds: string[];
  onSelectGate: (id: string, multi?: boolean) => void;
  onEditGate: (g: GateModel) => void;
  isSelected: boolean;
  toggleSelectQubit: (i: number, multi?: boolean) => void;
  openContextAt: (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => void;
}> = ({ index, gates, selectedGateIds, onSelectGate, onEditGate, isSelected, toggleSelectQubit, openContextAt }) => {
  const moveGatesTo = useCircuitStore((s) => s.moveGatesTo);

  const [, dropRef] = useDrop({
    accept: ["GATE"],
    drop: (item: any) => {
      const qbitsForEach: Record<string, number[]> = {};
      item.selectedIds.forEach((id: string) => (qbitsForEach[id] = [index]));
      moveGatesTo(item.selectedIds, 0, qbitsForEach);
    },
  });

  const refHandler = useCallback((node: HTMLDivElement | null) => wrapDndRef(node, dropRef), [dropRef]);

  return (
    <div
      ref={refHandler}
      onClick={(e) => { e.stopPropagation(); toggleSelectQubit(index, e.ctrlKey || e.metaKey); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextAt(e, "qubit", index); }}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 12px",
        borderBottom: "1px solid #e5e7eb",
        minHeight: 36,
        background: isSelected ? "rgba(59,130,246,0.06)" : "transparent",
        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
        cursor: "pointer",
      }}
    >
      <div style={{ width: 48, color: "#6b7280", fontFamily: "monospace" }}>{`q[${index}]`}</div>
      <div style={{ flex: 1 }}>
        {gates.filter((g) => g.qbits.includes(index)).map((g) => (
          // IMPORTANT: pass registerRef from parent when used below in CircuitEditor
          <GateView key={g.id} gate={g} selected={selectedGateIds.includes(g.id)} onSelect={onSelectGate} onEdit={onEditGate} />
        ))}
      </div>
    </div>
  );
};

/* ---------------- QubitBundleLine (compact visual) ---------------- */

const QubitBundleLine: React.FC<{
  bundle: QubitBundle;
  isSelected: boolean;
  openContextAt: (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => void;
}> = ({ bundle, isSelected, openContextAt }) => {
  const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#f97316", "#ec4899", "#8b5cf6"];
  return (
    <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextAt(e, "qubit", bundle.id); }}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 12px",
        margin: "6px 0",
        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
        background: "rgba(0,0,0,0.02)",
        borderRadius: 6,
        fontSize: "0.92rem",
        cursor: "pointer",
        minHeight: 28,
      }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, color: bundle.color ?? "#0ea5e9" }}>|{bundle.name}&gt;</div>
        <div style={{ opacity: 0.75 }}>{bundle.qbits.map((q) => `q${q}`).join(", ")}</div>
        {/* compact horizontal wire */}
        <div style={{ flex: 1 }}>
          <div style={{ height: 2, background: "#e5e7eb", marginLeft: 6, marginRight: 6, borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {bundle.qbits.map((_, i) => <div key={i} style={{ width: 14, height: 8, borderRadius: 3, background: palette[i % palette.length] }} />)}
      </div>
    </div>
  );
};

/* ---------------- Main Editor ---------------- */

export const CircuitEditor: React.FC<{ circuit?: CircuitModel }> = ({ circuit }) => {
  const {
    circuit: storeCircuit,
    selectedGateIds,
    setEditingGate,
    editingGate,
    addQubit,
    removeQubit,
    addGate,
    saveCircuit,
    loadCircuit,
  } = useCircuitStore();

  const c = circuit ?? storeCircuit;
  const bundles = useCircuitStore((s) => s.bundles ?? []);
  const selectedQubits = useCircuitStore((s) => s.selectedQubits);
  const toggleSelectQubit = useCircuitStore((s) => s.toggleSelectQubit);
  const clearSelectedQubits = useCircuitStore((s) => s.clearSelectedQubits);
  const createQubitBundle = useCircuitStore((s) => s.createQubitBundle);
  const removeQubitBundle = useCircuitStore((s) => s.removeQubitBundle);
  const groupSelectedGates = useCircuitStore((s) => s.groupSelectedGates);

  // context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; kind: "gate" | "qubit" | null; targetId?: string | number } | null>(null);
  const openContextAt = (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, kind, targetId: target }); };
  (window as any).__openContextAt = openContextAt;
  const closeContext = () => setCtxMenu(null);

  // gating rect registry
  const gateRectsRef = useRef(new Map<string, DOMRect>()); // id -> DOMRect
  // gate DOM node registry — we store nodes to measure when needed
  const gateNodeRef = useRef(new Map<string, Element | null>());

  // register DOM node from GateView
  const registerGateRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      gateNodeRef.current.set(id, el);
      const rect = el.getBoundingClientRect();
      gateRectsRef.current.set(id, rect);
    } else {
      gateNodeRef.current.delete(id);
      gateRectsRef.current.delete(id);
    }
    // trigger re-render if needed (we use a small state tick)
    setTick((t) => t + 1);
  }, []);

  // small tick state to force re-render after measurements
  const [tick, setTick] = useState(0);

  // measure all registered nodes on resize / scroll
  useEffect(() => {
    const measureAll = () => {
      gateNodeRef.current.forEach((el, id) => {
        if (el && (el as Element).getBoundingClientRect) {
          gateRectsRef.current.set(id, (el as Element).getBoundingClientRect());
        }
      });
      setTick((t) => t + 1);
    };
    window.addEventListener("resize", measureAll);
    window.addEventListener("scroll", measureAll, true);
    return () => { window.removeEventListener("resize", measureAll); window.removeEventListener("scroll", measureAll, true); };
  }, []);

  /* Group Qubits */
  const handleCreateBundleFromSelection = () => {
    if (selectedQubits.length < 2) return;
    const name = `Bundle-${Date.now()}`;
    createQubitBundle(name, selectedQubits.slice());
    closeContext();
    clearSelectedQubits();
  };

  /* Group Gates */
  const handleGroupSelectedGates = () => {
    if (selectedGateIds.length < 2) return;
    groupSelectedGates();
    closeContext();
  };

  const handleUnbundle = (bundleId?: string | number) => {
    if (!bundleId) return;
    removeQubitBundle(String(bundleId));
    closeContext();
  };

  /* Add identity gate (atomic) */
  const handleAddGate = () => {
    if (c.numQubits === 0) return;
    const firstSelectedQbit =
      selectedGateIds.length > 0
        ? useCircuitStore.getState().circuit.gates.find((g) => g.id === selectedGateIds[0])?.qbits[0] ?? 0
        : 0;

    const newGate: AtomicGate = {
      id: crypto.randomUUID(),
      type: "atomic",
      name: "Identity",
      symbol: "I",
      qbits: [firstSelectedQbit],
      column: 0,
      matrix: [
        [{ re: 1, im: 0 }, { re: 0, im: 0 }],
        [{ re: 0, im: 0 }, { re: 1, im: 0 }],
      ],
    };

    addGate(newGate as GateModel);
  };

  const handleSelectGate = (id: string, multi?: boolean) => {
    const current = useCircuitStore.getState().selectedGateIds;
    const newSelection = multi ? [...new Set([...current, id])] : [id];
    useCircuitStore.setState({ selectedGateIds: newSelection });
  };
  const handleEditGate = (g: GateModel) => setEditingGate(g);

  // Row Y coordinate for a qubit index (based on the rendered list)
  const rowY = (i: number) => {
    // we render bundle rows and skip non-head members; for measurement consistency we use constant spacing
    const top = 40; // small top padding
    return top + i * (ROW_HEIGHT / 2); // use half-height spacing to allow compact bundles
  };

  // Column X coordinate for a column index in circuit layout
  const columnX = (col: number) => LEFT_MARGIN + col * COL_WIDTH;

  // Render QC-standard connectors SVG
  const renderConnectorsSVG = () => {
    // For each composite gate or any gate that spans multiple qbits, draw single gate node and straight connectors
    const elements: JSX.Element[] = [];
    c.gates.forEach((g) => {
      // if gate is atomic on one qubit, connectors are trivial (wire crosses through)
      if (g.qbits.length <= 1) return;

      const rect = gateRectsRef.current.get(g.id);
      // If we have a measured rect, compute center; otherwise, approximate by column
      const gateCenterX = rect ? rect.left + rect.width / 2 : columnX(g.column ?? 0) + GATE_W / 2;
      const gateCenterY = rect ? rect.top + rect.height / 2 : rowY(g.qbits[0]);

      // For each qubit this gate touches: draw a vertical line from qubit row to the gate center Y,
      // then a short horizontal stub into the gate center X (QC-standard).
      g.qbits.forEach((q, idx) => {
        // if this qubit is inside a bundle (non-head), compute its effective Y:
        // we'll map each q to its nominal y
        const y = rowY(q);
        // choose a small stub length
        const stubX = gateCenterX - 12;
        // vertical line path: from qubit row y to gateCenterY
        const verticalD = `M ${stubX} ${y} L ${stubX} ${gateCenterY}`;
        const horizD = `M ${stubX} ${gateCenterY} L ${gateCenterX - 6} ${gateCenterY}`;
        // choose color depending on bundle membership
        const col = (() => {
          const found = bundles.find((b) => b.qbits.includes(q));
          return found?.color ?? "#0ea5e9";
        })();

        elements.push(<path key={`${g.id}-v-${q}`} d={verticalD} stroke={col} strokeWidth={2} fill="none" strokeLinecap="round" />);
        elements.push(<path key={`${g.id}-h-${q}`} d={horizD} stroke={col} strokeWidth={2} fill="none" strokeLinecap="round" />);
        // small node at gate connection
        elements.push(<circle key={`${g.id}-dot-${q}`} cx={gateCenterX - 6} cy={gateCenterY} r={3} fill={col} />);
      });

      // draw single gate body outline highlight (box for composite)
      // draw at measured rect position if available, otherwise approximate at columnX/g.qbits[0]
      if (rect) {
        const x = rect.left;
        const y = rect.top;
        const w = rect.width;
        const h = rect.height;
        if ((g as CompositeGate).type === "composite") {
          elements.push(<rect key={`box-${g.id}`} x={x} y={y} width={w} height={h} rx={6} fill="rgba(139,92,246,0.12)" stroke="rgba(139,92,246,0.4)" strokeWidth={1} />);
        } else {
          // atomic drawn elsewhere (GateView) — optional circle overlay
          elements.push(<circle key={`circle-${g.id}`} cx={x + w / 2} cy={y + h / 2} r={Math.max(8, Math.min(16, h / 3))} fill="rgba(37,99,235,0.12)" stroke="rgba(37,99,235,0.3)" />);
        }
      } else {
        // approximate gate body at column / first qbit
        const approxX = columnX(g.column ?? 0);
        const approxY = rowY(g.qbits[0]) - GATE_H / 2;
        if ((g as CompositeGate).type === "composite") {
          elements.push(<rect key={`box-a-${g.id}`} x={approxX} y={approxY} width={GATE_W} height={GATE_H} rx={6} fill="rgba(139,92,246,0.12)" stroke="rgba(139,92,246,0.4)" strokeWidth={1} />);
        }
      }
    });

    // return overlay SVG positioned fixed/absolute so paths overlay the editor
    if (elements.length === 0) return null;
    const height = Math.max(200, c.numQubits * (ROW_HEIGHT / 2) + 80);
    return (
      <svg style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 5 }} width="100%" height={height}>
        {elements}
      </svg>
    );
  };

  /* Render helpers */
  const renderQubitOrBundle = (i: number) => {
    const headBundle = bundles.find((b) => b.qbits[0] === i);
    if (headBundle) {
      return <QubitBundleLine key={`bundle-${headBundle.id}`} bundle={headBundle} isSelected={headBundle.qbits.some((q) => selectedQubits.includes(q))} openContextAt={openContextAt} />;
    }
    // skip non-head bundle members
    if (bundles.some((b) => b.qbits.includes(i) && b.qbits[0] !== i)) return null;
    return <QubitLine key={i} index={i} gates={c.gates} selectedGateIds={selectedGateIds} onSelectGate={handleSelectGate} onEditGate={handleEditGate} isSelected={selectedQubits.includes(i)} toggleSelectQubit={toggleSelectQubit} openContextAt={openContextAt} />;
  };

  return (
    <div className="p-4 bg-gray-50 h-full" style={{ position: "relative" }}>
      <div className="flex gap-2 mb-4">
        <button onClick={handleAddGate} className="bg-blue-500 text-white px-2 py-1 rounded">Add Identity</button>
        <button onClick={addQubit} className="bg-green-500 text-white px-2 py-1 rounded">Add Qubit</button>
        <button onClick={removeQubit} className="bg-yellow-500 text-white px-2 py-1 rounded">Remove Qubit</button>
        <button onClick={saveCircuit} className="bg-indigo-500 text-white px-2 py-1 rounded">Save</button>
        <button onClick={loadCircuit} className="bg-purple-500 text-white px-2 py-1 rounded">Load</button>
      </div>

      {/* Qubits / bundles (compact) */}
      <div>
        {Array.from({ length: c.numQubits }).map((_, i) => renderQubitOrBundle(i))}
      </div>

      {/* connectors overlay (QC-standard single node connectors for grouped gates) */}
      {renderConnectorsSVG()}

      {/* context menu (unchanged) */}
      {ctxMenu && (
        <div style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, background: "white", border: "1px solid #ddd", boxShadow: "0 6px 18px rgba(0,0,0,0.08)", zIndex: 2000, padding: 8, borderRadius: 6 }}>
          {ctxMenu.kind === "gate" && selectedGateIds.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleGroupSelectedGates}>Group selected gates</div>}
          {ctxMenu.kind === "gate" && typeof ctxMenu.targetId === "string" && (() => {
            const g = c.gates.find((x) => x.id === ctxMenu.targetId);
            if (g && (g as CompositeGate).type === "composite") return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => { useCircuitStore.getState().ungroupCompositeGate(g.id); closeContext(); }}>Expand / Ungroup</div>;
            return null;
          })()}
          {ctxMenu.kind === "qubit" && selectedQubits.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleCreateBundleFromSelection}>Create bundle from selected qubits</div>}
          {ctxMenu.kind === "qubit" && typeof ctxMenu.targetId !== "undefined" && (() => {
            const maybe = bundles.find((b) => b.id === String(ctxMenu.targetId) || b.qbits[0] === Number(ctxMenu.targetId));
            if (maybe) return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => handleUnbundle(maybe.id)}>Unbundle qubits</div>;
            return null;
          })()}
        </div>
      )}

      {/* gate edit modal */}
      {editingGate && <GateEditDialog gate={editingGate} totalQubits={c.numQubits} onSave={(g) => { useCircuitStore.getState().updateGate(g.id, g); setEditingGate(null); }} onCancel={() => setEditingGate(null)} />}
    </div>
  );
};
