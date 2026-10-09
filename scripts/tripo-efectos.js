// El postproceso y el cielo de la vista 2.5D: como se pasa cada cuadro a la
// pantalla, y el cielo, la niebla y las luces de cada mapa.
//
// La pagina (tripo-heroe.html) arma los efectos una vez, despues del renderer,
// la escena, la camara y las luces:
//
//   createEffects({ renderer, scene, camera, settings, lights })
//
// `settings` son las opciones de quien juega (se guardan en el navegador):
// settings.effects es 'high' o 'low'. `lights` son las luces de la pagina:
// { sun, sky, ember } (la direccional, la de hemisferio y la calida).
//
// Devuelve:
//   render(dt, screen)  dibuja el cuadro en vez de renderer.render; screen es la
//                       pantalla: 'menu' (el titulo), 'play', 'tour' o 'mirror'
//   setSize(w, h)       el tamano del lienzo en px de CSS, cuando cambia
//   setQuality(q)       'high': brillo y vineta; 'low': renderer.render solo,
//                       para celulares y placas de video modestas
//   atmosphere(data)    el cielo, la niebla y las luces de un mapa (el JSON de
//                       /world/<id>.json), o con null los de la vitrina
//   shafts(direction)   rayos de sol desde esa direccion del mundo (el titulo
//                       la da en cada cuadro); con null, sin rayos
//   post()              el postproceso armado, para medir desde la consola
//   dispose()
//
// Tambien exporta createSky: el cielo de three.js (Sky, el modelo de Preetham)
// con un degrade pintado encima, sol grande, estrellas, luna, nubes en vetas y
// un horizonte que se funde con la niebla; dressSky, que lo viste con un clima
// como los de MOODS, y skyNoise, el ruido de las nubes. El titulo (titulo.js)
// arma su cielo con las mismas funciones.
//
// En 'high' el cuadro pasa por EffectComposer, como en los ejemplos de
// three.js: RenderPass dibuja la escena en un buffer de punto flotante,
// UnrealBloomPass hace brillar lo que pasa del umbral (la lava, las ventanas de
// NOX de noche, las runas y brasas del titulo) y OutputPass pasa a sRGB. Ese
// ultimo pase hace tambien el antialias (FXAA), la suma del brillo y el
// acabado (tono por mapa, vineta, grano), asi el cuadro cuesta dos pases a
// pantalla completa y el brillo, a un cuarto de resolucion, casi nada.
// renderer.info cuenta el cuadro entero, con todos los pases.

import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { performance } = globalThis

// --- El cielo ---------------------------------------------------------------

// Lo que se suma al shader de Sky. skyFrame gira el cielo entero (sol, nubes y
// estrellas) respecto del mundo: el titulo lo gira con la camara. La dispersion
// de Preetham pasa por la curva ACES de three.js, propia del cielo: el resto de
// la escena se dibuja sin curva, con los colores que eligieron los modulos del
// mundo.
//
// Encima va un cielo pintado, que es el que da el clima: un degrade por altura
// (horizonte, media altura y cenit) con el horizonte dorado hacia el sol. paint.w
// dice cuanto manda el pintado sobre la dispersion. El sol lleva un disco mas
// grande que el real y tres halos (el cercano, el de Mie y uno ancho que entibia
// ese lado del cielo). Despues las estrellas, la luna, unas nubes en vetas y,
// abajo, la franja que funde el cielo con la niebla.
const SKY_PARS = /* glsl */ `
uniform mat3 skyFrame;
uniform float skyExposure;
uniform vec3 skyTint;
uniform vec3 paintSun;
uniform vec3 paintAway;
uniform vec3 paintMid;
uniform vec3 paintTop;
uniform vec4 paintShape;
uniform vec3 horizonColor;
uniform vec3 horizonBand;
uniform vec3 discColor;
uniform float sunSize;
uniform vec4 sunGlow;
uniform float starAmount;
uniform vec3 moonDirection;
uniform vec3 moonColor;
uniform float moonAmount;
uniform sampler2D cloudMap;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform vec3 cloudShape;

float skyHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}

vec3 skyTone( vec3 color ) {
  const mat3 toAces = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ),
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );
  const mat3 fromAces = mat3(
    vec3( 1.60475, -0.10208, -0.00327 ),
    vec3( -0.53108, 1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605, 1.07602 )
  );
  color = toAces * ( color / 0.6 );
  vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
  vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
  return clamp( fromAces * ( a / b ), 0.0, 1.0 );
}

// Una estrella en algunas celdas de una grilla sobre la direccion: cada una con
// su lugar, su tamano y su titileo.
float skyStars( vec3 dir ) {
  vec3 p = dir * 150.0;
  vec3 cell = floor( p );
  float h = skyHash( cell );
  if ( h < 0.88 ) return 0.0;
  vec3 jitter = vec3( skyHash( cell + 1.7 ), skyHash( cell + 4.3 ), skyHash( cell + 9.1 ) );
  float d = length( p - cell - 0.2 - jitter * 0.6 );
  float size = 0.12 + 0.18 * skyHash( cell + 2.9 );
  float twinkle = 0.65 + 0.35 * sin( time * ( 1.1 + 2.4 * skyHash( cell + 5.5 ) ) + h * 40.0 );
  return ( 1.0 - smoothstep( 0.0, size, d ) ) * twinkle * ( 0.3 + 0.7 * skyHash( cell + 8.2 ) );
}
`

