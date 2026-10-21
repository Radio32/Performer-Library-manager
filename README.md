# Performer Library Manager

A web page for preparing drum kits for the **Performer Drums** plug-in on the Expert Sleepers
disting NT. Drop a sound on each of the eight slots, name the kit, and save. You get a kit
folder for the NT's card, with every file named and converted the way the plug-in expects.

**Use it:** https://docljunior.github.io/Performer-Library-manager/

Everything runs in the browser. No sound is uploaded anywhere.

## What it does

- **Slots** in the drum machine's order: BD, SNR, CHH, OHH, CLP, P1, P2, CYM. Drop several
  files at once (or a whole folder) and they go to the slots their names point to (`kick`,
  `snare`, `hh`, `tom`…), using the same rules as the plug-in. The rest fill the free slots.
- **Reads** WAV (8/16/24/32-bit, float) and AIFF/AIFC in every browser; MP3, FLAC, Ogg and others
  where the browser can decode them.
- **Converts** to 16-bit WAV with dither, and optionally:
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

## On the card

Copy the kit folder into the card's `samples` folder, or a folder inside it such as
`samples/Performer Drums`. The NT scans for samples when it starts, so restart it afterwards.

## Development

Plain HTML, CSS and JavaScript; no build step. `js/naming.js` follows the plug-in's
`src/kit.h`. The tests use macOS's built-in JavaScript engine:

```sh
test/run.sh                       # naming, AIFF, resampling, WAV writing
test/run.sh "path/to/BY KIT"      # also reads and prepares every WAV in a kit library
```
