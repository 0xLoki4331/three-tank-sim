import { metrics } from '../sim/analysis.js'
import { fmt, NumInput, TANK_COLORS } from './ui.jsx'

export default function Faceplate({ sim, j, bump }) {
  const L = sim.loops[j]
  const t = sim.P.tanks[L.tank]
  const pump = sim.P.pumps[L.pump]
  const hmax = t.hmax * 100
  const pct = (v) => `${Math.min(100, Math.max(0, (v / hmax) * 100))}%`
  const man = L.mode === 'MAN'
  const sat = sim.t > 0 && (L.out <= 0.01 || L.out >= 99.99) // not before the controller has run
  const m = metrics(sim, j)
  // every operator action goes through sim.change → journal entry, toast, undo
  const ch = (k, label, get, set, unit, digits) => (v) => (sim.change(`${L.tag}.${k}`, `${L.tag} ${label}`, get, set, v, unit, digits), bump())
  const setMode = ch('mode', 'mode', () => L.mode, (v) => (L.mode = v))
  const setSP = ch('sp', 'SP', () => L.sp, (v) => sim.setSP(j, v), 'cm')
  const setOP = ch('op', 'OP (manual)', () => L.out, (v) => (L.out = v), '%')
  const setG = (k, unit, digits) => ch(k, k, () => L.pid[k], (v) => (L.pid[k] = v), unit, digits)

  return (
    <section className="card fp" aria-label={`${L.tag} faceplate`} data-tour={`faceplate-${j}`}>
      <header>
        <span className="sw" style={{ background: TANK_COLORS[L.tank] }} />
        <div>
          <div className="tag">{L.tag}</div>
          <div className="sub">{t.tag} level → {pump.tag}</div>
        </div>
        <div className="mode" role="group" aria-label="Controller mode">
          <button className={`auto${!man ? ' on' : ''}`} aria-pressed={!man} onClick={() => setMode('AUTO')}>AUTO</button>
          <button className={`man${man ? ' on' : ''}`} aria-pressed={man} onClick={() => setMode('MAN')}>MAN</button>
        </div>
      </header>

      <div className="body">
        <div className="bar" title={`0 – ${hmax} cm`}>
          <div className="ticks" />
          <div className="fill" style={{ height: pct(sim.h[L.tank] * 100) }} />
          <div className="hi" style={{ bottom: '90%' }} />
          <div className="sp" style={{ bottom: pct(L.sp) }} />
        </div>
        <div className="kv">
          <span>PV</span>
          <div className="pv">
            {fmt(L.meas, 2)}
            <small>cm</small>
          </div>
          <span>SP</span>
          <div className="inline">
            <NumInput value={L.sp} min={0} max={hmax} step={1} digits={1} onCommit={setSP} aria-label={`${L.tag} setpoint`} />
            <span className="unit">cm</span>
            <span className="note" style={{ marginLeft: 'auto' }}>err {fmt(L.sp - L.meas, 2)}</span>
          </div>
          <span>OP</span>
          <div>
            <div className="inline">
              {man ? (
                <NumInput value={L.out} min={0} max={100} step={1} digits={1} onCommit={setOP} aria-label={`${L.tag} manual output`} />
              ) : (
                <b className="mono" style={{ fontSize: 17, fontWeight: 500, minWidth: 86 }}>{fmt(L.out, 1)}</b>
              )}
              <span className="unit">%</span>
              {sat && !man && <span className="note" style={{ marginLeft: 'auto', color: 'var(--hi)' }}>saturated</span>}
              {sim.dec.mode !== 'off' && (
                <span className="note" style={{ marginLeft: sat && !man ? 8 : 'auto' }} title="Actual pump output after the decoupler">
                  {pump.tag} {fmt(sim.u()[L.pump], 1)} %
                </span>
              )}
            </div>
            {man ? (
              <input type="range" min="0" max="100" step="0.5" value={L.out} onChange={(e) => setOP(+e.target.value)} aria-label={`${L.tag} manual output slider`} />
            ) : (
              <div className={`opbar${sat ? ' sat' : ''}`}>
                <div style={{ width: `${L.out}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tune">
        <label className="field">Kc [%/cm]<NumInput value={L.pid.Kc} min={0} max={1000} step={0.1} digits={3} onCommit={setG('Kc', '%/cm', 3)} /></label>
        <label className="field">Ti [s] (0=off)<NumInput value={L.pid.Ti} min={0} max={100000} step={5} digits={1} onCommit={setG('Ti', 's')} /></label>
        <label className="field">Td [s]<NumInput value={L.pid.Td} min={0} max={10000} step={1} digits={1} onCommit={setG('Td', 's')} /></label>
        <label className="chk" title="Anti-windup: freeze integral while output is saturated">
          <input type="checkbox" checked={L.pid.aw} onChange={(e) => setG('aw')(e.target.checked)} /> AW
        </label>
      </div>

      <div className="minimet" title="Response to the last setpoint change">
        <div>Rise<b>{m?.rise != null ? fmt(m.rise, 0) + ' s' : '—'}</b></div>
        <div>Overshoot<b>{m ? fmt(m.overshoot, 1) + ' %' : '—'}</b></div>
        <div>Settle 2%<b>{m?.settling != null ? fmt(m.settling, 0) + ' s' : '—'}</b></div>
        <div>IAE<b>{m ? fmt(m.iae, 0) : '—'}</b></div>
      </div>
    </section>
  )
}
