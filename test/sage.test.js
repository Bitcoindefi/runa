const { test } = require('brittle')
const { Sage } = require('../lib/sage.js')
const { parse, run } = require('../lib/script.js')
const { World } = require('../lib/world.js')
const CONTENT = require('../lib/content.js')

/**
 * Frases que el sabio NO tiene que entender, con el motivo que corresponde.
 *
 * Esta tabla es la mitad importante del archivo. Que traduzca bien lo que sabe
 * es lo facil; lo que decide si esto sirve o es un juguete es que se plante
 * cuando no sabe, porque un script equivocado pierde la pelea en silencio y el
 * jugador no tiene forma de saber que la culpa era del sabio.
 */
const NO_ENTIENDE = [
  ['usa la ballesta si es un dragon', 'palabra-desconocida'],
  ['alejate cuando se acerque', 'no-existe'],
  ['repeti el ataque cada 3 segundos', 'no-existe'],
  ['invoca un hechizo si estas bajo de vida', 'no-existe'],
  ['usa', 'sin-objeto'],
  ['si esta lejos', 'sin-accion'],
  ['usa la ballesta y tomate una pocion', 'dos-acciones'],
  ['usa la ballesta si esta a mas de 6', 'numero-suelto'],
  ['toma la espada', 'verbo-equivocado'],
  ['equipa una pocion', 'mano-equivocada'],
  ['si esta lejos pelea', 'pelear-como'],
  ['usa la ballesta si esta lejos y no es un golem o vuela', 'y-u-o'],
  ['deci algo si estas bajo de vida', 'sin-texto'],
  ['', 'vacio'],
  ['   ', 'vacio']
]

/** Correr un script contra un mundo y devolver lo que quedo en la mano. */
function fold(script, world) {
  const { nodes, errors } = parse(script)
  const out = run(nodes, world.snapshot())
  const problems = world.readIntent(out.actions)
  world.applyIntent()
  return { errors, problems, left: world.held.left, right: world.held.right }
}

test('traduce el caso canonico: el arma sale de la distancia', (t) => {
  const sage = new Sage()
  const r = sage.ask('usa la ballesta si esta lejos')
  t.is(r.ok, true)
  t.is(r.script, '?foe.dist >= 5\n equip crossbow')
})

test('entiende el voseo sin listar cada conjugacion', (t) => {
  const sage = new Sage()
  t.is(sage.ask('usá la ballesta si está lejos').script, '?foe.dist >= 5\n equip crossbow')
  t.is(sage.ask('tomate una poción cuando estés bajo de vida').script, '?hp < 7\n use potion')
  t.is(sage.ask('poné el escudo si estás bajo de vida').script, '?hp < 7\n equip shield')
  t.is(sage.ask('aguantá si el bicho vuela').script, '?foe.flying\n wait')
})

test('cambiar de arma cuando se acerca', (t) => {
  const sage = new Sage()
  t.is(sage.ask('cambia a espada cuando se acerque').script, '?foe.dist <= 3\n equip sword')
})

test('"pelea de lejos" elige el arma por alcance, no por nombre', (t) => {
  const sage = new Sage()
  const r = sage.ask('si es un mosquito peleá de lejos')
  t.is(r.ok, true)
  t.is(r.script, '?foe.maxhp = 13\n equip crossbow')
  t.is(sage.ask('peleá de cerca').script, 'equip sword')
})

test('reconoce al bicho por un numero, nunca por el nombre', (t) => {
  const sage = new Sage()
  // El idioma no tiene literales de texto: `foe.kind = mosquito` compila, no
  // falla, y da false para siempre porque lee `mosquito` como una ruta del
  // mundo. Es el peor bug posible aca, silencioso y adentro de la pelea.
  for (const foe of Object.values(CONTENT.foes)) {
    const r = sage.ask(`usa la espada si es un ${foe.name}`)
    t.is(r.ok, true, foe.name)
    t.absent(r.script.includes('foe.kind'), `${foe.name} no se compara por nombre`)
    t.ok(r.script.includes(`foe.maxhp = ${foe.stats.hp}`), `${foe.name} se compara por vida maxima`)
  }
})

