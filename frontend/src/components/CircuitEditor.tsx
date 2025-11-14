// src/components/CircuitEditor.tsx
import React, { useCallback, useEffect } from "react";
import { useDrag, useDrop } from "react-dnd";
import { wrapDndRef } from "../utils/dndRefHelpers";
import { useCircuitStore, GateModel, CircuitModel, AtomicGate, QubitBundle } from "../state/useCircuitStore";
import { GateEditDialog } from "./GateEditDialog";
import { CircuitSVGOverlay } from "./CircuitSVGOverlay";
import { GateLayer } from "./GateLayer";
import { columnX, rowY, bundleY, LEFT_MARGIN } from "../utils/layoutEngine";

/* Layout constants are in layoutEngine */

const DND_ITEM_TYPES = { GATE: "GATE" } as const;

const GateView: React.FC<{ gate: GateModel; selected: boolean; onSelect: (id: string, multi?: boolean) => void; onEdit: (g: GateModel) => void; }> = ({ gate, selected, onSelect, onEdit }) => {
  const duplicateGate = useCircuitStore((s) => s.duplicateGate);
  const removeGate = useCircuitStore((s) => s.removeGate);
  const selectedGateIds = useCircuitStore((s) => s.selectedGateIds);

  const [{ isDragging }, dragRef] = useDrag<{ id: string; selectedIds: string[] }, void, { isDragging: boolean }>({
    type: DND_ITEM_TYPES.GATE,
    item: { id: gate.id, selectedIds: selectedGateIds.includes(gate.id) ? selectedGateIds : [gate.id] },
    collect: (m) => ({ isDragging: m.isDragging() }),
  });

  const refHandler = useCallback((node: HTMLDivElement | null) => wrapDndRef(node, dragRef), [dragRef]);

  const bundleHeight = (gate as any).type === "composite" ? (gate.qbits.length * 40) : 40;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    (window as any).__openContextAt?.(e, "gate", gate.id);
  };

  return (
    <div ref={refHandler} onClick={(e) => { e.stopPropagation(); onSelect(gate.id, e.ctrlKey || e.metaKey); }} onContextMenu={handleContextMenu}
      style={{ display: "inline-block", padding: "6px 10px", margin: "4px", borderRadius: 6, background: selected ? "#9333ea" : gate.color ?? "#2563eb", color: "white", opacity: isDragging ? 0.5 : 1, cursor: "grab", userSelect: "none", position: "relative", height: bundleHeight }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 700 }}>{gate.symbol || gate.name}</span>
        {selected && <div style={{ display: "flex", gap: 6 }}>
          <button onClick={(ev) => { ev.stopPropagation(); onEdit(gate); }}>✎</button>
          <button onClick={(ev) => { ev.stopPropagation(); duplicateGate(gate.id); }}>⧉</button>
          <button onClick={(ev) => { ev.stopPropagation(); removeGate(gate.id); }}>✕</button>
        </div>}
      </div>
    </div>
  );
};

