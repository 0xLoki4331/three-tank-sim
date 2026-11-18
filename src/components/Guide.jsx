// Onboarding & operator feedback: welcome dialog, spotlight tour engine (interface tour + guided demo),
// confirmation dialog for destructive actions, and action toasts with undo.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { evText } from '../sim/model.js'
import { metrics, setDecouplerMode } from '../sim/analysis.js'
import { fmt } from './ui.jsx'

// ============================================================================ modal
export function Modal({ title, children, onClose, labelledBy = 'modal-title', wide }) {
  const ref = useRef(null)
  const close = useRef(onClose)
  close.current = onClose // App re-renders at 30 fps; keep the effect (and focus) stable
  useEffect(() => {
    const prev = document.activeElement
    ;(ref.current.querySelector('[data-autofocus]') ?? ref.current).focus()
    const onKey = (e) => {
      if (e.key === 'Escape') close.current()
      if (e.key === 'Tab') {
        // keep focus inside the dialog
        const f = [...ref.current.querySelectorAll('button, input, select, [href]')].filter((x) => !x.disabled)
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f.at(-1).focus())
        else if (!e.shiftKey && document.activeElement === f.at(-1)) (e.preventDefault(), f[0].focus())
      }
    }
    addEventListener('keydown', onKey)
    return () => (removeEventListener('keydown', onKey), prev?.focus?.())
  }, [])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** Confirmation for destructive actions. Cancel has focus, so a stray Enter does nothing harmful. */
export function Confirm({ ask, onClose }) {
  return (
    <Modal title={ask.title} onClose={onClose} labelledBy="confirm-title">
      <p>{ask.body}</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose} data-autofocus>Cancel</button>
        <button className="btn danger" onClick={() => (ask.run(), onClose())}>{ask.ok}</button>
      </div>
    </Modal>
  )
}

// ============================================================================ welcome
export function Welcome({ onTour, onDemo, onClose, hide, setHide }) {
  return (
    <Modal title="Three-tank process control simulator" onClose={onClose} labelledBy="welcome-title" wide>
      <p>
        The plant is loaded and <b>paused</b>: nothing moves until you press <kbd>Run</kbd> (or <kbd>Space</kbd>). Take a minute to look around.
        How would you like to start?
      </p>
      <div className="choices">
        <button className="choice" onClick={onTour} data-autofocus>
          <b>Interface tour</b>
          <span>What each panel shows and how to operate it. About 1 minute; the simulation stays paused.</span>
        </button>
        <button className="choice" onClick={onDemo}>
          <b>Guided demo</b>
          <span>Eight experiments on the DTS200 plant: start-up, setpoint step, leak, pump trip, recovery, decoupling, metrics, tuning. One click each.</span>
        </button>
        <button className="choice" onClick={onClose}>
          <b>Explore on my own</b>
          <span>Close this and use the simulator directly. Press <kbd>Run</kbd> when ready.</span>
        </button>
      </div>
      <label className="chk" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Don't show this at startup
      </label>
      <p className="note" style={{ margin: '4px 0 0' }}>You can reopen it at any time with <b>Guide</b> in the top bar.</p>
    </Modal>
  )
}

// ============================================================================ tour engine
const q = (t) => (t ? document.querySelector(`[data-tour="${t}"]`) : null)

/**
 * Spotlight walkthrough. Step: { target, title, body, action?: {label, run(ctx)}, onEnter?(ctx), status?(ctx) → {ok, text}, skipIf?(ctx) }
 * The dimmed backdrop does not block clicks, so users can try the highlighted control themselves.
 */
