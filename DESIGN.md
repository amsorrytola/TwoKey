# INTERLOCK — Design System (locked)

Direction: **industrial control room / avionics instrument panel.** Editorial density, zero decoration.
The UI must read as an operator console that governs money-moving AI actions — not a marketing page.
This file is the single source of truth. Every screen is built only from these tokens.

## Palette
Ground        #0B0D10   (near-black; NOT navy, NOT purple-tinted)
Panel         #14171C
Panel-raised  #1A1E24
Rule          #262B33   (1px hairlines; the ONLY way to separate regions)
Ink           #E6E8EB   primary text
Ink-2         #8B929C   secondary
Ink-3         #5C6470   muted / labels / timestamps

Signal — used ONLY to encode lane / state, never decoration:
AUTO          #3DDC97   green
EDIT          #F5B942   amber
TWO_KEY       #4FA3FF   blue
HUMAN         #FF7A59   orange
BLOCK         #FF4D4D   red
Check pass    #3DDC97 · warn #F5B942 · fail #FF4D4D

Brand accent  #A100FF   Accenture purple (PMS 7442 C). Allowed on: the ">" mark, the
              active-tab underline (2px), focus rings, command-palette border and selection,
              selected-row wash at 13% alpha. NEVER a gradient, NEVER a large fill.
              Lane state keeps its own colours because there colour is DATA, not branding —
              purple cannot encode five states.

Light theme (Accenture white, for projectors that wash out dark UI):
Ground #FFFFFF · Panel #FBFBFC · Panel-2 #F4F1F8 · Rule #E2E2E7 · Ink #08080A.
Signal colours darken for contrast on white (auto #067A55, block #C11B1B, etc).

## Accessibility
Colour is never the only cue. Every lane carries a GLYPH and a word as well as a hue:
  AUTO ›   EDIT ⊘   TWO-KEY ‖   HUMAN △   BLOCK ✕
Signal hues also differ in lightness, so they separate under deuteranopia and in greyscale.
Focus rings are visible and purple, never removed. All motion is disabled under
prefers-reduced-motion.

## Type
Display/body  "IBM Plex Sans"  (Google Fonts) — 400 body, 500 labels, 600 headings. No 700+.
Mono          "JetBrains Mono" (Google Fonts) — IDs, amounts, hashes, latency, timestamps, model names, anything numeric.
Scale         11 / 13 / 15 / 20 / 28 px. Line-height 1.4. `font-variant-numeric: tabular-nums` globally.
Labels        11px, uppercase, letter-spacing 0.08em, Ink-3.
Two families total. No Inter. No gradient text.

## Geometry
Radius        2px on everything. No pills except lane chips (2px too — they are rectangles).
Shadow        None. Hierarchy = background steps + 1px rules.
Grid          12-col, 8px baseline. Dense: 3+ panels per fold. Panels padded 12–16px.
Borders       1px Rule. Panels are bordered, not shadowed.

## Motion (only meaning-bearing)
Verdict lands          120ms opacity fade-in
Check completes        progress bar fills at real elapsed time; status dot snaps
Ledger row appended    80ms slide from top
Lane counter changes   number ticks (no easing bounce)
Easing                 ease-out only. Nothing bounces, nothing shimmers, no page transitions, no hover lift.

## Charts
Monochrome ink for series; signal colours only when encoding lane/state.
Risk vector = 4-axis radar, 1.5px stroke, 8% fill opacity, no gradient.
Check timeline = horizontal Gantt with parallel lanes, real milliseconds, mono axis labels.
Sparklines in stream rows = 4 tiny vertical bars (hallucination · privacy · bias · blast-radius).

## Copy
Terse, operational, ISO timestamps, currency with code.
  "Verdict HOLD · 3/5 checks failed · routed HUMAN"          ✓
  "Uh-oh! We found some issues 🚨"                            ✗
Empty states read like a console: "No actions awaiting review. Last human decision 14 min ago."

## Persistent status bar (top, 32px)
`■ INTERLOCK   claims-settlement · EU pack · τ 0.020 · 1,240 actions today · ledger ✓ #a3f9…c21e   [dark/light]`
Logo mark = 6px purple square + "INTERLOCK" in Plex 600 13px letter-spaced.

## Banned (any of these = rejected)
gradients · glassmorphism/blur · icon+heading+2-lines card grids · gradient text · nested cards ·
emoji in UI · "✨ AI-powered" labels · rounded avatars · confetti · bounce/elastic easing ·
skeleton shimmer · big-number KPI tiles with coloured backgrounds · purple backgrounds of any kind.
