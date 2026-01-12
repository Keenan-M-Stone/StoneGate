// StoneGate Live Transforms script template.
//
// This file runs in the browser tab (not inside the StoneGate React UI).
// You can import from CDN URLs if you want external packages.
// Example:
//   import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'
//
// Contract:
// - export `name` (string)
// - export `transforms` (array of { id, label })
// - export `transform(ctx)` returning either:
//   - { kind:'time'|'freq', points, xLabel, yLabel, error? }
//   - { kind:'custom', draw(canvas), xLabel?, yLabel?, error? }
//
// ctx:
// {
//   deviceId: string,
//   metric: string,
//   rangeSec: number,
//   sampleRateHz: number,
//   transformId: string,
//   points: Array<{ x:number, y:number }>, // time-domain points (x = timestamp in ms)
//
//   // Optional helpers for multi-device scripts:
//   apiUrl: string,
//   allDeviceIds: string[],
//   getSeries(deviceId: string, metric: string, seconds: number): Array<{ x:number, y:number|null }>,
//   metricsFor(deviceId: string): string[],
// }

export const name = 'my-script'

export const transforms = [
  { id: 'identity', label: 'Identity' },
]

// Optional: declare which built-in UI controls your script uses.
// If omitted, the page will hide script-specific controls unless this is a custom script.
export const ui = {
  usesApiUrl: true,
  usesAxes: true,
}

// Optional: render per-script controls into the UI.
// export function renderControls(container) {
//   container.textContent = 'Hello from my script controls'
// }

export function transform(ctx) {
  return {
    kind: 'time',
    points: ctx.points,
    xLabel: 'Time (ms)',
    yLabel: ctx.metric,
  }
}
