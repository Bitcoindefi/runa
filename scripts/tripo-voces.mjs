// Lo que dicen los monstruos durante la pelea, en ingles y en castellano: una
// personalidad por monstruo, unas frases cortas por momento de la pelea y como
// suena cada voz (para disenarla en ElevenLabs).
//
//  - LINES: por monstruo y por evento, pares [ingles, castellano] alineados: la
//    frase n de un idioma dice lo mismo que la n del otro.
//  - createPicker: elige que frase dice cada uno, con una espera por monstruo,
//    sin repetir la ultima y con prioridad para el contacto y la muerte. Usa una
//    semilla: las pruebas salen siempre igual.
//  - El manifiesto (assets/voces/manifest.json) dice que mp3 hay para cada
//    frase. Lo arma scripts/generar-voces.mjs; validateManifest lo revisa.
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

export const LANGS = ['en', 'es']

// Los momentos de la pelea en que habla un monstruo.
export const EVENTS = [
  'contact',
  'monster_hits',
  'monster_hurt',
  'monster_low',
  'player_low',
  'player_potion',
  'player_guard',
  'player_retreat',
  'monster_death'
]
// El Coloso ademas avisa sus golpes, ruge al cambiar de fase y se despide.
export const BOSS = 'colossus'
export const BOSS_EVENTS = [...EVENTS, 'windup_slam', 'windup_sweep', 'phase_change', 'defeated']

// Lo que pasa por encima de la espera: no se pierde nunca.
export const PRIORITY = ['contact', 'monster_death', 'phase_change', 'defeated']
// Segundos entre dos frases del mismo monstruo.
export const COOLDOWN = 3
// Los golpes pasan en cada turno: no todos llevan frase.
export const CHANCE = {
  monster_hits: 0.7,
  monster_hurt: 0.6,
  windup_slam: 0.85,
  windup_sweep: 0.85
}
// Lo mas largo de una frase: se lee en un globo y se dice en un respiro.
export const MAX_WORDS = 8
export const MAX_CHARS = 60
// Vida por debajo de la cual hablan de monster_low y player_low.
export const LOW = 0.3

// Como habla cada uno. voice: el pedido para ElevenLabs Voice Design (genero,
// edad, timbre, acento, ritmo) y los ajustes de la voz al generar (speed de 0,7
// a 1,2; stability de 0 a 1). color: el borde del globo.
export const MONSTERS = {
  espectro: {
    name: ['Spectre', 'Espectro'],
    personality: 'A bored, sarcastic ghost that arrived by update and haunts out of spite.',
    color: '#7ff8ff',
    voice: {
      gender: 'female',
      age: 'ageless, sounds like a young adult',
      timbre: 'airy, breathy whisper with a faint ghostly echo',
      accent: 'soft British',
      pace: 'slow and drifting',
      speed: 0.9,
      stability: 0.45
    }
  },
  mosquito: {
    name: ['Mosquito', 'Mosquito'],
    personality: 'A tiny, whiny bloodsucker who thinks the hero is an all-you-can-eat buffet.',
    color: '#e05ad0',
    voice: {
      gender: 'male',
      age: 'young, childish',
      timbre: 'tiny, high-pitched, nasal and whiny with a buzzing edge',
      accent: 'neutral American',
      pace: 'fast and jittery',
      speed: 1.15,
      stability: 0.3
    }
  },
  golem: {
    name: ['Golem', 'Golem'],
    personality: 'A slow stone guardian, very proud of how far its arm reaches.',
    color: '#b2a174',
    voice: {
      gender: 'male',
      age: 'ancient',
      timbre: 'very deep, gravelly, grinding like rocks, monotone',
      accent: 'neutral',
      pace: 'very slow, long pauses between words',
      speed: 0.75,
      stability: 0.8
    }
  },
  barbarian_raider: {
    name: ['Barbarian raider', 'Saqueador barbaro'],
    personality: 'A loud frontier raider who loves his axe more than people.',
    color: '#d0773a',
    voice: {
      gender: 'male',
      age: 'around 30',
      timbre: 'gruff, rough and shouty, a bit hoarse',
      accent: 'Nordic',
      pace: 'medium, punchy',
      speed: 1.05,
      stability: 0.4
    }
  },
  barbarian_thrower: {
    name: ['Barbarian thrower', 'Lanzador barbaro'],
    personality: 'A cocky javelin thrower who taunts from behind the palisade.',
    color: '#d8c090',
    voice: {
      gender: 'male',
      age: 'early 20s',
      timbre: 'gruff but nasal, mocking and cheeky',
      accent: 'Nordic',
      pace: 'quick',
      speed: 1.1,
      stability: 0.4
    }
  },
  barbarian_chief: {
    name: ['Barbarian chief', 'Caudillo barbaro'],
    personality: 'The camp chief, covered in stolen trophies, who wants yours too.',
    color: '#c0392b',
    voice: {
      gender: 'male',
      age: 'around 50',
      timbre: 'booming, deep and gravelly, commanding',
      accent: 'Nordic',
      pace: 'slow and heavy',
      speed: 0.9,
      stability: 0.6
    }
  },
  slime: {
    name: ['Slime', 'Slime'],
    personality: 'A weak, cheerful blob that just wants a hug (and to digest you).',
    color: '#6fdc6f',
    voice: {
      gender: 'neutral',
      age: 'childlike',
      timbre: 'bubbly, wet and gurgly, squishy and sweet',
      accent: 'neutral American',
      pace: 'bouncy, medium fast',
      speed: 1.1,
      stability: 0.35
    }
  },
  skeleton: {
    name: ['Skeleton', 'Esqueleto'],
    personality: 'A reanimated crypt guard on an eternal night shift, tired and deadpan.',
    color: '#e8e2c8',
    voice: {
      gender: 'male',
      age: 'middle-aged',
      timbre: 'hollow, dry and raspy, rattly, deadpan',
      accent: 'neutral American',
      pace: 'moderate, bored',
      speed: 0.95,
      stability: 0.55
    }
  },
  skeleton_knight: {
    name: ['Skeleton knight', 'Caballero esqueleto'],
    personality: 'A rusted knight whose oath outlived his flesh: formal and honorable.',
    color: '#9aa4b0',
    voice: {
      gender: 'male',
      age: 'old',
      timbre: 'hollow and raspy with a metallic echo, dignified',
      accent: 'old English, formal',
      pace: 'measured',
      speed: 0.9,
      stability: 0.7
    }
  },
  skeleton_archer: {
    name: ['Skeleton archer', 'Arquero esqueleto'],
    personality: 'A sniper of the burial halls who counts every arrow out loud.',
    color: '#d8c090',
    voice: {
      gender: 'male',
      age: 'adult',
      timbre: 'thin, hollow and raspy, a sly whisper',
      accent: 'neutral',
      pace: 'precise and calm',
      speed: 0.95,
      stability: 0.6
    }
  },
  skeleton_elite: {
    name: ['Elite skeleton', 'Esqueleto de elite'],
    personality: 'The black guard of the skeleton king: cold, zealous, military.',
    color: '#5a5f78',
    voice: {
      gender: 'male',
      age: 'adult',
      timbre: 'deep, hollow and raspy, a clipped military bark',
      accent: 'neutral',
      pace: 'clipped and fast',
      speed: 1.0,
      stability: 0.7
    }
  },
  skeleton_king: {
    name: ['Skeleton king', 'Rey esqueleto'],
    personality: 'The undead sovereign of the third level: theatrical, vain and grand.',
    color: '#e8b84a',
    voice: {
      gender: 'male',
      age: 'very old',
      timbre: 'hollow, raspy and regal, theatrical, echoing in a throne room',
      accent: 'posh British',
      pace: 'slow and grandiose',
      speed: 0.9,
      stability: 0.45
    }
  },
  colossus: {
    name: ['Colossus', 'Coloso'],
    personality: 'An ancient stone guardian woken by a cracked rune: speaks like a landslide.',
    color: '#ff9a40',
    voice: {
      gender: 'male',
      age: 'ancient, timeless',
      timbre: 'huge, extremely deep, rumbling like an earthquake, booming',
      accent: 'neutral',
      pace: 'very slow, heavy pauses',
      speed: 0.75,
      stability: 0.8
    }
  }
}

