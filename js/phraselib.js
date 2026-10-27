/*
 * The Performer's phrase libraries: reading and writing LIBRARY/BASS.LIB, MELODY.LIB, DRUMS.LIB and
 * PROGS.LIB (format 6, as scripts/midi2lib.py in Conducting-Performer writes them and the firmware's
 * model/PhraseLibrary reads them).
 *
 * Plain JavaScript with no browser APIs, so the page and the tests share it.
 *
 * A library is { kind, phrases }: kind is "bass", "melody", "drums" or "progs". A phrase is
 *   { title, style, bpm, key, bars, swing, body }
 * where key is the raw key byte (tonic 0..11, 0x10 minor, 0x20 key named, 0x40 written over the
 * tonic, 0x80 chord tones), and body is the record's bytes after the header, kept as they are, so
 * a phrase nobody edited is written back byte for byte. Progressions are edited through
 * readSlots / writeSlots, which re-encode the body.
 */
"use strict";

var PhraseLib = (function () {
  var VERSION = 6;
  var KINDS = { 1: "bass", 2: "melody", 4: "drums", 5: "progs" };
  var ROLE_IDS = { bass: 1, melody: 2, drums: 4, progs: 5 };
  var FILE_NAMES = { bass: "BASS.LIB", melody: "MELODY.LIB", drums: "DRUMS.LIB", progs: "PROGS.LIB" };
  var KIND_NAMES = { bass: "Bass lines", melody: "Melodies", drums: "Drum patterns", progs: "Progressions" };
  // firmware limits (PhraseLibrary::MaxStyles, ConductorSequence::SlotCount, NOTE_ROOM in midi2lib)
  var MAX_STYLES = 16, MAX_SLOTS = 16, NOTE_ROOM = 64, MAX_NAME = 31;
  var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var DRUM_VOICES = ["BD", "SNR", "CLP", "CHH", "OHH", "P1", "P2", "CYM"];

  // the conductor's chord types (model/Harmony.cpp, in order), with their tones
  var CHORD_TYPES = [
    ["", [0, 4, 7]], ["m", [0, 3, 7]], ["dim", [0, 3, 6]], ["aug", [0, 4, 8]], ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]],
    ["6", [0, 4, 7, 9]], ["m6", [0, 3, 7, 9]], ["69", [0, 4, 7, 9, 14]],
    ["maj7", [0, 4, 7, 11]], ["7", [0, 4, 7, 10]], ["m7", [0, 3, 7, 10]], ["m7b5", [0, 3, 6, 10]], ["dim7", [0, 3, 6, 9]],
    ["mmaj7", [0, 3, 7, 11]], ["7sus", [0, 5, 7, 10]], ["maj7#11", [0, 4, 7, 11, 18]], ["7b9", [0, 4, 7, 10, 13]],
    ["7#9", [0, 4, 7, 10, 15]], ["add9", [0, 4, 7, 14]], ["madd9", [0, 3, 7, 14]], ["9", [0, 4, 7, 10, 14]],
    ["maj9", [0, 4, 7, 11, 14]], ["m9", [0, 3, 7, 10, 14]], ["9sus", [0, 5, 7, 10, 14]], ["m11", [0, 3, 7, 10, 17]],
    ["13", [0, 4, 7, 10, 21]],
  ];
  // the types the library's progressions keep to (simple chords: one scale each)
  var SIMPLE_TYPES = [0, 1, 2, 5, 9, 10, 11, 12];

  function asciiOf(s, max) {
    var out = "";
    s = String(s == null ? "" : s);
    for (var i = 0; i < s.length && out.length < (max || MAX_NAME); i++) {
      var c = s.charCodeAt(i);
      out += c >= 32 && c < 127 ? s[i] : "?";
    }
    return out;
  }

  function kindOfFileName(name) {
    var n = String(name || "").toUpperCase();
    for (var k in FILE_NAMES) if (n.indexOf(FILE_NAMES[k].split(".")[0]) === 0) return k;
    return null;
  }

  // ---------------------------------------------------------------- the file

  /* Library bytes -> { kind, phrases }. Throws on a file that isn't a format 6 library. */
  function read(bytes) {
    if (bytes.length < 12) throw new Error("This file is too short to be a Performer library.");
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "PLIB") throw new Error("This isn't a Performer library file.");
    if (bytes[4] !== VERSION) throw new Error("This library is format " + bytes[4] + "; the manager reads format 6. Rebuild it with midi2lib.");
    var kind = KINDS[bytes[5]];
    if (!kind) throw new Error("This library is of an unknown kind (" + bytes[5] + ").");
    var count = dv.getUint16(6, true), tableOffset = dv.getUint32(8, true);
    var phrases = [];
    for (var n = 0; n < count; n++) {
      var o = dv.getUint32(12 + 4 * n, true);
      var end = n + 1 < count ? dv.getUint32(12 + 4 * (n + 1), true) : tableOffset;
      var str = function () {
        var len = bytes[o++], s = "";
        for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[o++]);
        return s;
      };
      var p = { title: str(), style: str() };
      p.bpm = bytes[o++]; p.key = bytes[o++]; p.bars = bytes[o++]; p.swing = bytes[o++];
      p.body = bytes.slice(o, end);
      phrases.push(p);
    }
    return { kind: kind, phrases: phrases };
  }

  /* Phrases in the order given -> library bytes. A style must be one run (see groupStyles). */
  function write(kind, phrases) {
    if (!phrases.length) throw new Error("A library needs at least one phrase.");
    var records = phrases.map(function (p) {
      var title = asciiOf(p.title || "Untitled"), style = asciiOf(p.style || "User");
      var head = new Uint8Array(2 + title.length + style.length + 4), o = 0;
      head[o++] = title.length; for (var i = 0; i < title.length; i++) head[o++] = title.charCodeAt(i);
      head[o++] = style.length; for (i = 0; i < style.length; i++) head[o++] = style.charCodeAt(i);
      head[o++] = Math.max(1, Math.min(255, Math.round(p.bpm || 120)));
      head[o++] = p.key & 0xff;
      head[o++] = Math.max(1, Math.min(255, p.bars || 1));
      head[o++] = Math.max(50, Math.min(75, Math.round(p.swing || 50)));
      var r = new Uint8Array(head.length + p.body.length);
      r.set(head, 0); r.set(p.body, head.length);
      return r;
    });
    var runs = styleRuns(phrases);
    var tableSize = 1 + runs.reduce(function (n, r) { return n + 3 + asciiOf(r.name).length; }, 0);
    var headerSize = 12 + 4 * records.length;
    var recordsSize = records.reduce(function (n, r) { return n + r.length; }, 0);
    var out = new Uint8Array(headerSize + recordsSize + tableSize), dv = new DataView(out.buffer);
    out.set([0x50, 0x4c, 0x49, 0x42], 0);    // PLIB
    out[4] = VERSION; out[5] = ROLE_IDS[kind];
    dv.setUint16(6, records.length, true);
    dv.setUint32(8, headerSize + recordsSize, true);
    var o = headerSize;
    records.forEach(function (r, i) { dv.setUint32(12 + 4 * i, o, true); out.set(r, o); o += r.length; });
    out[o++] = runs.length;
    runs.forEach(function (r) {
      var name = asciiOf(r.name);
      dv.setUint16(o, r.first, true); o += 2;
      out[o++] = name.length;
      for (var i = 0; i < name.length; i++) out[o++] = name.charCodeAt(i);
    });
    return out;
  }

  /* Each run of one style: [{ first, name, count }]. */
  function styleRuns(phrases) {
    var runs = [];
    phrases.forEach(function (p, i) {
      var s = asciiOf(p.style || "User");
      if (!runs.length || runs[runs.length - 1].name !== s) runs.push({ first: i, name: s, count: 0 });
      runs[runs.length - 1].count++;
    });
    return runs;
  }

  /* The phrases with every style in one run, where it first appears (the firmware browses styles as runs). */
  function groupStyles(phrases) {
    var order = [];
    phrases.forEach(function (p) { if (order.indexOf(p.style) < 0) order.push(p.style); });
    return order.reduce(function (out, s) { return out.concat(phrases.filter(function (p) { return p.style === s; })); }, []);
  }

  /* What stops a library from being saved for the Performer, or "" when nothing does. */
  function problems(kind, phrases) {
    if (!phrases.length) return "The library is empty.";
    var styles = styleRuns(groupStyles(phrases)).length;
    if (styles > MAX_STYLES) return "It has " + styles + " styles; the Performer browses up to " + MAX_STYLES + ".";
    if (phrases.length > 65535) return "It has too many phrases.";
    return "";
  }

  function clone(p) {
    return { title: p.title, style: p.style, bpm: p.bpm, key: p.key, bars: p.bars, swing: p.swing, body: p.body.slice() };
  }

  // ---------------------------------------------------------------- notes (bass, melody)

  /* A bass line or melody's notes: [{ start, length, rel, slide, accent }] in 1/8 steps; rel is in
     semitones (from C4 + the tonic, or over C4 for chord tones). */
  function readNotes(p) {
    var dv = new DataView(p.body.buffer, p.body.byteOffset, p.body.byteLength), n = p.body[0], out = [];
    for (var i = 0; i < n && 1 + 4 * i + 4 <= p.body.length; i++) {
      var v = dv.getUint32(1 + 4 * i, true);
      out.push({ start: v & 0x1ff, length: ((v >>> 9) & 0x1ff) + 1, rel: ((v >>> 18) & 0x7f) - 64,
                 slide: ((v >>> 25) & 1) === 1, accent: ((v >>> 26) & 1) === 1 });
    }
    return out;
  }
  /* A note's pitch to listen to: the phrase's own key (chord tones: over C). */
  function notePitch(p, note) {
    return (p.key & 0x80) ? 60 + note.rel : 60 + (p.key & 0x0f) + note.rel;
  }

  // ---------------------------------------------------------------- drums

  /* A drum pattern's lanes: { BD: [bool x 64], ... } and accents, from its 64-bit masks. */
  function readLanes(p) {
    var dv = new DataView(p.body.buffer, p.body.byteOffset, p.body.byteLength), lanes = {}, accents = {};
    DRUM_VOICES.forEach(function (v) { lanes[v] = []; accents[v] = []; });
    var count = p.body[0], o = 1;
    for (var l = 0; l < count && o + 17 <= p.body.length; l++, o += 17) {
      var voice = DRUM_VOICES[p.body[o]];
      if (!voice) continue;
      var g = [dv.getUint32(o + 1, true), dv.getUint32(o + 5, true)], a = [dv.getUint32(o + 9, true), dv.getUint32(o + 13, true)];
      for (var s = 0; s < 64; s++) {
        lanes[voice][s] = ((g[s >> 5] >>> (s & 31)) & 1) === 1;
        accents[voice][s] = ((a[s >> 5] >>> (s & 31)) & 1) === 1;
      }
    }
    return { lanes: lanes, accents: accents };
  }

  // ---------------------------------------------------------------- progressions

  /* A progression's chords: [{ root, type, voicing (-3..3), steps (1..256), colour }] with the
     colour voicing as played ({ bass, tones } in semitones from the root near C4) or null. */
  function readSlots(p) {
    var b = p.body, n = b[0], slots = [], o = 1;
    for (var i = 0; i < n; i++, o += 4) {
      slots.push({ root: b[o] % 12, type: Math.min(b[o + 1], CHORD_TYPES.length - 1), voicing: b[o + 2] - 3, steps: b[o + 3] + 1, colour: null });
    }
    if (b[o] === 0x43 && b[o + 1] === 0x56) {    // "CV"
      o += 2;
      for (i = 0; i < n && o < b.length; i++) {
        var count = b[o++], bass = (b[o++] << 24) >> 24, tones = [];
        for (var t = 0; t < count; t++) tones.push((b[o++] << 24) >> 24);
        if (count > 0 && bass !== 127) slots[i].colour = { bass: bass, tones: tones };
      }
    }
    return slots;
  }

  /* The phrase with these chords (its bars follow their length). */
  function writeSlots(p, slots) {
    slots = slots.slice(0, MAX_SLOTS);
    var withColour = slots.some(function (s) { return s.colour; });
    var size = 1 + 4 * slots.length;
    if (withColour) size += 2 + slots.reduce(function (n, s) { return n + 2 + (s.colour ? s.colour.tones.length : 0); }, 0);
    var b = new Uint8Array(size), o = 0;
    b[o++] = slots.length;
    slots.forEach(function (s) {
      b[o++] = ((s.root % 12) + 12) % 12;
      b[o++] = s.type;
      b[o++] = Math.max(-3, Math.min(3, s.voicing)) + 3;
      b[o++] = Math.max(1, Math.min(256, s.steps)) - 1;
    });
    if (withColour) {
      b[o++] = 0x43; b[o++] = 0x56;
      slots.forEach(function (s) {
        if (s.colour) {
          b[o++] = s.colour.tones.length; b[o++] = s.colour.bass & 0xff;
          s.colour.tones.forEach(function (t) { b[o++] = t & 0xff; });
        } else {
          b[o++] = 0; b[o++] = 127;
        }
      });
    }
    var steps = slots.reduce(function (n, s) { return n + s.steps; }, 0);
    var q = clone(p);
    q.body = b;
    q.bars = Math.max(1, Math.min(255, Math.floor(Math.min(255 * 16, steps) / 16)));
    return q;
  }

  function chordName(slot) {
    var name = NOTE[slot.root] + CHORD_TYPES[slot.type][0];
    if (slot.voicing > 0) {
      var tones = CHORD_TYPES[slot.type][1];
      var bassTone = tones[Math.min(slot.voicing, tones.length - 1)];
      name += "/" + NOTE[(slot.root + bassTone) % 12];
    }
    return name;
  }

  /* The pitches a chord sounds as, to listen to: its colour voicing, or its tones near C4 (the
     voicing: the chord inverted, or dropped below the root when negative). */
  function chordPitches(slot) {
    var ref = 60 + (slot.root > 6 ? slot.root - 12 : slot.root);
    if (slot.colour) return [ref + slot.colour.bass].concat(slot.colour.tones.map(function (t) { return ref + t; }));
    var tones = CHORD_TYPES[slot.type][1].map(function (t) { return ref + t; });
    for (var v = 0; v < Math.abs(slot.voicing); v++) {
      if (slot.voicing > 0) tones.push(tones.shift() + 12); else tones.unshift(tones.pop() - 12);
    }
    return [ref - 12].concat(tones);
  }

  // ---------------------------------------------------------------- key

  function keyName(p) {
    if (p.key & 0x80) return "chord tones";
    return NOTE[p.key & 0x0f] + ((p.key & 0x10) ? "m" : "");
  }

  return {
    read: read, write: write, styleRuns: styleRuns, groupStyles: groupStyles, problems: problems, clone: clone,
    readNotes: readNotes, notePitch: notePitch, readLanes: readLanes,
    readSlots: readSlots, writeSlots: writeSlots, chordName: chordName, chordPitches: chordPitches, keyName: keyName,
    kindOfFileName: kindOfFileName,
    FILE_NAMES: FILE_NAMES, KIND_NAMES: KIND_NAMES, CHORD_TYPES: CHORD_TYPES, SIMPLE_TYPES: SIMPLE_TYPES, NOTE: NOTE,
    DRUM_VOICES: DRUM_VOICES, MAX_STYLES: MAX_STYLES, MAX_SLOTS: MAX_SLOTS, MAX_NAME: MAX_NAME,
  };
})();

if (typeof module !== "undefined") module.exports = PhraseLib;
