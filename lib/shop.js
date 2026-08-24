'use strict'

/**
 * Shops, money, levels, and the save file.
 *
 * This is the layer that survives a fight. `world.js` owns one battle and
 * forgets it; everything a player keeps between battles lives here.
 *
 * Three rules hold it together, and they are the same three the rest of the
 * engine already follows:
 *
 *  1. Derived numbers are never stored as truth. Level is a function of
 *     lifetime xp, max hp is a function of level. A save that recorded both
 *     `level` and `xp` would let them disagree, and the disagreement would only
 *     surface days later inside someone else's save file. Store the one number
 *     that cannot be recomputed, recompute the rest on every read.
 *
 *  2. Prices, curves, and the death penalty are data, not literals buried in
 *     code. `ECONOMY` and `shops` are plain objects, so rebalancing the game is
 *     an over-the-air data update rather than a new build, exactly like adding
 *     a foe to `content.js`.
 *
 *  3. Nothing throws at the player. `buy` and `sell` return a result with a
 *     reason in it, the way `readIntent` returns problems instead of blowing up
 *     mid-tick. The only thing that throws is loading a save this build cannot
 *     understand, because there, silently continuing would destroy progress.
 */

const CONTENT = require('./content.js')

/** Bumped whenever the save shape changes. See MIGRATIONS. */
const SAVE_VERSION = 1

/**
 * Every tunable number in the economy, in one place.
 *
 * A `Player` takes a copy of this at construction and can be handed an
 * override, so a test, a hard mode, or an OTA rebalance changes behaviour
 * without touching a line of code below.
 */
const ECONOMY = {
  // xp needed to leave level n is xpBase * n * n. Quadratic on purpose: the
  // early levels arrive fast enough to teach, the late ones slow enough to earn.
  xpBase: 12,
  // Past this the curve stops, though xp keeps accumulating. It also bounds the
  // loop in levelFor(), so no save, however corrupt, can make it spin.
  levelCap: 30,

  // Max hp is hpBase + hpPerLevel * (level - 1). Never stored, always this.
  hpBase: 20,
  hpPerLevel: 6,
  // Levelling up heals. It is the reward that is legible without opening a menu.
  healOnLevel: true,

  // Selling returns this share of the shop price, rounded down.
  sellRate: 0.5,
  // Potions are one digit on the status bar, so cap them at one digit.
  potionCap: 9,

  startGold: 30,
  startPotions: 2,
  // You leave home with a sword already in hand.
  //
  // Not generosity: the alternative is unplayable. The rule sheet a new player
  // is handed says `equip crossbow` and falls back to `equip sword`, and once
  // ownership is actually enforced a player who owns neither walks into the
  // field bare handed, with reach 1 against a mosquito that reaches 2, and
  // dies without ever understanding why. Starting gold is 30 and a sword costs
  // 25, so this hands over something the player could have bought on the first
  // screen anyway. The crossbow is still 60 and still has to be earned, which
  // is where the shop actually starts mattering.
  startItems: ['sword'],

  death: {
    // Share of gold lost on death.
    goldLoss: 0.25,
    // The penalty never takes you below this. A player who cannot afford a
    // single potion is stuck, and stuck is worse than punished.
    goldFloor: 10,
    // Share of the current level's xp progress lost. Zero by default: losing a
    // level reads as the game taking something back, and this game wants you to
    // redo the fight, not resent it. It lives here so it can be tuned, not
    // rediscovered in a diff.
    xpLoss: 0,
    // Where you wake up.
    at: 'church'
  }
}

/**
 * Goods that are not equipment.
 *
 * Potions live here rather than in `content.js` because they are a counter on
 * `World`, not an item with a hand and a reach. Same shape as an item where it
 * matters, so a shop never has to care which table a good came from.
 */
const consumables = {
  potion: {
    id: 'potion',
    name: 'pocion',
    glyph: '!',
    stack: true,
    about: 'te cura 8 en el acto'
  }
}

/**
 * The shops, as data.
 *
 * A shop is an id, a name, and a list of things it sells with a price. That is
 * the whole schema. `minLevel` is optional and gates the two goods that change
 * how a fight is fought, so a new player is not handed the answer before they
 * have met the question.
 */
