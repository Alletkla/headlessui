import { act, render } from '@testing-library/react'
import React from 'react'
import { Transition } from '../components/transition/transition'

// jsdom has no `CSSTransition`, so we fake one that we can finish by hand.
class FakeCSSTransition {
  playState = 'running'
  finished: Promise<void>
  finish!: () => void

  constructor() {
    this.finished = new Promise<void>((resolve) => {
      this.finish = () => {
        this.playState = 'finished'
        resolve()
      }
    })
  }
}

let frames: FrameRequestCallback[] = []
let original: { CSSTransition: any; getAnimations: any; raf: any; caf: any }

beforeEach(() => {
  original = {
    CSSTransition: (globalThis as any).CSSTransition,
    getAnimations: Element.prototype.getAnimations,
    raf: window.requestAnimationFrame,
    caf: window.cancelAnimationFrame,
  }
  ;(globalThis as any).CSSTransition = FakeCSSTransition

  // Frames only run when the test says so, so that a frame can come before React
  // has rendered a state update, like on a busy main thread.
  frames = []
  window.requestAnimationFrame = (cb) => frames.push(cb)
  window.cancelAnimationFrame = (id) => void (frames[id - 1] = () => {})
})

afterEach(() => {
  ;(globalThis as any).CSSTransition = original.CSSTransition
  Element.prototype.getAnimations = original.getAnimations
  window.requestAnimationFrame = original.raf
  window.cancelAnimationFrame = original.caf
})

function runFrame() {
  let current = frames
  frames = []
  current.forEach((cb) => cb(performance.now()))
}

describe('transition timing', () => {
  it('should wait for React to commit the state change before looking for transitions', async () => {
    let transition = new FakeCSSTransition()

    // Like a browser: the transition only exists once the `data-closed` attribute
    // is removed from the DOM.
    Element.prototype.getAnimations = function () {
      let started = this.hasAttribute('data-enter') && !this.hasAttribute('data-closed')
      return started ? ([transition] as any) : []
    }

    let afterEnter = jest.fn()
    function Example({ show }: { show: boolean }) {
      return (
        <Transition show={show} afterEnter={afterEnter}>
          <div data-testid="panel" />
        </Transition>
      )
    }

    let { rerender, getByTestId } = render(<Example show={false} />)
    rerender(<Example show={true} />)
    expect(getByTestId('panel')).toHaveAttribute('data-closed')

    // Outside of `act`, React renders state updates in a later task.
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
    try {
      runFrame() // first frame
      runFrame() // second frame: `run()` removes the `Closed` flag, not rendered yet
      expect(getByTestId('panel')).toHaveAttribute('data-closed')

      runFrame() // the frame that looks for transitions
      expect(afterEnter).not.toHaveBeenCalled()

      // React renders: the transition starts
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(getByTestId('panel')).not.toHaveAttribute('data-closed')

      runFrame()
      expect(afterEnter).not.toHaveBeenCalled()

      await act(async () => {
        transition.finish()
        await transition.finished
      })
      expect(afterEnter).toHaveBeenCalledTimes(1)
    } finally {
      ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    }
  })
})
