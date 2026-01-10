import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function MeasurementPlot({ data, metric: _metric }:{data:Array<any>, metric:string}){
  return (
    <div style={{ width: '100%', height: 160 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
          <YAxis />
          <Tooltip />
          <Line dataKey="value" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}