export function Tour({ name, steps, ctx, onClose }) {
  const list = useMemo(() => steps.filter((s) => !s.skipIf?.(ctx)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0)
  const [done, setDone] = useState({})
  const [ch, setCh] = useState(220)
  const card = useRef(null)
  const s = list[i]
  const last = i === list.length - 1
  const go = (d) => setI((v) => Math.min(list.length - 1, Math.max(0, v + d)))

  useEffect(() => {
    s.onEnter?.(ctx)
    const el = q(s.target)
    if (el) el.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight * 0.6 ? 'start' : 'center', behavior: 'smooth' })
    card.current?.focus({ preventScroll: true })
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') last ? onClose() : go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const h = card.current?.offsetHeight
    if (h && Math.abs(h - ch) > 2) setCh(h)
  })

  const el = q(s.target)
  const r = el?.getBoundingClientRect()
  const W = innerWidth
  const H = innerHeight
  const cw = Math.min(400, W - 24)
  let pos
  if (!r) pos = { left: (W - cw) / 2, top: Math.max(12, (H - ch) / 2) }
  else if (r.bottom + 14 + ch < H - 8) pos = { left: r.left, top: r.bottom + 14 }
  else if (r.top - 14 - ch > 8) pos = { left: r.left, top: r.top - 14 - ch }
  else pos = { left: W - cw - 16, top: H - ch - 16 } // target fills the screen → dock bottom-right
  pos.left = Math.min(Math.max(12, pos.left), W - cw - 12)
  const st = s.status?.(ctx)

  return (
    <>
      {r ? (
        <div className="spot" style={{ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 }} aria-hidden="true" />
      ) : (
        <div className="spot-full" aria-hidden="true" />
      )}
      <div ref={card} className="tourcard" style={{ ...pos, width: cw }} role="dialog" aria-label={`${name}: ${s.title}`} tabIndex={-1}>
        <div className="tour-top">
          <span>{name} · {i + 1} / {list.length}</span>
          <button className="x" onClick={onClose} aria-label={`Close ${name}`}>×</button>
        </div>
        <div className="tour-prog" aria-hidden="true"><div style={{ width: `${((i + 1) / list.length) * 100}%` }} /></div>
        <h3>{s.title}</h3>
        <div className="tour-body" aria-live="polite">{s.body}</div>
        {st && <div className={`tour-status${st.ok ? ' ok' : ''}`}>{st.ok ? '✓' : '⏳'} {st.text}</div>}
        <div className="tour-actions">
          <button className="btn sm" onClick={() => go(-1)} disabled={i === 0}>← Back</button>
          <span className="spacer" />
          {s.action && (
            <button className={`btn sm${done[i] ? '' : ' primary'}`} onClick={() => (s.action.run(ctx), setDone({ ...done, [i]: true }), ctx.bump())}>
              {done[i] ? '✓ Done (again?)' : s.action.label}
            </button>
          )}
          <button className={`btn sm${s.action && !done[i] ? '' : ' primary'}`} onClick={() => (last ? onClose() : go(1))}>
            {last ? (s.finishLabel ?? 'Finish') : 'Next →'}
          </button>
        </div>
      </div>
    </>
  )
}

// ============================================================================ scripts
const settled = (sim) => sim.t > 30 && sim.loops.every((L) => L.mode === 'AUTO' && Math.abs(sim.h[L.tank] * 100 - L.sp) < 0.3)
const Key = ({ c, children }) => <span className="key-dot" style={{ background: c }}>{children}</span>

