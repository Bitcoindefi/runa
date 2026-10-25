// Los NPC en 3D: cada uno es una copia del heroe de Tripo con esqueleto
// (heroe-anim.glb, clonado con SkeletonUtils: la geometria y la textura son una
// sola para todos), con la ropa de su color, a su medida, con su arma o su
// baculo, y vivo: respira en Idle, pasea alrededor de su celda, mira al heroe
// que se acerca y asiente al hablarle. Lo que decide como se ve y por donde
// camina esta en vecinos.js (tripo-vecinos.mjs), sin three.js.
//
// tripo-mundo.js arma primero el dibujo de cada NPC (assets/npcs) y esto lo
// cambia por el modelo cuando llega. Si el modelo no llega, queda el dibujo.
import * as THREE from 'three'
import {
  BUDGET,
  createWander,
  gesture,
  greet as greetWander,
  lookOf,
  pickActive,
  seeded,
  stepWander,
  walkScale,
  wanderSpots
} from './vecinos.js'

const RIG = 'heroe-anim.glb'
// Los huesos que no cambian de color: la cara, el cuello y las manos.
const KEEP = new Set(['Head', 'head_end', 'headfront', 'neck', 'LeftHand', 'RightHand'])
const HEAD = new Set(['Head', 'head_end', 'headfront'])

/**
 * Cuelga de los huesos del antebrazo un soporte por mano, con los ejes del brazo
 * caido en la pose de reposo (+y hacia el codo, +z al frente). `space` es el
 * grupo donde se miden; los soportes (holders.left_hand, holders.right_hand)
 * siguen despues la animacion. El arma va en la palma, pasando la muneca hacia
 * los dedos; el escudo, en el medio del antebrazo. Lo usan el heroe y los NPC.
 */
export function hangHands(object, space, holders) {
  space.updateMatrixWorld(true)
  const spot = (name) => {
    const bone = object.getObjectByName(name)
    return bone && space.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))
  }
  for (const [slot, elbow, wrist, bone, reach] of [
    ['left_hand', 'LeftForeArm', 'LeftHand', 'LeftHand', 1.3],
    ['right_hand', 'RightForeArm', 'RightHand', 'RightForeArm', 0.55]
  ]) {
    const from = spot(elbow)
    const to = spot(wrist)
    const holder = holders[slot]
    const host = object.getObjectByName(bone)
    if (!from || !to || !host || !holder) continue
    const up = from.clone().sub(to).normalize()
    const front = new THREE.Vector3(0, 0, 1)
    front.addScaledVector(up, -front.dot(up)).normalize()
    const side = new THREE.Vector3().crossVectors(up, front)
    holder.position.copy(from).lerp(to, reach)
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, front))
    holder.updateMatrixWorld(true)
    host.attach(holder)
    // El giro de reposo, para sumarle el tajo en la pelea.
    holder.userData.base = holder.quaternion.clone()
  }
}

// --- La ropa de color ----------------------------------------------------------

// La gorra del heroe (la banda dorada y el techo marron) empieza a esta altura
// de la cabeza, medida en sus vertices: abajo quedan la cara y los ojos.
const CAP_FROM = 0.63

// Por vertice, en el atributo npcDye: x es cuanto pesa lo que no cambia de color
// (la cara, el cuello, las manos) e y si es la gorra, que se tine aparte. Se
// calcula una vez sobre la geometria compartida, en la pose de reposo.
function markDye(mesh) {
  const geometry = mesh.geometry
  if (geometry.getAttribute('npcDye')) return
  const keeps = mesh.skeleton.bones.map((bone) => KEEP.has(bone.name))
  const heads = mesh.skeleton.bones.map((bone) => HEAD.has(bone.name))
  const index = geometry.getAttribute('skinIndex')
  const weight = geometry.getAttribute('skinWeight')
  const position = geometry.getAttribute('position')
  const dye = new Float32Array(index.count * 2)
  const heights = new Float32Array(index.count)
  const head = new Float32Array(index.count)
  const v = new THREE.Vector3()
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < index.count; i++) {
    let keep = 0
    let top = 0
    for (let k = 0; k < 4; k++) {
      const bone = index.getComponent(i, k)
      if (keeps[bone]) keep += weight.getComponent(i, k)
      if (heads[bone]) top += weight.getComponent(i, k)
    }
    dye[i * 2] = Math.min(1, keep)
    head[i] = top
    v.fromBufferAttribute(position, i)
    mesh.applyBoneTransform(i, v)
    heights[i] = v.applyMatrix4(mesh.matrixWorld).y
    if (top >= 0.6) {
      low = Math.min(low, heights[i])
      high = Math.max(high, heights[i])
    }
  }
  if (high > low) {
    const cut = low + (high - low) * CAP_FROM
    for (let i = 0; i < index.count; i++) {
      if (head[i] < 0.3 || heights[i] < cut) continue
      dye[i * 2] = 0
      dye[i * 2 + 1] = 1
    }
  }
  geometry.setAttribute('npcDye', new THREE.BufferAttribute(dye, 2))
}

