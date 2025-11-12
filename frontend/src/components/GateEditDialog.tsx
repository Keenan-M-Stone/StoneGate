import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useCircuitStore, GateModel, ComplexNumber } from "../state/useCircuitStore";
import { parse } from "papaparse";
import * as math from "mathjs";

/******* Types *******/
interface GateEditDialogProps {
  gate: GateModel;
  onSave: (gate: GateModel) => void;
  onCancel: () => void;
}

/******* Helpers *******/

// Helper to safely parse complex expressions like "1 + 2i" or "exp(i*pi/3)"
const parseComplexInput = (input: string): { re: number; im: number } => {
  try {
    // math.js can interpret `i`, `pi`, `exp`, etc.
    const value = math.complex(input.replace(/\s+/g, ""));
    return { re: value.re, im: value.im };
  } catch {
    // fallback if invalid input
    return { re: 0, im: 0 };
  }
};

// Helper for converting matrix cells back to readable strings
const formatComplex = (c: { re: number; im: number }) => {
  if (c.im === 0) return `${c.re}`;
  if (c.re === 0) return `${c.im}i`;
  const sign = c.im >= 0 ? "+" : "-";
  return `${c.re} ${sign} ${Math.abs(c.im)}i`;
};

/******* Component *******/
export const GateEditDialog: React.FC<GateEditDialogProps> = ({ gate, onSave, onCancel }) => {
  const editingGate = useCircuitStore((s) => s.editingGate);
  const setEditingGate = useCircuitStore((s) => s.setEditingGate);
  const updateGate = useCircuitStore((s) => s.updateGate);

  const magnitude = (c: ComplexNumber) => Math.sqrt(c.re ** 2 + c.im ** 2);

  const [name, setName] = useState(gate.name);
  const [symbol, setSymbol] = useState(gate.symbol);
  const [numQubits, setNumQubits] = useState(gate.qbits.length);
  const [matrix, setMatrix] = useState<ComplexNumber[][]>([]);
  const [error, setError] = useState("");

useEffect(() => {
  if (editingGate) {
    setName(editingGate.name);
    setSymbol(editingGate.symbol);
    setNumQubits(editingGate.qbits.length);
    const dim = 2 ** editingGate.qbits.length;

    if (editingGate.type === "atomic") {
      setMatrix(editingGate.matrix || generateIdentity(dim));
    } else {
      // For composite gates, just fill an identity for now
      setMatrix(generateIdentity(dim));
    }
  }
}, [editingGate]);


  const generateIdentity = (dim: number): ComplexNumber[][] =>
    Array.from({ length: dim }, (_, r) =>
      Array.from({ length: dim }, (_, c) => ({
        re: r === c ? 1 : 0,
        im: 0,
      }))
    );

  const handleNumQubitsChange = (val: number) => {
    const newNum = Math.max(1, Math.min(4, val));
    setNumQubits(newNum);
    setMatrix(generateIdentity(2 ** newNum));
  };

  const handleChangeMatrix = (r: number, c: number, expr: string) => {
    const parsed = parseComplexInput(expr);
    setMatrix((m) => {
      const copy = m.map((row) => row.map((cell) => ({ ...cell })));
      if (parsed) {
        copy[r][c] = parsed;
        setError("");
      } else {
        setError(`Invalid complex value at [${r},${c}]`);
      }
      return copy;
    });
  };

  const handleSave = () => {
    if (!editingGate) return;

    if (editingGate.type === "atomic") {
      updateGate(editingGate.id, {
        name,
        symbol,
        qbits: Array.from({ length: numQubits }, (_, i) => i),
        matrix,
      });
    } else {
      updateGate(editingGate.id, {
        name,
        symbol,
        qbits: Array.from({ length: numQubits }, (_, i) => i),
      });
    }

    setEditingGate(null);
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(matrix, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "gate"}_matrix.json`;
    a.click();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => setMatrix(JSON.parse(t)));
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      const parsed = parse(t, { dynamicTyping: true }).data as number[][];
      const newMatrix = parsed.map((row) => row.map((val) => ({ re: val, im: 0 })));
      setMatrix(newMatrix);
    });
  };

  if (!editingGate) return null;

  return (
    <Dialog open={!!editingGate} onOpenChange={(open) => !open && setEditingGate(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Gate</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Symbol</span>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Number of Qubits</span>
            <Input
              type="number"
              value={numQubits}
              min={1}
              max={4}
              onChange={(e) => handleNumQubitsChange(parseInt(e.target.value))}
            />
          </label>

          <div className="mt-2">
            <span className="text-sm font-medium">Probability Density Matrix</span>
            <div className="overflow-auto mt-2 border rounded-md p-2">
              <table className="border-collapse">
                <tbody>
                  {matrix.map((row, r) => (
                    <tr key={r}>
                      {row.map((val, c) => (
                        <td key={c} className="p-1 border">
                          <Input
                            type="text"
                            value={formatComplex(val)}
                            onChange={(e) => {
                              const parsed = parseComplexInput(e.target.value);
                              setMatrix((m) => {
                                const copy = m.map((row) => row.map((cell) => ({ ...cell })));
                                copy[r][c] = parsed;
                                return copy;
                              });
                            }}
                            className="w-24 text-center font-mono"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={handleExportJSON}>
              Export JSON
            </Button>
            <label className="cursor-pointer">
              <span className="px-2 py-1 bg-gray-100 rounded-md">Import JSON</span>
              <input type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
            </label>
            <label className="cursor-pointer">
              <span className="px-2 py-1 bg-gray-100 rounded-md">Import CSV</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
            </label>
          </div>

          <div className="mt-3">
            <span className="text-sm font-medium">Matrix Preview (|value|)</span>
            <div className="grid mt-1" style={{ gridTemplateColumns: `repeat(${matrix.length}, 1fr)` }}>
              {matrix.flat().map((c, i) => (
                <div
                  key={i}
                  className="w-6 h-6 m-0.5 rounded-sm"
                  style={{
                    background: `rgba(79,70,229,${magnitude(c)})`,
                  }}
                  title={`${c.re} + ${c.im}i`}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setEditingGate(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
