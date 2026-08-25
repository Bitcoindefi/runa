/**
 * The Sage NPC (issue #11): wires the orphaned `lib/sage.js` translator into
 * the game so natural-language rules reach `script.txt` without a text editor.
 *
 * Flow: player talks to the sage (`e`) -> game enters sage mode ->
 * bare-tui textinput collects one sentence -> Sage.ask() translates it ->
 * on success the returned rule block is appended to script.txt and picked up
 * by the normal script reload path.
 */

const fs = require('bare-fs')

/**
 * One conversation with the sage. The main loop feeds keystrokes in through
 * handle() while active, and receives the closing lines via onDone.
 */
class SageSession {
  constructor(createInput, readScript, writeScript, onDone) {
    this.createInput = createInput
    this.readScript = readScript
    this.writeScript = writeScript
    this.onDone = onDone
    this.say = []
    this.closed = false
    this.lines = []
  }

  start() {
    const { Sage } = require('./sage.js')
    this.sage = new Sage()
    this.say.push('el sabio te escucha. decile una regla en palabras.')
    return this
  }

  get active() {
    return !this.closed
  }

  /**
   * Feed one sentence to the sage.
   * @param {string} sentence
   */
  ask(sentence) {
    if (this.closed) return false
    const result = this.sage.ask(String(sentence ?? ''))
    for (const line of result.say || []) this.say.push(line)

    if (result.ok && result.script) {
      try {
        const current = String(this.readScript() ?? '')
        const next =
          current.trimEnd() + (current.trim() ? '\n' : '') + result.script + '\n'
        this.writeScript(next)
        this.say.push('la regla quedo escrita en tu script')
      } catch {
        this.say.push('no pude escribir el script; intenta con ? y tu editor')
      }
    } else if (result.examples && result.examples.length) {
      this.say.push(`probá: ${result.examples[0]}`)
    }

    return true
  }

  close(message) {
    if (message && this.say[this.say.length - 1] !== message) this.say.push(message)
    this.closed = true
    if (this.onDone) this.onDone(this.say)
    return true
  }
}

module.exports = { SageSession }
