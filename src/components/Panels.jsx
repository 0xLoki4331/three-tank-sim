import { useMemo, useState } from 'react'
import { stepTest, tuningRules, relayTest, fopdt, linearize, compareStep, metrics } from '../sim/analysis.js'
import { G, evText, clamp } from '../sim/model.js'
import { Chart, fmt, sig, poly, NumInput, Seg, TANK_COLORS, fmtTime as fmtClock, rangePct } from './ui.jsx'

const TABS = [
  ['dist', 'Disturbances & faults'],
  ['tune', 'Tuning lab'],
  ['perf', 'Performance'],
  ['lin', 'Linear model'],
  ['model', 'Model & parameters'],
  ['events', 'Event journal'],
]
const secFmt = (v) => `${Math.round(v)}`

export default function Panels({ sim, bump, theme, runs, setRuns, tab, setTab }) {
  return (
    <section className="card tabs" data-tour="tabs">
      <nav className="tabbar" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
            {k === 'events' && <span className="count">{sim.events.length}</span>}
          </button>
        ))}
      </nav>
      <div className="tabpane" role="tabpanel">
        {tab === 'dist' && <Disturbances sim={sim} bump={bump} />}
        {tab === 'tune' && <TuningLab key={sim.key} sim={sim} bump={bump} theme={theme} />}
        {tab === 'perf' && <Performance sim={sim} runs={runs} setRuns={setRuns} />}
        {tab === 'lin' && <LinearModel key={sim.key} sim={sim} theme={theme} />}
        {tab === 'model' && <ModelParams sim={sim} bump={bump} />}
        {tab === 'events' && <Journal sim={sim} bump={bump} />}
      </div>
    </section>
  )
}

// ======================================================================= event journal
const KIND = { op: ['ACT', 'p0'], sys: ['SYS', 'p0'], fault: ['FAULT', 'p1'], alarm: ['ALM', 'p2'], clear: ['RTN', 'ok'] }

