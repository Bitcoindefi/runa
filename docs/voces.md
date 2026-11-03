# Los monstruos hablan (ElevenLabs)

En la pagina 2.5D cada monstruo dice algo durante la pelea: un globo sobre su
cabeza, en el idioma elegido, y su voz generada con ElevenLabs si los audios
estan. Sin audios la pagina funciona igual, solo con los globos.

## Las piezas

| Archivo                         | Que hace                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/tripo-voces.mjs`       | Personalidad, pedido de voz y frases (ingles y castellano) de cada monstruo; el que elige que se dice; la validacion del manifiesto. Sin three.js: lo cargan las pruebas en Bare. |
| `scripts/tripo-voces-player.js` | En la pagina: el globo HTML que sigue al monstruo, la carga perezosa de los mp3 y la reproduccion.                                                                                |
| `scripts/generar-voces.mjs`     | En la compu, nunca en la pagina: disena una voz por monstruo y genera un mp3 por frase.                                                                                           |
| `assets/voces/`                 | `voces.json` (ids de voz), `manifest.json` y `<monstruo>/<idioma>/<evento>-<n>.mp3`.                                                                                              |
| `test/voces.test.js`            | Frases completas y cortas, la espera, sin repetir y el manifiesto.                                                                                                                |

## Cuando habla

Monstruos: `espectro`, `mosquito`, `golem`, `barbarian_raider`,
`barbarian_thrower`, `barbarian_chief`, `slime`, `skeleton`, `skeleton_knight`,
`skeleton_archer`, `skeleton_elite`, `skeleton_king` y el Coloso (`colossus`).

| Evento           | En la pelea del campo (pradera, cripta, campamentos) | Con el Coloso                  |
| ---------------- | ---------------------------------------------------- | ------------------------------ |
| `contact`        | empieza la pelea (`Effects.sync`)                    | `boss.active` se prende        |
| `monster_hits`   | el golpe al heroe (`hero-hit`)                       | baja la vida del heroe         |
| `monster_hurt`   | el golpe al monstruo (`foe-hit`)                     | baja la vida del Coloso        |
| `monster_low`    | el monstruo baja de 30 %, una vez                    | igual                          |
| `player_low`     | el heroe baja de 30 %, una vez                       | igual                          |
| `player_potion`  | la pocion (L2)                                       | sube la vida y baja una pocion |
| `player_guard`   | la guardia (L4)                                      | no hay                         |
| `player_retreat` | la retirada (L5)                                     | no hay                         |
| `monster_death`  | el golpe que lo mata                                 | el golpe que lo tira           |
| `windup_slam`    |                                                      | marca un puno o el colapso     |
| `windup_sweep`   |                                                      | marca la onda o el barrido     |
| `phase_change`   |                                                      | cambia `boss.phase`            |
| `defeated`       |                                                      | unos segundos despues de caer  |

El que elige (`createPicker`) deja hablar a cada monstruo como mucho una vez
cada 3 s, salvo `contact`, `monster_death`, `phase_change` y `defeated`, que
pasan siempre y reemplazan el globo. Los golpes llevan frase solo a veces
(`CHANCE`) y nunca se repite la ultima frase del mismo evento. La pagina acepta
`?voces=N` para fijar la semilla.

## Generar los audios

1. Guardar la clave en `C:\Users\usuario\.config\elevenlabs\.env` (fuera del
   repositorio):

   ```text
   ELEVENLABS_API_KEY=...
   ```

2. Ver cuanto cuesta, sin gastar:

   ```powershell
   node scripts/generar-voces.mjs
   ```

   Cuenta las frases que faltan, las voces por disenar y, con la clave, los
   creditos que quedan. Hoy son 778 frases (unos 19 000 caracteres) y 13 voces
   (unos 2 200 caracteres de muestra): cerca de 21 000 creditos con
   `eleven_multilingual_v2`, que entran en el mes del plan Creator.

3. Generar:

   ```powershell
   node scripts/generar-voces.mjs --yes
   node scripts/generar-voces.mjs --yes --only mosquito,skeleton,colossus
   node scripts/generar-voces.mjs --yes --lang es
   node scripts/generar-voces.mjs --yes --sfx
   ```

   - Sin voz en `assets/voces/voces.json`, la disena con
     `POST /v1/text-to-voice/design` (el pedido sale de `voiceDescription`:
     genero, edad, timbre, acento y ritmo) y la guarda en la cuenta con
     `POST /v1/text-to-voice`. Para usar otra voz, poner su `voice_id` a mano en
     `voces.json` antes de generar.
   - Cada frase va por `POST /v1/text-to-speech/{voice_id}` con
     `output_format=mp3_44100_64` y los ajustes de la voz del monstruo
     (`speed`, `stability`).
   - Un mp3 que ya existe no se vuelve a pedir; si el texto de una frase cambio,
     se regenera. El manifiesto se escribe despues de cada monstruo.
   - `--sfx` agrega unos efectos de combate con `POST /v1/sound-generation` en
     `assets/voces/sfx/` (todavia no suenan en la pagina).
   - Otras opciones: `--model`, `--design-model`, `--format`, `--env <archivo>`.

4. `npm run web:build` copia `assets/voces/` al sitio. El visor local
   (`npm run tripo:viewer`) los sirve en `/assets/voces/`.

La clave nunca sale del script: no se imprime, no va al manifiesto ni a la
pagina.

## En la pagina

- El manifiesto se pide la primera vez que alguien habla; los mp3 de un monstruo
  se bajan al empezar su pelea, de a tres.
- Suena por el mismo contexto de audio de los golpes (`sonido.js`), que se
  destraba con el primer toque; con Opciones > Sonido apagado solo va el globo.
- Mientras habla, los golpes bajan a 45 % (`sound.duck`).
- Un mp3 que tarda mas de 0,9 s (1,6 s para contacto y muerte) ya no suena: el
  globo no espera.
- `runaVoices()` en la consola dice el estado: manifiesto, frases dichas, audios
  oidos y el globo.
