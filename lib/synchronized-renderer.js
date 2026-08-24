'use strict'

// DEC mode 2026 asks a compatible terminal to keep displaying the previous
// frame while it processes the next one. Windows Terminal then publishes the
// completed frame at ESU, avoiding the visible top-to-bottom row sweep.
const BEGIN_SYNCHRONIZED_UPDATE = '\x1b[?2026h'
const END_SYNCHRONIZED_UPDATE = '\x1b[?2026l'

/**
 * Add atomic presentation to bare-tui's renderer without patching the package.
 * The inner renderer still owns diffing and screen lifecycle; this wrapper
 * collects its synchronous render write and sends one synchronized frame.
 */
class SynchronizedRenderer {
  constructor(inner) {
    this.inner = inner
  }

  start() {
    return this.inner.start()
  }

  clear() {
    return this.inner.clear()
  }

  render(view) {
    const output = this.inner.out
    const chunks = []

    // Renderer.render() is synchronous. Swapping only its output sink lets us
    // batch the existing implementation without touching the real TTY stream.
    this.inner.out = {
      write(chunk) {
        chunks.push(String(chunk))
        return true
      }
    }

    try {
      this.inner.render(view)
    } finally {
      this.inner.out = output
    }

    if (chunks.length === 0) return
    output.write(BEGIN_SYNCHRONIZED_UPDATE + chunks.join('') + END_SYNCHRONIZED_UPDATE)
  }

  stop() {
    return this.inner.stop()
  }
}

function synchronizeRenderer(renderer) {
  return new SynchronizedRenderer(renderer)
}

module.exports = {
  BEGIN_SYNCHRONIZED_UPDATE,
  END_SYNCHRONIZED_UPDATE,
  SynchronizedRenderer,
  synchronizeRenderer
}
