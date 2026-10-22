# Review of the Patterns page (commit 1fbe655)

From the Performer Drums session, 2026-10-21. For the Conducting-Performer session, which wrote
the Patterns page and owns the drum library format.

## Before you start: uncommitted changes in this working tree

The Performer Drums session changed the **Kits** page after your commit. Those changes are in
this working tree and are **not committed yet**:

- `js/audio.js`: new `encodeWav(sound, bits, seed)` (16-bit with dither, or 24-bit) and
  `outputBits(sound)`. `prepare()` now returns `bits` as well. `encodeWav16` is still there.
- `js/app.js`: kit files are written at `prepared.bits`. The slot shows "→ 24-bit mono…".
- `index.html`, `README.md`: the text says files keep their resolution.
- `test/test.js`: a 24-bit round-trip check and a bit-depth check.

The rule: 8-bit and 16-bit sources are written as 16-bit, and 24-bit, 32-bit, float and
compressed sources as 24-bit. The NT reads both.

Keep these changes when you fix the items below, and commit them along with your fixes or
separately. The user confirmed that the disting NT handles 24-bit files.

## What was checked, and passed

Run with `test/run.sh "../Performer Drums/BY KIT" ../performer-master/build/library/LIBRARY/DRUMS.LIB ../performer-master/midi-library/drums/patterns-v2`:

- **Reading:** the real `DRUMS.LIB` (format 6, 121 patterns) reads.
- **Writing:** writing it back gives the same file, byte for byte (19,889 bytes).
- **MIDI import:** importing the 71 `patterns-v2` MIDI files gives exactly the library's
  patterns.
- **Round trips:** all synthetic checks pass (64 steps, accents, export → import, layout
  detection).
- **Notes:** `GM_NOTES` matches the plug-in's `kGmNotes`, and `PACK_NOTES` matches the pattern
  pack.
- **Kits page:** unchanged by your commit, apart from the `window.PDKits` hook.

## Findings, most important first

### 1. Playback level of unaccented hits doesn't match the plug-in

`js/patterns.js:10`: `var NORMAL = 90 / 127;`, used at `js/patterns.js:390`.

- **The page:** velocity 90 plays at linear gain 90/127 = 0.71 (−3.0 dB), and accents at 1.0.
- **The plug-in:** at its default velocity depth of 100 %, the gain is `(velocity/127)²`
  (`Performer Drums/src/dsp.h:447`, `velocityGain`). So 90 plays at 0.50 (−6.0 dB).
- **Effect:** accents stand out half as much in the browser as on the NT.
- **Fix:** `var NORMAL = (90 / 127) * (90 / 127);`. Better still, add a small
  `velocityGain(vel)` helper with the plug-in's formula, so it stays right if other velocities
  come from the Performer later (SPEC.md section 5 plans an adjustable accent velocity).

### 2. The hi-hat choke only works one way

`js/patterns.js:372`: only `CHH` cuts a ringing `OHH`.

- **The plug-in:** CHH and OHH are both in choke group A by default
  (`Performer Drums/src/kit.h:18`, `kDefaultChoke`). A hit on either fades out the other, over
  5 ms.
- **Fix:** keep the last source of each of the two voices, and let a hit on one fade out the
  other. A 5 ms fade matches the plug-in (`kChokeFadeMs`); the page uses `setTargetAtTime(…, 0.004)`,
  which is close enough.

### 3. Patterns 071–120 play silently with `BY KIT`

- **Why:** the library has 121 patterns: 000–070 from `patterns-v2` and 071–120 from `loops`.
  The kits folder only has kits 001–070, so the loops have no matching kit. Pattern 000 has none
  either.
- **Now:** the page shows "No kit 071 in the folder: silent." (`js/patterns.js:349`). That's
  correct, but easy to miss when you press Play.
- **Fix, either of:**
  - when there's no matching kit, play with the nearest kit or the last one used, and say so
    ("No kit 071: playing 070-Move"),
  - or add a "kit" choice for the selected pattern, used only on this page.

  Don't change the numbering. Pattern N ↔ kit N ↔ program change N is the contract (SPEC.md
  Q5).

### 4. Files dropped outside the pattern area go to the hidden Kits page

- **Where:** `js/app.js:367–368` listens for `drop` on the whole `document`.
  `#pagePatterns` stops propagation, but only for drops inside it.
- **What happens:** on the Patterns tab, a drop on the header, the tabs or the footer reaches
  the Kits page's handler. Sound files then load into the Kits slots without the user seeing it,
  and MIDI or `.LIB` files give a "None of those are sound files" message on a page that isn't
  shown.
- **Fix:** in the document handler in `app.js`, return early when `location.hash === "#patterns"`.
  Or move the Patterns page's handlers onto `document` and route by the visible page.

### 5. The library test crashes on an old-format file

- **Where:** `test/test.js` around line 148 calls `DrumLib.readLibrary(bytes)` unguarded.
- **What happens:** `../performer-master/build/library/DRUMS.LIB` (one folder up from
  `LIBRARY/`) is a stale format 1 file. Passed to `test/run.sh`, it stops the run with an
  exception, and no FAIL line or summary is printed.
- **Fix:** wrap it in `try`/`catch` and report it with `check(false, "reads DRUMS.LIB", e.message)`.

### 6. Minor: the pack comparison can't pass with the test library

- **What happens:** with `build/test-library/LIBRARY/DRUMS.LIB` (4 patterns), "MIDI import of
  the pattern pack matches the library" fails for 000–002, because that fixture isn't the
  pattern pack. It's a wrong pairing of inputs, not a bug.
- **Fix:** skip the comparison when the library and the folder plainly don't belong together
  (for example, a different pattern count), or say so in the output.

## Not issues, for the record

- **Kit audio:** the Patterns page plays kits from the original files. The plug-in resamples
  the same way, so that's fine.
- **The `PDKits` hook** (`app.js`) is a clean way to share the Kits page's sounds. Keep it.
- **Swing:** the timing (`stepTime`) matches the Performer's 1/16 swing.

## Resolved (2026-10-22, Conducting-Performer session)

1. Playback level: `velocityGain(velocity)` = (velocity / 127)², as the plug-in. Velocity 90 plays at 0.50.
2. Hi-hat choke: CHH and OHH cut each other.
3. A pattern with no matching kit plays the nearest kit below it (or the first one), and the label says so.
4. Drops on the Patterns tab never reach the Kits page's handler.
5. The library test reports an unreadable library as a FAIL line instead of stopping.
6. The pack comparison is skipped, with a note, for a library that isn't the pack's (fewer than 71 patterns).

Committed together with the Performer Drums session's 24-bit WAV changes.
