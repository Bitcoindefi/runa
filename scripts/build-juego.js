#!/usr/bin/env node
'use strict'

// Empaqueta el juego (scripts/tripo-juego.js, que arma lib/ sin tocarlo) para la
// pagina 2.5D. Lo usan el visor local y scripts/build-web.js.
//
//   node scripts/build-juego.js [salida.js]   por defecto vendor/runa-juego.js
//
// Solo se cambia la plataforma, en el momento de empaquetar: bare-fs pasa a
// localStorage, bare-path a un join posix, bare-https a fetch, la terminal y la
// red P2P no existen (el juego ya sabe jugar sin ellas) y Buffer se inyecta para
// lib/stellar.js. El resto de lib/ entra tal cual.

const path = require('path')

const root = path.resolve(__dirname, '..')
const SHIMS = path.join(__dirname, 'navegador')
const ENTRY = path.join(__dirname, 'tripo-juego.js')
const GAME_JS = path.join(root, 'vendor', 'runa-juego.js')

const PACKAGES = {
  'bare-fs': path.join(SHIMS, 'bare-fs.js'),
  'bare-path': path.join(SHIMS, 'bare-path.js'),
  'bare-tty': path.join(SHIMS, 'bare-tty.js'),
  'bare-https': path.join(SHIMS, 'bare-https.js'),
  'bare-crypto': path.join(SHIMS, 'sin-red.js'),
  hyperswarm: path.join(SHIMS, 'sin-red.js'),
  'text-encoding-polyfill': path.join(SHIMS, 'text-encoding.js'),
  // El EventEmitter que piden streamx y compania: los paquetes de Holepunch ya
  // lo cambian por bare-events bajo la condicion "bare".
  events: require.resolve('bare-events')
}
// net.js es la presencia P2P entera: en la pagina se juega solo.
const LIB = { './net.js': path.join(SHIMS, 'sin-red.js') }

const platform = {
  name: 'runa-navegador',
  setup(build) {
    const names = Object.keys(PACKAGES).map((name) => name.replace(/[-/]/g, '\\$&'))
    build.onResolve({ filter: new RegExp('^(' + names.join('|') + ')$') }, (args) => ({
      path: PACKAGES[args.path]
    }))
    build.onResolve({ filter: /^\.\/net\.js$/ }, (args) =>
      path.relative(path.join(root, 'lib'), args.resolveDir) === ''
        ? { path: LIB[args.path] }
        : undefined
    )
  }
}

async function buildGame(outfile = GAME_JS) {
  // esbuild es dependencia de desarrollo (npm run vendor:stellar): se pide aca y
  // no arriba, para que el visor arranque aunque no este.
  const esbuild = require('esbuild')
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    outfile,
    inject: [path.join(SHIMS, 'buffer.mjs')],
    plugins: [platform],
    metafile: true,
    logLevel: 'silent'
  })
  return { outfile, bytes: Object.values(result.metafile.outputs)[0].bytes }
}

module.exports = { buildGame, GAME_JS }

if (require.main === module) {
  buildGame(process.argv[2] ? path.resolve(process.argv[2]) : GAME_JS).then(
    ({ outfile, bytes }) => console.log(`${outfile} (${Math.round(bytes / 1024)} KB)`),
    (error) => {
      for (const problem of error.errors || [error]) {
        const where = problem.location ? ` (${problem.location.file}:${problem.location.line})` : ''
        console.error((problem.text || problem.message) + where)
      }
      process.exitCode = 1
    }
  )
}
