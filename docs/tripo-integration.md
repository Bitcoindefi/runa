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
2. A la derecha, el visor local (`npm run tripo:viewer`) con tres GLB ya
   generados: heroe con espada y escudo, cofre de hierro con runas, coloso de
   piedra. Los generás antes, con texto, modelo `P1-20260311`, textura standard.
3. En vivo, un cuarto pedido de texto: un yelmo de hierro con una runa. El
   script hace el POST, consulta la tarea cada 2 segundos y, cuando `status` es
   `success`, baja `output.model_url` a `assets/tripo/`. El visor lo muestra solo
   a los pocos segundos, sin recargar.

La ficha de P1 publica unos 60 segundos con textura y unos 10 sin textura. El
quick start habla de 10 a 120 segundos en general, y el ciclo de vida recomienda
cortar el poll a los 5 minutos. Si a los 2 minutos la tarea sigue en `queued` o
`running`, cortás el en vivo y dejás los tres GLB que ya estan en pantalla. El
script lo hace solo con `--timeout 120`, aunque el wifi se cuelgue. Si la tarea
termina despues del corte, Tripo la cobra igual: el script deja impreso el
comando para bajarla con `--task` sin pagar otra.

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

```powershell
$env:TRIPO_API_KEY = "your_api_key_here"
```

```bash
export TRIPO_API_KEY="your_api_key_here"
```

Todas las llamadas llevan:

```text
Authorization: Bearer {api_key}
```

La key no va en el HTML, ni en `save.json`, ni en el repo. `.env` y `.env.*` ya
estan en `.gitignore`. El proceso de Bare del juego no tiene por qué ver esa
variable: el script de Tripo es otro proceso, con Node.

La guia de migracion dice que la misma key sirve para v2 y v3. El prefijo real
queda sin verificar: la v2 dice que empieza con `tsk_`, el quick start v3 muestra
el placeholder `sk-...`, y la pagina de auth muestra `your_api_key_here`. El
script no valida el prefijo: acepta lo que te copie la consola.

`tcli_` es un Client ID de la v2, no una key. Si una llamada responde 401, estás
usando el id equivocado o la key no viaja en el header.

Probá la key con el saldo antes de gastar:

```powershell
npm.cmd run tripo -- --balance
```

Es la misma llamada que:

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

Una key invalida, probado el 8 de octubre contra ese endpoint, devuelve HTTP 401
con este cuerpo:

```json
{
  "code": 2,
  "status": "error",
  "message": "Invalid API key",
  "suggestion": "Check if your credentials is valid"
}
```

La doc publica `1000` o `1001` para ese caso. El script no depende del numero:
muestra el cuerpo completo y, con 401, avisa que revises la key.

## 3. Endpoints

No hay un endpoint aparte para "bajar el GLB". Creas una tarea, consultas hasta
`success`, y hacés GET a la URL que viene en `output.model_url`. El quick start
dice que esa URL es el archivo GLB, que vence a los 5 minutos, y el ejemplo
termina en `.glb`. El script la baja en el mismo proceso, apenas la tarea
termina.

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

Sin creditos: HTTP 403, `code` 2010. Key invalida: HTTP 401; la doc dice `1000`
o `1001`, la API respondio `2` (seccion 2).

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
como `input`, y la pagina de upload solo lista JPEG y PNG. El script solo acepta
PNG o JPEG.

El quick start de "Game-Ready Character" manda `file_token` como campo raiz del
JSON. La referencia de image-to-model manda ese token dentro de `input`. El
script sigue la referencia (`input`). El flujo de rig de esa pagina no entra en
el demo.

Una captura de la grilla ASCII no cumple lo que pide la doc (sujeto visible,
fondo limpio). Si probás imagen a 3D, usá un dibujo o una foto del objeto.

El ejemplo de tarea terminada en las paginas de imagen repite
`"type": "text_to_model"`. El script no mira `type`. El `type` real de una tarea
de imagen queda sin verificar.

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
`cancelled`. El ciclo de vida agrega `banned` y `expired`. El script trata los
siete como finales salvo `queued` y `running`. En `failed` pueden venir
`error_code` y `error_message`, y el script los muestra.