function Journal({ sim, bump }) {
  const evs = [...sim.events].reverse()
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Every operator action, injected fault and alarm transition, newest first, stamped with simulation time. Actions marked ↶ can be undone.
      </p>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table className="t">
          <thead><tr><th>Sim time</th><th>Type</th><th>Event</th><th /></tr></thead>
          <tbody>
            {evs.map((e) => (
              <tr key={e.id} style={e.undone ? { opacity: 0.5, textDecoration: 'line-through' } : null}>
                <td>{fmtClock(e.t)}</td>
                {/* same priority colours as the alarm strip */}
                <td><span className={`alarm ${e.kind === 'alarm' ? `p${e.p ?? 2}` : (KIND[e.kind]?.[1] ?? 'p0')}`}><i>{KIND[e.kind]?.[0] ?? e.kind}</i></span></td>
                <td className="l">{evText(e)}</td>
                <td>{e.undo && !e.undone && <button className="btn sm" onClick={() => (sim.undo(e), bump())}>↶ Undo</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ======================================================================= disturbances
/**
 * Industrial fader: rectangular track with scale, gripped thumb, −/+ nudge buttons and an inset readout.
 * The readout gets an amber edge when the value is off its normal position (HMI visibility of abnormal state).
 */
function Slider({ label, value, min, max, step = 1, unit, onChange, color, normal, nudge = (max - min) / 20 }) {
  const d = step < 1 ? (step < 0.1 ? 2 : 1) : 0
  const set = (v) => onChange(+clamp(v, min, max).toFixed(4))
  const off = normal != null && Math.abs(value - normal) > 1e-9
  return (
    <div className="fader">
      <span className="fader-label">
        {color && <span className="key-dot" style={{ background: color }} />}
        {label}
      </span>
      <button className="nudge" onClick={() => set(value - nudge)} disabled={value <= min} aria-label={`Decrease ${label}`}>−</button>
      <div className="fader-track">
        <input type="range" min={min} max={max} step={step} value={value} style={rangePct(value, min, max)} onChange={(e) => set(+e.target.value)} aria-label={label} />
        <div className="fader-scale" aria-hidden="true">
          <span>{min}</span>
          <span>{(min + max) / 2}</span>
          <span>{max}</span>
        </div>
      </div>
      <button className="nudge" onClick={() => set(value + nudge)} disabled={value >= max} aria-label={`Increase ${label}`}>+</button>
      <output className={`lcd${off ? ' off-normal' : ''}`} title={off ? `Off normal (normal = ${normal} ${unit})` : 'At normal position'}>
        {fmt(value, Number.isInteger(value) ? 0 : Math.max(d, 1))}
        <small>{unit}</small>
      </output>
    </div>
  )
}

function Disturbances({ sim, bump }) {
  const P = sim.P
  const main = P.pipes.filter((p) => !p.leak)
  const leaks = P.pipes.filter((p) => p.leak)
  const last = P.tanks.length - 1
  // all changes go through the journal → toast + undo
  const valve = (p) => (v) => (sim.change(`${p.tag}.valve`, `${p.tag} opening`, () => p.valve, (x) => (p.valve = x), v, '%', 0), bump())
  const qd = (i) => (v) => (sim.change(`qd${i}`, `Inflow disturbance → ${P.tanks[i].tag}`, () => +(P.qd[i] * 1e6).toFixed(3), (x) => (P.qd[i] = x * 1e-6), v, 'mL/s'), bump())
  const noise = (v) => (sim.change('noise', 'Sensor noise σ', () => sim.noise, (x) => (sim.noise = x), v, 'cm', 2), bump())
  const trip = (j) => () => (sim.setPumpFailed(j, !P.pumps[j].failed), bump())
  const scenarios = [
    ['Leak in ' + P.tanks[last].tag + ' (60%)', () => valve(leaks[last])(60)],
    ['Partial blockage ' + main[1].tag + ' → 25%', () => valve(main[1])(25)],
    ['Inflow surge ' + P.tanks[1].tag + ' +25 mL/s', () => qd(1)(25)],
    ['Trip ' + P.pumps[P.pumps.length - 1].tag, () => P.pumps.at(-1).failed || trip(P.pumps.length - 1)()],
    ['Noisy sensors (σ 0.5 cm)', () => noise(0.5)],
  ]
  return (
    <>
      <div className="toolbar">
        {scenarios.map(([l, f]) => <button key={l} className="btn sm" onClick={f}>{l}</button>)}
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => (sim.clearDisturbances(), bump())} disabled={!sim.abnormal()}>Restore normal operation</button>
      </div>
      <div className="cols">
        <div className="box">
          <h3>Inflow disturbance Qd</h3>
          {P.tanks.map((t, i) => (
            <Slider key={i} label={`into ${t.tag}`} color={TANK_COLORS[i]} value={P.qd[i] * 1e6} min={0} max={50} unit="mL/s" onChange={qd(i)} normal={0} nudge={1} />
          ))}
          <p className="note">Unmeasured extra inflow, e.g. a second feed. Watch the controller reject it.</p>
        </div>
        <div className="box">
          <h3>Leaks (drain valves)</h3>
          {leaks.map((p) => (
            <Slider key={p.tag} label={`${p.tag} · ${P.tanks[p.from].tag}`} color={TANK_COLORS[p.from]} value={p.valve} min={0} max={100} unit="%" onChange={valve(p)} normal={0} />
          ))}
          <p className="note">Leak through a {fmt(leaks[0].a * 1e6, 0)} mm² hole at the tank bottom; flow ∝ √h.</p>
        </div>
        <div className="box">
          <h3>Process valves (blockage)</h3>
          {main.map((p) => (
            <Slider key={p.tag} label={p.tag} value={p.valve} min={0} max={100} unit="%" onChange={valve(p)} normal={100} />
          ))}
          <p className="note">Closing a valve scales its effective flow area. Valves are also clickable on the diagram.</p>
        </div>
        <div className="box">
          <h3>Sensors & actuators</h3>
          <Slider label="Level noise σ" value={sim.noise} min={0} max={2} step={0.05} unit="cm" onChange={noise} normal={0} nudge={0.1} />
          {P.pumps.map((pm, j) => (
            <div key={pm.tag} className="srow">
              <span>{pm.tag}</span>
              <span className="note">{pm.failed ? 'TRIPPED — no flow' : 'running normally'}</span>
              <button className={`btn sm${pm.failed ? ' primary' : ''}`} onClick={trip(j)}>{pm.failed ? 'Restore' : 'Trip'}</button>
            </div>
          ))}
          <p className="note">Noise enters the PV seen by the controller. Try derivative action with noise on.</p>
        </div>
      </div>
    </>
  )
}

// ======================================================================= tuning lab
function RulesTable({ rows, apply }) {
  return (
    <table className="t">
      <thead>
        <tr><th>Rule</th><th>Type</th><th>Kc [%/cm]</th><th>Ti [s]</th><th>Td [s]</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="l">{r.rule}</td>
            <td>{r.kind}</td>
            <td>{sig(r.Kc, 3)}</td>
            <td>{r.Ti ? fmt(r.Ti, 1) : '—'}</td>
            <td>{r.Td ? fmt(r.Td, 1) : '—'}</td>
            <td><button className="btn sm" onClick={() => apply(r)}>Apply</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TuningLab({ sim, bump, theme }) {
  const [li, setLi] = useState(0)
  const [method, setMethod] = useState('step')
  const [dOp, setDOp] = useState(10)
  const [d, setD] = useState(10)
  const [eps, setEps] = useState(0.2)
  const [res, setRes] = useState(null)
  const [applied, setApplied] = useState(null)
  const L = sim.loops[li]
  const run = () => {
    setApplied(null)
    setRes(method === 'step' ? { kind: 'step', li, ...stepTest(sim, li, dOp) } : { kind: 'relay', li, ...relayTest(sim, li, d, eps) })
  }
  const apply = (r) => {
    const pid = sim.loops[res.li].pid
    const old = { Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td }
    const next = { Kc: +r.Kc.toPrecision(3), Ti: +r.Ti.toFixed(1), Td: +r.Td.toFixed(1) }
    Object.assign(pid, next)
    const tag = sim.loops[res.li].tag
    sim.event({ text: `${tag} tuning ← ${r.rule} ${r.kind}: Kc ${next.Kc}, Ti ${next.Ti} s, Td ${next.Td} s (was ${+old.Kc.toPrecision(3)}, ${old.Ti}, ${old.Td})`, undo: () => Object.assign(pid, old) })
    setApplied(`${r.rule} ${r.kind} applied to ${tag}`)
    bump()
  }
  const chart = useMemo(() => {
    if (!res) return null
    if (res.kind === 'step') {
      const model = res.fit ? fopdt(res.fit, res.du, res.y0) : () => null
      return { series: [{ label: 'PV (plant)', color: TANK_COLORS[sim.loops[res.li].tank] }, { label: 'FOPDT fit', color: 'var(--text)', dash: [5, 4] }], data: [res.t, res.y, res.t.map(model)] }
    }
    return { series: [{ label: 'PV', color: TANK_COLORS[sim.loops[res.li].tank] }, { label: 'SP', color: 'var(--text)', dash: [5, 4] }], data: [res.t, res.y, res.t.map(() => res.sp)] }
  }, [res, sim])

  return (
    <>
      <div className="toolbar">
        {sim.loops.length > 1 && (
          <label className="field">Loop
            <select value={li} onChange={(e) => setLi(+e.target.value)}>
              {sim.loops.map((l, i) => <option key={l.tag} value={i}>{l.tag}</option>)}
            </select>
          </label>
        )}
        <label className="field">Method
          <Seg value={method} onChange={setMethod} options={[['step', 'Step test (open loop)'], ['relay', 'Relay auto-tune']]} />
        </label>
        {method === 'step' ? (
          <label className="field">ΔOP [%]<NumInput value={dOp} min={-50} max={50} digits={1} onCommit={setDOp} /></label>
        ) : (
          <>
            <label className="field">Relay d [%]<NumInput value={d} min={1} max={50} digits={1} onCommit={setD} /></label>
            <label className="field">Hysteresis ε [cm]<NumInput value={eps} min={0} max={5} digits={2} onCommit={setEps} /></label>
          </>
        )}
        <button className="btn primary" onClick={run}>Run {method === 'step' ? 'step test' : 'relay test'} on {L.tag}</button>
      </div>
      <p className="note" style={{ marginTop: -4 }}>
        Runs on a copy of the plant: it settles at the current output of {L.tag} ({fmt(L.out, 1)} %) with the controller in MAN, then applies the test. The live process is not disturbed.
        {sim.loops.length > 1 && ' Other loops keep their current mode, so this is the effective process with them closed.'}
      </p>
      {!res && <div className="empty">Run a test to identify the process and get tuning suggestions.</div>}
      {res && (
        <div className="cols" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
          <div className="box">
            <h3>{res.kind === 'step' ? `Open-loop step response · ΔOP = ${fmt(res.du, 1)} %` : `Relay oscillation · d = ±${fmt(res.amp ?? d, 1)} %`}</h3>
            <Chart theme={theme} series={chart.series} data={chart.data} height={240} yLabel="cm" />
          </div>
          <div className="box">
            {res.kind === 'step' && res.clipped && (
              <div className="warn">At OP = {fmt(res.op0, 1)} % the tank overflows or runs dry, so the response is clipped and can't be fitted. Let the loop settle at its setpoint first (or put it in MAN at a mid-range output), then run the test.</div>
            )}
            {res.kind === 'step' && !res.clipped && !res.fit && <div className="warn">The level barely moved — try a larger ΔOP.</div>}
            {res.kind === 'step' && res.fit && (
              <>
                <h3>FOPDT model (two-point method)</h3>
                <p className="mono" style={{ fontSize: 13 }}>
                  G(s) = <span className="frac"><span>{sig(res.fit.K, 3)} · e<sup>−{fmt(res.fit.theta, 1)}s</sup></span><span>{fmt(res.fit.tau, 1)} s + 1</span></span>
                </p>
                <div className="stat" style={{ marginBottom: 10 }}>
                  <div><span>Gain K</span><b>{sig(res.fit.K, 3)}<small>cm/%</small></b></div>
                  <div><span>Time const τ</span><b>{fmt(res.fit.tau, 1)}<small>s</small></b></div>
                  <div><span>Dead time θ</span><b>{fmt(res.fit.theta, 1)}<small>s</small></b></div>
                  <div><span>θ / τ</span><b>{fmt(res.fit.theta / res.fit.tau, 3)}</b></div>
                </div>
                <p className="note">t₂₈ = {fmt(res.fit.t28, 1)} s, t₆₃ = {fmt(res.fit.t63, 1)} s → τ = 1.5(t₆₃ − t₂₈), θ = t₆₃ − τ</p>
                {res.fit.small && (
                  <div className="warn">
                    Apparent dead time is very small (raw θ = {fmt(res.fit.thetaRaw, 1)} s, floored to {fmt(res.fit.theta, 1)} s). This loop is nearly first order, so Ziegler–Nichols and Cohen–Coon give very aggressive gains. SIMC/IMC are the safer choice here.
                  </div>
                )}
                <RulesTable rows={tuningRules(res.fit)} apply={apply} />
              </>
            )}
            {res.kind === 'relay' && !res.ok && <div className="warn">No sustained oscillation detected. Make sure the loop has settled at a mid-range output (not overflowing or at 0/100 %), then try a larger relay amplitude or smaller hysteresis.</div>}
            {res.kind === 'relay' && res.ok && (
              <>
                <h3>Ultimate gain & period (describing function)</h3>
                <div className="stat" style={{ marginBottom: 10 }}>
                  <div><span>Ku</span><b>{sig(res.Ku, 3)}<small>%/cm</small></b></div>
                  <div><span>Pu</span><b>{fmt(res.Pu, 1)}<small>s</small></b></div>
                  <div><span>PV amplitude a</span><b>{fmt(res.a, 2)}<small>cm</small></b></div>
                </div>
                <p className="note">Ku = 4d / (π·√(a² − ε²)) — Åström–Hägglund relay feedback.</p>
                {res.hyst ? (
                  <div className="warn">
                    The oscillation amplitude ({fmt(res.a, 3)} cm) is about the size of the hysteresis band ε, so the cycle comes from the relay switching, not from process phase lag. This loop is effectively first order (its phase never reaches −180°, so the true Ku is unbounded). Closed-loop ZN rules don't apply. Use the step test with SIMC/IMC instead.
                  </div>
                ) : (
                  <RulesTable rows={res.rules} apply={apply} />
                )}
              </>
            )}
            {applied && <p className="note" style={{ marginTop: 8, color: 'var(--run)' }}>✓ {applied}. Step the setpoint and check the Performance tab.</p>}
          </div>
        </div>
      )}
    </>
  )
}

// ======================================================================= performance
function Performance({ sim, runs, setRuns }) {
  const ms = sim.loops.map((_, j) => metrics(sim, j))
  const save = (j) => {
    const L = sim.loops[j]
    setRuns([...runs, { loop: L.tag, Kc: L.pid.Kc, Ti: L.pid.Ti, Td: L.pid.Td, aw: L.pid.aw, noise: sim.noise, dec: sim.dec.mode, ...ms[j] }])
  }
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>Metrics are measured from the most recent setpoint change of each loop (noise-free level, 2 % settling band). Change a setpoint on a faceplate to start a new measurement.</p>
      <div className="cols">
        {sim.loops.map((L, j) => {
          const m = ms[j]
          return (
            <div className="box" key={L.tag}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, background: TANK_COLORS[L.tank], borderRadius: 2 }} />
                {L.tag} {m && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· SP step {fmt(m.from, 1)} → {fmt(m.to, 1)} cm</span>}
              </h3>
              {!m ? (
                <div className="empty">No setpoint step yet.</div>
              ) : (
                <>
                  <div className="stat">
                    <div><span>Rise 10–90%</span><b>{m.rise != null ? fmt(m.rise, 0) : '—'}<small>s</small></b></div>
                    <div><span>Overshoot</span><b>{fmt(m.overshoot, 1)}<small>%</small></b></div>
                    <div><span>Peak time</span><b>{m.overshoot > 0.05 ? fmt(m.tPeak, 0) : '—'}<small>s</small></b></div>
                    <div><span>Settling 2%</span><b>{m.settling != null ? fmt(m.settling, 0) : '…'}<small>s</small></b></div>
                    <div><span>IAE</span><b>{fmt(m.iae, 0)}<small>cm·s</small></b></div>
                    <div><span>ISE</span><b>{fmt(m.ise, 0)}<small>cm²·s</small></b></div>
                    <div><span>SS error</span><b>{fmt(m.ess, 2)}<small>cm</small></b></div>
                    <div><span>Elapsed</span><b>{fmt(m.elapsed, 0)}<small>s</small></b></div>
                    {m.cross != null && <div title={`Largest |SP − h| of ${m.crossTag} since this step`}><span>Interaction · max Δ {m.crossTag}</span><b>{fmt(m.cross, 3)}<small>cm</small></b></div>}
                  </div>
                  <button className="btn sm" style={{ marginTop: 10 }} onClick={() => save(j)}>Save run to comparison table</button>
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="box" style={{ marginTop: 16, overflowX: 'auto' }}>
        <h3 style={{ display: 'flex' }}>Tuning comparison <span className="spacer" style={{ flex: 1 }} />{runs.length > 0 && <button className="btn sm" onClick={() => setRuns([])}>Clear</button>}</h3>
        {runs.length === 0 ? (
          <div className="empty">Save runs with different tunings to compare them side by side.</div>
        ) : (
          <table className="t">
            <thead><tr><th>#</th><th>Loop</th><th>Kc</th><th>Ti</th><th>Td</th><th>AW</th><th>Noise σ</th><th>SP step</th><th>Rise [s]</th><th>OS [%]</th><th>Settle [s]</th><th>IAE</th><th>ISE</th><th>Decoupler</th><th>Max Δ other [cm]</th></tr></thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td><td>{r.loop}</td><td>{sig(r.Kc, 3)}</td><td>{fmt(r.Ti, 1)}</td><td>{fmt(r.Td, 1)}</td><td>{r.aw ? 'on' : 'off'}</td><td>{fmt(r.noise, 2)}</td>
                  <td>{fmt(r.from, 1)}→{fmt(r.to, 1)}</td><td>{r.rise != null ? fmt(r.rise, 0) : '—'}</td><td>{fmt(r.overshoot, 1)}</td><td>{r.settling != null ? fmt(r.settling, 0) : 'n/s'}</td><td>{fmt(r.iae, 0)}</td><td>{fmt(r.ise, 0)}</td><td>{r.dec}</td><td>{r.cross != null ? fmt(r.cross, 3) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// ======================================================================= linear model
const Matrix = ({ M, d = 4 }) => (
  <div className="matrix" style={{ gridTemplateColumns: `repeat(${M[0].length}, auto)` }}>
    {M.flat().map((v, i) => <span key={i} style={{ textAlign: 'right' }}>{sig(v, d)}</span>)}
  </div>
)

function LinearModel({ sim, theme }) {
  const [lin, setLin] = useState(null)
  const [pj, setPj] = useState(0)
  const [dOp, setDOp] = useState(10)
  const [cmp, setCmp] = useState(null)
  const go = () => {
    const l = linearize(sim)
    setLin(l)
    setCmp(compareStep(l, pj, dOp))
  }
  const P = sim.P
  const pairs = new Set(sim.loops.map((L) => `${L.tank}-${L.pump}`))
  // RGA for 2×2 systems from loop-paired steady-state gains
  let rga = null
  if (lin && sim.loops.length === 2) {
    const k = (L, pump) => lin.tf.find((g) => g.out === L.tank && g.inp === pump).K
    const [A, B] = sim.loops
    const K11 = k(A, A.pump), K12 = k(A, B.pump), K21 = k(B, A.pump), K22 = k(B, B.pump)
    const l11 = 1 / (1 - (K12 * K21) / (K11 * K22))
    rga = { K: [[K11, K12], [K21, K22]], l11 }
  }
  return (
    <>
      <div className="toolbar">
        {P.pumps.length > 1 && (
          <label className="field">Compare: step pump
            <select value={pj} onChange={(e) => setPj(+e.target.value)}>
              {P.pumps.map((p, j) => <option key={p.tag} value={j}>{p.tag}</option>)}
            </select>
          </label>
        )}
        <label className="field">ΔOP [%]<NumInput value={dOp} min={-50} max={50} digits={1} onCommit={setDOp} /></label>
        <button className="btn primary" onClick={go}>Linearise at current OPs{lin ? ' (again)' : ''}</button>
        <span className="note">Pumps held at {sim.loops.map((L) => `${P.pumps[L.pump].tag} = ${fmt(L.out, 1)} %`).join(', ')}; the copy settles, then A and B come from a numerical Jacobian of the nonlinear ODEs.</span>
      </div>
      {!lin ? (
        <div className="empty">Linearise to get the state-space model, poles, transfer functions and a linear-vs-nonlinear comparison.</div>
      ) : (
        <>
          <div className="cols">
            <div className="box">
              <h3>Operating point</h3>
              <div className="stat">
                {lin.h0.map((h, i) => <div key={i}><span>{P.tanks[i].tag}</span><b>{fmt(h, 2)}<small>cm</small></b></div>)}
                {lin.u0.map((u, j) => <div key={'u' + j}><span>{P.pumps[j].tag}</span><b>{fmt(u, 1)}<small>%</small></b></div>)}
              </div>
            </div>
            <div className="box">
              <h3>State space <span style={{ textTransform: 'none', fontFamily: 'var(--mono)' }}>· ẋ = A·x + B·u</span></h3>
              <p className="note">x = Δh [cm], u = ΔOP [%]</p>
              <div className="inline" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="mono">A =</span><Matrix M={lin.A} />
                <span className="mono">B =</span><Matrix M={lin.B} />
              </div>
            </div>
            <div className="box">
              <h3>Poles & time constants</h3>
              <table className="t">
                <thead><tr><th>Pole [1/s]</th><th>τ = −1/p [s]</th></tr></thead>
                <tbody>
                  {lin.poles.map(([re, im], i) => (
                    <tr key={i}><td>{sig(re, 4)}{im ? ` ${im > 0 ? '+' : '−'} ${sig(Math.abs(im), 3)}j` : ''}</td><td>{fmt(lin.tau[i], 1)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="note" style={{ marginTop: 8 }}>
                {lin.poles.every(([re]) => re < 0) ? 'All poles in the left half-plane → open loop stable' : 'Pole in the right half-plane → open loop unstable'}
                {lin.poles.every(([, im]) => !im) ? ', real → non-oscillatory.' : ', complex pair → oscillatory modes.'}
              </p>
            </div>
            {rga && (
              <div className="box">
                <h3>Relative gain array (pairing)</h3>
                <div className="inline" style={{ gap: 12 }}>
                  <span className="mono">Λ =</span>
                  <Matrix M={[[rga.l11, 1 - rga.l11], [1 - rga.l11, rga.l11]]} d={3} />
                </div>
                <p className="note" style={{ marginTop: 8 }}>
                  λ₁₁ = 1 / (1 − K₁₂K₂₁ / K₁₁K₂₂) = {fmt(rga.l11, 3)}. {rga.l11 > 0.5 ? 'λ₁₁ > 0.5 → the diagonal pairing (P-101→T-1, P-102→T-2) is the right choice' : 'λ₁₁ < 0.5 → consider swapping the pairing'}
                  {Math.abs(rga.l11 - 1) > 0.3 ? '; noticeable interaction between loops.' : '; mild interaction.'}
                </p>
              </div>
            )}
          </div>
          <div className="box" style={{ marginTop: 16, overflowX: 'auto' }}>
            <h3>Transfer functions G(s) = Δh(s) / ΔOP(s) [cm/%]</h3>
            <table className="t">
              <thead><tr><th>Input → output</th><th>G(s)</th><th>Gain K [cm/%]</th><th>Zeros [1/s]</th></tr></thead>
              <tbody>
                {lin.tf.map((g, i) => (
                  <tr key={i} className={pairs.has(`${g.out}-${g.inp}`) ? 'pair' : ''}>
                    <td className="l">{P.pumps[g.inp].tag} → {P.tanks[g.out].tag}{pairs.has(`${g.out}-${g.inp}`) ? ' (control loop)' : ''}</td>
                    <td><span className="frac"><span>{poly(g.num)}</span><span>{poly(g.den)}</span></span></td>
                    <td>{sig(g.K, 4)}</td>
                    <td>
                      {g.zeros.length
                        ? g.zeros
                            .map(([re, im]) => {
                              const cancels = lin.poles.some(([pr]) => Math.abs(pr - re) < 1e-3 * Math.abs(pr) && !im)
                              return sig(re, 3) + (im ? `±${sig(Math.abs(im), 2)}j` : '') + (cancels ? ' (cancels a pole)' : '')
                            })
                            .join(', ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note" style={{ marginTop: 8 }}>Normalised so the denominator constant term is 1; coefficients of sᵏ are in sᵏ. Highlighted rows are the controlled pairs.</p>
          </div>
          {cmp && (
            <div className="box" style={{ marginTop: 16 }}>
              <h3>Nonlinear vs linear · {P.pumps[pj].tag} step ΔOP = {fmt(cmp.du, 1)} %</h3>
              <Chart
                theme={theme}
                height={260}
                yLabel="cm"
                xFmt={secFmt}
                series={[
                  ...P.tanks.map((t, i) => ({ label: `${t.tag} nonlinear`, color: TANK_COLORS[i] })),
                  ...P.tanks.map((t, i) => ({ label: `${t.tag} linear`, color: TANK_COLORS[i], dash: [5, 4], width: 1.3 })),
                ]}
                data={[cmp.t, ...cmp.nl, ...cmp.li]}
              />
              <p className="note">Small steps: the curves overlap. Larger steps: the √h nonlinearity makes the real plant deviate. Try ΔOP = 30 %.</p>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ======================================================================= model & parameters
function ModelParams({ sim, bump }) {
  const P = sim.P
  const par = (key, label, get, set, unit, digits = 2) => (v) => (sim.change(key, label, get, set, v, unit, digits), bump())
  const name = (i) => `h${i + 1}`
  const qname = (p) => `q${p.tag.replace('HV-', '').toLowerCase()}`
  const eqs = P.tanks.map((t, i) => {
    const ins = [
      ...P.pumps.map((pm, j) => (pm.tank === i ? `Q${j + 1}` : null)).filter(Boolean),
      ...P.pipes.filter((p) => p.to === i).map(qname),
      'Qd' + (i + 1),
    ]
    const outs = P.pipes.filter((p) => p.from === i).map(qname)
    return `A${i + 1}·d${name(i)}/dt = ${ins.join(' + ')} − ${outs.join(' − ')}`
  })
  const laws = P.pipes.map((p) => {
    const q = qname(p)
    const k = `Cd·a·(v/100)·√(2g`
    if (p.law === 'interact') return `${q} = ${k}|${name(p.from)} − ${name(p.to)}|)·sign(${name(p.from)} − ${name(p.to)})`
    return `${q} = ${k}·${name(p.from)})${p.law === 'free' ? '   (free discharge — non-interacting)' : p.leak ? '   (leak)' : '   (to reservoir)'}`
  })
  return (
    <div className="cols" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
      <div className="box">
        <h3>Mass balances · {P.name}</h3>
        <p className="note">{P.desc}</p>
        <div className="eq">{eqs.map((e) => <div key={e}>{e}</div>)}</div>
        <h3 style={{ marginTop: 14 }}>Flow laws (Torricelli)</h3>
        <div className="eq">{laws.map((e) => <div key={e}>{e}</div>)}</div>
        <p className="note" style={{ marginTop: 8 }}>
          Q<sub>j</sub> = OP<sub>j</sub>/100 · Q<sub>max</sub>. g = {G} m/s². Levels clamp at 0 and h<sub>max</sub> (overflow). Integrated with fixed-step RK4 (Δt = 50 ms); PID sampled every 100 ms in ISA form with derivative on PV, filter N = 10, and conditional-integration anti-windup. Near Δh = 0 the √ law is linearised over ±1 mm to avoid an infinite slope.
        </p>
      </div>
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <div className="box" style={{ overflowX: 'auto' }}>
          <h3>Tanks</h3>
          <table className="t">
            <thead><tr><th>Tank</th><th>Area A [cm²]</th><th>Height [cm]</th></tr></thead>
            <tbody>
              {P.tanks.map((t) => (
                <tr key={t.tag}>
                  <td className="l">{t.tag}</td>
                  <td><NumInput value={t.A * 1e4} min={10} max={2000} digits={1} onCommit={par(`${t.tag}.A`, `${t.tag} area`, () => +(t.A * 1e4).toFixed(2), (v) => (t.A = v * 1e-4), 'cm²')} /></td>
                  <td>{fmt(t.hmax * 100, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="box" style={{ overflowX: 'auto' }}>
          <h3>Pipes & valves</h3>
          <table className="t">
            <thead><tr><th>Valve</th><th>Law</th><th>Cd [–]</th><th>a [mm²]</th><th>Open [%]</th></tr></thead>
            <tbody>
              {P.pipes.map((p) => (
                <tr key={p.tag}>
                  <td className="l">{p.tag}</td>
                  <td className="l">{p.leak ? 'leak' : p.law}</td>
                  <td><NumInput value={p.Cd} min={0.05} max={1} digits={3} onCommit={par(`${p.tag}.Cd`, `${p.tag} Cd`, () => p.Cd, (v) => (p.Cd = v), '', 3)} /></td>
                  <td><NumInput value={p.a * 1e6} min={1} max={500} digits={1} onCommit={par(`${p.tag}.a`, `${p.tag} area`, () => +(p.a * 1e6).toFixed(2), (v) => (p.a = v * 1e-6), 'mm²')} /></td>
                  <td>{p.valve}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="box" style={{ overflowX: 'auto' }}>
          <h3>Pumps</h3>
          <table className="t">
            <thead><tr><th>Pump</th><th>Feeds</th><th>Qmax [mL/s]</th></tr></thead>
            <tbody>
              {P.pumps.map((pm) => (
                <tr key={pm.tag}>
                  <td className="l">{pm.tag}</td>
                  <td className="l">{P.tanks[pm.tank].tag}</td>
                  <td><NumInput value={pm.Qmax * 1e6} min={1} max={1000} digits={1} onCommit={par(`${pm.tag}.Qmax`, `${pm.tag} capacity`, () => +(pm.Qmax * 1e6).toFixed(2), (v) => (pm.Qmax = v * 1e-6), 'mL/s')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 8 }}>Edits apply live. Reset the simulation to restore preset values.</p>
        </div>
      </div>
    </div>
  )
}
