// src/state/useCircuitStore.ts
import { create } from "zustand";

export interface ComplexNumber { re: number; im: number; }

export interface BaseGate {
  id: string;
  name: string;
  symbol: string;
  color?: string;
  column: number;
  qbits: number[];
  matrix: ComplexNumber[][];
}

export interface AtomicGate extends BaseGate { type: "atomic"; }
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

  // history (for option A snapshot undo/redo)
  past: CircuitModel[];
  future: CircuitModel[];

  // Basic ops
  addGate: (gate: GateModel) => void;
  removeGate: (id: string) => void;
  updateGate: (id: string, updates: Partial<GateModel> | GateModel) => void;
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

  // Undo/Redo (Option A — full snapshot)
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

function generateIdentity(dim: number): ComplexNumber[][] {
  return Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => ({ re: r === c ? 1 : 0, im: 0 }))
  );
}

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
  // helper to deep clone a circuit snapshot
  const snapshot = (c: CircuitModel) => JSON.parse(JSON.stringify(c)) as CircuitModel;

  // helper that records current circuit to past, clears future, and applies change
  const applyWithSnapshot = (changer: (s: CircuitState) => Partial<CircuitState>) =>
    set((s) => {
      const before = snapshot(s.circuit);
      const changes = changer(s) || {};
      return {
        ...changes,
        past: [...s.past, before],
        future: [],
      } as Partial<CircuitState> as CircuitState;
    });

  return {
    // initial app state
    circuit: { id: "root", name: "root", gates: [], numQubits: 2 },
    selectedGateIds: [],
    selectedQubits: [],
    bundles: [],
    editingGate: null,
    past: [],
    future: [],

    /* ---------------- basic ops ---------------- */
    addGate: (gate) =>
      applyWithSnapshot((s) => ({ circuit: { ...s.circuit, gates: [...s.circuit.gates, gate] } })),

    removeGate: (id) =>
      applyWithSnapshot((s) => ({ circuit: { ...s.circuit, gates: s.circuit.gates.filter((g) => g.id !== id) } })),

    updateGate: (id, updates) =>
      applyWithSnapshot((s) => {
        const updatedGates = s.circuit.gates.map((g) => {
          if (g.id !== id) return g;
          // If updates looks like a full GateModel (has matrix and qbits) replace entirely,
          // otherwise shallow merge partials.
          const maybeFull = updates as GateModel;
          if ((maybeFull as GateModel).matrix !== undefined && (maybeFull as GateModel).qbits !== undefined) {
            return { ...(maybeFull as GateModel) };
          } else {
            return { ...(g as any), ...(updates as Partial<typeof g>) } as GateModel;
          }
        });
        return { circuit: { ...s.circuit, gates: updatedGates } };
      }),

    duplicateGate: (id) =>
      applyWithSnapshot((s) => {
        const g = s.circuit.gates.find((x) => x.id === id);
        if (!g) return {};
        const dup = { ...g, id: crypto.randomUUID(), column: (g.column ?? 0) + 1 };
        return { circuit: { ...s.circuit, gates: [...s.circuit.gates, dup] } };
      }),

    moveGatesTo: (ids, column, qbitsForEach) =>
      applyWithSnapshot((s) => ({
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

    /* ---------------- qubits ---------------- */
    addQubit: () =>
      applyWithSnapshot((s) => ({ circuit: { ...s.circuit, numQubits: s.circuit.numQubits + 1 } })),

    removeQubit: () =>
      applyWithSnapshot((s) => {
        const newCount = Math.max(1, s.circuit.numQubits - 1);
        return {
          circuit: {
            ...s.circuit,
            numQubits: newCount,
            gates: s.circuit.gates.filter((g) => g.qbits.every((q) => q < newCount)),
          },
        };
      }),

    /* ------------- grouping / composite ------------- */
    groupSelectedGates: () =>
      applyWithSnapshot((s) => {
        const ids = s.selectedGateIds;
        if (ids.length < 2) return {};
        const selected = s.circuit.gates.filter((g) => ids.includes(g.id));
        const remaining = s.circuit.gates.filter((g) => !ids.includes(g.id));
        const minColumn = Math.min(...selected.map((g) => g.column));
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

        return {
          circuit: { ...s.circuit, gates: [...remaining, compositeGate] },
          selectedGateIds: [],
        };
      }),

    ungroupCompositeGate: (id) =>
      applyWithSnapshot((s) => {
        const target = s.circuit.gates.find((g): g is CompositeGate => g.id === id && g.type === "composite");
        if (!target) return {};
        const remaining = s.circuit.gates.filter((g) => g.id !== id);
        const expanded: GateModel[] = target.subCircuit.gates.map((g) => {
          const mappedQbits = g.qbits.map((q) => target.qubitMapping?.[q] ?? target.qbits[q] ?? q);
          return { ...(g as any), id: crypto.randomUUID(), column: target.column + (g.column ?? 0), qbits: mappedQbits } as GateModel;
        });
        return { circuit: { ...s.circuit, gates: [...remaining, ...expanded] } };
      }),

    /* ------------- qubit bundles ------------- */
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
      applyWithSnapshot((s) => {
        const id = crypto.randomUUID();
        const bundle: QubitBundle = { id, name, qbits: [...qbits].sort((a, b) => a - b), color };
        return { bundles: [...s.bundles, bundle] };
      }),

    removeQubitBundle: (id) =>
      applyWithSnapshot((s) => ({ bundles: s.bundles.filter((b) => b.id !== id) })),

    /* ------------- persistence ------------- */
    saveCircuit: () => {
      const { circuit } = get();
      localStorage.setItem("circuit", JSON.stringify(circuit));
    },

    loadCircuit: () => {
      const data = localStorage.getItem("circuit");
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as CircuitModel;
        // loading a circuit is a snapshot-worthy action
        applyWithSnapshot(() => ({ circuit: parsed }));
      } catch {
        // noop
      }
    },

    /* ------------- undo / redo (Option A — snapshots) ------------- */
    undo: () =>
      set((s) => {
        if (!s.past?.length) return s;
        const prev = s.past[s.past.length - 1];
        const newPast = s.past.slice(0, -1);
        const newFuture = [snapshot(s.circuit), ...(s.future ?? [])];
        return { circuit: snapshot(prev), past: newPast, future: newFuture } as Partial<CircuitState> as CircuitState;
      }),

    redo: () =>
      set((s) => {
        if (!s.future?.length) return s;
        const next = s.future[0];
        const newFuture = s.future.slice(1);
        const newPast = [...(s.past ?? []), snapshot(s.circuit)];
        return { circuit: snapshot(next), past: newPast, future: newFuture } as Partial<CircuitState> as CircuitState;
      }),

    clearHistory: () => set((s) => ({ past: [], future: [] })),
  };
});
