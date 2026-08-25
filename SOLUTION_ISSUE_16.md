# Solution for Issue #16

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The hero sprite is drawn into the overlay grid using `over.set(cell, line[sx])` inside `lib/render.js` without checking whether the target destination cell (`cell.x`, `cell.y`) is solid (`isSolid`). Specifically, multi-row sprites extend upwards into cells that may contain walls (`#`), causing the upper part of the hero sprite (e.g. head/torso) to render over solid masonry.

### Fix
Update `lib/render.js` around line 712 to verify that the target cell is not solid before writing the sprite character to the overlay buffer. If `isSolid(map, cx, cy)` is true for the coordinate being rendered, skip drawing that character of the sprite.

### Implementation
```javascript
// In lib/render.js around line 706-715:
// Ensure we don't paint through solid walls / obstacles
if (!isSolid(map, cx, cy)) {
  over.set(cell, line[sx]);
}
```

### Testing
1. Enter the dungeon map where `arrive` is at `(3,2)`.
2. Verify that the hero's head/body characters do not render over the top wall (`row 0`).
3. Verify field entry remains correctly bounded without rendering into upper solid barriers.

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`