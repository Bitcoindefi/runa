// El escenario del menu de titulo: lo que se ve detras de los botones mientras
// el Coloso de Tripo gira y el heroe espera. RUNA es el reino del alba: el heroe
// y el Coloso estan en una meseta volcanica con grietas de lava, sobre un mar de
// nubes; a lo lejos hay montanas y el reino de Tripo (paisaje.glb) asoma detras
// de unas lomas, y el sol sale detras del Coloso.
//
// La pagina (tripo-heroe.html, titleScene) llama a buildTitle una vez, la
// primera vez que muestra el menu, y despues show(true) o show(false) al entrar
// y salir del titulo. Devuelve null si no arma nada: queda la vitrina de siempre.
//
// Recibe `ctx`: scene, camera, controls, renderer, sun, sky (la luz de
// hemisferio), ember (la luz calida), ground y ring (el piso de la vitrina),
// ash (la ceniza), hero (el stickman y el heroe de Tripo), models() (los GLB que
// hay, Map nombre -> version), loadGlb(file), mapData(id), buildWorld,
// backdrop() (el Coloso que la pagina pone de fondo, o null) y effects (el
// postproceso de efectos.js, para los rayos de sol; puede faltar).
//
// Devuelve { show(on), update(time, dt), dispose() }. show(true) guarda lo que
// el titulo cambia de la escena (niebla, luces, camara, ambiente) y show(false)
// lo devuelve tal cual, asi el mapa o la vitrina que siguen no heredan nada.
//
// La camara gira despacio alrededor del heroe y del Coloso. Lo lejano (el cielo,
// el sol, las montanas, el reino) gira con ella, como un telon: el alba queda
// siempre detras del Coloso. Lo cercano (la meseta, las ruinas, las nubes de
// abajo, las brasas) queda fijo en el mundo y es lo que se ve girar. La luz que
// modela al heroe tambien sigue a la camara, desde atras a la derecha.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import {
  createSky,
  dressSky,
  skyDirection,
  skyNoise,
  tileNoise,
  random,
  smooth
} from './efectos.js'

// Lo lejano se ubica respecto de la camara: -z es hacia donde mira y +x su
// derecha; los angulos son grados hacia la derecha del centro de la vista.
const SUN = { angle: 9, elevation: 3.4 }
// La luz que modela: atras y a la derecha, mas alta que el sol que se ve. La de
// relleno, fria como el cielo del alba, llega de adelante a la izquierda.
const KEY = { angle: 70, elevation: 30 }
const FILL = { angle: -145, elevation: 22 }
// El reino de Tripo, a la izquierda del heroe: a 190 m, con su base (y) tapada
// por una loma del cordon de adelante, que sube `hill` grados en ese rumbo.
const KINGDOM = { angle: -13, distance: 190, width: 40, base: 2, hill: 1.05 }
// La altura de los ojos de la camara del titulo y la del mar de nubes.
const EYE = 2.5
const MIST = -7

// Los colores del alba (sRGB).
const DAWN = {
  fog: 0xcf9f9b,
  mistLit: 0xf2b9a2,
  mistShade: 0x6d5a8a,
  mistGlow: 0xffb36b,
  mistSun: 0xffc994,
  mistAway: 0xb593b4,
  lava: 0xff5a1e,
  hazeSun: 0xd99482,
  hazeAway: 0xb895b8,
  snow: 0xf6dfe2,
  alpenglow: 0xf0a2a6,
  crest: 0xffb37a,
  basalt: [0x221d1d, 0x3b302b],
  scorch: 0x55261a,
  stone: [0x5e544d, 0x82766a],
  key: 0xffc28a,
  fill: 0xaab0e6,
  hemiSky: 0x9a9ad8,
  hemiGround: 0x5c2412,
  ember: 0xff6420
}

// El cielo del alba, con la forma de los climas de efectos.js: el sol bajo
// detras del Coloso, el horizonte dorado hacia el y rosa del otro lado, violeta
// a media altura y el azul hondo arriba, con las ultimas estrellas, y vetas de
// nubes que toman la luz del sol desde abajo.
const DAWN_SKY = {
  sun: [SUN.elevation, SUN.angle],
  air: [4.5, 3, 0.0045, 0.82],
  sky: [0.46, [0.98, 0.96, 1.08]],
  paint: [0xffa040, 0xd9788c, 0x7a5ca8, 0x0f1d52, [0.085, 0.3, 2.5, 0.9]],
  clouds: [0.8, 0.56, 0.18, 0xffb07a, 0x5e4c7e],
  stars: 1.5,
  disc: [0xffd9a8, 2.1, 1.1, 0.12],
  fog: [DAWN.mistAway]
}

// Los cordones de montanas, del fondo hacia adelante, como capas de papel
// recortado: radio en metros, la cresta entre low y high grados sobre el
// horizonte, columnas, color y cuanta bruma del alba lleva cada uno. El del
// fondo tiene nieve; el de adelante, la loma que tapa la base del reino.
const RANGES = [
  {
    radius: 980,
    low: 3,
    high: 8.5,
    seed: 3,
    columns: 260,
    color: 0xa77e98,
    haze: 0.15,
    peaks: true,
    snow: true
  },
  {
    radius: 640,
    low: 1.6,
    high: 5.5,
    seed: 17,
    columns: 220,
    color: 0x7a5a83,
    haze: 0.1,
    peaks: true
  },
  { radius: 380, low: 1.2, high: 3.2, seed: 29, columns: 200, color: 0x4d3a5e, haze: 0.05 },
  { radius: 170, low: 0.3, high: 1.6, seed: 41, columns: 180, color: 0x2a2034, haze: 0.02 }
]

