import { useCallback, useEffect, useRef, useState } from 'react'
import { Sim, PRESETS } from './sim/model.js'
import { toCSV } from './sim/analysis.js'
import Mimic, { MimicPopover } from './components/Mimic.jsx'
import Faceplate from './components/Faceplate.jsx'
import Decoupler from './components/Decoupler.jsx'
import Trends from './components/Trends.jsx'
import Panels from './components/Panels.jsx'
import { Seg, fmtTime, fmt } from './components/ui.jsx'
import { Welcome, Tour, TOUR, DEMO, Confirm, Toasts } from './components/Guide.jsx'

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

/** Active alarms. id/what are stable (for journaling transitions); text carries live values. */
function alarmsOf(sim) {
  const out = []
  const add = (p, code, what, text) => out.push({ p, code, what, text, id: `${code}:${what}` })
  sim.P.tanks.forEach((t, i) => {
    const f = sim.h[i] / t.hmax
    if (f >= 0.98) add(1, 'HIHI', `${t.tag} level`, `${t.tag} overflow ${fmt(sim.h[i] * 100, 1)} cm`)
    else if (f >= 0.9) add(2, 'HI', `${t.tag} level`, `${t.tag} level ${fmt(sim.h[i] * 100, 1)} cm ≥ ${fmt(t.hmax * 90, 1)}`)
  })
  sim.P.pumps.forEach((pm) => pm.failed && add(1, 'TRIP', pm.tag, `${pm.tag} tripped`))
  sim.P.pipes.forEach((p) => p.leak && p.valve > 0 && add(2, 'LEAK', p.tag, `${p.tag} open ${p.valve}%`))
  sim.loops.forEach((L) => {
    if (L.mode === 'MAN') add(3, 'MAN', L.tag, `${L.tag} in manual`)
    // t > 0: controllers haven't run yet at start, so no nuisance SAT alarm
    else if (sim.t > 0 && (L.out >= 99.99 || L.out <= 0.01)) add(2, 'SAT', L.tag, `${L.tag} output ${L.out > 50 ? 'at 100' : 'at 0'} %`)
    else if (Math.abs(L.sp - sim.h[L.tank] * 100) > 10 && sim.t - L.evt.t0 > 600) add(2, 'DEV', L.tag, `${L.tag} deviation ${fmt(L.sp - sim.h[L.tank] * 100, 1)} cm`)
  })
  return out.sort((a, b) => a.p - b.p)
}

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {}
  },
}

const LEGEND = [
  ['var(--liquid)', 'Liquid / flow'],
  ['var(--run)', 'Running'],
  ['var(--hi)', 'Warning'],
  ['var(--hihi)', 'Critical'],
  ['var(--man)', 'Manual'],
]

