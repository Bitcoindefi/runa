# Solution for Issue #7

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
In `lib/render.js`, `mapScreen` calculates `usefulMapW` and decides to hide the sidebar when the terminal width falls between 64 and 90 columns. This leaves the city view without a sidebar (ficha/log), making valid game actions appear completely unresponsive because the UI doesn't redraw the log or character sheet.

### Fix
Modify `mapScreen` in `lib/render.js` to ensure the sidebar is always rendered when width supports standard panels (or adapt `usefulMapW` / `sidebar` logic so that city screens don't drop the sidebar in the 64..90 range, similar to shop and field screens).

### Implementation
```javascript
// lib/render.js fix snippet
// Ensure mapScreen includes sidebar for width >= 64, letting the map pane scroll/clip properly instead of dropping the entire sidebar/log.
function mapScreen(state, screenW, screenH) {
  // ...
  const minWidthForSidebar = 64;
  const showSidebar = screenW >= minWidthForSidebar;
  // ...
}
```

### Testing
Verify that terminal widths between 64 and 90 columns correctly render the city sidebar (ficha and log) upon performing actions like `g.walker.placeAt('city', 26, 130)`.


---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`