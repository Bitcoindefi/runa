# Solution for Issue #8

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The bug occurs because `view()` (`lib/game.js:1218`) checks for nearby NPCs using a radius of 2 (`this.nearbyNpc(2)`), whereas `enter()` (`lib/game.js:828`) uses the default radius of 1 (`this.nearbyNpc()`). This causes the UI to display `"e hablar"` (via `view`) when the player is 2 tiles away from an NPC, but pressing `E` fails (`"aca no hay nada"`) because `enter()` requires distance 1.

### Fix
Update `enter()` (or wherever NPC interaction is triggered) to use the same range/radius check as `view()`, or standardize the range across both functions to 2 so that interaction matches the visual prompt (or vice versa depending on intended design, but matching `view()`'s range of 2 or unifying via a constant/parameter makes the prompt and action consistent). 

Looking at the issue details:
`view()` uses `this.nearbyNpc(2)` and `enter()` uses `this.nearbyNpc()`. To make the `E` key reach NPCs at distance 2 where the sign/prompt says `e hablar`, `enter()` should be updated to `this.nearbyNpc(2)`.

### Implementation
```javascript
// In lib/game.js
// Update enter() to match view()'s range of 2:
enter() {
  // ...
  const npc = this.nearbyNpc(2);
  // ...
}
```

### Testing
Verify that standing at distance 2 (`dist=2`) from an NPC correctly triggers the interaction when pressing `E`, eliminating the `"aca no hay nada"` false negative when the UI shows `"e hablar"`.

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`