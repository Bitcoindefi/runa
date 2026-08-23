'use strict'

/**
 * El sabio.
 *
 * Un NPC que traduce lenguaje natural acotado al idioma del juego. Sin modelo,
 * sin red, sin dependencias: una tabla de frases y un ensamblador. Corre en el
 * mismo tick que el resto y no suma un byte al binario mas alla de este archivo.
 *
 * El problema que ataca es el unico que tiene el juego: alguien que nunca
 * programo abre script.txt y no sabe por donde empezar. Decirle "escribi
 * ?foe.dist >= 5" no ayuda. Dejarlo decir "usa la ballesta si esta lejos" si.
 *
 * La regla de diseno que ordena todo lo demas, y es lo que separa esto de un
 * juguete: cuando no entiende, lo dice. Un sabio que devuelve un script
 * equivocado es peor que uno que se calla, porque el jugador pierde la pelea
 * sin saber por que y le echa la culpa al juego. Asi que cada palabra de la
 * frase tiene que quedar consumida por algo conocido; si sobra una sola, no
 * sale script. Prefiere fallar seguido y en voz alta antes que acertar a medias.
 *
 * Tres cosas se derivan de content.js en vez de estar escritas a mano, y por eso
 * un item o un bicho que llega por OTA queda en el vocabulario del sabio sin
 * tocar este archivo:
 *
 *  - los nombres de los items
 *  - los nombres de los bichos
 *  - los umbrales de "cerca" y "lejos", que salen del alcance del arma corta
 *
 * Limite del idioma que condiciona el diseno: script.js no tiene literales de
 * texto. `foe.kind = mosquito` compila, no falla, y da false para siempre,
 * porque `mosquito` se lee como una ruta del mundo y devuelve undefined. Es la
 * peor clase de bug posible aca: silencioso y dentro de la pelea. Por eso el
 * sabio identifica a los bichos por `foe.maxhp`, que es un numero y si compara,
 * y se niega a escribir la regla si dos bichos comparten vida maxima.
 */

const CONTENT = require('./content.js')
const { parse } = require('./script.js')

/** Vida base del heroe, la que world.js le da al Actor 'vos'. */
const DEFAULT_MAXHP = 20

/** Cuanta vida le tiene que quedar a un bicho para contar como "casi muerto". */
const FOE_LOW_HP = 5

/** Largo maximo de lo que el jugador puede tirarle al sabio de una. */
const MAX_INPUT = 400

/** Largo maximo de un texto para el comando `>`. */
const MAX_SAY = 60

const ACCENTS = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  ã: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  õ: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c'
}

/**
 * Sacar los acentos a mano en vez de con String.normalize, que necesita ICU y
 * Bare no siempre lo trae. De paso hace que el voseo caiga solo: "peleá" y
 * "pelea" quedan en la misma palabra, "usá" y "usa" tambien, asi que el lexico
 * no tiene que listar las dos formas de cada verbo terminado en -ar.
 * @param {string} s
 * @returns {string}
 */
function fold(s) {
  let out = ''
  for (const ch of s) out += ACCENTS[ch] || ch
  return out
}

/**
 * Partir en palabras. Todo lo que no sea letra o digito es separador, asi que
 * la puntuacion, los signos de pregunta y los emojis desaparecen.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return fold(String(text).toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Sacar lo que este entre comillas antes de tokenizar, porque es lo unico de la
 * frase que se copia tal cual al script y no se puede normalizar.
 * @param {string} text
 * @returns {{ clean: string, quotes: string[] }}
 */
function pullQuotes(text) {
  const quotes = []
  const clean = String(text).replace(/["“”']([^"“”']*)["“”']/g, (_, inner) => {
    quotes.push(inner.trim())
    return ` cita${quotes.length - 1} `
  })
  return { clean, quotes }
}

/** Sinonimos de items, por id. Solo se cargan los que existan en el contenido. */
const ITEM_WORDS = {
  sword: ['sable', 'espadita', 'acero', 'filo', 'hoja', 'espadazo'],
  crossbow: ['arco', 'ballestita', 'flecha', 'flechas', 'virote', 'tiro'],
  shield: ['broquel', 'escudito', 'defensa'],
  boots: ['bota', 'zapatillas', 'borcegos', 'calzado']
}

/** Sinonimos de bichos, por id. */
const FOE_WORDS = {
  mosquito: ['mosca', 'mosquitos'],
  golem: ['golems', 'mole'],
  espectro: ['fantasma', 'espectros', 'sombra']
}

/** Comparadores del idioma, por id interno. */
const CMP = { gt: '>', lt: '<', ge: '>=', le: '<=', eq: '=', ne: '!=' }

/** El opuesto de cada comparador, para cuando el jugador niega la condicion. */
const CMP_NOT = { gt: 'le', lt: 'ge', ge: 'lt', le: 'gt', eq: 'ne', ne: 'eq' }

/** Cosas que el jugador puede pedir y el juego directamente no tiene. */
const CANT = {
  mover:
    'el heroe se posiciona solo: camina hasta el alcance del arma que tenga en la mano y retrocede si el bicho se le mete adentro. no hay comando para correr ni para esquivar. lo que si podes elegir es a que distancia peleas, cambiando de arma: proba "pelea de lejos" o "pelea de cerca"',
  tiempo:
    'no hay tiempo ni turnos en el idioma: el script entero se relee 30 veces por segundo, de arriba a abajo. no se puede pedir "despues", "primero" ni "cada 3 segundos". escribi la condicion y el juego la chequea sola en cada cuadro',
  cuentas:
    'el idioma no hace cuentas ni porcentajes, compara numeros pelados. decime el numero directo, tipo "si tenes menos de 7 de vida"',
  fuera:
    'eso no pasa dentro de la pelea. el script solo puede equipar, tomar pociones, esperar y hablar'
}

