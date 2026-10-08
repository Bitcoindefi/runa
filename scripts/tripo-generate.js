#!/usr/bin/env node
'use strict'

// Genera un GLB con la API v3 de Tripo y lo deja en assets/tripo/.
// Corre con Node 18+, fuera del juego: el proceso de Bare nunca ve la key.
// Contrato y limites en docs/tripo-integration.md.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseArgs } = require('util')

// TRIPO_BASE_URL solo existe para probar el script contra un server falso.
const BASE = process.env.TRIPO_BASE_URL || 'https://openapi.tripo3d.ai/v3'
const MODEL = 'P1-20260311'
const OUT_DIR = path.resolve(__dirname, '../assets/tripo')
const KEY_FILE = path.join(os.homedir(), '.config', 'tripo', 'key.txt')
const POLL_MS = 2000
const DEADLINE_S = 300
// Sin limite, el fetch de Node espera hasta 300 s una red o una API colgada.
const REQUEST_MS = 15000
const DOWNLOAD_MS = 60000
const FINAL_FAILURES = ['failed', 'cancelled', 'banned', 'expired']
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

const USAGE = `Uso:
  node scripts/tripo-generate.js [--name yelmo] "prompt en ingles"
  node scripts/tripo-generate.js [--name cofre] --image referencia.png
  node scripts/tripo-generate.js [--name yelmo] --task <task_id>
  node scripts/tripo-generate.js --balance

Opciones:
  --name <nombre>   archivo de salida assets/tripo/<nombre>.glb (default: el task_id)
  --faces <n>       face_limit, entero de 50 a 20000 (default 3000 texto, 5000 imagen)
  --timeout <seg>   corta la espera antes de los 300 s (ej. 120 en vivo)
  --task <id>       retoma una tarea ya creada: espera y baja el GLB sin pagar otra
  --dry-run         muestra el pedido y sale, sin gastar creditos
  --balance         muestra el saldo, sin gastar creditos

Con npm, las opciones van despues de --:  npm run tripo -- --name yelmo "..."
La key sale de TRIPO_API_KEY o, si no esta, de ${KEY_FILE}.`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

let cachedKey
function apiKey() {
  if (cachedKey) return cachedKey
  let key = process.env.TRIPO_API_KEY
  if (!key) {
    try {
      key = fs.readFileSync(KEY_FILE, 'utf8')
    } catch {
      // Sin archivo: se avisa abajo.
    }
  }
  key = (key || '').trim()
  if (!key) {
    console.error(`Falta la key: TRIPO_API_KEY en el entorno o el archivo ${KEY_FILE}`)
    process.exit(1)
  }
  // Con un salto de linea en el medio, fetch rechaza el header y lo imprime entero.
  if (/\s/.test(key)) {
    console.error('La key tiene espacios o saltos de linea en el medio. Copiala de nuevo.')
    process.exit(1)
  }
  cachedKey = key
  return key
}

// Retry-After en segundos o fecha HTTP; X-RateLimit-Reset en epoch (s o ms) o en
// segundos restantes. Siempre entre 1 y 60 s.
function retryAfterMs(response) {
  const after = response.headers.get('retry-after')
  let ms = Number(after) * 1000
  if (!(ms > 0) && after) ms = Date.parse(after) - Date.now()
  if (!(ms > 0)) {
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    if (reset > 1e12) ms = reset - Date.now()
    else if (reset > 1e9) ms = reset * 1000 - Date.now()
    else if (reset > 0) ms = reset * 1000
  }
  return Math.min(Math.max(ms > 0 ? ms : 5000, 1000), 60000)
}

// fetch solo dice "fetch failed"; la causa dice si fue DNS, TLS, un reset o el corte.
const describe = (error) =>
  error.cause ? `${error.message} (${error.cause.code || error.cause.message})` : error.message