const SKY_MAIN = /* glsl */ `
  vec3 scatter = skyTone( gl_FragColor.rgb * skyExposure ) * skyTint;

  // El degrade pintado. facing es 1 mirando hacia el sol, en el plano.
  vec2 across = direction.xz / max( length( direction.xz ), 0.0001 );
  vec2 sunAcross = vSunDirection.xz / max( length( vSunDirection.xz ), 0.0001 );
  float facing = max( dot( across, sunAcross ), 0.0 );
  float height = max( direction.y, 0.0 );
  vec3 paint = mix( paintAway, paintSun, pow( facing, paintShape.z ) );
  paint = mix( paint, paintMid, smoothstep( 0.0, paintShape.x, height ) );
  paint = mix( paint, paintTop, smoothstep( paintShape.x, paintShape.y, height ) );
  vec3 sky = mix( scatter, paint, paintShape.w );

  // Un sol mas grande que el real, con sus halos: de lejos se lee mejor.
  float sunCos = max( dot( direction, vSunDirection ), 0.0 );
  float sunDisc = smoothstep( cos( sunSize * 1.35 ), cos( sunSize ), sunCos );
  float halo = pow( sunCos, 900.0 ) * 0.55 * sunGlow.y + pow( sunCos, 45.0 ) * 0.1 * sunGlow.z +
    pow( sunCos, 6.0 ) * sunGlow.w;
  sky += discColor * ( sunDisc * sunGlow.x + halo );

  // Las estrellas se ven donde el cielo esta oscuro y lejos del horizonte.
  float glow = dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) );
  float dark = ( 1.0 - smoothstep( 0.03, 0.28, glow ) ) * smoothstep( 0.02, 0.3, direction.y );
  sky += vec3( 0.9, 0.94, 1.0 ) * skyStars( direction ) * starAmount * dark;

  // La luna: un disco con manchas suaves y un halo frio.
  if ( moonAmount > 0.0 ) {
    vec3 md = normalize( moonDirection );
    float mc = dot( direction, md );
    float moonR = 0.022;
    float moonDisc = smoothstep( cos( moonR ), cos( moonR * 0.88 ), mc );
    vec3 side = normalize( cross( md, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 up = cross( side, md );
    vec2 q = vec2( dot( direction, side ), dot( direction, up ) ) / moonR;
    float maria = 1.0 - 0.16 * ( 1.0 - smoothstep( 0.1, 0.55, length( q - vec2( 0.25, 0.2 ) ) ) )
      - 0.12 * ( 1.0 - smoothstep( 0.05, 0.45, length( q + vec2( 0.3, 0.1 ) ) ) );
    float moonGlow = pow( max( mc, 0.0 ), 2500.0 ) * 0.5 + pow( max( mc, 0.0 ), 120.0 ) * 0.07;
    sky += moonAmount * ( moonDisc * maria * moonColor + moonGlow * vec3( 0.45, 0.55, 0.85 ) );
  }

  // Nubes en vetas: el ruido sobre un plano alto, estirado de costado, que se
  // mueve despacio. Del lado del sol toman su luz por abajo; las de enfrente
  // quedan en sombra. Junto al horizonte se afinan y se pierden en la bruma.
  if ( cloudShape.x > 0.0 && direction.y > 0.0 ) {
    vec2 plane = direction.xz / ( direction.y + 0.06 );
    vec2 drift = vec2( time * 0.0035, 0.0 );
    float n = texture2D( cloudMap, plane * vec2( 0.05, 0.35 ) + drift ).r * 0.7 +
      texture2D( cloudMap, plane * vec2( 0.13, 0.9 ) - drift * 1.7 + 0.37 ).r * 0.3;
    float cover = smoothstep( cloudShape.y, cloudShape.y + cloudShape.z, n ) *
      smoothstep( 0.012, 0.09, direction.y ) * ( 1.0 - smoothstep( 0.28, 0.5, direction.y ) );
    vec3 cloud = mix( cloudShade, cloudLit, pow( facing, 1.6 ) * ( 0.35 + 0.65 * smoothstep( 0.55, 0.85, n ) ) );
    cloud += discColor * pow( sunCos, 12.0 ) * 0.6;
    sky = mix( sky, cloud, cover * cloudShape.x );
  }

  // Abajo el cielo se funde con la niebla: el suelo lejano se pierde en el.
  float band = ( 1.0 - smoothstep( horizonBand.x, horizonBand.y, direction.y ) ) * horizonBand.z;
  sky = mix( sky, horizonColor, band );
  // Alfa 0 marca el cielo en el buffer de la escena (lo opaco escribe 1): los
  // rayos de sol salen solo de el, y lo que lo tapa les hace sombra.
  gl_FragColor = vec4( sky, 0.0 );
`

function patchSky(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('uniform float time;', 'uniform float time;\n' + SKY_PARS)
    .replace(
      'vec3 direction = normalize( vWorldPosition - cameraPosition );',
      'vec3 direction = skyFrame * normalize( vWorldPosition - cameraPosition );'
    )
    .replace('#include <tonemapping_fragment>', SKY_MAIN)
}