// Las frases: [ingles, castellano].
export const LINES = {
  espectro: {
    contact: [
      ['Boo. Did I startle you? Good.', 'Bu. ¿Te asusté? Perfecto.'],
      ['You never see me coming.', 'Nunca me ves venir.'],
      ['Another visitor. How tiresome.', 'Otra visita. Qué fastidio.'],
      ['I arrived by update. You leave by coffin.', 'Llegué por actualización. Te vas en ataúd.']
    ],
    monster_hits: [
      ["Cold, isn't it?", 'Frío, ¿verdad?'],
      ['Felt that in your soul?', '¿Lo sentiste en el alma?'],
      ['From nowhere, as always.', 'De la nada, como siempre.']
    ],
    monster_hurt: [
      ['You hit... nothing. Mostly.', 'Le pegaste... a nada. Casi.'],
      ['Rude. I was haunting.', 'Grosero. Estaba embrujando.'],
      ['That tickles the afterlife.', 'Eso le hace cosquillas al más allá.']
    ],
    monster_low: [
      ['I am fading... dramatically.', 'Me desvanezco... con drama.'],
      ['Not again. I just came back.', 'Otra vez no. Recién resucité.'],
      ['My ectoplasm is leaking.', 'Se me escapa el ectoplasma.']
    ],
    player_low: [
      ["Soon you'll haunt with me.", 'Pronto embrujarás conmigo.'],
      ['Your light flickers, mortal.', 'Tu luz titila, mortal.'],
      ['Join the ghost club.', 'Únete al club fantasma.']
    ],
    player_potion: [
      ['Potions? So very alive of you.', '¿Pociones? Qué cosa de vivos.'],
      ["Drink up. It won't help.", 'Bebe. No te servirá.'],
      ['Mortals and their little bottles.', 'Los mortales y sus frasquitos.']
    ],
    player_guard: [
      ['Shields stop swords, not ghosts.', 'Los escudos no paran fantasmas.'],
      ['Hide all you like.', 'Escóndete cuanto quieras.'],
      ['I pass through walls, dear.', 'Atravieso paredes, querido.']
    ],
    player_retreat: [
      ['Running? I float faster.', '¿Huyes? Yo floto más rápido.'],
      ["I'll haunt your dreams instead.", 'Embrujaré tus sueños, entonces.'],
      ['Leaving so soon? Boring.', '¿Ya te vas? Aburrido.']
    ],
    monster_death: [
      ["I'll be back next patch.", 'Vuelvo en el próximo parche.'],
      ['Finally, some peace.', 'Por fin, algo de paz.'],
      ['Ooooh... how original.', 'Uuuh... qué original.'],
      ['Tell the update I tried.', 'Dile a la actualización que lo intenté.']
    ]
  },
  mosquito: {
    contact: [
      ['Bzzz! Lunch has legs today!', '¡Bzzz! ¡Hoy el almuerzo camina!'],
      ['Ooh, fresh blood! My favorite!', '¡Uy, sangre fresca! ¡Mi favorita!'],
      ["Hold still, I'm thirsty!", '¡Quieto, que tengo sed!'],
      ["Bzz, don't swat, just share!", '¡Bzz, no me aplastes, comparte!']
    ],
    monster_hits: [
      ['Slurp! Tasty!', '¡Slurp! ¡Rico!'],
      ['Bzz! Gotcha, buffet!', '¡Bzz! ¡Te pillé, bufé!'],
      ['Itchy now? Good!', '¿Te pica? ¡Bien!']
    ],
    monster_hurt: [
      ['Ow! My wings!', '¡Ay! ¡Mis alitas!'],
      ['Hey! Rude! Bzz!', '¡Oye! ¡Grosero! ¡Bzz!'],
      ['Missed me! Wait, no. Ow.', '¡Fallaste! Ah, no. Ay.']
    ],
    monster_low: [
      ['Bzz... running on empty...', 'Bzz... me quedo sin pila...'],
      ['Just one more sip, please!', '¡Un sorbito más, porfa!'],
      ['My buzz is fading!', '¡Se me apaga el zumbido!']
    ],
    player_low: [
      ["You're almost a juice box!", '¡Ya casi eres un juguito!'],
      ['Bzz! Dessert time!', '¡Bzz! ¡Hora del postre!'],
      ['Slow and tasty, perfect!', '¡Lento y sabroso, perfecto!']
    ],
    player_potion: [
      ['Ooh, flavored blood!', '¡Uy, sangre saborizada!'],
      ["Drink more, I'll drink you!", '¡Bebe más, yo te bebo a ti!'],
      ['Refilling the buffet? Thanks!', '¿Rellenas el bufé? ¡Gracias!']
    ],
    player_guard: [
      ["I'll find a gap! Bzz!", '¡Encontraré un hueco! ¡Bzz!'],
      ["Shields don't stop the itch!", '¡El escudo no quita la picazón!'],
      ['Peekaboo! Bzz!', '¡Te veo! ¡Bzz!']
    ],
    player_retreat: [
      ['Come back, snack!', '¡Vuelve, bocadito!'],
      ['I fly faster! Bzz!', '¡Vuelo más rápido! ¡Bzz!'],
      ["You can't outrun a buzz!", '¡Nadie le gana a un zumbido!']
    ],
    monster_death: [
      ['Bzz... splat.', 'Bzz... plaf.'],
      ['Tell my thousand kids... bzz.', 'Díganle a mis mil hijos... bzz.'],
      ['Worth it. Tasty.', 'Valió la pena. Rico.'],
      ['Not the face!', '¡En la cara no!']
    ]
  },
  golem: {
    contact: [
      ['You... are... in... range.', 'Estás... a... mi... alcance.'],
      ['Stone... remembers... intruders.', 'La piedra... recuerda... intrusos.'],
      ['My arm... reaches... far.', 'Mi brazo... llega... lejos.'],
      ['Crossbow... will not... save you.', 'La ballesta... no... te salvará.']
    ],
    monster_hits: [
      ['Rock... beats... you.', 'Piedra... gana... a ti.'],
      ['Long... arm... strikes.', 'Brazo... largo... golpea.'],
      ['Feel... the... boulder.', 'Siente... la... roca.']
    ],
    monster_hurt: [
      ['Pebble... chipped.', 'Piedrita... rota.'],
      ['That... was... my... good... side.', 'Ese... era... mi... lado... bueno.'],
      ['Hm. Gravel.', 'Hm. Grava.']
    ],
    monster_low: [
      ['Crumbling... slowly... like... me.', 'Me... desmorono... despacio.'],
      ['Need... more... rocks.', 'Necesito... más... rocas.'],
      ['Cracks... everywhere.', 'Grietas... por... todos... lados.']
    ],
    player_low: [
      ['You... soft... like... sand.', 'Eres... blando... como... arena.'],
      ['Flesh... breaks... easy.', 'La carne... se rompe... fácil.'],
      ['Almost... flat.', 'Casi... aplastado.']
    ],
    player_potion: [
      ['Drink... fast... I... wait.', 'Bebe... rápido... espero.'],
      ['Potion... not... stone.', 'Poción... no... es... piedra.'],
      ['Healing... is... cheating.', 'Curarse... es... trampa.']
    ],
    player_guard: [
      ['Shield... meet... mountain.', 'Escudo... conoce... montaña.'],
      ['Block... all... day.', 'Bloquea... todo... el... día.'],
      ['Patience... is... stone.', 'La paciencia... es... piedra.']
    ],
    player_retreat: [
      ['Run. My... arm... still... reaches.', 'Corre. Mi... brazo... igual... llega.'],
      ['Go. Rocks... wait... forever.', 'Vete. Las rocas... esperan... siempre.'],
      ['Far... is... still... range.', 'Lejos... sigue... en... alcance.']
    ],
    monster_death: [
      ['Back... to... gravel.', 'Vuelvo... a... ser... grava.'],
      ['Finally... rest.', 'Por fin... descanso.'],
      ['Tell... the... mountain...', 'Díganle... a... la... montaña...'],
      ['Crumble... time.', 'Hora... de... desmoronarse.']
    ]
  },
  barbarian_raider: {
    contact: [
      ['Fresh meat for my axe!', '¡Carne fresca para mi hacha!'],
      ['Your gold, or your head!', '¡Tu oro o tu cabeza!'],
      ['Ha! A soft one from town!', '¡Ja! ¡Uno blandito de la ciudad!'],
      ['Axe says hello!', '¡El hacha te saluda!']
    ],
    monster_hits: [
      ['Chop chop!', '¡Tajo y tajo!'],
      ['Ha! Felt the axe?', '¡Ja! ¿Sentiste el hacha?'],
      ["That's how we greet!", '¡Así saludamos aquí!']
    ],
    monster_hurt: [
      ['Ha! Barely a scratch!', '¡Ja! ¡Apenas un rasguño!'],
      ['Good hit! Do it again!', '¡Buen golpe! ¡Otra vez!'],
      ["Grr! Now I'm angry!", '¡Grr! ¡Ahora sí me enojé!']
    ],
    monster_low: [
      ['Not... done... yet!', '¡Todavía... no... termino!'],
      ['Bleeding is for cowards! Ugh!', '¡Sangrar es de cobardes! ¡Uf!'],
      ['Need... a bigger axe.', 'Necesito... un hacha más grande.']
    ],
    player_low: [
      ["You're wobbling, townie!", '¡Te tambaleas, ciudadano!'],
      ["Kneel and I'll be quick!", '¡Arrodíllate y seré rápido!'],
      ['Your boots look my size!', '¡Tus botas son de mi talla!']
    ],
    player_potion: [
      ['Drinking already? Ha!', '¿Ya bebiendo? ¡Ja!'],
      ['Save some for me!', '¡Déjame un trago!'],
      ['Potions are for the weak!', '¡Las pociones son para débiles!']
    ],
    player_guard: [
      ['Hide behind that plank!', '¡Escóndete tras esa tabla!'],
      ['My axe loves shields!', '¡A mi hacha le encantan los escudos!'],
      ['Knock knock, townie!', '¡Toc toc, ciudadano!']
    ],
    player_retreat: [
      ['Run home to mommy!', '¡Corre a casa con mamá!'],
      ['Ha! Look at it run!', '¡Ja! ¡Miren cómo corre!'],
      ['Leave the gold behind!', '¡Deja el oro aquí!']
    ],
    monster_death: [
      ['Tell the chief... I tried...', 'Díganle al jefe... que lo intenté...'],
      ['Good fight... townie...', 'Buena pelea... ciudadano...'],
      ['My axe... take care of it.', 'Mi hacha... cuídala.'],
      ['Ugh... the frost takes me.', 'Uf... me lleva la escarcha.']
    ]
  },
  barbarian_thrower: {
    contact: [
      ['Target spotted! Stand still!', '¡Blanco a la vista! ¡No te muevas!'],
      ['From the palisade, with love!', '¡Desde la empalizada, con cariño!'],
      ['I never miss! Mostly!', '¡Nunca fallo! ¡Casi nunca!'],
      ['Javelin for the tourist!', '¡Jabalina para el turista!']
    ],
    monster_hits: [
      ['Bullseye!', '¡En el blanco!'],
      ['Ha! Pinned like a pelt!', '¡Ja! ¡Clavado como un cuero!'],
      ['Did you catch that?', '¿La atajaste?']
    ],
    monster_hurt: [
      ['Hey! Not fair, up close!', '¡Eh! ¡De cerca no vale!'],
      ['Ow! Back off!', '¡Ay! ¡Aléjate!'],
      ['My throwing arm!', '¡Mi brazo de lanzar!']
    ],
    monster_low: [
      ['Running out of javelins!', '¡Me quedo sin jabalinas!'],
      ['Chief! A little help?', '¡Jefe! ¿Una ayudita?'],
      ['Okay, maybe I miss sometimes.', 'Bueno, a veces fallo.']
    ],
    player_low: [
      ["One more and you're a pincushion!", '¡Una más y eres alfiletero!'],
      ['Easy target now!', '¡Ahora eres fácil!'],
      ['Hold still, almost done!', '¡Quieto, ya casi!']
    ],
    player_potion: [
      ["I'll aim for the bottle!", '¡Le apunto a la botella!'],
      ["Drink fast, I'm reloading!", '¡Bebe rápido, estoy recargando!'],
      ['A potion? Cute.', '¿Una poción? Qué tierno.']
    ],
    player_guard: [
      ["I'll throw around it!", '¡Tiro por el costado!'],
      ['Nice shield. Good target.', 'Lindo escudo. Buen blanco.'],
      ['Peek out, I dare you!', '¡Asómate, te reto!']
    ],
    player_retreat: [
      ['Running targets are my favorite!', '¡Me encantan los blancos que corren!'],
      ['I can throw far, you know!', '¡Tiro lejos, eh!'],
      ["Bye! Here's a souvenir!", '¡Chau! ¡Llévate un recuerdo!']
    ],
    monster_death: [
      ["Should've... thrown... harder...", 'Debí... tirar... más fuerte...'],
      ['Out of... javelins...', 'Sin... jabalinas...'],
      ['Tell the chief... I missed.', 'Díganle al jefe... que fallé.'],
      ['Not... my best throw.', 'No fue... mi mejor tiro.']
    ]
  },
  barbarian_chief: {
    contact: [
      ['Another trophy walks into my camp.', 'Otro trofeo entra a mi campamento.'],
      ["Kneel, and I'll keep your skull clean.", 'Arrodíllate y cuidaré tu cráneo.'],
      ['Your armor will look good on me.', 'Tu armadura me quedará bien.'],
      ['I am the law past the palisade!', '¡Tras la empalizada, la ley soy yo!']
    ],
    monster_hits: [
      ['Feel the weight of command!', '¡Siente el peso del mando!'],
      ["That's a chief's blow!", '¡Ese es un golpe de jefe!'],
      ['Bow, little one!', '¡Inclínate, pequeño!']
    ],
    monster_hurt: [
      ['Bold. I like bold trophies.', 'Audaz. Me gustan los trofeos audaces.'],
      ["Hmph. You'll pay for that.", 'Hmph. Eso lo pagarás.'],
      ['You dent my stolen plate!', '¡Abollas mi placa robada!']
    ],
    monster_low: [
      ['A chief does not fall!', '¡Un jefe no cae!'],
      ['To me, warriors! To me!', '¡A mí, guerreros! ¡A mí!'],
      ['You... are worth a song.', 'Tú... mereces una canción.']
    ],
    player_low: [
      ['Your skull goes on my belt.', 'Tu cráneo irá en mi cinturón.'],
      ["Yield. I'll make it quick.", 'Ríndete. Seré rápido.'],
      ['The camp will feast tonight!', '¡Esta noche el campamento festeja!']
    ],
    player_potion: [
      ['Drink. Make the trophy shinier.', 'Bebe. Que el trofeo brille más.'],
      ["Potions won't save your skull.", 'Las pociones no salvan tu cráneo.'],
      ['Ha! Liquid courage!', '¡Ja! ¡Valor embotellado!']
    ],
    player_guard: [
      ["I've broken better shields!", '¡He roto escudos mejores!'],
      ['Hide. I will knock.', 'Escóndete. Yo tocaré la puerta.'],
      ['That shield joins my collection!', '¡Ese escudo va a mi colección!']
    ],
    player_retreat: [
      ['Run, and tell them who I am!', '¡Corre y diles quién soy!'],
      ['Cowards leave their gold!', '¡Los cobardes dejan su oro!'],
      ['The camp remembers runners.', 'El campamento recuerda a los que huyen.']
    ],
    monster_death: [
      ['Take... my trophies... you earned them.', 'Toma... mis trofeos... te los ganaste.'],
      ['The camp... is yours...', 'El campamento... es tuyo...'],
      ['Sing of me... trophy hunter.', 'Canta sobre mí... cazador de trofeos.'],
      ['A worthy... end.', 'Un final... digno.']
    ]
  },
  slime: {
    contact: [
      ['Hiii! Wanna be friends? Blorp!', '¡Holaaa! ¿Amigos? ¡Blorp!'],
      ['A hug! Gimme a hug!', '¡Un abrazo! ¡Dame un abrazo!'],
      ['Squish squish, here I come!', '¡Plish plash, allá voy!'],
      ['You smell like snacks!', '¡Hueles a merienda!']
    ],
    monster_hits: [
      ['Sticky hug!', '¡Abrazo pegajoso!'],
      ['Blorp! Gotcha!', '¡Blorp! ¡Te atrapé!'],
      ["Now you're gooey too!", '¡Ahora tú también eres viscoso!']
    ],
    monster_hurt: [
      ["Ow! I'm jelly, not a drum!", '¡Ay! ¡Soy gelatina, no tambor!'],
      ['Splat! Rude!', '¡Plaf! ¡Malo!'],
      ['You split my goo!', '¡Me partiste la baba!']
    ],
    monster_low: [
      ["I'm melting... help...", 'Me derrito... ayuda...'],
      ['Just a puddle now...', 'Ya soy un charquito...'],
      ['Blorp... not feeling bouncy.', 'Blorp... ya no reboto.']
    ],
    player_low: [
      ['You look tired! Nap in me!', '¡Te ves cansado! ¡Duerme en mí!'],
      ['Almost digested! Yay!', '¡Casi digerido! ¡Yupi!'],
      ['Wobbly, like me!', '¡Tembloroso, como yo!']
    ],
    player_potion: [
      ['Ooh, can I have some?', '¡Uy! ¿Me convidas?'],
      ['Juice! I love juice!', '¡Jugo! ¡Amo el jugo!'],
      ['Share, share, share!', '¡Comparte, comparte!']
    ],
    player_guard: [
      ["I'll just ooze around it!", '¡Me escurro por el costado!'],
      ['Shields are sticky now!', '¡Ahora el escudo está pegajoso!'],
      ['Hide and seek! Blorp!', '¡A las escondidas! ¡Blorp!']
    ],
    player_retreat: [
      ["Wait! Don't leave me!", '¡Espera! ¡No me dejes!'],
      ["I'm slow but I'm clingy!", '¡Soy lento, pero pegajoso!'],
      ['Come back for hugs!', '¡Vuelve por abrazos!']
    ],
    monster_death: [
      ['Blorp... bye-bye...', 'Blorp... chau chau...'],
      ['Mop me up later...', 'Después me limpian...'],
      ['I just wanted... a hug...', 'Solo quería... un abrazo...'],
      ['Splorch.', 'Splorch.']
    ]
  },
  skeleton: {
    contact: [
      ["Halt. Crypt's closed. Forever.", 'Alto. La cripta cerró. Para siempre.'],
      ['Night shift again. Great.', 'Otra vez turno noche. Genial.'],
      ['Who goes there? Never mind.', '¿Quién anda ahí? No importa.'],
      ['No visitors past this tomb.', 'Prohibido pasar de esta tumba.']
    ],
    monster_hits: [
      ['Rattle rattle, gotcha.', 'Traca traca, te di.'],
      ['Bone to pick with you.', 'Te tenía un hueso guardado.'],
      ['Clocked in. Clocked you.', 'Fiché entrada. Y a ti.']
    ],
    monster_hurt: [
      ['Hey, I need that rib.', 'Eh, esa costilla la uso.'],
      ['Ow. Phantom pain.', 'Ay. Dolor fantasma.'],
      ["Rude. I'm on duty.", 'Grosero. Estoy de guardia.']
    ],
    monster_low: [
      ['Falling apart here...', 'Me estoy desarmando...'],
      ["Where'd my femur go?", '¿Dónde quedó mi fémur?'],
      ['Not paid enough for this.', 'No me pagan para esto.']
    ],
    player_low: [
      ["You'll make a fine skeleton.", 'Serás un buen esqueleto.'],
      ['Room for one more down here.', 'Aquí abajo hay lugar.'],
      ['Almost my coworker.', 'Ya casi eres mi colega.']
    ],
    player_potion: [
      ['Must be nice, having a throat.', 'Qué suerte tener garganta.'],
      ['Potions. Living people stuff.', 'Pociones. Cosas de vivos.'],
      ["Drink. I'll wait. Forever.", 'Bebe. Espero. Para siempre.']
    ],
    player_guard: [
      ['Shields. Classic.', 'Escudos. Un clásico.'],
      ["I've got all eternity.", 'Tengo toda la eternidad.'],
      ['Knock knock on your shield.', 'Toc toc en tu escudo.']
    ],
    player_retreat: [
      ['Fine. Less paperwork.', 'Bien. Menos papeleo.'],
      ["Run. I'll be here. Always.", 'Corre. Aquí estaré. Siempre.'],
      ["Don't come back. Please.", 'No vuelvas. Por favor.']
    ],
    monster_death: [
      ['Finally... clocking out.', 'Por fin... termina mi turno.'],
      ['Rest in pieces.', 'Descanso en pedazos.'],
      ['Tell the king... I quit.', 'Díganle al rey... que renuncio.'],
      ['Clatter.', 'Clac, clac.']
    ]
  },
  skeleton_knight: {
    contact: [
      ['Draw thy blade, intruder.', 'Desenvaina, intruso.'],
      ['My oath outlived my flesh.', 'Mi juramento sobrevivió a mi carne.'],
      ['Halt. Thou shalt not pass.', 'Alto. No pasarás.'],
      ['Face me with honor.', 'Enfréntame con honor.']
    ],
    monster_hits: [
      ['A clean strike. Learn from it.', 'Un golpe limpio. Aprende.'],
      ['Discipline cuts deeper.', 'La disciplina corta más hondo.'],
      ['Steel never forgets.', 'El acero nunca olvida.']
    ],
    monster_hurt: [
      ['A fair hit. Again.', 'Golpe justo. Otra vez.'],
      ['My armor rusts, not my will.', 'Se oxida mi armadura, no mi voluntad.'],
      ['Well struck, knight.', 'Bien golpeado, caballero.']
    ],
    monster_low: [
      ['I shall not yield.', 'No me rendiré.'],
      ['My shield... holds... still.', 'Mi escudo... aún... resiste.'],
      ['A knight stands till the end.', 'Un caballero resiste hasta el final.']
    ],
    player_low: [
      ['Yield, and keep thy honor.', 'Ríndete y conserva tu honor.'],
      ['Thy guard falters.', 'Tu guardia flaquea.'],
      ['Kneel. There is no shame.', 'Arrodíllate. No hay vergüenza.']
    ],
    player_potion: [
      ['Mend thyself. I shall wait.', 'Cúrate. Esperaré.'],
      ['A fair pause. Drink.', 'Una pausa justa. Bebe.'],
      ['Restore thyself, then fight.', 'Recupérate y luego pelea.']
    ],
    player_guard: [
      ['A proper guard. Good form.', 'Buena guardia. Buena forma.'],
      ['Shield to shield, then.', 'Escudo contra escudo, entonces.'],
      ['Defense is a virtue.', 'La defensa es una virtud.']
    ],
    player_retreat: [
      ['Retreat is no dishonor.', 'Retirarse no es deshonra.'],
      ['Go. Return stronger.', 'Ve. Vuelve más fuerte.'],
      ['The crypt shall await thee.', 'La cripta te esperará.']
    ],
    monster_death: [
      ['My watch... is ended.', 'Mi guardia... ha terminado.'],
      ['Well fought... knight.', 'Bien peleado... caballero.'],
      ['At last... release.', 'Al fin... libertad.'],
      ['Tell my king... I held.', 'Dile a mi rey... que resistí.']
    ]
  },
  skeleton_archer: {
    contact: [
      ['Seen you. Since the stairs.', 'Te vi. Desde la escalera.'],
      ['One arrow. One count.', 'Una flecha. Una cuenta.'],
      ['Stay in the light, please.', 'Quédate en la luz, por favor.'],
      ['From the back row, hello.', 'Desde el fondo, hola.']
    ],
    monster_hits: [
      ['Thirty-two.', 'Treinta y dos.'],
      ['Arrow found its home.', 'La flecha encontró su casa.'],
      ['Right where I counted.', 'Justo donde conté.']
    ],
    monster_hurt: [
      ['Up close? How vulgar.', '¿De cerca? Qué vulgar.'],
      ['My bowstring! Careful!', '¡Mi cuerda! ¡Cuidado!'],
      ["That's not in my count.", 'Eso no estaba en mi cuenta.']
    ],
    monster_low: [
      ["Quiver's... almost empty.", 'La aljaba... casi vacía.'],
      ['Lost count. Bad sign.', 'Perdí la cuenta. Mala señal.'],
      ['Need distance. Lots.', 'Necesito distancia. Mucha.']
    ],
    player_low: [
      ["One more. Then I'm done counting.", 'Una más. Y dejo de contar.'],
      ["You're slowing. Easier shot.", 'Vas más lento. Tiro fácil.'],
      ['Hold that pose.', 'Quédate así.']
    ],
    player_potion: [
      ["Bottle's a nice target.", 'La botella es buen blanco.'],
      ['Drinking? Aiming.', '¿Bebiendo? Apuntando.'],
      ['Heal up. More to count.', 'Cúrate. Más para contar.']
    ],
    player_guard: [
      ['Shields have edges.', 'Los escudos tienen bordes.'],
      ['I can wait for a gap.', 'Puedo esperar un hueco.'],
      ['Arrows bend. Kind of.', 'Las flechas doblan. Más o menos.']
    ],
    player_retreat: [
      ['Moving target. Fun.', 'Blanco móvil. Divertido.'],
      ['Running is still in range.', 'Corriendo sigues en rango.'],
      ['Leaving? Pity.', '¿Te vas? Lástima.']
    ],
    monster_death: [
      ['Final... count...', 'Cuenta... final...'],
      ["Should've stayed... in the back.", 'Debí quedarme... al fondo.'],
      ['Out of... arrows...', 'Sin... flechas...'],
      ['Miss... noted.', 'Fallo... anotado.']
    ]
  },
  skeleton_elite: {
    contact: [
      ['Black Guard. Halt and die.', 'Guardia Negra. Alto y muere.'],
      ['The king sees all intruders.', 'El rey ve a todo intruso.'],
      ['Formation! Engage!', '¡Formación! ¡Al ataque!'],
      ['You will not reach the throne.', 'No llegarás al trono.']
    ],
    monster_hits: [
      ['For the king!', '¡Por el rey!'],
      ['Strike. Advance. Repeat.', 'Golpe. Avance. Repetir.'],
      ['Obey the blade.', 'Obedece a la hoja.']
    ],
    monster_hurt: [
      ['Pain is for the living.', 'El dolor es para los vivos.'],
      ['Noted. Retaliating.', 'Anotado. Respondo.'],
      ['The Guard does not flinch.', 'La Guardia no se inmuta.']
    ],
    monster_low: [
      ['Hold the line!', '¡Mantengan la línea!'],
      ['The king... must be warned.', 'Hay que... avisar al rey.'],
      ['Guard... never... breaks.', 'La Guardia... nunca... cae.']
    ],
    player_low: [
      ['Surrender to the crown.', 'Ríndete ante la corona.'],
      ['Your march ends here.', 'Tu marcha termina aquí.'],
      ['The throne room awaits your bones.', 'El trono espera tus huesos.']
    ],
    player_potion: [
      ['Potions are contraband.', 'Las pociones son contrabando.'],
      ['Drink. It changes nothing.', 'Bebe. No cambia nada.'],
      ['Confiscated. Eventually.', 'Confiscada. Tarde o temprano.']
    ],
    player_guard: [
      ['Break their guard!', '¡Rompan su guardia!'],
      ['Defense noted. Adjusting.', 'Defensa anotada. Ajustando.'],
      ['Shields fall like kingdoms.', 'Los escudos caen como reinos.']
    ],
    player_retreat: [
      ['Retreat logged. Pursue!', 'Retirada registrada. ¡A perseguir!'],
      ['Desertion is punishable.', 'La deserción se castiga.'],
      ['Run to your kingdom, peasant.', 'Corre a tu reino, plebeyo.']
    ],
    monster_death: [
      ['Long live... the king...', 'Larga vida... al rey...'],
      ['Guard... falls...', 'La Guardia... cae...'],
      ['My king... forgive me.', 'Mi rey... perdóname.'],
      ['Line... broken...', 'Línea... rota...']
    ]
  },
  skeleton_king: {
    contact: [
      ['Kneel before your eternal king!', '¡Arrodíllate ante tu rey eterno!'],
      ['A visitor! How delightfully doomed.', '¡Una visita! Qué deliciosamente condenada.'],
      ['Welcome to my court, worm.', 'Bienvenido a mi corte, gusano.'],
      ['I have waited centuries for applause.', 'Esperé siglos por un aplauso.']
    ],
    monster_hits: [
      ['Royal decree: pain!', '¡Decreto real: dolor!'],
      ['Bow, when struck by royalty!', '¡Inclínate ante el golpe real!'],
      ["Magnificent, wasn't it?", 'Magnífico, ¿verdad?']
    ],
    monster_hurt: [
      ['Treason! Against my crown!', '¡Traición! ¡Contra mi corona!'],
      ['You scratched the royal bones!', '¡Rayaste los huesos reales!'],
      ['How dare you, peasant!', '¡Cómo te atreves, plebeyo!']
    ],
    monster_low: [
      ['My kingdom... for a femur!', '¡Mi reino... por un fémur!'],
      ['Guards! Guards? Anyone?', '¡Guardias! ¿Guardias? ¿Alguien?'],
      ['A king cannot fall... can he?', 'Un rey no cae... ¿o sí?']
    ],
    player_low: [
      ['Your crown of bones awaits!', '¡Tu corona de huesos te espera!'],
      ['Join my court, forever!', '¡Únete a mi corte, para siempre!'],
      ['The audience is almost over.', 'La audiencia casi termina.']
    ],
    player_potion: [
      ['Drink, jester. Entertain me longer.', 'Bebe, bufón. Entretenme más.'],
      ['Potions in my throne room? Tacky.', '¿Pociones en mi trono? Qué vulgar.'],
      ['Yes, prolong the show!', '¡Sí, alarga la función!']
    ],
    player_guard: [
      ['Cowering before royalty? Fitting.', '¿Te encoges ante la realeza? Apropiado.'],
      ['Hide behind that shield, subject.', 'Escóndete tras el escudo, súbdito.'],
      ['Shields bore me. Attack!', 'Los escudos me aburren. ¡Ataca!']
    ],
    player_retreat: [
      ['Did I dismiss you?', '¿Te di permiso para irte?'],
      ['Leaving the court? Rude!', '¿Dejas la corte? ¡Qué grosero!'],
      ['Run! Tell them of my glory!', '¡Corre! ¡Cuenta mi gloria!']
    ],
    monster_death: [
      ['The king... is dead...', 'El rey... ha muerto...'],
      ['Long live... me...', 'Larga vida... a mí...'],
      ['My crown... polish it.', 'Mi corona... lústrala.'],
      ['Curtain... falls...', 'Cae... el telón...']
    ]
  },
  colossus: {
    contact: [
      ['Who... wakes... the stone?', '¿Quién... despierta... a la piedra?'],
      ['The rune... calls... for you.', 'La runa... te... llama.'],
      ['Small... thing. Step... closer.', 'Cosa... pequeña. Acércate.'],
      ['I have... guarded... a thousand years.', 'He... custodiado... mil años.']
    ],
    monster_hits: [
      ['Feel... the mountain.', 'Siente... la montaña.'],
      ['Dust... to dust.', 'Polvo... al polvo.'],
      ['The earth... answers.', 'La tierra... responde.']
    ],
    monster_hurt: [
      ['A pebble... stings.', 'Una piedrita... pica.'],
      ['You... chip... at eternity.', 'Raspas... la eternidad.'],
      ['Hmm... bold.', 'Mmm... audaz.']
    ],
    monster_low: [
      ['My core... is... exposed.', 'Mi núcleo... queda... expuesto.'],
      ['The rune... flickers...', 'La runa... titila...'],
      ['Stone... can... break.', 'La piedra... puede... romperse.']
    ],
    player_low: [
      ['Your flame... grows... small.', 'Tu llama... se achica.'],
      ['Lie down... in... the ash.', 'Acuéstate... en... la ceniza.'],
      ['Little... one... falls.', 'El pequeño... cae.']
    ],
    player_potion: [
      ['Drink... it changes... nothing.', 'Bebe... no cambia... nada.'],
      ['Mortal... remedies...', 'Remedios... de mortales...'],
      ['Heal... I... am patient.', 'Cúrate... soy... paciente.']
    ],
    player_guard: [
      ['Shields... are... sand.', 'Los escudos... son... arena.'],
      ['Hide... the mountain... finds you.', 'Escóndete... la montaña... te encuentra.'],
      ['Brace... yourself.', 'Prepárate.']
    ],
    player_retreat: [
      ['Flee... the stone... remembers.', 'Huye... la piedra... recuerda.'],
      ['Run... the ash... is wide.', 'Corre... la ceniza... es extensa.'],
      ['Go... return... stronger.', 'Vete... vuelve... más fuerte.']
    ],
    monster_death: [
      ['The rune... goes... dark.', 'La runa... se... apaga.'],
      ['At last... I... sleep.', 'Por fin... duermo.'],
      ['Crumbling... to... the sea.', 'Me desmorono... hacia... el mar.'],
      ['Well... struck... small one.', 'Bien... golpeado... pequeño.']
    ],
    windup_slam: [
      ['Fall... upon... you!', '¡Caigo... sobre... ti!'],
      ['Stone... fist... descends!', '¡El puño... de piedra... baja!'],
      ['Feel... the... weight!', '¡Siente... el... peso!']
    ],
    windup_sweep: [
      ['The wave... comes!', '¡Viene... la onda!'],
      ['Sweep... the... ash!', '¡Barro... la... ceniza!'],
      ['Nowhere... to... stand!', '¡No hay... dónde... pararse!']
    ],
    phase_change: [
      [
        'The shell... cracks... the rune... wakes!',
        '¡La coraza... se parte... la runa... despierta!'
      ],
      ['Now... you... see... my core!', '¡Ahora... ves... mi núcleo!'],
      ['Enough... the ground... will shake!', '¡Basta... la tierra... temblará!']
    ],
    defeated: [
      ['Another... thousand... years... of rest.', 'Otros... mil... años... de descanso.'],
      ['Guard... the rune... in my place.', 'Cuida... la runa... en mi lugar.'],
      ['The ash... is... yours now.', 'La ceniza... ahora... es tuya.']
    ]
  }
}