// deadline acota cada pedido y cada espera por 429. El alta, el upload y el saldo
// van sin deadline: si el POST llego, abortarlo no evita el cobro.
async function tripo(url, options = {}, deadline = Infinity, retries = 3) {
  const headers = { Authorization: `Bearer ${apiKey()}`, ...options.headers }
  const signal =
    deadline < Infinity
      ? AbortSignal.timeout(Math.max(1000, Math.min(REQUEST_MS, deadline - Date.now())))
      : undefined
  let response
  try {
    response = await fetch(url, { ...options, headers, signal })
  } catch (error) {
    throw new Error(describe(error))
  }
  let body = {}
  try {
    body = JSON.parse(await response.text())
  } catch (error) {
    // Un 200 cortado a la mitad o con HTML de un proxy es un problema de red.
    if (response.ok || signal?.aborted) throw new Error(`respuesta incompleta: ${describe(error)}`)
  }
  if (response.status === 429 && retries > 0 && Date.now() < deadline) {
    const wait = Math.min(retryAfterMs(response), deadline - Date.now())
    console.error(`429 (code ${body.code}), espero ${Math.ceil(wait / 1000)} s`)
    await sleep(wait)
    return tripo(url, options, deadline, retries - 1)
  }
  if (!response.ok || body.code !== 0) {
    const hint =
      response.status === 401
        ? ' -- revisa que sea la API key y no el Client ID (tcli_)'
        : response.status === 403 || body.code === 2010
          ? ' -- puede faltar saldo: npm run tripo -- --balance'
          : ''
    const error = new Error(`Tripo ${response.status} ${JSON.stringify(body)}${hint}`)
    error.status = response.status
    throw error
  }
  return body.data
}

// Sin status es un corte de red. 429 y 5xx tambien se reintentan.
const transient = (error) =>
  error.status === undefined || error.status === 429 || error.status >= 500

async function createTextTask(prompt, faces) {
  const data = await tripo(`${BASE}/generation/text-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: MODEL, face_limit: faces, texture: true, pbr: true })
  })
  return data.task_id
}

async function createImageTask(imagePath, faces) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()]
  const bytes = fs.readFileSync(imagePath)
  if (bytes.length > 20 * 1024 * 1024) throw new Error('La imagen pasa los 20 MB.')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), path.basename(imagePath))
  // Sin Content-Type a mano: fetch pone el boundary del multipart.
  const uploaded = await tripo(`${BASE}/files`, { method: 'POST', body: form })
  const data = await tripo(`${BASE}/generation/image-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: uploaded.file_token,
      model: MODEL,
      face_limit: faces,
      texture: true,
      pbr: true
    })
  })
  return data.task_id
}

async function waitTask(taskId, deadline) {
  while (Date.now() < deadline) {
    let task
    try {
      task = await tripo(`${BASE}/tasks/${encodeURIComponent(taskId)}`, {}, deadline)
    } catch (error) {
      // Un corte del wifi no mata la tarea: Tripo sigue trabajando.
      if (!transient(error)) throw error
      console.error(`consulta fallida, reintento: ${error.message}`)
      await sleep(Math.min(POLL_MS, deadline - Date.now()))
      continue
    }
    console.error(`${task.status} ${task.progress ?? 0}%`)
    if (task.status === 'success') return task
    if (FINAL_FAILURES.includes(task.status)) {
      const reason = task.error_message || task.error_msg || ''
      throw new Error(`${task.status} ${task.error_code || ''} ${reason}`.trim())
    }
    await sleep(Math.min(POLL_MS, deadline - Date.now()))
  }
  throw new Error(`${taskId} sigue sin success al corte`)
}

// La doc v3 usa output.model_url; los SDK oficiales caen a estos otros campos.
function modelUrl(task) {
  const output = task.output || {}
  return output.model_url || output.pbr_model || output.model || output.base_model
}

async function downloadGlb(url, dest) {
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
  } catch (error) {
    throw new Error(`descarga: ${describe(error)}`)
  }
  if (!response.ok) throw new Error(`descarga ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  // Un GLB empieza con "glTF" y declara su largo: descarta una pagina de error o
  // un archivo cortado.
  const glb =
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'glTF' &&
    bytes.readUInt32LE(8) === bytes.length
  if (!glb) throw new Error(`descarga invalida: ${bytes.length} bytes que no son un GLB entero`)
  const tmp = dest + '.part'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(tmp, bytes)
  // En Windows el rename falla si el visor esta leyendo el GLB anterior.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      fs.renameSync(tmp, dest)
      return
    } catch (error) {
      if (attempt === 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      await sleep(100)
    }
  }
}

// La URL del GLB vence a los 5 minutos: si la descarga falla, se pide la tarea de
// nuevo por una URL fresca, hasta 5 minutos.
async function downloadTask(taskId, task, dest) {
  const deadline = Date.now() + DEADLINE_S * 1000
  for (;;) {
    try {
      const url = modelUrl(task)
      if (!url) throw new Error(`${taskId} termino sin output.model_url`)
      return await downloadGlb(url, dest)
    } catch (error) {
      if (Date.now() > deadline) throw error
      console.error(`${error.message}, pido la URL otra vez`)
      await sleep(POLL_MS)
      task = await waitTask(taskId, deadline)
    }
  }
}

function integer(flag, value, min, max) {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${flag} tiene que ser un entero de ${min} a ${max}, no "${value}"`)
  }
  return n
}

