export default function HelpDialog({ schema }:{schema:any}){
  return (
    <div style={{ padding: 12 }}>
      <h3>Device Help</h3>
      <div>Properties: {(schema?.properties || []).join(', ')}</div>
      <div style={{ marginTop: 8 }}>
        <a href={schema?.help_url ?? '#'} target="_blank" rel="noreferrer">Manufacturer page</a>
      </div>
    </div>
  )
}