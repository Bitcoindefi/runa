```
/\=======================================================/\
||                       BARE RPG                        ||
||     ____    _    ____  _____   ____  ____   ____      ||
||    | __ )  / \  |  _ \| ____| |  _ \|  _ \ / ___|     ||
||    |  _ \ / _ \ | |_) |  _|   | |_) | |_) | |  _      ||
||    | |_) / ___ \|  _ <| |___  |  _ <|  __/| |_| |     ||
||    |____/_/   \_\_| \_\_____| |_| \_\_|    \____|     ||
||          T E R M I N A L   A D V E N T U R E          ||
\/=======================================================\/
```

# runa

**A terminal RPG where you do not control your character. You write the rules it follows, and the world updates peer to peer while you play.**

Built for the [Aleph Hackathon 2026](https://hacki.crecimiento.build/h/aleph-hackathon-2026), Pears track.

## What it looks like

Every screen below is captured straight out of the game's own `view()`, not drawn by hand.

### The town

You walk this yourself. Capital letters are doors: `C` your house, `I` the church, `A` the smithy, `>` the gate out.

```
 runa
+- la ciudad -------------------------------------------------+ +- ficha ------------------+
|                                                             | |vos                   nv 1|
|                                                             | |hp [###############] 20/20|
|############################################################ | |xp [-----------------] 0/1|
|##. . . . . . . . . . . . . . . . . . . . . . . . . . . . .  | |oro 30          pociones 2|
|##. . ########################. . . . . #################### | |izq -                     |
|##. . ##::::::::::::::::::::##. . . . . ##:::::::::::::::::: | |der -                     |
|##. . ##::::::c a s a ::::::##. . . . . ##::::::i g l e s i  | +--------------------------+
|##. . ##########C ############. . . . . ##############I #### | +- log --------------------+
|##. . . . . . . @ . . . . . . . . . . . . . . . . . . . . .  | |                          |
|##. . . . . . . . . . . . . . . . . . . . . . . . . . . . .  | |                          |
|##. . . . . . . . . . . . . . . . . . . . . . . . . . . . .  | |                          |
|##. . . . . . . ############A ##############. . . . . . . .  | |                          |
|##. . . . . . . ##::::::::::::::::::::::::##. . . . . . . .  | |                          |
|##. . . . . . . ##::::::a r m a s ::::::::##. . . . . . . .  | |                          |
|##. . . . . . . ############################. . . . . . . .  | |                          |
|##. . . . . . . . . . . . . . . . . . . . . . . . . . . . .  | |                          |
|##. . . ,,,,,,,,,,,,,,,,,,,,,,,,,,,,. . . . . . . . . . . .  | |                          |
|##. . . ,,,,,,,,,,o o o ,,,,,,,,,,,,. . . . . . . . . . . .  | |                          |
|##. . . ,,,,,,,,,,,,,,,,,,,,,,,,,,,,. . . . . . . . . . . .  | |                          |
|############################################################ | |                          |
|                                                             | |                          |
|                                                             | |                          |
+-------------------------------------------------------------+ +--------------------------+
 wasd o flechas | e entrar | ? script | q salir
```

### The smithy

The two weapons are deliberately far apart. A sword that was twenty percent better than a crossbow would make a wrong rule cost you a slightly longer fight, and you would never notice your script was wrong.

```
 runa
+- herreria --------------------------------------------------+ +- ficha ------------------+
|herreria                                              oro 120| |vos                   nv 1|
|-------------------------------------------------------------| |hp [###############] 20/20|
|> / espada                                      25 o  comprar| |xp [-----------------] 0/1|
|  } ballesta                                    60 o  comprar| |oro 120         pociones 2|
|-------------------------------------------------------------| |izq -                     |
|pega fuerte, pero tenes que estar encima                     | |der -                     |
|                                                             | +--------------------------+
|                                                             | +- log --------------------+
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |entras a herreria         |
+-------------------------------------------------------------+ +--------------------------+
 arriba/abajo elegir | enter comprar | esc salir
```

### The field

Monsters wander on their own clock. Walking is free, in the Pokemon sense: a step is not a turn.

```
 runa
+- combate ---------------------------------------------------+ +- ficha ------------------+
|                                                             | |vos                   nv 1|
|                                                             | |hp [###############] 20/20|
|                                                             | |xp [-----------------] 0/1|
|                                                             | |oro 120         pociones 2|
|                                                             | |izq -                     |
|~ mosquito                                              13/13| |der -                     |
|[###########################################################]| +--------------------------+
|                                                             | +- log --------------------+
|@                                                          ~ | |                          |
|+-----------------------------------------------------------+| |                          |
| ..                                                     lejos| |                          |
|                                                             | |                          |
|@ vos                                                   20/20| |                          |
|[###########################################################]| |                          |
|                                                             | |                          |
|golpe [############] listo                            dist 39| |                          |
|alcance 1                                                    | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |entras a herreria         |
|                                                             | |salis de la ciudad        |
|                                                             | |un mosquito te vio        |
+-------------------------------------------------------------+ +--------------------------+
 pelea tu script | r recargar script | q salir
```

### A fight

Here the keyboard stops mattering. Distance, reach and the swing cooldown are all on screen, because those are exactly the numbers your rules read.

```
 runa
+- combate ---------------------------------------------------+ +- ficha ------------------+
|                                                             | |vos                   nv 1|
|                                                             | |hp [###############] 20/20|
|                                                             | |xp [-----------------] 0/1|
|                                                             | |oro 120         pociones 2|
|                                                             | |izq -                     |
|~ mosquito                                              13/13| |der -                     |
|[###########################################################]| +--------------------------+
|                                                             | +- log --------------------+
|         @                                   ~               | |                          |
|+-----------------------------------------------------------+| |                          |
|          .....................                         lejos| |                          |
|                                                             | |                          |
|@ vos                                                   20/20| |                          |
|[###########################################################]| |                          |
|                                                             | |                          |
|golpe [############] listo                            dist 24| |                          |
|alcance 14                                                   | |                          |
|                                                             | |                          |
|                                                             | |                          |
|                                                             | |entras a herreria         |
|                                                             | |salis de la ciudad        |
|                                                             | |un mosquito te vio        |
+-------------------------------------------------------------+ +--------------------------+
 pelea tu script | r recargar script | q salir
```

## Install

```bash
pear install pear://hg11t8ipq5kkc7d4prdmu4mapi18yqm7p43ee5dzmnf7y1yjyo9o
runa
```

That is the whole install. No Node, no Bare, no package manager, no app store. The binary arrives from peers and keeps itself current: when a new release is staged, an installed copy picks it up on its own.

**Binaries built for:** `linux-x64`, `darwin-arm64`, `darwin-x64`, `win32-x64`.

## The idea

Every terminal RPG lets you press a key to swing a sword. This one does not.

You walk the town yourself, with the arrows or WASD. You go into the weapon shop, the armoury, the apothecary, the church. But the moment a fight starts, the keyboard stops mattering. What fights is a **rule sheet you wrote**, in a file, in your own editor, next to the game.

```
?hp < 8
 use potion
:?foe.dist >= 5
 equip crossbow
:
 equip sword
```

Equip the sword against something fast and you die in three and a half seconds. Add the two lines that reach for the crossbow at range and you win with fifteen health left. **The difficulty of this game is the quality of your reasoning**, and you can watch a bad rule lose in real time.

The file is re-read while the fight is running. Fix a rule mid-combat, save, and the character changes its mind on the next tick without anything restarting.

## The language

Borrowed in spirit from StoneScript in Stone Story RPG, which got the central idea right: **the whole script is re-evaluated every tick**, top to bottom. It is not a program that runs once, it is a rule sheet that gets consulted continuously.

That single decision removes the hard parts. There is no program counter to advance, no coroutines, no scheduler, no event queue. It also buys a safety property worth stating plainly: the language has **no loops and no recursion**, so a script cannot hang the game. That is what makes it safe to run a stranger's script every frame, which is what will let strategies travel between players.

| Symbol       | Meaning                                 |
| ------------ | --------------------------------------- |
| `?`          | if                                      |
| `:?`         | else if                                 |
| `:`          | else                                    |
| `!` `&` `\|` | not, and, or                            |
| `>`          | print, with `@hp@` interpolation        |
| indentation  | dependency. No braces, nothing to close |

Readable state: `hp`, `maxhp`, `potions`, `ready`, `left`, `right`, `foe.kind`, `foe.hp`, `foe.dist`, `foe.flying`.
Commands: `equip`, `equipL`, `equipR`, `use`, `wait`.

Three deliberate choices in the implementation:

- **Commands are collected, then applied.** The last rule that matched wins, which is how a person reads a sheet from top to bottom. Applying them as they are found would let an early rule spend the turn before a later, more specific one got to speak.
- **An unknown name fails the condition instead of throwing.** One typo does not take the script down mid-fight.
- **Tabs are rejected rather than guessed at.** A tab that renders as four in your editor and eight in mine silently changes which branch a line belongs to, and the player has no way to see it.

## Why Pear is the mechanic, not the delivery

Content is data, not code. Enemies, items, shops, prices and the town map itself are plain objects. So a new monster is not a new build, it is an over-the-air data update that a running copy picks up from peers.

That turns the track's hardest requirement into the most interesting thing in the game: **the world can change under a script that is already running**. You solved the mosquito with one rule; a patch lands, a golem walks in with a longer reach, and the rule that used to win now loses. You have to write another one.

## Playing

| Key              | Does                               |
| ---------------- | ---------------------------------- |
| `wasd` or arrows | walk                               |
| `e`              | enter the door you are standing on |
| `r`              | reload the script by hand          |
| `?`              | remind you where the script lives  |
| `q`              | quit                               |

Doors are the capital letters: `C` your house, `I` the church (free healing), `P` apothecary, `A` weapons, `D` armour, `>` the gate out to the field. Lowercase letters are the painted shop signs and are solid, so you cannot walk through a wall just because someone wrote a name on it.

Your script lives in `script.txt` next to the binary. It is created on first run.

## Built from

Started from [`holepunchto/hello-pear-bare`](https://github.com/holepunchto/hello-pear-bare), branch **`main`** (the updater in a Bare worker thread, which is the shape their docs recommend for long-lived TUIs).

- [`bare-tui`](https://github.com/holepunchto/bare-tui) for the interface, Elm architecture, zero dependencies. The Pear CLI itself runs on it.
- `pear-runtime` for the peer-to-peer OTA updater.
- `hyperswarm` for connectivity.
- Everything else is in this repo.

## Notes from building it

Pear and Bare are not Node, and the gap is not cosmetic. Things that cost real time and are written down here so they cost you less:

- **`pear run` no longer exists** in Pear 3.2.0. Some templates still reference it.
- **`pear install` serves binaries, not source.** Without `pear build` first it answers `Not found` for `by-arch/<platform>/app/<name>`.
- **`bare-build` cross-compiles.** All four platforms above were produced from one Linux machine, verified with `file`: Mach-O for the two Macs, PE32+ for Windows.
- **Bare has no built-in modules and no `process` global.** `require('fs')` fails; it is `bare-fs`. Same for `tty`, `path`, `process`.
- **`TextEncoder`, `TextDecoder`, `crypto` and `fetch` are not globals either.**
- **The `upgrade` field in `package.json` is mandatory.** The app will not start without a real link from `pear touch`.

## License

Apache-2.0.