`progress` va de 0 a 100. En `queued` la tabla del ciclo de vida lo pone en 0.
El script consulta cada 2 segundos. El quick start pide no pasar de 1 request
por segundo. El tope numerico de QPS de generacion queda sin verificar: la
pagina de rate limit dice que depende del endpoint y no publica el numero.

### Descarga del GLB

No hay path de descarga. Con `status` `success`, el GLB se baja de
`output.model_url`, sin la key en el header. El quick start dice que esa URL
vence a los 5 minutos; la FAQ de la v2 dice 60 segundos y un 403 si se vence.
Si el GET falla, el script vuelve a consultar la tarea y usa la URL nueva. Si
esa segunda URL pide `Authorization`, queda sin verificar: la doc no lo dice.

El tamano del GLB de salida queda sin verificar. No hay un tope publicado para
el archivo generado. El tope de 150 MB es para subir un modelo, no para bajarlo.

## 4. Donde esta el codigo

El juego no se toca. `lib/game.js`, los mapas y el render ASCII quedan como
estan. Todo vive en `scripts/`, con Node 18 o mas nuevo (`fetch`, `FormData` y
`Blob`) y sin dependencias nuevas:

- `scripts/tripo-generate.js`: habla con la API y escribe el GLB.
- `scripts/tripo-viewer.js`: server local del visor.
- `scripts/tripo-viewer.html`: la pagina del visor.

Los GLB van a `assets/tripo/` y no se commitean: el peso de salida no esta
publicado, y la notebook del demo los lleva en disco. `.gitignore` ignora
`.env`, `.env.*`, `assets/tripo/` y `vendor/model-viewer.min.js`.

### Generar

La key sale de `TRIPO_API_KEY` o, si no esta, del archivo
`%USERPROFILE%\.config\tripo\key.txt` (en bash, `~/.config/tripo/key.txt`). Con
el archivo, la key no queda en el historial de la terminal:

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\tripo" | Out-Null
notepad "$HOME\.config\tripo\key.txt"
```

```powershell
npm.cmd run tripo -- --balance
npm.cmd run tripo -- --name yelmo --dry-run "a low-poly iron helmet with a single rune on the brow, game prop"
npm.cmd run tripo -- --name yelmo "a low-poly iron helmet with a single rune on the brow, game prop"
npm.cmd run tripo -- --name cofre --image referencia.png
npm.cmd run tripo -- --name yelmo --task task_abc123
```

Con npm, las opciones van despues de `--`. Sin ese `--`, npm se queda con
`--name` y `--timeout` y el script recibe solo el prompt. En bash es igual, con
`npm run`.

| Opcion            | Que hace                                                            |
| ----------------- | ------------------------------------------------------------------- |
| `--name <nombre>` | Guarda `assets/tripo/<nombre>.glb`. Sin `--name`, usa el task_id.   |
| `--image <ruta>`  | Imagen a 3D. PNG o JPEG, hasta 20 MB.                               |
| `--faces <n>`     | `face_limit`, de 50 a 20000. Default 3000 en texto, 5000 en imagen. |
| `--timeout <seg>` | Corta la espera, de 1 a 300 segundos. En vivo, `--timeout 120`.     |
| `--task <id>`     | Retoma una tarea ya creada: espera y baja el GLB sin pagar otra.    |
| `--dry-run`       | Muestra el pedido y sale. No gasta creditos.                        |
| `--balance`       | Muestra `balance` y `frozen`. No gasta creditos.                    |

`--name` y `--task` aceptan letras, numeros, `_` y `-`. Una opcion mal escrita
(`--balence`, `-balance`) corta antes de crear la tarea, en vez de terminar como
texto del prompt. Antes de pagar, el script muestra en una linea el prompt, las
caras, el nombre y el corte.

La ruta del GLB sale por stdout; el progreso y los errores, por stderr. Con
`npm run`, el encabezado de npm tambien sale por stdout: para leer solo la ruta,
usá `node scripts/tripo-generate.js` directo o `npm run -s tripo -- ...`. Si
algo falla, el codigo de salida es 1.

Que hace con cada problema:

- Ninguna consulta espera mas de 15 segundos y la descarga no pasa de 60. Sin
  ese limite, el `fetch` de Node espera hasta 300 segundos una red colgada, y
  `--timeout 120` no cortaria a tiempo.
- 429: espera `Retry-After` (o `X-RateLimit-Reset`), entre 1 y 60 segundos y
  nunca mas alla del corte, y reintenta hasta 3 veces por pedido.
- Corte de red, respuesta cortada, 429 o 5xx mientras consulta la tarea: sigue
  consultando hasta el corte. La tarea sigue corriendo en Tripo aunque se caiga
  el wifi.
- El alta no se reintenta ante un corte de red: si el POST llego a Tripo, un
  reintento podria cobrar dos veces. Antes del POST imprime
  `creando la tarea...`.
- `failed`, `cancelled`, `banned` o `expired`: corta y muestra `error_code` y
  `error_message`.
- Si corta despues de crear la tarea, por `--timeout`, la red o un error,
  imprime el comando para retomarla con `--task` sin pagar otra. Tripo cobra la
  tarea si termina, aunque el script ya haya cortado.
- Si la descarga falla o la URL vencio, vuelve a pedir la tarea por una URL
  nueva, durante 5 minutos como maximo.
- Solo guarda un GLB entero: revisa que empiece con `glTF` y que el largo
  coincida con el que declara.
- La descarga se escribe en `<nombre>.glb.part` y se renombra al terminar, asi el
  visor nunca lee un GLB a medias. En Windows reintenta el rename si el visor
  justo esta leyendo el archivo anterior.

### Ver

```powershell
node scripts/tripo-viewer.js --fetch-lib
npm.cmd run tripo:viewer
```

`--fetch-lib` se corre una vez, con wifi: baja `@google/model-viewer` 4.3.1 a
`vendor/model-viewer.min.js`, fuera de git, y lo rechaza si su sha256 no
coincide. El wifi del evento no tiene que ser parte del demo. Despues,
`npm run tripo:viewer` imprime `http://127.0.0.1:4173/`: abrí esa URL.

