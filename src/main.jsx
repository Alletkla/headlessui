import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Transition, TransitionChild } from '@headlessui/react'
import './index.css'

// Initial values of the on-page controls can be set with query parameters (used by scripts/measure.cjs).
// ?api=classes (default): enter/enterFrom/enterTo/leave/... props. Snaps under load.
// ?api=data: permanent transition class + data-[closed]: variants. Does not snap.
// ?queued=N&taskMs=M: N timers of M ms queued from an effect in the opening click task.
// ?mount=M: M ms of busy work in that same effect.
const params = new URLSearchParams(location.search)
const API = params.get('api') === 'data' ? 'data' : 'classes'
const num = (key, fallback) => Number(params.get(key) ?? fallback)

const busyWait = (ms) => {
  const end = performance.now() + ms
  while (performance.now() < end) {}
}

// Counts getAnimations() checks that run before React committed the flag change from run().
window.__staleChecks = 0
const original = Element.prototype.getAnimations
Element.prototype.getAnimations = function (...args) {
  const animations = original.apply(this, args)
  const closed = this.hasAttribute('data-closed')
  const stale =
    (this.hasAttribute('data-enter') && closed) || (this.hasAttribute('data-leave') && !closed)
  if (animations.length === 0 && stale) window.__staleChecks++
  return animations
}

// Tasks queued while the click task runs, like timers or network callbacks in a real app.
// Runs once when the panel mounts (the opening click task), so moving a slider while open does nothing.
function Load({ mount, queued, taskMs }) {
  useEffect(() => {
    busyWait(mount)
    for (let i = 0; i < queued; i++) setTimeout(() => busyWait(taskMs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

const classProps = (prop, from, to) => ({
  enter: `transition-${prop} duration-300 ease-out`,
  enterFrom: from,
  enterTo: to,
  leave: `transition-${prop} duration-300 ease-out`,
  leaveFrom: to,
  leaveTo: from,
})

const variants = (api) =>
  api === 'classes'
    ? {
        overlay: { ...classProps('opacity', 'opacity-0', 'opacity-100'), className: '' },
        panel: { ...classProps('transform', 'translate-y-full', 'translate-y-0'), className: '' },
      }
    : {
        overlay: { className: 'transition-opacity duration-300 ease-out data-[closed]:opacity-0' },
        panel: { className: 'transition-transform duration-300 ease-out data-[closed]:translate-y-full' },
      }

function Slider({ id, label, value, onChange, max }) {
  return (
    <label className="block text-sm">
      {label}: {value}
      <input id={id} type="range" min="0" max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="ml-2 align-middle" />
    </label>
  )
}

function App() {
  const [open, setOpen] = useState(false)
  const [api, setApi] = useState(API)
  const [mount, setMount] = useState(num('mount', 100))
  const [queued, setQueued] = useState(num('queued', 20))
  const [taskMs, setTaskMs] = useState(num('taskMs', 15))
  const [checks, setChecks] = useState(0)
  const [result, setResult] = useState({ opens: 0, snapped: 0, last: '-' })
  const slid = useRef(false)

  // Did the panel's transform transition start after the click? No transition = the sheet snapped.
  useEffect(() => {
    const onRun = (e) => {
      if (e.target.id === 'panel' && e.propertyName === 'transform') slid.current = true
    }
    document.addEventListener('transitionrun', onRun)
    return () => document.removeEventListener('transitionrun', onRun)
  }, [])

  const openSheet = () => {
    slid.current = false
    setOpen(true)
    setTimeout(() => {
      setResult((r) => ({
        opens: r.opens + 1,
        snapped: r.snapped + (slid.current ? 0 : 1),
        last: slid.current ? 'animated' : 'SNAPPED',
      }))
    }, 800)
  }
  const { overlay, panel } = variants(api)

  useEffect(() => {
    const id = setInterval(() => setChecks(window.__staleChecks), 200)
    return () => clearInterval(id)
  }, [])

  const preset = (m, q, t) => () => (setMount(m), setQueued(q), setTaskMs(t))

  return (
    <div className="relative z-50 w-fit space-y-2 p-8">
      <div className="flex gap-2">
        <button id="open" className="rounded bg-gray-900 px-3 py-1 text-white" onClick={openSheet}>
          Open
        </button>
        <button id="close" className="rounded border px-3 py-1" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="flex gap-2 text-sm">
        <button id="busy" className="rounded border px-2 py-0.5" onClick={preset(100, 20, 15)}>
          Busy main thread
        </button>
        <button id="idle" className="rounded border px-2 py-0.5" onClick={preset(0, 0, 0)}>
          Idle main thread
        </button>
      </div>
      <Slider id="mount" label="Busy work in the opening task (ms)" value={mount} onChange={setMount} max={800} />
      <Slider id="queued" label="Tasks queued during the opening task" value={queued} onChange={setQueued} max={40} />
      <Slider id="task-ms" label="Length of each queued task (ms)" value={taskMs} onChange={setTaskMs} max={50} />
      <label className="block text-sm">
        Transition API:{' '}
        <select id="api" value={api} onChange={(e) => setApi(e.target.value)} className="rounded border">
          <option value="classes">enter / enterFrom / enterTo props</option>
          <option value="data">data-[closed] variants</option>
        </select>
      </label>
      <p className="text-sm">
        Last open: <b id="last">{result.last}</b> (snapped {result.snapped} of {result.opens} opens)
      </p>
      <p className="text-sm text-gray-600">
        Early getAnimations() checks (the race fired): <b id="stale">{checks}</b>. This also counts
        in the data-variants mode, where the race fires but the sheet still animates.
      </p>

      <Transition key={api} show={open} appear>
        <TransitionChild
          as="div"
          {...overlay}
          className={`pointer-events-none fixed inset-0 bg-black/50 ${overlay.className}`}
        />
        <TransitionChild
          as="div"
          id="panel"
          {...panel}
          className={`fixed inset-x-0 bottom-0 z-10 h-1/2 bg-white p-6 ${panel.className}`}
        >
          Sheet
          <Load mount={mount} queued={queued} taskMs={taskMs} />
        </TransitionChild>
      </Transition>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