// Un material por color, compartido por todos los mapas: la textura del heroe
// con la ropa llevada hacia `tint` y la gorra hacia `cap`, segun su luz.
const dyes = new Map()
function dyed(base, tint, mix, cap) {
  if (!tint || !mix) return base
  const key = base.uuid + ':' + tint + ':' + mix + ':' + cap
  if (!dyes.has(key)) {
    const material = base.clone()
    const cloth = new THREE.Color(tint)
    const hat = new THREE.Color(cap === null || cap === undefined ? tint : cap)
    material.onBeforeCompile = (shader) => {
      shader.uniforms.npcTint = { value: cloth }
      shader.uniforms.npcCap = { value: hat }
      shader.uniforms.npcMix = { value: mix }
      shader.vertexShader =
        'attribute vec2 npcDye;\nvarying vec2 vNpcDye;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvNpcDye = npcDye;'
        )
      shader.fragmentShader =
        'uniform vec3 npcTint;\nuniform vec3 npcCap;\nuniform float npcMix;\nvarying vec2 vNpcDye;\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n' +
            '{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
            '  vec3 dye = mix(npcTint, npcCap, vNpcDye.y) * (0.3 + 1.7 * l);\n' +
            '  float k = mix(npcMix, 0.88, vNpcDye.y) * (1.0 - vNpcDye.x);\n' +
            '  diffuseColor.rgb = mix(diffuseColor.rgb, dye, k); }'
        )
    }
    material.customProgramCacheKey = () => 'runa-npc-dye'
    dyes.set(key, material)
  }
  return dyes.get(key)
}

// --- Lo que llevan en la mano -----------------------------------------------------

// Piezas hechas a mano, compartidas: el baculo, el cetro, la corona y, en el
// telefono, las armas (los GLB de Tripo pesan de 3 a 5 MB cada uno).
const kit = {}
function stuff() {
  if (kit.wood) return kit
  kit.wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 })
  kit.iron = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.75, roughness: 0.35 })
  kit.gold = new THREE.MeshStandardMaterial({
    color: 0xe2b84a,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0x5a3a08,
    emissiveIntensity: 0.4
  })
  kit.face = new THREE.MeshStandardMaterial({ color: 0x8a2a24, roughness: 0.7 })
  kit.gems = new Map()
  kit.rod = new THREE.CylinderGeometry(0.024, 0.03, 1, 6)
  kit.cone = new THREE.ConeGeometry(0.05, 0.22, 6)
  kit.box = new THREE.BoxGeometry(1, 1, 1)
  kit.gem = new THREE.IcosahedronGeometry(0.07, 0)
  kit.disc = new THREE.CylinderGeometry(0.3, 0.3, 0.045, 14).rotateX(Math.PI / 2)
  kit.arc = new THREE.TorusGeometry(0.62, 0.022, 5, 14, Math.PI).rotateZ(-Math.PI / 2)
  kit.ring = new THREE.CylinderGeometry(1, 0.9, 1, 12, 1, true)
  kit.spike = new THREE.ConeGeometry(1, 1, 4)
  return kit
}
function gemOf(color) {
  const k = stuff()
  if (!k.gems.has(color)) {
    k.gems.set(
      color,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.1,
        roughness: 0.25
      })
    )
  }
  return k.gems.get(color)
}
function bit(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  return mesh
}