- Escucha solo en `127.0.0.1`, responde solo a los Host `127.0.0.1` y
  `localhost`, y sirve cuatro rutas: la pagina, model-viewer, `/models.json` y
  `/assets/tripo/<nombre>.glb`. El resto del repo no se publica.
- Muestra los `<nombre>.glb` con letras, numeros, `_` o `-` y la extension en
  minuscula. A los demas los saltea y lo avisa una vez en su consola.
- La pagina consulta `/models.json` cada 3 segundos. Un GLB nuevo aparece solo,
  uno regenerado con el mismo nombre se recarga y queda marcado, y uno borrado
  sale de la grilla.
- Si un GLB no carga, el texto debajo del modelo lo dice.
- Los GLB con meshopt cargan sin red. Los que usan Draco o KTX2 piden su
  decodificador a un CDN de Google y sin wifi no cargan; KTX2 se ve blanco, sin
  error. El script no pide compresion, asi que no deberian aparecer. Para
  revisarlo despues de generar:

```powershell
node -e "const fs=require('fs');for(const f of fs.readdirSync('assets/tripo'))if(f.endsWith('.glb')){const b=fs.readFileSync('assets/tripo/'+f);console.log(f,JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12))).extensionsUsed||[])}"
```

Si un GLB lista `KHR_draco_mesh_compression` o `KHR_texture_basisu`, regeneralo.

- Si el puerto esta ocupado o reservado: `$env:PORT = "4174"` antes de
  arrancarlo.
- Dejá la ventana del visor a la vista: con Chrome minimizado o tapado, el
  navegador frena la consulta y el yelmo puede aparecer recien al volver.
- El visor no lleva la API key.

### Prueba sin creditos

El 8 de octubre el script se probo contra un server falso que imita la v3: 429
en el alta, 503 en una consulta, URL del GLB vencida en la primera descarga,
upload multipart, imagen a 3D, saldo, tarea fallida, consulta colgada con
`--timeout`, tarea retomada con `--task`, opcion mal escrita y descarga que no
es un GLB. `TRIPO_BASE_URL` apunta el script a ese server; en el demo no se usa.
La generacion real contra Tripo queda para cuando haya key (seccion 5, paso 2).

