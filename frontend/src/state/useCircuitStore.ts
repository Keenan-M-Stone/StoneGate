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
  qbits: number[]; // indices in parent circuit (sorted ascending)
  color?: string;
}

interface CircuitSnapshot {
  circuit: CircuitModel;
  bundles: QubitBundle[];
  selectedGateIds: string[];
  selectedQubits: number[];
}

interface CircuitState {
  circuit: CircuitModel;
  selectedGateIds: string[];
  selectedQubits: number[];
  bundles: QubitBundle[];
  editingGate?: GateModel | null;

  // Undo/Redo
  _past: CircuitSnapshot[];
  _future: CircuitSnapshot[];
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Basic ops
  addGate: (gate: GateModel) => void;
  removeGate: (id: string) => void;
  updateGate: (idOrGate: string | GateModel, updates?: Partial<GateModel>) => void; // flexible: full replace or partial
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

export const useCircuitStore = create<CircuitState>((set, get) => {
  // Helper: grab a snapshot of relevant UI state for undo/redo
  const makeSnapshot = (): CircuitSnapshot => ({
    circuit: JSON.parse(JSON.stringify(get().circuit)) as CircuitModel,
    bundles: JSON.parse(JSON.stringify(get().bundles)) as QubitBundle[],
    selectedGateIds: [...get().selectedGateIds],
    selectedQubits: [...get().selectedQubits],
  });

  return {
    /* initial present state */
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

    /* undo/redo stacks */
    _past: [],
    _future: [],
    pushSnapshot: () => {
      set((s) => {
        const snap = {
          circuit: JSON.parse(JSON.stringify(s.circuit)) as CircuitModel,
          bundles: JSON.parse(JSON.stringify(s.bundles)) as QubitBundle[],
          selectedGateIds: [...s.selectedGateIds],
          selectedQubits: [...s.selectedQubits],
        };
        return { _past: [...s._past, snap], _future: [] };
      });
    },
    undo: () =>
      set((s) => {
        if (s._past.length === 0) return s;
        const past = [...s._past];
        const last = past.pop() as CircuitSnapshot;
        const presentSnap: CircuitSnapshot = {
          circuit: JSON.parse(JSON.stringify(s.circuit)),
          bundles: JSON.parse(JSON.stringify(s.bundles)),
          selectedGateIds: [...s.selectedGateIds],
          selectedQubits: [...s.selectedQubits],
        };
        return {
          circuit: last.circuit,
          bundles: last.bundles,
          selectedGateIds: last.selectedGateIds,
          selectedQubits: last.selectedQubits,
          _past: past,
          _future: [...s._future, presentSnap],
        };
      }),
    redo: () =>
      set((s) => {
        if (s._future.length === 0) return s;
        const future = [...s._future];
        const next = future.pop() as CircuitSnapshot;
        const presentSnap: CircuitSnapshot = {
          circuit: JSON.parse(JSON.stringify(s.circuit)),
          bundles: JSON.parse(JSON.stringify(s.bundles)),
          selectedGateIds: [...s.selectedGateIds],
          selectedQubits: [...s.selectedQubits],
        };
        return {
          circuit: next.circuit,
          bundles: next.bundles,
          selectedGateIds: next.selectedGateIds,
          selectedQubits: next.selectedQubits,
          _past: [...s._past, presentSnap],
          _future: future,
        };
      }),

    /* basic ops — each mutating op should push a snapshot first */
    addGate: (gate) =>
      set((s) => {
        const snap = makeSnapshot();
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: { ...s.circuit, gates: [...s.circuit.gates, gate] },
        };
      }),

    removeGate: (id) =>
      set((s) => {
        const snap = makeSnapshot();
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: { ...s.circuit, gates: s.circuit.gates.filter((g) => g.id !== id) },
        };
      }),

    // updateGate: flexible — if caller provides a full GateModel (has matrix && qbits) we replace; otherwise merge partial updates
    updateGate: (idOrGate, updates) =>
      set((s) => {
        const snap = makeSnapshot();
        // handle call signature: updateGate(gateObj) or updateGate(id, partial)
        if (typeof idOrGate !== "string") {
          // full replace
          const gateObj = idOrGate as GateModel;
          return {
            _past: [...s._past, snap],
            _future: [],
            circuit: { ...s.circuit, gates: s.circuit.gates.map((g) => (g.id === gateObj.id ? gateObj : g)) },
          };
        } else {
          const id = idOrGate as string;
          const partial = updates as Partial<GateModel>;
          return {
            _past: [...s._past, snap],
            _future: [],
            circuit: {
              ...s.circuit,
              gates: s.circuit.gates.map((g) => {
                if (g.id !== id) return g;
                const merged = { ...(g as any), ...(partial as any) } as GateModel;
                return merged;
              }),
            },
          };
        }
      }),

    duplicateGate: (id) =>
      set((s) => {
        const g = s.circuit.gates.find((x) => x.id === id);
        if (!g) return s;
        const dup = { ...g, id: crypto.randomUUID(), column: (g.column ?? 0) + 1 };
        const snap = makeSnapshot();
        return { _past: [...s._past, snap], _future: [], circuit: { ...s.circuit, gates: [...s.circuit.gates, dup] } };
      }),

    moveGatesTo: (ids, column, qbitsForEach) =>
      set((s) => {
        const snap = makeSnapshot();
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: {
            ...s.circuit,
            gates: s.circuit.gates.map((g) =>
              ids.includes(g.id) ? { ...g, column, qbits: qbitsForEach?.[g.id] ?? g.qbits } : g
            ),
          },
        };
      }),