const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function buildTitle(ctx) {
  const { scene, camera, controls, renderer, sun, ember, ground, ash } = ctx
  const hemi = ctx.sky
  const noise = new ImprovedNoise()
  const owned = { geometries: [], materials: [], textures: [] }
  const keep = (thing) => {
    if (thing.isBufferGeometry) owned.geometries.push(thing)
    else if (thing.isMaterial) owned.materials.push(thing)
    else if (thing.isTexture) owned.textures.push(thing)
    return thing
  }

  // root lleva todo; backdrop gira con la camara y stage queda fijo.
  const root = new THREE.Group()
  root.name = 'titulo'
  root.visible = false
  const backdrop = new THREE.Group()
  const stage = new THREE.Group()
  root.add(backdrop, stage)
  scene.add(root)

  const sunLocal = skyDirection(SUN.elevation, SUN.angle)
  const keyLocal = skyDirection(KEY.elevation, KEY.angle)
  const fillLocal = skyDirection(FILL.elevation, FILL.angle)

  // La luz de relleno es del titulo: se va con el.
  const fill = new THREE.DirectionalLight(DAWN.fill, 0.72)
  root.add(fill, fill.target)

  const dawn = dawnSky()
  keep(dawn.geometry)
  keep(dawn.material)
  root.add(dawn)

  const mist = cloudSea(keep)
  stage.add(mist)

  const ridges = mountains(noise, keep)
  backdrop.add(ridges)

  const rock = basaltTextures(renderer, keep)
  const lavaTime = { value: 0 }
  const plateau = volcanicPlateau(noise, rock, lavaTime, keep)
  stage.add(plateau)

  const ruins = ruinsAndRocks(noise, keep)
  stage.add(ruins)

  const sparks = embers(keep)
  stage.add(sparks)

  const reflection = dawnEnvironment(renderer)
  const environment = reflection.texture

  // El reino de Tripo llega cuando baja su GLB.
  let kingdom = null
  let kingdomAsked = false
  function bringKingdom() {
    if (kingdomAsked || !ctx.models || !ctx.models().has('paisaje.glb')) return
    kingdomAsked = true
    ctx
      .loadGlb('paisaje.glb')
      .then((object) => {
        if (disposed) return
        kingdom = placeKingdom(object)
        backdrop.add(kingdom)
      })
      .catch((error) => {
        console.warn('sin el reino de Tripo en el titulo', error)
      })
  }

  // El Coloso de la pagina: sus grietas naranjas brillan en el titulo.
  const runeGlow = { value: 1.4 }
  let glowing = null
  function lightColossus() {
    const holder = ctx.backdrop ? ctx.backdrop() : null
    if (holder === (glowing && glowing.holder)) return
    dimColossus()
    if (!holder) return
    const swaps = []
    holder.traverse((child) => {
      if (!child.isMesh || !child.material || Array.isArray(child.material)) return
      const original = child.material
      const lit = original.clone()
      lit.onBeforeCompile = (shader) => {
        shader.uniforms.runeGlow = runeGlow
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float runeGlow;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float runeHot = smoothstep( 0.18, 0.45, diffuseColor.r - diffuseColor.b ) *
              smoothstep( 0.25, 0.55, diffuseColor.r );
            totalEmissiveRadiance += diffuseColor.rgb * runeHot * runeGlow;`
          )
      }
      child.material = lit
      swaps.push({ child, original, lit })
    })
    glowing = { holder, swaps }
  }
  function dimColossus() {
    if (!glowing) return
    for (const { child, original, lit } of glowing.swaps) {
      if (child.material === lit) child.material = original
      lit.dispose()
    }
    glowing = null
  }

  // Lo que el titulo cambia de la escena, para devolverlo al salir.
  let saved = null
  function save() {
    const shadow = sun.shadow.camera
    saved = {
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      environmentRotation: scene.environmentRotation.clone(),
      fog: [scene.fog.color.clone(), scene.fog.near, scene.fog.far],
      lens: [camera.near, camera.far],
      sun: [sun.color.clone(), sun.intensity, sun.position.clone(), sun.target.position.clone()],
      shadow: [shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far],
      bias: [sun.shadow.bias, sun.shadow.normalBias],
      hemi: [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity],
      ember: [ember.color.clone(), ember.intensity, ember.distance, ember.position.clone()],
      ground: ground.visible,
      ash: ash.visible
    }
  }
  function restore() {
    if (!saved) return
    const s = saved
    scene.environment = s.environment
    scene.environmentIntensity = s.environmentIntensity
    scene.environmentRotation.copy(s.environmentRotation)
    scene.fog.color.copy(s.fog[0])
    scene.fog.near = s.fog[1]
    scene.fog.far = s.fog[2]
    camera.near = s.lens[0]
    camera.far = s.lens[1]
    camera.updateProjectionMatrix()
    sun.color.copy(s.sun[0])
    sun.intensity = s.sun[1]
    sun.position.copy(s.sun[2])
    sun.target.position.copy(s.sun[3])
    const shadow = sun.shadow.camera
    ;[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far] = s.shadow
    shadow.updateProjectionMatrix()
    ;[sun.shadow.bias, sun.shadow.normalBias] = s.bias
    hemi.color.copy(s.hemi[0])
    hemi.groundColor.copy(s.hemi[1])
    hemi.intensity = s.hemi[2]
    ember.color.copy(s.ember[0])
    ember.intensity = s.ember[1]
    ember.distance = s.ember[2]
    ember.position.copy(s.ember[3])
    ground.visible = s.ground
    ash.visible = s.ash
    saved = null
  }

  function apply() {
    scene.environment = environment
    scene.environmentIntensity = 0.75
    scene.fog.color.setHex(DAWN.fog)
    scene.fog.near = 30
    scene.fog.far = 420
    camera.near = 0.2
    camera.far = 2400
    camera.updateProjectionMatrix()
    sun.color.setHex(DAWN.key)
    sun.intensity = 3
    const shadow = sun.shadow.camera
    Object.assign(shadow, { left: -10, right: 10, top: 10, bottom: -10, near: 5, far: 90 })
    shadow.updateProjectionMatrix()
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.02
    hemi.color.setHex(DAWN.hemiSky)
    hemi.groundColor.setHex(DAWN.hemiGround)
    hemi.intensity = 0.85
    ground.visible = false
  }

  // Cada cuadro: lo lejano y la luz siguen a la camara.
  const local = new THREE.Vector3()
  const turn = new THREE.Matrix4()
  const drawing = new THREE.Vector2()
  function aim() {
    const target = controls.target
    const theta = Math.atan2(camera.position.x - target.x, camera.position.z - target.z)
    backdrop.position.set(target.x, 0, target.z)
    backdrop.rotation.y = theta
    dawn.material.uniforms.skyFrame.value.setFromMatrix4(turn.makeRotationY(-theta))
    local.copy(keyLocal).applyAxisAngle(Y_AXIS, theta)
    sun.position.copy(target).addScaledVector(local, 45)
    sun.target.position.set(target.x, 1, target.z)
    sun.target.updateMatrixWorld()
    local.copy(fillLocal).applyAxisAngle(Y_AXIS, theta)
    fill.position.copy(target).addScaledVector(local, 30)
    fill.target.position.set(target.x, 1.2, target.z)
    const sunWorld = mist.material.uniforms.uSun.value
    sunWorld.copy(sunLocal).applyAxisAngle(Y_AXIS, theta)
    // Los rayos de sol del postproceso salen de ahi.
    if (ctx.effects) ctx.effects.shafts(sunWorld)
    scene.environmentRotation.set(0, theta, 0)
  }

  let shown = false
  let disposed = false
  return {
    show(on) {
      if (disposed || on === shown) return
      shown = on
      root.visible = on
      if (on) {
        save()
        apply()
        bringKingdom()
        lightColossus()
        aim()
      } else {
        dimColossus()
        restore()
        if (ctx.effects) ctx.effects.shafts(null)
      }
    },
    update(time) {
      if (!shown) return
      // La pagina puede volver a armar la vitrina mientras el titulo esta: la
      // ceniza de la vitrina no va y la luz calida es la de la lava.
      ash.visible = false
      ground.visible = false
      ember.color.setHex(DAWN.ember)
      ember.intensity = 9 + Math.sin(time * 2.3) * 1.2 + Math.sin(time * 5.1) * 0.6
      ember.distance = 15
      ember.position.set(0.6, 0.9, -3.4)
      bringKingdom()
      lightColossus()
      aim()
      lavaTime.value = time
      runeGlow.value = 1.3 + Math.sin(time * 1.7) * 0.35
      dawn.material.uniforms.time.value = time
      mist.material.uniforms.uTime.value = time
      const points = sparks.material.uniforms
      points.uTime.value = time
      renderer.getDrawingBufferSize(drawing)
      points.uScale.value = drawing.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
    },
    dispose() {
      if (disposed) return
      this.show(false)
      disposed = true
      scene.remove(root)
      if (kingdom) backdrop.remove(kingdom)
      for (const list of Object.values(owned)) for (const thing of list) thing.dispose()
      reflection.dispose()
    }
  }
}

// --- El cielo y el ambiente -----------------------------------------------

function dawnSky() {
  const sky = createSky()
  const u = sky.material.uniforms
  dressSky(u, DAWN_SKY)
  // Un sol un poco mas grande que el de los mapas, y la bruma del horizonte
  // empieza mas abajo: lo de abajo del horizonte lo tapa el mar de nubes.
  u.sunSize.value = 0.02
  u.horizonBand.value.set(-0.14, -0.01, 0.85)
  return sky
}

// El reflejo de los PBR de Tripo: el mismo alba, sin estrellas ni nubes, con el
// suelo oscuro y tibio de la meseta. Se arma una vez con PMREMGenerator.
function dawnEnvironment(renderer) {
  const sky = dawnSky()
  const u = sky.material.uniforms
  u.starAmount.value = 0
  u.cloudShape.value.x = 0
  u.sunGlow.value.set(1, 0.3, 0.3, 0.2)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2a1410 })
  )
  floor.position.y = -1.5
  const room = new THREE.Scene()
  room.add(sky, floor)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(room, 0.03)
  pmrem.dispose()
  sky.geometry.dispose()
  sky.material.dispose()
  floor.geometry.dispose()
  floor.material.dispose()
  return target
}

// --- El mar de nubes ----------------------------------------------------------

// Un plano enorme bajo la meseta: nubes que se mueven despacio, claras donde
// miran al sol, y lejos se funden con el horizonte. Debajo, en algunos lugares,
// la lava las tine de naranja. El ruido es el de las nubes del cielo.
function cloudSea(keep) {
  const color = (hex) => ({ value: new THREE.Color(hex) })
  const material = keep(
    new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: skyNoise() },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(0, 0, -1) },
        cLit: color(DAWN.mistLit),
        cShade: color(DAWN.mistShade),
        cGlow: color(DAWN.mistGlow),
        cSun: color(DAWN.mistSun),
        cAway: color(DAWN.mistAway),
        cLava: color(DAWN.lava)
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4( position, 1.0 );
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise;
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec3 cLit;
        uniform vec3 cShade;
        uniform vec3 cGlow;
        uniform vec3 cSun;
        uniform vec3 cAway;
        uniform vec3 cLava;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          float a = texture2D( uNoise, p * 0.0042 + vec2( uTime * 0.0012, uTime * 0.0005 ) ).r;
          float b = texture2D( uNoise, p * 0.016 + vec2( -uTime * 0.0024, uTime * 0.0017 ) ).r;
          float c = texture2D( uNoise, p * 0.055 + vec2( uTime * 0.004, -uTime * 0.003 ) ).r;
          float density = a * 0.58 + b * 0.3 + c * 0.12;
          vec3 view = vWorld - cameraPosition;
          float dist = length( view.xz );
          vec2 dir = view.xz / max( dist, 0.001 );
          float toSun = max( dot( dir, normalize( uSun.xz ) ), 0.0 );
          float puffs = smoothstep( 0.32, 0.7, density );
          vec3 col = mix( cShade, cLit, puffs );
          col += cGlow * pow( toSun, 5.0 ) * ( 0.25 + 0.75 * puffs );
          float vent = smoothstep( 0.6, 0.78, a ) * ( 1.0 - puffs ) * ( 1.0 - smoothstep( 150.0, 520.0, dist ) );
          col += cLava * vent * 0.9;
          float far = smoothstep( 70.0, 900.0, dist );
          vec3 horizon = mix( cAway, cSun, pow( toSun, 2.5 ) );
          col = mix( col, horizon, far );
          gl_FragColor = vec4( col, 1.0 );
          #include <colorspace_fragment>
        }`
    })
  )
  const mesh = new THREE.Mesh(
    keep(new THREE.CircleGeometry(1900, 48).rotateX(-Math.PI / 2)),
    material
  )
  mesh.position.set(0, MIST, -2)
  mesh.renderOrder = 0
  return mesh
}

// --- Las montanas ---------------------------------------------------------------

// Los cordones de RANGES en anillo, como capas de papel recortado. El color va
// por vertice y se interpola, sin facetas: cada cordon con el suyo, mas claro
// cuanto mas lejos (la bruma del alba), fundido abajo con el mar de nubes y con
// la cresta encendida del lado del sol. Del lado contrario el sol bajo tine de
// rosa las cumbres altas (el arrebol), y en las del fondo hay nieve. Como giran
// con la camara, la luz no cambia y no hace falta calcularla en cada cuadro.
// La base queda apenas bajo el mar de nubes, que la tapa.
function mountains(noise, keep) {
  const sunBearing = THREE.MathUtils.degToRad(SUN.angle)
  const kingdomBearing = THREE.MathUtils.degToRad(KINGDOM.angle)
  const base = MIST - 6
  // Cada columna: la base, dos alturas intermedias y la cresta.
  const ROWS = [0, 0.5, 0.82, 0.95, 1]
  const parts = RANGES.map((range, index) => {
    const crest = ridgeLine(noise, range, index === RANGES.length - 1, sunBearing, kingdomBearing)
    const positions = []
    const colors = []
    const color = new THREE.Color()
    for (let i = 0; i <= range.columns; i++) {
      const a = (i / range.columns) * Math.PI * 2
      const top = EYE + range.radius * Math.tan(THREE.MathUtils.degToRad(crest[i]))
      // Que tan alta es esta cumbre dentro de su cordon (0 a 1): la nieve.
      const peak = (crest[i] - range.low) / (range.high - range.low)
      const toSun = (Math.cos(wrapAngle(a - sunBearing)) + 1) / 2
      for (const t of ROWS) {
        const y = base + (top - base) * t
        positions.push(Math.sin(a) * range.radius, y, -Math.cos(a) * range.radius)
        ridgeColor(color, range, t, peak, toSun)
        colors.push(color.r, color.g, color.b)
      }
    }
    const index_ = []
    const rows = ROWS.length
    for (let i = 0; i < range.columns; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j
        const b = (i + 1) * rows + j
        // Las caras miran hacia el centro, donde esta la camara.
        index_.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(index_)
    return geometry
  })
  const geometry = keep(mergeGeometries(parts))
  for (const part of parts) part.dispose()
  const mesh = new THREE.Mesh(
    geometry,
    keep(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }))
  )
  mesh.frustumCulled = false
  return mesh
}