// Los golpes del Coloso (lib/world-boss.js) y el aviso que les toca.
export const BOSS_WINDUP = {
  punio_izquierdo: 'windup_slam',
  punio_derecho: 'windup_slam',
  colapso: 'windup_slam',
  onda: 'windup_sweep',
  barrido: 'windup_sweep'
}

export const MONSTER_IDS = Object.keys(MONSTERS)

export function eventsOf(monster) {
  return monster === BOSS ? BOSS_EVENTS : EVENTS
}

const langIndex = (lang) => (lang === 'es' ? 1 : 0)

/** Las frases de un monstruo para un evento, en un idioma (o una lista vacia). */
export function linesOf(monster, event, lang = 'en') {
  const pairs = LINES[monster] && LINES[monster][event]
  return pairs ? pairs.map((pair) => pair[langIndex(lang)]) : []
}

/** Las palabras de una frase, contadas por los espacios. */
export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length
}

/** El archivo de una frase, relativo a assets/voces/. */
export function fileOf(monster, lang, event, index) {
  return `${monster}/${lang}/${event}-${index + 1}.mp3`
}

/**
 * El pedido de voz para ElevenLabs Voice Design: la personalidad y como suena.
 * Sin nombres de personas ni de marcas.
 */
export function voiceDescription(monster) {
  const entry = MONSTERS[monster]
  if (!entry) return ''
  const v = entry.voice
  return (
    `A fantasy video game monster: ${entry.personality} ` +
    `Voice: ${v.gender}, ${v.age}; ${v.timbre}; ${v.accent} accent; ${v.pace}. ` +
    'Clear diction, studio quality, no background noise.'
  )
}

