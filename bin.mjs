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
  flag('--solo', 'play without presence, nobody sees you and you see nobody')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = cmd.flags.updates
const storage = cmd.flags.storage || (isDev ? null : path.join(persistent(), appName))
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

process.on('SIGHUP', () => app.exit(129))
process.on('SIGINT', () => app.exit(130))
process.on('SIGQUIT', () => app.exit(131))
process.on('SIGTERM', () => app.exit(143))

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
const { synchronizeRenderer } = await import('./lib/synchronized-renderer.js')

// The flags are declared up top so paparam does not reject them, and handed
// over explicitly rather than left for the game to dig out of Bare.argv.
const runa = new Runa({ name: cmd.flags.name, presence: !cmd.flags.solo })
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

try {
  await program.run()
} finally {
  await app.close().catch(() => {})
}