// Un arma parada sobre +y con el agarre en el origen, como fitWeapon.
function simpleWeapon(id) {
  const k = stuff()
  const g = new THREE.Group()
  if (id === 'spear') {
    g.add(bit(k.rod, k.wood, 0, 0.4, 0, 1, 2.1, 1), bit(k.cone, k.iron, 0, 1.55, 0))
  } else if (id === 'warhammer') {
    g.add(
      bit(k.rod, k.wood, 0, 0.3, 0, 1, 0.95, 1),
      bit(k.box, k.iron, 0, 0.78, 0, 0.3, 0.16, 0.16)
    )
  } else if (id === 'longbow') {
    g.add(bit(k.arc, k.wood, 0, 0, 0), bit(k.rod, k.iron, -0.02, 0, 0, 0.15, 1.24, 0.15))
  } else {
    // La espada.
    g.add(
      bit(k.box, k.iron, 0, 0.5, 0, 0.06, 0.8, 0.015),
      bit(k.box, k.gold, 0, 0.08, 0, 0.22, 0.04, 0.05),
      bit(k.rod, k.wood, 0, -0.02, 0, 1, 0.16, 1)
    )
  }
  return g
}

// El baculo llega al suelo desde la mano (a `hand` metros del piso). El cetro
// del rey es igual de largo pero de oro, con una gema grande en un aro: un baston
// corto se perdia contra su ropa dorada.
function staffOf(look, hand) {
  const k = stuff()
  const g = new THREE.Group()
  const top = look.height * 0.55
  const length = hand + top
  if (look.scepter) {
    g.add(
      bit(k.rod, k.gold, 0, (top - hand) / 2, 0, 1.5, length, 1.5),
      bit(k.ring, k.gold, 0, top + 0.02, 0, 0.09, 0.06, 0.09),
      bit(k.gem, gemOf(look.staff), 0, top + 0.1, 0, 1.7, 1.7, 1.7)
    )
    return g
  }
  g.add(
    bit(k.rod, k.wood, 0, (top - hand) / 2, 0, 1.1, length, 1.1),
    bit(k.gem, gemOf(look.staff), 0, top + 0.06, 0, 1.2, 1.2, 1.2)
  )
  return g
}

function crownOf(width) {
  const k = stuff()
  const r = width * 0.42
  const g = new THREE.Group()
  g.add(bit(k.ring, k.gold, 0, 0.05, 0, r, 0.1, r))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.add(
      bit(k.spike, k.gold, Math.sin(a) * r * 0.95, 0.15, Math.cos(a) * r * 0.95, 0.035, 0.1, 0.035)
    )
  }
  g.add(bit(k.gem, gemOf(0xe23a3a), 0, 0.06, r * 0.98, 0.5, 0.5, 0.5))
  return g
}

// Pone la pieza en el soporte de la mano. 'up' (la lanza) y 'bow' (el arco) van
// parados: townsfolk los deja verticales. 'rest': el arma al frente y un poco
// abajo, como el heroe que corre. El escudo va en el antebrazo, mirando afuera y
// adelante.
function gripOf(object, slot, hold) {
  const grip = new THREE.Group()
  grip.add(object)
  if (slot === 'right_hand') {
    grip.rotation.y = -0.85
    grip.position.set(-0.07, 0, 0.05)
  } else if (hold === 'rest') grip.rotation.x = Math.PI / 2 + 0.3
  return grip
}

// --- Los NPC ---------------------------------------------------------------------

/**
 * Los NPC de un mapa en 3D. `entries` son los de tripo-mundo.js: { npc, home
 * (Vector3 del centro de su celda), tag (el cartel del nombre), sprite, body,
 * rig }. `walkable(x, y)` dice que celdas se pisan. `extras` trae de la pagina
 * rig(file) (el GLB con esqueleto, clonado), prop(id) (el GLB de un arma o
 * escudo ya parado y medido, o null) y budget ('phone' o 'desktop').
 * Devuelve { update(time, hero), greet(id), info(), dispose() }.
 */
