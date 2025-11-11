// src/state/useCircuitStore.ts
import { create } from "zustand";

export interface GateModel {
  id: string;
  name: string;
  symbol: string;
  qbits: number[];
  column: number;
  subCircuit?: CircuitModel;
}

export interface CircuitModel {
  gates: GateModel[];
  numQubits: number;
}

interface CircuitState {
  circuit: CircuitModel;
  selectedGateIds: string[];
  editingGate?: GateModel | null;
  
  addGate: (gate: GateModel) => void;
  removeGate: (id: string) => void;
  updateGate: (id: string, updates: Partial<GateModel>) => void;
  duplicateGate: (id: string) => void;
  moveGatesTo: (ids: string[], column: number, qbitsForEach?: Record<string, number[]>) => void;
  setEditingGate: (gate: GateModel | null) => void;

  addQubit: () => void;
  removeQubit: () => void;
  saveCircuit: () => void;
  loadCircuit: () => void;
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  circuit: { gates: [], numQubits: 2 },
  selectedGateIds: [],
  editingGate: null,

  addGate: (gate) =>
    set((s) => ({
      circuit: {
        ...s.circuit,
        gates: [...s.circuit.gates, gate],
      },
    })),

  removeGate: (id) =>
    set((s) => ({
      circuit: {
        ...s.circuit,
        gates: s.circuit.gates.filter((g) => g.id !== id),
      },
    })),

  updateGate: (id, updates) =>
    set((s) => ({
      circuit: {
        ...s.circuit,
        gates: s.circuit.gates.map((g: GateModel) =>
          g.id === id ? { ...g, ...updates } : g
        ),
      },
    })),

  duplicateGate: (id) =>
    set((s) => {
      const g = s.circuit.gates.find((x) => x.id === id);
      if (!g) return s;
      const dup: GateModel = {
        ...g,
        id: crypto.randomUUID(),
        column: g.column + 1,
      };
      return {
        circuit: { ...s.circuit, gates: [...s.circuit.gates, dup] },
      };
    }),

  moveGatesTo: (ids, column, qbitsForEach) =>
    set((s) => ({
      circuit: {
        ...s.circuit,
        gates: s.circuit.gates.map((g) =>
          ids.includes(g.id)
            ? {
                ...g,
                column,
                qbits: qbitsForEach?.[g.id] ?? g.qbits,
              }
            : g
        ),
      },
    })),

  setEditingGate: (gate) => set(() => ({ editingGate: gate })),

  addQubit: () =>
    set((s) => ({
      circuit: { ...s.circuit, numQubits: s.circuit.numQubits + 1 },
    })),

  removeQubit: () =>
    set((s) => {
      const newCount = Math.max(1, s.circuit.numQubits - 1);
      return {
        circuit: {
          numQubits: newCount,
          gates: s.circuit.gates.filter((g) =>
            g.qbits.every((q) => q < newCount)
          ),
        },
      };
    }),

  saveCircuit: () => {
    const { circuit } = get();
    localStorage.setItem("circuit", JSON.stringify(circuit));
  },

  loadCircuit: () => {
    const data = localStorage.getItem("circuit");
    if (!data) return;
    const circuit = JSON.parse(data) as CircuitModel;
    set({ circuit });
  },
}));
