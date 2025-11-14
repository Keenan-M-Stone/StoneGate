// src/components/GateEditDialog.tsx
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "./ui/select";
import { Alert, AlertDescription } from "./ui/alert";
import * as math from "mathjs";
import { parse as papaParse } from "papaparse";
import { useCircuitStore, GateModel, ComplexNumber, CompositeGate } from "../state/useCircuitStore";

/********* Helpers *********/
const generateIdentity = (dim: number): ComplexNumber[][] =>
  Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => ({ re: r === c ? 1 : 0, im: 0 }))
  );

const parseComplexInput = (input: string): ComplexNumber | null => {
  try {
    const cleaned = input.replace(/\s+/g, "");
    const v = math.complex(cleaned);
    return { re: v.re, im: v.im };
  } catch {
    return null;
  }
};

const formatComplex = (c: ComplexNumber | undefined) => {
  if (!c) return "0";
  if (c.im === 0) return `${c.re}`;
  if (c.re === 0) return `${c.im}i`;
  const sign = c.im >= 0 ? "+" : "-";
  return `${c.re} ${sign} ${Math.abs(c.im)}i`;
};

/********* Basic Gates *********/
const basicGates: Record<string, { label: string; qubits: number; matrix: ComplexNumber[][] }> = {
  I: { label: "Identity", qubits: 1, matrix: generateIdentity(2) },
  H: { label: "Hadamard", qubits: 1, matrix: [[{ re: 1 / Math.sqrt(2), im: 0 }, { re: 1 / Math.sqrt(2), im: 0 }], [{ re: 1 / Math.sqrt(2), im: 0 }, { re: -1 / Math.sqrt(2), im: 0 }]] },
  X: { label: "Pauli-X", qubits: 1, matrix: [[{ re: 0, im: 0 }, { re: 1, im: 0 }], [{ re: 1, im: 0 }, { re: 0, im: 0 }]] },
  Y: { label: "Pauli-Y", qubits: 1, matrix: [[{ re: 0, im: 0 }, { re: 0, im: -1 }], [{ re: 0, im: 1 }, { re: 0, im: 0 }]] },
  Z: { label: "Pauli-Z", qubits: 1, matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: -1, im: 0 }]] },
  CNOT: {
    label: "CNOT", qubits: 2, matrix: [
      [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }],
    ]
  },
};