// La cresta de un cordon, en grados sobre el horizonte, columna por columna:
// ruido en un circulo (cierra sin costura), un valle donde sale el sol y, en el
// cordon de adelante, la loma casi plana que tapa la base del reino.
function ridgeLine(noise, range, front, sunBearing, kingdomBearing) {
  const crest = []
  for (let i = 0; i <= range.columns; i++) {
    const a = (i / range.columns) * Math.PI * 2
    const ring = (k, s) => noise.noise(Math.cos(a) * k + s, Math.sin(a) * k + s, range.seed)
    // Las cordilleras llevan ruido "de crestas" (1 - |ruido|): picos filosos y
    // valles redondos. Las lomas de adelante, ruido comun: ondulan.
    const ridge = (k, s) => (1 - Math.abs(ring(k, s))) ** 2
    let n = range.peaks
      ? (ridge(3, 0.3) * 0.5 +
          ridge(7, 7.1) * 0.3 +
          ridge(17, 3.3) * 0.15 +
          ridge(41, 5.7) * 0.05 -
          0.45) /
        0.5
      : ring(2.2, 0.3) * 0.6 + ring(5.5, 7.1) * 0.3 + ring(13, 3.3) * 0.12 + ring(31, 5.7) * 0.05
    if (!range.peaks) n = n * 0.9 + 0.5
    n = Math.pow(THREE.MathUtils.clamp(n, 0, 1), 1.5)
    let elevation = range.low + (range.high - range.low) * n
    elevation *= 1 - 0.7 * Math.exp(-((wrapAngle(a - sunBearing) / 0.2) ** 2))
    if (front) {
      const off = Math.abs(wrapAngle(a - kingdomBearing))
      const hill = 1 - THREE.MathUtils.smoothstep(off, 0.1, 0.17)
      elevation = Math.max(elevation, KINGDOM.hill * hill + (ring(30, 1.1) * 0.08 + 0.04))
    }
    crest.push(Math.max(0.15, elevation))
  }
  return crest
}