const shops = {
  potions: {
    id: 'potions',
    name: 'botica',
    keeper: 'la boticaria',
    glyph: '&',
    about: 'pociones, y consejos que no pediste',
    sells: [{ id: 'potion', price: 10 }]
  },

  weapons: {
    id: 'weapons',
    name: 'herreria',
    keeper: 'el herrero',
    glyph: '/',
    about: 'con que pegar',
    sells: [
      { id: 'sword', price: 25 },
      { id: 'crossbow', price: 60, minLevel: 2 }
    ]
  },

  armor: {
    id: 'armor',
    name: 'talabarteria',
    keeper: 'la talabartera',
    glyph: '0',
    about: 'con que aguantar, y con que llegar',
    sells: [
      { id: 'shield', price: 30 },
      { id: 'boots', price: 45, minLevel: 2 }
    ]
  }
}

/**
 * Resolve a good by id: equipment first, consumables second.
 * @param {string} id
 * @returns {object|null}
 */
function good(id) {
  return CONTENT.items[id] || consumables[id] || null
}

/**
 * Find the entry that prices a good, and the shop it belongs to.
 *
 * A price is written down exactly once, in the shop that sells the thing.
 * Selling reads the same number buying does, so a discount can never
 * desynchronise from the buyback value.
 *
 * @param {string} goodId
 * @param {string} [shopId] - restrict the search to one shop
 * @returns {{ shop: object, entry: object }|null}
 */
function offerOf(goodId, shopId) {
  const list = shopId ? [shops[shopId]] : Object.values(shops)
  for (const shop of list) {
    if (!shop) continue
    for (const entry of shop.sells) {
      if (entry.id === goodId) return { shop, entry }
    }
  }
  return null
}

/**
 * What a foe is worth.
 *
 * Derived from the foe's own stats, so a foe shipped over the air pays out the
 * moment it lands with no second table to keep in sync.
 *
 * There is a `drop` table in content.js and this deliberately does not read it,
 * which is worth writing down because it looks like a bug and was "fixed" once.
 *
 * The story: this used to test `def.drops` while content.js has always written
 * `drop`, so the table never applied and every foe in the game was paid by the
 * formula below. Renaming it to match looked obviously right and made the game
 * worse immediately. The table pays a mosquito 3 xp where the formula pays 18,
 * so levelling went from one kill to four, and the crossbow from five kills to
 * fifteen. Nothing about the table was wrong; it had simply never been played,
 * and every price, every xp curve and every fight length in this game was tuned
 * against these numbers without anybody noticing which of the two was live.
 *
 * So the formula is the balance, and the table is dead weight kept only because
 * field.js still rolls it for flavour. Retuning the economy is a real thing
 * somebody might want to do one day. It is not a rename.
 *
 * @param {string} foeId
 * @returns {{ xp: number, gold: number }}
 */
function reward(foeId) {
  const def = CONTENT.foes[foeId]
  if (!def) return { xp: 0, gold: 0 }

  const s = def.stats
  return {
    xp: Math.round(s.hp * 0.6 + s.atk * 2),
    gold: Math.round(s.hp * 0.5 + s.atk)
  }
}

/**
 * xp needed to leave `level`.
 * @param {number} level
 * @param {object} [econ]
 * @returns {number} Infinity at the level cap
 */
function xpToLeave(level, econ = ECONOMY) {
  if (level >= econ.levelCap) return Infinity
  return econ.xpBase * level * level
}

/**
 * Level for a lifetime xp total.
 *
 * Walked rather than solved in closed form because the curve is data: replace
 * `xpToLeave` with anything monotonic and this keeps working. The walk is
 * bounded by `levelCap`, so no input can make it run long.
 *
 * @param {number} xp
 * @param {object} [econ]
 * @returns {{ level: number, into: number, need: number }}
 */
function levelFor(xp, econ = ECONOMY) {
  let level = 1
  let left = Math.max(0, Number(xp) || 0)

  while (level < econ.levelCap) {
    const need = xpToLeave(level, econ)
    if (left < need) break
    left -= need
    level++
  }

  return { level, into: left, need: xpToLeave(level, econ) }
}

