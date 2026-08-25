# Solution for Issue #9

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The NPC occupies a visual footprint of 7 columns on screen (`ax-3` to `ax+3`), but only blocks a single tile/cell in logic. This causes the hero sprite to overlap and visually overwrite the NPC art when standing at the interaction threshold distance, and allows the player to walk right through the NPC sprite.

### Fix
Update `mapPane` (and `npcAt` / collision logic) to match the presentation pattern used in `lib/render.js` (like `fieldPane`), ensuring the NPC's full horizontal footprint blocks movement and defines the interaction bounds appropriately without breaking logical positioning.

### Implementation
```javascript
// lib/mapPane.js (or equivalent map & NPC collision handler)
function npcAt(x, y) {
  // Check if coordinates fall within the NPC's extended visual/collision footprint
  for (const npc of npcs) {
    if (y === npc.y && x >= npc.x - 3 && x <= npc.x + 3) {
      return npc;
    }
  }
  return null;
}

// Update collision checking so the entire footprint blocks movement
function isWalkable(x, y) {
  if (npcAt(x, y)) return false;
  // ... existing tile checks ...
}
```

### Testing
1. Verify that trying to walk into any of the 7 columns occupied by the NPC correctly blocks movement.
2. Verify that talking to the NPC works smoothly at the adjusted interaction threshold without visual sprite overlapping.


---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`