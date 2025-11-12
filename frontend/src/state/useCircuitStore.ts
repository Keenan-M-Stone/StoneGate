// src/state/useCircuitStore.ts
import { create } from "zustand";

export interface ComplexNumber {
  re: number;
  im: number;
}

export interface BaseGate {
  id: string;
  name: string;
  symbol: string;
  column: number;
  qbits: number[];
}

export interface AtomicGate extends BaseGate {
  type: "atomic";
  matrix: ComplexNumber[][];
}

export interface CompositeGate extends BaseGate {
  type: "composite";
  subCircuit: CircuitModel;
  qubitMapping?: number[];
}

export type GateModel = AtomicGate | CompositeGate;

export interface CircuitModel {
  gates: GateModel[];
  numQubits: number;
  matrix: ComplexNumber[][]; // composed circuit state
}

interface CircuitState {
  circuit: CircuitModel;
  selectedGateIds: string[];
  editingGate?: GateModel | null;

  // Basic ops
  addGate: (gate: GateModel) => void;
  removeGate: (id: string) => void;
  updateGate: (id: string, updates: Partial<GateModel>) => void;
  duplicateGate: (id: string) => void;
  moveGatesTo: (ids: string[], column: number, qbitsForEach?: Record<string, number[]>) => void;
  setEditingGate: (gate: GateModel | null) => void;
  setSelectedGates: (ids: string[]) => void;

  // Circuit-level ops
  addQubit: () => void;
  removeQubit: () => void;

  // Grouping / ungrouping
  groupSelectedGates: () => void;
  ungroupCompositeGate: (id: string) => void;

  // Persistence
  saveCircuit: () => void;
  loadCircuit: () => void;
}

function generateIdentity(dim: number): ComplexNumber[][] {
  return Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => ({
      re: r === c ? 1 : 0,
      im: 0,
    }))
  );
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  circuit: {
    gates: [],
    numQubits: 2,
    matrix: generateIdentity(1),
  },
  selectedGateIds: [],
  editingGate: null,

  addGate: (gate) =>
    set((s) => ({
      circuit: { ...s.circuit, gates: [...s.circuit.gates, gate] },
    })),

  removeGate: (id) =>
    set((s) => ({
      circuit: { ...s.circuit, gates: s.circuit.gates.filter((g) => g.id !== id) },
    })),

updateGate: (id, updates) =>
  set((s) => {
    const updatedGates = s.circuit.gates.map((g) => {
      if (g.id !== id) return g;
      return { ...(g as any), ...(updates as Partial<typeof g>) };
    });
    return {
      circuit: {
        ...s.circuit,
        gates: updatedGates,
      },
    };
  }),

  duplicateGate: (id) =>
    set((s) => {
      const g = s.circuit.gates.find((x) => x.id === id);
      if (!g) return s;
      const dup = { ...g, id: crypto.randomUUID(), column: g.column + 1 };
      return { circuit: { ...s.circuit, gates: [...s.circuit.gates, dup] } };
    }),

  moveGatesTo: (ids, column, qbitsForEach) =>
    set((s) => ({
      circuit: {
        ...s.circuit,
        gates: s.circuit.gates.map((g) =>
          ids.includes(g.id)
            ? { ...g, column, qbits: qbitsForEach?.[g.id] ?? g.qbits }
            : g
        ),
      },
    })),

  setEditingGate: (gate) => set({ editingGate: gate }),
  setSelectedGates: (ids) => set({ selectedGateIds: ids }),

  addQubit: () =>
    set((s) => ({
      circuit: { ...s.circuit, numQubits: s.circuit.numQubits + 1 },
    })),

  removeQubit: () =>
    set((s) => {
      const newCount = Math.max(1, s.circuit.numQubits - 1);
      return {
        circuit: {
          ...s.circuit,
          numQubits: newCount,
          gates: s.circuit.gates.filter((g) => g.qbits.every((q) => q < newCount)),
        },
      };
    }),

  /***************
   * Grouping
   ***************/
  groupSelectedGates: () =>
    set((s) => {
      const ids = s.selectedGateIds;
      if (ids.length < 2) return s; // nothing to group

      const selected = s.circuit.gates.filter((g) => ids.includes(g.id));
      const remaining = s.circuit.gates.filter((g) => !ids.includes(g.id));

      // Determine bounds for placement
      const minColumn = Math.min(...selected.map((g) => g.column));
      const involvedQubits = Array.from(
        new Set(selected.flatMap((g) => g.qbits))
      ).sort((a, b) => a - b);

      // Create the subcircuit
      const subCircuit: CircuitModel = {
        gates: selected,
        numQubits: involvedQubits.length,
        matrix: generateIdentity(2 ** involvedQubits.length),
      };

      const compositeGate: CompositeGate = {
        id: crypto.randomUUID(),
        type: "composite",
        name: "Grouped",
        symbol: "G",
        column: minColumn,
        qbits: involvedQubits,
        subCircuit,
        qubitMapping: involvedQubits,
      };

      return {
        circuit: { ...s.circuit, gates: [...remaining, compositeGate] },
        selectedGateIds: [],
      };
    }),

  /***************
   * Ungrouping
   ***************/
  ungroupCompositeGate: (id) =>
    set((s) => {
      const target = s.circuit.gates.find(
        (g): g is CompositeGate => g.id === id && g.type === "composite"
      );
      if (!target) return s;

      const remaining = s.circuit.gates.filter((g) => g.id !== id);

      // Map subcircuit gates to parent qubits
      const expanded = target.subCircuit.gates.map((g) => ({
        ...g,
        id: crypto.randomUUID(),
        column: target.column + g.column,
        qbits: g.qbits.map(
          (q, i) => target.qubitMapping?.[i] ?? target.qbits[i] ?? q
        ),
      }));

      return {
        circuit: { ...s.circuit, gates: [...remaining, ...expanded] },
      };
    }),

  /***************
   * Persistence
   ***************/
  saveCircuit: () => {
    const { circuit } = get();
    localStorage.setItem("circuit", JSON.stringify(circuit));
  },

  loadCircuit: () => {
    const data = localStorage.getItem("circuit");
    if (!data) return;
    const parsed = JSON.parse(data) as CircuitModel;
    set({ circuit: parsed });
  },
}));
