import { pumpFlow } from '../sim/model.js'
import { fmt, TANK_COLORS } from './ui.jsx'

const TW = 150 // tank width [px]
const PY = 14 // pipe height above tank base [px]

function Valve({ x, y, open, vertical, small, onClick, tag, active }) {
  const s = small ? 0.75 : 1
  const shut = open <= 0
  return (
    <g className="clickable" onClick={onClick} transform={`translate(${x} ${y}) rotate(${vertical ? 90 : 0}) scale(${s})`} role="button" aria-label={`Valve ${tag}, ${open}% open`}>
      <rect x="-16" y="-14" width="32" height="28" fill="transparent" />
      <path className="hl" d="M-12,-8 L12,8 L12,-8 L-12,8 Z" fill={shut ? 'var(--equip)' : 'var(--panel-hi)'} stroke={active ? 'var(--accent)' : 'var(--equip)'} strokeWidth={active ? 2.5 : 1.5} strokeLinejoin="round" />
      {open > 0 && open < 100 && <path d="M-12,-8 L-12,8 L0,0 Z" fill="var(--equip)" opacity="0.55" />}
      <line x1="0" y1="0" x2="0" y2="-14" stroke="var(--equip)" strokeWidth="1.5" />
      <rect x="-6" y="-18" width="12" height="4" fill="var(--equip)" />
    </g>
  )
}

function Pipe({ d, q, dir = 1 }) {
  const moving = Math.abs(q) > 0.05
  const dur = Math.min(4, Math.max(0.25, 30 / Math.abs(q || 1)))
  return (
    <g>
      <path d={d} fill="none" stroke="var(--pipe)" strokeWidth="9" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--equip-fill)" strokeWidth="5" strokeLinejoin="round" />
      {moving && (
        <path d={d} fill="none" stroke="var(--flow)" strokeWidth="4" strokeLinejoin="round" className={`flowline${q * dir < 0 ? ' rev' : ''}`} style={{ animationDuration: `${dur}s` }} />
      )}
    </g>
  )
}

const FlowLabel = ({ x, y, q, tag, anchor = 'middle' }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize="11" fill="var(--muted)">
    <tspan fontWeight="600" fill="var(--text)">{tag}</tspan>
    <tspan className="t-mono" dx="5">{fmt(Math.abs(q), 1)} mL/s</tspan>
  </text>
)

