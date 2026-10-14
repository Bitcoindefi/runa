const { test } = require('brittle')
const sonido = require('../scripts/tripo-sonido.mjs')

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

// Un AudioContext de mentira: cuenta las fuentes que arrancan. Empieza
// suspendido, como en Safari, hasta que resume() lo deja sonar.
function fakeAudio(log) {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}
  })
  const node = (extra = {}) => ({ connect() {}, ...extra })
  return class FakeContext {
    constructor() {
      this.state = 'suspended'
      this.currentTime = 0
      this.sampleRate = 8000
      this.destination = node()
      log.created++
    }

    resume() {
      this.state = 'running'
      return Promise.resolve()
    }

    suspend() {
      this.state = 'suspended'
      return Promise.resolve()
    }

    createGain() {
      return node({ gain: param() })
    }

    createDynamicsCompressor() {
      return node()
    }

    createBiquadFilter() {
      return node({ type: '', Q: param(), frequency: param() })
    }

    createBuffer(channels, length) {
      const data = new Float32Array(length)
      return { getChannelData: () => data }
    }

    createBufferSource() {
      return node({ buffer: null, start: () => log.started++, stop() {} })
    }

    createOscillator() {
      return node({ type: '', frequency: param(), start: () => log.started++, stop() {} })
    }
  }
}

function fakeWindow(ua, { audio = true } = {}) {
  const log = { created: 0, started: 0, buzz: [] }
  const listeners = new Map()
  const docListeners = new Map()
  const add = (map) => (name, fn) => {
    if (!map.has(name)) map.set(name, new Set())
    map.get(name).add(fn)
  }
  const doc = {
    visibilityState: 'visible',
    addEventListener: add(docListeners),
    fire(name) {
      for (const fn of docListeners.get(name) || []) fn({})
    }
  }
  const win = {
    navigator: {
      userAgent: ua,
      vibrate: (pattern) => {
        log.buzz.push(pattern)
        return true
      }
    },
    document: doc,
    addEventListener: add(listeners),
    removeEventListener(name, fn) {
      if (listeners.has(name)) listeners.get(name).delete(fn)
    },
    fire(name) {
      for (const fn of [...(listeners.get(name) || [])]) fn({})
    },
    listening: (name) => (listeners.get(name) || new Set()).size
  }
  if (audio) win.AudioContext = fakeAudio(log)
  if (/iPhone/.test(ua)) delete win.navigator.vibrate
  return { win, log }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('sonido: each sound has a short recipe that scales with the blow', (t) => {
  for (const kind of sonido.KINDS) {
    const list = sonido.layers(kind, 0.1)
    t.ok(list.length > 0, kind + ' has layers')
    t.ok(sonido.length(kind) > 0.05 && sonido.length(kind) < 1, kind + ' lasts under a second')
    for (const layer of list) {
      t.ok(layer.gain > 0 && layer.gain <= 1, kind + ' gain in range')
      t.ok(layer.f0 > 0 && layer.f1 > 0, kind + ' frequencies are positive')
    }
  }
  const soft = sonido.layers('hit', 0.02)
  const hard = sonido.layers('hit', 0.4)
  t.ok(hard[1].gain > soft[1].gain, 'a big hit is louder')
  t.ok(hard[1].f0 < soft[1].f0, 'a big hit is lower')
  t.alike(sonido.layers('nothing'), [], 'an unknown sound is silent')
})

test('sonido: vibration only on Android', (t) => {
  t.ok(sonido.canVibrate({ userAgent: ANDROID, vibrate() {} }), 'Android vibrates')
  t.absent(sonido.canVibrate({ userAgent: IPHONE }), 'iPhone has no vibrate')
  t.absent(sonido.canVibrate({ userAgent: DESKTOP, vibrate() {} }), 'the PC does not vibrate')
  t.absent(sonido.PATTERNS.whiff, 'a whiff does not vibrate')
  t.ok(sonido.PATTERNS.hurt.length > 0, 'getting hurt vibrates')
})

test('sonido: silent until the first gesture, then it plays', async (t) => {
  const { win, log } = fakeWindow(ANDROID)
  const settings = { sound: true, vibrate: true }
  const s = sonido.createSound({
    win,
    sound: () => settings.sound,
    vibrate: () => settings.vibrate
  })
  t.is(s.state().context, 'none', 'no audio context before a gesture')
  t.absent(s.play('hit', 0.2), 'nothing plays before the gesture')
  t.is(log.created, 0)

  win.fire('pointerdown')
  await tick()
  t.is(s.state().context, 'running', 'the first tap unlocks the audio')
  t.ok(s.state().unlocked)
  win.fire('pointerdown')
  t.is(win.listening('pointerdown'), 0, 'once running, the unlock listeners go away')

  const before = log.started
  t.ok(s.cue('hurt', 0.3), 'a cue plays')
  t.ok(log.started > before, 'the voices start')
  t.alike(log.buzz, [sonido.PATTERNS.hurt], 'and vibrates on Android')
  t.absent(s.play('hurt', 0.3), 'the same sound in the same instant plays once')

  settings.sound = false
  settings.vibrate = false
  t.absent(s.cue('kill'), 'sound off: silent')
  t.is(log.buzz.length, 1, 'vibration off: still')
  t.is(s.state().counts.hurt, 1)
})

test('sonido: no vibration on iPhone, background suspends the audio', async (t) => {
  const { win, log } = fakeWindow(IPHONE)
  const s = sonido.createSound({ win })
  t.absent(s.vibrates)
  win.fire('touchend')
  await tick()
  t.ok(s.cue('telegraph'), 'plays after a touch')
  t.is(log.buzz.length, 0, 'never vibrates on iOS')
  win.document.visibilityState = 'hidden'
  win.document.fire('visibilitychange')
  t.is(s.state().context, 'suspended', 'hidden: suspended')
  t.absent(s.play('kill'), 'nothing plays while hidden')
  win.document.visibilityState = 'visible'
  win.document.fire('visibilitychange')
  await tick()
  t.is(s.state().context, 'running', 'visible again: running')
})

test('sonido: a browser without WebAudio stays silent', (t) => {
  const { win } = fakeWindow(DESKTOP, { audio: false })
  const s = sonido.createSound({ win })
  t.absent(s.state().supported)
  t.absent(s.unlock())
  t.absent(s.cue('hit'))
})
