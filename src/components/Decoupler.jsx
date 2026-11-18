import { useState } from 'react'
import { designDecoupler } from '../sim/analysis.js'
import { fmt, sig, poly, NumInput, Seg } from './ui.jsx'

const signed = (v) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 2)
const MODES =[['off', 'OFF'], ['static', 'STATIC'], ['dynamic', 'DYNAMIC']]

/** Normalised −n/m for display (denominator constant term = 1). */
function tf(n, m) {
  const c = m[m.length - 1]
  return { num: poly(n.map((v) => -v / c)), den: poly(m.map((v) => v / c)) }
}

export default function Decoupler({ sim, bump }) {
  const D = sim.dec
  const [a, b] = sim.loops
  const pa = sim.P.pumps[a.pump].tag
  const pb = sim.P.pumps[b.pump].tag
  const [open, setOpen] = useState(false)
  const design = () => {
    const mode = D.mode
    sim.setDecoupler('off') // bumpless: hand current pump OPs to the controllers, then redesign
    Object.assign(D, designDecoupler(sim))
    sim.setDecoupler(mode)
    bump()
  }
  const setMode = (m) => {
    if (m !== 'off' && !D.designed) Object.assign(D, designDecoupler(sim))
    sim.setDecoupler(m)
    bump()
  }
  const f12 = D.num && tf(D.num.n12, D.num.m12)
  const f21 = D.num && tf(D.num.n21, D.num.m21)

  return (
    <section className="card fp" aria-label="Decoupler">
      <header>
        <div>
          <div className="tag">UY-100 · Decoupler</div>
          <div className="sub">cancels {pa} ↔ {pb} interaction</div>
        </div>
        <div className="mode" role="group" aria-label="Decoupler mode" style={{ marginLeft: 'auto' }}>
          {MODES.map(([k, l]) => (
            <button key={k} className={`${k === 'off' ? 'auto' : 'man'}${D.mode === k ? ' on' : ''}`} aria-pressed={D.mode === k} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
      </header>
      <div style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
        <div className="mono" style={{ fontSize: 12, lineHeight: 1.7 }}>
          <div>u<sub>{pa}</sub> = v₁ + D₁₂·Δv₂ <span className="note">→ {signed(D.mode === 'off' ? 0 : D.y[0])} %</span></div>
          <div>u<sub>{pb}</sub> = v₂ + D₂₁·Δv₁ <span className="note">→ {signed(D.mode === 'off' ? 0 : D.y[1])} %</span></div>
        </div>
        {!D.designed ? (
          <p className="note" style={{ margin: 0 }}>Not designed yet. Selecting STATIC or DYNAMIC designs it from the linear model at the current operating point.</p>
        ) : (
          <>
            <div className="stat">
              <div><span>Static D₁₂ = −K₁₂/K₁₁</span><b>{sig(D.D12, 3)}</b></div>
              <div><span>Static D₂₁ = −K₂₁/K₂₂</span><b>{sig(D.D21, 3)}</b></div>
            </div>
            <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open} style={{ justifySelf: 'start' }}>
              {open ? '▾' : '▸'} Dynamic filters & tuning
            </button>
            {open && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="mono" style={{ fontSize: 12 }}>
                  D₁₂(s) = −G₁₂/G₁₁ = <span className="frac"><span>{f12.num}</span><span>{f12.den}</span></span>
                </div>
                <div className="mono" style={{ fontSize: 12 }}>
                  D₂₁(s) = −G₂₁/G₂₂ = <span className="frac"><span>{f21.num}</span><span>{f21.den}</span></span>
                </div>
                {(!D.f12 || !D.f21) && <div className="warn">Ideal dynamic decoupler not realisable here (non-minimum-phase or improper); DYNAMIC falls back to static gains.</div>}
                <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <label className="field" style={{ width: 100 }}>D₁₂ (static)<NumInput value={D.D12} digits={4} onCommit={(v) => ((D.D12 = v), bump())} /></label>
                  <label className="field" style={{ width: 100 }}>D₂₁ (static)<NumInput value={D.D21} digits={4} onCommit={(v) => ((D.D21 = v), bump())} /></label>
                  <button className="btn sm" onClick={design} style={{ alignSelf: 'end' }}>Redesign at current point</button>
                </div>
                <p className="note" style={{ margin: 0 }}>
                  Designed at h = {D.at?.map((h) => fmt(h, 1)).join(' / ')} cm. Static decoupling ignores dynamics: {pb} reaches its tank at once, but {pa}'s effect arrives slowly through the middle tank, so the static term over-corrects early. Try both and compare the interaction column in Performance.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
