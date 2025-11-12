import React, { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "./ui/select";
import { Alert, AlertDescription } from "./ui/alert";
import * as math from "mathjs";
import { useCircuitStore, GateModel, ComplexNumber } from "../state/useCircuitStore";

/********* Helpers *********/

const generateIdentity = (dim: number): ComplexNumber[][] =>
  Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => ({
      re: r === c ? 1 : 0,
      im: 0,
    }))
  );

const parseComplexInput = (input: string): ComplexNumber | null => {
  try {
    const v = math.complex(input.replace(/\s+/g, ""));
    return { re: v.re, im: v.im };
  } catch {
    return null;
  }
};

const formatComplex = (c: ComplexNumber) => {
  if (c.im === 0) return `${c.re}`;
  if (c.re === 0) return `${c.im}i`;
  const sign = c.im >= 0 ? "+" : "-";
  return `${c.re} ${sign} ${Math.abs(c.im)}i`;
};

/********* Basic Gates *********/

const basicGates: Record<
  string,
  { label: string; qubits: number; matrix: ComplexNumber[][] }
> = {
  I: { label: "Identity", qubits: 1, matrix: generateIdentity(2) },
  H: {
    label: "Hadamard",
    qubits: 1,
    matrix: [
      [
        { re: 1 / Math.sqrt(2), im: 0 },
        { re: 1 / Math.sqrt(2), im: 0 },
      ],
      [
        { re: 1 / Math.sqrt(2), im: 0 },
        { re: -1 / Math.sqrt(2), im: 0 },
      ],
    ],
  },
  X: {
    label: "Pauli-X",
    qubits: 1,
    matrix: [
      [
        { re: 0, im: 0 },
        { re: 1, im: 0 },
      ],
      [
        { re: 1, im: 0 },
        { re: 0, im: 0 },
      ],
    ],
  },
  Y: {
    label: "Pauli-Y",
    qubits: 1,
    matrix: [
      [
        { re: 0, im: 0 },
        { re: 0, im: -1 },
      ],
      [
        { re: 0, im: 1 },
        { re: 0, im: 0 },
      ],
    ],
  },
  Z: {
    label: "Pauli-Z",
    qubits: 1,
    matrix: [
      [
        { re: 1, im: 0 },
        { re: 0, im: 0 },
      ],
      [
        { re: 0, im: 0 },
        { re: -1, im: 0 },
      ],
    ],
  },
  CNOT: {
    label: "CNOT",
    qubits: 2,
    matrix: [
      [
        { re: 1, im: 0 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
      ],
      [
        { re: 0, im: 0 },
        { re: 1, im: 0 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
      ],
      [
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 1, im: 0 },
      ],
      [
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 1, im: 0 },
        { re: 0, im: 0 },
      ],
    ],
  },
};

/********* Component *********/