/**
 * Umbrales derivados del contenido.
 *
 * "cerca" y "lejos" no son numeros inventados: salen del alcance del arma mas
 * corta que pega. Si manana un balanceo mueve la espada, el sabio se mueve con
 * ella y no queda dando consejos de la version anterior.
 *
 * @param {object} content
 * @param {number} maxhp
 * @returns {object}
 */
function buildThresholds(content, maxhp) {
  const weapons = Object.values(content.items).filter((i) => (i.atk || 0) > 0)
  const short = weapons.reduce((a, b) => (b.reach < a.reach ? b : a), weapons[0])
  const long = weapons.reduce((a, b) => (b.reach > a.reach ? b : a), weapons[0])

  return {
    near: (short ? short.reach : 2) + 1,
    far: (short ? short.reach : 2) + 3,
    low: Math.max(1, Math.round(maxhp * 0.35)),
    half: Math.max(1, Math.round(maxhp / 2)),
    foeLow: FOE_LOW_HP,
    short,
    long
  }
}

/**
 * La tabla de condiciones que el sabio sabe escribir.
 *
 * Cada entrada trae la expresion, su opuesta y una explicacion en criollo. La
 * opuesta esta escrita a mano y no como `!expr` porque `potions = 0` se lee y
 * se corrige mucho mejor que `!potions > 0`, y el jugador va a tener que
 * leerlo despues sin el sabio al lado.
 *
 * @param {object} content
 * @param {object} th
 * @returns {Object<string, object>}
 */
function buildConds(content, th) {
  const conds = {
    'dist.far': {
      expr: `foe.dist >= ${th.far}`,
      not: `foe.dist < ${th.far}`,
      gloss: `para mi "lejos" son ${th.far} casillas o mas, que es donde la ${th.short ? th.short.name : 'espada'} ya no llega`
    },
    'dist.near': {
      expr: `foe.dist <= ${th.near}`,
      not: `foe.dist > ${th.near}`,
      gloss: `"cerca" son ${th.near} casillas o menos, ahi el arma corta ya alcanza`
    },
    'hp.low': {
      expr: `hp < ${th.low}`,
      not: `hp >= ${th.low}`,
      gloss:
        `"bajo de vida" lo puse en menos de ${th.low}, un tercio largo de tus ${th.maxhp || ''}`.trim()
    },
    'hp.half': {
      expr: `hp <= ${th.half}`,
      not: `hp > ${th.half}`,
      gloss: `"media vida" es ${th.half} o menos`
    },
    'hp.full': {
      expr: 'hp >= maxhp',
      not: 'hp < maxhp',
      gloss:
        'eso compara tu vida contra tu maximo, asi que sigue siendo cierto cuando subas de nivel'
    },
    'potions.any': {
      expr: 'potions > 0',
      not: 'potions = 0',
      gloss: 'ojo que el juego ya se fija solo si te quedan pociones antes de tomarte una'
    },
    'potions.none': {
      expr: 'potions = 0',
      not: 'potions > 0',
      gloss: 'sin pociones es potions = 0'
    },
    'foe.hp.low': {
      expr: `foe.hp <= ${th.foeLow}`,
      not: `foe.hp > ${th.foeLow}`,
      gloss: `"le queda poco" lo puse en ${th.foeLow} de vida o menos`
    },
    ready: {
      expr: 'ready',
      not: '!ready',
      gloss: 'ready es true cuando se te termino el cooldown y podes pegar'
    },
    'foe.flying': {
      expr: 'foe.flying',
      not: '!foe.flying',
      gloss: 'foe.flying te dice si el bicho vuela'
    }
  }

  // Identidad del bicho por vida maxima. Ver el comentario de arriba del todo:
  // el idioma no compara textos, asi que `foe.kind = mosquito` seria false para
  // siempre y el jugador nunca se enteraria. Si dos bichos comparten maxhp la
  // regla es indistinguible, y en ese caso el sabio prefiere no escribirla.
  const byMax = new Map()
  for (const foe of Object.values(content.foes)) {
    const n = foe.stats.hp
    if (!byMax.has(n)) byMax.set(n, [])
    byMax.get(n).push(foe)
  }

  for (const foe of Object.values(content.foes)) {
    const n = foe.stats.hp
    const clash = byMax.get(n).filter((f) => f.id !== foe.id)
    conds[`foe.kind.${foe.id}`] = {
      expr: `foe.maxhp = ${n}`,
      not: `foe.maxhp != ${n}`,
      gloss: `el ${foe.name} es el unico bicho con ${n} de vida maxima, y asi es como el script lo reconoce: el idioma todavia no sabe comparar nombres, solo numeros`,
      ambiguous: clash.length > 0,
      reason: clash.length
        ? `el ${foe.name} y el ${clash.map((f) => f.name).join(', ')} tienen la misma vida maxima (${n}), asi que el script no los puede distinguir. el idioma compara numeros, no nombres, y no tengo otro numero que los separe`
        : ''
    }
  }

  return conds
}

/**
 * Armar el indice de frases.
 *
 * Cada entrada es una frase de una o mas palabras que mapea a un atomo. El
 * indice va por primera palabra y adentro ordenado de mas larga a mas corta,
 * asi "de lejos" le gana a "lejos" y "no hagas nada" le gana a "no".
 *
 * @param {object} content
 * @param {object} conds
 * @returns {Map<string, object[]>}
 */
