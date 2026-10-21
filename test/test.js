// Tests for naming.js and audio.js. Run with test/run.sh (JavaScriptCore's jsc).
"use strict";

var failures = 0;
function check(ok, what, detail) {
  print((ok ? "  ok   " : "  FAIL ") + what + (detail !== undefined ? "  (" + detail + ")" : ""));
  if (!ok) failures++;
}

// ---------------------------------------------------------------- naming
print("Naming");
var cases = [
  ["1KIK-001.wav", "BD"], ["2CLP-001.wav", "CLP"], ["3CHH-001.wav", "CHH"], ["4OHH-001.wav", "OHH"],
  ["5SNR-001.wav", "SNR"], ["6PRC1-001.wav", "P1"], ["7PRC2-001.wav", "P2"], ["8CYM-001.wav", "CYM"],
  ["snare_V1_RR1.wav", "SNR"], ["BD_V2.wav", "BD"], ["808 kick.wav", null], ["my-kick.wav", "BD"],
  ["OH_long.wav", "OHH"], ["hh_closed.wav", "CHH"], ["Ride.wav", "CYM"], ["tom_lo.wav", "P1"], ["Shaker.wav", "P2"], ["zap.wav", null],
];
var bad = cases.filter(function (c) { return Naming.voiceForFileName(c[0]) !== c[1]; });
check(!bad.length, "file names name the same voices as the plug-in", bad.map(function (c) { return c[0]; }).join(", "));
var a = Naming.assign(["zap.wav", "BD_V2.wav", "snare_V1_RR1.wav", "BD_V1.wav", "blip.wav", "8CYM.wav", "_kit.wav"]);
check(a.BD === 3 && a.SNR === 2 && a.CHH === 4 && a.OHH === 0 && a.CLP === -1 && a.CYM === 5, "assignment matches the plug-in", JSON.stringify(a));
check(Naming.kitFolder(12, "Sampling") === "012-Sampling", "kit folder name", Naming.kitFolder(12, "Sampling"));
check(Naming.cleanKitName("Too long_name/x") === "Toolongn", "kit names: 8 characters, safe symbols only", Naming.cleanKitName("Too long_name/x"));
check(Naming.fileFor("P1", 7) === "6PRC1-007.wav", "voice file name", Naming.fileFor("P1", 7));
var pk = Naming.parseKitFolder("033-Beat");
check(pk && pk.number === 33 && pk.name === "Beat", "reads a kit folder name");

// ---------------------------------------------------------------- AIFF variants
print("AIFF");
function makeAiff(bits, little, form, rateBytes) {
  var frames = 4, ch = 2, bps = bits / 8, dataLen = frames * ch * bps;
  var commLen = form === "AIFC" ? 24 : 18, total = 12 + 8 + commLen + 8 + 8 + dataLen;
  var b = new Uint8Array(total), dv = new DataView(b.buffer), o = 0;
  function s4(s) { for (var i = 0; i < 4; i++) b[o++] = s.charCodeAt(i); }
  s4("FORM"); dv.setUint32(o, total - 8); o += 4; s4(form);
  s4("COMM"); dv.setUint32(o, commLen); o += 4;
  dv.setUint16(o, ch); o += 2; dv.setUint32(o, frames); o += 4; dv.setUint16(o, bits); o += 2;
  rateBytes.forEach(function (x) { b[o++] = x; });
  if (form === "AIFC") { s4(little ? "sowt" : "NONE"); b[o++] = 0; b[o++] = 0; }
  s4("SSND"); dv.setUint32(o, 8 + dataLen); o += 4; dv.setUint32(o, 0); o += 4; dv.setUint32(o, 0); o += 4;
  var vals = [0.5, -0.5, 0.25, -0.25, 0, 0, -1, 0.75];
  vals.forEach(function (v) {
    var n = Math.round(v * (v < 0 ? Math.pow(2, bits - 1) : Math.pow(2, bits - 1) - 1));
    if (bits === 16) { dv.setInt16(o, n, little); o += 2; }
    else { var u = n & 0xffffff; if (little) { b[o++] = u & 255; b[o++] = (u >> 8) & 255; b[o++] = u >> 16; } else { b[o++] = u >> 16; b[o++] = (u >> 8) & 255; b[o++] = u & 255; } }
  });
  return b;
}
var R44 = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];   // 44100 as 80-bit extended
[[16, false, "AIFF"], [24, false, "AIFF"], [16, true, "AIFC"], [24, false, "AIFC"]].forEach(function (t) {
  var s = PDAudio.read(makeAiff(t[0], t[1], t[2], R44));
  var ok = s && s.rate === 44100 && s.channels.length === 2 && Math.abs(s.channels[0][0] - 0.5) < 1e-3 && Math.abs(s.channels[1][3] - 0.75) < 1e-3 && Math.abs(s.channels[0][3] + 1) < 1e-6;
  check(ok, t[2] + " " + t[0] + "-bit" + (t[1] ? " little-endian (sowt)" : ""), s ? s.rate + " Hz" : "unreadable");
});