/** Un texto de muestra de 100 a 1000 caracteres con sus propias frases, para disenar la voz. */
export function sampleText(monster) {
  let text = ''
  for (const event of eventsOf(monster)) {
    for (const line of linesOf(monster, event, 'en')) {
      if (text.length >= 160) break
      text += (text ? ' ' : '') + line
    }
  }
  while (text.length < 100) text += ' ' + text
  return text.slice(0, 1000)
}

/** Todas las frases, una por archivo: monstruo, idioma, evento, numero, texto y archivo. */
export function allLines() {
  const out = []
  for (const monster of MONSTER_IDS) {
    for (const lang of LANGS) {
      for (const event of eventsOf(monster)) {
        linesOf(monster, event, lang).forEach((text, index) => {
          out.push({ monster, lang, event, index, text, file: fileOf(monster, lang, event, index) })
        })
      }
    }
  }
  return out
}

// Un generador chico con semilla (mulberry32): mismos numeros en cada corrida.
export function seeded(seed = 1) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Elige que dice cada monstruo. pick(monster, event, time, lang) devuelve
 * { monster, event, lang, index, text } o null si le toca callarse: espera
 * `cooldown` segundos entre dos frases del mismo monstruo (salvo PRIORITY),
 * algunos eventos hablan solo a veces (CHANCE) y nunca repite la ultima frase
 * del mismo evento.
 */
