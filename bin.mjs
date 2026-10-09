import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './app.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory'),
  flag('--no-updates', 'disable OTA updates for this run'),
  flag('--name <name>', 'name other players see in the town'),
  flag('--lang <language>', 'interface language: es or en (default es)'),
  flag('--solo', 'play without presence, nobody sees you and you see nobody'),
  flag('--teclas', 'accept keys from the 3D viewer page (scripts/tripo-viewer.js /heroe)')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = cmd.flags.updates
const storage = cmd.flags.storage || path.join(persistent(), appName)
const dir = storage || path.join(os.tmpdir(), 'pear', appName)

console.log(`Updates: ${updates === false ? 'disabled' : 'enabled'}`)

const app = new App({
  dir,
  app: isDev ? null : os.execPath(),
  updates,
  version: pkg.version,
  upgrade: pkg.upgrade,
  name: isWindows ? appName + '.exe' : appName
})

app.on('message', (message) => console.log(message))
app.on('updating', () => console.log('[updater] getting new update'))
app.on('updating-delta', (delta) => console.log('[updater]', delta))
app.on('updated', () => console.log('[updater] update complete... applying'))
app.on('update-applied', () =>
  console.log('[updater] applied update, restart to run latest version')
)
app.on('error', (err) => console.error('[app:error]', err))

let runa = null
const exit = (code) => {
  if (runa) runa.saveCurrent()
  app.exit(code)
}

process.on('SIGHUP', () => exit(129))
process.on('SIGINT', () => exit(130))
process.on('SIGQUIT', () => exit(131))
process.on('SIGTERM', () => exit(143))

try {
  await app.ready()
} catch (err) {
  console.error('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}

// The updater is up; hand the terminal to the game.
//
// This has to happen after app.ready() and not instead of it: the OTA worker is
// what makes an installed copy pick up a new release, and starting the UI first
// would take over the screen before the updater ever ran. The template stops at
// "CLI ready" because it is a boilerplate with no app to start.
const { Program } = await import('bare-tui')
const { Runa } = await import('./lib/game.js')
const { SaveStore } = await import('./lib/saves.js')
const { synchronizeRenderer } = await import('./lib/synchronized-renderer.js')

// The flags are declared up top so paparam does not reject them, and handed
// over explicitly rather than left for the game to dig out of Bare.argv.
runa = new Runa({
  name: cmd.flags.name,
  language: cmd.flags.lang,
  presence: !cmd.flags.solo,
  saves: new SaveStore(path.join(dir, 'saves'))
})
const program = new Program(runa)
program.renderer = synchronizeRenderer(program.renderer)

// The game owns the alternate screen from here, so nothing may write to stdout
// any more. The updater's news is not thrown away though: it is routed into the
// game's log, because an update landing is the premise of this game rather than
// maintenance noise.
app.removeAllListeners('message')
app.removeAllListeners('updating')
app.removeAllListeners('updating-delta')
app.removeAllListeners('updated')
app.removeAllListeners('update-applied')
app.removeAllListeners('error')

const news = (text) => {
  try {
    if (typeof runa.world === 'function') runa.world(text)
  } catch {
    // A broken log line must never take the game down with it.
  }
}

app.on('updating', () => news('algo se mueve afuera...'))
app.on('updated', () => news('el mundo cambio. reinicia para verlo.'))
app.on('update-applied', () => news('el mundo cambio. reinicia para verlo.'))
app.on('error', () => {})

// Teclas desde la pagina 3D del visor. Cada una llega como un archivo en
// <dir>/keys y entra al juego por el mismo camino que la terminal, asi que las
// reglas no cambian: el navegador solo aprieta teclas. Apagado salvo --teclas.
let stopKeys = () => {}
if (cmd.flags.teclas) {
  const { default: fs } = await import('bare-fs')
  const inbox = path.join(dir, 'keys')
  fs.mkdirSync(inbox, { recursive: true })
  // Las teclas que quedaron de otra sesion no se juegan.
  for (const name of fs.readdirSync(inbox)) fs.unlinkSync(path.join(inbox, name))
  // Latido: el visor da la terminal por abierta mientras "alive" sea reciente;
  // si no, la pagina pasa al modo navegador y se juega sola.
  const alive = path.join(inbox, 'alive')
  let beat = 0
  const timer = setInterval(() => {
    if (beat++ % 25 === 0) {
      try {
        fs.writeFileSync(alive, String(Date.now()))
      } catch {
        // La proxima vuelta lo intenta de nuevo.
      }
    }
    let names
    try {
      names = fs
        .readdirSync(inbox)
        .filter((name) => name.endsWith('.key'))
        .sort()
    } catch {
      return
    }
    for (const name of names) {
      const file = path.join(inbox, name)
      try {
        const bytes = fs.readFileSync(file)
        fs.unlinkSync(file)
        if (program.input) program.input.emit('data', bytes)
      } catch {
        // Otro lector la tomo o todavia se esta escribiendo: sigue en la proxima.
      }
    }
  }, 40)
  stopKeys = () => clearInterval(timer)
}

try {
  await program.run()
} finally {
  stopKeys()
  runa.saveCurrent()
  await app.close().catch(() => {})
}