const tmpColor = new THREE.Color()
const hazeSun = new THREE.Color(DAWN.hazeSun)
// El color de un vertice de montana: t es la altura en la columna (0 la base,
// 1 la cresta), peak cuan alta es esa cumbre en su cordon y toSun 1 de cara al
// sol (de contraluz) y 0 del lado contrario (de frente al sol bajo).
function ridgeColor(out, range, t, peak, toSun) {
  // El color de cada cordon es el de contraluz, el que se ve detras del Coloso;
  // del lado contrario el sol bajo lo aclara.
  out.setHex(range.color)
  out.multiplyScalar(1 + 0.35 * (1 - toSun))
  // El arrebol: del lado contrario al sol, las cumbres altas se tinen de rosa.
  const high = THREE.MathUtils.smoothstep(t, 0.45, 1)
  out.lerp(tmpColor.setHex(DAWN.alpenglow), high * (1 - toSun) ** 1.5 * 0.4)
  // La nieve de las cumbres del fondo: rosada de frente al sol, apagada de
  // contraluz.
  if (range.snow && t > 0.6) {
    const snow =
      THREE.MathUtils.smoothstep(peak, 0.45, 0.85) * THREE.MathUtils.smoothstep(t, 0.7, 1)
    tmpColor.setHex(DAWN.snow).lerp(hazeSun, toSun * 0.5)
    out.lerp(tmpColor, snow * (0.85 - toSun * 0.55))
  }
  // La cresta de cara al sol se enciende.
  if (t === 1) out.lerp(tmpColor.setHex(DAWN.crest), toSun ** 4 * 0.55)
  // Bruma: la de cada cordon y, abajo, la del mar de nubes.
  const haze = Math.min(1, range.haze + (1 - t) ** 2 * 0.6)
  tmpColor.setHex(DAWN.hazeAway).lerp(hazeSun, toSun ** 2.2)
  out.lerp(tmpColor, haze)
  return out
}

