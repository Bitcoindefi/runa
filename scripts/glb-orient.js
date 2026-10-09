#!/usr/bin/env node
'use strict'

// Deja un GLB de Tripo como lo espera un auto-rig: mirando hacia +z (la
// convencion de glTF) y parado en y = 0. Tripo entrega los modelos mirando
// hacia +x; el giro de -90 grados sobre y y la subida se aplican a los vertices,
// asi la malla y las texturas quedan iguales.
//
//   node scripts/glb-orient.js entrada.glb salida.glb

const fs = require('fs')

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Uso: node scripts/glb-orient.js entrada.glb salida.glb')
  process.exit(1)
}
const glb = fs.readFileSync(input)
if (glb.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${input} no es un GLB`)
const jsonLength = glb.readUInt32LE(12)
const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength))
const binStart = 20 + jsonLength
const bin = Buffer.from(glb.subarray(binStart + 8, binStart + 8 + glb.readUInt32LE(binStart)))

for (const node of json.nodes) {
  if (node.matrix || node.rotation || node.translation || node.scale) {
    throw new Error(`el nodo ${node.name} tiene su propia transformacion`)
  }
}

// (x, y, z) -> (-z, y, x): -90 grados sobre y, +x pasa a +z.
const turn = (x, y, z) => [-z, y, x]

function each(index, visit) {
  const accessor = json.accessors[index]
  if (accessor.componentType !== 5126) throw new Error('se esperaba float32')
  const view = json.bufferViews[accessor.bufferView]
  const stride = view.byteStride || (accessor.type === 'VEC4' ? 16 : 12)
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0)
  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride
    const next = visit([0, 1, 2].map((k) => bin.readFloatLE(at + k * 4)))
    next.forEach((value, k) => bin.writeFloatLE(value, at + k * 4))
  }
  return accessor
}

let floor = Infinity
for (const mesh of json.meshes) {
  for (const primitive of mesh.primitives) {
    floor = Math.min(floor, json.accessors[primitive.attributes.POSITION].min[1])
  }
}
const done = new Set()
for (const mesh of json.meshes) {
  for (const primitive of mesh.primitives) {
    const { POSITION, NORMAL, TANGENT } = primitive.attributes
    if (!done.has(POSITION)) {
      done.add(POSITION)
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      const accessor = each(POSITION, ([x, y, z]) => {
        const point = turn(x, y - floor, z)
        point.forEach((value, k) => {
          min[k] = Math.min(min[k], value)
          max[k] = Math.max(max[k], value)
        })
        return point
      })
      accessor.min = min
      accessor.max = max
    }
    for (const index of [NORMAL, TANGENT]) {
      if (index === undefined || done.has(index)) continue
      done.add(index)
      each(index, ([x, y, z]) => turn(x, y, z))
    }
  }
}

const pad = (data, fill) => Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, fill)])
const chunk = (data, type) => {
  const head = Buffer.alloc(8)
  head.writeUInt32LE(data.length, 0)
  head.writeUInt32LE(type, 4)
  return Buffer.concat([head, data])
}
const jsonChunk = chunk(pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), 0x4e4f534a)
const binChunk = chunk(pad(bin, 0), 0x004e4942)
const header = Buffer.alloc(12)
header.write('glTF', 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8)
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binChunk]))
console.log(`${output}: mirando hacia +z, subido ${(-floor).toFixed(3)}`)
