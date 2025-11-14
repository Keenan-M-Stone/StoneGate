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
import { PreviewSVG } from "./PreviewSVG"; // we embed a small preview component below using layoutEngine

const generateIdentity = (dim: number): ComplexNumber[][] => Array.from({ length: dim }, (_, r) => Array.from({ length: dim }, (_, c) => ({ re: r === c ? 1 : 0, im: 0 })));

const parseComplexInput = (input: string): ComplexNumber | null => { try { const cleaned = input.replace(/\s+/g, ""); const v = math.complex(cleaned); return { re: v.re, im: v.im }; } catch { return null; } };
const formatComplex = (c?: ComplexNumber) => { if (!c) return "0"; if (c.im === 0) return `${c.re}`; if (c.re === 0) return `${c.im}i`; return `${c.re}${c.im >= 0 ? "+" : "-"}${Math.abs(c.im)}i`; };

const basicGates: Record<string, { label: string; qubits: number; matrix: ComplexNumber[][] }> = {
  I: { label: "Identity", qubits: 1, matrix: generateIdentity(2) },
  H: { label: "Hadamard", qubits: 1, matrix: [[{ re: 1/Math.sqrt(2), im: 0 }, { re: 1/Math.sqrt(2), im: 0 }], [{ re: 1/Math.sqrt(2), im: 0 }, { re: -1/Math.sqrt(2), im: 0 }]] },
  X: { label: "Pauli-X", qubits: 1, matrix: [[{ re: 0, im: 0 }, { re: 1, im: 0 }], [{ re: 1, im: 0 }, { re: 0, im: 0 }]] },
  Y: { label: "Pauli-Y", qubits: 1, matrix: [[{ re: 0, im: 0 }, { re: 0, im: -1 }], [{ re: 0, im: 1 }, { re: 0, im: 0 }]] },
  Z: { label: "Pauli-Z", qubits: 1, matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: -1, im: 0 }]] },
  CNOT: { label: "CNOT", qubits: 2, matrix: [[{ re: 1, im: 0 },{ re:0,im:0 },{ re:0,im:0 },{ re:0,im:0 }],[{ re:0,im:0 },{ re:1,im:0 },{ re:0,im:0 },{ re:0,im:0 }],[{ re:0,im:0 },{ re:0,im:0 },{ re:0,im:0 },{ re:1,im:0 }],[{ re:0,im:0 },{ re:0,im:0 },{ re:1,im:0 },{ re:0,im:0 }]] },
};