export default function App() {
  const simRef = useRef(null)
  if (!simRef.current) simRef.current = new Sim('dts200')
  const sim = simRef.current
  const [running, setRunning] = useState(false) // start paused: let people orient themselves first
  const [speed, setSpeed] = useState(20)
  const [theme, setTheme] = useState(readTheme)
  const [sel, setSel] = useState(null)
  const [runs, setRuns] = useState([])
  const [tab, setTab] = useState('dist')
  const [hideWelcome, setHideWelcome] = useState(() => store.get('tts-welcome-hide') === '1')
  const [guide, setGuide] = useState(() => (store.get('tts-welcome-hide') === '1' ? null : 'welcome')) // welcome | tour | demo | null
  const [ask, setAsk] = useState(null) // pending confirmation
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])
  const live = useRef({ running, speed })
  live.current = { running, speed }
  const prevAlarms = useRef(new Map())
  document.documentElement.dataset.theme = theme // set during render so charts read the right CSS vars on mount

  useEffect(() => store.set('tts-theme', theme), [theme])
  useEffect(() => store.set('tts-welcome-hide', hideWelcome ? '1' : '0'), [hideWelcome])

  // Space = run/pause (not while typing or when a button has focus)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return
      e.preventDefault()
      setRunning((r) => !r)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

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
        // journal alarm transitions (raised / returned to normal)
        const cur = new Map(alarmsOf(sim).map((a) => [a.id, a]))
        for (const [id, a] of cur) if (!prevAlarms.current.has(id)) sim.event({ kind: 'alarm', p: a.p, text: `${a.code} · ${a.text}` })
        for (const [id, a] of prevAlarms.current) if (!cur.has(id)) sim.event({ kind: 'clear', text: `${a.code} cleared · ${a.what}` })
        prevAlarms.current = cur
        setTick((t) => t + 1)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [sim])

  const load = (key) => {
    sim.load(key)
    prevAlarms.current = new Map()
    setSel(null)
    setRuns([])
    bump()
  }
  // destructive actions ask first once there's a run worth losing (cancel is the default focus)
  const guarded = (title, ok, body, run) => (sim.t > 1 ? setAsk({ title, ok, body, run }) : run())
  const lose = `The current run (${fmtTime(sim.t)} of simulated time, its trends and journal) will be discarded. Export CSV first if you need the data.`
  const switchPlant = (key) => guarded('Switch plant?', 'Switch plant', `This restarts the simulation with ${PRESETS[key].name}. ${lose}`, () => load(key))
  const reset = () => guarded('Reset the simulation?', 'Reset', `Tanks go back to empty with the preset parameters. ${lose}`, () => (load(sim.key), setRunning(false)))
  const startDemo = () =>
    guarded('Start the guided demo?', 'Start demo', `The demo loads a fresh DTS200 plant. ${lose}`, () => {
      load('dts200')
      setRunning(false)
      setGuide('demo')
    })
  const ctx = { sim, bump, run: () => setRunning(true), setSpeed, setTab }
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
        <select value={sim.key} onChange={(e) => switchPlant(e.target.value)} aria-label="Plant configuration" data-tour="preset">
          {Object.entries(PRESETS).map(([k, p]) => (
            <option key={k} value={k}>{p.name} — {p.short}</option>
          ))}
        </select>
        <button className="btn" onClick={() => (setRunning(false), setGuide('welcome'))} title="Interface tour and guided demo (pauses the simulation)">? Guide</button>
        <span className="spacer" />
        <div className="ctrl" data-tour="controls">
          <div className={`clock${running ? '' : ' paused'}`} title="Simulated time" aria-live="off">
            {fmtTime(sim.t)}
            <small>{running ? 'sim' : 'paused'}</small>
          </div>
          <button className={`btn${running ? '' : ' primary'}`} onClick={() => setRunning(!running)} style={{ minWidth: 88 }} title="Run / pause (Space)">
            {running ? '❚❚ Pause' : '▶ Run'}
          </button>
          <button className="btn" onClick={reset} title="Reset to empty tanks with preset parameters (asks first)">⟲ Reset</button>
          <Seg value={speed} options={SPEEDS} onChange={setSpeed} label="Simulation speed" />
        </div>
        <button className="btn" onClick={exportCSV} disabled={!sim.hist.t.length}>⤓ CSV</button>
        <button
          className="btn icon"
          aria-label="Toggle fullscreen"
          title="Fullscreen (for presenting)"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}
        >
          ⛶
        </button>
        <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode" title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div className="alarms" data-tour="alarms">
        <span className="lbl">ALARMS</span>
        <span role="status" aria-live="polite" style={{ display: 'contents' }}>
          {alarms.length === 0 ? (
            <span className="note">None active</span>
          ) : (
            alarms.map((a) => (
              <span key={a.id} className={`alarm p${a.p}`}><i>{a.code}</i>{a.text}</span>
            ))
          )}
        </span>
        {sim.abnormal() && (
          <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => (sim.clearDisturbances(), bump())} title="Close leaks, reopen valves, restart pumps, remove disturbances">
            Restore normal operation
          </button>
        )}
      </div>

      <main className="grid">
        <section className="card mimic-card" data-tour="mimic">
          <header>
            <h2>Process · {sim.P.name}</h2>
            {!running && <span className="paused-chip">❚❚ Paused · press Run or Space</span>}
            <span className="spacer" />
            <ul className="legend" aria-label="Colour key">
              {LEGEND.map(([c, l]) => (
                <li key={l}><span className="key-dot" style={{ background: c }} />{l}</li>
              ))}
            </ul>
          </header>
          <div className="mimic-wrap">
            <div className="mimic-inner" style={{ '--ar': sim.P.view.w / (sim.P.view.h - (sim.P.view.y0 || 0)) }}>
              <Mimic sim={sim} sel={sel} setSel={setSel} />
              <MimicPopover sim={sim} sel={sel} setSel={setSel} bump={bump} />
            </div>
          </div>
          <p className="mimic-desc">{sim.P.desc} <span className="hint">Click a valve or pump to operate it.</span></p>
        </section>

        <div className="plates">
          {sim.loops.map((L, j) => <Faceplate key={sim.key + L.tag} sim={sim} j={j} bump={bump} />)}
          {sim.loops.length === 2 && <Decoupler key={sim.key} sim={sim} bump={bump} />}
        </div>

        <Trends sim={sim} running={running} theme={theme} />
        <Panels sim={sim} bump={bump} theme={theme} runs={runs} setRuns={setRuns} tab={tab} setTab={setTab} />
      </main>

      <Toasts sim={sim} bump={bump} />
      {guide === 'welcome' && (
        <Welcome
          hide={hideWelcome}
          setHide={setHideWelcome}
          onClose={() => setGuide(null)}
          onTour={() => setGuide('tour')}
          onDemo={() => (setGuide(null), startDemo())}
        />
      )}
      {guide === 'tour' && <Tour name="Interface tour" steps={TOUR} ctx={ctx} onClose={() => setGuide(null)} />}
      {guide === 'demo' && <Tour name="Guided demo" steps={DEMO} ctx={ctx} onClose={() => setGuide(null)} />}
      {ask && <Confirm ask={ask} onClose={() => setAsk(null)} />}
    </>
  )
}
