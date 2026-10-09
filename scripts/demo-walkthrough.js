'use strict'

// Reproducible recording source: real Runa input, ticks and renderer.
// Uses an isolated in-memory fixture; never opens a player's save store.
// bare scripts/demo-walkthrough.js output/playwright/demo
const fs = require('bare-fs')
const path = require('bare-path')
const { Runa } = require('../lib/game.js')
const { Field } = require('../lib/field.js')
const { BossZone } = require('../lib/boss-zone.js')
const { ansiToHtml, page } = require('./readme-screens.js')

const game = new Runa({ presence: false })
game.width = 120
game.height = 44
const frames = []
const chapters = []
const press = (name) => game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
const type = (letter) =>
  game.onKey({ type: 'key', sequence: letter, ctrl: false, meta: false, is: () => false })

function chapter(caption, seconds, step = () => {}) {
  chapters.push({ second: frames.length / 15, caption })
  for (let i = 0; i < seconds * 15; i++) {
    step(i)
    game.onTick()
    frames.push({ caption, html: ansiToHtml(game.view()) })
  }
}

chapter('RUNA | Tripo: reino, heroe y coloso en una escena ASCII', 8)
press('enter')
chapter('Nueva partida | Heroe generado con Tripo, nombre y reino', 8, (i) => {
  if (i >= 20 && i < 24) type('Ayla'[i - 20])
})
press('enter')
chapter('Exploracion | El mundo y los personajes viven en la terminal', 10, (i) => {
  if (i % 4 === 0) press(i < 75 ? 'up' : 'right')
})
game.walker.placeAt('nox', 160, 103)
chapter('Recorrido de muestra | NOX, el segundo reino', 6, (i) => {
  if (i % 6 === 0) press('left')
})
game.field = new Field({ seed: 17, player: game.player })
game.field.player.x = 111
game.field.player.y = 10
chapter('Pradera | Exploracion y criaturas en movimiento', 8, (i) => {
  if (i % 5 === 0) press('right')
})
game.field = null
game.walker.placeAt('city', 160, 130)
game.player.xp = 60
game.player.gold = 100
game.player.hp = game.player.maxHp
game.shop = 'armor'
game.cursor = 5
chapter('Partida de muestra: nivel 3 y 100 oro | Yelmo Tripo en la armeria', 10, (i) => {
  if (i === 95) press('enter')
})
press('escape')
game.openInventory()
game.inventoryCursor = game.inventoryItems('carried').findIndex((item) => item.id === 'iron_helmet')
chapter('Yelmo comprado y equipado | ASCII animado, defensa +2', 10)
game.inventoryOpen = false
game.field = new BossZone({
  seed: 27,
  player: game.player,
  script: game.scriptSource,
  x: 101,
  y: 22
})
chapter('Ruinas del Coloso | El mismo modelo Tripo ahora vive en el mapa', 8)

const directory = path.resolve(Bare.argv[2] || 'output/playwright/demo')
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(directory, 'frames.json'), JSON.stringify(frames))
fs.writeFileSync(path.join(directory, 'chapters.json'), JSON.stringify(chapters, null, 2) + '\n')
const controls = `<script>
window.demo = { ready: false, done: false, playing: false };
fetch('frames.json').then(r => r.json()).then(frames => {
  const pre = document.querySelector('pre');
  const caption = document.querySelector('.caption');
  const draw = index => { pre.innerHTML = frames[index].html; caption.textContent = frames[index].caption; };
  draw(0);
  window.demo.ready = true;
  window.startDemo = () => {
    if (window.demo.playing) return;
    window.demo.playing = true;
    const start = performance.now();
    function next(now) {
      const frame = Math.max(0, Math.floor((performance.now() - start) * 15 / 1000));
      if (frame >= frames.length) { window.demo.done = true; return; }
      draw(frame);
      requestAnimationFrame(next);
    }
    requestAnimationFrame(next);
  };
});
</script>`
fs.writeFileSync(
  path.join(directory, 'index.html'),
  page('RUNA - Demo Tripo', game.view()).replace('</body>', controls + '</body>')
)
console.log(`${directory}: ${frames.length / 15}s, ${frames.length} real renderer frames`)
