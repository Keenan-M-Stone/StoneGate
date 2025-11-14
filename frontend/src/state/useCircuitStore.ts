// src/state/useCircuitStore.ts
import { create } from "zustand";

export interface ComplexNumber { re: number; im: number; }
export interface BaseGate { id: string; name: string; symbol: string; color?: string; column: number; qbits: number[]; matrix: ComplexNumber[][]; }
export interface AtomicGate extends BaseGate { type: "atomic"; }
export interface CompositeGate extends BaseGate { type: "composite"; subCircuit: CircuitModel; qubitMapping?: number[]; }
export type GateModel = AtomicGate | CompositeGate;

export interface CircuitModel { id?: string; name?: string; gates: GateModel[]; numQubits: number; }

export interface QubitBundle { id: string; name: string; qbits: number[]; color?: string; }

interface CircuitState {
  circuit: CircuitModel;
  bundles: QubitBundle[];
  selectedGateIds: string[];
  selectedQubits: number[];
  editingGate?: GateModel | null;

  // history for undo/redo
  past: { circuit: CircuitModel; bundles: QubitBundle[]; selectedGateIds: string[]; selectedQubits: number[] }[];
  future: { circuit: CircuitModel; bundles: QubitBundle[]; selectedGateIds: string[]; selectedQubits: number[] }[];

  // ops
  addGate: (g: GateModel) => void;
  removeGate: (id: string) => void;
  updateGate: (id: string, newGate: GateModel) => void; // replace gate
  duplicateGate: (id: string) => void;
  moveGatesTo: (ids: string[], column: number, qbitsForEach?: Record<string, number[]>) => void;

  setEditingGate: (g: GateModel | null) => void;
  setSelectedGates: (ids: string[]) => void;

  addQubit: () => void;
  removeQubit: () => void;

  toggleSelectQubit: (q: number, multi?: boolean) => void;
  clearSelectedQubits: () => void;
  createQubitBundle: (name: string, qbits: number[], color?: string) => void;
  removeQubitBundle: (id: string) => void;

  groupSelectedGates: () => void;
  ungroupCompositeGate: (id: string) => void;

  saveCircuit: () => void;
  loadCircuit: () => void;

  undo: () => void;
  redo: () => void;
}

function generateIdentity(dim: number): ComplexNumber[][] {
  return Array.from({ length: dim }, (_, r) => Array.from({ length: dim }, (_, c) => ({ re: r === c ? 1 : 0, im: 0 })));
}