/**
 * Everything that survives a fight.
 *
 * Truth is: gold, lifetime xp, current hp, potions, and which equipment is
 * owned. Level and max hp are getters over that truth, recomputed on every
 * read, which is the only reason they cannot drift apart from it.
 */
class Player {
  /**
   * @param {object} [opts]
   * @param {object} [opts.econ] - overrides merged over ECONOMY
   * @param {number} [opts.gold]
   * @param {number} [opts.xp] - lifetime xp
   * @param {number} [opts.potions]
   * @param {string[]} [opts.items] - owned equipment ids
   * @param {number} [opts.hp] - defaults to full
   */
  constructor(opts = {}) {
    const over = opts.econ || {}
    /** Tuning ships with the build, never with the save. */
    this.econ = { ...ECONOMY, ...over, death: { ...ECONOMY.death, ...(over.death || {}) } }

    this.gold = opts.gold ?? this.econ.startGold
    this.xp = opts.xp ?? 0
    this.potions = opts.potions ?? this.econ.startPotions
    // `opts.items` wins even when it is empty: an empty inventory is a real
    // state a save can be in, and a player who sold their last sword should not
    // find a new one waiting after a restart.
    this.items = new Set(opts.items === undefined ? this.econ.startItems || [] : opts.items)

    // Seeded through the accessor so it is clamped to this level's max from the
    // very first assignment.
    this._hp = this.maxHp
    if (opts.hp !== undefined) this.hp = opts.hp
  }

  /** @returns {number} derived from lifetime xp, never stored */
  get level() {
    return levelFor(this.xp, this.econ).level
  }

  /** @returns {number} xp earned inside the current level */
  get xpInto() {
    return levelFor(this.xp, this.econ).into
  }

  /** @returns {number} what the current level costs to leave, Infinity at cap */
  get xpNeed() {
    return levelFor(this.xp, this.econ).need
  }

  /** @returns {number} derived from level, never stored */
  get maxHp() {
    return this.econ.hpBase + this.econ.hpPerLevel * (this.level - 1)
  }

  /**
   * Current hp, clamped to the derived max on the way in and on the way out.
   *
   * The clamp on read matters as much as the one on write: a save written by a
   * build with a fatter hp curve would otherwise load a hero standing above
   * their own maximum.
   * @returns {number}
   */
  get hp() {
    return Math.min(this._hp, this.maxHp)
  }

  set hp(v) {
    const n = Number(v)
    this._hp = Math.max(0, Math.min(Number.isFinite(n) ? n : 0, this.maxHp))
  }

  /** @returns {boolean} */
  get alive() {
    return this.hp > 0
  }