export function createPicker({ seed = 1, cooldown = COOLDOWN, chance = CHANCE } = {}) {
  const random = seeded(seed)
  const spoke = new Map()
  const lastIndex = new Map()
  const priority = new Set(PRIORITY)

  function pick(monster, event, time, lang = 'en') {
    if (!eventsOf(monster).includes(event)) return null
    const lines = linesOf(monster, event, lang)
    if (!lines.length) return null
    const urgent = priority.has(event)
    const last = spoke.has(monster) ? spoke.get(monster) : -Infinity
    if (!urgent && time - last < cooldown) return null
    const odds = chance[event]
    if (!urgent && odds !== undefined && random() >= odds) return null
    const key = monster + '|' + event
    const before = lastIndex.has(key) ? lastIndex.get(key) : -1
    const choices = lines.map((_, i) => i).filter((i) => i !== before || lines.length === 1)
    const index = choices[Math.floor(random() * choices.length)]
    spoke.set(monster, time)
    lastIndex.set(key, index)
    return { monster, event, lang, index, text: lines[index] }
  }

  function reset() {
    spoke.clear()
    lastIndex.clear()
  }

  return { pick, reset }
}

const FILE = /^[a-z_]+\/(en|es)\/[a-z_]+-\d+\.mp3$/

/**
 * Revisa el manifiesto de los audios. Forma:
 *   { version: 1, model, format,
 *     monsters: { <id>: { voice?, lines: { <lang>: { <evento>: [ { file, text } | null ] } } } } }
 * Devuelve la lista de problemas (vacia si esta bien).
 */