function buildLexicon(content, conds) {
  const entries = []
  const add = (phrases, atom) => {
    for (const p of phrases) entries.push([p, atom])
  }

  // --- verbos -------------------------------------------------------------

  add(
    [
      'equipa',
      'equipate',
      'equipar',
      'equip',
      'pone',
      'poner',
      'ponete',
      'pon',
      'empuna',
      'empunar',
      'agarra',
      'agarrar',
      'agarrate',
      'saca',
      'sacar',
      'cambia',
      'cambiar',
      'cambiate',
      'pasate',
      'lleva',
      'llevar',
      'blandi',
      'desenvaina',
      'sostene'
    ],
    { t: 'verb', v: 'equip' }
  )

  // "usa" es ambiguo a proposito: se resuelve por el objeto, porque una pocion
  // se toma y un arma se equipa, y el jugador dice "usa" para las dos.
  add(['usa', 'usar', 'usalo', 'usala', 'use', 'utiliza', 'utilizar'], {
    t: 'verb',
    v: 'equip-o-usa'
  })

  add(
    [
      'toma',
      'tomate',
      'tomar',
      'tomatela',
      'bebe',
      'bebete',
      'beber',
      'chupate',
      'curate',
      'cura',
      'curar',
      'curarte',
      'sanate',
      'sana',
      'recuperate',
      'recupera'
    ],
    { t: 'verb', v: 'use', obj: 'potion' }
  )

  add(
    [
      'espera',
      'esperar',
      'esperate',
      'aguanta',
      'aguantar',
      'aguantate',
      'frena',
      'frenate',
      'quedate quieto',
      'no hagas nada',
      'no hagas nada de nada'
    ],
    { t: 'verb', v: 'wait' }
  )

  add(['deci', 'decir', 'di', 'grita', 'gritar', 'avisa', 'avisar', 'escribi', 'mostra'], {
    t: 'verb',
    v: 'say'
  })

  // "pelea de lejos" no nombra un arma, nombra una distancia. El sabio la
  // resuelve al arma cuyo alcance la sostiene, que es exactamente el
  // razonamiento que el juego quiere que el jugador aprenda a hacer solo.
  add(
    [
      'pelea',
      'pelear',
      'peleale',
      'combati',
      'combatir',
      'lucha',
      'luchar',
      'ataca',
      'atacar',
      'atacalo',
      'atacala',
      'enfrentalo',
      'pega',
      'pegar',
      'pegale'
    ],
    { t: 'verb', v: 'fight' }
  )

  // Defenderse si tiene comando: es equipar el escudo.
  if (content.items.shield) {
    add(['defendete', 'defenderte', 'cubrite', 'cubrirte', 'protegete', 'bloquea', 'bloquear'], {
      t: 'verb',
      v: 'equip',
      obj: 'shield'
    })
  }

  // --- lo que el juego no tiene -------------------------------------------

  add(
    [
      'corre',
      'correr',
      'huye',
      'huir',
      'escapa',
      'escapar',
      'retrocede',
      'retroceder',
      'alejate',
      'alejarte',
      'acercate',
      'acercarte',
      'camina',
      'caminar',
      'anda',
      'andar',
      'salta',
      'saltar',
      'movete',
      'moverte',
      'mueve',
      'esquiva',
      'esquivar',
      'rodea',
      'rodear',
      'seguilo',
      'perseguilo'
    ],
    { t: 'cant', v: 'mover' }
  )

  add(
    [
      'repeti',
      'repetir',
      'repite',
      'loop',
      'bucle',
      'cada',
      'segundos',
      'segundo',
      'turno',
      'turnos',
      'despues',
      'antes',
      'primero',
      'luego',
      'veces',
      'ronda',
      'rondas'
    ],
    { t: 'cant', v: 'tiempo' }
  )

  add(['porciento', 'porcentaje', 'promedio', 'sumale', 'restale', 'multiplica', 'divide'], {
    t: 'cant',
    v: 'cuentas'
  })

  add(
    [
      'invoca',
      'invocar',
      'magia',
      'hechizo',
      'conjuro',
      'revivi',
      'revivir',
      'roba',
      'robar',
      'compra',
      'comprar',
      'vende',
      'vender',
      'guarda',
      'guardar'
    ],
    { t: 'cant', v: 'fuera' }
  )

  // --- objetos ------------------------------------------------------------

  for (const item of Object.values(content.items)) {
    add([item.id, fold(item.name.toLowerCase())], { t: 'obj', v: item.id })
    for (const w of ITEM_WORDS[item.id] || []) add([w], { t: 'obj', v: item.id })
  }

  add(['pocion', 'pocima', 'brebaje', 'elixir', 'curacion', 'remedio', 'vendaje'], {
    t: 'obj',
    v: 'potion'
  })

  // --- condiciones --------------------------------------------------------

  add(
    [
      'lejos',
      'de lejos',
      'lejano',
      'alejado',
      'a distancia',
      'esta lejos',
      'este lejos',
      'se aleja',
      'se aleje',
      'se va',
      'a la distancia',
      'de larga'
    ],
    { t: 'cond', v: 'dist.far' }
  )

  add(
    [
      'cerca',
      'de cerca',
      'cercano',
      'encima',
      'al lado',
      'pegado',
      'cuerpo a cuerpo',
      'se acerca',
      'se acerque',
      'se arrima',
      'te alcanza',
      'esta cerca',
      'este cerca',
      'a mano'
    ],
    { t: 'cond', v: 'dist.near' }
  )

  add(
    [
      'bajo de vida',
      'poca vida',
      'poquita vida',
      'casi muerto',
      'casi muerta',
      'herido',
      'malherido',
      'sangrando',
      'en las ultimas',
      'mal de vida',
      'flojo de vida',
      'estas por morir',
      'te estas muriendo'
      // ojo: nada de "la vida baja" aca. Le ganaria por largo a "vida" +
      // "baja de" + numero, y "si la vida baja de 5" dejaria de escribirse
      // como hp < 5 para caer en el umbral generico. Callarse una frase es
      // barato; pisar un numero que el jugador dijo explicito no lo es.
    ],
    { t: 'cond', v: 'hp.low' }
  )

  add(['media vida', 'mitad de vida', 'la mitad de vida'], { t: 'cond', v: 'hp.half' })

  add(['vida llena', 'vida entera', 'sano', 'entero', 'bien de vida', 'a full'], {
    t: 'cond',
    v: 'hp.full'
  })

  add(['te quedan pociones', 'quedan pociones', 'hay pociones', 'tenes pociones', 'con pociones'], {
    t: 'cond',
    v: 'potions.any'
  })

  add(
    [
      'sin pociones',
      'no te quedan pociones',
      'no tenes pociones',
      'no quedan pociones',
      'se acabaron las pociones'
    ],
    { t: 'cond', v: 'potions.none' }
  )

  add(
    [
      'le queda poco',
      'le queda poca vida',
      'esta por morir',
      'esta casi muerto',
      'esta moribundo',
      'casi lo matas',
      'esta debil'
    ],
    { t: 'cond', v: 'foe.hp.low' }
  )

  add(
    [
      'podes pegar',
      'estas listo',
      'el arma esta lista',
      'listo para pegar',
      'cargado',
      'sin espera'
    ],
    { t: 'cond', v: 'ready' }
  )

  add(['vuela', 'volador', 'voladora', 'esta volando', 'volando'], { t: 'cond', v: 'foe.flying' })

  for (const foe of Object.values(content.foes)) {
    const id = `foe.kind.${foe.id}`
    if (!conds[id]) continue
    add([foe.id, fold(foe.name.toLowerCase())], { t: 'cond', v: id })
    for (const w of FOE_WORDS[foe.id] || []) add([w], { t: 'cond', v: id })
  }

  // --- sujetos numericos --------------------------------------------------

  add(['vida', 'hp', 'salud', 'energia', 'puntos de vida'], {
    t: 'subject',
    v: 'hp',
    path: 'hp',
    label: 'vida'
  })

  add(['distancia', 'casillas', 'casilla', 'pasos', 'celdas', 'lejania'], {
    t: 'subject',
    v: 'dist',
    path: 'foe.dist',
    label: 'distancia'
  })

  add(['pociones'], { t: 'subject', v: 'potions', path: 'potions', label: 'pociones' })

  add(['vida del enemigo', 'vida del bicho', 'su vida', 'vida del rival'], {
    t: 'subject',
    v: 'foehp',
    path: 'foe.hp',
    label: 'vida del bicho'
  })

  // --- comparadores y numeros ---------------------------------------------

  add(
    ['mas de', 'arriba de', 'encima de', 'mayor a', 'mayor que', 'sube de', 'suba de', 'pasa de'],
    {
      t: 'cmp',
      v: 'gt'
    }
  )

  add(
    ['menos de', 'abajo de', 'debajo de', 'menor a', 'menor que', 'baja de', 'baje de', 'cae de'],
    { t: 'cmp', v: 'lt' }
  )

  add(['al menos', 'por lo menos', 'llega a', 'llegue a', 'minimo'], { t: 'cmp', v: 'ge' })
  add(['como maximo', 'hasta', 'maximo'], { t: 'cmp', v: 'le' })
  add(['exactamente', 'igual a', 'justo'], { t: 'cmp', v: 'eq' })

  // "uno" y "una" quedan afuera a proposito: en "tomate una pocion" el "una"
  // es un articulo, no una cantidad, y leerlo como numero rompia la frase mas
  // comun que el jugador escribe.
  const NUMS = {
    cero: 0,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    quince: 15,
    veinte: 20
  }
  for (const [w, n] of Object.entries(NUMS)) add([w], { t: 'num', v: n })

  // --- pegamento ----------------------------------------------------------

  add(['y', 'e', 'ademas', 'tambien'], { t: 'conj', v: 'and' })
  add(['o', 'u'], { t: 'conj', v: 'or' })
  add(['no', 'sin', 'ni', 'tampoco'], { t: 'neg' })

  add(
    [
      'si',
      'si es',
      'cuando',
      'mientras',
      'apenas',
      'contra',
      'vs',
      'versus',
      'ante',
      'para',
      'en cuanto',
      'siempre que',
      'cada vez que',
      'de ser'
    ],
    { t: 'marker' }
  )

  add(
    [
      'la',
      'el',
      'lo',
      'los',
      'las',
      'un',
      'una',
      'uno',
      'unos',
      'unas',
      'arma',
      'armas',
      'ataque',
      'golpe',
      'algo',
      'de',
      'del',
      'al',
      'a',
      'en',
      'con',
      'que',
      'se',
      'te',
      'tu',
      'tus',
      'su',
      'sus',
      'me',
      'le',
      'les',
      'es',
      'son',
      'sea',
      'esta',
      'este',
      'estes',
      'esto',
      'estos',
      'estas',
      'ese',
      'esa',
      'eso',
      'sos',
      'ser',
      'estar',
      'estoy',
      'estan',
      'esten',
      'por',
      'favor',
      'porfa',
      'gracias',
      'che',
      'dale',
      'bueno',
      'ok',
      'listo',
      'ya',
      'siempre',
      'entonces',
      'ahora',
      'muy',
      'bien',
      'igual',
      'pero',
      'nomas',
      'quiero',
      'queria',
      'quisiera',
      'necesito',
      'podrias',
      'podes',
      'puedas',
      'puede',
      'hay',
      'tenes',
      'tengo',
      'tener',
      'quedan',
      'queda',
      'llevas',
      'vos',
      'yo',
      'sabio',
      'bicho',
      'bichos',
      'enemigo',
      'rival',
      'monstruo',
      'ese',
      'aca',
      'ahi'
    ],
    { t: 'filler' }
  )

  const map = new Map()
  for (const [phrase, atom] of entries) {
    const w = phrase.split(' ')
    if (!map.has(w[0])) map.set(w[0], [])
    map.get(w[0]).push({ w, atom })
  }
  for (const list of map.values()) list.sort((a, b) => b.w.length - a.w.length)
  return map
}