  /**
   * The flat read-only view, same idea as `World.snapshot`: named after things
   * in the game rather than after the code, so it can go straight to the TUI.
   * @returns {object}
   */
  snapshot() {
    const lv = levelFor(this.xp, this.econ)
    return {
      gold: this.gold,
      level: lv.level,
      xp: this.xp,
      xpinto: lv.into,
      xpneed: lv.need === Infinity ? 0 : lv.need,
      hp: Math.ceil(this.hp),
      maxhp: this.maxHp,
      potions: this.potions,
      items: [...this.items]
    }
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  owns(id) {
    return this.items.has(id)
  }

  /**
   * @param {number} n
   * @returns {number} gold after the gain
   */
  gainGold(n) {
    this.gold += Math.max(0, Math.floor(Number(n) || 0))
    return this.gold
  }

  /**
   * Award xp and report what it did.
   *
   * Levels are counted by comparing the derived level before and after, not by
   * a loop that subtracts and increments a stored one. One definition of what a
   * level is, and it stays right when a single kill crosses two of them.
   *
   * @param {number} n
   * @returns {{ gained: number, level: number, levels: number, maxHp: number }}
   */
  gainXp(n) {
    const add = Math.max(0, Math.floor(Number(n) || 0))
    const before = this.level
    this.xp += add
    const after = this.level

    if (after > before && this.econ.healOnLevel) this._hp = this.maxHp

    return { gained: add, level: after, levels: after - before, maxHp: this.maxHp }
  }

  /**
   * Can this be bought, and if not, why not.
   *
   * Every refusal carries a sentence the player can read. A "no" with no reason
   * is the single most common way a shop screen wastes someone's afternoon.
   *
   * @param {string} goodId
   * @param {string} [shopId] - restrict to one shop
   * @returns {{ ok: boolean, reason: string, price: number, shop: string, good: object|null }}
   */
  canBuy(goodId, shopId) {
    const found = offerOf(goodId, shopId)
    const no = (reason, price = 0, shop = shopId || '') => {
      return { ok: false, reason, price, shop, good: good(goodId) }
    }

    if (!found) {
      if (!good(goodId)) return no(`no existe "${goodId}"`)
      return no(shopId ? 'aca no venden eso' : 'eso no se vende en ninguna tienda')
    }

    const { shop, entry } = found
    const def = good(goodId)
    if (!def) return no('eso no existe', entry.price, shop.id)

    if (entry.minLevel && this.level < entry.minLevel) {
      return no(`necesitas nivel ${entry.minLevel}`, entry.price, shop.id)
    }
    if (!def.stack && this.owns(goodId)) {
      return no(`ya tenes ${def.name}`, entry.price, shop.id)
    }
    if (def.stack && this.potions >= this.econ.potionCap) {
      return no(`no te entran mas de ${this.econ.potionCap} pociones`, entry.price, shop.id)
    }
    if (this.gold < entry.price) {
      return no(`te faltan ${entry.price - this.gold} de oro`, entry.price, shop.id)
    }

    return { ok: true, reason: '', price: entry.price, shop: shop.id, good: def }
  }

  /**
   * Buy one. Never throws: read `.ok`, and show `.reason` when it is false.
   * @param {string} goodId
   * @param {string} [shopId]
   * @returns {{ ok: boolean, reason: string, price: number, shop: string, good: object|null }}
   */
  buy(goodId, shopId) {
    const deal = this.canBuy(goodId, shopId)
    if (!deal.ok) return deal

    this.gold -= deal.price
    if (deal.good.stack) this.potions++
    else this.items.add(goodId)

    return deal
  }

  /**
   * Sell one back, at `sellRate` of the price the shop asks for it.
   * @param {string} goodId
   * @param {string} [shopId]
   * @returns {{ ok: boolean, reason: string, price: number, paid: number, shop: string }}
   */
  sell(goodId, shopId) {
    const found = offerOf(goodId, shopId)
    if (!found) {
      return { ok: false, reason: 'nadie te compra eso', price: 0, paid: 0, shop: shopId || '' }
    }

    const { shop, entry } = found
    const def = good(goodId)
    const stack = !!(def && def.stack)

    if (stack && this.potions <= 0) {
      return { ok: false, reason: 'no tenes pociones', price: entry.price, paid: 0, shop: shop.id }
    }
    if (!stack && !this.owns(goodId)) {
      const name = def ? def.name : goodId
      return { ok: false, reason: `no tenes ${name}`, price: entry.price, paid: 0, shop: shop.id }
    }

    const paid = Math.floor(entry.price * this.econ.sellRate)
    if (stack) this.potions--
    else this.items.delete(goodId)
    this.gold += paid

    return { ok: true, reason: '', price: entry.price, paid, shop: shop.id }
  }

  /**
   * Die, pay for it, and wake up at the church with full hp.
   *
   * The penalty is read out of `econ.death` every time rather than baked in,
   * and it refuses to leave the player under `goldFloor`: dying should be a
   * setback, never a hole whose only exit is dying again.
   *
   * @returns {{ at: string, goldLost: number, xpLost: number, gold: number, hp: number }}
   */
  die() {
    const rule = this.econ.death

    let goldLost = Math.floor(this.gold * rule.goldLoss)
    if (this.gold - goldLost < rule.goldFloor) {
      goldLost = Math.max(0, this.gold - rule.goldFloor)
    }
    this.gold -= goldLost

    let xpLost = 0
    if (rule.xpLoss > 0) {
      xpLost = Math.floor(this.xpInto * rule.xpLoss)
      this.xp = Math.max(0, this.xp - xpLost)
    }

    this._hp = this.maxHp

    return { at: rule.at, goldLost, xpLost, gold: this.gold, hp: this.hp }
  }

  /**
   * Push persistent state into a fresh `World` before the fight starts.
   *
   * Writes base hp, never a derived stat: `World` recomputes reach, speed and
   * the rest from base plus loadout on every tick, and handing it a
   * precomputed number would be the exact drift both files exist to avoid.
   *
   * @param {object} world - a World from world.js
   * @returns {object} the same world, for chaining
   */
  outfit(world) {
    world.hero.base.hp = this.maxHp
    world.hero.hp = this.hp
    world.potions = this.potions
    return world
  }

  /**
   * Pull a finished fight back into persistent state.
   *
   * Safe to call on a fight still in progress: it reports `settled: false` and
   * touches nothing, so callers do not have to guard it.
   *
   * @param {object} world - a World from world.js, once `world.over` is set
   * @returns {{ settled: boolean, won: boolean, xp: number, gold: number, levels: number, death: object|null }}
   */
  settle(world) {
    if (!world || !world.over) {
      return { settled: false, won: false, xp: 0, gold: 0, levels: 0, death: null }
    }

    this.potions = Math.min(world.potions, this.econ.potionCap)
    this.hp = Math.max(0, world.hero.hp)

    if (world.over !== 'ganaste') {
      return { settled: true, won: false, xp: 0, gold: 0, levels: 0, death: this.die() }
    }

    // What the fight is worth is decided here and nowhere else, and whoever
    // announces it reads it back off the return value. That is what stopped the
    // log saying `+5 oro` while the purse went up by 12: there is one number.
    const drop = reward(world.foeDef.id)
    this.gainGold(drop.gold)
    const up = this.gainXp(drop.xp)

    return {
      settled: true,
      won: true,
      xp: drop.xp,
      gold: drop.gold,
      levels: up.levels,
      death: null
    }
  }

  /**
   * The save.
   *
   * Only what cannot be recomputed. No level, no max hp: writing those would be
   * writing a second copy of the truth into a file that outlives the build that
   * wrote it, which is how a rebalance quietly breaks everybody's save.
   *
   * @returns {object}
   */
  toJSON() {
    return {
      version: SAVE_VERSION,
      gold: this.gold,
      xp: this.xp,
      hp: this.hp,
      potions: this.potions,
      items: [...this.items]
    }
  }

  /**
   * Load a save, migrating it forward if it is old.
   *
   * @param {object|string} raw - the parsed save, or its JSON text
   * @param {object} [opts] - passed on to the constructor, e.g. `{ econ }`
   * @returns {Player}
   * @throws {SaveError} if the save is unreadable or comes from a newer build
   */
  static fromJSON(raw, opts = {}) {
    const data = migrate(typeof raw === 'string' ? JSON.parse(raw) : raw)
    return new Player({
      ...opts,
      gold: data.gold,
      xp: data.xp,
      hp: data.hp,
      potions: data.potions,
      items: data.items
    })
  }
}

// The names the design doc uses, pointed at the same functions. One
// implementation, two ways to spell it.
Player.prototype.comprar = Player.prototype.buy
Player.prototype.vender = Player.prototype.sell
Player.prototype.ganarXp = Player.prototype.gainXp
Player.prototype.ganarOro = Player.prototype.gainGold
Player.prototype.morir = Player.prototype.die

class SaveError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SaveError'
  }
}