export function validateManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') return ['el manifiesto no es un objeto']
  if (manifest.version !== 1) errors.push('version distinta de 1')
  if (!manifest.monsters || typeof manifest.monsters !== 'object') {
    errors.push('falta monsters')
    return errors
  }
  for (const [monster, entry] of Object.entries(manifest.monsters)) {
    if (!MONSTERS[monster]) {
      errors.push(`monstruo desconocido: ${monster}`)
      continue
    }
    if (!entry || typeof entry.lines !== 'object' || !entry.lines) {
      errors.push(`${monster}: falta lines`)
      continue
    }
    for (const [lang, events] of Object.entries(entry.lines)) {
      if (!LANGS.includes(lang)) {
        errors.push(`${monster}: idioma desconocido ${lang}`)
        continue
      }
      for (const [event, list] of Object.entries(events || {})) {
        if (!eventsOf(monster).includes(event)) {
          errors.push(`${monster}/${lang}: evento desconocido ${event}`)
          continue
        }
        if (!Array.isArray(list)) {
          errors.push(`${monster}/${lang}/${event}: no es una lista`)
          continue
        }
        list.forEach((item, index) => {
          if (item === null) return
          const where = `${monster}/${lang}/${event}/${index}`
          if (!item || typeof item.file !== 'string' || typeof item.text !== 'string') {
            errors.push(`${where}: falta file o text`)
          } else if (!FILE.test(item.file) || item.file !== fileOf(monster, lang, event, index)) {
            errors.push(`${where}: archivo inesperado ${item.file}`)
          }
        })
      }
    }
  }
  return errors
}

/**
 * El mp3 de una frase segun el manifiesto, o null: si no esta, o si el texto
 * cambio desde que se genero (entonces solo va el globo).
 */
export function audioFor(manifest, line) {
  if (!manifest || !manifest.monsters || !line) return null
  const entry = manifest.monsters[line.monster]
  const list = entry && entry.lines && entry.lines[line.lang] && entry.lines[line.lang][line.event]
  const item = Array.isArray(list) ? list[line.index] : null
  return item && item.text === line.text ? item.file : null
}

/** Cuanto se lee en el globo, en segundos: mas palabras, mas tiempo. */
export function readTime(text) {
  return Math.min(5, Math.max(2, 1.2 + wordCount(text) * 0.35))
}
