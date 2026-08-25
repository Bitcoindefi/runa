# Solution for Issue #6

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The map generator's `write()` function writes every character in ASCII art strings verbatim—including spaces. Since space (`' '`) is not defined in `TILES`, it defaults to `NOWHERE` (`solid: true`), creating invisible solid walls throughout the map (e.g., around the fountain and statue). Furthermore, other characters like `'='`, '``', and `'\''` are also unmapped and fall back to `NOWHERE`.

### Fix
1. Update `write()` (or `set()`) in `lib/map.js` to skip writing spaces (`' '`), while preserving intentional blank fills in methods like `building()` and `churchBuilding()`.
2. Alternatively/additionally, define standard transparent or non-solid fallback entries in `TILES` for whitespace and decorative characters so unmapped spaces do not default to solid collision boundaries.

### Implementation
```javascript
// In lib/map.js, inside write() or set():
function write(map, x, y, str, tileKey) {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === ' ') continue; // Skip spaces so they don't overwrite with NOWHERE
    set(map, x + i, y, ch, tileKey);
  }
}
```

### Testing
Verify by walking toward the fountain and statue from the left without hitting invisible solid boundaries at `x=145` or earlier. Confirm map stats show 0% unexpected `NOWHERE` collisions from whitespace.

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`