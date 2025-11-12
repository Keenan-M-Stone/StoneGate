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

// Lightweight parser for simple complex expressions
function parseComplex(expr: string): ComplexNumber | null {
  try {
    const cleaned = expr
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/π/g, "pi")
      .replace(/([0-9])i/g, "$1*i")
      .replace(/\^/g, "**");

    const pi = Math.PI;
    const e = Math.E;
    const i = { re: 0, im: 1 };

    const val = Function("pi", "e", "i", `
      const mul=(a,b)=>({re:a.re*b.re - a.im*b.im, im:a.re*b.im + a.im*b.re});
      const add=(a,b)=>({re:a.re+b.re, im:a.im+b.im});
      const sub=(a,b)=>({re:a.re-b.re, im:a.im-b.im});
      const expf=(x)=>({re:Math.cos(x.im)*Math.exp(x.re), im:Math.sin(x.im)*Math.exp(x.re)});
      const toC=(x)=> typeof x==='number'?{re:x,im:0}:x;
      with (Math) {
        return ${cleaned};
      }
    `)(pi, e, i);

    if (typeof val === "number") return { re: val, im: 0 };
    if (val && typeof val.re === "number" && typeof val.im === "number") return val;
    return null;
  } catch {
    return null;
  }
}

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
      const dim = 2 ** editingGate.qbits.length;
      setMatrix(editingGate.matrix || generateIdentity(dim));
      setNumQubits(editingGate.qbits.length);
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
    const parsed = parseComplex(expr);
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
    updateGate(editingGate.id, {
      ...editingGate,
      name,
      symbol,
      qbits: Array.from({ length: numQubits }, (_, i) => i),
      matrix,
    });
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
                            value={`${val.re}${val.im >= 0 ? "+" : ""}${val.im}i`}
                            onChange={(e) => handleChangeMatrix(r, c, e.target.value)}
                            className="w-28 text-center"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
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
