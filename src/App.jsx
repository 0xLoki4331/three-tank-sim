import { useCallback, useEffect, useRef, useState } from 'react'
import { Sim, PRESETS } from './sim/model.js'
import { toCSV } from './sim/analysis.js'
import Mimic, { MimicPopover } from './components/Mimic.jsx'
import Faceplate from './components/Faceplate.jsx'
import Trends from './components/Trends.jsx'
import Panels from './components/Panels.jsx'
import { Seg, fmtTime, fmt } from './components/ui.jsx'

const SPEEDS = [[1, '1×'], [5, '5×'], [20, '20×'], [50, '50×'], [100, '100×'], [200, '200×']]

function readTheme() {
  try {
    return localStorage.getItem('tts-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  } catch {
    return 'light'
  }
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="6" fill="var(--text)" />
      {[5, 12.5, 20].map((x, i) => (
        <g key={x}>
          <rect x={x} y="7" width="5" height="16" rx="1" fill="none" stroke="var(--panel-hi)" strokeWidth="1.2" />
          <rect x={x + 0.8} y={23 - [12, 8, 5][i]} width="3.4" height={[12, 8, 5][i] - 0.8} fill="var(--liquid-hi)" />
        </g>
      ))}
    </svg>
  )
}

function alarmsOf(sim) {
  const out = []
  sim.P.tanks.forEach((t, i) => {
    const f = sim.h[i] / t.hmax
    if (f >= 0.98) out.push({ p: 1, code: 'HIHI', text: `${t.tag} overflow ${fmt(sim.h[i] * 100, 1)} cm` })
    else if (f >= 0.9) out.push({ p: 2, code: 'HI', text: `${t.tag} level ${fmt(sim.h[i] * 100, 1)} cm ≥ ${fmt(t.hmax * 90, 1)}` })
  })
  sim.P.pumps.forEach((pm) => pm.failed && out.push({ p: 1, code: 'TRIP', text: `${pm.tag} tripped` }))
  sim.P.pipes.forEach((p) => p.leak && p.valve > 0 && out.push({ p: 2, code: 'LEAK', text: `${p.tag} open ${p.valve}%` }))
  sim.loops.forEach((L) => {
    if (L.mode === 'MAN') out.push({ p: 3, code: 'MAN', text: `${L.tag} in manual` })
    else if (L.out >= 99.99 || L.out <= 0.01) out.push({ p: 2, code: 'SAT', text: `${L.tag} output ${L.out > 50 ? 'at 100' : 'at 0'} %` })
    else if (Math.abs(L.sp - sim.h[L.tank] * 100) > 10 && sim.t - L.evt.t0 > 600) out.push({ p: 2, code: 'DEV', text: `${L.tag} deviation ${fmt(L.sp - sim.h[L.tank] * 100, 1)} cm` })
  })
  return out.sort((a, b) => a.p - b.p)
}

export default function App() {
  const simRef = useRef(null)
  if (!simRef.current) simRef.current = new Sim('dts200')
  const sim = simRef.current
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(20)
  const [theme, setTheme] = useState(readTheme)
  const [sel, setSel] = useState(null)
  const [runs, setRuns] = useState([])
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])
  const live = useRef({ running, speed })
  live.current = { running, speed }
  document.documentElement.dataset.theme = theme // set during render so charts read the right CSS vars on mount

  useEffect(() => {
    try {
      localStorage.setItem('tts-theme', theme)
    } catch {}
  }, [theme])

  // real-time loop: fixed-step physics, UI repaint ≈ 30 fps
  useEffect(() => {
    let raf
    let last = performance.now()
    let lastUi = 0
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.5) // tolerate throttled frames; advance() caps steps
      last = now
      if (live.current.running) sim.advance(dt * live.current.speed)
      if (now - lastUi > 33) {
        lastUi = now
        setTick((t) => t + 1)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [sim])

  const load = (key) => {
    sim.load(key)
    setSel(null)
    setRuns([])
    bump()
  }
  const exportCSV = () => {
    const blob = new Blob([toCSV(sim)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `three-tank-${sim.key}-${Math.round(sim.t)}s.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const alarms = alarmsOf(sim)

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <b>THREE-TANK SYSTEM</b>
            <small>Process control simulator</small>
          </div>
        </div>
        <select value={sim.key} onChange={(e) => load(e.target.value)} aria-label="Plant configuration">
          {Object.entries(PRESETS).map(([k, p]) => (
            <option key={k} value={k}>{p.name} — {p.short}</option>
          ))}
        </select>
        <span className="spacer" />
        <div className="clock" title="Simulated time">{fmtTime(sim.t)}<small>sim</small></div>
        <button className={`btn${running ? '' : ' primary'}`} onClick={() => setRunning(!running)} style={{ minWidth: 88 }}>
          {running ? '❚❚ Pause' : '▶ Run'}
        </button>
        <button className="btn" onClick={() => load(sim.key)} title="Reset to empty tanks with preset parameters">⟲ Reset</button>
        <Seg value={speed} options={SPEEDS} onChange={setSpeed} label="Simulation speed" />
        <button className="btn" onClick={exportCSV} disabled={!sim.hist.t.length}>⤓ CSV</button>
        <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode" title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div className="alarms" role="status" aria-live="polite">
        <span className="lbl">ALARMS</span>
        {alarms.length === 0 ? (
          <span className="note">None active</span>
        ) : (
          alarms.map((a) => (
            <span key={a.code + a.text} className={`alarm p${a.p}`}><i>{a.code}</i>{a.text}</span>
          ))
        )}
      </div>

      <main className="grid">
        <section className="card mimic-card">
          <header>
            <h2>Process · {sim.P.name}</h2>
            <span className="hint">Click valves and pumps to operate them</span>
          </header>
          <div className="mimic-wrap">
            <Mimic sim={sim} sel={sel} setSel={setSel} />
            <MimicPopover sim={sim} sel={sel} setSel={setSel} bump={bump} />
          </div>
          <p className="mimic-desc">{sim.P.desc}</p>
        </section>

        <div className="plates">
          {sim.loops.map((L, j) => <Faceplate key={sim.key + L.tag} sim={sim} j={j} bump={bump} />)}
        </div>

        <Trends sim={sim} running={running} theme={theme} />
        <Panels sim={sim} bump={bump} theme={theme} runs={runs} setRuns={setRuns} />
      </main>
    </>
  )
}
