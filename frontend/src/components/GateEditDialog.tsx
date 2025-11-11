import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog' //"@/components/ui/dialog";
import { Input }  from './ui/input'  //"@/components/ui/input";
import { Button } from './ui/button' //"@/components/ui/button";
import { useCircuitStore, GateModel } from "../state/useCircuitStore";
import { parse } from "papaparse";

/******* Type Defs *******/
interface GateEditDialogProps {
  gate: GateModel;
  onSave: (gate: GateModel) => void;
  onCancel: () => void;
}

interface ComplexNumber {
  re: number;
  im: number;
}

/******* Dialogs *******/
export const GateEditDialog: React.FC<GateEditDialogProps> = ({ gate, onSave, onCancel }) => {
  const editingGate = useCircuitStore((s) => s.editingGate);
  const setEditingGate = useCircuitStore((s) => s.setEditingGate);
  const updateGate = useCircuitStore((s) => s.updateGate);

  const magnitude = (c: ComplexNumber) => Math.sqrt(c.re ** 2 + c.im ** 2);

  const [name, setName] = useState(gate.name);
  const [symbol, setSymbol] = useState(gate.symbol);
  const [qbits, setQbits] = useState<number[]>([...gate.qbits]);
  const [numQubits, setNumQubits] = useState(1);
  const [matrix, setMatrix] = useState<ComplexNumber[][]>([
    [{ re: 1, im: 0 }, { re: 0, im: 0 }],
    [{ re: 0, im: 0 }, { re: 1, im: 0 }],
  ]);

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

  // Load gate values when editingGate changes
  useEffect(() => {
    if (editingGate) {
      setName(editingGate.name);
      setSymbol(editingGate.symbol);
      setNumQubits(editingGate.qbits.length);
      const dim = 2 ** editingGate.qbits.length;
      setMatrix(generateIdentity(dim));
    }
  }, [editingGate]);


  const handleSave = () => {
    onSave({ ...gate, name, symbol, qbits });
  };

  /*
  const handleSave = () => {
    if (!editingGate) return;
    updateGate(editingGate.id, {
      name,
      symbol,
      qbits: Array.from({ length: numQubits }, (_, i) => i),
      // You might later replace this with a proper complex matrix, for now just identity.
    });
    setEditingGate(null);
  };
  */

  const handleCancel = () => setEditingGate(null);

  const handleChangeMatrix = (r: number, c: number, field: "re" | "im", val: number) => {
    setMatrix((m) => {
      const copy = m.map((row) => row.map((cell) => ({ ...cell })));
      copy[r][c][field] = val;
      return copy;
    });
  };

  const generateIdentity = (dim: number): ComplexNumber[][] =>
    Array.from({ length: dim }, (_, r) =>
      Array.from({ length: dim }, (_, c) => ({
        re: r === c ? 1 : 0,
        im: 0,
      }))
    );

  const handleNumQubitsChange = (val: number) => {
    const newNum = Math.max(1, Math.min(4, val)); // Limit to 4 for practicality
    setNumQubits(newNum);
    const dim = 2 ** newNum;
    setMatrix(generateIdentity(dim));
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
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              value={val.re}
                              onChange={(e) => handleChangeMatrix(r, c, "re", parseFloat(e.target.value) || 0)}
                              className="w-12 text-center"
                            />
                            <Input
                              type="number"
                              value={val.im}
                              onChange={(e) => handleChangeMatrix(r, c, "im", parseFloat(e.target.value) || 0)}
                              className="w-12 text-center"
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={handleExportJSON}>Export JSON</Button>
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
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
