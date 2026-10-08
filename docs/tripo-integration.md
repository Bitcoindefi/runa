# Tripo en Runa, para el Demo Day

Documento de integracion. Fecha de lectura de la doc: 8 de octubre de 2026.
El Demo Day del Tripothon S1 es el 11 de octubre de 2026, en Sao Paulo.

Runa 0.2.0 es un RPG de terminal. `index.js` arranca `bare-tui` y el juego vive
en `lib/`. No hay servidor web ni visor 3D. Tripo no entra al loop del juego:
genera un GLB al lado, y el ASCII sigue igual.

La API que vas a usar es la v3, base `https://openapi.tripo3d.ai/v3`. La v2
sigue publicada en `https://platform.tripo3d.ai/docs/` y el banner de ese sitio
dice que desde el 1 de octubre de 2026 (00:00 UTC+8) no tiene soporte, y que el
1 de noviembre de 2026 (00:00 UTC+8) los endpoints v2 dejan de aceptar pedidos.
El 11 de octubre la v2 todavia responderia, pero el demo se arma contra la v3.

## 1. Que se ve el 11

Una sola escena, en dos ventanas de la misma notebook:

1. A la izquierda, `npm start`. Caminás la ciudad o entrás a las ruinas del
   Coloso. El juego no llama a Tripo.
2. A la derecha, un HTML local con tres GLB ya generados: heroe con espada y
   escudo, cofre de hierro con runas, coloso de piedra. Los generás antes, con
   texto, modelo `P1-20260311`, textura standard.
3. En vivo, un cuarto pedido de texto: un yelmo de hierro con una runa. El
   script hace el POST, consulta la tarea cada 2 segundos y, cuando `status` es
   `success`, baja `output.model_url` a `assets/tripo/`. Recargás el visor y el
   yelmo aparece al lado del juego.

La ficha de P1 publica unos 60 segundos con textura y unos 10 sin textura. El
quick start habla de 10 a 120 segundos en general, y el ciclo de vida recomienda
cortar el poll a los 5 minutos. Si a los 2 minutos la tarea sigue en `queued` o
`running`, cortás el en vivo y dejás los tres GLB que ya estan en pantalla.

Ese es todo el demo. No hay rig, animacion, ni modelo metido en la grilla ASCII.

Prompts de respaldo, en ingles, como los ejemplos de la doc. El soporte de
prompts en espanol en la v3 queda sin verificar (la v2 sí dice que acepta varios
idiomas).

```text
a low-poly medieval hero with a round shield and a short sword, single character, game prop
a small iron treasure chest with rune carvings, low-poly game prop
a stone colossus standing in volcanic ruins, low-poly game boss
a low-poly iron helmet with a single rune on the brow, game prop
```

Cada prompt entra en el tope de 1024 caracteres.

## 2. Auth

1. Entrás a la consola: https://platform.tripo3d.ai
2. Abrís API Keys y creás una key. Se muestra una sola vez.
3. La guardás en el entorno, con el nombre que publica la doc v3:

```bash
export TRIPO_API_KEY="your_api_key_here"
```

Todas las llamadas llevan:

```text
Authorization: Bearer {api_key}
```

La key no va en el HTML, ni en `save.json`, ni en el repo. Si usás un `.env`
local, agregalo a `.gitignore`. El proceso de Bare del juego no tiene por qué
ver esa variable: el script de Tripo es otro proceso, con Node.

La guia de migracion dice que la misma key sirve para v2 y v3. El prefijo real
queda sin verificar: la v2 dice que empieza con `tsk_`, el quick start v3 muestra
el placeholder `sk-...`, y la pagina de auth muestra `your_api_key_here`. No
valides el prefijo en el codigo. Aceptá lo que te copie la consola.

`tcli_` es un Client ID de la v2, no una key. Si una llamada responde 401, estás
usando el id equivocado o la key no viaja en el header.

Probá la key con el saldo antes de gastar:

```bash
curl -X GET https://openapi.tripo3d.ai/v3/account/balance \
  -H "Authorization: Bearer ${TRIPO_API_KEY}"
```