// ---------------------------------------------------------------- resampling
print("Resampling 44.1 -> 48 kHz");
function sine(f, rate, secs, amp) {
  var n = Math.round(rate * secs), x = new Float32Array(n);
  for (var i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / rate);
  return x;
}
[100, 1000, 10000, 18000].forEach(function (f) {
  var y = PDAudio.resample({ rate: 44100, channels: [sine(f, 44100, 0.5, 0.5)] }, 48000).channels[0];
  var err = 0, sig = 0;
  for (var i = 2400; i < y.length - 2400; i++) {          // away from the edges
    var ideal = 0.5 * Math.sin(2 * Math.PI * f * i / 48000);
    err += (y[i] - ideal) * (y[i] - ideal); sig += ideal * ideal;
  }
  var db = 10 * Math.log10(err / sig);
  check(db < -60, f + " Hz sine: error vs. ideal", db.toFixed(1) + " dB");
});
var down = PDAudio.resample({ rate: 96000, channels: [sine(40000, 96000, 0.2, 0.5)] }, 48000).channels[0];
var leak = 0; for (var i = 500; i < down.length - 500; i++) leak = Math.max(leak, Math.abs(down[i]));
check(20 * Math.log10(leak / 0.5) < -40, "96 -> 48 kHz: a 40 kHz tone is filtered out, not aliased", (20 * Math.log10(leak / 0.5)).toFixed(1) + " dB");

// ---------------------------------------------------------------- WAV round trip
print("WAV writing");
var src = { rate: 48000, channels: [sine(440, 48000, 0.1, 0.9), sine(660, 48000, 0.1, -0.4)] };
var back = PDAudio.read(PDAudio.encodeWav16(src, 7));
var maxErr = 0;
for (var i = 0; i < src.channels[0].length; i++) for (var c = 0; c < 2; c++) maxErr = Math.max(maxErr, Math.abs(back.channels[c][i] - src.channels[c][i]));
check(back.rate === 48000 && back.channels.length === 2 && maxErr < 3 / 32768, "16-bit WAV reads back within dither", (maxErr * 32768).toFixed(2) + " LSB");

// ---------------------------------------------------------------- trimming
var t = new Float32Array(48000); for (var i = 4800; i < 9600; i++) t[i] = 0.5 * Math.sin(i / 3);
var tr = PDAudio.trim({ rate: 48000, channels: [t] });
check(Math.abs(tr.channels[0].length - (4800 + 24 + 240)) < 5, "trim: 100 ms of silence before and 800 ms after are cut", tr.channels[0].length + " frames");

// ---------------------------------------------------------------- real kits
var listFile = arguments[0];
var list = listFile ? readFile(listFile).split("\n").filter(function (s) { return s; }) : [];
if (list.length) {
  print("Kit files (" + list.length + ")");
  var unread = [], clipped = [], total = 0, stereo = 0, dual = 0;
  list.forEach(function (path) {
    try {
      var s = PDAudio.read(readFile(path, "binary"));
      if (!s) { unread.push(path); return; }
      if (s.channels.length === 2) { stereo++; if (PDAudio.isDualMono(s)) dual++; }
      var p = PDAudio.prepare(s, { rate: 48000, trim: true, mono: true, normalise: false });
      if (PDAudio.peak(p.sound) > 1) clipped.push(path);
      total += p.sound.channels.length * p.sound.channels[0].length * 2;
    } catch (e) { unread.push(path + ": " + e.message); }
  });
  check(!unread.length, "every file reads", unread.slice(0, 3).join("; "));
  check(!clipped.length, "nothing clips after preparing", clipped.length);
  print("       " + stereo + " stereo files, " + dual + " of them identical on both sides (made mono); " + (total / 1048576).toFixed(1) + " MB as 16-bit 48 kHz");
}

