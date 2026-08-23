# BARE RPG

**A terminal RPG where you do not control your character. You write the rules it follows.**

Built for the [Aleph Hackathon 2026](https://hacki.crecimiento.build/h/aleph-hackathon-2026), Pears track.

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

              no controlas a tu personaje. escribis las reglas que sigue.

                            [ cualquier tecla para empezar ]
```

## What this does with Pear and Bare

This is not a game that happens to be distributed with Pear. The platform is doing four specific jobs, and the game is shaped around them.

| | |
|---|---|
| **Bare is the runtime** | The whole game runs on Bare, not Node. No built-in modules, no `process` global, no `fs`. Everything goes through the `bare-*` packages, and the UI is `bare-tui`, the same Elm-architecture framework the Pear CLI itself runs on. |
| **One binary, four platforms** | `bare-build --standalone` compiles the game and the runtime into a single executable. All four were cross-compiled from one Linux machine and checked with `file`: Mach-O for both Macs, PE32+ for Windows, ELF for Linux. Your users need no Node, no Bare, not even the Pear CLI. |
| **Pear is the distribution** | `pear install pear://<key>` and you are playing. No package manager, no app store, no download page, no server paying for bandwidth. The binary arrives from whoever already has it. |
| **Content is data, so the world can grow** | Enemies, items, prices and the town map are plain objects, not code. A new monster is a few lines of data rather than a new build, which is what makes shipping one over the air possible at all. |

## Install

```bash
pear install pear://hg11t8ipq5kkc7d4prdmu4mapi18yqm7p43ee5dzmnf7y1yjyo9o
runa
```

**Binaries built for:** `linux-x64`, `darwin-arm64`, `darwin-x64`, `win32-x64`.

## What it looks like

Every screen below is captured straight out of the game's own `view()`, not drawn by hand.

### The town

You walk this yourself, with WASD or the arrows. Capital letters are doors: `C` your house, `I` the church, `A` the smithy, `T` the tavern, `>` the gate out to the field.

```
 runa
+- la ciudad ---------------------------------------------+ +- ficha ------------------+
|                                                         | |vos                   nv 1|
|                                                         | |hp [###############] 20/20|
|#########################################################| |xp [-----------------] 0/1|
|#........................................................| |oro 30          pociones 2|
|#..############.....################.....##############..| |izq -                     |
|#..#::::::::::#.....#::::::::::::::#.....#::::::::::::#..| |der -                     |
|#..#:::casa:::#.....#:::iglesia::::#.....#::pociones::#..| +--------------------------+
|#..#####C######.....#######I########.....######P#######..| +- log --------------------+
|#.......@................................................| |                          |
|#........................................................| |                          |
|#........................................................| |                          |
|#.......######A#######........########D#######...........| |                          |
|#.......#::::::::::::#........#::::::::::::::#...........| |                          |
|#.......#:::armas::::#........#::armaduras:::#...........| |                          |
|#.......##############........################...........| |                          |
|#........................................................| |                          |
|#...,,,,,,,,,,,,,,.......................................| |                          |
|#...,,,,,ooo,,,,,,.......................................| |                          |
|#...,,,,,,,,,,,,,,.......................................| |                          |
|##############################>##########################| |                          |
|                                                         | |                          |
|                                                         | |                          |
+---------------------------------------------------------+ +--------------------------+
 wasd o flechas | e entrar | ? script | q salir
```

### The smithy

The two weapons are deliberately far apart. A sword twenty percent better than a crossbow would make a wrong rule cost you a slightly longer fight, and you would never notice your script was wrong.

```
 runa
+- herreria ----------------------------------------------+ +- ficha ------------------+
|herreria                                          oro 140| |vos                   nv 1|
|---------------------------------------------------------| |hp [###############] 20/20|
|> / espada                                  25 o  comprar| |xp [-----------------] 0/1|
|  } ballesta                                60 o  comprar| |oro 140         pociones 2|
|---------------------------------------------------------| |izq -                     |
|pega fuerte, pero tenes que estar encima                 | |der -                     |
|                                                         | +--------------------------+
|                                                         | +- log --------------------+
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |entras a herreria         |
+---------------------------------------------------------+ +--------------------------+
 arriba/abajo elegir | enter comprar | esc salir
```

### The field

Monsters wander on their own clock. Walking is free, in the Pokemon sense: a step is not a turn.

```
 runa
+- combate -----------------------------------------------+ +- ficha ------------------+
|                                                         | |vos                   nv 1|
|                                                         | |hp [###############] 20/20|
|                                                         | |xp [-----------------] 0/1|
|                                                         | |oro 140         pociones 2|
|                                                         | |izq -                     |
|~ mosquito                                          13/13| |der -                     |
|[#######################################################]| +--------------------------+
|                                                         | +- log --------------------+
|@                                                      ~ | |                          |
|+-------------------------------------------------------+| |                          |
| .                                                  lejos| |                          |
|                                                         | |                          |
|@ vos                                               20/20| |                          |
|[#######################################################]| |                          |
|                                                         | |                          |
|golpe [############] listo                        dist 39| |                          |
|alcance 1                                                | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |entras a herreria         |
|                                                         | |salis de la ciudad        |
|                                                         | |un mosquito te vio        |
+---------------------------------------------------------+ +--------------------------+
 pelea tu script | r recargar script | q salir
```

### A fight

Here the keyboard stops mattering. Distance, reach and the swing cooldown are all on screen, because those are exactly the numbers your rules read.

```
 runa
+- combate -----------------------------------------------+ +- ficha ------------------+
|                                                         | |vos                   nv 1|
|                                                         | |hp [###############] 20/20|
|                                                         | |xp [-----------------] 0/1|
|                                                         | |oro 140         pociones 2|
|                                                         | |izq -                     |
|~ mosquito                                          13/13| |der -                     |
|[#######################################################]| +--------------------------+
|                                                         | +- log --------------------+
|           @                             ~               | |                          |
|+-------------------------------------------------------+| |                          |
|            ....................                    lejos| |                          |
|                                                         | |                          |
|@ vos                                               20/20| |                          |
|[#######################################################]| |                          |
|                                                         | |                          |
|golpe [############] listo                        dist 21| |                          |
|alcance 14                                               | |                          |
|                                                         | |                          |
|                                                         | |                          |
|                                                         | |entras a herreria         |
|                                                         | |salis de la ciudad        |
|                                                         | |un mosquito te vio        |
+---------------------------------------------------------+ +--------------------------+
 pelea tu script | r recargar script | q salir
```

## Roadmap: an RPG on its way to an MMORPG

The single-player game is what runs today. The direction it is built for is many players in one world, and the architecture already leans that way.

- **Now.** One town, one field, a shop economy, levels, and a scripting language for combat. Content is data.
- **Next: strategies travel.** The language has no loops and no recursion, so a script cannot hang the game. That is not a footnote, it is the property that makes it safe to run a stranger's rules every frame. Sharing a strategy over Hyperswarm is the natural next step.
- **Next: the world updates while you play.** Content is already data, so a new monster is a release rather than a rebuild. The updater is wired to report into the game log as "el mundo cambio". **Not yet demonstrated end to end, see Honest status.**
- **Then: shared world.** Hyperswarm gives peer discovery without a server. A town where other players are visible, then trade, then fights that two people watch at once. No server means no hosting bill, which is the only reason a hackathon project could keep running.
- **The far end.** An MMORPG where the world's content and the players' strategies both travel peer to peer, and nobody pays for a server.

## Honest status

What is verified, and what is not, because a README that overstates is worse than one that admits a gap.

**Verified by hand:**

- `pear install` from a clean machine, then the game boots. Checked repeatedly against a real PTY, not just CI.
- Walking, collision, entering all six doors, buying, the church healing, walking out to the field, a fight resolving, gold and experience landing, levelling up.
- The measured balance: the naive script dies in 3.5 seconds, the fixed one wins with 15 health left.
- Cross-compilation to four platforms, checked with `file`.

**Not verified:**

- **The OTA update landing.** The updater starts and reports `Updates: enabled`, and a newer version is staged, but a running installed copy did not pick it up within 70 seconds and its storage never grew. It is wired, it is not proven. Anything you read elsewhere claiming this works is ahead of the evidence.

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
