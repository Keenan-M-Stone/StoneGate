// src/components/CircuitEditor.tsx
import React, { useCallback } from "react";
import { useDrag, useDrop } from "react-dnd";
import { wrapDndRef } from "../utils/dndRefHelpers";
import { useCircuitStore, GateModel, CircuitModel, CompositeGate, AtomicGate } from "../state/useCircuitStore";

import { GateEditDialog } from "./GateEditDialog"; // make sure this exists

/* Layout constants */
const LEFT_MARGIN = 120;
const COL_WIDTH = 120;
const ROW_HEIGHT = 80;
const GATE_W = 72;
const GATE_H = 40;

// type guard
const isCompositeGate = (g: GateModel): g is CompositeGate => (g as CompositeGate).type === "composite";

interface DragItem {
  id: string;
  selectedIds: string[];
  type: "GATE";
}

const DND_ITEM_TYPES = {
  GATE: "GATE",
} as const;

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
    item: {
      id: gate.id,
      selectedIds: selectedGateIds.includes(gate.id) ? selectedGateIds : [gate.id],
      type: DND_ITEM_TYPES.GATE,
    },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const refHandler = useCallback((node: HTMLDivElement | null) => wrapDndRef(node, dragRef), [dragRef]);

  return (
    <div
      ref={refHandler}
      onClick={(e) => onSelect(gate.id, e.ctrlKey)}
      style={{
        display: "inline-block",
        padding: "6px 10px",
        margin: "4px",
        borderRadius: 6,
        background: selected ? "#9333ea" : "#2563eb",
        color: "white",
        opacity: isDragging ? 0.5 : 1,
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>{gate.symbol}</span>
        {selected && (
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onEdit(gate)} title="Edit">
              ✎
            </button>
            <button onClick={() => duplicateGate(gate.id)} title="Duplicate">
              ⧉
            </button>
            <button onClick={() => removeGate(gate.id)} title="Delete">
              ✕
            </button>
            {isCompositeGate(gate) && (
              <button
                onClick={() => {
                  // expand subcircuit: add each gate from subCircuit with remapped qbits
                  const subGates = gate.subCircuit.gates;
                  subGates.forEach((g: GateModel) => {
                    // map sub-gate qbits to parent gate qbits
                    const mappedQbits = g.qbits.map((q: number) => gate.qbits[q]);
                    useCircuitStore.getState().addGate({
                      ...g,
                      id: crypto.randomUUID(),
                      column: gate.column + (g.column ?? 0),
                      qbits: mappedQbits,
                    } as GateModel);
                  });
                  // remove composite gate after expansion
                  useCircuitStore.getState().removeGate(gate.id);
                }}
                title="Expand"
              >
                🔽
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const QubitLine: React.FC<{
  index: number;
  gates: GateModel[];
  selectedGateIds: string[];
  onSelectGate: (id: string, multi?: boolean) => void;
  onEditGate: (g: GateModel) => void;
}> = ({ index, gates, selectedGateIds, onSelectGate, onEditGate }) => {
  const moveGatesTo = useCircuitStore((s) => s.moveGatesTo);

  const [, dropRef] = useDrop<DragItem, void, any>({
    accept: [DND_ITEM_TYPES.GATE],
    drop: (item) => {
      // Move all selected gates to this qubit/column
      const qbitsForEach: Record<string, number[]> = {};
      item.selectedIds.forEach((id) => (qbitsForEach[id] = [index]));
      moveGatesTo(item.selectedIds, 0, qbitsForEach);
    },
  });

  const refHandler = useCallback((node: HTMLDivElement | null) => wrapDndRef(node, dropRef), [dropRef]);

  return (
    <div
      ref={refHandler}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 12px",
        borderBottom: "1px solid #e5e7eb",
        minHeight: 48,
      }}
    >
      <div style={{ width: 48, color: "#6b7280", fontFamily: "monospace" }}>{`q[${index}]`}</div>
      <div style={{ flex: 1 }}>
        {gates
          .filter((g) => g.qbits.includes(index))
          .map((g) => (
            <GateView
              key={g.id}
              gate={g}
              selected={selectedGateIds.includes(g.id)}
              onSelect={onSelectGate}
              onEdit={onEditGate}
            />
          ))}
      </div>
    </div>
  );
};

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

  const handleAddGate = () => {
    if (c.numQubits === 0) return;
    const firstSelectedQbit =
      selectedGateIds.length > 0
        ? useCircuitStore.getState().circuit.gates.find((g) => g.id === selectedGateIds[0])?.qbits[0] ?? 0
        : 0;

    // create a proper atomic gate (1-qubit identity)
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

  return (
    <div className="p-4 bg-gray-50 h-full">
      <div className="flex gap-2 mb-4">
        <button onClick={handleAddGate} className="bg-blue-500 text-white px-2 py-1 rounded">
          Add Identity
        </button>
        <button onClick={addQubit} className="bg-green-500 text-white px-2 py-1 rounded">
          Add Qubit
        </button>
        <button onClick={removeQubit} className="bg-yellow-500 text-white px-2 py-1 rounded">
          Remove Qubit
        </button>
        <button onClick={saveCircuit} className="bg-indigo-500 text-white px-2 py-1 rounded">
          Save
        </button>
        <button onClick={loadCircuit} className="bg-purple-500 text-white px-2 py-1 rounded">
          Load
        </button>
      </div>

      <div>
        {[...Array(c.numQubits)].map((_, i) => (
          <QubitLine
            key={i}
            index={i}
            gates={c.gates}
            selectedGateIds={selectedGateIds}
            onSelectGate={handleSelectGate}
            onEditGate={handleEditGate}
          />
        ))}
      </div>

      {/* Gate edit modal */}
      {editingGate && (
        <GateEditDialog
          gate={editingGate}
          onSave={(g) => {
            useCircuitStore.getState().updateGate(g.id, g);
            setEditingGate(null);
          }}
          onCancel={() => setEditingGate(null)}
        />
      )}
    </div>
  );
};