// ---------------------------------------------------------------- drum patterns
print("Drum patterns");
(function () {
  var V = DrumLib.LANE_VOICES;
  var p = DrumLib.emptyPattern("Test", "User");
  p.steps = 64; p.bpm = 128; p.swing = 58;
  [0, 7, 31, 32, 33, 63].forEach(function (s) { p.lanes.CYM.gates[s] = true; });
  p.lanes.SNR.gates[4] = p.lanes.SNR.accents[4] = true;
  p.lanes.BD.accents[9] = true;     // an accent without a gate is dropped
  var back = DrumLib.readLibrary(DrumLib.writeLibrary([p, DrumLib.emptyPattern("Two", "Other")]));
  var q = back.patterns[0];
  check(back.count === 2 && q.name === "Test" && q.style === "User" && q.steps === 64 && q.bpm === 128 && q.swing === 58,
        "a library written and read again keeps name, style, length, tempo and swing", JSON.stringify([back.count, q.name, q.steps, q.bpm, q.swing]));
  check([0, 7, 31, 32, 33, 63].every(function (s) { return q.lanes.CYM.gates[s]; }) && q.lanes.CYM.gates.filter(Boolean).length === 6,
        "all 64 steps survive (both halves of the 64-bit lanes)");
  check(q.lanes.SNR.accents[4] && !q.lanes.BD.accents[9], "accents: kept on a hit, dropped without one");

  // MIDI out and back in
  var m = DrumLib.importMidi(DrumLib.exportMidi(q), { layout: "auto" });
  var r = m.patterns[0];
  var same = V.every(function (v) { return r.lanes[v].gates.join() === q.lanes[v].gates.join() && r.lanes[v].accents.join() === q.lanes[v].accents.join(); });
  check(m.patterns.length === 1 && m.layout === "gm" && same && r.swing === q.swing && r.bpm === 128,
        "export to MIDI and import again: the same pattern, swing and tempo", m.layout + " swing " + r.swing);
  var pack = DrumLib.importMidi(DrumLib.exportMidi(q, { layout: "pack" }));
  check(pack.layout === "pack" && pack.patterns[0].lanes.CYM.gates[63], "the pattern-pack layout (60–67) is recognised");
})();

var libPath = arguments[1], midiDir = arguments[2];
if (libPath) {
  print("The Performer's drum library");
  var bytes = readFile(libPath, "binary");
  var lib = DrumLib.readLibrary(bytes);
  check(lib.count > 0, "reads " + libPath.split("/").pop(), lib.count + " patterns");
  var again = DrumLib.writeLibrary(lib.patterns);
  var identical = again.length === bytes.length && again.every(function (b, i) { return b === bytes[i]; });
  check(identical, "written back, it is byte for byte the file midi2lib made", again.length + " / " + bytes.length + " bytes");
  if (midiDir) {
    // pattern NNN of the pattern pack imports to the same lanes as library pattern NNN
    var bad = [], tried = 0;
    for (var n = 0; n < Math.min(lib.count, 71); n++) {
      var name = ("00" + n).slice(-3), lp = lib.patterns[n];
      if (lp.style !== "patterns-v2") continue;
      var file;
      try { file = readFile(midiDir + "/" + name + ".mid", "binary"); } catch (e) { continue; }
      tried++;
      var ip = DrumLib.importMidi(file).patterns[0];
      var ok = DrumLib.LANE_VOICES.every(function (v) {
        for (var s = 0; s < lp.steps; s++) if (ip.lanes[v].gates[s] !== lp.lanes[v].gates[s]) return false;
        return true;
      });
      if (!ok) bad.push(name);
    }
    check(tried > 0 && !bad.length, "MIDI import of the pattern pack matches the library (" + tried + " files)", bad.slice(0, 5).join(", "));
  }
}

print(failures ? "\n" + failures + " check(s) FAILED" : "\nall checks passed");