// Ruido de valor suave y periodico: una grilla de `period` celdas que se repite
// en `size` pixeles. Sirve para texturas que se repiten sin costura.
export function tileNoise(size, period, seed) {
  const rand = random(seed)
  const lattice = new Float32Array(period * period)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period
    const y0 = Math.floor(fy)
    const ty = smooth(fy - y0)
    const r0 = (y0 % period) * period
    const r1 = ((y0 + 1) % period) * period
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period
      const x0 = Math.floor(fx)
      const tx = smooth(fx - x0)
      const c0 = x0 % period
      const c1 = (x0 + 1) % period
      const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx
      const bottom = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx
      out[y * size + x] = top + (bottom - top) * ty
    }
  }
  return out
}

// Las nubes del cielo y el mar de nubes del titulo leen esta textura: ruido de
// cuatro octavas que se repite sin costura. Se arma una vez y no se libera.
let cloudNoise = null
export function skyNoise() {
  if (cloudNoise) return cloudNoise
  const size = 256
  const sum = new Float32Array(size * size)
  const octaves = [
    [4, 0.5],
    [8, 0.3],
    [16, 0.14],
    [32, 0.06]
  ]
  octaves.forEach(([period, weight], i) => {
    const layer = tileNoise(size, period, 5 + i * 101)
    for (let k = 0; k < sum.length; k++) sum[k] += layer[k] * weight
  })
  const data = new Uint8Array(size * size * 4)
  for (let k = 0; k < sum.length; k++) {
    const v = Math.round(sum[k] * 255)
    data.set([v, v, v, 255], k * 4)
  }
  cloudNoise = new THREE.DataTexture(data, size, size)
  cloudNoise.wrapS = cloudNoise.wrapT = THREE.RepeatWrapping
  cloudNoise.magFilter = THREE.LinearFilter
  cloudNoise.minFilter = THREE.LinearMipmapLinearFilter
  cloudNoise.generateMipmaps = true
  cloudNoise.needsUpdate = true
  cloudNoise.userData.shared = true
  return cloudNoise
}

export function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function smooth(t) {
  return t * t * (3 - 2 * t)
}

// El cielo: una caja que sigue a la camara que la dibuja y se pinta despues de
// lo opaco, solo donde no hay nada delante.
export function createSky() {
  const sky = new Sky()
  sky.name = 'cielo'
  sky.scale.setScalar(100)
  sky.frustumCulled = false
  sky.renderOrder = 1
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld)
    sky.updateMatrixWorld()
  }
  const u = sky.material.uniforms
  u.showSunDisc.value = 0
  // Las nubes de Sky (ruido fbm por pixel) no: las vetas de abajo cuestan una
  // lectura de textura.
  u.cloudCoverage.value = 0
  Object.assign(u, {
    skyFrame: { value: new THREE.Matrix3() },
    skyExposure: { value: 0.5 },
    skyTint: { value: new THREE.Color(1, 1, 1) },
    paintSun: { value: new THREE.Color() },
    paintAway: { value: new THREE.Color() },
    paintMid: { value: new THREE.Color() },
    paintTop: { value: new THREE.Color() },
    paintShape: { value: new THREE.Vector4(0.2, 0.7, 2, 0) },
    horizonColor: { value: new THREE.Color() },
    horizonBand: { value: new THREE.Vector3(-0.03, 0.08, 1) },
    discColor: { value: new THREE.Color(1, 0.8, 0.55) },
    sunSize: { value: 0.012 },
    sunGlow: { value: new THREE.Vector4(2, 1, 1, 0) },
    starAmount: { value: 0 },
    moonDirection: { value: new THREE.Vector3(0, 0.2, -1) },
    moonColor: { value: new THREE.Color(1.5, 1.46, 1.36) },
    moonAmount: { value: 0 },
    cloudMap: { value: skyNoise() },
    cloudLit: { value: new THREE.Color(1, 1, 1) },
    cloudShade: { value: new THREE.Color(0.5, 0.5, 0.55) },
    cloudShape: { value: new THREE.Vector3(0, 0.55, 0.2) }
  })
  sky.material.onBeforeCompile = patchSky
  return sky
}

// Una direccion del cielo por elevacion y rumbo, en grados. Rumbo 0 es el norte
// del mapa (-z) y 90 el este (+x).
export function skyDirection(elevation, bearing, target = new THREE.Vector3()) {
  const e = THREE.MathUtils.degToRad(elevation)
  const b = THREE.MathUtils.degToRad(bearing)
  return target.set(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e))
}

// --- Lo que cambia por mapa ---------------------------------------------------