export default function Mimic({ sim, sel, setSel }) {
  const P = sim.P
  const { w, h: vh } = P.view
  const resTop = vh - 62
  const T = P.tanks.map((t, i) => ({ ...t, i, top: t.base - t.hpx, right: t.x + TW, cx: t.x + TW / 2, lv: sim.h[i] }))
  const flows = sim.flows()
  const u = sim.u()
  const loopOf = (i) => sim.loops.find((L) => L.tank === i)
  const toggle = (s) => setSel(sel && sel.kind === s.kind && sel.idx === s.idx ? null : s)
  const pipes = []
  const valves = []
  const labels = []

  P.pipes.forEach((p, k) => {
    const a = T[p.from]
    const q = flows[k]
    const isSel = sel?.kind === 'valve' && sel.idx === k
    const click = (x, y) => () => toggle({ kind: 'valve', idx: k, x, y })
    if (p.leak) {
      const y0 = a.base
      pipes.push(<Pipe key={k} d={`M${a.cx + 30},${y0} V${y0 + 24}`} q={0} />)
      valves.push(<Valve key={k} x={a.cx + 30} y={y0 + 13} vertical small open={p.valve} tag={p.tag} active={isSel} onClick={click(a.cx + 30, y0 + 24)} />)
      if (p.valve > 0 && q > 0.05)
        labels.push(
          <g key={k}>
            <circle className="drip" cx={a.cx + 30} cy={y0 + 30} r="3" fill="var(--flow)" />
            <text x={a.cx + 40} y={y0 + 34} fontSize="10" fill="var(--hihi)" className="t-mono">LEAK {fmt(q, 1)} mL/s</text>
          </g>,
        )
      return
    }
    const y = a.base - PY
    if (p.law === 'interact') {
      const b = T[p.to]
      const [L, R] = a.x < b.x ? [a, b] : [b, a]
      const dir = a.x < b.x ? 1 : -1
      const mx = (L.right + R.x) / 2
      pipes.push(<Pipe key={k} d={`M${L.right},${y} H${R.x}`} q={q} dir={dir} />)
      valves.push(<Valve key={k} x={mx} y={y} open={p.valve} tag={p.tag} active={isSel} onClick={click(mx, y + 12)} />)
      labels.push(<FlowLabel key={k} x={mx} y={y - 26} q={q} tag={p.tag} />)
    } else if (p.law === 'free') {
      const b = T[p.to]
      const ex = b.x + 12
      const mx = (a.right + ex) / 2 - 10
      pipes.push(<Pipe key={k} d={`M${a.right},${y} H${ex} V${b.top + 20}`} q={q} />)
      if (q > 0.05) labels.push(<path key={'f' + k} d={`M${ex - 3},${b.top + 20} q3 ${Math.min(40, 6 + q)} 6 0`} fill="var(--flow)" opacity="0.7" />)
      valves.push(<Valve key={k} x={mx} y={y} open={p.valve} tag={p.tag} active={isSel} onClick={click(mx, y + 12)} />)
      labels.push(<FlowLabel key={k} x={mx} y={y - 26} q={q} tag={p.tag} />)
    } else {
      const ex = a.right + 62
      pipes.push(<Pipe key={k} d={`M${a.right},${y} H${ex} V${resTop + 6}`} q={q} />)
      valves.push(<Valve key={k} x={a.right + 30} y={y} open={p.valve} tag={p.tag} active={isSel} onClick={click(a.right + 30, y + 12)} />)
      labels.push(<FlowLabel key={k} x={a.right + 38} y={y - 26} q={q} tag={p.tag} anchor="start" />)
    }
  })

  const pumps = P.pumps.map((pm, j) => {
    const t = T[pm.tank]
    const left = pm.side === 'left'
    const px = left ? t.x - 78 : t.right + 175
    const py = resTop - 24
    const ex = left ? t.x + 12 : t.right - 12
    const q = pumpFlow(pm, u[j]) * 1e6
    const run = q > 0.05
    const isSel = sel?.kind === 'pump' && sel.idx === j
    const L = sim.loops.find((l) => l.pump === j)
    return (
      <g key={'p' + j}>
        <Pipe d={`M${px},${py - 20} V${t.top - 26} H${ex} V${t.top + 18}`} q={q} />
        {run && <path d={`M${ex - 3},${t.top + 18} q3 ${Math.min(50, 8 + q / 2)} 6 0`} fill="var(--flow)" opacity="0.7" />}
        <line x1={px} y1={py + 20} x2={px} y2={resTop + 10} stroke="var(--pipe)" strokeWidth="9" />
        <g className="clickable" onClick={() => toggle({ kind: 'pump', idx: j, x: px, y: py + 22 })} role="button" aria-label={`Pump ${pm.tag}`}>
          <circle className="hl" cx={px} cy={py} r="20" fill={pm.failed ? 'var(--hihi)' : run ? 'var(--run)' : 'var(--equip-fill)'} stroke={isSel ? 'var(--accent)' : 'var(--equip)'} strokeWidth={isSel ? 2.5 : 1.5} />
          <path d={`M${px - 9},${py + 9} L${px},${py - 12} L${px + 9},${py + 9} Z`} fill={run || pm.failed ? '#fff' : 'var(--equip)'} opacity="0.9" />
          {pm.failed && <path d={`M${px - 12},${py - 12} L${px + 12},${py + 12} M${px + 12},${py - 12} L${px - 12},${py + 12}`} stroke="#fff" strokeWidth="3" />}
        </g>
        <text x={px} y={py - 30} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text)">{pm.tag}</text>
        <text x={px - 26} y={py + 4} textAnchor="end" fontSize="11" className="t-mono" fill="var(--muted)">
          <tspan x={px - 26} dy="-6">{fmt(u[j], 1)} %</tspan>
          <tspan x={px - 26} dy="13">{fmt(q, 1)} mL/s</tspan>
        </text>
      </g>
    )
  })

  const tanks = T.map((t) => {
    const lpx = (t.lv / t.hmax) * t.hpx
    const L = loopOf(t.i)
    const frac = t.lv / t.hmax
    const st = frac >= 0.98 ? 'hihi' : frac >= 0.9 ? 'hi' : null
    const stroke = st ? `var(--${st})` : 'var(--equip)'
    const pxm = t.hpx / (t.hmax * 100) // px per cm
    const ticks = []
    for (let c = 0; c <= t.hmax * 100; c += 10)
      ticks.push(
        <g key={c}>
          <line x1={t.x} x2={t.x + (c % 20 ? 6 : 10)} y1={t.base - c * pxm} y2={t.base - c * pxm} stroke="var(--line-strong)" />
          {c % 20 === 0 && t.hpx > 200 && <text x={t.x + 13} y={t.base - c * pxm + 3.5} fontSize="9" fill="var(--faint)" className="t-mono">{c}</text>}
        </g>,
      )
    const qd = (P.qd[t.i] || 0) * 1e6
    return (
      <g key={'t' + t.i}>
        <rect x={t.x} y={t.top} width={TW} height={t.hpx} rx="4" fill="var(--equip-fill)" />
        <rect x={t.x + 2} y={t.base - lpx} width={TW - 4} height={Math.max(0, lpx - 1)} fill="var(--liquid)" />
        {lpx > 1 && <rect x={t.x + 2} y={t.base - lpx} width={TW - 4} height="3" fill="var(--liquid-hi)" />}
        <line x1={t.x} x2={t.right} y1={t.base - 0.9 * t.hpx} y2={t.base - 0.9 * t.hpx} stroke="var(--hi)" strokeDasharray="4 4" opacity="0.7" />
        {ticks}
        {L && (
          <g>
            <line x1={t.x} x2={t.right} y1={t.base - L.sp * pxm} y2={t.base - L.sp * pxm} stroke="var(--text)" strokeDasharray="2 4" opacity="0.6" />
            <path d={`M${t.right + 2},${t.base - L.sp * pxm} l10,-7 v14 Z`} fill="var(--text)" />
            <text x={t.right + 15} y={t.base - L.sp * pxm + 4} fontSize="10" className="t-mono" fill="var(--text)">SP</text>
          </g>
        )}
        <rect x={t.x} y={t.top} width={TW} height={t.hpx} rx="4" fill="none" stroke={stroke} strokeWidth={st ? 3 : 2} />
        {/* level readout */}
        <g>
          <rect x={t.cx - 52} y={t.top - 4 - 22} width="104" height="22" rx="3" fill="var(--panel-hi)" stroke="var(--line-strong)" />
          <rect x={t.cx - 52} y={t.top - 26} width="5" height="22" rx="1" fill={TANK_COLORS[t.i]} />
          <text x={t.cx - 40} y={t.top - 11} fontSize="10" fill="var(--muted)" fontWeight="600">LT</text>
          <text x={t.cx + 46} y={t.top - 10} fontSize="13" textAnchor="end" className="t-mono" fill="var(--text)">
            {fmt(t.lv * 100, 1)}
            <tspan fontSize="10" fill="var(--muted)"> cm</tspan>
          </text>
        </g>
        <text x={t.cx} y={t.base + 16 + (t.hpx < 200 ? 0 : 0)} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)" dx={-28}>{t.tag}</text>
        {st && (
          <g>
            <rect x={t.cx - 34} y={t.top + 8} width="68" height="18" rx="3" fill={`var(--${st})`} />
            <text x={t.cx} y={t.top + 21} textAnchor="middle" fontSize="11" fontWeight="700" fill={st === 'hihi' ? '#fff' : '#111'}>{st === 'hihi' ? 'OVERFLOW' : 'HI LEVEL'}</text>
          </g>
        )}
        {qd > 0.05 && (
          <g>
            <path d={`M${t.cx + 20},${t.top - 70} V${t.top + 14}`} stroke="var(--dist)" strokeWidth="3" strokeDasharray="5 4" className="flowline" style={{ animationDuration: '1s' }} />
            <path d={`M${t.cx + 13},${t.top + 8} l7,10 l7,-10 Z`} fill="var(--dist)" />
            <text x={t.cx + 26} y={t.top - 56} fontSize="11" fill="var(--dist)" fontWeight="600">Qd {fmt(qd, 1)} mL/s</text>
          </g>
        )}
      </g>
    )
  })

  return (
    <svg viewBox={`0 0 ${w} ${vh}`} role="img" aria-label={`Process diagram: ${P.name}`} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
      {/* reservoir */}
      <rect x="30" y={resTop} width={w - 60} height="44" rx="6" fill="var(--equip-fill)" stroke="var(--equip)" strokeWidth="1.5" />
      <rect x="32" y={resTop + 14} width={w - 64} height="28" rx="4" fill="var(--liquid)" opacity="0.55" />
      <text x={w / 2} y={resTop + 33} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)" letterSpacing="1.5">RESERVOIR · TK-100</text>
      {pipes}
      {pumps}
      {tanks}
      {valves}
      {labels}
    </svg>
  )
}

