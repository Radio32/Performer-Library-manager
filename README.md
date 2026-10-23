# Performer Library Manager

A web page for preparing drum kits for the **Performer Drums** plug-in on the Expert Sleepers
disting NT. Drop a sound on each of the eight slots, name the kit, and save. You get a kit
folder for the NT's card, with every file named and converted the way the plug-in expects.

**Use it:** https://radio32.github.io/Performer-Library-manager/

Everything runs in the browser. No sound is uploaded anywhere.

## What it does

- **Slots** in the drum machine's order: BD, SNR, CHH, OHH, CLP, P1, P2, CYM. Drop several
  files at once (or a whole folder) and they go to the slots their names point to (`kick`,
  `snare`, `hh`, `tom`…), using the same rules as the plug-in. The rest fill the free slots.
- **Reads** WAV (8/16/24/32-bit, float) and AIFF/AIFC in every browser; MP3, FLAC, Ogg and others
  where the browser can decode them.
- **Converts** to WAV at the sound's own resolution: 24-bit, 32-bit and float sources are written
  as 24-bit, 8 and 16-bit ones as 16-bit (with dither). The NT reads both. Optionally it also:
  - resamples to 48 kHz (64-tap windowed sinc),
  - trims silence before and after the sound,
  - makes stereo files with identical sides mono,
  - normalises to −0.3 dBFS.
- **Names** the folder `NNN-Name` (the kit number pairs with the Performer's pattern `NNN` and
  MIDI program change) and the files `1KIK-NNN.wav`, `5SNR-NNN.wav` and so on.
- **Saves** straight to the card in Chrome and Edge, or as a zip in any browser.

Settings such as pitch, decay and drive are made on the NT and saved in its presets. The
manager writes only standard WAV files with the plug-in's naming, so it keeps working as the
NT's firmware changes.

## Patterns

The second page edits the **Performer's drum patterns**, in its library file `LIBRARY/DRUMS.LIB`:

- **Open** the library from the Performer's card (or drop it on the page), pick a pattern, and
  edit it on an eight-lane grid: BD, SNR, CHH, OHH, CLP, P1, P2, CYM, up to 4 bars of 1/16.
  Click a step to set it, SHIFT + click (or right click) for an accent, drag to paint. Name,
  style, length, tempo and swing are there too.
- **Play** a pattern with its kit: open a folder of kits (like `BY KIT`) and pattern N plays kit
  N, the way the Performer's kit track picks it by program change. Or play it with the kit on
  the Kits page. The Performer's swing, its velocities (90, accents 127) and the closed hi-hat
  cutting the open one are all there.
- **Import MIDI:** a `.mid` file's drum notes go to the lanes. The pattern pack's notes (60–67),
  General MIDI drums and the `loops` layout are recognised; longer files become several 4-bar
  patterns, and swing is read from the timing.
- **Export MIDI** with General MIDI notes on channel 10 (for a DAW), or with the pattern pack's
  notes (60–67, for the MIDI collection that midi2lib builds the library from).
- **Save** the library back to the card (in place, in Chrome and Edge) or download it. New and
  imported patterns are added at the end, so the numbers of the others, and their kits, stay.

The manager writes exactly the format the Performer reads (library format 6, Conducting
Performer v29 and later): written back unchanged, a library comes out byte for byte the same.

## On the card

Copy the kit folder into the card's `samples` folder, or a folder inside it such as
`samples/Performer Drums`. The NT scans for samples when it starts, so restart it afterwards.

## Development

Plain HTML, CSS and JavaScript; no build step. `js/naming.js` follows the plug-in's
`src/kit.h`. The tests use macOS's built-in JavaScript engine:

```sh
test/run.sh                       # naming, AIFF, resampling, WAV writing, drum patterns
test/run.sh "path/to/BY KIT"      # also reads and prepares every WAV in a kit library
test/run.sh "" path/to/DRUMS.LIB path/to/patterns-v2
                                  # reads the Performer's library and writes it back (byte for
                                  # byte), and imports the pattern pack's MIDI files against it
```
