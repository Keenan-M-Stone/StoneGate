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
  color?: string;
  column: number;
  qbits: number[];
  matrix: ComplexNumber[][];
}

export interface AtomicGate extends BaseGate {
  type: "atomic";
}

export interface CompositeGate extends BaseGate {
  type: "composite";
  subCircuit: CircuitModel;
  qubitMapping?: number[];
}

export type GateModel = AtomicGate | CompositeGate;

export interface CircuitModel {
  id: string;
  name: string;
  gates: GateModel[];
  numQubits: number;
}

export interface QubitBundle {
  id: string;
  name: string;
  qbits: number[]; // indices in parent circuit
  color?: string;
}

interface CircuitState {
  circuit: CircuitModel;
  selectedGateIds: string[];
  selectedQubits: number[];
  bundles: QubitBundle[];
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

  // Qubit Bundle Ops
  setSelectedQubits: (ids: number[]) => void;
  toggleSelectQubit: (q: number, multi?: boolean) => void;
  clearSelectedQubits: () => void;
  createQubitBundle: (name: string, qbits: number[], color?: string) => void;
  removeQubitBundle: (id: string) => void;

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

/** small helper to create an atomic identity gate for a given qbits length */
function createIdentityAtomicGate(qbits: number[], column = 0): AtomicGate {
  const dim = 2 ** qbits.length;
  return {
    id: crypto.randomUUID(),
    type: "atomic",
    name: "Identity",
    symbol: "I",
    column,
    qbits,
    matrix: generateIdentity(dim),
  };
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  circuit: {
    id: "root",
    name: "root",
    gates: [],
    numQubits: 2,
  },
  selectedGateIds: [],
  selectedQubits: [],
  bundles: [],
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
      const updated = { ...(g as any), ...(updates as Partial<typeof g>) } as GateModel;
      return JSON.stringify(g) === JSON.stringify(updated) ? g : updated;
    });
    return { circuit: { ...s.circuit, gates: updatedGates } };
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

      // Create the subcircuit object (id & name must be strings)
      const subCircuit: CircuitModel = {
        id: crypto.randomUUID(),
        name: `subcircuit-${Date.now()}`,
        gates: selected.map((g) => ({ ...g } as GateModel)),
        numQubits: involvedQubits.length,
      };

      // Composite gate needs a matrix (we use identity placeholder — you can optionally compute reduction)
      const compositeMatrix = generateIdentity(2 ** involvedQubits.length);

      const compositeGate: CompositeGate = {
        id: crypto.randomUUID(),
        type: "composite",
        name: `Group ${Date.now()}`,
        symbol: "G",
        column: minColumn,
        qbits: involvedQubits,
        matrix: compositeMatrix,
        subCircuit,
        qubitMapping: involvedQubits.slice(),
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
      const expanded: GateModel[] = target.subCircuit.gates.map((g) => {
        const mappedQbits = g.qbits.map((q) => {
          // map subcircuit q index -> parent qbit using qubitMapping if present
          return target.qubitMapping?.[q] ?? target.qbits[q] ?? q;
        });
        return { ...(g as any), id: crypto.randomUUID(), column: target.column + (g.column ?? 0), qbits: mappedQbits } as GateModel;
      });

      return {
        circuit: { ...s.circuit, gates: [...remaining, ...expanded] },
      };
    }),
  
  /***************
   * Qubits
   ***************/  
  setSelectedQubits: (ids) => set({ selectedQubits: ids }),
  toggleSelectQubit: (q, multi) =>
    set((s) => {
      const cur = new Set(s.selectedQubits);
      if (multi) {
        if (cur.has(q)) cur.delete(q);
        else cur.add(q);
      } else {
        // replace
        cur.clear();
        cur.add(q);
      }
      return { selectedQubits: Array.from(cur) };
    }),
  
  clearSelectedQubits: () => set({ selectedQubits: [] }),
  createQubitBundle: (name, qbits, color) =>
    set((s) => {
      const id = crypto.randomUUID();
      const bundle = { id, name, qbits, color };
      return { bundles: [...(s.bundles ?? []), bundle] };
    }),
  removeQubitBundle: (id) =>
    set((s) => ({ bundles: (s.bundles ?? []).filter((b) => b.id !== id) })),


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