// sun    [elevacion, rumbo] del sol del cielo. No mueve la luz que da sombra: esa
//        sigue al heroe desde el sureste (walk en la pagina), asi las fachadas
//        que mira la camara quedan con luz en todos los mapas. disc [color,
//        disco, halo, halo ancho] del sol, si no es el de siempre.
// air    [turbidez, rayleigh, mie, g de mie] del modelo de Preetham
// sky    [exposicion, tinte] de la dispersion de Preetham
// paint  [horizonte hacia el sol, horizonte de enfrente, media altura, cenit,
//        [altura de la media, altura del cenit (senos), cuanto abre el lado del
//        sol, cuanto manda lo pintado sobre la dispersion]]
// clouds [cuanto, cobertura, suavidad, color con luz, color en sombra]
// stars  cuantas estrellas; moon [elevacion, rumbo] de la luna
// fog    [color, cerca, lejos]: la niebla y el horizonte del cielo
// hemi   [arriba, abajo, intensidad] de la luz de hemisferio
// light  [color, intensidad] de la direccional; env, cuanto reflejan los PBR
// post   bloom [fuerza, radio, umbral, rodilla]: brilla lo que pasa del umbral
//        en su canal mas alto; saturacion, contraste y tinte del acabado. Sin
//        bloom (de dia) el pase del brillo no corre. msaa, las muestras de la
//        escena (4 si no se dice; con 0 el antialias es FXAA).
const MOODS = {
  // La ciudad de RUNA a la manana: sol bajo al noreste, aire limpio y nubes
  // altas que todavia toman el dorado del amanecer.
  city: {
    sun: [11, 55],
    air: [2.6, 1.3, 0.005, 0.8],
    sky: [0.5, [1, 1, 1]],
    paint: [0xf3d3a2, 0xc5d3e0, 0x95bde6, 0x3f79c4, [0.2, 0.75, 3, 0.55]],
    clouds: [0.7, 0.5, 0.22, 0xfff1dc, 0xaebdd2],
    fog: [0xbcc8d2, 60, 150],
    hemi: [0xdfe6ef, 0x3d3020, 1.3],
    light: [0xffe7c6, 2.5],
    env: 0.45,
    post: { bloom: null, vignette: 0.2, saturation: 1.04, tint: [1.01, 1, 0.99] }
  },
  // NOX es de noche: luna al norte, estrellas, luz fria; brillan las ventanas,
  // las juntas y las flores.
  nox: {
    sun: [-1.5, 250],
    air: [2, 3.2, 0.004, 0.75],
    sky: [1, [1, 1, 1]],
    paint: [0x2a3566, 0x1c2550, 0x0e1738, 0x03060f, [0.22, 0.8, 2, 1]],
    clouds: [0.45, 0.52, 0.2, 0x55649a, 0x121a34],
    stars: 1.8,
    moon: [6.5, 12],
    fog: [0x1a2140, 55, 140],
    hemi: [0x7184d0, 0x1a1428, 0.95],
    light: [0xb4c2ff, 1.3],
    env: 0.22,
    post: {
      bloom: [0.7, 0.5, 0.85, 0.35],
      vignette: 0.3,
      saturation: 1.0,
      contrast: 1.05,
      tint: [0.96, 0.98, 1.05]
    }
  },
  // El castillo a pleno dia: cielo azul y cumulos blancos.
  castle: {
    sun: [38, 140],
    air: [2.2, 1, 0.004, 0.8],
    sky: [0.5, [1, 1, 1]],
    paint: [0xdde8f2, 0xcfdeec, 0x8fb8e2, 0x3a72c0, [0.22, 0.8, 2, 0.5]],
    clouds: [0.8, 0.5, 0.2, 0xffffff, 0xbcc7d6],
    fog: [0xb4c3d1, 60, 150],
    hemi: [0xe3e9f2, 0x3a3326, 1.35],
    light: [0xfff4e2, 2.5],
    env: 0.45,
    post: { bloom: null, vignette: 0.18, saturation: 1.03 }
  },
  // El Coliseo a la tarde: sol dorado al oeste.
  coliseum: {
    sun: [12, 285],
    air: [4, 1.6, 0.007, 0.82],
    sky: [0.55, [1, 1, 1]],
    paint: [0xf2c27e, 0xd8cdbd, 0xa7bdd6, 0x4f7fbe, [0.2, 0.75, 2.5, 0.55]],
    clouds: [0.65, 0.52, 0.22, 0xffdcac, 0xb3a59c],
    fog: [0xd2bc9e, 60, 150],
    hemi: [0xeadfcc, 0x4a3420, 1.25],
    light: [0xffd6a0, 2.6],
    env: 0.45,
    post: { bloom: null, vignette: 0.24, saturation: 1.05, tint: [1.02, 1, 0.97] }
  },
  // Las ruinas volcanicas: humo, cielo rojo oscuro y un sol rojo y apagado por
  // la ceniza, detras de la camara; la lava ilumina las nubes desde abajo.
  boss: {
    sun: [5, 175],
    disc: [0xff5a2a, 1.1, 0.25, 0.05],
    air: [9, 2.2, 0.004, 0.8],
    sky: [0.12, [1.0, 0.36, 0.22]],
    paint: [0xa8401e, 0x6a2414, 0x34110c, 0x0e0508, [0.25, 0.8, 1.5, 0.9]],
    clouds: [0.85, 0.45, 0.28, 0xc4532a, 0x241010],
    fog: [0x45261c, 52, 135],
    hemi: [0x8e7c74, 0x2c1a14, 1.05],
    light: [0xffc6a2, 2.4],
    env: 0.35,
    post: {
      bloom: [0.75, 0.55, 1.0, 0.5],
      vignette: 0.34,
      saturation: 1.06,
      contrast: 1.06,
      tint: [1.03, 0.98, 0.95]
    }
  }
}

