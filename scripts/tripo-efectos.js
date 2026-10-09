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
//   post()              el postproceso armado, para medir desde la consola
//   dispose()
//
// Tambien exporta createSky: el cielo de three.js (Sky, el modelo de Preetham)
// con exposicion propia, sol grande, estrellas, luna y un horizonte que se funde
// con la niebla. El titulo (titulo.js) arma el suyo con la misma funcion.
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

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { performance } = globalThis

// --- El cielo ---------------------------------------------------------------

// Lo que se suma al shader de Sky. skyFrame gira el cielo entero (sol, nubes y
// estrellas) respecto del mundo: el titulo lo gira con la camara. La curva de
// tono es la ACES de three.js, propia del cielo: el resto de la escena se dibuja
// sin curva, con los colores que eligieron los modulos del mundo.
const SKY_PARS = /* glsl */ `
uniform mat3 skyFrame;
uniform float skyExposure;
uniform vec3 skyTint;
uniform vec3 zenithTint;
uniform vec3 beltColor;
uniform vec3 nightZenith;
uniform vec3 nightHorizon;
uniform vec3 horizonColor;
uniform vec3 horizonBand;
uniform vec3 discColor;
uniform float sunSize;
uniform float sunBoost;
uniform float sunHalo;
uniform float starAmount;
uniform vec3 moonDirection;
uniform vec3 moonColor;
uniform float moonAmount;

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
  vec3 sky = skyTone( gl_FragColor.rgb * skyExposure ) * skyTint;
  sky += mix( nightHorizon, nightZenith, smoothstep( 0.0, 0.45, direction.y ) );

  // El cielo pintado: el cenit se tine (el azul hondo del alba) y sobre el
  // horizonte va una franja rosa, que se dora hacia el sol.
  vec2 across = direction.xz / max( length( direction.xz ), 0.0001 );
  vec2 sunAcross = vSunDirection.xz / max( length( vSunDirection.xz ), 0.0001 );
  float facing = pow( max( dot( across, sunAcross ), 0.0 ), 2.0 );
  sky *= mix( vec3( 1.0 ), zenithTint, smoothstep( 0.04, 0.75, direction.y ) );
  float belt = exp( -pow( ( direction.y - 0.06 ) / 0.1, 2.0 ) );
  sky += beltColor * belt * ( 1.0 - facing * 0.55 );

  // Un sol mas grande que el real, con un halo propio: de lejos se lee mejor.
  float sunCos = dot( direction, vSunDirection );
  float sunDisc = smoothstep( cos( sunSize * 1.35 ), cos( sunSize ), sunCos );
  float sunGlow = pow( max( sunCos, 0.0 ), 900.0 ) * 0.55 + pow( max( sunCos, 0.0 ), 45.0 ) * 0.1;
  sky += discColor * ( sunDisc * sunBoost + sunGlow * sunHalo );

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

  // Abajo el cielo se funde con la niebla: el suelo lejano se pierde en el.
  float band = ( 1.0 - smoothstep( horizonBand.x, horizonBand.y, direction.y ) ) * horizonBand.z;
  sky = mix( sky, horizonColor, band );
  gl_FragColor.rgb = sky;
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
  Object.assign(u, {
    skyFrame: { value: new THREE.Matrix3() },
    skyExposure: { value: 0.5 },
    skyTint: { value: new THREE.Color(1, 1, 1) },
    zenithTint: { value: new THREE.Color(1, 1, 1) },
    beltColor: { value: new THREE.Color(0, 0, 0) },
    nightZenith: { value: new THREE.Color(0, 0, 0) },
    nightHorizon: { value: new THREE.Color(0, 0, 0) },
    horizonColor: { value: new THREE.Color() },
    horizonBand: { value: new THREE.Vector3(-0.03, 0.08, 1) },
    discColor: { value: new THREE.Color(1, 0.8, 0.55) },
    sunSize: { value: 0.012 },
    sunBoost: { value: 2 },
    sunHalo: { value: 1 },
    starAmount: { value: 0 },
    moonDirection: { value: new THREE.Vector3(0, 0.2, -1) },
    moonColor: { value: new THREE.Color(1.5, 1.46, 1.36) },
    moonAmount: { value: 0 }
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
//        brillo, halo] del disco del sol, si no es el de siempre.
// air    [turbidez, rayleigh, mie, g de mie, nubes] del modelo de Preetham
// sky    [exposicion, tinte] del cielo; night [horizonte, cenit], el color que
//        la noche suma al cielo; stars y moon [elevacion, rumbo] de la luna
// fog    [color, cerca, lejos]: la niebla y el horizonte del cielo
// hemi   [arriba, abajo, intensidad] de la luz de hemisferio
// light  [color, intensidad] de la direccional; env, cuanto reflejan los PBR
// post   bloom [fuerza, radio, umbral, rodilla]: brilla lo que pasa del umbral
//        en su canal mas alto; saturacion, contraste y tinte del acabado. Sin
//        bloom (de dia) el pase del brillo no corre: quedan FXAA y el acabado.
const MOODS = {
  // La ciudad de RUNA a la manana: sol bajo al noreste, aire limpio.
  city: {
    sun: [11, 55],
    air: [2.6, 1.3, 0.005, 0.8, 0.25],
    sky: [0.5, [1, 1, 1]],
    fog: [0xb7c2cc, 60, 150],
    hemi: [0xdfe6ef, 0x3d3020, 1.3],
    light: [0xffe7c6, 2.5],
    env: 0.45,
    post: { bloom: null, vignette: 0.2 }
  },
  // NOX es de noche: luna al norte, estrellas, luz fria; brillan las ventanas,
  // las juntas y las flores.
  nox: {
    sun: [-1.5, 250],
    air: [2, 3.2, 0.004, 0.75, 0],
    sky: [1.6, [0.75, 0.82, 1.25]],
    night: [0x101e44, 0x03060f],
    stars: 1.8,
    moon: [6.5, 12],
    fog: [0x1a2140, 55, 140],
    hemi: [0x6a7cc8, 0x1a1428, 0.88],
    light: [0xa9b9ff, 1.15],
    env: 0.22,
    post: {
      bloom: [0.75, 0.5, 0.82, 0.35],
      vignette: 0.32,
      saturation: 1.0,
      contrast: 1.06,
      tint: [0.95, 0.98, 1.06]
    }
  },
  // El castillo a pleno dia.
  castle: {
    sun: [38, 140],
    air: [2.2, 1, 0.004, 0.8, 0.3],
    sky: [0.5, [1, 1, 1]],
    fog: [0xadbccb, 60, 150],
    hemi: [0xe3e9f2, 0x3a3326, 1.35],
    light: [0xfff4e2, 2.5],
    env: 0.45,
    post: { bloom: null, vignette: 0.18 }
  },
  // El Coliseo a la tarde: sol dorado al oeste.
  coliseum: {
    sun: [12, 285],
    air: [4, 1.6, 0.007, 0.82, 0.2],
    sky: [0.55, [1, 1, 1]],
    fog: [0xd2bc9e, 60, 150],
    hemi: [0xeadfcc, 0x4a3420, 1.25],
    light: [0xffd6a0, 2.6],
    env: 0.45,
    post: { bloom: null, vignette: 0.24 }
  },
  // Las ruinas volcanicas: humo, cielo rojo oscuro y un sol rojo y apagado por
  // la ceniza, detras de la camara; abajo, la lava.
  boss: {
    sun: [5, 175],
    disc: [0xff5a2a, 1.1, 0.25],
    air: [9, 2.2, 0.004, 0.8, 0.5],
    sky: [0.12, [1.0, 0.36, 0.22]],
    night: [0x3c0f06, 0x0c0306],
    fog: [0x3d1b12, 50, 130],
    hemi: [0xb46e52, 0x5a1a08, 1.15],
    light: [0xffa676, 2.05],
    env: 0.35,
    post: {
      bloom: [0.75, 0.55, 1.0, 0.5],
      vignette: 0.36,
      saturation: 1.08,
      contrast: 1.06,
      tint: [1.05, 0.97, 0.92]
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

// El titulo: un alba con lava; brilla mas que los mapas.
const TITLE = {
  bloom: [0.6, 0.5, 0.95, 0.6],
  vignette: 0.26,
  saturation: 1.06,
  contrast: 1.05,
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

// El pase final es OutputPass (el paso a sRGB de three.js) con tres cosas mas
// en el mismo shader, que en los ejemplos son pases aparte: el antialias FXAA
// (la escena se dibuja sin MSAA, que en una placa integrada costaba mas que
// todo el postproceso), la suma del brillo y el acabado: tono por mapa,
// vineta y un grano de medio escalon contra las bandas del cielo.
const FINISH_PARS = /* glsl */ `
uniform sampler2D tBloom;
uniform float bloomOn;
uniform vec2 texel;
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