// El reino de Tripo, del ancho pedido, detras de la loma y mirando a la camara.
function placeKingdom(object) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const dims = box.getSize(new THREE.Vector3())
  object.scale.multiplyScalar(KINGDOM.width / Math.max(dims.x, dims.z))
  object.updateMatrixWorld(true)
  const placed = new THREE.Box3().setFromObject(object)
  const center = placed.getCenter(new THREE.Vector3())
  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= placed.min.y
  const holder = new THREE.Group()
  holder.add(object)
  // Comparte geometria y materiales con el GLB en cache: no se libera aca.
  holder.userData.shared = true
  const at = skyDirection(0, KINGDOM.angle).multiplyScalar(KINGDOM.distance)
  holder.position.set(at.x, KINGDOM.base, at.z)
  holder.rotation.y = -THREE.MathUtils.degToRad(KINGDOM.angle)
  return holder
}

// --- La meseta ------------------------------------------------------------------

// Las texturas de la roca volcanica, hechas a mano en el navegador: una costra
// de basalto con dos redes de grietas (Voronoi con los bordes torcidos). Las
// grandes separan placas de unos 2 m y por algunas asoma la lava; las chicas
// parten cada placa en trozos de medio metro y ya estan frias. Color, relieve
// (mapa de normales), aspereza y brillo, sin costura cada 8 m.
function basaltTextures(renderer, keep) {
  const size = 512
  const warpX = tileNoise(size, 6, 11)
  const warpY = tileNoise(size, 6, 12)
  const grain = tileNoise(size, 48, 13)
  const broad = tileNoise(size, 12, 14)
  // Que grietas siguen vivas: solo algunas brillan, el resto ya se enfrio.
  const alive = tileNoise(size, 4, 15)
  const big = voronoi(size, 4, 7, warpX, warpY, 0.4)
  const small = voronoi(size, 14, 8, warpX, warpY, 0.7)
  // Cada trozo se abomba un poco en el medio, como una costra que se enfrio.
  const height = new Float32Array(size * size)
  for (let k = 0; k < height.length; k++) {
    const dome = Math.max(0, 1 - small.center[k] * 1.3) * 0.16
    height[k] =
      smooth(Math.min(1, big.crack[k] / 0.1)) * 0.6 +
      smooth(Math.min(1, small.crack[k] / 0.14)) * (0.18 + small.plate[k] * 0.1) +
      dome +
      grain[k] * 0.08
  }
  const color = new Uint8Array(size * size * 4)
  const normal = new Uint8Array(size * size * 4)
  const rough = new Uint8Array(size * size * 4)
  const glow = new Uint8Array(size * size * 4)
  const dark = new THREE.Color(DAWN.basalt[0])
  const light = new THREE.Color(DAWN.basalt[1])
  const scorch = new THREE.Color(DAWN.scorch)
  const c = new THREE.Color()
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x
      const live = smooth(Math.min(1, Math.max(0, (alive[k] - 0.38) / 0.3)))
      const core = 1 - smooth(Math.min(1, big.crack[k] / (0.018 + 0.022 * live)))
      const halo = (1 - smooth(Math.min(1, big.crack[k] / 0.12))) * (0.2 + 0.8 * live)
      const groove = 1 - smooth(Math.min(1, small.crack[k] / 0.05))
      c.copy(dark).lerp(light, grain[k] * 0.35 + broad[k] * 0.3 + small.plate[k] * 0.35)
      c.lerp(scorch, halo * 0.65)
      c.multiplyScalar((1 - core * 0.8) * (1 - groove * 0.45))
      const srgb = c.clone().convertLinearToSRGB()
      color.set([srgb.r * 255, srgb.g * 255, srgb.b * 255, 255], k * 4)
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4
      const len = Math.hypot(dx, dy, 1)
      normal.set(
        [(-dx / len) * 127 + 128, (-dy / len) * 127 + 128, (1 / len) * 127 + 128, 255],
        k * 4
      )
      const r = 0.93 - core * 0.45 - groove * 0.05 + (grain[k] - 0.5) * 0.08
      rough.set([255, r * 255, 0, 255], k * 4)
      // Brillan las grietas grandes vivas y, poco, alguna chica muy caliente.
      const hot = Math.min(1, core * 1.1) * (0.08 + 0.92 * live) + groove * live ** 3 * 0.18
      glow.set(
        [
          Math.min(255, (hot * 1.0 + halo * 0.22) * 255),
          Math.min(255, (hot * 0.55 + halo * 0.035) * 255),
          Math.min(255, hot * 0.18 * 255),
          255
        ],
        k * 4
      )
    }
  }
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const make = (data, srgb) => {
    const texture = new THREE.DataTexture(data, size, size)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = anisotropy
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return keep(texture)
  }
  return {
    color: make(color, true),
    normal: make(normal, false),
    rough: make(rough, false),
    glow: make(glow, true)
  }
}