// La vitrina (y la base del titulo): fondo negro, niebla corta, luz neutra.
const SHOWCASE = {
  fog: [0x0b0b0c, 11, 30],
  hemi: [0xd8d8d0, 0x1a1408, 1.3],
  light: [0xfff1d6, 2.4],
  env: 0.45,
  post: { bloom: null, vignette: 0.25 }
}

// El titulo: un alba con lava; brilla mas que los mapas. Sin MSAA: alcanza el
// FXAA (ver antialias en createEffects).
const TITLE = {
  msaa: 0,
  bloom: [0.5, 0.5, 0.95, 0.6],
  vignette: 0.26,
  saturation: 1.08,
  contrast: 1.06,
  tint: [1.01, 0.99, 1.0]
}

// --- El postproceso ---------------------------------------------------------

// El bloom de UnrealBloomPass separa lo brillante por luminancia; aca por el
// canal mas alto, con una rodilla suave. Asi la lava naranja (r de 1,6) brilla y
// una pared blanca al sol (cerca de 0,9 en todos los canales) no.
// Como el bloom corre a un cuarto de resolucion, cada pixel promedia cuatro
// muestras bilineales (16 pixeles de la escena): una brasa chica no titila.
const HIGH_PASS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
uniform vec2 sceneTexel;
varying vec2 vUv;
vec3 bright( vec2 uv ) {
  vec3 c = texture2D( tDiffuse, uv ).rgb;
  float top = max( c.r, max( c.g, c.b ) );
  return c * smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, top );
}
void main() {
  vec2 o = sceneTexel;
  vec3 sum = bright( vUv + vec2( -o.x, -o.y ) ) + bright( vUv + vec2( o.x, -o.y ) ) +
    bright( vUv + vec2( -o.x, o.y ) ) + bright( vUv + vec2( o.x, o.y ) );
  gl_FragColor = vec4( sum * 0.25, 1.0 );
}
`

// UnrealBloomPass arma su cadena desde la mitad de la resolucion; esta, desde
// un cuarto: el brillo es suave igual y cuesta la cuarta parte. Tampoco mezcla
// el brillo sobre la escena (un pase mas a pantalla completa): lo deja en
// `texture` y lo suma el pase final.
class QuarterBloomPass extends UnrealBloomPass {
  constructor() {
    super(new THREE.Vector2(256, 256), 0.4, 0.4, 0.9)
    this.blendMaterial.visible = false
    this.highPassUniforms.sceneTexel = { value: new THREE.Vector2(1, 1) }
    this.materialHighPassFilter.fragmentShader = HIGH_PASS
    this.materialHighPassFilter.needsUpdate = true
  }

  get texture() {
    return this.renderTargetsHorizontal[0].texture
  }

  setSize(width, height) {
    super.setSize(Math.round(width / 2), Math.round(height / 2))
    this.highPassUniforms.sceneTexel.value.set(1 / width, 1 / height)
  }
}

// Rayos de sol: la dispersion de la luz como postproceso (GPU Gems 3, cap. 13,
// la idea del ejemplo de god rays de three.js). Cada pixel junta lo que hay en
// la linea hacia el sol, con una caida. Solo alumbra el cielo brillante cerca
// del sol (el cielo se marca con alfa 0 en el buffer de la escena): donde algo
// lo tapa (el Coloso, las montanas) la linea queda oscura y por los huecos
// pasan los haces. El comienzo de cada linea se corre al azar por pixel, asi
// los pasos no se ven como rayas. Corre a un cuarto de resolucion y lo suma el
// pase final. shape: x, el radio alrededor del sol que alumbra; y, cuanto del
// camino hacia el sol se recorre; z, la caida por paso; w, la fuerza.
const SHAFTS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 sun;
uniform float aspect;
uniform vec4 shape;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec2 stepUv = ( sun - vUv ) * shape.y / 64.0;
  // Ruido de gradiente intercalado (Jimenez, 2014): se reparte parejo y, con el
  // suavizado del pase final, no se ve como grano.
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  vec2 uv = vUv + stepUv * jitter;
  float decay = 1.0;
  vec3 sum = vec3( 0.0 );
  for ( int i = 0; i < 64; i++ ) {
    vec4 c = texture2D( tDiffuse, uv );
    float top = max( c.r, max( c.g, c.b ) );
    float near = 1.0 - smoothstep( 0.0, shape.x, length( ( uv - sun ) * vec2( aspect, 1.0 ) ) );
    sum += c.rgb * ( 1.0 - c.a ) * smoothstep( threshold, threshold + 0.6, top ) * near * decay;
    decay *= shape.z;
    uv += stepUv;
  }
  gl_FragColor = vec4( sum * shape.w / 64.0, 1.0 );
}
`

