'use strict'

// Reproducible recording source: real Runa input, ticks and renderer.
// Uses an isolated in-memory fixture; never opens a player's save store.
// bare scripts/demo-walkthrough.js output/playwright/demo-tripo-focused
const fs = require('bare-fs')
const path = require('bare-path')
const { Runa } = require('../lib/game.js')
const { BossZone } = require('../lib/boss-zone.js')
const { ansiToHtml, page } = require('./readme-screens.js')

const game = new Runa({ presence: false, language: 'en' })
const extended = Bare.argv.includes('--extended')
game.width = 120
game.height = 44
const frames = []
const chapters = []
const initialView = game.view()
const press = (name) => game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
const type = (letter) =>
  game.onKey({ type: 'key', sequence: letter, ctrl: false, meta: false, is: () => false })

function chapter(caption, seconds, step = () => {}) {
  chapters.push({ second: frames.length / 15, caption })
  for (let i = 0; i < seconds * 15; i++) {
    step(i)
    game.onTick()
    frames.push({ caption, html: ansiToHtml(game.view()), columns: game.width, rows: game.height })
  }
}

chapter('Tripo to ASCII | A full rotation of the generated Colossus', 12)
press('enter')
chapter('New game | Tripo hero, player name and home kingdom', 8, (i) => {
  if (i >= 20 && i < 24) type('Ayla'[i - 20])
})
press('enter')
game.walker.placeAt('city', 160, 130)
game.player.xp = 60
game.player.gold = 100
game.player.hp = game.player.maxHp
game.shop = 'armor'
game.cursor = 5
chapter('Tripo iron helmet | Select and buy the real item (level 3 demo fixture)', 8, (i) => {
  if (i === 75) press('enter')
})
press('escape')
game.openInventory()
game.inventoryCursor = game.inventoryItems('carried').findIndex((item) => item.id === 'iron_helmet')
chapter('Tripo helmet equipped | Rotating preview and defense +2', 8)
game.inventoryOpen = false
// Frame the real 43x13 boss in an 80x24 terminal, enlarged for the recording.
game.width = 80
game.height = 24
game.player.items.add('sword')
game.player.equip('sword')
// Advanced combat fixture for the longer edit, with normal level-derived HP.
// The video labels this jump; no level-up or damage immunity is fabricated.
if (extended) {
  game.player.xp = 30000
  game.player.hp = game.player.maxHp
}
game.field = new BossZone({
  seed: 27,
  player: game.player,
  script: game.scriptSource,
  x: 91,
  y: 22
})
const bossStartHp = game.field.boss.hp
chapter(
  'Tripo Colossus in combat | Full model, real hits and attack warnings',
  extended ? 30 : 10,
  (i) => {
    if (i % 15 === 0) press('f')
    if (i % 150 === 30 || i % 150 === 60) press('up')
    if (i % 150 === 90 || i % 150 === 120) press('down')
  }
)
if (!game.field || game.field.mode !== 'boss' || game.field.boss.hp >= bossStartHp) {
  throw new Error('The demo must show real damage to the Colossus and stay in its arena')
}

const directory = path.resolve(Bare.argv[2] || 'output/playwright/demo-tripo-focused')
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(directory, 'frames.json'), JSON.stringify(frames))
fs.writeFileSync(path.join(directory, 'chapters.json'), JSON.stringify(chapters, null, 2) + '\n')
fs.writeFileSync(
  path.join(directory, 'combat.json'),
  JSON.stringify(
    {
      seconds: extended ? 30 : 10,
      level: game.player.level,
      playerHp: game.player.hp,
      playerMaxHp: game.player.maxHp,
      bossStartHp,
      bossEndHp: game.field.boss.hp
    },
    null,
    2
  ) + '\n'
)
const controls = `<script>
window.demo = { ready: false, done: false, playing: false };
fetch('frames.json').then(r => r.json()).then(frames => {
  const pre = document.querySelector('pre');
  const caption = document.querySelector('.caption');
  const draw = index => {
    pre.innerHTML = frames[index].html;
    pre.style.fontSize = frames[index].columns === 80 ? '22px' : '13px';
    caption.textContent = frames[index].caption;
  };
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
  page('RUNA - Demo Tripo', initialView).replace('</body>', controls + '</body>')
)
console.log(`${directory}: ${frames.length / 15}s, ${frames.length} real renderer frames`)
