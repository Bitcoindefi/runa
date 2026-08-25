# Solution for Issue #10

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The dungeon map in `Bitcoindefi/runa` (`Bitcoindefi/runa/issues/10`) has 941 walkable cells and proper structural boundaries, but lacks content because `dungeon.npcs` is undefined, and arrival position causes visual clipping (`arrive` at `(3,2)` where a 3-row sprite overflows into row `0` `#` walls). Also, wall padding inconsistency at `lib/map.js:1159` causes jagged right borders.

### Fix
Populate `dungeon.npcs` and interactive elements in the map definition, adjust arrival coordinates to prevent top-wall clipping, and ensure uniform row padding for the dungeon map borders.

### Implementation
```javascript
// lib/maps/dungeon.js (or map definition config)
export const dungeonMap = {
  id: 'dungeon',
  name: 'Las ruinas bajo el castillo',
  arrive: [3, 4], // Adjusted from [3,2] to prevent head sprite clipping into row 0 wall (#)
  npcs: [
    {
      id: 'ancient_spirit',
      pos: [15, 8],
      dialogue: [
        "El eco de los tiempos antiguos resuena en estas piedras.",
        "Buscas la Runa perdida... ten cuidado con lo que despiertas."
      ],
      interact: 'dialogue'
    },
    {
      id: 'hidden_cache',
      pos: [42, 12],
      dialogue: ["Encontraste una antigua reliquia olvidada en el polvo."],
      item: 'relic_fragment',
      interact: 'loot'
    }
  ],
  tiles: {
    '2,2': { enter: 'gate.dungeon-return', label: 'subis de las ruinas y volves al castillo' }
  }
};

// lib/map.js map generation padding fix for jagged right wall
function sanitizeDungeonRow(row) {
  return row.padEnd(62, '#');
}
```

### Testing
1. Verify that `dungeon.npcs` is defined and contains active entities.
2. Enter dungeon at `(3,4)` and verify hero sprite does not overlap top border walls.
3. Interact with cells to ensure active NPC dialogue and loot mechanisms trigger correctly across the 941 walkable cells.
4. Verify right wall padding uniformity.

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`