class ShaftsPass extends Pass {
  constructor() {
    super()
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false
    })
    // El tamano de un texel de los rayos: el pase final los suaviza con el.
    this.texel = new THREE.Vector2(1, 1)
    this.uniforms = {
      tDiffuse: { value: null },
      sun: { value: new THREE.Vector2(0.5, 0.5) },
      aspect: { value: 1 },
      shape: { value: new THREE.Vector4(0.24, 1, 0.985, 2.4) },
      threshold: { value: 0.55 }
    }
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }`,
        fragmentShader: SHAFTS,
        depthTest: false,
        depthWrite: false
      })
    )
  }

  get texture() {
    return this.target.texture
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width / 4))
    const h = Math.max(1, Math.round(height / 4))
    this.target.setSize(w, h)
    this.texel.set(1 / w, 1 / h)
    this.uniforms.aspect.value = width / Math.max(1, height)
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture
    renderer.setRenderTarget(this.target)
    this.quad.render(renderer)
  }

  dispose() {
    this.target.dispose()
    this.quad.material.dispose()
    this.quad.dispose()
  }
}

// El pase final es OutputPass (el paso a sRGB de three.js) con tres cosas mas
// en el mismo shader, que en los ejemplos son pases aparte: el antialias FXAA
// (la escena se dibuja sin MSAA, que en una placa integrada costaba mas que
// el postproceso entero), la suma del brillo y de los rayos y el acabado: tono
// por mapa, vineta y un grano de medio escalon contra las bandas del cielo.
const FINISH_PARS = /* glsl */ `
uniform sampler2D tBloom;
uniform float bloomOn;
uniform sampler2D tShafts;
uniform float shaftsOn;
uniform vec2 shaftsTexel;
uniform vec2 texel;
uniform float fxaaOn;
uniform vec3 tint;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float aspect;
uniform float seed;
varying vec2 vUv;

// El brillo percibido, para buscar bordes: la escena viene lineal.
float edgeLuma( vec3 c ) {
  return sqrt( dot( min( c, vec3( 1.0 ) ), vec3( 0.299, 0.587, 0.114 ) ) );
}

// FXAA de Timothy Lottes, con la forma de su version 3.11: la cruz de vecinos
// dice si hay contraste (donde no, casi toda la pantalla, sale con cinco
// lecturas); las diagonales dicen hacia donde corre el borde y cuatro lecturas
// mas lo suavizan a lo largo. Ademas, lo que mide un pixel (la juntura entre
// dos cajas de un cartel, un punto) se acerca al promedio de sus vecinos, como
// haria el MSAA: el borde comun casi no se toca.
vec3 fxaa( vec2 uv ) {
  vec2 tx = vec2( texel.x, 0.0 );
  vec2 ty = vec2( 0.0, texel.y );
  vec3 m = texture2D( tDiffuse, uv ).rgb;
  vec3 n = texture2D( tDiffuse, uv + ty ).rgb;
  vec3 s = texture2D( tDiffuse, uv - ty ).rgb;
  vec3 e = texture2D( tDiffuse, uv + tx ).rgb;
  vec3 w = texture2D( tDiffuse, uv - tx ).rgb;
  float lm = edgeLuma( m );
  float ln = edgeLuma( n );
  float ls = edgeLuma( s );
  float le = edgeLuma( e );
  float lw = edgeLuma( w );
  float lo = min( lm, min( min( ln, ls ), min( le, lw ) ) );
  float hi = max( lm, max( max( ln, ls ), max( le, lw ) ) );
  float range = hi - lo;
  if ( range < max( 0.04, hi * 0.12 ) ) return m;
  vec3 ca = texture2D( tDiffuse, uv - tx - ty ).rgb;
  vec3 cb = texture2D( tDiffuse, uv + tx - ty ).rgb;
  vec3 cc = texture2D( tDiffuse, uv - tx + ty ).rgb;
  vec3 cd = texture2D( tDiffuse, uv + tx + ty ).rgb;
  float la = edgeLuma( ca );
  float lb = edgeLuma( cb );
  float lc = edgeLuma( cc );
  float ld = edgeLuma( cd );
  lo = min( lo, min( min( la, lb ), min( lc, ld ) ) );
  hi = max( hi, max( max( la, lb ), max( lc, ld ) ) );
  vec2 dir = vec2( ( lc + ld ) - ( la + lb ), ( la + lc ) - ( lb + ld ) );
  float reduce = max( ( la + lb + lc + ld ) * 0.03125, 0.0078125 );
  dir = clamp( dir / ( min( abs( dir.x ), abs( dir.y ) ) + reduce ), -8.0, 8.0 ) * texel;
  vec3 near = 0.5 * ( texture2D( tDiffuse, uv - dir * 0.1667 ).rgb +
    texture2D( tDiffuse, uv + dir * 0.1667 ).rgb );
  vec3 wide = near * 0.5 + 0.25 * ( texture2D( tDiffuse, uv - dir * 0.5 ).rgb +
    texture2D( tDiffuse, uv + dir * 0.5 ).rgb );
  float lwide = edgeLuma( wide );
  vec3 edge = ( lwide < lo || lwide > hi ) ? near : wide;
  float around = ( 2.0 * ( ln + ls + le + lw ) + la + lb + lc + ld ) / 12.0;
  float subpix = smoothstep( 0.0, 1.0, abs( around - lm ) / range );
  vec3 average = ( 2.0 * ( n + s + e + w ) + ca + cb + cc + cd ) / 12.0;
  return mix( edge, average, subpix * subpix * 0.5 );
}