export const GateEditDialog: React.FC<{ gate: GateModel; totalQubits: number; onSave: (g: GateModel) => void; onCancel: () => void; }> = ({ gate, totalQubits, onSave, onCancel }) => {
  const setEditingGate = useCircuitStore((s) => s.setEditingGate);

  const [name, setName] = useState(gate.name || "");
  const [symbol, setSymbol] = useState(gate.symbol || "");
  const [color, setColor] = useState((gate as any).color || "#2563eb");
  const [selectedQbits, setSelectedQbits] = useState<number[]>([...(gate.qbits || [])].slice(0, totalQubits));
  const [numQubits, setNumQubits] = useState(Math.max(1, gate.qbits.length || 1));
  const [matrix, setMatrix] = useState<ComplexNumber[][]>(gate.matrix ?? generateIdentity(2 ** Math.max(1, gate.qbits.length || 1)));
  const [error, setError] = useState<string | null>(null);
  const [selectedGatePreset, setSelectedGatePreset] = useState<string>("custom");

  useEffect(() => {
    setName(gate.name || "");
    setSymbol(gate.symbol || "");
    setColor((gate as any).color || "#2563eb");
    setSelectedQbits([... (gate.qbits || [])].slice(0, totalQubits));
    const dim = gate.matrix ? gate.matrix.length : 2 ** Math.max(1, gate.qbits.length || 1);
    setMatrix(gate.matrix ? gate.matrix : generateIdentity(dim));
    const implied = Math.max(1, (gate.qbits && gate.qbits.length) || 1);
    setNumQubits(implied);
    setError(null);
  }, [gate, totalQubits]);

  const toggleQbit = (i: number) => setSelectedQbits((s) => { const cur = new Set(s); if (cur.has(i)) cur.delete(i); else cur.add(i); const out = Array.from(cur).sort((a,b)=>a-b); // adjust matrix dimension to 2^n
    const dim = 2 ** Math.max(1, out.length || 1); setMatrix((old) => { const outM = generateIdentity(dim); for (let r=0;r<Math.min(dim, old.length); r++) for (let c=0;c<Math.min(dim, (old[r]||[]).length); c++) outM[r][c]=old[r][c]; return outM; }); return out; });

  const handleCellChange = (r:number,c:number,raw:string) => {
    const parsed = parseComplexInput(raw);
    setMatrix((m)=>{ const copy = m.map(row=>row.map(cell=>({...cell}))); copy[r][c] = parsed ?? { re: NaN, im: NaN }; const anyBad = copy.some(row=>row.some(cell=>Number.isNaN(cell.re)||Number.isNaN(cell.im))); setError(anyBad ? "Some entries invalid" : null); return copy; });
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; file.text().then(t=>{ const parsed = papaParse(t, { dynamicTyping: true }).data as any[][]; const newM = parsed.map(row => row.map(val => ({ re: Number(val)||0, im: 0 }))); setMatrix(newM); setError(null); });
  };

  const handlePreset = (key:string) => { setSelectedGatePreset(key); const p = basicGates[key]; if (!p) return; setMatrix(p.matrix); setNumQubits(p.qubits); setName(p.label); setSymbol(key); setError(null); };

  const handleSave = () => {
    if (matrix.some(r=>r.some(c=>Number.isNaN(c.re)||Number.isNaN(c.im)))) { setError("Matrix contains invalid entries"); return; }
    // validation: some presets require >=2 qubits
    if (symbol === "CNOT" && selectedQbits.length < 2) { setError("CNOT requires 2 qubits"); return; }

    const out: GateModel = {
      ...gate,
      id: gate.id,
      name,
      symbol,
      color,
      column: (gate as any).column ?? 0,
      qbits: selectedQbits.length ? selectedQbits.slice() : gate.qbits.slice(),
      matrix,
      ...( (gate as CompositeGate).type === "composite" ? { type: "composite", subCircuit: (gate as CompositeGate).subCircuit, qubitMapping: (gate as CompositeGate).qubitMapping?.slice() ?? selectedQbits.slice() } : { type: "atomic" }),
    } as GateModel;

    onSave(out);
    setEditingGate(null);
  };

  return (
    <Dialog open={true} onOpenChange={() => { setEditingGate(null); onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit Gate</DialogTitle></DialogHeader>

        <div className="flex flex-col gap-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          <div className="flex gap-2">
            <Input placeholder="Name" value={name} onChange={(e)=>setName(e.target.value)} />
            <Input placeholder="Symbol" value={symbol} onChange={(e)=>setSymbol(e.target.value)} />
            <input type="color" value={color} onChange={(e)=>setColor(e.target.value)} title="Gate color" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Load Preset:</span>
            <Select onValueChange={handlePreset} value={selectedGatePreset}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Choose gate..." /></SelectTrigger>
              <SelectContent><SelectItem value="custom">Custom</SelectItem>{Object.entries(basicGates).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <span className="text-sm">Select qubits (gate maps to these circuit qubits)</span>
            <div className="flex gap-2 mt-2 flex-wrap">
              {Array.from({ length: totalQubits }).map((_,i)=>(
                <label key={i} style={{display:"inline-flex", alignItems:"center", gap:6}}>
                  <input type="checkbox" checked={selectedQbits.includes(i)} onChange={()=>toggleQbit(i)} />
                  <span>q{i}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <label>
              <span className="text-sm">Matrix size: {matrix.length} × {matrix.length} ({Math.log2(matrix.length)} qubits)</span>
            </label>
            <div style={{flex:1}}/>
            <label><span className="text-sm">Import CSV</span><input type="file" accept=".csv" onChange={handleImportCSV} /></label>
          </div>

          <div>
            <span className="text-sm">Matrix</span>
            <div className="overflow-auto mt-2 border rounded-md p-2">
              <table className="border-collapse"><tbody>
                {matrix.map((row,r)=> <tr key={r}>{row.map((cell,c)=>(<td key={c} className="p-1 border"><Input type="text" value={formatComplex(cell)} onChange={(e)=>handleCellChange(r,c,e.target.value)} className="w-28 font-mono text-center" /></td>))}</tr>)}
              </tbody></table>
            </div>
          </div>

          <div>
            <span className="text-sm">Preview</span>
            <div className="mt-2 p-2 border rounded-sm bg-white"><PreviewSVG name={name} symbol={symbol} color={color} selectedQbits={selectedQbits} numQubits={Math.max(1, selectedQbits.length||numQubits)} /></div>
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