export const useCircuitStore = create<CircuitState>((set, get) => {
  const initial: CircuitModel = { id: "root", name: "root", gates: [], numQubits: 2 };

  function snapshotPush() {
    const s = get();
    set((st) => ({ past: [...st.past, { circuit: JSON.parse(JSON.stringify(s.circuit)), bundles: JSON.parse(JSON.stringify(s.bundles)), selectedGateIds: [...s.selectedGateIds], selectedQubits: [...s.selectedQubits] }], future: [] }));
  }

  return {
    circuit: initial,
    bundles: [],
    selectedGateIds: [],
    selectedQubits: [],
    editingGate: null,
    past: [],
    future: [],

    addGate: (g) => { snapshotPush(); set((s) => ({ circuit: { ...s.circuit, gates: [...s.circuit.gates, g] } })); },
    removeGate: (id) => { snapshotPush(); set((s) => ({ circuit: { ...s.circuit, gates: s.circuit.gates.filter((x) => x.id !== id) } })); },

    updateGate: (id, newGate) => { snapshotPush(); set((s) => ({ circuit: { ...s.circuit, gates: s.circuit.gates.map((g) => (g.id === id ? newGate : g)) } })); },

    duplicateGate: (id) => { snapshotPush(); set((s) => { const g = s.circuit.gates.find((x) => x.id === id); if (!g) return s; const dup = { ...g, id: crypto.randomUUID(), column: (g.column ?? 0) + 1 }; return { circuit: { ...s.circuit, gates: [...s.circuit.gates, dup] } }; }); },

    moveGatesTo: (ids, column, qbitsForEach) => { snapshotPush(); set((s) => ({ circuit: { ...s.circuit, gates: s.circuit.gates.map((g) => ids.includes(g.id) ? { ...g, column, qbits: qbitsForEach?.[g.id] ?? g.qbits } : g) } })); },

    setEditingGate: (g) => set({ editingGate: g }),
    setSelectedGates: (ids) => set({ selectedGateIds: ids }),

    addQubit: () => { snapshotPush(); set((s) => ({ circuit: { ...s.circuit, numQubits: s.circuit.numQubits + 1 } })); },
    removeQubit: () => { snapshotPush(); set((s) => { const newCount = Math.max(1, s.circuit.numQubits - 1); return { circuit: { ...s.circuit, numQubits: newCount, gates: s.circuit.gates.filter((g) => g.qbits.every((q) => q < newCount)) } }; }); },

    toggleSelectQubit: (q, multi) => set((s) => {
      const cur = new Set(s.selectedQubits);
      if (multi) { if (cur.has(q)) cur.delete(q); else cur.add(q); } else { cur.clear(); cur.add(q); }
      return { selectedQubits: Array.from(cur) };
    }),
    clearSelectedQubits: () => set({ selectedQubits: [] }),

    createQubitBundle: (name, qbits, color) => { snapshotPush(); set((s) => { const id = crypto.randomUUID(); const bundle: QubitBundle = { id, name, qbits: [...qbits].sort((a, b) => a - b), color }; return { bundles: [...s.bundles, bundle] }; }); },

    removeQubitBundle: (id) => { snapshotPush(); set((s) => ({ bundles: s.bundles.filter((b) => b.id !== id) })); },

    groupSelectedGates: () => { snapshotPush(); set((s) => {
      const ids = s.selectedGateIds; if (ids.length < 2) return s;
      const selected = s.circuit.gates.filter((g) => ids.includes(g.id));
      const remaining = s.circuit.gates.filter((g) => !ids.includes(g.id));
      const minColumn = Math.min(...selected.map((g) => g.column ?? 0));
      const involvedQubits = Array.from(new Set(selected.flatMap((g) => g.qbits))).sort((a, b) => a - b);
      const subCircuit: CircuitModel = { id: `sub-${crypto.randomUUID()}`, name: `group-${Date.now()}`, gates: selected.map((g) => ({ ...g })), numQubits: involvedQubits.length };
      const composite: CompositeGate = { id: crypto.randomUUID(), type: "composite", name: `Grouped-${Date.now()}`, symbol: "G", column: minColumn, qbits: involvedQubits, matrix: generateIdentity(2 ** involvedQubits.length), subCircuit, qubitMapping: involvedQubits.slice() } as CompositeGate;
      return { circuit: { ...s.circuit, gates: [...remaining, composite] }, selectedGateIds: [] };
    }); },

    ungroupCompositeGate: (id) => { snapshotPush(); set((s) => {
      const target = s.circuit.gates.find((g): g is CompositeGate => g.id === id && (g as CompositeGate).type === "composite");
      if (!target) return s;
      const remaining = s.circuit.gates.filter((g) => g.id !== id);
      const expanded = target.subCircuit.gates.map((g) => ({ ...g, id: crypto.randomUUID(), column: (g.column ?? 0) + (target.column ?? 0), qbits: g.qbits.map((q) => target.qubitMapping?.[q] ?? target.qbits[q] ?? q) })) as GateModel[];
      return { circuit: { ...s.circuit, gates: [...remaining, ...expanded] } };
    }); },

    saveCircuit: () => { const c = get().circuit; localStorage.setItem("circuit", JSON.stringify(c)); },
    loadCircuit: () => { const d = localStorage.getItem("circuit"); if (!d) return; try { const parsed = JSON.parse(d) as CircuitModel; snapshotPush(); set({ circuit: parsed }); } catch { } },

    undo: () => { set((s) => { if (s.past.length === 0) return s; const prev = s.past[s.past.length - 1]; const newPast = s.past.slice(0, -1); const next = { circuit: JSON.parse(JSON.stringify(s.circuit)), bundles: JSON.parse(JSON.stringify(s.bundles)), selectedGateIds: [...s.selectedGateIds], selectedQubits: [...s.selectedQubits] }; return { ...s, past: newPast, future: [next, ...s.future], circuit: prev.circuit, bundles: prev.bundles, selectedGateIds: prev.selectedGateIds, selectedQubits: prev.selectedQubits }; }); },

    redo: () => { set((s) => { if (s.future.length === 0) return s; const fut = s.future[0]; const newFuture = s.future.slice(1); const nextSnap = { circuit: JSON.parse(JSON.stringify(s.circuit)), bundles: JSON.parse(JSON.stringify(s.bundles)), selectedGateIds: [...s.selectedGateIds], selectedQubits: [...s.selectedQubits] }; return { ...s, past: [...s.past, nextSnap], future: newFuture, circuit: fut.circuit, bundles: fut.bundles, selectedGateIds: fut.selectedGateIds, selectedQubits: fut.selectedQubits }; }); },
  };
});