test('numeros explicitos, en los dos ordenes en que se dicen', (t) => {
  const sage = new Sage()
  t.is(sage.ask('pone el escudo si tenes menos de 6 de vida').script, '?hp < 6\n equip shield')
  t.is(sage.ask('si la vida baja de 5 tomate una pocion').script, '?hp < 5\n use potion')
  t.is(
    sage.ask('usa la ballesta si esta a mas de 6 casillas').script,
    '?foe.dist > 6\n equip crossbow'
  )
})

test('dos condiciones se juntan con &', (t) => {
  const sage = new Sage()
  t.is(
    sage.ask('usa la ballesta si esta lejos y es un golem').script,
    '?foe.dist >= 5 & foe.maxhp = 30\n equip crossbow'
  )
})

test('una orden sin condicion sale como regla suelta', (t) => {
  const sage = new Sage()
  t.is(sage.ask('usa la espada').script, 'equip sword')
})

test('la negacion se escribe como su opuesta, no como un ! pegado', (t) => {
  const sage = new Sage()
  t.is(sage.ask('usa la espada si no esta lejos').script, '?foe.dist < 5\n equip sword')
  t.is(sage.ask('aguanta si no te quedan pociones').script, '?potions = 0\n wait')
})

test('el texto entre comillas viaja tal cual al comando >', (t) => {
  const sage = new Sage()
  const r = sage.ask('deci "me estan pegando @hp@" si estas bajo de vida')
  t.is(r.ok, true)
  t.is(r.script, '?hp < 7\n > me estan pegando @hp@')
})

test('todo lo que el sabio ofrece como ejemplo, el sabio lo entiende', (t) => {
  const sage = new Sage()
  for (const frase of sage.examples()) {
    const r = sage.ask(frase)
    t.is(r.ok, true, frase)
    t.is(parse(r.script).errors.length, 0, `${frase} parsea limpio`)
  }
})

test('lo que devuelve no solo parsea: mueve el mundo de verdad', (t) => {
  const sage = new Sage()
  const hoja = sage.compose([
    'tomate una pocion cuando estes bajo de vida',
    'usa la ballesta si esta lejos',
    'cambia a la espada cuando se acerque',
    'usa la espada'
  ])
  t.is(hoja.ok, true)

  const w = new World('mosquito')
  // Arranca a 40 casillas: lejos.
  let step = fold(hoja.script, w)
  t.is(step.errors.length, 0)
  t.is(step.problems.length, 0, 'ni un comando ni un item que el mundo no conozca')
  t.is(step.left.id, 'crossbow')

  // Se le viene encima: tiene que soltar la ballesta.
  w.foe.x = w.hero.x + 1
  step = fold(hoja.script, w)
  t.is(step.left.id, 'sword')

  // Y con la vida en el piso se toma la pocion sin que nadie se lo recuerde.
  w.hero.hp = 5
  const antes = w.potions
  fold(hoja.script, w)
  t.is(w.potions, antes - 1)
  t.is(w.hero.hp, 13)
})

test('la regla por bicho distingue de verdad entre un bicho y otro', (t) => {
  const sage = new Sage()
  const r = sage.ask('si es un mosquito peleá de lejos')

  const contra = new World('mosquito')
  t.is(fold(r.script, contra).left.id, 'crossbow', 'contra el mosquito equipa')

  const otro = new World('golem')
  t.is(fold(r.script, otro).left, null, 'contra el golem no toca nada')
})

test('no inventa una regla cuando no entiende la condicion', (t) => {
  const sage = new Sage()
  const r = sage.ask('usa la ballesta si es un dragon')
  t.is(r.ok, false)
  t.is(r.script, null, 'nada de devolver equip crossbow suelto y que pierda la pelea')
  t.alike(r.unknown, ['dragon'])
  t.ok(r.say.join(' ').includes('dragon'), 'nombra la palabra que lo trabo')
})