// Los rios de lava son los cruces por cero de un ruido suave. El ruido se
// calcula una vez, en una textura de media precision sobre toda la meseta, y el
// shader solo umbraliza lo que lee: un rio queda nitido aunque cada texel mida
// un cuarto de metro, porque se interpola el campo y no la linea.
const LAVA_PARS = /* glsl */ `
uniform float lavaTime;
uniform sampler2D lavaRivers;
uniform vec4 lavaFrame;
varying vec2 vLava;
varying vec2 vGround;
`

const LAVA_GLOW = /* glsl */ `
#include <emissivemap_fragment>
float flow = 0.8 + 0.2 * sin( lavaTime * 1.5 + vGround.x * 0.55 - vGround.y * 0.4 );
totalEmissiveRadiance *= vLava.x * flow;
vec3 rivers = texture2D( lavaRivers, vGround * lavaFrame.xy + lavaFrame.zw ).rgb;
float riverLive = rivers.b * vLava.y;
float river = ( 1.0 - smoothstep( 0.006, 0.03 * rivers.g, abs( rivers.r ) ) ) * riverLive;
float riverHalo = ( 1.0 - smoothstep( 0.0, 0.14, abs( rivers.r ) ) ) * riverLive;
totalEmissiveRadiance += vec3( 1.0, 0.36, 0.07 ) * ( river * 1.7 * flow + riverHalo * 0.2 );
diffuseColor.rgb *= 1.0 - river * 0.85;
`

// El campo de los rios sobre la meseta (span metros de lado, centrada en
// center): r, el ruido cuyos ceros son los rios; g, su ancho; b, si estan vivos.
function lavaRivers(noise, span, center, keep) {
  const size = 256
  const data = new Uint16Array(size * size * 4)
  const half = THREE.DataUtils.toHalfFloat
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = center.x + ((i + 0.5) / size - 0.5) * span
      const z = center.y + ((j + 0.5) / size - 0.5) * span
      const field =
        noise.noise(x * 0.075, z * 0.075, 0.5) + 0.4 * noise.noise(x * 0.19 + 3.7, z * 0.19, 1.5)
      const width = 0.6 + 0.4 * noise.noise(x * 0.5 + 11, z * 0.5, 2.5)
      const live = THREE.MathUtils.smoothstep(
        noise.noise(x * 0.23 + 5.3, z * 0.23, 3.5),
        -0.25,
        0.35
      )
      data.set([half(field), half(width), half(live), half(1)], (j * size + i) * 4)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  keep(texture)
  // De metros del mundo a la textura: uv = suelo * escala + corrimiento.
  const frame = new THREE.Vector4(1 / span, 1 / span, 0.5 - center.x / span, 0.5 - center.y / span)
  return { texture, frame }
}

