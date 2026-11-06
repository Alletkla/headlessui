# Headless UI `Transition` snaps instead of animating when the main thread is busy

Minimal reproduction for `@headlessui/react` 2.2.0 (also checked against the same logic in 2.2.10), React 19, Tailwind 3. No other UI library.

A possible fix is on the branch [`fix/transition-wait-for-committed-state`](https://github.com/Alletkla/headlessui/tree/fix/transition-wait-for-committed-state) of the same fork.

## Reproduce

```sh
npm install
npm run dev
```

Open http://localhost:5179/ and click **Open**, **Close**, **Open** again. No CPU throttling needed.
The page starts in the **busy main thread** preset. Click **Idle main thread** (all load sliders at 0), then **Open** again to compare.

Expected: every open slides up over 300 ms.
Actual: every open, including the first and ones after a long pause, appears in place. **Close** still slides.

Under load the sheet snaps most of the time. With the **Idle main thread** preset it slides.

## Automated check

With the dev server running (second terminal):

```sh
npm run measure -- '[{"queued":0,"mount":0,"cycles":8},{"cycles":8}]'
```

It uses real clicks (optionally under CPU throttling, `"rate":4`) and counts opens where the panel's `transform` transition never completed.
Needs Playwright's Chromium (`npx playwright install chromium`).

## Cause

In `use-transition.js`:

1. `prepare()` sets the enter flags through React state.
2. After two animation frames, `run()` changes the flags through React state again.
3. One `requestAnimationFrame` later `waitForTransition` calls `node.getAnimations()`. No CSS transition found: `done()` runs immediately.

React renders the state update from step 2 in a Scheduler task, not synchronously. If other tasks are queued in front of it (timers, network callbacks, observers), the browser renders another frame first, step 3 runs before React has committed `run()`'s change, finds no transition, and calls `done()`. `done()` removes `enter`, `enterFrom` and the `transition-*` classes in the same commit that should have applied `enterTo`. The browser never creates a transition.

The page shows **Last open: animated / SNAPPED**, detected by whether a `transitionrun` for the panel's `transform` fired after the click. That is the visible result.

`window.__staleChecks` (shown as "early getAnimations() checks") counts `getAnimations()` calls that return nothing while `data-closed` still has its pre-`run()` value. It increases by 2 per open (overlay and panel) whenever the race happens. It shows that the race fired, not that the sheet snapped: with `api=data` it counts although the sheet animates.

## Controls (also settable as query parameters, e.g. `?queued=20&taskMs=15&mount=100&api=data`)

| Parameter | Default | Meaning |
|---|---|---|
| `queued` | 20 | timers queued from an effect during the opening click task |
| `taskMs` | 15 | busy time of each queued timer |
| `mount` | 100 | busy time in that effect itself (stands in for mounting sheet content). Not the trigger: with `queued=0` nothing snaps at any value. It only matters for the first open, which slides without it. |
| `api` | `classes` (dropdown "Transition API") | `classes`: `enter`/`enterFrom`/`enterTo`/`leave`/... props. `data`: permanent `transition-*` class plus `data-[closed]:` variants |

The defaults block the main thread for about 500 ms per open without any CPU throttling: 100 ms of work in the opening task, then 20 timers of 15 ms.

The queued timers are the trigger: with `queued=0` nothing snaps at any `mount` value. Whether a given combination snaps also depends on where the browser's frames fall relative to the tasks, so it varies between machines. On the machine this was developed on (Chromium, 60 Hz): `mount` 100 to 200 snaps every open including the first; 40 to 90 snaps only some; 0 to 20 snaps every open except the first. If the sheet slides on your machine, raise `mount` or the number of queued tasks.

Results (headless and headed Chromium, no throttling, real clicks, `api=classes`):

| Config | Opens without transition |
|---|---|
| Idle preset (`queued=0&mount=0`) | 0/4 |
| Defaults, 1.5 s to 6 s between opens | every open, including the first |

With `api=data` the stale check still fires, but the sheet slides, because the transition class is never removed.