test('dice que no puede en vez de aproximar cuando el juego no lo tiene', (t) => {
  const sage = new Sage()
  const r = sage.ask('alejate cuando se acerque')
  t.is(r.ok, false)
  t.is(r.script, null)
  t.ok(r.say.join(' ').includes('pelea de lejos'), 'ofrece lo que si existe en su lugar')
})

test('un "si" sin condicion legible no se convierte en regla incondicional', (t) => {
  const sage = new Sage()
  const r = sage.ask('usa la ballesta si el clima acompaña')
  t.is(r.ok, false)
  t.is(r.script, null)
})

test('no se come en silencio una palabra que no uso', (t) => {
  const sage = new Sage()
  const r = sage.ask('peleá de lejos con una pocion')
  t.is(r.ok, false)
  t.is(r.script, null)
})

test('se planta con dos bichos que el idioma no puede separar', (t) => {
  const gemelos = {
    items: CONTENT.items,
    zones: CONTENT.zones,
    foes: {
      lobo: {
        id: 'lobo',
        name: 'lobo',
        glyph: 'w',
        stats: { hp: 12, atk: 3, reach: 2, speed: 0.3, cooldown: 15 },
        zone: 0,
        drop: { gold: [1, 2], xp: 1 }
      },
      perro: {
        id: 'perro',
        name: 'perro',
        glyph: 'd',
        stats: { hp: 12, atk: 3, reach: 2, speed: 0.3, cooldown: 15 },
        zone: 0,
        drop: { gold: [1, 2], xp: 1 }
      }
    }
  }
  const sage = new Sage({ content: gemelos })
  const r = sage.ask('usa la espada si es un lobo')
  t.is(r.ok, false)
  t.is(r.script, null)
  t.is(r.reason, 'bicho-indistinguible')
  t.ok(r.say.join(' ').includes('misma vida maxima'), 'explica por que, no solo que no')
})

test('cada frase que no entiende falla por el motivo correcto y sin script', (t) => {
  const sage = new Sage()
  for (const [frase, motivo] of NO_ENTIENDE) {
    const r = sage.ask(frase)
    t.is(r.ok, false, `"${frase}" no se entiende`)
    t.is(r.script, null, `"${frase}" no devuelve script`)
    t.is(r.rule, null, `"${frase}" no devuelve regla`)
    t.is(r.reason, motivo, `"${frase}" falla por ${motivo}`)
  }
})

test('cuando no entiende, ofrece lo que si sabe hacer', (t) => {
  const sage = new Sage()
  for (const [frase] of NO_ENTIENDE) {
    const r = sage.ask(frase)
    t.ok(r.say.length > 2, `"${frase}" dice algo mas que "no"`)
    t.ok(r.examples.length > 0, `"${frase}" ofrece ejemplos`)
    t.ok(r.say.join(' ').includes('de esto si se'), `"${frase}" muestra el menu`)
  }
})

test('el vocabulario sale del contenido, asi que un item por OTA entra solo', (t) => {
  const conOTA = {
    zones: CONTENT.zones,
    foes: CONTENT.foes,
    items: {
      ...CONTENT.items,
      lanza: {
        id: 'lanza',
        name: 'lanza',
        hand: 'left',
        glyph: '|',
        atk: 3,
        reach: 5,
        cooldown: 22,
        speed: 0,
        about: 'termino medio'
      }
    }
  }
  const sage = new Sage({ content: conOTA })
  t.is(sage.ask('usa la lanza si esta cerca').script, '?foe.dist <= 3\n equip lanza')
  t.ok(sage.vocabulary().items.includes('lanza'))
})