// La meseta: plana donde estan el heroe y el Coloso, con lomas suaves hacia el
// borde y un acantilado roto que cae al mar de nubes. Cada vertice lleva cuanto
// brillan las grietas ahi (mas al pie del Coloso, poco donde esta el heroe) y si
// pueden pasar rios de lava.
function volcanicPlateau(noise, rock, lavaTime, keep) {
  const span = 60
  const geometry = new THREE.PlaneGeometry(span, span, 150, 150).rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  const lava = new Float32Array(position.count * 2)
  const colors = new Float32Array(position.count * 3)
  const pivot = new THREE.Vector2(0, -2)
  const colossus = new THREE.Vector2(0.4, -5.2)
  const tint = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + pivot.x
    const z = position.getZ(i) + pivot.y
    const r = Math.hypot(x - pivot.x, z - pivot.y)
    const a = Math.atan2(x - pivot.x, z - pivot.y)
    const edge = 21 + noise.noise(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 2.5) * 4.5
    let y = 0
    const rolling = THREE.MathUtils.smoothstep(r, 7, 13)
    y += noise.noise(x * 0.16, z * 0.16, 1.5) * 0.5 * rolling
    y +=
      THREE.MathUtils.smoothstep(r, 14, edge - 1) * (0.5 + noise.noise(x * 0.3, z * 0.3, 8) * 0.5)
    const fall = THREE.MathUtils.smoothstep(r, edge - 0.5, edge + 3)
    y -= fall * (26 + noise.noise(x * 0.2, z * 0.2, 9) * 6)
    position.setXYZ(i, x, y, z)
    uv.setXY(i, x / 8, -z / 8)
    const nearColossus = Math.exp(-((Math.hypot(x - colossus.x, z - colossus.y) - 0.5) ** 2) / 16)
    const nearHero = THREE.MathUtils.smoothstep(Math.hypot(x, z), 0.9, 3)
    // Lejos del centro las grietas se apagan: el dibujo no se repite hasta el borde.
    const far = 1 - THREE.MathUtils.smoothstep(r, 13, 21) * 0.7
    lava[i * 2] = (0.16 + 1.8 * nearColossus) * (0.35 + 0.65 * nearHero) * far * (1 - fall)
    const rivers = THREE.MathUtils.smoothstep(noise.noise(x * 0.045, z * 0.045, 6.6), -0.1, 0.25)
    lava[i * 2 + 1] = THREE.MathUtils.smoothstep(r, 3, 6.5) * nearHero * rivers * (1 - fall)
    const patch = noise.noise(x * 0.05, z * 0.05, 4.2) * 0.5 + 0.5
    tint.setRGB(0.92 + patch * 0.16, 0.9 + patch * 0.12, 0.9 + patch * 0.1)
    tint.multiplyScalar(1 - fall * 0.55 - THREE.MathUtils.smoothstep(r, 16, edge) * 0.15)
    tint.toArray(colors, i * 3)
  }
  geometry.setAttribute('lava', new THREE.BufferAttribute(lava, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  keep(geometry)
  const rivers = lavaRivers(noise, span, pivot, keep)
  const material = keep(
    new THREE.MeshStandardMaterial({
      map: rock.color,
      normalMap: rock.normal,
      roughnessMap: rock.rough,
      emissiveMap: rock.glow,
      emissive: 0xffffff,
      emissiveIntensity: 2.4,
      vertexColors: true,
      roughness: 1,
      metalness: 0
    })
  )
  material.normalScale.set(1.3, 1.3)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lavaTime = lavaTime
    shader.uniforms.lavaRivers = { value: rivers.texture }
    shader.uniforms.lavaFrame = { value: rivers.frame }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 lava;\nvarying vec2 vLava;\nvarying vec2 vGround;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLava = lava;\nvGround = ( modelMatrix * vec4( position, 1.0 ) ).xz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAVA_PARS)
      .replace('#include <emissivemap_fragment>', LAVA_GLOW)
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

// --- Las ruinas y las piedras ------------------------------------------------------

// Rocas, columnas rotas, un arco y escombro, todo en una sola malla de pocos
// poligonos con color por vertice. Lo alto queda lejos del centro, fuera del
// circulo que recorre la camara; cerca solo hay piedras bajas.
function ruinsAndRocks(noise, keep) {
  const rand = random(23)
  const parts = []
  const pivot = new THREE.Vector2(0, -2)
  const stoneDark = new THREE.Color(DAWN.stone[0])
  const stoneLight = new THREE.Color(DAWN.stone[1])
  const basalt = new THREE.Color(DAWN.basalt[1])

  const boulder = (x, z, size, squash, hex) => {
    // El icosaedro ya viene sin indice: cada cara con sus vertices.
    const g = new THREE.IcosahedronGeometry(1, 1)
    lumpy(g, noise, 0.28)
    g.scale(size * (0.8 + rand() * 0.5), size * squash, size * (0.8 + rand() * 0.5))
    g.rotateY(rand() * Math.PI * 2)
    g.translate(x, size * squash * 0.55, z)
    parts.push(paint(g, hex, 0.35))
  }
  const column = (x, z, height, radius, tilt) => {
    const g = new THREE.CylinderGeometry(radius * 0.92, radius, height, 9, 3).toNonIndexed()
    // El corte de arriba, en diagonal: la columna se partio.
    const p = g.attributes.position
    const sx = rand() - 0.5
    const sz = rand() - 0.5
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > height / 2 - 0.01) {
        p.setY(i, p.getY(i) + (p.getX(i) * sx + p.getZ(i) * sz) * 1.2)
      }
    }
    g.rotateZ(tilt)
    g.translate(x, height / 2 - 0.1, z)
    parts.push(paint(g, stoneDark.clone().lerp(stoneLight, rand()), 0.3))
  }
  const block = (x, y, z, w, h, d, yaw) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
    g.rotateY(yaw)
    g.translate(x, y, z)
    parts.push(paint(g, stoneDark.clone().lerp(stoneLight, rand() * 0.6), 0.2))
  }
  const around = (radius, angle) =>
    new THREE.Vector2(pivot.x + Math.sin(angle) * radius, pivot.y + Math.cos(angle) * radius)

  // Un arco en ruinas y columnas sueltas alrededor. La camara arranca mirando
  // hacia el angulo 3,6 (el del Coloso): ahi no hay nada alto, asi el primer
  // cuadro queda limpio y las ruinas entran despues, con el giro.
  const arch = around(19.5, 2.69)
  const yaw = Math.atan2(arch.x - pivot.x, arch.y - pivot.y) + Math.PI / 2
  const side = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw)).multiplyScalar(2.3)
  column(arch.x + side.x, arch.y + side.y, 6.2, 0.62, 0)
  column(arch.x - side.x, arch.y - side.y, 4.6, 0.62, 0.04)
  block(arch.x + side.x * 0.45, 6.25, arch.y + side.y * 0.45, 3.4, 0.8, 1.3, yaw)
  for (const [radius, angle, height] of [
    [18.5, 4.6, 4.2],
    [19, 5.5, 3.1],
    [18, 1.2, 2.6],
    [19.5, 0.3, 4.4],
    [18.2, 2.0, 3.4]
  ]) {
    const at = around(radius, angle)
    column(at.x, at.y, height, 0.55, (rand() - 0.5) * 0.12)
  }
  // Tambores de columna caidos.
  for (const [radius, angle] of [
    [17, 2.95],
    [17.5, 4.3],
    [16.8, 1.6]
  ]) {
    const at = around(radius, angle)
    const g = new THREE.CylinderGeometry(0.55, 0.55, 1.6, 9).toNonIndexed()
    g.rotateZ(Math.PI / 2)
    g.rotateY(rand() * Math.PI)
    g.translate(at.x, 0.5, at.y)
    parts.push(paint(g, stoneDark.clone().lerp(stoneLight, 0.4), 0.3))
  }
  // Rocas grandes en el borde de la meseta, salvo detras del heroe en el primer
  // cuadro: ahi le taparian la cabeza.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + rand() * 0.3
    if (angle > 3.2 && angle < 4) continue
    const at = around(17 + rand() * 3.5, angle)
    boulder(
      at.x,
      at.y,
      0.8 + rand() * 1.6,
      0.55 + rand() * 0.4,
      basalt.clone().multiplyScalar(0.7 + rand() * 0.4)
    )
  }
  // Piedras bajas cerca: nunca al pie del heroe ni del Coloso.
  let placed = 0
  for (let tries = 0; tries < 400 && placed < 46; tries++) {
    const at = around(3 + Math.sqrt(rand()) * 14, rand() * Math.PI * 2)
    if (Math.hypot(at.x, at.y) < 1.8 || Math.hypot(at.x - 0.4, at.y + 5.2) < 2.8) continue
    boulder(
      at.x,
      at.y,
      0.12 + rand() * 0.28,
      0.6,
      basalt.clone().multiplyScalar(0.6 + rand() * 0.5)
    )
    placed++
  }
  const geometry = keep(mergeGeometries(parts))
  for (const part of parts) part.dispose()
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geometry,
    keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }))
  )
  // La sombra del titulo cubre 20 m alrededor del heroe: las ruinas quedan
  // afuera y dibujarlas en ella no daria nada. Las piedras cercanas son bajas.
  mesh.receiveShadow = true
  return mesh
}

