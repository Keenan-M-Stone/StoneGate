export default function AppHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 260,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 70,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 'min(860px, 94vw)',
          maxHeight: '84vh',
          overflow: 'auto',
          background: '#071827',
          color: '#e6eef8',
          borderRadius: 10,
          padding: 12,
          border: '1px solid rgba(255,255,255,0.18)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Help</h3>
            <div style={{ opacity: 0.8, fontSize: 12 }}>StoneGate frontend build info + quick pointers</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Build</h4>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12, opacity: 0.95 }}>
            <div>version: {__STONEGATE_FE_VERSION__}</div>
            <div>commit: {__STONEGATE_FE_COMMIT__}</div>
            <div>built: {__STONEGATE_FE_BUILD_TIME__}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Tips</h4>
          <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9, fontSize: 13, lineHeight: 1.5 }}>
            <li>
              <strong>Build Mode</strong> enables build-only helpers like auto-loading backend schematics on connect (if toggled).
            </li>
            <li>
              <strong>Diagnostics</strong> shows frontend actions (left) and backend log broadcasts (right). Use filters to spot external commands.
            </li>
            <li>
              <strong>Instance Manager</strong> is dev-only and only available when running <code>pnpm dev</code>.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
