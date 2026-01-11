import { INSTALL_WIZARD } from '../generated/installWizard'

export default function InstallationWizardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          width: 'min(980px, 94vw)',
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
            <h3 style={{ margin: 0 }}>{INSTALL_WIZARD.title}</h3>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Generated: {INSTALL_WIZARD.generatedAt}</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          {INSTALL_WIZARD.sections.map(sec => (
            <div key={sec.title} style={{ marginBottom: 14 }}>
              <h4 style={{ margin: '0 0 8px 0' }}>{sec.title}</h4>
              <ol style={{ margin: 0, paddingLeft: 18, opacity: 0.92, lineHeight: 1.55, fontSize: 13 }}>
                {sec.steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10, fontSize: 12, opacity: 0.85 }}>
          To update this wizard, edit <code>docs/installation-wizard.md</code> and run <code>pnpm wizard:build</code> in <code>frontend/</code>.
        </div>
      </div>
    </div>
  )
}