// Sin el -- de "npm run tripo -- ...", npm se queda con las opciones y las deja en
// npm_config_*: el script recibiria solo el prompt y el pedido saldria pago,
// incluso con --dry-run, que tambien es una opcion de npm.
const SCRIPT_OPTIONS = ['name', 'image', 'faces', 'timeout', 'task', 'dry_run', 'balance']

// strict: una opcion mal escrita (--balence, -balance) corta aca, antes de pagar,
// en vez de terminar como texto del prompt.
function parseCli(argv) {
  const eaten = SCRIPT_OPTIONS.filter((key) => process.env[`npm_config_${key}`] !== undefined)
  if (eaten.length) {
    const flags = eaten.map((key) => '--' + key.replace('_', '-')).join(' ')
    throw new Error(
      `npm se quedo con ${flags}. Van despues de --: npm run tripo -- --name yelmo "..."`
    )
  }
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      image: { type: 'string' },
      faces: { type: 'string' },
      timeout: { type: 'string' },
      task: { type: 'string' },
      balance: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  const args = {
    name: values.name,
    image: values.image,
    task: values.task,
    faces: integer('faces', values.faces, 50, 20000),
    timeout: integer('timeout', values.timeout, 1, DEADLINE_S),
    balance: values.balance,
    dryRun: values['dry-run'],
    help: values.help,
    prompt: positionals.join(' ').trim()
  }
  if (args.help || args.balance) return args
  for (const flag of ['name', 'task']) {
    if (args[flag] !== undefined && !/^[\w-]+$/.test(args[flag])) {
      throw new Error(`--${flag} solo acepta letras, numeros, _ y -`)
    }
  }
  const sources = [args.prompt, args.image, args.task].filter(Boolean).length
  if (sources !== 1) throw new Error('Va uno solo: un prompt, --image o --task.\n\n' + USAGE)
  if (args.prompt.startsWith('/')) {
    throw new Error(`"${args.prompt}" parece una opcion. Usa --help.`)
  }
  if (args.prompt.length > 1024) throw new Error('El prompt pasa los 1024 caracteres.')
  if (args.image && !IMAGE_TYPES[path.extname(args.image).toLowerCase()]) {
    throw new Error('La imagen tiene que ser PNG o JPEG.')
  }
  return args
}

async function main() {
  const args = parseCli(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  if (args.balance) {
    const data = await tripo(`${BASE}/account/balance`)
    console.log(`balance ${data.balance}  frozen ${data.frozen}`)
    return
  }

  const faces = args.faces || (args.image ? 5000 : 3000)
  const timeout = args.timeout || DEADLINE_S
  const what = args.task
    ? `retomar ${args.task}`
    : args.image
      ? `imagen ${args.image}`
      : `prompt "${args.prompt}"`
  console.error(
    `pedido: ${what}, caras ${faces}, nombre ${args.name || 'el task_id'}, corte ${timeout} s`
  )
  if (args.dryRun) return
  apiKey()

  if (!args.task) console.error('creando la tarea...')
  const taskId =
    args.task ||
    (args.image
      ? await createImageTask(args.image, faces)
      : await createTextTask(args.prompt, faces))
  console.error(`tarea ${taskId}`)
  const resume = `node scripts/tripo-generate.js --task ${taskId}${args.name ? ` --name ${args.name}` : ''}`

  try {
    const task = await waitTask(taskId, Date.now() + timeout * 1000)
    const dest = path.join(OUT_DIR, `${args.name || taskId}.glb`)
    await downloadTask(taskId, task, dest)
    if (task.credits_consumed !== undefined) console.error(`creditos ${task.credits_consumed}`)
    console.log(dest)
  } catch (error) {
    // La tarea ya existe y Tripo la cobra si termina: se retoma sin pagar otra.
    error.message += `\npara retomarla sin pagar otra: ${resume}`
    throw error
  }
}

main().catch((error) => {
  console.error(error.message)
  // process.exit(1) despues de varios fetch rompe Node 24 en Windows con un assert
  // de libuv (0xC0000409). Con exitCode el proceso sale solo, con codigo 1.
  process.exitCode = 1
})