/**
 * The migration chain, one step per version bump.
 *
 * It exists on day one with a step already in it, and that is the point. A save
 * format without a version is a save format that can only be changed once, and
 * the first change always arrives sooner than anyone plans for. The step is
 * real work rather than a placeholder: pre-version saves stored `level` next to
 * a per-level `xp`, this build stores lifetime xp only, so the two have to be
 * folded back into one number.
 *
 * To add a version: bump SAVE_VERSION, push `{ from, to, up }` here, and never
 * edit a step that has already shipped. Someone out there has a file that only
 * the old step understands.
 */
const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    /**
     * v0 to v1: fold `level` plus per-level `xp` into lifetime xp.
     * @param {object} d
     * @returns {object}
     */
    up(d) {
      const level = Math.max(1, Math.min(Number(d.level) || 1, ECONOMY.levelCap))
      let xp = Math.max(0, Number(d.xp) || 0)
      for (let n = 1; n < level; n++) xp += xpToLeave(n, ECONOMY)

      return {
        version: 1,
        gold: Math.max(0, Number(d.gold) || 0),
        xp,
        hp: d.hp,
        potions: Math.max(0, Number(d.potions) || 0),
        items: Array.isArray(d.items) ? d.items : []
      }
    }
  }
]

/**
 * Walk a save forward to SAVE_VERSION.
 *
 * A save with no `version` is version 0, which is what lets the chain reach
 * back past the day versioning was added. A save from the future throws instead
 * of being guessed at: refusing to open it leaves the file intact for the build
 * that can read it, while opening it half-understood would overwrite it with
 * less than it held.
 *
 * @param {object} raw
 * @returns {object} a save at SAVE_VERSION
 * @throws {SaveError}
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') throw new SaveError('el guardado no se entiende')

  let data = { ...raw }
  let v = Number(data.version) || 0

  if (v > SAVE_VERSION) {
    throw new SaveError(`el guardado es version ${v} y este build llega hasta ${SAVE_VERSION}`)
  }

  while (v < SAVE_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === v)
    if (!step) throw new SaveError(`no se como migrar un guardado version ${v}`)
    data = step.up(data)
    v = step.to
  }

  data.version = SAVE_VERSION
  return data
}

/**
 * Drop the equip commands that ask for something the player does not own.
 *
 * `World.readIntent` resolves items straight out of `content.js` and knows
 * nothing about an inventory, which is the right call: the arena should not
 * depend on the economy to run a fight. So ownership is enforced one step
 * earlier, here, between `run()` and `readIntent()`:
 *
 *   const { actions } = run(nodes, world.snapshot())
 *   const gated = ownedOnly(player, actions)
 *   world.readIntent(gated.actions)
 *
 * Without this the inventory is decorative, because a script can name any item
 * in the game and the world will hand it over.
 *
 * The script is re-read every tick, so a rejected line reports the same problem
 * thirty times a second. Show the latest, never append to a list.
 *
 * @param {Player} player
 * @param {{cmd: string, args: string[]}[]} actions
 * @returns {{ actions: object[], problems: string[] }}
 */
