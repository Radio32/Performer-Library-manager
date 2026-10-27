// Tests for phraselib.js on the Performer's libraries: every file read and written back byte for
// byte, every progression decoded and encoded again. Run with test/run.sh (its fourth argument).
"use strict";
var dir = arguments[0], failures = 0;
function check(ok, what, detail) {
  print((ok ? "  ok   " : "  FAIL ") + what + (detail !== undefined ? "  (" + detail + ")" : ""));
  if (!ok) failures++;
}
print("Phrase libraries");
["BASS", "MELODY", "DRUMS", "PROGS"].forEach(function (n) {
  var buf;
  try { buf = readFile(dir + "/" + n + ".LIB", "binary"); } catch (e) { print("  skip " + n + ".LIB (not found)"); return; }
  var lib = PhraseLib.read(buf), out = PhraseLib.write(lib.kind, lib.phrases);
  check(out.length === buf.length && out.every(function (b, i) { return b === buf[i]; }), n + ".LIB: " + lib.phrases.length + " phrases written back byte for byte");
  check(PhraseLib.groupStyles(lib.phrases).every(function (p, i) { return p === lib.phrases[i]; }), n + ".LIB: each style is one run");
  if (lib.kind === "progs") {
    var bad = lib.phrases.filter(function (p) {
      var q = PhraseLib.writeSlots(p, PhraseLib.readSlots(p));
      return q.bars !== p.bars || q.body.length !== p.body.length || !q.body.every(function (b, i) { return b === p.body[i]; });
    });
    check(bad.length === 0, "progressions: chords decoded and encoded again", bad.map(function (p) { return p.title; }).join(", "));
  }
});
// a progression edited: a chord added, the colour voicing kept on the others
var p = { title: "T", style: "S", bpm: 120, key: 9 | 0x10, bars: 2, swing: 50, body: new Uint8Array(0) };
p = PhraseLib.writeSlots(p, [{ root: 9, type: 1, voicing: 0, steps: 16, colour: { bass: -12, tones: [0, 3, 7] } }, { root: 5, type: 0, voicing: 1, steps: 32, colour: null }]);
var s = PhraseLib.readSlots(p);
check(p.bars === 3 && s.length === 2 && s[0].colour && s[0].colour.tones.join() === "0,3,7" && !s[1].colour, "an edited progression: two chords, 3 bars, the first as played");
check(PhraseLib.chordName(s[1]) === "F/A", "F in first inversion is F/A", PhraseLib.chordName(s[1]));
// two styles mixed up: grouped where each first appears
var mixed = ["a", "b", "a", "c", "b"].map(function (st, i) { return { title: "p" + i, style: st }; });
check(PhraseLib.groupStyles(mixed).map(function (x) { return x.title; }).join() === "p0,p2,p1,p4,p3", "styles grouped where they first appear");
if (failures) { print(failures + " failed"); quit(1); }
