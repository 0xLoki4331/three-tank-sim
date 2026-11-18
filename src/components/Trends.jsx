import { useMemo, useState } from 'react'
import { Chart, Seg, TANK_COLORS } from './ui.jsx'

const WINDOWS = [[120, '2 min'], [600, '10 min'], [1800, '30 min'], [7200, '2 h'], [0, 'All']]

function lowerBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    a[m] < v ? (lo = m + 1) : (hi = m)
  }
  return lo
}

export default function Trends({ sim, running, theme }) {
  const [win, setWin] = useState(600)
  const H = sim.hist
  const n = H.t.length
  const tEnd = n ? H.t[n - 1] : 0
  // recompute only when new samples land (≈ every 0.25 s sim time)
  const { lv, op, range } = useMemo(() => {
    const i0 = win ? lowerBound(H.t, tEnd - win) : 0
    const sl = (a) => a.slice(i0)
    const x = sl(H.t)
    return {
      lv: [x, ...H.h.map(sl), ...H.sp.map(sl)],
      op: [x, ...H.op.map(sl)],
      range: running ? [win ? Math.max(0, tEnd - win) : 0, Math.max(tEnd, win ? Math.min(win, 60) : 60)] : null,
    }
  }, [n, tEnd, win, running, sim]) // eslint-disable-line react-hooks/exhaustive-deps

  const lvSeries = [
    ...sim.P.tanks.map((t, i) => ({ label: `h ${t.tag}`, color: TANK_COLORS[i] })),
    ...sim.loops.map((L) => ({ label: `SP ${L.tag}`, color: TANK_COLORS[L.tank], dash: [6, 4], width: 1.2 })),
  ]
  const opSeries = sim.loops.map((L) => ({ label: `OP ${sim.P.pumps[L.pump].tag}`, color: TANK_COLORS[L.tank] }))
  const ymax = Math.max(...sim.P.tanks.map((t) => t.hmax * 100))

  return (
    <section className="card trends" data-tour="trends">
      <header>
        <h2>Trends</h2>
        <span className="hint">{running ? 'Live — pause to drag-zoom, double-click to reset' : 'Paused — drag to zoom, double-click to reset'}</span>
        <span className="spacer" />
        <Seg small value={win} options={WINDOWS} onChange={setWin} label="Trend window" />
      </header>
      <div className="trend-body">
        <div className="trend-title">Levels &amp; setpoints [cm]</div>
        <Chart key={sim.key + 'lv'} theme={theme} series={lvSeries} data={lv} height={240} yRange={[0, ymax]} xRange={range} />
        <div className="trend-title">Controller outputs [%]</div>
        <Chart key={sim.key + 'op'} theme={theme} series={opSeries} data={op} height={140} yRange={[0, 100]} xRange={range} />
      </div>
    </section>
  )
}