// Mueve cada vertice segun su lugar, igual para el mismo punto: la piedra sale
// irregular y las caras vecinas no se separan.
function lumpy(geometry, noise, amount) {
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + noise.noise(x * 1.7 + 3.1, y * 1.7, z * 1.7) * amount * 2
    p.setXYZ(i, x * k, y * k, z * k)
  }
  return geometry
}

// Color por vertice, mas oscuro abajo: una sombra propia barata. Sin uv, para
// que todas las partes se puedan juntar.
function paint(geometry, color, shade) {
  if (geometry.attributes.uv) geometry.deleteAttribute('uv')
  if (geometry.attributes.normal) geometry.deleteAttribute('normal')
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox
  const span = max.y - min.y || 1
  const p = geometry.attributes.position
  const colors = new Float32Array(p.count * 3)
  const c = new THREE.Color(color)
  for (let i = 0; i < p.count; i++) {
    const k = 1 - shade * (1 - (p.getY(i) - min.y) / span)
    colors.set([c.r * k, c.g * k, c.b * k], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

// --- Las brasas --------------------------------------------------------------------

// Chispas que suben de las grietas, se mecen con el aire caliente y se apagan.
// Todo el movimiento lo hace el shader: la CPU no toca nada por cuadro.
function embers(keep) {
  const count = 240
  const rand = random(41)
  const seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2
    const radius = 1.2 + Math.sqrt(rand()) * 14
    seeds.set(
      [Math.sin(angle) * radius, -2 + Math.cos(angle) * radius, 0.045 + rand() * 0.07, rand()],
      i * 4
    )
  }
  const geometry = keep(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, -2), 24)
  const material = keep(
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform float uScale;
        varying float vLife;
        varying float vHeat;
        void main() {
          float life = fract( uTime * seed.z + seed.w );
          vec3 p = vec3( seed.x, life * life * 2.0 + life * 6.5, seed.y );
          p.x += sin( life * 8.0 + seed.w * 31.0 ) * 0.45 + life * 2.2;
          p.z += cos( life * 6.0 + seed.w * 17.0 ) * 0.45 - life * 0.8;
          vLife = life;
          vHeat = fract( seed.w * 7.31 );
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          // Una brasa que pasa junto a la camara no se vuelve una bola enorme.
          float size = uScale * ( 0.035 + 0.035 * vHeat ) * ( 1.0 - life * 0.55 ) / -mv.z;
          gl_PointSize = min( size, uScale * 0.008 );
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying float vHeat;
        void main() {
          float d = length( gl_PointCoord - 0.5 );
          float core = 1.0 - smoothstep( 0.0, 0.5, d );
          float fade = smoothstep( 0.0, 0.06, vLife ) * ( 1.0 - smoothstep( 0.5, 1.0, vLife ) );
          vec3 hot = mix( vec3( 1.0, 0.75, 0.35 ), vec3( 1.0, 0.36, 0.08 ), vLife );
          gl_FragColor = vec4( hot * ( 2.2 + vHeat * 1.6 ), core * core * fade );
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  const points = new THREE.Points(geometry, material)
  points.renderOrder = 3
  return points
}

// --- Ayudas -------------------------------------------------------------------------

// Voronoi periodico de `cells` celdas por lado en `size` pixeles, con los bordes
// torcidos por dos ruidos. Por pixel: crack, la diferencia entre la segunda y la
// primera distancia (cerca de 0 sobre una grieta); center, la distancia al punto
// de su celda; plate, un valor fijo por celda.
function voronoi(size, cells, seed, warpX, warpY, warp) {
  const rand = random(seed)
  const seeds = new Float32Array(cells * cells * 2)
  for (let i = 0; i < seeds.length; i++) seeds[i] = 0.1 + rand() * 0.8
  const crack = new Float32Array(size * size)
  const center = new Float32Array(size * size)
  const plate = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x
      const fx = (x / size) * cells + (warpX[k] - 0.5) * warp
      const fy = (y / size) * cells + (warpY[k] - 0.5) * warp
      const cx = Math.floor(fx)
      const cy = Math.floor(fy)
      let d1 = 9
      let d2 = 9
      let id = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox
          const gy = cy + oy
          const wx = ((gx % cells) + cells) % cells
          const wy = ((gy % cells) + cells) % cells
          const s = (wy * cells + wx) * 2
          const ex = gx + seeds[s] - fx
          const ey = gy + seeds[s + 1] - fy
          const d = Math.sqrt(ex * ex + ey * ey)
          if (d < d1) {
            d2 = d1
            d1 = d
            id = wy * cells + wx
          } else if (d < d2) d2 = d
        }
      }
      crack[k] = d2 - d1
      center[k] = d1
      plate[k] = hash(id, seed)
    }
  }
  return { crack, center, plate }
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