/**
 * Pasar los tokens a atomos, de a la frase mas larga que entre.
 *
 * Todo token que no case con nada queda como `unknown`, y eso es a proposito:
 * es el unico mecanismo que impide que el sabio invente. Si sobra una palabra,
 * hubo algo que el jugador dijo y el sabio no leyo, y no hay forma de saber si
 * era decorativa o si era la mitad del sentido.
 *
 * @param {Map<string, object[]>} lex
 * @param {string[]} toks
 * @param {string[]} quotes
 * @returns {object[]}
 */
function scan(lex, toks, quotes) {
  const atoms = []
  let i = 0

  while (i < toks.length) {
    const tok = toks[i]

    const q = /^cita(\d+)$/.exec(tok)
    if (q && quotes[Number(q[1])] !== undefined) {
      atoms.push({ t: 'quote', v: quotes[Number(q[1])], i })
      i++
      continue
    }

    let hit = null
    for (const cand of lex.get(tok) || []) {
      let ok = true
      for (let k = 0; k < cand.w.length; k++) {
        if (toks[i + k] !== cand.w[k]) {
          ok = false
          break
        }
      }
      if (ok) {
        hit = cand
        break
      }
    }

    if (hit) {
      atoms.push({ ...hit.atom, i })
      i += hit.w.length
      continue
    }

    if (/^\d+$/.test(tok)) {
      atoms.push({ t: 'num', v: Number(tok), i })
      i++
      continue
    }

    atoms.push({ t: 'unknown', v: tok, i })
    i++
  }

  return atoms
}