/** Popover for the selected valve/pump, absolutely positioned over the SVG. */
export function MimicPopover({ sim, sel, setSel, bump }) {
  if (!sel) return null
  const { w, h } = sim.P.view
  const style = { left: `${(sel.x / w) * 100}%`, top: `${(sel.y / h) * 100}%` }
  if (sel.kind === 'valve') {
    const p = sim.P.pipes[sel.idx]
    if (!p) return null
    const q = sim.flows()[sel.idx]
    const from = sim.P.tanks[p.from].tag
    const to = p.to == null ? 'reservoir' : sim.P.tanks[p.to].tag
    return (
      <div className="pop" style={style}>
        <h4>
          {p.tag} <span className="note" style={{ fontWeight: 400 }}>{p.leak ? 'leak / drain valve' : 'hand valve'}</span>
          <button className="x" onClick={() => setSel(null)} aria-label="Close">×</button>
        </h4>
        <div className="row">Path <b>{from} → {to}</b></div>
        <div className="row">Flow <b>{fmt(q, 2)} mL/s</b></div>
        <div className="row">Opening <b>{p.valve} %</b></div>
        <input type="range" min="0" max="100" value={p.valve} onChange={(e) => ((p.valve = +e.target.value), bump())} aria-label={`${p.tag} opening`} />
        <div className="inline" style={{ marginTop: 6 }}>
          {[0, 25, 50, 100].map((v) => <button key={v} className="btn sm" onClick={() => ((p.valve = v), bump())}>{v}%</button>)}
        </div>
      </div>
    )
  }
  const pm = sim.P.pumps[sel.idx]
  const L = sim.loops.find((l) => l.pump === sel.idx)
  return (
    <div className="pop" style={style}>
      <h4>
        {pm.tag} <span className="note" style={{ fontWeight: 400 }}>feed pump → {sim.P.tanks[pm.tank].tag}</span>
        <button className="x" onClick={() => setSel(null)} aria-label="Close">×</button>
      </h4>
      <div className="row">Controller <b>{L?.tag ?? '—'} ({L?.mode})</b></div>
      <div className="row">Output <b>{fmt(sim.u()[sel.idx], 1)} %</b></div>
      <div className="row">Flow <b>{fmt(pumpFlow(pm, sim.u()[sel.idx]) * 1e6, 1)} mL/s</b></div>
      <div className="row">Capacity <b>{fmt(pm.Qmax * 1e6, 0)} mL/s</b></div>
      <button className={`btn sm${pm.failed ? ' primary' : ''}`} style={{ marginTop: 6, width: '100%' }} onClick={() => ((pm.failed = !pm.failed), bump())}>
        {pm.failed ? 'Restore pump' : 'Trip pump (fault)'}
      </button>
    </div>
  )
}