test('los umbrales salen del alcance del arma corta, no de un numero magico', (t) => {
  const conEspadaLarga = {
    zones: CONTENT.zones,
    foes: CONTENT.foes,
    items: { ...CONTENT.items, sword: { ...CONTENT.items.sword, reach: 6 } }
  }
  const sage = new Sage({ content: conEspadaLarga })
  // La espada ahora llega a 6, asi que "lejos" tiene que correrse con ella.
  t.is(sage.ask('usa la ballesta si esta lejos').script, '?foe.dist >= 9\n equip crossbow')
})

test('el umbral de vida sigue a la vida base del heroe', (t) => {
  t.is(new Sage({ maxhp: 20 }).ask('curate si estas bajo de vida').script, '?hp < 7\n use potion')
  t.is(new Sage({ maxhp: 60 }).ask('curate si estas bajo de vida').script, '?hp < 21\n use potion')
})

test('compose arma la hoja: bloques sueltos arriba, cadena de armas abajo', (t) => {
  const sage = new Sage()
  const hoja = sage.compose([
    'tomate una pocion cuando estes bajo de vida',
    'usa la ballesta si esta lejos',
    'cambia a la espada cuando se acerque',
    'usa la espada'
  ])
  t.is(hoja.ok, true)
  t.is(hoja.problems.length, 0)
  t.is(parse(hoja.script).errors.length, 0)

  const cuerpo = hoja.script
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//'))
    .join('\n')

  t.is(
    cuerpo,
    [
      '?hp < 7',
      ' use potion',
      '?foe.dist >= 5',
      ' equip crossbow',
      ':?foe.dist <= 3',
      ' equip sword',
      ':',
      ' equip sword'
    ].join('\n')
  )
})

test('compose no descarta en silencio lo que no entendio', (t) => {
  const sage = new Sage()
  const hoja = sage.compose(['usa la ballesta si esta lejos', 'matalo con magia negra'])
  t.is(hoja.ok, false, 'ok es false si quedo algo afuera')
  t.ok(hoja.script, 'igual devuelve lo que si pudo escribir')
  t.is(hoja.problems.length, 1)
  t.ok(hoja.problems[0].includes('magia negra'), 'dice cual frase quedo afuera')
  t.absent(hoja.problems[0].includes('ahi me perdiste'), 'y dice el motivo, no la muletilla')
})

test('compose se planta si no entendio absolutamente nada', (t) => {
  const sage = new Sage()
  const hoja = sage.compose(['matalo con magia negra', 'volvete invisible'])
  t.is(hoja.ok, false)
  t.is(hoja.script, null)
})

test('ninguna respuesta fallida trae script, regla ni promesas', (t) => {
  const sage = new Sage()
  const basura = [
    'kjhsdf lkjh',
    'usa la ballesta si el dragon vuela alto',
    'hace algo',
    'quiero ganar',
    'pone el escudo si la vida',
    'usa la ballesta hasta que se acerque',
    'tomate 3',
    'no',
    'si',
    'y'
  ]
  for (const frase of basura) {
    const r = sage.ask(frase)
    t.is(r.ok, false, `"${frase}"`)
    t.is(r.script, null, `"${frase}" sin script`)
  }
})

test('nada de lo que escribe usa una comparacion que el idioma no sabe hacer', (t) => {
  const sage = new Sage()
  const frases = [
    ...sage.examples(),
    'usa la espada si es un golem',
    'aguanta si es un espectro',
    'usa la ballesta si esta lejos y es un mosquito',
    'curate si tenes menos de 4 de vida',
    'usa la espada si no esta lejos'
  ]
  for (const frase of frases) {
    const r = sage.ask(frase)
    t.is(r.ok, true, frase)
    t.absent(/foe\.kind|foe\.name|"/.test(r.script), `${frase} no compara texto`)
    // Todo comando emitido tiene que existir en el mundo.
    const w = new World('mosquito')
    const { nodes } = parse(r.script)
    const problems = w.readIntent(run(nodes, w.snapshot()).actions)
    t.is(problems.length, 0, `${frase} no emite comandos ni items desconocidos`)
  }
})
