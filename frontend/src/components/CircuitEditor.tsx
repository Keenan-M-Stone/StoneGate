// src/components/CircuitEditor.tsx
import React, { useCallback, useEffect } from "react";
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

import { GateEditDialog } from "./GateEditDialog"; // make sure this exists

/* Layout constants */
const LEFT_MARGIN = 120;
const COL_WIDTH = 120;
const ROW_HEIGHT = 80;
const GATE_W = 72;
const GATE_H = 40;

// type guard
const isCompositeGate = (g: GateModel): g is CompositeGate => (g as CompositeGate).type === "composite";

interface DragItem { id: string; selectedIds: string[]; type: "GATE"; }
const DND_ITEM_TYPES = { GATE: "GATE" } as const;

/* ---------------- GateView ---------------- */

const GateView: React.FC<{
  gate: GateModel;
  selected: boolean;
  onSelect: (id: string, multi?: boolean) => void;
  onEdit: (g: GateModel) => void;
}> = ({ gate, selected, onSelect, onEdit }) => {
  const removeGate = useCircuitStore((s) => s.removeGate);
  const duplicateGate = useCircuitStore((s) => s.duplicateGate);
  const selectedGateIds = useCircuitStore((s) => s.selectedGateIds);

  const [{ isDragging }, dragRef] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DND_ITEM_TYPES.GATE,
    item: { id: gate.id, selectedIds: selectedGateIds.includes(gate.id) ? selectedGateIds : [gate.id], type: DND_ITEM_TYPES.GATE },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const refHandler = useCallback((node: HTMLDivElement | null) => wrapDndRef(node, dragRef), [dragRef]);

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
      }}
    >
      {isComposite && <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(147, 51, 234, 0.12)", borderRadius: 6, pointerEvents: "none" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative", zIndex: 1 }}>
        <span style={{ fontWeight: 700 }}>{gate.symbol || gate.name}</span>
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
              }} title="Expand">🔽</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------- QubitLine ---------------- */

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

  const [, dropRef] = useDrop<DragItem, void, any>({
    accept: [DND_ITEM_TYPES.GATE],
    drop: (item) => {
      const qbitsForEach: Record<string, number[]> = {};
      item.selectedIds.forEach((id) => (qbitsForEach[id] = [index]));
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
          <GateView key={g.id} gate={g} selected={selectedGateIds.includes(g.id)} onSelect={onSelectGate} onEdit={onEditGate} />
        ))}
      </div>
    </div>
  );
};

/* ---------------- QubitBundleLine (compact visual) ---------------- */

