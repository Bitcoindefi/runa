# Nota de coordinación para Claude

Trabajá sobre este repositorio de Windows:

```text
C:\Users\usuario\Grantfox\runa
origin: https://github.com/Bitcoindefi/runa.git
```

Antes de modificar nada, actualizá desde `origin/main` y revisá el estado real
del árbol. No uses `/root/runa-bd`: esa copia WSL quedó con objetos Git
corruptos después de llenar el disco y no contiene la versión canónica del
trabajo visual ya publicado en `main`.

## División de responsabilidades

Codex mantiene el arte ASCII, los mapas y la integración visual. Claude debe
concentrarse en la infraestructura de red, las reglas verificables y los
contratos. No redibujes la ciudad, el Coliseo, el jefe ni los actores sin una
petición explícita del usuario.

## El Coliseo ya existe

No busques un lote libre ni incrustes otro edificio en `MAPS.city`. Los duelos
ocurren en el mapa separado `MAPS.coliseum`, definido en:

- `lib/coliseum.js`: arte 128x52 y coordenadas estables.
- `lib/map.js`: registro del mapa y salida `Q` hacia la ciudad.
- `docs/coliseum.md`: contrato de integración.

La adaptación de duelos debe:

1. Guardar el mapa y la posición previa de ambos participantes.
2. Asignar de forma determinista los lados `west` y `east`.
3. Colocar cada jugador con las coordenadas de
   `MAPS.coliseum.duelSpawns`, sin copiar números a otro módulo.
4. Mantener a los combatientes dentro de `arenaBounds` y bloquear la salida
   `Q` mientras el duelo esté activo.
5. Usar `refereeSpawn` si el protocolo necesita árbitro o autoridad visible.
6. Replicar al rival en el mapa `coliseum` mediante la capa de presencia, sin
   abrir el combate rígido contra monstruos ni crear una segunda arena visual.
7. Al terminar, desconectarse o rendirse, devolver a cada jugador a su
   ubicación previa y restaurar la última revisión del jefe mundial.

Los duelos, los encuentros PvE y el jefe mundial son sesiones distintas. No
mezcles sus estados, daño, temporizadores ni condiciones de salida.

## Jefe mundial existente

El diseño y la ejecución local ya están en `lib/world-boss.js`,
`lib/world-boss-event.js`, `lib/field.js`, `lib/game.js` y `lib/render.js`. El
contrato multijugador esperado está descrito en `docs/world-boss.md` mediante
`{ spawnId, hp, phase, revision }`.

Si recuperás el contrato Soroban de tu scratchpad, hacelo en una rama nueva
creada desde el `origin/main` de este repositorio. No reemplaces la simulación
JavaScript ni declares equivalencia de daño hasta agregar un test cruzado que
ejecute la misma semilla y los mismos ticks en JavaScript y Rust. No agregues
`contracts/target`, cachés, snapshots generados ni dependencias compiladas al
repositorio.

## Verificación obligatoria

Antes de entregar cambios:

```powershell
npm.cmd test
npm.cmd run lint
git diff --check
```

El estado publicado por Codex parte de 65 pruebas y 515 aserciones verdes. Si
una integración cambia ese número, documentá por qué y probá el recorrido
completo: aceptar desafío, entrar al Coliseo, combatir, finalizar y regresar.