/** Dejar un texto en condiciones de vivir adentro de una linea `>`. */
function safeSay(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\/\//g, '/')
    .trim()
    .slice(0, MAX_SAY)
}

class Sage {
  /**
   * @param {object} [opts]
   * @param {object} [opts.content] - items, foes y zones; por defecto content.js
   * @param {number} [opts.maxhp] - vida base del heroe, la de world.js
   */
  constructor(opts = {}) {
    this.content = opts.content || CONTENT
    this.maxhp = opts.maxhp || DEFAULT_MAXHP
    this.th = buildThresholds(this.content, this.maxhp)
    this.th.maxhp = this.maxhp
    this.conds = buildConds(this.content, this.th)
    this.lex = buildLexicon(this.content, this.conds)
  }

  /**
   * Lo que el sabio dice cuando lo saludan.
   * @returns {string[]}
   */
  greet() {
    return [
      'yo escribo las reglas, vos me decis que queres que pase.',
      'hablame como a un vecino: "usa la ballesta si esta lejos".',
      'si no te entiendo te lo digo, no te invento una regla.'
    ]
  }

  /**
   * Frases que el sabio garantiza que entiende. Sirven de ayuda y de ejemplo
   * cuando falla, que es cuando el jugador mas las necesita.
   * @returns {string[]}
   */
  examples() {
    return [
      'usa la ballesta si esta lejos',
      'cambia a la espada cuando se acerque',
      'tomate una pocion cuando estes bajo de vida',
      'si es un mosquito pelea de lejos',
      'pone el escudo si tenes menos de 6 de vida',
      'aguanta si el bicho vuela'
    ]
  }

  /**
   * Todo lo que el sabio puede nombrar, sacado del contenido cargado. Un item o
   * un bicho que llegue por OTA aparece aca solo.
   * @returns {{ items: string[], foes: string[], conds: string[] }}
   */
  vocabulary() {
    return {
      items: Object.values(this.content.items).map((i) => i.name),
      foes: Object.values(this.content.foes).map((f) => f.name),
      conds: [
        'lejos / cerca',
        'bajo de vida / media vida / vida llena',
        'con pociones / sin pociones',
        'le queda poco',
        'vuela',
        'mas de N / menos de N de vida, distancia o pociones'
      ]
    }
  }