/********* Component *********/
export const GateEditDialog: React.FC<{
  gate: GateModel;
  totalQubits: number;
  onSave: (gate: GateModel) => void;
  onCancel: () => void;
}> = ({ gate, totalQubits, onSave, onCancel }) => {
  const setEditingGate = useCircuitStore((s) => s.setEditingGate);

  const [name, setName] = useState(gate.name || "");
  const [symbol, setSymbol] = useState(gate.symbol || "");
  const [color, setColor] = useState((gate as any).color || "#2563eb");
  const [selectedQbits, setSelectedQbits] = useState<number[]>([...(gate.qbits || [])]);
  const [numQubits, setNumQubits] = useState(Math.max(1, gate.qbits.length || 1));
  const [matrix, setMatrix] = useState<ComplexNumber[][]>(gate.matrix ?? generateIdentity(2 ** Math.max(1, gate.qbits.length || 1)));
  const [error, setError] = useState<string | null>(null);
  const [selectedGate, setSelectedGate] = useState<string>("custom");

  useEffect(() => {
    setName(gate.name || "");
    setSymbol(gate.symbol || "");
    setColor((gate as any).color || "#2563eb");
    setSelectedQbits([...(gate.qbits || [])].slice(0, totalQubits));
    const dim = gate.matrix ? gate.matrix.length : 2 ** Math.max(1, gate.qbits.length || 1);
    setMatrix(gate.matrix ? gate.matrix : generateIdentity(dim));
    setNumQubits(Math.max(1, (gate.qbits && gate.qbits.length) || 1));
    setError(null);
  }, [gate, totalQubits]);

  const handleNumQubitsChange = (newVal: number) => {
    const limited = Math.max(1, Math.min(totalQubits, newVal));
    setNumQubits(limited);
    const newDim = 2 ** limited;
    setMatrix((old) => {
      const out = generateIdentity(newDim);
      for (let r = 0; r < Math.min(newDim, old.length); r++) {
        for (let c = 0; c < Math.min(newDim, (old[r] || []).length); c++) out[r][c] = old[r][c];
      }
      return out;
    });
    setSelectedQbits((prev) => prev.filter((q) => q < totalQubits).slice(0, limited));
    setError(null);
  };

  const toggleQbitSelection = (i: number) => {
    setSelectedQbits((s) => {
      const cur = new Set(s);
      if (cur.has(i)) cur.delete(i); else cur.add(i);
      return Array.from(cur).sort((a, b) => a - b);
    });
  };

  const handleCellChange = (r: number, c: number, raw: string) => {
    const parsed = parseComplexInput(raw);
    setMatrix((m) => {
      const copy = m.map((row) => row.map((cell) => ({ ...cell })));
      if (!parsed) { copy[r][c] = { re: NaN, im: NaN }; setError(`Invalid complex expression at [${r},${c}]`); }
      else { copy[r][c] = parsed; const anyBad = copy.some((row) => row.some((cell) => Number.isNaN(cell.re) || Number.isNaN(cell.im))); setError(anyBad ? "Some entries invalid" : null); }
      return copy;
    });
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      const parsed = papaParse(t, { dynamicTyping: true }).data as any[][];
      const newMatrix = parsed.map((row) => row.map((val) => ({ re: Number(val) || 0, im: 0 })));
      setMatrix(newMatrix);
      setError(null);
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
    if (matrix.some((r) => r.some((c) => Number.isNaN(c.re) || Number.isNaN(c.im)))) {
      setError("Cannot save: matrix contains invalid entries");
      return;
    }

    const out: GateModel = {
      ...gate,
      id: gate.id,
      name,
      symbol,
      color,
      column: (gate as any).column ?? 0,
      qbits: selectedQbits.length ? selectedQbits.slice() : gate.qbits.slice(),
      matrix,
      ...( (gate as CompositeGate).type === "composite"
          ? { type: "composite", subCircuit: (gate as CompositeGate).subCircuit, qubitMapping: (gate as CompositeGate).qubitMapping?.slice() ?? (selectedQbits.slice()) }
          : { type: "atomic" }
      )
    } as GateModel;

    onSave(out);
    setEditingGate(null);
  };

  // mini preview:
  const PreviewSVG: React.FC = () => {
    const rows = Math.max(1, numQubits);
    const w = 320; const rowSpacing = 28; const h = Math.max(40, rows * rowSpacing + 8);
    const leftPad = 12; const boxX = 140; const boxW = 44; const boxH = Math.max(18, Math.min(28, rows * 0.6));
    const gateCenterY = (() => {
      if (selectedQbits.length === 0) return h / 2;
      const ys = selectedQbits.map((q) => leftPad + q * rowSpacing + 6);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    })();

    return (
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
        {Array.from({ length: rows }).map((_, i) => {
          const y = leftPad + i * rowSpacing;
          return <line key={i} x1={8} x2={w - 8} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />;
        })}
        {selectedQbits.map((q, idx) => {
          if (q >= rows) return null;
          const y = leftPad + q * rowSpacing;
          const midX = (8 + boxX) / 2;
          const d = `M ${8} ${y} Q ${midX} ${y} ${boxX} ${gateCenterY}`;
          return <path key={idx} d={d} stroke="#0ea5e9" strokeWidth={2} fill="none" strokeLinecap="round" />;
        })}
        <rect x={boxX} y={gateCenterY - boxH / 2} width={boxW} height={boxH} rx={4} fill={color} />
        <text x={boxX + boxW / 2} y={gateCenterY + 4} fontSize={12} textAnchor="middle" fill="#fff">{symbol || name || "G"}</text>
      </svg>
    );
  };

  return (
    <Dialog open={true} onOpenChange={() => { setEditingGate(null); onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit Gate</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex gap-2">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Gate color" />
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">Load Preset:</span>
            <Select onValueChange={handlePreset} value={selectedGate}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Choose gate..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                {Object.entries(basicGates).map(([key, val]) => <SelectItem key={key} value={key}>{val.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="text-sm">Select qubits (these indices map gate → circuit qubits)</span>
            <div className="flex gap-2 mt-2 flex-wrap">
              {Array.from({ length: totalQubits }).map((_, i) => (
                <label key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={selectedQbits.includes(i)} onChange={() => toggleQbitSelection(i)} />
                  <span>q{i}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <label>
              <span className="text-sm">Gate width (qubits)</span>
              <Input type="number" value={numQubits} min={1} max={Math.min(4, totalQubits)} onChange={(e) => handleNumQubitsChange(Number(e.target.value) || 1)} />
            </label>

            <div style={{ flex: 1 }} />

            <label>
              <span className="text-sm">Import CSV</span>
              <input type="file" accept=".csv" onChange={handleImportCSV} />
            </label>
          </div>

          <div>
            <span className="text-sm">Matrix</span>
            <div className="overflow-auto mt-2 border rounded-md p-2">
              <table className="border-collapse">
                <tbody>
                  {matrix.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="p-1 border">
                          <Input type="text" value={formatComplex(cell)} onChange={(e) => handleCellChange(r, c, e.target.value)} className="w-28 font-mono text-center" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <div className="text-red-600 mt-1">{error}</div>}
          </div>

          <div>
            <span className="text-sm">Preview</span>
            <div className="mt-2 p-2 border rounded-sm bg-white"><PreviewSVG /></div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => { setEditingGate(null); onCancel(); }}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