```json
{
  "code": 0,
  "data": {
    "balance": 10000.0,
    "frozen": 200.0
  }
}
```

`balance` es el saldo disponible. `frozen` es lo que ya quedo apartado en tareas
en curso. Los numeros del ejemplo son de la doc, no tu saldo.

## 3. Endpoints

No hay un endpoint aparte para "bajar el GLB". Creas una tarea, consultas hasta
`success`, y hacés GET a la URL que viene en `output.model_url`. El quick start
dice que esa URL es el archivo GLB, que vence a los 5 minutos, y el ejemplo
termina en `.glb`. Bajala en el mismo proceso, apenas la tarea termina.

Respuesta comun de alta, texto o imagen:

```json
{
  "code": 0,
  "data": {
    "task_id": "task_abc123"
  }
}
```

`code` distinto de 0 es error. El cuerpo de error publicado es:

```json
{
  "code": 2010,
  "message": "Insufficient credits",
  "suggestion": "Please top up your account at https://platform.tripo3d.ai",
  "request_id": "req_abc123"
}
```

Sin creditos: HTTP 403, `code` 2010. Key invalida: `1000` o `1001`, HTTP 401.

### Texto a 3D

`POST https://openapi.tripo3d.ai/v3/generation/text-to-model`

Para el demo usá la serie P. Es el modelo que la ficha vende para assets de
juego, y el ejemplo oficial ya trae `face_limit`.

```json
{
  "prompt": "a low-poly iron helmet with a single rune on the brow, game prop",
  "model": "P1-20260311",
  "face_limit": 3000,
  "texture": true,
  "pbr": true
}
```

| Campo        | En este demo                                    |
| ------------ | ----------------------------------------------- |
| `prompt`     | Obligatorio. Maximo 1024 caracteres.            |
| `model`      | Obligatorio. `P1-20260311`.                     |
| `face_limit` | 3000. Dentro del rango que publica el endpoint. |
| `texture`    | `true`. El default ya es `true`.                |
| `pbr`        | `true`. Si es `true`, `texture` queda forzado.  |

`texture_quality` no se manda: el default documentado es `standard`.

P1 no soporta `quad`, `smart_low_poly`, `generate_parts` ni `geometry_quality`.
No los mandes. En la serie H, `quad: true` fuerza la salida a FBX.

La serie P tambien documenta `negative_prompt`, hasta 255 caracteres. No hace
falta mandarlo. La serie H usa el mismo path y pide `model` en `v3.1-20260211`,
`v3.0-20250812` o `v2.5-20250123`. No hace falta para el 11.

El rango de caras de P1 no coincide entre paginas: el endpoint dice 50 a 20.000,
el encabezado de la ficha dice 48 a 20.000, y el texto de la ficha tambien dice
50 a 20.000. 3000 entra en los dos. Por debajo de 150 (simple) o 250 (complejo)
la propia doc avisa que la calidad baja.

### Imagen a 3D

Primero subís el archivo, si no tenés una URL pública.

`POST https://openapi.tripo3d.ai/v3/files`

`multipart/form-data`, campo `file`. En esta llamada no armes el header
`Content-Type` a mano: el cliente tiene que poner el boundary.

```bash
curl -s \
  -H "Authorization: Bearer ${TRIPO_API_KEY}" \
  -F "file=@referencia.png" \
  https://openapi.tripo3d.ai/v3/files
```

```json
{
  "code": 0,
  "data": {
    "file_token": "file_abc123"
  }
}
```

La pagina de upload acepta imagenes JPEG y PNG, maximo 20 MB. Modelos 3D en ese
mismo endpoint: GLB, GLTF, FBX, OBJ, STL, maximo 150 MB. Por encima de 60 MB
pide el flujo de archivos grandes. Una referencia para este demo no llega ahi.

Despues:

`POST https://openapi.tripo3d.ai/v3/generation/image-to-model`

```json
{
  "input": "file_abc123",
  "model": "P1-20260311",
  "face_limit": 5000,
  "texture": true,
  "pbr": true
}
```

`input` es un solo valor. La doc dice que elijas uno:

- el `file_token` que devolvio `POST /v3/files`
- una URL publica directa, por ejemplo `https://example.com/photo.png`
- un `task_id` de una tarea previa `text_to_image` o `image_to_image`

Formatos de esa imagen: PNG, JPEG y WebP. Maximo 20 MB. Resolucion sugerida, al
menos 256 por 256, sujeto visible, poca oclusion, fondo limpio.

WebP en `POST /v3/files` queda sin verificar: el endpoint de imagen lo acepta
como `input`, y la pagina de upload solo lista JPEG y PNG. Para el demo usá PNG
o JPEG.

El quick start de "Game-Ready Character" manda `file_token` como campo raiz del
JSON. La referencia de image-to-model manda ese token dentro de `input`. Seguí
la referencia (`input`). El flujo de rig de esa pagina no entra en el demo.

Una captura de la grilla ASCII no cumple lo que pide la doc (sujeto visible,
fondo limpio). Si probás imagen a 3D, usá un dibujo o una foto del objeto.

El ejemplo de tarea terminada en las paginas de imagen repite
`"type": "text_to_model"`. No te guíes por ese string hasta ver una respuesta real.
El `type` de una tarea de imagen queda sin verificar.

### Consulta de la tarea

`GET https://openapi.tripo3d.ai/v3/tasks/{task_id}`

El id va en el path y, segun la referencia, empieza con `task_`.

```bash
curl -s \
  -H "Authorization: Bearer ${TRIPO_API_KEY}" \
  https://openapi.tripo3d.ai/v3/tasks/task_abc123
```

Cuando termina:

```json
{
  "code": 0,
  "data": {
    "task_id": "task_abc123",
    "type": "text_to_model",
    "status": "success",
    "progress": 100,
    "output": {
      "model_url": "https://cdn.tripo3d.ai/output/model_pbr.glb",
      "rendered_image_url": "https://cdn.tripo3d.ai/output/preview.png"
    },
    "credits_consumed": 100.0,
    "created_at": "2026-04-28T12:00:00Z",
    "completed_at": "2026-04-28T12:01:30Z"
  }
}
```

`credits_consumed: 100.00` es un ejemplo de payload, no la tarifa. La tarifa esta
en la seccion de limites.

`output` solo viene con `status` `success`. Ahi estan `model_url` y
`rendered_image_url`.

Estados en la pagina de consulta: `queued`, `running`, `success`, `failed`,
`cancelled`. El ciclo de vida agrega `banned` y `expired`. Trata los siete como
finales salvo `queued` y `running`. En `failed` pueden venir `error_code` y
`error_message`.

`progress` va de 0 a 100. En `queued` la tabla del ciclo de vida lo pone en 0.
Consulta cada 2 segundos. El quick start pide no pasar de 1 request por segundo.
El tope numerico de QPS de generacion queda sin verificar: la pagina de rate
limit dice que depende del endpoint y no publica el numero.

### Descarga del GLB

No hay path de descarga. Con `status` `success`:

```bash
curl -L -o assets/tripo/yelmo.glb "https://cdn.tripo3d.ai/output/model_pbr.glb"
```

La URL real es la de `output.model_url`, no la del ejemplo. El quick start dice
que vence a los 5 minutos. La FAQ de la v2 dice 60 segundos y un 403 si se vence.
Para la v3, bajá el archivo enseguida. Si el GET falla, volvé a consultar la
tarea y usa la URL nueva. Si esa segunda URL pide `Authorization`, queda sin
verificar: la doc no lo dice.

El tamano del GLB de salida queda sin verificar. No hay un tope publicado para
el archivo generado. El tope de 150 MB es para subir un modelo, no para bajarlo.

## 4. Donde va el codigo

El juego no se toca. `lib/game.js`, los mapas y el render ASCII quedan como
estan. El lugar que ya usa Node es `scripts/` (`scripts/make.js`,
`scripts/readme-screens.js`). Ahi van dos archivos nuevos:

- `scripts/tripo-generate.js`, que habla con la API y escribe el GLB
- `scripts/tripo-viewer.html`, mas un server chico de Node para abrirlo