// FXAA de Timothy Lottes en su forma corta: las cuatro diagonales dicen si hay
// un borde y hacia donde corre, y cuatro lecturas mas lo suavizan a lo largo.
// Donde no hay contraste (casi toda la pantalla) sale con una sola lectura.
vec3 fxaa( vec2 uv ) {
  vec3 m = texture2D( tDiffuse, uv ).rgb;
  float lm = edgeLuma( m );
  float lnw = edgeLuma( texture2D( tDiffuse, uv + vec2( -1.0, -1.0 ) * texel ).rgb );
  float lne = edgeLuma( texture2D( tDiffuse, uv + vec2( 1.0, -1.0 ) * texel ).rgb );
  float lsw = edgeLuma( texture2D( tDiffuse, uv + vec2( -1.0, 1.0 ) * texel ).rgb );
  float lse = edgeLuma( texture2D( tDiffuse, uv + vec2( 1.0, 1.0 ) * texel ).rgb );
  float lo = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) );
  float hi = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
  if ( hi - lo < max( 0.04, hi * 0.12 ) ) return m;
  vec2 dir = vec2( ( lsw + lse ) - ( lnw + lne ), ( lnw + lsw ) - ( lne + lse ) );
  float reduce = max( ( lnw + lne + lsw + lse ) * 0.03125, 0.0078125 );
  dir = clamp( dir / ( min( abs( dir.x ), abs( dir.y ) ) + reduce ), -8.0, 8.0 ) * texel;
  vec3 a = 0.5 * ( texture2D( tDiffuse, uv - dir * 0.1667 ).rgb +
    texture2D( tDiffuse, uv + dir * 0.1667 ).rgb );
  vec3 b = a * 0.5 + 0.25 * ( texture2D( tDiffuse, uv - dir * 0.5 ).rgb +
    texture2D( tDiffuse, uv + dir * 0.5 ).rgb );
  float lb = edgeLuma( b );
  return ( lb < lo || lb > hi ) ? a : b;
}
`

const FINISH_READ = /* glsl */ `
  gl_FragColor = vec4( fxaa( vUv ) + texture2D( tBloom, vUv ).rgb * bloomOn, 1.0 );
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
  constructor(bloom) {
    super()
    Object.assign(this.uniforms, {
      tBloom: { value: bloom.texture },
      bloomOn: { value: 1 },
      texel: { value: new THREE.Vector2(1, 1) },
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

  // La escena va a un buffer de punto flotante (lo que pasa de 1, la lava o el
  // sol, llega entero al brillo), sin MSAA y con profundidad: el de EffectComposer.
  function buildPost() {
    const composer = new EffectComposer(renderer)
    const bloom = new QuarterBloomPass()
    const finish = new FinishPass(bloom)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(finish)
    renderer.getSize(size)
    composer.setSize(size.x, size.y)
    return { composer, bloom, finish, ratio: renderer.getPixelRatio() }
  }

  function freePost() {
    if (!post) return
    for (const pass of post.composer.passes) if (pass.dispose) pass.dispose()
    post.composer.dispose()
    post = null
  }

  // El acabado del cuadro segun el mapa o el titulo. Sin bloom (los mapas de
  // dia) el pase del brillo no corre y el final no lo suma.
  function dress(look) {
    const { bloom, finish } = post
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
    post.composer.render(dt)
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

// Los uniformes del cielo para un mapa.
function dressSky(u, mood) {
  const [turbidity, rayleigh, mie, g, clouds] = mood.air
  u.turbidity.value = turbidity
  u.rayleigh.value = rayleigh
  u.mieCoefficient.value = mie
  u.mieDirectionalG.value = g
  u.cloudCoverage.value = clouds
  u.cloudDensity.value = 0.35
  skyDirection(mood.sun[0], mood.sun[1], u.sunPosition.value)
  u.skyFrame.value.identity()
  u.skyExposure.value = mood.sky[0]
  u.skyTint.value.setRGB(...mood.sky[1])
  const [horizon, zenith] = mood.night || [0, 0]
  u.nightHorizon.value.setHex(horizon)
  u.nightZenith.value.setHex(zenith)
  u.horizonColor.value.setHex(mood.fog[0])
  u.horizonBand.value.set(-0.03, 0.09, 1)
  const [disc, boost, halo] = mood.disc || [0xffd199, 2.2, 0.6]
  const up = mood.sun[0] > 0 ? 1 : 0
  u.discColor.value.setHex(disc)
  u.sunSize.value = 0.012
  u.sunBoost.value = boost * up
  u.sunHalo.value = halo * up
  u.starAmount.value = mood.stars || 0
  u.moonAmount.value = mood.moon ? 1 : 0
  if (mood.moon) skyDirection(mood.moon[0], mood.moon[1], u.moonDirection.value)
}
