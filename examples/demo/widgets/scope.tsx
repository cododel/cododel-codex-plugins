import { useBlueprintState } from '@blueprint/sdk'

export default function Scope({ id }: { id: string }) {
  const [state, setState, confirmed] = useBlueprintState(
    id,
    { screens: 3, polish: 'Balanced' },
    { kind: 'demo-scope', version: 1 },
  )
  const weight = state.polish === 'Detailed' ? 3 : state.polish === 'Sketch' ? 1 : 2
  const points = state.screens * weight
  return <section aria-label="Scope explorer">
    <h3>Scope explorer</h3>
    <label htmlFor={`${id}-screens`}>Screens: <strong>{state.screens}</strong></label>
    <input id={`${id}-screens`} style={{ display: 'block', width: '100%', margin: '16px 0' }}
      type="range" min={1} max={8} value={state.screens}
      onChange={e => setState({ ...state, screens: Number(e.target.value) })} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {['Sketch', 'Balanced', 'Detailed'].map(polish =>
        <button key={polish} aria-pressed={state.polish === polish}
          onClick={() => setState({ ...state, polish })}>{polish}</button>)}
    </div>
    <div role="meter" aria-label="Illustrative effort points" aria-valuemin={0} aria-valuemax={24} aria-valuenow={points}
      style={{ marginTop: 20, height: 14, borderRadius: 7, background: '#8a958c33', overflow: 'hidden' }}>
      <div style={{ width: `${points / 24 * 100}%`, height: '100%', borderRadius: 'inherit', background: '#478b65' }} />
    </div>
    <p style={{ fontSize: 14 }}>{points} illustrative effort points · no delivery commitment</p>
    {!confirmed && <button onClick={() => setState(state)}>Confirm this scope</button>}
  </section>
}