function ownedOnly(player, actions) {
  const kept = []
  const problems = []

  for (const a of actions) {
    if (a.cmd === 'equip' || a.cmd === 'equipl' || a.cmd === 'equipr') {
      const id = a.args[0]
      if (!player.owns(id)) {
        const def = good(id)
        problems.push(`no tenes ${def ? def.name : id}`)
        continue
      }
    }
    kept.push(a)
  }

  return { actions: kept, problems }
}

/**
 * A shop's window, priced against a given player.
 *
 * Everything the TUI needs to draw a row and grey out what it must, computed
 * here so that the view stays pure: no shop screen should be working out what a
 * player can afford while it is in the middle of drawing.
 *
 * @param {string} shopId
 * @param {Player} [player]
 * @returns {{ id: string, name: string, about: string, lines: object[] }|null}
 */
function browse(shopId, player) {
  const shop = shops[shopId]
  if (!shop) return null

  const lines = shop.sells.map((entry) => {
    const def = good(entry.id)
    const deal = player ? player.canBuy(entry.id, shopId) : { ok: true, reason: '' }
    return {
      id: entry.id,
      name: def ? def.name : entry.id,
      glyph: def ? def.glyph : '?',
      about: def ? def.about : '',
      price: entry.price,
      minLevel: entry.minLevel || 0,
      ok: deal.ok,
      reason: deal.reason
    }
  })

  return { id: shop.id, name: shop.name, about: shop.about, lines }
}

module.exports = {
  Player,
  SaveError,
  shops,
  consumables,
  ECONOMY,
  SAVE_VERSION,
  MIGRATIONS,
  migrate,
  browse,
  ownedOnly,
  good,
  offerOf,
  reward,
  levelFor,
  xpToLeave
}