Node 18 o mas nuevo, por `fetch`, `FormData` y `Blob`. Sin dependencias nuevas.
Los GLB van a `assets/tripo/` y no se commitean: el peso de salida no esta
publicado, y la notebook del demo los lleva en disco.

Bosquejo de generacion:

```js
#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const BASE = 'https://openapi.tripo3d.ai/v3'
const OUT_DIR = path.resolve(__dirname, '../assets/tripo')

function apiKey() {
  const key = process.env.TRIPO_API_KEY
  if (!key) {
    console.error('Falta TRIPO_API_KEY')
    process.exit(1)
  }
  return key
}

async function tripo(url, options = {}) {
  const headers = { Authorization: `Bearer ${apiKey()}`, ...options.headers }
  const response = await fetch(url, { ...options, headers })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.code !== 0) {
    throw new Error(`Tripo ${response.status} ${JSON.stringify(body)}`)
  }
  return body.data
}

async function createTextTask(prompt) {
  const data = await tripo(`${BASE}/generation/text-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: 'P1-20260311',
      face_limit: 3000,
      texture: true,
      pbr: true
    })
  })
  return data.task_id
}

async function createImageTask(imagePath) {
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath))
  const uploaded = await tripo(`${BASE}/files`, { method: 'POST', body: form })
  const data = await tripo(`${BASE}/generation/image-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: uploaded.file_token,
      model: 'P1-20260311',
      face_limit: 5000,
      texture: true,
      pbr: true
    })
  })
  return data.task_id
}

async function waitTask(taskId) {
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    const task = await tripo(`${BASE}/tasks/${taskId}`)
    console.log(`${task.status} ${task.progress}%`)
    if (task.status === 'success') return task
    if (['failed', 'cancelled', 'banned', 'expired'].includes(task.status)) {
      throw new Error(`${task.status} ${task.error_code || ''} ${task.error_message || ''}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('sigo sin success a los 5 minutos')
}