    setEditingGate: (gate) => set({ editingGate: gate }),
    setSelectedGates: (ids) => set({ selectedGateIds: ids }),

    addQubit: () =>
      set((s) => {
        const snap = makeSnapshot();
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: { ...s.circuit, numQubits: s.circuit.numQubits + 1 },
        };
      }),

    removeQubit: () =>
      set((s) => {
        const snap = makeSnapshot();
        const newCount = Math.max(1, s.circuit.numQubits - 1);
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: {
            ...s.circuit,
            numQubits: newCount,
            gates: s.circuit.gates.filter((g) => g.qbits.every((q) => q < newCount)),
          },
          // also clear selectedQubits that are out of range
          selectedQubits: s.selectedQubits.filter((q) => q < newCount),
        };
      }),

    /* Grouping */
    groupSelectedGates: () =>
      set((s) => {
        const ids = s.selectedGateIds;
        if (ids.length < 2) return s; // nothing to group
        const selected = s.circuit.gates.filter((g) => ids.includes(g.id));
        const remaining = s.circuit.gates.filter((g) => !ids.includes(g.id));
        const minColumn = Math.min(...selected.map((g) => g.column ?? 0));
        const involvedQubits = Array.from(new Set(selected.flatMap((g) => g.qbits))).sort((a, b) => a - b);

        const subCircuit: CircuitModel = {
          id: crypto.randomUUID(),
          name: `subcircuit-${Date.now()}`,
          gates: selected.map((g) => ({ ...g } as GateModel)),
          numQubits: involvedQubits.length,
        };

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

        const snap = makeSnapshot();
        return {
          _past: [...s._past, snap],
          _future: [],
          circuit: { ...s.circuit, gates: [...remaining, compositeGate] },
          selectedGateIds: [],
        };
      }),

    /***************
     * Ungrouping
     ***************/
    ungroupCompositeGate: (id) =>
      set((s) => {
        const target = s.circuit.gates.find((g): g is CompositeGate => g.id === id && g.type === "composite");
        if (!target) return s;
        const remaining = s.circuit.gates.filter((g) => g.id !== id);
        const expanded: GateModel[] = target.subCircuit.gates.map((g) => {
          const mappedQbits = g.qbits.map((q) => target.qubitMapping?.[q] ?? target.qbits[q] ?? q);
          return { ...(g as any), id: crypto.randomUUID(), column: target.column + (g.column ?? 0), qbits: mappedQbits } as GateModel;
        });
        const snap = makeSnapshot();
        return { _past: [...s._past, snap], _future: [], circuit: { ...s.circuit, gates: [...remaining, ...expanded] } };
      }),

    /***************
     * Qubits / Bundles
     ***************/
    setSelectedQubits: (ids) => set({ selectedQubits: ids }),
    toggleSelectQubit: (q, multi) =>
      set((s) => {
        const cur = new Set(s.selectedQubits);
        if (multi) {
          if (cur.has(q)) cur.delete(q);
          else cur.add(q);
        } else {
          cur.clear();
          cur.add(q);
        }
        return { selectedQubits: Array.from(cur) };
      }),

    clearSelectedQubits: () => set({ selectedQubits: [] }),

    createQubitBundle: (name, qbits, color) =>
      set((s) => {
        const id = crypto.randomUUID();
        const bundle = { id, name, qbits: [...qbits].sort((a, b) => a - b), color };
        const snap = makeSnapshot();
        return { _past: [...s._past, snap], _future: [], bundles: [...s.bundles, bundle], selectedQubits: [] };
      }),

    // removing bundle: permanently deletes it from bundles; adding a qubit later will not "restore" the removed bundle.
    removeQubitBundle: (id) =>
      set((s) => {
        const snap = makeSnapshot();
        return { _past: [...s._past, snap], _future: [], bundles: s.bundles.filter((b) => b.id !== id) };
      }),

    /***************
     * Persistence
     ***************/
    saveCircuit: () => {
      const { circuit, bundles } = get();
      localStorage.setItem("circuit", JSON.stringify(circuit));
      localStorage.setItem("bundles", JSON.stringify(bundles));
    },

    loadCircuit: () => {
      const data = localStorage.getItem("circuit");
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as CircuitModel;
        const parsedBundles = JSON.parse(localStorage.getItem("bundles") || "[]") as QubitBundle[];
        set({ circuit: parsed, bundles: parsedBundles });
      } catch {
        // noop on parse error
      }
    },
  };
});