const QubitBundleLine: React.FC<{
  bundle: { id: string; name: string; qbits: number[]; color?: string };
  isSelected: boolean;
  openContextAt: (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => void;
}> = ({ bundle, isSelected, openContextAt }) => {
  const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#f97316", "#ec4899", "#8b5cf6"];

  return (
    <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextAt(e, "qubit", bundle.id); }}
      style={{
        display: "flex", alignItems: "center", padding: "4px 10px", margin: "4px 0",
        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent", background: "rgba(0,0,0,0.02)",
        borderRadius: 6, fontSize: "0.92rem", cursor: "pointer", minHeight: 28,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <svg width={140} height={28} viewBox="0 0 140 28" style={{ flex: "none" }}>
          <path d="M 6 14 L 110 14" stroke="#e5e7eb" strokeWidth={1} fill="none" />
          <circle cx={12} cy={14} r={6} fill={bundle.color ?? "#0ea5e9"} />
          {bundle.qbits.map((_, i) => {
            const cx = 40 + i * 18;
            const cy = 14;
            const d = `M ${cx - 12} ${cy} q 10 -8 20 0`;
            const color = palette[i % palette.length];
            return <path key={i} d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />;
          })}
        </svg>

        <div style={{ fontWeight: 700, color: bundle.color ?? "#0ea5e9" }}>|{bundle.name}&gt;</div>
        <div style={{ opacity: 0.75, marginLeft: 6 }}>{bundle.qbits.map((q) => `q${q}`).join(", ")}</div>
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
    undo,
    redo,
  } = useCircuitStore();

  const c = circuit ?? storeCircuit;
  const bundles = useCircuitStore((s) => s.bundles ?? []);
  const selectedQubits = useCircuitStore((s) => s.selectedQubits);
  const toggleSelectQubit = useCircuitStore((s) => s.toggleSelectQubit);
  const clearSelectedQubits = useCircuitStore((s) => s.clearSelectedQubits);
  const createQubitBundle = useCircuitStore((s) => s.createQubitBundle);
  const removeQubitBundle = useCircuitStore((s) => s.removeQubitBundle);
  const groupSelectedGates = useCircuitStore((s) => s.groupSelectedGates);

  // context menu (shared for gates & qubit rows)
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; kind: "gate" | "qubit" | null; targetId?: string | number } | null>(null);

  // Expose globally, so GateView and QubitLine can invoke it
  const openContextAt = (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind, targetId: target });
  };
  (window as any).__openContextAt = openContextAt;

  const closeContext = () => setCtxMenu(null);

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

  /* Unbundle (split) */
  const handleUnbundle = (bundleId?: string | number) => {
    if (!bundleId) return;
    removeQubitBundle(String(bundleId));
    closeContext();
  };

  /* Add identity gate (atomic) */
  const handleAddGate = () => {
    if (c.numQubits === 0) return;
    const firstSelectedQbit = selectedGateIds.length > 0 ? useCircuitStore.getState().circuit.gates.find((g) => g.id === selectedGateIds[0])?.qbits[0] ?? 0 : 0;
    const newGate: AtomicGate = {
      id: crypto.randomUUID(), type: "atomic", name: "Identity", symbol: "I", qbits: [firstSelectedQbit], column: 0,
      matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 1, im: 0 }]],
    };
    addGate(newGate as GateModel);
  };

  const handleSelectGate = (id: string, multi?: boolean) => {
    const current = useCircuitStore.getState().selectedGateIds;
    const newSelection = multi ? [...new Set([...current, id])] : [id];
    useCircuitStore.setState({ selectedGateIds: newSelection });
  };

  const handleEditGate = (g: GateModel) => setEditingGate(g);

  // overlay drawing for bundles: draws curved connectors from bundle head to gates that use its qubits
  const renderBundleOverlaySVG = () => {
    if (!bundles?.length) return null;
    const width = Math.max(800, typeof window !== "undefined" ? window.innerWidth - 40 : 900);
    const height = Math.max(200, c.numQubits * (ROW_HEIGHT / 1.5) + 80);
    const columnX = (col: number) => LEFT_MARGIN + col * COL_WIDTH;
    const rowY = (q: number) => 40 + q * (ROW_HEIGHT / 2);

    const paths: { d: string; color: string }[] = [];

    bundles.forEach((b) => {
      c.gates.forEach((g) => {
        if (!g.qbits.some((q) => b.qbits.includes(q))) return;
        const fromX = 8;
        const fromY = rowY(b.qbits[0]);
        const toX = columnX(g.column ?? 0) + GATE_W / 2;
        const toY = rowY(g.qbits[0]);
        const midX = (fromX + toX) / 2;
        const d = `M ${fromX} ${fromY} C ${midX} ${fromY} ${midX} ${toY} ${toX} ${toY}`;
        paths.push({ d, color: b.color ?? "#0ea5e9" });
      });
    });

    return (
      <svg style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }} width="100%" height={height}>
        {paths.map((p, i) => <path key={i} d={p.d} stroke={p.color} strokeWidth={2} fill="none" strokeLinecap="round" />)}
      </svg>
    );
  };

  /* Render helpers - render either a bundle header or a normal qubit row */
  const renderQubitOrBundle = (i: number) => {
    const headBundle = bundles.find((b) => b.qbits[0] === i);
    if (headBundle) {
      return <QubitBundleLine key={`bundle-${headBundle.id}`} bundle={headBundle} isSelected={headBundle.qbits.some((q) => selectedQubits.includes(q))} openContextAt={openContextAt} />;
    }
    if (bundles.some((b) => b.qbits.includes(i) && b.qbits[0] !== i)) return null;
    return <QubitLine key={i} index={i} gates={c.gates} selectedGateIds={selectedGateIds} onSelectGate={handleSelectGate} onEditGate={handleEditGate} isSelected={selectedQubits.includes(i)} toggleSelectQubit={toggleSelectQubit} openContextAt={openContextAt} />;
  };

  // keyboard handlers for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const z = e.key.toLowerCase() === "z";
      const y = e.key.toLowerCase() === "y";
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;
      if (z && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((z && e.shiftKey) || y) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return (
    <div className="p-4 bg-gray-50 h-full" style={{ position: "relative" }}>
      <div className="flex gap-2 mb-4">
        <button onClick={handleAddGate} className="bg-blue-500 text-white px-2 py-1 rounded">Add Identity</button>
        <button onClick={addQubit} className="bg-green-500 text-white px-2 py-1 rounded">Add Qubit</button>
        <button onClick={removeQubit} className="bg-yellow-500 text-white px-2 py-1 rounded">Remove Qubit</button>
        <button onClick={saveCircuit} className="bg-indigo-500 text-white px-2 py-1 rounded">Save</button>
        <button onClick={loadCircuit} className="bg-purple-500 text-white px-2 py-1 rounded">Load</button>
      </div>

      <div>{Array.from({ length: c.numQubits }).map((_, i) => renderQubitOrBundle(i))}</div>

      {renderBundleOverlaySVG()}

      {ctxMenu && (
        <div style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, background: "white", border: "1px solid #ddd", boxShadow: "0 6px 18px rgba(0,0,0,0.08)", zIndex: 2000, padding: 8, borderRadius: 6 }} onMouseLeave={() => setTimeout(closeContext, 200)}>
          {/* Group gates */}
          {ctxMenu.kind === "gate" && selectedGateIds.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleGroupSelectedGates}>Group selected gates</div>}
          {ctxMenu.kind === "gate" && typeof ctxMenu.targetId === "string" && (() => {
            const g = c.gates.find((x) => x.id === ctxMenu.targetId);
            if (g && g.type === "composite") {
              return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => { useCircuitStore.getState().ungroupCompositeGate(g.id); closeContext(); }}>Expand / Ungroup</div>;
            }
            return null;
          })()}
          {ctxMenu.kind === "qubit" && selectedQubits.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleCreateBundleFromSelection}>Create bundle from selected qubits</div>}
          {ctxMenu.kind === "qubit" && typeof ctxMenu.targetId !== "undefined" && (() => {
            const maybeBundle = bundles.find((b) => b.id === String(ctxMenu.targetId) || b.qbits[0] === Number(ctxMenu.targetId));
            if (maybeBundle) return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => handleUnbundle(maybeBundle.id)}>Unbundle qubits</div>;
            return null;
          })()}
        </div>
      )}

      {editingGate && (
        <GateEditDialog
          gate={editingGate}
          totalQubits={c.numQubits}
          onSave={(g) => { useCircuitStore.getState().updateGate(g.id, g); setEditingGate(null); }}
          onCancel={() => setEditingGate(null)}
        />
      )}
    </div>
  );
};
