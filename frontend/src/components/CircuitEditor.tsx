import React, { useState } from "react";

type GateType = "H" | "X" | "Y" | "Z" | "CNOT" | "MEASURE";

interface Gate {
  id: string;
  gate: GateType;
  qubit: number;
  x: number;
}

const qubitSpacing = 100;
const gateWidth = 50;
const gateHeight = 30;

export const CircuitEditor: React.FC = () => {
  const [gates, setGates] = useState<Gate[]>([]);
  const [selectedGate, setSelectedGate] = useState<GateType>("H");

  const addGate = (qubit: number) => {
    const id = crypto.randomUUID();
    setGates([...gates, { id, gate: selectedGate, qubit, x: gates.length * 60 + 80 }]);
  };

  const removeGate = (id: string) => {
    setGates(gates.filter(g => g.id !== id));
  };

  const handleDrag = (id: string, dx: number) => {
    setGates(gates.map(g => (g.id === id ? { ...g, x: g.x + dx } : g)));
  };

  const exportScript = () => {
    const script = gates
      .sort((a, b) => a.x - b.x)
      .map(g => `${g.gate} q[${g.qubit}]`)
      .join("\n");
    alert("Generated Backend Script:\n\n" + script);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Toolbar */}
      <div className="flex items-center gap-4 bg-gray-800 p-3">
        <label>Gate:</label>
        <select
          className="bg-gray-700 px-2 py-1 rounded"
          value={selectedGate}
          onChange={e => setSelectedGate(e.target.value as GateType)}
        >
          <option>H</option>
          <option>X</option>
          <option>Y</option>
          <option>Z</option>
          <option>CNOT</option>
          <option>MEASURE</option>
        </select>

        <button
          onClick={() => addGate(0)}
          className="bg-blue-600 px-3 py-1 rounded hover:bg-blue-700"
        >
          Add to q[0]
        </button>
        <button
          onClick={() => addGate(1)}
          className="bg-green-600 px-3 py-1 rounded hover:bg-green-700"
        >
          Add to q[1]
        </button>

        <button
          onClick={exportScript}
          className="bg-purple-600 px-3 py-1 rounded hover:bg-purple-700"
        >
          Export Script
        </button>
      </div>

      {/* SVG Diagram */}
      <svg className="flex-1 w-full bg-gray-950" style={{ cursor: "grab" }}>
        {[0, 1].map(q => (
          <line
            key={q}
            x1={0}
            x2="100%"
            y1={(q + 1) * qubitSpacing}
            y2={(q + 1) * qubitSpacing}
            stroke="white"
            strokeWidth="1"
          />
        ))}

        {gates.map(g => (
          <g
            key={g.id}
            transform={`translate(${g.x}, ${(g.qubit + 1) * qubitSpacing - gateHeight / 2})`}
          >
            <rect
              width={gateWidth}
              height={gateHeight}
              fill="#2563eb"
              rx={4}
              ry={4}
              className="cursor-pointer hover:fill-blue-400"
              onClick={() => removeGate(g.id)}
            />
            <text
              x={gateWidth / 2}
              y={gateHeight / 2 + 4}
              textAnchor="middle"
              fill="white"
              fontSize="14"
              fontFamily="monospace"
            >
              {g.gate}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};