const QubitLine: React.FC<{ index: number; gates: GateModel[]; selectedGateIds: string[]; onSelectGate: (id: string, multi?: boolean) => void; onEditGate: (g: GateModel) => void; isSelected: boolean; toggleSelectQubit: (i: number, multi?: boolean) => void; openContextAt: (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => void; }> = ({ index, gates, selectedGateIds, onSelectGate, onEditGate, isSelected, toggleSelectQubit, openContextAt }) => {
  const moveGatesTo = useCircuitStore((s) => s.moveGatesTo);

  const [, dropRef] = useDrop({ accept: [DND_ITEM_TYPES.GATE], drop: (item: any) => {
    const qbitsForEach: Record<string, number[]> = {};
    item.selectedIds.forEach((id: string) => (qbitsForEach[id] = [index]));
    moveGatesTo(item.selectedIds, 0, qbitsForEach);
  }});
  const refHandler = useCallback((n: HTMLDivElement | null) => wrapDndRef(n, dropRef), [dropRef]);

  return (
    <div ref={refHandler} onClick={(e) => { e.stopPropagation(); toggleSelectQubit(index, e.ctrlKey || e.metaKey); }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextAt(e, "qubit", index); }}
      style={{ display: "flex", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid #e5e7eb", minHeight: 36, background: isSelected ? "rgba(59,130,246,0.06)" : "transparent", borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent", cursor: "pointer" }}>
      <div style={{ width: 48, color: "#6b7280", fontFamily: "monospace" }}>{`q[${index}]`}</div>
      <div style={{ flex: 1 }}>
        {gates.filter((g) => g.qbits.includes(index)).map((g) => <GateView key={g.id} gate={g} selected={selectedGateIds.includes(g.id)} onSelect={onSelectGate} onEdit={onEditGate} />)}
      </div>
    </div>
  );
};

const QubitBundleLine: React.FC<{ bundle: QubitBundle; isSelected: boolean; openContextAt: (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => void; }> = ({ bundle, isSelected, openContextAt }) => {
  const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#f97316", "#ec4899", "#8b5cf6"];
  const head = bundle.qbits[0];
  return (
    <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextAt(e, "qubit", bundle.id); }} style={{ display: "flex", alignItems: "center", padding: "6px 10px", margin: "6px 0", borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent", background: "rgba(0,0,0,0.02)", borderRadius: 6, fontSize: "0.92rem", cursor: "pointer", minHeight: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <svg width={180} height={36} viewBox="0 0 180 36" style={{ flex: "none" }}>
          <path d={`M 8 18 L 120 18`} stroke="#e5e7eb" strokeWidth={1} fill="none" />
          <text x={6} y={12} fontSize={12} fill={bundle.color ?? "#0ea5e9"}>{`|${bundle.name}>`}</text>
          {bundle.qbits.map((_, i) => {
            const cx = 36 + i * 18;
            const cy = 18;
            const d = `M ${cx - 12} ${cy} q 10 -8 20 0`;
            const color = palette[i % palette.length];
            return <path key={i} d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />;
          })}
        </svg>
        <div style={{ opacity: 0.75 }}>{bundle.qbits.map((q) => `q${q}`).join(", ")}</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {bundle.qbits.map((_, i) => <div key={i} style={{ width: 14, height: 8, borderRadius: 3, background: palette[i % palette.length] }} />)}
      </div>
    </div>
  );
};

export const CircuitEditor: React.FC<{ circuit?: CircuitModel }> = ({ circuit }) => {
  const { circuit: storeCircuit, bundles, selectedGateIds, editingGate, setEditingGate, addQubit, removeQubit, addGate, saveCircuit, loadCircuit, selectedQubits, toggleSelectQubit, clearSelectedQubits, createQubitBundle, removeQubitBundle, groupSelectedGates, undo, redo } = useCircuitStore();

  const c = circuit ?? storeCircuit;

  // context menu shared
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; kind: "gate" | "qubit" | null; targetId?: string | number } | null>(null);
  const openContextAt = (e: React.MouseEvent, kind: "gate" | "qubit", target?: string | number) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, kind, targetId: target }); };
  (window as any).__openContextAt = openContextAt;
  const closeContext = () => setCtxMenu(null);

  const handleCreateBundleFromSelection = () => { if (selectedQubits.length < 2) return; const name = `Bundle-${Date.now()}`; createQubitBundle(name, selectedQubits.slice()); closeContext(); clearSelectedQubits(); };

  const handleGroupSelectedGates = () => { if (selectedGateIds.length < 2) return; groupSelectedGates(); closeContext(); };

  // keyboard undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "Z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const handleAddGate = () => {
    if (c.numQubits === 0) return;
    const firstSelectedQbit = selectedGateIds.length > 0 ? useCircuitStore.getState().circuit.gates.find((g) => g.id === selectedGateIds[0])?.qbits[0] ?? 0 : 0;
    const newGate: AtomicGate = { id: crypto.randomUUID(), type: "atomic", name: "Identity", symbol: "I", qbits: [firstSelectedQbit], column: 0, matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 1, im: 0 }]] };
    addGate(newGate as GateModel);
  };

  const handleSelectGate = (id: string, multi?: boolean) => { const current = useCircuitStore.getState().selectedGateIds; const newSelection = multi ? [...new Set([...current, id])] : [id]; useCircuitStore.setState({ selectedGateIds: newSelection }); };

  const handleEditGate = (g: GateModel) => setEditingGate(g);

  const renderQubitOrBundle = (i: number) => {
    const headBundle = bundles.find((b) => b.qbits[0] === i);
    if (headBundle) return <QubitBundleLine key={`bundle-${headBundle.id}`} bundle={headBundle} isSelected={headBundle.qbits.some((q) => selectedQubits.includes(q))} openContextAt={openContextAt} />;
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

      <div>
        {Array.from({ length: c.numQubits }).map((_, i) => renderQubitOrBundle(i))}
      </div>

      {/* overlay connectors */}
      <CircuitSVGOverlay gates={c.gates} bundles={bundles} numQubits={c.numQubits} />

      {/* gate symbols layer */}
      <GateLayer gates={c.gates} onEdit={handleEditGate} selectedIds={selectedGateIds} />

      {/* context menu */}
      {ctxMenu && (
        <div style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, background: "white", border: "1px solid #ddd", boxShadow: "0 6px 18px rgba(0,0,0,0.08)", zIndex: 2000, padding: 8, borderRadius: 6 }}>
          {ctxMenu.kind === "gate" && selectedGateIds.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleGroupSelectedGates}>Group selected gates</div>}
          {ctxMenu.kind === "gate" && typeof ctxMenu.targetId === "string" && (() => { const g = c.gates.find((x) => x.id === ctxMenu.targetId); if (g && (g as any).type === "composite") return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => { useCircuitStore.getState().ungroupCompositeGate(g.id); closeContext(); }}>Expand / Ungroup</div>; return null; })()}
          {ctxMenu.kind === "qubit" && selectedQubits.length > 1 && <div style={{ padding: 6, cursor: "pointer" }} onClick={handleCreateBundleFromSelection}>Create bundle from selected qubits</div>}
          {ctxMenu.kind === "qubit" && typeof ctxMenu.targetId !== "undefined" && (() => { const maybe = bundles.find((b) => b.id === String(ctxMenu.targetId) || b.qbits[0] === Number(ctxMenu.targetId)); if (maybe) return <div style={{ padding: 6, cursor: "pointer" }} onClick={() => { removeQubitBundle(maybe.id); closeContext(); }}>Unbundle qubits</div>; return null; })()}
        </div>
      )}

      {/* Gate edit modal */}
      {editingGate && (
        <GateEditDialog gate={editingGate} totalQubits={c.numQubits} onSave={(g) => { useCircuitStore.getState().updateGate(g.id, g); setEditingGate(null); }} onCancel={() => setEditingGate(null)} />
      )}
    </div>
  );
};