async function downloadGlb(modelUrl, dest) {
  const response = await fetch(modelUrl)
  if (!response.ok) throw new Error(`descarga ${response.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
}

async function main() {
  const imageFlag = process.argv.indexOf('--image')
  const taskId =
    imageFlag !== -1
      ? await createImageTask(process.argv[imageFlag + 1])
      : await createTextTask(process.argv.slice(2).join(' '))
  const task = await waitTask(taskId)
  const dest = path.join(OUT_DIR, `${taskId}.glb`)
  await downloadGlb(task.output.model_url, dest)
  console.log(dest)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
```

Uso:

```bash
export TRIPO_API_KEY="your_api_key_here"
node scripts/tripo-generate.js "a low-poly iron helmet with a single rune on the brow, game prop"
node scripts/tripo-generate.js --image referencia.png
```

Visor, servido desde la raiz del repo para que el GLB cargue. `model-viewer` es
uno de los visores que nombra el quick start. Los atributos del componente no
estan en la doc de Tripo: el dia que armes la pagina, copiá el snippet del README
de model-viewer y guardá `model-viewer.min.js` al lado del HTML. La URL de un CDN
queda sin verificar, y el wifi del evento no tiene que ser parte del demo.

```html
<!doctype html>
<meta charset="utf-8" />
<title>Runa / Tripo</title>
<script type="module" src="./model-viewer.min.js"></script>
<p>Runa sigue en la terminal. Aca solo el GLB.</p>
<model-viewer src="/assets/tripo/heroe.glb" camera-controls></model-viewer>
```

Un server sin dependencias, en `scripts/tripo-viewer.js`, alcanza para el ensayo.
Sirve la raiz del repo. Si el pedido es `/`, devuelve el HTML.

```js
'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '..')

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0])
    const rel = (urlPath === '/' ? 'scripts/tripo-viewer.html' : urlPath).replace(/^\/+/, '')
    const file = path.resolve(root, rel)
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep
    if (file !== root && !file.startsWith(rootPrefix)) {
      res.writeHead(403).end()
      return
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404).end()
        return
      }
      const type = file.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : file.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'model/gltf-binary'
      res.writeHead(200, { 'Content-Type': type }).end(data)
    })
  })
  .listen(4173, () => {
    console.log('http://127.0.0.1:4173/')
  })
```

Abrí `http://127.0.0.1:4173/` al lado de la terminal del juego. El visor no
lleva la API key.

## 5. Orden hasta el 11

Hoy es 8 de octubre. El escenario es el 11. Hacelo en este orden:

1. Hoy: creá la key, exportá `TRIPO_API_KEY` y consultá
   `GET /v3/account/balance`. Si `balance` es 0, cargá creditos en la consola.
   El minimo de recarga queda sin verificar.
2. Hoy: un POST de texto a mano, con el yelmo, `P1-20260311` y `face_limit` 3000. Consultá hasta `success` y bajá el GLB en ese momento. Abrilo en
   Blender o en el visor. Si este paso falla, no escribas el script todavia.
3. Con un GLB real en disco: copiá el bosquejo a `scripts/tripo-generate.js` y
   generá heroe, cofre y coloso. Dejalos en la notebook, fuera de git.
4. Armá el HTML y `scripts/tripo-viewer.js`. Dejá `model-viewer.min.js` al lado.
   Confirmá que los tres GLB giran en el navegador con el juego abierto en otra
   ventana.
5. Un ensayo completo, antes del 11: terminal, visor, y una generacion en vivo.
   Si a los 2 minutos no hay `success`, cortá y mostrá los tres de respaldo.
   Anotá `credits_consumed` de esa corrida.
6. Imagen a 3D, solo si el texto ya funciona y te sobra un rato el 9 o el 10.
   Un PNG o JPEG de referencia, no una captura ASCII. No es el numero del
   escenario.
7. El 11 no es para la primera llamada. Llevás la key ya probada, los GLB en
   disco, el visor abierto y el juego en la version que ya corre.

No hace falta tocar tests del juego. Este corte no cambia `lib/`.

## 6. Limites que importan el 11

Precios publicados el 8 de octubre de 2026. 1 credito = 0,01 USD. 100 creditos
= 1 USD.

Serie P1, en https://developers.tripo3d.ai/en/models/p1 :

| Tarea       | Sin textura | Textura standard | Textura detailed |
| ----------- | ----------- | ---------------- | ---------------- |
| Texto a 3D  | 30          | 40               | 50               |
| Imagen a 3D | 40          | 50               | 60               |

El demo usa textura standard: 40 creditos por modelo de texto (0,40 USD) y 50
por uno de imagen (0,50 USD). Cuatro textos, tres de respaldo y uno en vivo,
son 160 creditos si todos salen bien: 1,60 USD. Deja margen para dos o tres
reintentos.

Serie H, tabla visible en https://developers.tripo3d.ai/en/pricing :

| Tarea       | Sin textura | Textura standard |
| ----------- | ----------- | ---------------- |
| Texto a 3D  | 10          | 20               |
| Imagen a 3D | 20          | 30               |

Add-ons de esa pagina, sumados a la base: HD Texture +10, 8K Ultra Texture +20,
HD Geometry Quality +20, Quad Mesh +5, Smart Low-poly +10, Generate Parts +20.
Como mapean `detailed` y `extreme` a esas etiquetas queda sin verificar. El tab
P Series de esa misma pagina no vino en el HTML leido; los numeros P1 salen de
la ficha del modelo.

Al crear la tarea, Tripo aparta los creditos. Si sale `success`, los descuenta.
Si falla o se cancela, los devuelve. `banned` y `expired` no dicen en la tabla
si devuelven el credito: sin verificar. Miralos en `GET /v3/account/balance`
(`balance` y `frozen`) y en `credits_consumed` de la tarea.

Tiempo:

- P1: unos 10 segundos sin textura, unos 60 con textura.
- Quick start: 10 a 120 segundos como rango general.
- Poll cada 2 segundos, corte a los 5 minutos.
- En el escenario, a los 2 minutos volvés a los GLB de respaldo.

Concurrencia, un solo modelo a la vez en el demo. Si lanzás varios juntos, frená
en 3: la ficha P1 dice 3 tareas P en paralelo y la pagina de rate limit dice 5
para la serie P. La serie H figura en 10. La concurrencia es por cuenta, no por
key. Si el cupo esta lleno, HTTP 429 y `code` 2000, con header `Retry-After`.

Rate limit, distinto de la concurrencia: por API key. La pagina de rate limit
dice HTTP 429 y `code` 1007, y publica `X-RateLimit-Limit`,
`X-RateLimit-Remaining` y `X-RateLimit-Reset`. La pagina de errores, en cambio,
describe 2000 como rate limit. Si te llega un 429, esperá `Retry-After` o
`X-RateLimit-Reset` y no reintentes en seguida. El cupo exacto de requests queda
sin verificar.

Archivos:

- Imagen de entrada: maximo 20 MB. PNG o JPEG para el upload. Minimo sugerido,
  256 por 256.
- Subir un modelo 3D: maximo 150 MB. No es el caso del demo.
- GLB de salida: tamano sin verificar. Bajalo ya, porque la URL v3 vence a los
  5 minutos.

## 7. Fuera del demo

Esto no entra antes del 11:

- Meter el mesh en la grilla ASCII, en `lib/render.js` o en los mapas.
- Rig, retarget, multiview, refine, conversión a FBX, quad, partes sueltas.
- Un backend publico, WalletConnect, o pagar los creditos con la wallet de Runa.
- Llamar a Tripo desde el browser con la key.
- Reescribir el juego como web app.
- Commitear la key, un `.env`, o los GLB generados.
- Implementar la v2 (`POST https://api.tripo3d.ai/v2/openapi/task`).

## 8. Sin verificar

- Prefijo de la API key en la v3.
- Prompts en espanol en la v3.
- `type` real de una tarea image-to-model (el ejemplo publicado dice
  `text_to_model`).
- WebP en `POST /v3/files`.
- Si el GET del GLB exige `Authorization`.
- Tamano del GLB generado.
- QPS numerico de los endpoints de generacion.
- Como se apilan `texture_quality=detailed` y `extreme` sobre la tabla H.
- Si el tab P de `/en/pricing` coincide con la ficha P1.
- Si `banned` o `expired` devuelven los creditos.
- Minimo de recarga en la consola.
- Cual de los dos topes de concurrencia P aplica: 3 o 5.
- Cual de los dos rangos de caras aplica en el borde: 48 o 50.

## 9. Fuentes

Leidas el 8 de octubre de 2026.

V3, la que usa el demo:

- https://developers.tripo3d.ai/en/docs/quick-start
- https://developers.tripo3d.ai/en/docs/authentication
- https://developers.tripo3d.ai/en/docs/generation-text-to-model
- https://developers.tripo3d.ai/en/docs/generation-text-to-model/p
- https://developers.tripo3d.ai/en/docs/generation-image-to-model
- https://developers.tripo3d.ai/en/docs/generation-image-to-model/p
- https://developers.tripo3d.ai/en/docs/task-query
- https://developers.tripo3d.ai/en/docs/task-lifecycle
- https://developers.tripo3d.ai/en/docs/files
- https://developers.tripo3d.ai/en/docs/billing
- https://developers.tripo3d.ai/en/docs/rate-limits
- https://developers.tripo3d.ai/en/docs/error-handling
- https://developers.tripo3d.ai/en/docs/migration-v2-to-v3
- https://developers.tripo3d.ai/en/pricing
- https://developers.tripo3d.ai/en/models/p1
- https://platform.tripo3d.ai (consola, API Keys)

V2, solo para no seguirla:

- https://platform.tripo3d.ai/docs/
- https://platform.tripo3d.ai/docs/quick-start
- https://platform.tripo3d.ai/docs/generation
- https://platform.tripo3d.ai/docs/task
- https://platform.tripo3d.ai/docs/upload
- https://platform.tripo3d.ai/docs/limit
- https://platform.tripo3d.ai/docs/billing
- https://platform.tripo3d.ai/docs/faq
- https://platform.tripo3d.ai/docs/post-process