export const GateEditDialog: React.FC<{
  gate: GateModel;
  onSave: (gate: GateModel) => void;
  onCancel: () => void;
}> = ({ gate, onSave, onCancel }) => {
  // use separate selectors to avoid creating a new object on every store update
  const editingGate = useCircuitStore((s) => s.editingGate);
  const setEditingGate = useCircuitStore((s) => s.setEditingGate);
  const updateGate = useCircuitStore((s) => s.updateGate);

  /** small ref to skip the first onOpenChange invocation that Radix sometimes fires on mount */
  const skipFirstOnOpenChange = useRef(false);

  /** Local state to control Dialog open status (kept minimal — we still control via editingGate) */
  const [open, setOpen] = useState<boolean>(!!editingGate);

  /** Synchronize local open state with editingGate */
  useEffect(() => {
    // when editingGate becomes set, ensure Dialog open is true
    setOpen(!!editingGate);
    // set flag so the immediate onOpenChange call (if it happens) is ignored once
    skipFirstOnOpenChange.current = !!editingGate;
  }, [editingGate?.id]);

  /** Gate editor state */
  const [name, setName] = useState(gate.name);
  const [symbol, setSymbol] = useState(gate.symbol);
  const [numQubits, setNumQubits] = useState(gate.qbits.length);
  const [matrix, setMatrix] = useState<ComplexNumber[][]>(gate.matrix);
  const [selectedGate, setSelectedGate] = useState<string>("custom");
  const [error, setError] = useState<string | null>(null);
  const [invalidCells, setInvalidCells] = useState<Set<string>>(new Set());

  /** Reinitialize local state when editingGate changes (once per new gate) */
  useEffect(() => {
    if (!editingGate) return;

    setName(editingGate.name);
    setSymbol(editingGate.symbol);
    setNumQubits(editingGate.qbits.length);

    // Only set matrix if the reference has changed
    setMatrix(
      (prev) =>
        prev === editingGate.matrix
          ? prev
          : editingGate.matrix || generateIdentity(2 ** editingGate.qbits.length)
    );
  }, [editingGate?.id]); // depend only on gate identity, not object reference

  const validateMatrix = (m: ComplexNumber[][]) => {
    const bad = new Set<string>();
    m.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (Number.isNaN(cell.re) || Number.isNaN(cell.im)) bad.add(`${r}-${c}`);
      })
    );
    setInvalidCells(bad);
    setError(bad.size > 0 ? "Some entries contain invalid complex expressions." : null);
  };

  const handleChangeMatrix = (r: number, c: number, expr: string) => {
    const parsed = parseComplexInput(expr);
    setMatrix((m) => {
      const copy = m.map((row) => row.map((cell) => ({ ...cell })));
      copy[r][c] = parsed ?? { re: NaN, im: NaN };
      validateMatrix(copy);
      return copy;
    });
  };

  const handlePreset = (key: string) => {
    setSelectedGate(key);
    const preset = basicGates[key];
    if (preset) {
      setMatrix(preset.matrix);
      setNumQubits(preset.qubits);
      setName(preset.label);
      setSymbol(key);
      setError(null);
    }
  };

  const handleSave = () => {
    if (invalidCells.size > 0) {
      setError("Cannot save: matrix contains invalid cells.");
      return;
    }
    if (!editingGate) return;
    const updatedGate = {
      ...editingGate,
      name,
      symbol,
      qbits: Array.from({ length: numQubits }, (_, i) => i),
      matrix,
    };
    updateGate(editingGate.id, updatedGate);
    setEditingGate(null);
  };

  if (!editingGate) return null;

  return (
    <Dialog
      open={!!editingGate && open}
      onOpenChange={(isOpen) => {
        // If we set skipFirstOnOpenChange, ignore the first Radix callback that happens on mount
        if (skipFirstOnOpenChange.current) {
          // clear the flag and do not treat this as a user-close event
          skipFirstOnOpenChange.current = false;
          setOpen(isOpen);
          return;
        }

        setOpen(isOpen);
        // only clear the editingGate when dialog is closed by user interaction
        if (!isOpen) setEditingGate(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Gate</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Basic Fields */}
        <div className="flex gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Load Preset:</span>
          <Select onValueChange={handlePreset} value={selectedGate}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Choose gate..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom</SelectItem>
              {Object.entries(basicGates).map(([key, val]) => (
                <SelectItem key={key} value={key}>
                  {val.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Qubit Count */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Number of Qubits</span>
          <Input type="number" value={numQubits} min={1} max={4} onChange={(e) => setNumQubits(parseInt(e.target.value))} />
        </label>

        {/* Matrix Editor */}
        <div>
          <span className="text-sm font-medium">Matrix Editor</span>
          <div className="overflow-auto mt-2 border rounded-md p-2">
            <table className="border-collapse">
              <tbody>
                {matrix.map((row, r) => (
                  <tr key={r}>
                    {row.map((val, c) => {
                      const key = `${r}-${c}`;
                      const invalid = invalidCells.has(key);
                      return (
                        <td key={c} className="p-1 border">
                          <Input
                            type="text"
                            value={formatComplex(val)}
                            onChange={(e) => handleChangeMatrix(r, c, e.target.value)}
                            className={`w-24 text-center font-mono ${invalid ? "border-red-500 bg-red-50" : ""}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Magnitude Preview */}
        <div>
          <span className="text-sm font-medium">Magnitude Preview</span>
          <div
            className="grid mt-2"
            style={{
              gridTemplateColumns: `repeat(${matrix.length}, 1fr)`,
            }}
          >
            {matrix.flat().map((c, i) => (
              <div
                key={i}
                className="w-6 h-6 m-0.5 rounded-sm"
                style={{
                  background: `rgba(79,70,229,${Math.min(1, Math.sqrt(c.re ** 2 + c.im ** 2))})`,
                }}
                title={`${c.re} + ${c.im}i`}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