  /**
   * Traducir una frase a una regla del idioma del juego.
   *
   * Devuelve siempre el mismo sobre, entienda o no. Cuando `ok` es false,
   * `script` es null y no hay excepcion ni valor a medias: el que llama nunca
   * tiene que adivinar si lo que recibio se puede pegar en script.txt.
   *
   * @param {string} text - lo que escribio el jugador
   * @returns {{ ok: boolean, script: string|null, rule: object|null, say: string[], unknown: string[], examples: string[], reason: string }}
   */
  ask(text) {
    const src = String(text ?? '')
    if (src.trim() === '') return this.#no('vacio', ['decime algo y te lo escribo.'])
    if (src.length > MAX_INPUT) {
      return this.#no('largo', [
        'muy larga la frase. pedime una regla sola, corta, y despues la que sigue.'
      ])
    }

    const { clean, quotes } = pullQuotes(src)
    const toks = tokenize(clean)
    if (!toks.length) return this.#no('vacio', ['decime algo y te lo escribo.'])

    const atoms = scan(this.lex, toks, quotes)

    // 1. Cosas que el juego directamente no tiene. Va primero porque es el
    //    mensaje mas util de todos: no es que no entendi, es que no existe.
    const cant = atoms.find((a) => a.t === 'cant')
    if (cant) return this.#no('no-existe', [CANT[cant.v]])

    // 2. Palabras que no conozco. Segundo, porque nombrarlas le dice al jugador
    //    exactamente donde cambiar la frase.
    const unknown = atoms.filter((a) => a.t === 'unknown').map((a) => a.v)
    if (unknown.length) {
      return this.#no(
        'palabra-desconocida',
        [
          unknown.length === 1
            ? `no se que es "${unknown[0]}".`
            : `no se que son ${unknown.map((w) => `"${w}"`).join(' ni ')}.`,
          `nombres que si conozco: ${this.vocabulary().items.join(', ')}, y los bichos ${this.vocabulary().foes.join(', ')}.`
        ],
        unknown
      )
    }

    // 3. La accion.
    const verbs = atoms.filter((a) => a.t === 'verb')
    if (!verbs.length) {
      return this.#no('sin-accion', [
        'entendi la condicion pero no que queres hacer.',
        'agregale un verbo: equipar algo, tomarte una pocion, o esperar.'
      ])
    }
    if (verbs.length > 1) {
      return this.#no('dos-acciones', [
        'me pediste dos cosas de una y no se cual va primero.',
        'decimelas de a una y te armo la hoja entera al final.'
      ])
    }

    const verb = verbs[0]
    const objs = atoms.filter((a) => a.t === 'obj')
    if (objs.length > 1) {
      return this.#no('dos-objetos', [
        'nombraste dos cosas y una mano sola no lleva las dos.',
        'una regla por item, asi despues se puede leer cual gano.'
      ])
    }

    const built = this.#command(verb, objs[0], atoms)
    if (built.error) return built.error

    // 4. Nada de tirar palabras a la basura. Si nombro una cosa y el comando no
    //    la uso, algo quiso decir con eso y yo no lo lei. Este barrido es el que
    //    hace que la promesa "todo lo que dijiste esta en el script" sea cierta
    //    y no una intencion.
    const stray = atoms.filter((a) => (a.t === 'obj' || a.t === 'quote') && !built.consumed.has(a))
    if (stray.length) {
      return this.#no('objeto-suelto', [
        `nombraste "${stray[0].v}" y no supe donde meterlo en la regla.`,
        'sacalo o pedimelo en una regla aparte.'
      ])
    }

    // 5. Las condiciones.
    const cond = this.#condition(atoms, built.consumed)
    if (cond.error) return cond.error

    const markers = atoms.filter((a) => a.t === 'marker')
    if (markers.length && !cond.expr) {
      return this.#no('condicion-perdida', [
        'dijiste "si" o "cuando" pero no me quedo claro bajo que condicion.',
        'no te escribo la regla sin la condicion: te la aplicaria siempre y perderias la pelea sin entender por que.'
      ])
    }

    const script = cond.expr
      ? `?${cond.expr}\n` + built.cmds.map((c) => ' ' + c).join('\n')
      : built.cmds.join('\n')

    const bad = parse(script).errors
    if (bad.length) {
      return this.#no('error-interno', [
        'me sale mal escrita y no te la voy a dar rota.',
        `lo que me trabo: ${bad[0].message}`
      ])
    }

    const say = ['listo. asi se escribe:', '', ...script.split('\n'), '']
    for (const g of cond.gloss) say.push(g)
    for (const n of built.notes) say.push(n)
    say.push(
      'pegalo en script.txt. se relee sola mientras peleas, podes cambiarla en medio de una.'
    )

    return {
      ok: true,
      script,
      rule: { when: cond.expr || null, cmds: built.cmds.slice() },
      say,
      unknown: [],
      examples: [],
      reason: ''
    }
  }

  /**
   * Juntar varias frases en una hoja de reglas sola.
   *
   * El orden importa y no es el que el jugador escribio. Las pociones y las
   * esperas salen como bloques sueltos arriba, porque son urgencias y corren
   * aparte. Los equipar salen como una cadena `? / :? / :`, para que gane la
   * primera que aplica, que es como se lee una lista de reglas de arriba a
   * abajo. Sueltos ganaria el ultimo, que es lo contrario de lo que uno lee.
   *
   * Una frase que no se entiende no se descarta en silencio: sale en
   * `problems`, y `ok` es true solo si no quedo ninguna afuera.
   *
   * @param {string[]} texts
   * @returns {{ ok: boolean, script: string|null, say: string[], problems: string[] }}
   */
  compose(texts) {
    const list = Array.isArray(texts) ? texts : [texts]
    const problems = []
    const loose = []
    const chain = []
    let fallback = null

    for (const text of list) {
      const reply = this.ask(text)
      if (!reply.ok) {
        // say[0] es siempre "ahi me perdiste". Lo util es say[1], que es el
        // motivo concreto, y es lo unico que el jugador puede accionar.
        problems.push(`"${String(text).trim()}": ${reply.say[1] || reply.say[0]}`)
        continue
      }
      const tag = `// ${safeSay(String(text).trim())}`
      const isEquip = reply.rule.cmds.every((c) => c.startsWith('equip'))
      if (isEquip && reply.rule.when) {
        chain.push({ tag, when: reply.rule.when, cmds: reply.rule.cmds })
      } else if (isEquip) {
        if (fallback) {
          problems.push(
            `"${String(text).trim()}": ya tenias un equipar sin condicion, me quedo con el ultimo`
          )
        }
        fallback = { tag, cmds: reply.rule.cmds }
      } else loose.push({ tag, when: reply.rule.when, cmds: reply.rule.cmds })
    }

    if (!loose.length && !chain.length && !fallback) {
      return {
        ok: false,
        script: null,
        say: ['no pude sacar ni una regla de eso.', ...problems],
        problems
      }
    }

    const lines = ['// hoja escrita por el sabio']

    for (const b of loose) {
      lines.push('')
      lines.push(b.tag)
      if (b.when) {
        lines.push(`?${b.when}`)
        for (const c of b.cmds) lines.push(' ' + c)
      } else {
        for (const c of b.cmds) lines.push(c)
      }
    }

    if (chain.length || fallback) {
      lines.push('')
      for (let k = 0; k < chain.length; k++) {
        lines.push(chain[k].tag)
        lines.push(`${k === 0 ? '?' : ':?'}${chain[k].when}`)
        for (const c of chain[k].cmds) lines.push(' ' + c)
      }
      if (fallback) {
        lines.push(fallback.tag)
        if (chain.length) {
          lines.push(':')
          for (const c of fallback.cmds) lines.push(' ' + c)
        } else {
          for (const c of fallback.cmds) lines.push(c)
        }
      }
    }

    const script = lines.join('\n')
    const bad = parse(script).errors
    if (bad.length) {
      return {
        ok: false,
        script: null,
        say: ['se me armo mal la hoja y no te la doy rota.', `lo que me trabo: ${bad[0].message}`],
        problems
      }
    }

    const say = ['te la dejo asi:', '', ...script.split('\n'), '']
    if (problems.length) {
      say.push('esto no lo pude escribir, decimelo de otra forma:')
      for (const p of problems) say.push(' ' + p)
    } else {
      say.push(
        'las de arriba corren solas, la cadena de abajo elige una sola arma: gana la primera que da true.'
      )
    }

    return { ok: problems.length === 0, script, say, problems }
  }

  /**
   * Resolver el verbo y su objeto en comandos del idioma.
   * @param {object} verb
   * @param {object} [obj]
   * @param {object[]} atoms
   * @returns {{ cmds?: string[], notes?: string[], consumed?: Set<object>, error?: object }}
   */
  #command(verb, obj, atoms) {
    const consumed = new Set()
    const notes = []
    const items = this.content.items
    const target = obj ? obj.v : verb.obj || null

    if (verb.v === 'wait') {
      if (obj) {
        return {
          error: this.#no('objeto-de-mas', [
            'esperar no lleva objeto. si lo que queres es equipar algo, decime "equipa" en vez de "espera".'
          ])
        }
      }
      return {
        cmds: ['wait'],
        notes: ['wait no hace nada a proposito: te deja el arma quieta ese cuadro.'],
        consumed
      }
    }

    if (verb.v === 'say') {
      const quote = atoms.find((a) => a.t === 'quote')
      if (!quote) {
        return {
          error: this.#no('sin-texto', [
            'que queres que diga? ponelo entre comillas, tipo: deci "me esta cagando a palos" si estas bajo de vida.',
            'adentro del texto podes meter @hp@ o @foe.dist@ y el juego te pone el numero en vivo.'
          ])
        }
      }
      consumed.add(quote)
      return {
        cmds: [`> ${safeSay(quote.v)}`],
        notes: [
          'esa linea sale en el log de la pelea, y solo cuando cambia, asi que no te lo tapa.'
        ],
        consumed
      }
    }

    if (verb.v === 'fight') {
      if (target && target !== 'potion') {
        if (!items[target]) return { error: this.#unknownItem(target) }
        if (obj) consumed.add(obj)
        return { cmds: [`equip ${target}`], notes: this.#itemNote(items[target]), consumed }
      }

      // Sin arma nombrada, la distancia que viene despues del verbo es la que
      // dice como pelear. Antes del verbo seria una condicion, no una manera.
      const manner = atoms.find(
        (a) => a.t === 'cond' && a.i > verb.i && (a.v === 'dist.far' || a.v === 'dist.near')
      )
      if (!manner) {
        return {
          error: this.#no('pelear-como', [
            'de lejos o de cerca? "pelear" solo no me dice que arma sacar.',
            `probá "pelea de lejos" y te pongo la ${this.th.long ? this.th.long.name : 'ballesta'}, o "pelea de cerca" y te pongo la ${this.th.short ? this.th.short.name : 'espada'}.`
          ])
        }
      }
      consumed.add(manner)
      const pick = manner.v === 'dist.far' ? this.th.long : this.th.short
      if (!pick) return { error: this.#no('sin-arma', ['no tengo un arma para esa distancia.']) }
      return {
        cmds: [`equip ${pick.id}`],
        notes: [
          `"${manner.v === 'dist.far' ? 'de lejos' : 'de cerca'}" lo traduje a la ${pick.name}, que es el arma con el alcance que hace falta (${pick.reach}).`,
          ...this.#itemNote(pick)
        ],
        consumed
      }
    }

    // equip / use / equip-o-usa
    if (!target) {
      if (verb.v === 'use') return { cmds: ['use potion'], notes: this.#potionNote(), consumed }
      return {
        error: this.#no('sin-objeto', [
          'con que? decime que queres que agarre.',
          `tengo: ${Object.values(items)
            .map((i) => i.name)
            .join(', ')}, y pociones.`
        ])
      }
    }

    if (target === 'potion') {
      if (verb.v === 'equip') {
        return {
          error: this.#no('mano-equivocada', [
            'las pociones no se equipan, se toman. decime "tomate una pocion" y sale bien.'
          ])
        }
      }
      if (obj) consumed.add(obj)
      return { cmds: ['use potion'], notes: this.#potionNote(), consumed }
    }

    if (!items[target]) return { error: this.#unknownItem(target) }

    if (verb.v === 'use' && !verb.obj) {
      return {
        error: this.#no('verbo-equivocado', [
          `la ${items[target].name} no se toma, se equipa. decime "equipa la ${items[target].name}" o "usa la ${items[target].name}".`
        ])
      }
    }
    if (verb.v === 'use' && verb.obj === 'potion' && target !== 'potion') {
      return {
        error: this.#no('verbo-equivocado', [
          `eso es para pociones. la ${items[target].name} se equipa: "equipa la ${items[target].name}".`
        ])
      }
    }

    if (obj) consumed.add(obj)
    return { cmds: [`equip ${target}`], notes: this.#itemNote(items[target]), consumed }
  }

  /**
   * Armar la condicion a partir de los atomos que la accion no se llevo.
   * @param {object[]} atoms
   * @param {Set<object>} consumed
   * @returns {{ expr?: string, gloss?: string[], error?: object }}
   */
  #condition(atoms, consumed) {
    const gloss = []
    const parts = []

    // Numericos: [comparador, numero, sujeto] o [sujeto, comparador, numero].
    const rel = atoms.filter(
      (a) => !consumed.has(a) && (a.t === 'cmp' || a.t === 'num' || a.t === 'subject')
    )
    const usedRel = new Set()
    for (let k = 0; k < rel.length; k++) {
      const a = rel[k]
      const b = rel[k + 1]
      const c = rel[k + 2]
      if (!b || !c) continue
      let sub = null
      let cmp = null
      let num = null
      if (a.t === 'cmp' && b.t === 'num' && c.t === 'subject') {
        cmp = a
        num = b
        sub = c
      } else if (a.t === 'subject' && b.t === 'cmp' && c.t === 'num') {
        sub = a
        cmp = b
        num = c
      }
      if (!sub) continue
      usedRel.add(a).add(b).add(c)
      parts.push({
        i: Math.min(a.i, b.i, c.i),
        sub,
        cmp: cmp.v,
        num: num.v,
        numeric: true
      })
      k += 2
    }

    const dangling = rel.filter((a) => !usedRel.has(a))
    if (dangling.length) {
      const hasNum = dangling.some((a) => a.t === 'num')
      const hasSub = dangling.some((a) => a.t === 'subject')
      if (hasNum && !hasSub) {
        return {
          error: this.#no('numero-suelto', [
            `${dangling.find((a) => a.t === 'num').v} de que? de vida, de distancia o de pociones?`,
            'ejemplo: "usa la ballesta si esta a mas de 6 casillas".'
          ])
        }
      }
      if (hasSub && !hasNum) {
        return {
          error: this.#no('sujeto-suelto', [
            `${dangling.find((a) => a.t === 'subject').label} cuanta? decime mas de cuanto o menos de cuanto.`,
            'ejemplo: "si tenes menos de 7 de vida".'
          ])
        }
      }
      if (!hasNum && !hasSub) {
        return {
          error: this.#no('comparacion-incompleta', [
            'me dejaste una comparacion por la mitad: mas de cuanto, menos de cuanto?',
            'ejemplo: "tomate una pocion si tenes menos de 7 de vida".'
          ])
        }
      }
      return {
        error: this.#no('numero-suelto', [
          'me quedo un numero colgado y no se con que compararlo.',
          'ejemplo: "si el bicho esta a mas de 6 casillas".'
        ])
      }
    }

    for (const a of atoms) {
      if (consumed.has(a) || a.t !== 'cond') continue
      const def = this.conds[a.v]
      if (!def) continue
      if (def.ambiguous) return { error: this.#no('bicho-indistinguible', [def.reason]) }
      parts.push({ i: a.i, def })
    }

    if (!parts.length) return { expr: '', gloss }

    // Negacion: un "no" o un "sin" niega la condicion que viene despues.
    for (const neg of atoms.filter((a) => a.t === 'neg' && !consumed.has(a))) {
      const target = parts.filter((p) => p.i > neg.i).sort((a, b) => a.i - b.i)[0]
      if (!target) {
        return {
          error: this.#no('negacion-suelta', [
            'dijiste que no, pero no me quedo claro que era lo que no.',
            'probá al reves, en positivo: "usa la espada si esta cerca".'
          ])
        }
      }
      target.neg = !target.neg
    }

    const conjs = atoms.filter((a) => a.t === 'conj' && !consumed.has(a))
    const kinds = new Set(conjs.map((c) => c.v))
    if (kinds.size > 1) {
      return {
        error: this.#no('y-u-o', [
          'mezclaste un "y" con un "o" y no se cual manda.',
          'partilas en dos reglas y te las escribo por separado.'
        ])
      }
    }
    const glue = kinds.has('or') ? ' | ' : ' & '

    parts.sort((a, b) => a.i - b.i)
    const exprs = []
    for (const p of parts) {
      if (p.numeric) {
        const cmp = p.neg ? CMP_NOT[p.cmp] : p.cmp
        exprs.push(`${p.sub.path} ${CMP[cmp]} ${p.num}`)
        gloss.push(`"${p.sub.label}" es ${p.sub.path} en el idioma del juego.`)
      } else {
        exprs.push(p.neg ? p.def.not : p.def.expr)
        gloss.push(p.def.gloss)
      }
    }

    if (exprs.length > 1 && !conjs.length) {
      gloss.push(
        'las junte con "&", o sea que tienen que valer las dos. si querias una o la otra, decime "o".'
      )
    }

    return { expr: exprs.join(glue), gloss }
  }

  /** @param {object} item */
  #itemNote(item) {
    const notes = [`${item.name}: ${item.about} (alcance ${item.reach}, dano ${item.atk}).`]
    if (item.hand === 'right') notes.push('va en la otra mano, asi que no te saca el arma.')
    return notes
  }

  #potionNote() {
    return [
      'el juego ya chequea solo que te queden pociones y que no estes con la vida llena, no hace falta que se lo pidas.'
    ]
  }

  #unknownItem(id) {
    return this.#no('item-desconocido', [
      `no tengo ningun "${id}".`,
      `lo que hay: ${Object.values(this.content.items)
        .map((i) => i.name)
        .join(', ')}.`
    ])
  }

  /**
   * El sobre de "no entendi". Siempre con ejemplos: decir que no sin decir que
   * si es dejar al jugador en el mismo lugar donde estaba antes de preguntar.
   * @param {string} reason
   * @param {string[]} lines
   * @param {string[]} [unknown]
   */
  #no(reason, lines, unknown = []) {
    const say = ['ahi me perdiste.', ...lines, '', 'de esto si se:']
    for (const e of this.examples()) say.push(' ' + e)
    return { ok: false, script: null, rule: null, say, unknown, examples: this.examples(), reason }
  }
}

module.exports = { Sage }
