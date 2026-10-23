/*
 * Drum patterns for the Performer: reading and writing its drum library
 * (LIBRARY/DRUMS.LIB, format 6, as scripts/midi2lib.py in Conducting-Performer
 * writes it), importing MIDI files and exporting patterns as MIDI.
 *
 * Plain JavaScript with no browser APIs, so the page and the tests share it.
 *
 * A pattern is
 *   { name, style, bpm, key, swing (50..75), steps (16, 32, 48 or 64),
 *     lanes: { BD: { gates: [bool x 64], accents: [bool x 64] }, ... } }
 * with the eight voices of the Performer's drum kit. A pattern's number is its
 * index in the library: pattern 12 plays kit 012 (program change 12).
 */
"use strict";

var DrumLib = (function () {
  // The library's lane order (voice ids 0..7).
  var LANE_VOICES = ["BD", "SNR", "CLP", "CHH", "OHH", "P1", "P2", "CYM"];
  var MAX_STEPS = 64, ROLE_DRUMS = 4, VERSION = 6;

  function emptyLane() {
    var g = [], a = [];
    for (var i = 0; i < MAX_STEPS; i++) { g.push(false); a.push(false); }
    return { gates: g, accents: a };
  }
  function emptyPattern(name, style) {
    var lanes = {};
    LANE_VOICES.forEach(function (v) { lanes[v] = emptyLane(); });
    return { name: name || "New Pattern", style: style || "User", bpm: 120, key: 0, swing: 50, steps: 16, lanes: lanes };
  }
  function clonePattern(p) {
    var c = JSON.parse(JSON.stringify(p));
    return c;
  }

  // 64-bit masks as two 32-bit halves (JavaScript bit operations are 32-bit)
  function maskToBools(lo, hi) {
    var out = [];
    for (var i = 0; i < MAX_STEPS; i++) out.push(i < 32 ? ((lo >>> i) & 1) === 1 : ((hi >>> (i - 32)) & 1) === 1);
    return out;
  }
  function boolsToMask(b, steps) {
    var lo = 0, hi = 0;
    for (var i = 0; i < Math.min(steps, MAX_STEPS); i++) {
      if (!b[i]) continue;
      if (i < 32) lo = (lo | (1 << i)) >>> 0; else hi = (hi | (1 << (i - 32))) >>> 0;
    }
    return [lo >>> 0, hi >>> 0];
  }

  // ---------------------------------------------------------------- DRUMS.LIB

  function asciiOf(s) {
    var out = "";
    for (var i = 0; i < s.length && out.length < 31; i++) {
      var c = s.charCodeAt(i);
      out += c >= 32 && c < 127 ? s[i] : "?";
    }
    return out;
  }

  /* Reads DRUMS.LIB bytes: { patterns: [...], count }. Throws on a file that isn't a format 6 drum library. */
  function readLibrary(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "PLIB") throw new Error("This isn't a Performer library file.");
    var version = bytes[4], role = bytes[5];
    if (role !== ROLE_DRUMS) throw new Error("This is a Performer library, but not the drum library (DRUMS.LIB).");
    if (version !== VERSION) throw new Error("This drum library is format " + version + "; the manager reads format 6 (Conducting Performer v29 and later). Rebuild it with midi2lib.");
    var count = dv.getUint16(6, true);
    var patterns = [];
    for (var n = 0; n < count; n++) {
      var o = dv.getUint32(12 + 4 * n, true);
      function str() {
        var len = bytes[o++], s = "";
        for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[o++]);
        return s;
      }
      var p = emptyPattern();
      p.name = str();
      p.style = str();
      p.bpm = bytes[o++];
      p.key = bytes[o++];
      p.steps = Math.max(1, Math.min(4, bytes[o++])) * 16;
      p.swing = Math.max(50, Math.min(75, bytes[o++]));
      var lanes = bytes[o++];
      for (var l = 0; l < lanes; l++) {
        var voice = bytes[o];
        var gLo = dv.getUint32(o + 1, true), gHi = dv.getUint32(o + 5, true);
        var aLo = dv.getUint32(o + 9, true), aHi = dv.getUint32(o + 13, true);
        o += 17;
        if (voice < LANE_VOICES.length) {
          p.lanes[LANE_VOICES[voice]] = { gates: maskToBools(gLo, gHi), accents: maskToBools(aLo, aHi) };
        }
      }
      patterns.push(p);
    }
    return { patterns: patterns, count: count };
  }

  /*
   * Writes patterns as DRUMS.LIB (format 6). Patterns are written in the order
   * given (their numbers stay); the style table lists each run of one style, as
   * the firmware expects (a style runs until the next one starts).
   */
  function writeLibrary(patterns) {
    if (!patterns.length) throw new Error("A library needs at least one pattern.");
    var records = patterns.map(function (p) {
      var name = asciiOf(p.name || "Pattern"), style = asciiOf(p.style || "User");
      var steps = Math.max(16, Math.min(MAX_STEPS, p.steps || 16));
      var size = 1 + name.length + 1 + style.length + 5 + LANE_VOICES.length * 17;
      var b = new Uint8Array(size), dv = new DataView(b.buffer), o = 0;
      b[o++] = name.length; for (var i = 0; i < name.length; i++) b[o++] = name.charCodeAt(i);
      b[o++] = style.length; for (i = 0; i < style.length; i++) b[o++] = style.charCodeAt(i);
      b[o++] = Math.max(1, Math.min(255, Math.round(p.bpm || 120)));
      b[o++] = (p.key || 0) & 0xff;
      b[o++] = Math.ceil(steps / 16);
      b[o++] = Math.max(50, Math.min(75, Math.round(p.swing || 50)));
      b[o++] = LANE_VOICES.length;
      LANE_VOICES.forEach(function (v, vid) {
        var lane = p.lanes[v] || emptyLane();
        var g = boolsToMask(lane.gates, steps), a = boolsToMask(lane.accents.map(function (x, s) { return x && lane.gates[s]; }), steps);
        b[o++] = vid;
        dv.setUint32(o, g[0], true); dv.setUint32(o + 4, g[1], true);
        dv.setUint32(o + 8, a[0], true); dv.setUint32(o + 12, a[1], true);
        o += 16;
      });
      return b;
    });
    // style table: runs of one style
    var runs = [];
    patterns.forEach(function (p, i) {
      var s = asciiOf(p.style || "User");
      if (!runs.length || runs[runs.length - 1].name !== s) runs.push({ first: i, name: s });
    });
    var tableSize = 1 + runs.reduce(function (n, r) { return n + 3 + r.name.length; }, 0);
    var headerSize = 12 + 4 * records.length;
    var recordsSize = records.reduce(function (n, r) { return n + r.length; }, 0);
    var out = new Uint8Array(headerSize + recordsSize + tableSize), dv = new DataView(out.buffer);
    out.set([0x50, 0x4c, 0x49, 0x42], 0);    // PLIB
    out[4] = VERSION; out[5] = ROLE_DRUMS;
    dv.setUint16(6, records.length, true);
    dv.setUint32(8, headerSize + recordsSize, true);
    var o = headerSize;
    records.forEach(function (r, i) { dv.setUint32(12 + 4 * i, o, true); out.set(r, o); o += r.length; });
    out[o++] = runs.length;
    runs.forEach(function (r) {
      dv.setUint16(o, r.first, true); o += 2;
      out[o++] = r.name.length;
      for (var i = 0; i < r.name.length; i++) out[o++] = r.name.charCodeAt(i);
    });
    return out;
  }

  // ---------------------------------------------------------------- MIDI

  /* Standard MIDI file -> { ppq, notes: [{ tick, note, velocity }], bpm }. */
  function parseMidi(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function s4(o) { return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]); }
    if (s4(0) !== "MThd") throw new Error("This isn't a MIDI file.");
    var hlen = dv.getUint32(4), ntracks = dv.getUint16(10), division = dv.getUint16(12);
    if (division & 0x8000) throw new Error("This MIDI file uses SMPTE time, which isn't supported.");
    var ppq = division, pos = 8 + hlen, notes = [], tempo = 0;
    for (var t = 0; t < ntracks && pos + 8 <= bytes.length; t++) {
      if (s4(pos) !== "MTrk") break;
      var len = dv.getUint32(pos + 4), o = pos + 8, end = Math.min(bytes.length, o + len), tick = 0, status = 0;
      pos = o + len;
      function vlq() { var v = 0, b; do { b = bytes[o++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && o < end); return v; }
      while (o < end) {
        tick += vlq();
        var b = bytes[o];
        if (b === 0xff) {
          var type = bytes[o + 1]; o += 2; var ml = vlq();
          if (type === 0x51 && ml === 3 && !tempo) tempo = (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2];
          o += ml;
          continue;
        }
        if (b === 0xf0 || b === 0xf7) { o++; o += vlq(); continue; }
        if (b & 0x80) { status = b; o++; }
        var kind = status & 0xf0, d1 = bytes[o], d2 = 0;
        if (kind === 0xc0 || kind === 0xd0) { o += 1; continue; }
        d2 = bytes[o + 1]; o += 2;
        if (kind === 0x90 && d2 > 0) notes.push({ tick: tick, note: d1, velocity: d2 });
      }
    }
    notes.sort(function (a, b) { return a.tick - b.tick || a.note - b.note; });
    return { ppq: ppq, notes: notes, bpm: tempo ? Math.round(60000000 / tempo) : 0 };
  }

  // note -> voice, per layout
  var LAYOUTS = {
    pack: { name: "Pattern pack (60–67)", map: { 60: "BD", 61: "CLP", 62: "CHH", 63: "OHH", 64: "SNR", 65: "P1", 66: "P2", 67: "CYM" } },
    gm: { name: "General MIDI drums", map: {
      35: "BD", 36: "BD", 37: "P1", 38: "SNR", 40: "SNR", 39: "CLP", 42: "CHH", 44: "CHH", 46: "OHH",
      41: "P2", 43: "P2", 45: "P2", 47: "P1", 48: "P1", 50: "P1", 54: "P2", 56: "P2", 69: "P2", 70: "P2", 75: "P1", 76: "P1",
      49: "CYM", 51: "CYM", 52: "CYM", 53: "CYM", 55: "CYM", 57: "CYM", 59: "CYM" } },
    loops: { name: "Loops (36 38 40 47 48 45)", map: { 36: "BD", 38: "SNR", 40: "OHH", 47: "CHH", 48: "P1", 45: "P2" } },
  };

  function detectLayout(notes) {
    if (!notes.length) return "gm";
    var inPack = notes.filter(function (n) { return n.note >= 60 && n.note <= 67; }).length;
    if (inPack / notes.length >= 0.8) return "pack";
    var has = {};
    notes.forEach(function (n) { has[n.note] = true; });
    if (has[47] && has[40] && !has[42] && !has[46]) return "loops";
    return "gm";
  }

  // Performer swing (50..75) from how late the off-beat 16ths are (as midi2lib does)
  function detectSwing(notes, ppq) {
    var step = ppq / 4, delays = [];
    notes.forEach(function (n) {
      var s = n.tick / step, r = Math.round(s);
      if (r % 2 === 1 && s - r > 0.02) delays.push(s - r);
    });
    if (!delays.length) return 50;
    delays.sort(function (a, b) { return a - b; });
    var d = delays[Math.floor(delays.length / 2)];
    return Math.max(50, Math.min(75, Math.round(50 * (1 + d))));
  }

  /*
   * MIDI bytes -> patterns (4 bars each; longer files become several).
   * opts: { name, style, layout ("auto", "pack", "gm", "loops") }.
   * Returns { patterns, layout, ignored } (ignored: notes with no voice).
   */
  function importMidi(bytes, opts) {
    opts = opts || {};
    var midi = parseMidi(bytes);
    var layout = !opts.layout || opts.layout === "auto" ? detectLayout(midi.notes) : opts.layout;
    var map = LAYOUTS[layout].map, step = midi.ppq / 4;
    var swing = detectSwing(midi.notes, midi.ppq);
    var last = 0, ignored = 0, hits = [];
    midi.notes.forEach(function (n) {
      var v = map[n.note];
      if (!v) { ignored++; return; }
      var s = Math.round(n.tick / step);
      hits.push({ step: s, voice: v, accent: n.velocity >= 100 });
      if (s > last) last = s;
    });
    var total = Math.max(16, Math.ceil((last + 1) / 16) * 16);
    var parts = Math.ceil(total / MAX_STEPS), patterns = [];
    for (var k = 0; k < parts; k++) {
      var p = emptyPattern((opts.name || "Imported") + (parts > 1 ? " " + (k + 1) : ""), opts.style || "Imported");
      p.bpm = midi.bpm || 120;
      p.swing = swing;
      p.steps = Math.min(MAX_STEPS, total - k * MAX_STEPS);
      hits.forEach(function (h) {
        var s = h.step - k * MAX_STEPS;
        if (s < 0 || s >= p.steps) return;
        p.lanes[h.voice].gates[s] = true;
        if (h.accent) p.lanes[h.voice].accents[s] = true;
      });
      patterns.push(p);
    }
    return { patterns: patterns, layout: layout, ignored: ignored };
  }

  // the General MIDI note of each voice (as the Performer's kit track sends them)
  var GM_NOTES = { BD: 36, SNR: 38, CLP: 39, CHH: 42, OHH: 46, P1: 37, P2: 45, CYM: 49 };
  var PACK_NOTES = { BD: 60, CLP: 61, CHH: 62, OHH: 63, SNR: 64, P1: 65, P2: 66, CYM: 67 };

  /*
   * A pattern -> a type 0 MIDI file on channel 10, swing applied, velocity
   * 127 accented and 90 otherwise. opts.layout: "gm" (default) or "pack".
   */
  function exportMidi(p, opts) {
    opts = opts || {};
    var notes = opts.layout === "pack" ? PACK_NOTES : GM_NOTES;
    var ppq = 96, stepTicks = ppq / 4, gate = stepTicks / 2, events = [];
    var swing = Math.max(50, Math.min(75, p.swing || 50));
    function swung(s) { return s % 2 === 1 ? Math.round((s - 1) * stepTicks + 2 * stepTicks * swing / 100) : s * stepTicks; }
    LANE_VOICES.forEach(function (v) {
      var lane = p.lanes[v];
      for (var s = 0; s < p.steps; s++) {
        if (!lane.gates[s]) continue;
        var t = swung(s);
        events.push({ t: t, b: [0x99, notes[v], lane.accents[s] ? 127 : 90] });
        events.push({ t: t + gate, b: [0x89, notes[v], 0] });
      }
    });
    events.sort(function (a, b) { return a.t - b.t || (a.b[0] & 0x10) - (b.b[0] & 0x10); });
    var body = [];
    function vlq(v) {
      var stack = [v & 0x7f];
      while ((v >>= 7)) stack.unshift((v & 0x7f) | 0x80);
      body.push.apply(body, stack);
    }
    var tempo = Math.round(60000000 / Math.max(1, p.bpm || 120));
    vlq(0); body.push(0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
    var name = asciiOf(p.name || "Pattern");
    vlq(0); body.push(0xff, 0x03, name.length); for (var i = 0; i < name.length; i++) body.push(name.charCodeAt(i));
    var now = 0;
    events.forEach(function (e) { vlq(e.t - now); now = e.t; body.push.apply(body, e.b); });
    var endTick = p.steps * stepTicks;
    vlq(Math.max(0, endTick - now)); body.push(0xff, 0x2f, 0);
    var out = new Uint8Array(14 + 8 + body.length), dv = new DataView(out.buffer);
    out.set([0x4d, 0x54, 0x68, 0x64], 0); dv.setUint32(4, 6); dv.setUint16(8, 0); dv.setUint16(10, 1); dv.setUint16(12, ppq);
    out.set([0x4d, 0x54, 0x72, 0x6b], 14); dv.setUint32(18, body.length);
    out.set(body, 22);
    return out;
  }

  // seconds from the pattern start to step s (the Performer's swing on the 1/16 grid)
  function stepTime(s, bpm, swing) {
    var step = 60 / (bpm || 120) / 4;
    return s % 2 === 1 ? (s - 1) * step + 2 * step * (swing || 50) / 100 : s * step;
  }

  return {
    LANE_VOICES: LANE_VOICES, MAX_STEPS: MAX_STEPS, LAYOUTS: LAYOUTS,
    emptyPattern: emptyPattern, clonePattern: clonePattern,
    readLibrary: readLibrary, writeLibrary: writeLibrary,
    parseMidi: parseMidi, detectLayout: detectLayout, importMidi: importMidi, exportMidi: exportMidi,
    stepTime: stepTime,
  };
})();

if (typeof module !== "undefined") module.exports = DrumLib;