// Los rayos, suavizados con cuatro lecturas en diagonal: se lleva el ruido con
// que se corrio el comienzo de cada linea. Con el sol a la vista sumarian mucho
// y lavarian el cuadro: se comprimen como en Reinhard.
vec3 shaftsAt( vec2 uv ) {
  vec2 o = shaftsTexel * 1.25;
  vec3 s = 0.25 * ( texture2D( tShafts, uv + vec2( -o.x, -o.y ) ).rgb +
    texture2D( tShafts, uv + vec2( o.x, -o.y ) ).rgb +
    texture2D( tShafts, uv + vec2( -o.x, o.y ) ).rgb +
    texture2D( tShafts, uv + vec2( o.x, o.y ) ).rgb );
  return s / ( 1.0 + dot( s, vec3( 1.2, 1.8, 0.6 ) ) );
}
`

const FINISH_READ = /* glsl */ `
  vec3 light = fxaaOn > 0.5 ? fxaa( vUv ) : texture2D( tDiffuse, vUv ).rgb;
  light += texture2D( tBloom, vUv ).rgb * bloomOn;
  if ( shaftsOn > 0.0 ) light += shaftsAt( vUv ) * shaftsOn;
  gl_FragColor = vec4( light, 1.0 );
`

const FINISH_MAIN = /* glsl */ `
  vec3 c = gl_FragColor.rgb;
  float luma = dot( c, vec3( 0.299, 0.587, 0.114 ) );
  c = mix( vec3( luma ), c, saturation );
  c = ( c - 0.5 ) * contrast + 0.5;
  c *= tint;
  vec2 d = ( vUv - 0.5 ) * vec2( min( aspect, 1.6 ), 1.0 );
  c *= 1.0 - vignette * smoothstep( 0.35, 1.05, length( d ) * 1.25 );
  float n = fract( sin( dot( gl_FragCoord.xy + seed, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  c += ( n - 0.5 ) / 255.0;
  gl_FragColor.rgb = c;
}
`

class FinishPass extends OutputPass {
  constructor(bloom, shafts) {
    super()
    Object.assign(this.uniforms, {
      tBloom: { value: bloom.texture },
      bloomOn: { value: 1 },
      tShafts: { value: shafts.texture },
      shaftsOn: { value: 0 },
      shaftsTexel: { value: shafts.texel },
      texel: { value: new THREE.Vector2(1, 1) },
      fxaaOn: { value: 1 },
      tint: { value: new THREE.Vector3(1, 1, 1) },
      saturation: { value: 1 },
      contrast: { value: 1 },
      vignette: { value: 0.25 },
      aspect: { value: 1 },
      seed: { value: 0 }
    })
    this.material.fragmentShader = this.material.fragmentShader
      .replace('varying vec2 vUv;', FINISH_PARS)
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', FINISH_READ)
      .replace(/\}\s*$/, FINISH_MAIN)
  }

  setSize(width, height) {
    this.uniforms.texel.value.set(1 / width, 1 / height)
    this.uniforms.aspect.value = width / Math.max(1, height)
  }
}

export function createEffects({ renderer, scene, camera, settings = {}, lights = {} }) {
  const sky = createSky()
  sky.visible = false
  scene.add(sky)
  // renderer.info cuenta el cuadro entero: se resetea aca, en cada render.
  renderer.info.autoReset = false
  let quality = settings.effects === 'low' ? 'low' : 'high'
  let post = null
  let mood = null
  const backColor = new THREE.Color(0x0b0b0c)
  const size = new THREE.Vector2()
  // Hacia donde esta el sol de los rayos (en el mundo), o null sin rayos.
  let shaftsTo = null
  const sunDirection = new THREE.Vector3()
  const sunPoint = new THREE.Vector3()
  const forward = new THREE.Vector3()

  // La escena va a un buffer de punto flotante (lo que pasa de 1, la lava o el
  // sol, llega entero al brillo), con profundidad: el de EffectComposer.
  function buildPost() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    const composer = new EffectComposer(renderer, target)
    const bloom = new QuarterBloomPass()
    const rays = new ShaftsPass()
    const finish = new FinishPass(bloom, rays)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(rays)
    composer.addPass(finish)
    renderer.getSize(size)
    composer.setSize(size.x, size.y)
    return { composer, bloom, rays, finish, ratio: renderer.getPixelRatio() }
  }

  // Los rayos salen del sol si esta adelante de la camara, y se apagan cuando
  // se va de la pantalla. Devuelve cuanto brillan (0 sin rayos).
  function aimShafts() {
    if (!shaftsTo) return 0
    camera.updateMatrixWorld()
    camera.getWorldDirection(forward)
    if (forward.dot(shaftsTo) <= 0.05) return 0
    sunPoint.copy(camera.position).addScaledVector(shaftsTo, 500).project(camera)
    post.rays.uniforms.sun.value.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5)
    const away = Math.max(Math.abs(sunPoint.x), Math.abs(sunPoint.y))
    return 1 - THREE.MathUtils.smoothstep(away, 0.9, 1.4)
  }

  function freePost() {
    if (!post) return
    for (const pass of post.composer.passes) if (pass.dispose) pass.dispose()
    post.composer.dispose()
    post = null
  }

  // El antialias de la escena: en los mapas, MSAA en el buffer (las junturas
  // de un pixel entre las cajas de los carteles y las murallas solo las
  // resuelve el muestreo); en el titulo, que no las tiene y es lo mas caro,
  // alcanza con el FXAA del pase final.
  function antialias(samples) {
    const { composer, finish } = post
    finish.uniforms.fxaaOn.value = samples ? 0 : 1
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      if (target.samples === samples) continue
      target.samples = samples
      target.dispose()
    }
  }

  // El acabado del cuadro segun el mapa o el titulo. Sin bloom (los mapas de
  // dia) el pase del brillo no corre y el final no lo suma.
  function dress(look) {
    const { bloom, finish } = post
    antialias('msaa' in look ? look.msaa : 4)
    bloom.enabled = !!look.bloom
    if (look.bloom) {
      ;[bloom.strength, bloom.radius, bloom.threshold] = look.bloom
      bloom.highPassUniforms.smoothWidth.value = look.bloom[3]
    }
    const u = finish.uniforms
    u.bloomOn.value = look.bloom ? 1 : 0
    u.tint.value.fromArray(look.tint || [1, 1, 1])
    u.saturation.value = look.saturation || 1
    u.contrast.value = look.contrast || 1
    u.vignette.value = look.vignette
    u.seed.value = (u.seed.value + 17.13) % 1000
  }

  function render(dt, screen) {
    renderer.info.reset()
    if (sky.visible) sky.material.uniforms.time.value = performance.now() / 1000
    if (quality === 'low') {
      renderer.render(scene, camera)
      return
    }
    if (!post) post = buildPost()
    dress(screen === 'menu' ? TITLE : (mood || SHOWCASE).post)
    const rays = aimShafts()
    post.rays.enabled = rays > 0
    post.finish.uniforms.shaftsOn.value = rays
    post.composer.render(dt)
  }

  // El titulo dice hacia donde esta su sol, cada cuadro; null apaga los rayos.
  function shafts(direction) {
    shaftsTo = direction ? sunDirection.copy(direction).normalize() : null
  }

  function setSize(width, height) {
    size.set(width, height)
    if (post && post.ratio !== renderer.getPixelRatio()) freePost()
    if (post) post.composer.setSize(width, height)
  }

  function setQuality(level) {
    quality = level === 'low' ? 'low' : 'high'
    if (quality === 'low') freePost()
  }

  // El cielo, la niebla y las luces de un mapa, o los de la vitrina.
  function atmosphere(data) {
    mood = moodOf(data)
    const look = mood || SHOWCASE
    sky.visible = !!mood
    if (mood) dressSky(sky.material.uniforms, mood)
    backColor.setHex(look.fog[0])
    scene.background = backColor
    scene.fog.color.setHex(look.fog[0])
    scene.fog.near = look.fog[1]
    scene.fog.far = look.fog[2]
    if (lights.sky) {
      lights.sky.color.setHex(look.hemi[0])
      lights.sky.groundColor.setHex(look.hemi[1])
      lights.sky.intensity = look.hemi[2]
    }
    if (lights.sun) {
      lights.sun.color.setHex(look.light[0])
      lights.sun.intensity = look.light[1]
    }
    scene.environmentIntensity = look.env
  }

  return {
    render,
    setSize,
    setQuality,
    atmosphere,
    shafts,
    post: () => post,
    dispose() {
      freePost()
      scene.remove(sky)
      sky.geometry.dispose()
      sky.material.dispose()
    }
  }
}

// El clima de un mapa: el suyo, el de las ruinas o el de la ciudad.
function moodOf(data) {
  if (!data) return null
  if (MOODS[data.id]) return MOODS[data.id]
  return data.kind === 'boss' ? MOODS.boss : MOODS.city
}

// Los uniformes del cielo para un clima con la forma de MOODS (el del titulo
// tambien pasa por aca). El horizonte toma el color de la niebla.
export function dressSky(u, mood) {
  const [turbidity, rayleigh, mie, g] = mood.air
  u.turbidity.value = turbidity
  u.rayleigh.value = rayleigh
  u.mieCoefficient.value = mie
  u.mieDirectionalG.value = g
  skyDirection(mood.sun[0], mood.sun[1], u.sunPosition.value)
  u.skyFrame.value.identity()
  u.skyExposure.value = mood.sky[0]
  u.skyTint.value.setRGB(...mood.sky[1])
  const [sunSide, away, middle, top, shape] = mood.paint
  u.paintSun.value.setHex(sunSide)
  u.paintAway.value.setHex(away)
  u.paintMid.value.setHex(middle)
  u.paintTop.value.setHex(top)
  u.paintShape.value.fromArray(shape)
  const [amount, cover, soft, lit, shade] = mood.clouds || [0, 0.5, 0.2, 0xffffff, 0x808080]
  u.cloudShape.value.set(amount, cover, soft)
  u.cloudLit.value.setHex(lit)
  u.cloudShade.value.setHex(shade)
  u.horizonColor.value.setHex(mood.fog[0])
  u.horizonBand.value.set(-0.03, 0.09, 1)
  // Con el sol bajo el horizonte no hay disco ni halo.
  const [disc, boost, halo, wide] = mood.disc || [0xffd199, 2.2, 0.6, 0.06]
  const up = mood.sun[0] > 0 ? 1 : 0
  u.discColor.value.setHex(disc)
  u.sunSize.value = 0.012
  u.sunGlow.value.set(boost * up, halo * up, halo * up, wide * up)
  u.starAmount.value = mood.stars || 0
  u.moonAmount.value = mood.moon ? 1 : 0
  if (mood.moon) skyDirection(mood.moon[0], mood.moon[1], u.moonDirection.value)
}