## 5. Orden hasta el 11

Hoy es 8 de octubre. El escenario es el 11. Hacelo en este orden:

1. Hoy: creá la key, guardala en el archivo de la seccion 4 (o en
   `TRIPO_API_KEY`) y corré `npm.cmd run tripo -- --balance`. Si `balance` es 0, cargá creditos en la
   consola. El minimo de recarga queda sin verificar.
2. Hoy: un pedido de texto real, con el yelmo:
   `npm.cmd run tripo -- --name yelmo "a low-poly iron helmet with a single rune on the brow, game prop"`.
   Abrilo en el visor o en Blender. Si este paso falla, frená y mirá el error
   antes de gastar en los demas.
3. Con un GLB real en disco: generá `heroe`, `cofre` y `coloso` con `--name` y
   los prompts de la seccion 1. Dejalos en la notebook, fuera de git.
4. `node scripts/tripo-viewer.js --fetch-lib` una vez y
   `npm.cmd run tripo:viewer`. Confirmá que los tres GLB giran en el navegador
   con el juego abierto en otra ventana.
5. Un ensayo completo, antes del 11: terminal, visor, y una generacion en vivo
   con `--timeout 120`. Si a los 2 minutos no hay `success`, el script corta y
   mostrás los tres de respaldo. Si la tarea termina despues, el comando
   `--task` que dejo impreso la baja sin pagar otra. Anotá los creditos que
   imprime al terminar.
6. Imagen a 3D, solo si el texto ya funciona y te sobra un rato el 9 o el 10.
   Un PNG o JPEG de referencia, no una captura ASCII. No es el numero del
   escenario.
7. El 11 no es para la primera llamada. Llevás la key ya probada, los GLB en
   disco, el visor abierto y el juego en la version que ya corre.

Antes del escenario, borrá de `assets/tripo/` los GLB de ensayo que no quieras
mostrar, como `prueba.glb` o un yelmo del ensayo: el visor los saca de la
grilla solo. Si dejás un yelmo viejo, en pantalla ya hay un yelmo antes del
pedido en vivo.

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
si devuelven el credito: sin verificar. Miralos con `--balance` (`balance` y
`frozen`) y en los creditos que imprime el script al terminar.

Tiempo:

- P1: unos 10 segundos sin textura, unos 60 con textura.
- Quick start: 10 a 120 segundos como rango general.
- Poll cada 2 segundos, corte a los 5 minutos.
- En el escenario, `--timeout 120`: a los 2 minutos volvés a los GLB de respaldo.

Concurrencia, un solo modelo a la vez en el demo. Si lanzás varios juntos, frená
en 3: la ficha P1 dice 3 tareas P en paralelo y la pagina de rate limit dice 5
para la serie P. La serie H figura en 10. La concurrencia es por cuenta, no por
key. Si el cupo esta lleno, HTTP 429 y `code` 2000, con header `Retry-After`.

Rate limit, distinto de la concurrencia: por API key. La pagina de rate limit
dice HTTP 429 y `code` 1007, y publica `X-RateLimit-Limit`,
`X-RateLimit-Remaining` y `X-RateLimit-Reset`. La pagina de errores, en cambio,
describe 2000 como rate limit. El script, ante un 429, espera `Retry-After` o
`X-RateLimit-Reset` antes de reintentar. El cupo exacto de requests queda sin
verificar.

Archivos:

- Imagen de entrada: maximo 20 MB. PNG o JPEG para el upload. Minimo sugerido,
  256 por 256.
- Subir un modelo 3D: maximo 150 MB. No es el caso del demo.
- GLB de salida: tamano sin verificar. El script lo baja apenas termina la tarea,
  porque la URL v3 vence a los 5 minutos.

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

Verificado el 8 de octubre: la base `https://openapi.tripo3d.ai/v3` responde, y
una key invalida da HTTP 401 con `code` 2. Lo demas sigue abierto:

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
- https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard
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