export function townsfolk({ mapId, entries, group, walkable, cx, cz, extras, moveBlob }) {
  const phone = extras.budget === 'phone'
  const budget = phone ? BUDGET.phone : BUDGET.desktop
  const homes = new Set(entries.map((entry) => entry.npc.x + ',' + entry.npc.y))
  const rigs = []
  let alive = true
  let loading = entries.length
  let failed = 0
  const props = new Map()

  // Un arma de Tripo, medida una vez por mapa y copiada para cada NPC.
  const propOf = (id, slot) => {
    if (phone || !extras.prop) return Promise.resolve(null)
    const key = id + ':' + slot
    if (!props.has(key)) {
      props.set(
        key,
        extras.prop(id, slot).catch(() => null)
      )
    }
    return props.get(key).then((piece) => (piece ? piece.clone(true) : null))
  }

  async function dress(entry, index) {
    const { npc } = entry
    const look = lookOf(mapId, npc)
    const rand = seeded(look.seed)
    const { object, clips } = await extras.rig(RIG)
    if (!alive) return
    // A su medida, con los pies en el suelo y centrado en la celda.
    object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(object)
    object.scale.multiplyScalar(look.height / box.getSize(new THREE.Vector3()).y)
    object.scale.x *= look.slim
    object.scale.z *= look.slim
    object.updateMatrixWorld(true)
    const placed = new THREE.Box3().setFromObject(object)
    const mid = placed.getCenter(new THREE.Vector3())
    object.position.x -= mid.x
    object.position.z -= mid.z
    object.position.y -= placed.min.y
    const root = new THREE.Group()
    // Para encontrarlo desde la consola: scene.getObjectByName('npc:alma').
    root.name = 'npc:' + npc.id
    root.add(object)
    root.position.copy(entry.home)
    // Comparte geometria y materiales con el heroe: el mapa no los libera.
    root.userData.shared = true
    let skinned = null
    object.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = !phone
      if (child.isSkinnedMesh) {
        skinned = child
        markDye(child)
        child.material = dyed(child.material, look.tint, look.mix, look.cap)
      }
    })
    root.updateMatrixWorld(true)
    if (skinned) {
      // El cuadro de la pose de reposo, agrandado para los brazos al caminar:
      // asi el recorte deja afuera a los que no se ven.
      skinned.computeBoundingSphere()
      skinned.boundingSphere.radius *= 1.3
      skinned.frustumCulled = true
    }
    const holders = { left_hand: new THREE.Group(), right_hand: new THREE.Group() }
    root.add(holders.left_hand, holders.right_hand)
    hangHands(object, root, holders)
    if (look.crown && skinned) {
      const head = headOf(skinned, root)
      const bone = object.getObjectByName('Head')
      if (head && bone) {
        const crown = crownOf(head.width)
        crown.position.set(head.x, head.top - head.width * 0.12, head.z)
        root.add(crown)
        root.updateMatrixWorld(true)
        bone.attach(crown)
      }
    }
    // Idle con su fase y su ritmo; Walk para pasear.
    const mixer = new THREE.AnimationMixer(object)
    const actions = {}
    for (const name of ['Idle', 'Walk']) {
      const clip = THREE.AnimationClip.findByName(clips, name)
      if (clip) actions[name] = mixer.clipAction(clip)
    }
    if (!actions.Idle) throw new Error('el heroe de Tripo no trae Idle')
    const idleRate = 0.85 + rand() * 0.3
    actions.Idle.timeScale = idleRate
    actions.Idle.play()
    actions.Idle.time = rand() * actions.Idle.getClip().duration
    mixer.update(0)
    // Lo que va en la mano, medido con el heroe de 2,1 m. La lanza, el arco, el
    // baculo y el cetro van parados (`stands`): siguen a la mano por el piso pero
    // no se inclinan con el antebrazo, que en Idle cae en diagonal. La palma se
    // mide ya en Idle: a esa altura queda el agarre y el baculo llega al suelo.
    root.updateMatrixWorld(true)
    const palm = root.worldToLocal(holders.left_hand.getWorldPosition(new THREE.Vector3()))
    const stands = []
    const stand = (piece) => {
      const holder = new THREE.Group()
      holder.position.copy(palm)
      holder.add(piece)
      root.add(holder)
      stands.push(holder)
    }
    const scale = look.height / 2.1
    const pieces = []
    if (look.weapon) pieces.push(['left_hand', look.weapon, look.hold])
    if (look.shield) pieces.push(['right_hand', 'shield', 'rest'])
    for (const [slot, id, hold] of pieces) {
      let piece = await propOf(id, slot)
      if (!alive) return
      if (!piece && id === 'shield') piece = bit(stuff().disc, stuff().face, 0, 0, 0)
      if (!piece) piece = simpleWeapon(id)
      // La pieza de la pagina ya trae su agarre (handPiece).
      const grip = piece.userData.grip ? piece : gripOf(piece, slot, hold)
      grip.scale.multiplyScalar(scale)
      if (hold === 'up' || hold === 'bow') {
        grip.rotation.set(0, 0, 0)
        stand(grip)
      } else holders[slot].add(grip)
    }
    if (look.staff) stand(staffOf(look, palm.y))
    const spots = wanderSpots({ x: npc.x, y: npc.y }, walkable, rand, {
      cx,
      cz,
      radius: look.roam,
      count: 2 + Math.floor(rand() * 2),
      avoid: (x, y) => homes.has(x + ',' + y)
    })
    const wander = createWander(spots, rand, (rand() - 0.5) * 1.2)
    root.rotation.y = wander.yaw
    if (!alive) return
    group.add(root)
    // El dibujo o la figura de antes se van: queda el modelo.
    if (entry.sprite) group.remove(entry.sprite)
    if (entry.body) group.remove(entry.body)
    // El modelo esta parado de verdad (el dibujo se inclinaba hacia la camara):
    // el nombre va justo sobre la cabeza, como el de los otros jugadores.
    entry.tag.position.y = look.height + (look.crown ? 0.22 : 0) + 0.32
    entry.rig = {
      index,
      look,
      root,
      object,
      skinned,
      mixer,
      actions,
      idleRate,
      gait: 'Idle',
      wander,
      palm: holders.left_hand,
      stands,
      head: object.getObjectByName('Head'),
      spine: object.getObjectByName('Spine01') || object.getObjectByName('Spine'),
      active: false
    }
    settle(entry.rig, true)
    rigs.push(entry.rig)
  }

  // Lo que va parado sigue a la palma por el piso (x, z), siempre vertical.
  const at = new THREE.Vector3()
  function holdUp(rig) {
    if (!rig.stands.length) return
    rig.root.worldToLocal(rig.palm.getWorldPosition(at))
    for (const holder of rig.stands) {
      holder.position.x = at.x
      holder.position.z = at.z
    }
  }

  // Quieto en su pose (fuera del presupuesto): three.js deja de rehacer en cada
  // cuadro las matrices de sus huesos y de lo que lleva, que siguen valiendo.
  function settle(rig, still) {
    if (still) {
      holdUp(rig)
      rig.root.updateMatrixWorld(true)
    }
    rig.root.traverse((node) => {
      node.matrixAutoUpdate = !still
    })
  }

  entries.forEach((entry, index) => {
    dress(entry, index)
      .catch((error) => {
        failed++
        console.warn('NPC sin modelo 3D', entry.npc.name, error)
      })
      .finally(() => {
        loading--
      })
  })

  // Cambia de clip con un fundido corto.
  function play(rig, name, scale) {
    const next = rig.actions[name] || rig.actions.Idle
    if (rig.gait === name) {
      if (name === 'Walk') next.timeScale += (scale - next.timeScale) * 0.2
      return
    }
    const last = rig.actions[rig.gait]
    next.reset()
    next.timeScale = name === 'Walk' ? scale : rig.idleRate
    next.fadeIn(0.25).play()
    if (last && last !== next) last.fadeOut(0.25)
    rig.gait = name
  }

  const axis = new THREE.Vector3()
  const parentTurn = new THREE.Quaternion()
  const bend = new THREE.Quaternion()
  // Gira un hueso sobre un eje del mundo, sumado a lo que puso la animacion.
  function lean(bone, worldAxis, angle) {
    if (!bone || !angle) return
    bone.parent.getWorldQuaternion(parentTurn).invert()
    axis.copy(worldAxis).applyQuaternion(parentTurn).normalize()
    bone.quaternion.premultiply(bend.setFromAxisAngle(axis, angle))
  }

  let last = null
  let kept = new Set()
  const right = new THREE.Vector3()
  const forward = new THREE.Vector3()
  return {
    update(time, hero) {
      const dt = last === null ? 0 : Math.min(0.1, Math.max(0, time - last))
      last = time
      if (!rigs.length) return
      const list = rigs.map((rig) => ({
        i: rig.index,
        d: hero ? Math.hypot(rig.root.position.x - hero.x, rig.root.position.z - hero.z) : 0
      }))
      const active = pickActive(list, budget.rigs, budget.range, kept)
      kept = active
      for (const rig of rigs) {
        const on = active.has(rig.index)
        if (!on) {
          // Fuera del presupuesto: quieto en Idle, sin gastar en el esqueleto.
          if (rig.active) {
            rig.active = false
            play(rig, 'Idle', 1)
            for (const action of Object.values(rig.actions)) {
              if (action !== rig.actions.Idle) action.stop()
            }
            rig.actions.Idle.setEffectiveWeight(1)
            rig.mixer.update(0)
            settle(rig, true)
          }
          continue
        }
        if (!rig.active) {
          rig.active = true
          settle(rig, false)
        }
        const home = entries[rig.index].home
        const w = stepWander(
          rig.wander,
          dt,
          hero ? { x: hero.x - home.x, z: hero.z - home.z } : null
        )
        rig.root.position.set(home.x + w.x, home.y, home.z + w.z)
        rig.root.rotation.y = w.yaw
        play(rig, w.gait, walkScale(w.speed, rig.look.height))
        rig.mixer.update(dt)
        holdUp(rig)
        // El nombre y la sombra lo siguen, solo si se movio.
        const tag = entries[rig.index].tag
        if (tag.position.x !== rig.root.position.x || tag.position.z !== rig.root.position.z) {
          tag.position.x = rig.root.position.x
          tag.position.z = rig.root.position.z
          if (moveBlob) moveBlob(rig.index, rig.root.position.x, rig.root.position.z)
        }
        // El gesto de hablar: asiente con la cabeza y se mece un poco.
        const g = gesture(w.talk)
        if (g.nod || g.sway) {
          right.set(Math.cos(w.yaw), 0, -Math.sin(w.yaw))
          forward.set(Math.sin(w.yaw), 0, Math.cos(w.yaw))
          lean(rig.head, right, g.nod)
          lean(rig.spine, forward, g.sway)
        }
      }
    },
    // Al hablarle: a su celda y el gesto. Sin modelo, el dibujo da un saltito.
    greet(id) {
      const entry = entries.find((one) => one.npc.id === id)
      if (!entry) return false
      entry.talk = 0.5
      if (!entry.rig) return true
      greetWander(entry.rig.wander)
      const rig = entry.rig
      rig.root.position.copy(entry.home)
      // Quieto, sus matrices no se rehacen solas.
      if (!rig.active) {
        rig.root.updateMatrix()
        rig.root.updateMatrixWorld(true)
      }
      entry.tag.position.x = entry.home.x
      entry.tag.position.z = entry.home.z
      if (moveBlob) moveBlob(rig.index, entry.home.x, entry.home.z)
      return true
    },
    info() {
      return {
        loading,
        failed,
        rigs: rigs.length,
        animated: rigs.filter((rig) => rig.active).length,
        budget,
        list: entries.map((entry) => {
          const rig = entry.rig
          const at = (rig ? rig.root : entry.sprite || entry.body || entry.tag).position
          return {
            id: entry.npc.id,
            look: rig ? '3d' : entry.sprite ? 'sprite' : entry.body ? 'figure' : 'none',
            active: !!(rig && rig.active),
            gait: rig ? rig.gait : null,
            talking: !!(rig && rig.wander.talk > 0),
            home: Number(Math.hypot(at.x - entry.home.x, at.z - entry.home.z).toFixed(2)),
            at: at.toArray().map((n) => Number(n.toFixed(2))),
            yaw: rig ? Number(rig.root.rotation.y.toFixed(2)) : null
          }
        })
      }
    },
    dispose() {
      alive = false
      for (const rig of rigs) {
        rig.mixer.stopAllAction()
        rig.mixer.uncacheRoot(rig.object)
        if (rig.skinned) rig.skinned.skeleton.dispose()
      }
      rigs.length = 0
    }
  }
}

// La cabeza en la pose de reposo, en el espacio de `space`: el centro, la
// coronilla y el ancho, de los vertices que mueve el hueso de la cabeza.
function headOf(mesh, space) {
  space.updateMatrixWorld(true)
  const bones = mesh.skeleton.bones.map((bone) => HEAD.has(bone.name))
  const index = mesh.geometry.getAttribute('skinIndex')
  const weight = mesh.geometry.getAttribute('skinWeight')
  const position = mesh.geometry.getAttribute('position')
  const toSpace = new THREE.Matrix4().copy(space.matrixWorld).invert().multiply(mesh.matrixWorld)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (bones[index.getComponent(i, k)]) w += weight.getComponent(i, k)
    if (w < 0.6) continue
    v.fromBufferAttribute(position, i)
    mesh.applyBoneTransform(i, v)
    box.expandByPoint(v.applyMatrix4(toSpace))
  }
  if (box.isEmpty()) return null
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  return { x: center.x, z: center.z, top: box.max.y, width: Math.max(size.x, size.z) }
}
