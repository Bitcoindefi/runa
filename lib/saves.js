'use strict'

const fs = require('bare-fs')
const path = require('bare-path')

const SLOT_COUNT = 3
const SAVE_FORMAT = 1

class SaveSlotError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SaveSlotError'
  }
}

function slotNumber(value) {
  const slot = Math.floor(Number(value))
  if (slot < 1 || slot > SLOT_COUNT) {
    throw new SaveSlotError(`la ranura ${value} no existe`)
  }
  return slot
}

function slotPath(dir, slot) {
  return path.join(dir, `slot-${slotNumber(slot)}.json`)
}

function isMissing(err) {
  return !!err && (err.code === 'ENOENT' || String(err.message || '').includes('ENOENT'))
}

function validate(raw) {
  if (!raw || typeof raw !== 'object') throw new SaveSlotError('el guardado no se entiende')

  const format = Math.floor(Number(raw.format) || 0)
  if (format > SAVE_FORMAT) {
    throw new SaveSlotError(
      `el guardado usa el formato ${format} y este juego llega hasta ${SAVE_FORMAT}`
    )
  }
  if (format !== SAVE_FORMAT || !raw.player || typeof raw.player !== 'object') {
    throw new SaveSlotError('el guardado esta incompleto')
  }

  return raw
}

function descriptor(slot, data) {
  const summary = (data && data.summary) || {}
  const location = (data && data.location) || {}
  return {
    slot,
    empty: false,
    corrupt: false,
    name: String((data && data.name) || 'viajero'),
    level: Math.max(1, Math.floor(Number(summary.level) || 1)),
    place: String(summary.place || location.place || location.kind || 'ciudad'),
    savedAt: String((data && data.savedAt) || '')
  }
}

class SaveStore {
  constructor(dir) {
    if (!dir) throw new SaveSlotError('falta el directorio de partidas')
    this.dir = String(dir)
  }

  ensure() {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  list() {
    const slots = []
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      try {
        slots.push(descriptor(slot, this.load(slot)))
      } catch (err) {
        if (isMissing(err)) {
          slots.push({ slot, empty: true, corrupt: false })
        } else {
          slots.push({
            slot,
            empty: false,
            corrupt: true,
            name: 'GUARDADO DANADO',
            level: 1,
            place: 'usa N para reemplazarlo',
            error: String(err && err.message ? err.message : err)
          })
        }
      }
    }
    return slots
  }

  load(slot) {
    const file = slotPath(this.dir, slot)
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if (isMissing(err)) throw err
      throw new SaveSlotError(`no se pudo leer la ranura ${slotNumber(slot)}`)
    }

    try {
      return validate(JSON.parse(text))
    } catch (err) {
      if (err instanceof SaveSlotError) throw err
      throw new SaveSlotError(`la ranura ${slotNumber(slot)} tiene JSON invalido`)
    }
  }

  save(slot, state) {
    const number = slotNumber(slot)
    this.ensure()

    const data = validate({
      ...state,
      format: SAVE_FORMAT,
      savedAt: new Date().toISOString()
    })
    const file = slotPath(this.dir, number)
    const temporary = file + '.tmp'

    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8')
    try {
      fs.renameSync(temporary, file)
    } catch (err) {
      try {
        fs.unlinkSync(temporary)
      } catch {}
      throw new SaveSlotError(`no se pudo escribir la ranura ${number}: ${err.message}`)
    }

    return descriptor(number, data)
  }
}

module.exports = {
  SaveStore,
  SaveSlotError,
  SLOT_COUNT,
  SAVE_FORMAT,
  descriptor
}