export const TOUR = [
  {
    target: 'preset',
    title: 'Plant configuration',
    body: <p>Choose the plant: the <b>DTS200 benchmark</b> (two pumps, two coupled level loops) or one of the two <b>series</b> layouts (one loop). Switching plant restarts the run, so it asks first.</p>,
  },
  {
    target: 'controls',
    title: 'Simulation controls',
    body: (
      <p>
        The clock shows <b>simulated</b> time. The run starts <b>paused</b>; press <kbd>Run</kbd> or <kbd>Space</kbd>. Tanks take minutes to settle, so use the speed buttons (50–200× is typical).
        Reset asks before discarding the run. <kbd>⛶</kbd> goes fullscreen for presenting.
      </p>
    ),
  },
  {
    target: 'alarms',
    title: 'Alarm strip',
    body: (
      <>
        <p>Abnormal conditions appear here first. The colours mean the same thing everywhere in the app:</p>
        <ul className="legend-list">
          <li><Key c="var(--hihi)" /> <b>Critical</b>, blinking: overflow, pump trip</li>
          <li><Key c="var(--hi)" /> <b>Warning</b>: high level, output saturated, leak, deviation</li>
          <li><Key c="var(--man)" /> <b>Information</b>: loop in manual</li>
        </ul>
        <p>After you inject faults, <b>Restore normal operation</b> appears here as a one-click recovery.</p>
      </>
    ),
  },
  {
    target: 'mimic',
    title: 'Process diagram',
    body: (
      <>
        <p>Live view of the plant. Grey is equipment; colour only carries meaning:</p>
        <ul className="legend-list">
          <li><Key c="var(--liquid)" /> liquid and flowing pipes (dashes move with the flow)</li>
          <li><Key c="var(--run)" /> pump running · <Key c="var(--hihi)" /> pump tripped</li>
          <li>▶ <b>SP</b> arrow = setpoint · dashed amber line = high-level alarm</li>
        </ul>
        <p><b>Click any valve or pump</b> to operate it.</p>
      </>
    ),
  },
  {
    target: 'faceplate-0',
    title: 'Controller faceplate',
    body: (
      <>
        <p>One per control loop. <b>PV</b> = measured level, <b>SP</b> = the level you want, <b>OP</b> = pump output.</p>
        <p><b>AUTO</b>: the PID controller drives the pump. <b>MAN</b>: you do. Type a value and press <kbd>Enter</kbd> to apply (<kbd>Esc</kbd> cancels). Out-of-range values are limited, and you're told so.</p>
        <p>Tuning (Kc, Ti, Td) and response metrics for the last setpoint change are at the bottom.</p>
      </>
    ),
  },
  {
    target: 'decoupler',
    skipIf: (c) => c.sim.loops.length !== 2,
    title: 'Decoupler',
    body: <p>DTS200 only. The two loops disturb each other through the middle tank. The decoupler cancels that interaction. The guided demo shows the effect.</p>,
  },
  {
    target: 'trends',
    title: 'Trends',
    body: <p>History of the levels (solid) against their setpoints (dashed), and the pump outputs below. Colours match the tank tags on the diagram. Pause to drag-zoom; the legend shows the latest values.</p>,
  },
  {
    target: 'tabs',
    title: 'Analysis & tools',
    body: (
      <p>
        Inject disturbances and faults, identify and tune loops, measure performance, inspect the linear model and equations. The <b>Event journal</b> lists every action and alarm, with undo.
      </p>
    ),
  },
  {
    title: "You're ready",
    body: (
      <>
        <p>Every action you take is confirmed at the bottom-right with an <b>Undo</b> button, and logged in the Event journal.</p>
        <p>Reopen this tour or the guided demo with <b>Guide</b> in the top bar.</p>
      </>
    ),
    action: { label: '▶ Start simulation', run: (c) => c.run() },
    finishLabel: 'Close',
  },
]

export const DEMO = [
  {
    title: 'Guided demo · DTS200',
    body: (
      <>
        <p>Eight short experiments on the DTS200 plant. Each step has a <b>blue button</b> that performs the action for you. Read the note, press it, then watch the highlighted area.</p>
        <p>You can also operate the controls yourself; the highlight doesn't block clicks. <kbd>←</kbd> <kbd>→</kbd> to navigate, <kbd>Esc</kbd> to leave.</p>
      </>
    ),
  },
  {
    target: 'controls',
    title: '1 · Start-up',
    body: <p>The tanks start empty. Both controllers go to 100 % output (the amber <b>SAT</b> alarms are expected while filling), then settle: T-1 at 40 cm, T-2 at 20 cm.</p>,
    action: { label: '▶ Start at 200×', run: (c) => (c.setSpeed(200), c.run()) },
    status: (c) => (settled(c.sim) ? { ok: true, text: 'Both loops at setpoint. Continue.' } : { text: 'Filling and settling… (≈10 s at 200×)' }),
  },
  {
    target: 'faceplate-0',
    title: '2 · Setpoint change',
    body: <p>Raise T-1 from 40 to <b>48 cm</b>. Watch T-2: it is pushed off its setpoint although nobody touched LIC-102, because the loops interact through T-3. Rise time, overshoot and settling appear at the bottom of the faceplate.</p>,
    action: {
      label: 'Set LIC-101 SP = 48 cm',
      run: (c) => (c.run(), c.sim.change('LIC-101.sp', 'LIC-101 SP', () => c.sim.loops[0].sp, (v) => c.sim.setSP(0, v), 48, 'cm')),
    },
    status: (c) => {
      const m = metrics(c.sim, 0)
      if (!m || Math.abs(m.to - 48) > 0.01) return null
      return m.settling != null
        ? { ok: true, text: `Settled in ${fmt(m.settling, 0)} s, overshoot ${fmt(m.overshoot, 1)} %, T-2 deviated by up to ${fmt(m.cross, 2)} cm.` }
        : { text: 'Responding…' }
    },
  },
  {
    target: 'mimic',
    title: '3 · Disturbance: leak',
    body: <p>Open a leak at the bottom of T-3. The <b>LEAK</b> alarm appears and both pumps speed up to hold their levels. Feedback control rejects the disturbance without anyone touching the controllers.</p>,
    action: { label: 'Open leak HV-L3 to 60 %', run: (c) => { const p = c.sim.P.pipes.find((x) => x.tag === 'HV-L3'); c.sim.change('HV-L3.valve', 'HV-L3 opening', () => p.valve, (v) => (p.valve = v), 60, '%', 0) } },
    status: (c) => ({ ok: settled(c.sim), text: `Pump outputs: P-101 ${fmt(c.sim.u()[0], 1)} %, P-102 ${fmt(c.sim.u()[1], 1)} %` }),
  },
  {
    target: 'alarms',
    title: '4 · Fault: pump trip',
    body: <p>Trip P-102. T-2 drains away and LIC-102 saturates at 100 %: a controller can't do anything without its actuator. Note the blinking red <b>TRIP</b> alarm.</p>,
    action: { label: 'Trip P-102', run: (c) => c.sim.setPumpFailed(1, true) },
  },
  {
    target: 'alarms',
    title: '5 · Recovery',
    body: <p>One click restores normal operation: the leak closes and P-102 restarts. Anti-windup keeps LIC-102 from a large overshoot on the way back. You could also have used <b>Undo</b> on each toast.</p>,
    action: { label: 'Restore normal operation', run: (c) => c.sim.clearDisturbances() },
    status: (c) => (c.sim.abnormal() ? { text: 'Disturbances still active' } : settled(c.sim) ? { ok: true, text: 'Back at setpoints.' } : { text: 'Recovering…' }),
  },
  {
    target: 'decoupler',
    title: '6 · Decoupling',
    body: <p>Switch the decoupler to <b>DYNAMIC</b> and step T-1 back to 40 cm. Compare with step 2: T-2 now barely moves. Try STATIC later; it's worse than none, because it ignores the slow path through T-3.</p>,
    action: {
      label: 'Decoupler DYNAMIC + SP = 40 cm',
      run: (c) => (setDecouplerMode(c.sim, 'dynamic'), c.sim.change('LIC-101.sp', 'LIC-101 SP', () => c.sim.loops[0].sp, (v) => c.sim.setSP(0, v), 40, 'cm')),
    },
    status: (c) => {
      const m = metrics(c.sim, 0)
      if (!m || Math.abs(m.to - 40) > 0.01 || c.sim.dec.mode === 'off') return null
      return { ok: m.settling != null, text: `T-2 deviated by at most ${fmt(m.cross, 3)} cm (compare with step 2).` }
    },
  },
  {
    target: 'tabs',
    onEnter: (c) => c.setTab('perf'),
    title: '7 · Measure it',
    body: <p>The <b>Performance</b> tab quantifies every setpoint step: rise, overshoot, settling, IAE/ISE, and <b>Interaction</b> (the worst deviation of the other loop). Save runs to compare tunings or decoupler modes side by side.</p>,
  },
  {
    target: 'tabs',
    onEnter: (c) => c.setTab('tune'),
    title: '8 · Tune a loop',
    body: <p>Press <b>Run step test</b>. The tool tests a copy of the plant, fits a first-order-plus-dead-time model and suggests PID settings from classic rules. Apply one; if you don't like it, undo it from the toast.</p>,
  },
  {
    title: 'Demo complete',
    body: (
      <>
        <p>You've seen start-up, setpoint tracking, disturbance rejection, a fault and recovery, decoupling, measurement and tuning.</p>
        <p>Everything you did is in the <b>Event journal</b> tab.</p>
      </>
    ),
    action: { label: 'Open the Event journal', run: (c) => c.setTab('events') },
    finishLabel: 'Close',
  },
]

// ============================================================================ toasts
/** Immediate confirmation of operator actions (with undo). Alarms have their own strip, so they're not toasted. */
export function Toasts({ sim, bump }) {
  const now = performance.now()
  const list = sim.events.filter((e) => e.kind !== 'alarm' && e.kind !== 'clear' && now - e.at < 5000).slice(-3)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((e) => (
        <div key={e.id} className={`toast ${e.kind}${e.undone ? ' undone' : ''}`}>
          <span className="toast-ic" aria-hidden="true">{e.kind === 'fault' ? '!' : '✓'}</span>
          <span>{evText(e)}</span>
          {e.undo && !e.undone && <button className="btn sm" onClick={() => (sim.undo(e), bump())}>↶ Undo</button>}
        </div>
      ))}
    </div>
  )
}
