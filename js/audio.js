/*
 * Audio for the library manager: reading WAV and AIFF, preparing a sample
 * for the disting NT, and writing it as a 16- or 24-bit WAV.
 *
 * Plain JavaScript with no browser APIs (except the optional decodeAudioData
 * fallback in decode()), so the same code runs in the page and in the tests.
 *
 * A decoded sound is { rate, channels: [Float32Array, ...] } in -1..1.
 */
"use strict";

var PDAudio = (function () {

  // ---------------------------------------------------------------- reading

  function str4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

  function readWav(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (str4(bytes, 0) !== "RIFF" || str4(bytes, 8) !== "WAVE") return null;
    var fmt = null, dataPos = -1, dataLen = 0, pos = 12;
    while (pos + 8 <= bytes.length) {
      var id = str4(bytes, pos), len = dv.getUint32(pos + 4, true);
      if (id === "fmt " && len >= 16) {
        fmt = { format: dv.getUint16(pos + 8, true), channels: dv.getUint16(pos + 10, true),
                rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
        if (fmt.format === 0xfffe && len >= 26) fmt.format = dv.getUint16(pos + 32, true);
      } else if (id === "data") {
        dataPos = pos + 8;
        dataLen = Math.min(len, bytes.length - dataPos);
      }
      pos += 8 + len + (len & 1);
    }
    if (!fmt || dataPos < 0 || !fmt.channels) throw new Error("This WAV file has no audio data.");
    var isFloat = fmt.format === 3, isPcm = fmt.format === 1;
    if (!isFloat && !isPcm) throw new Error("This WAV file is compressed (format " + fmt.format + "); only plain PCM or float WAV can be read.");
    var bps = fmt.bits / 8, frames = Math.floor(dataLen / (bps * fmt.channels));
    var out = [];
    for (var c = 0; c < fmt.channels; c++) out.push(new Float32Array(frames));
    var p = dataPos;
    for (var i = 0; i < frames; i++) {
      for (c = 0; c < fmt.channels; c++, p += bps) {
        var s;
        if (isFloat) s = bps === 8 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
        else if (bps === 1) s = (bytes[p] - 128) / 128;
        else if (bps === 2) s = dv.getInt16(p, true) / 32768;
        else if (bps === 3) s = ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 8388608;
        else s = dv.getInt32(p, true) / 2147483648;
        out[c][i] = s;
      }
    }
    return { rate: fmt.rate, channels: out, sourceBits: isFloat ? "float" : fmt.bits };
  }

  // IEEE 754 80-bit extended (AIFF sample rate)
  function readExtended(dv, o) {
    var exp = dv.getUint16(o) & 0x7fff, hi = dv.getUint32(o + 2), lo = dv.getUint32(o + 6);
    if (!exp && !hi && !lo) return 0;
    return (hi * 4294967296 + lo) * Math.pow(2, exp - 16383 - 63);
  }

  function readAiff(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var form = str4(bytes, 8);
    if (str4(bytes, 0) !== "FORM" || (form !== "AIFF" && form !== "AIFC")) return null;
    var comm = null, ssnd = -1, pos = 12;
    while (pos + 8 <= bytes.length) {
      var id = str4(bytes, pos), len = dv.getUint32(pos + 4);
      if (id === "COMM") {
        comm = { channels: dv.getUint16(pos + 8), frames: dv.getUint32(pos + 10), bits: dv.getUint16(pos + 14),
                 rate: readExtended(dv, pos + 16), compression: form === "AIFC" && len >= 22 ? str4(bytes, pos + 26) : "NONE" };
      } else if (id === "SSND") {
        ssnd = pos + 16 + dv.getUint32(pos + 8);
      }
      pos += 8 + len + (len & 1);
    }
    if (!comm || ssnd < 0) throw new Error("This AIFF file has no audio data.");
    var comp = comm.compression.toLowerCase();
    var little = comp === "sowt", isFloat = comp === "fl32" || comp === "fl64";
    if (!(comp === "none" || little || isFloat)) throw new Error("This AIFF file is compressed (" + comm.compression + "); only uncompressed AIFF can be read.");
    var bps = isFloat ? (comp === "fl64" ? 8 : 4) : Math.ceil(comm.bits / 8);
    var frames = Math.min(comm.frames, Math.floor((bytes.length - ssnd) / (bps * comm.channels)));
    var out = [];
    for (var c = 0; c < comm.channels; c++) out.push(new Float32Array(frames));
    var p = ssnd;
    for (var i = 0; i < frames; i++) {
      for (c = 0; c < comm.channels; c++, p += bps) {
        var s;
        if (isFloat) s = bps === 8 ? dv.getFloat64(p, little) : dv.getFloat32(p, little);
        else if (bps === 1) s = dv.getInt8(p) / 128;
        else if (bps === 2) s = dv.getInt16(p, little) / 32768;
        else if (bps === 3) s = (little ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) : ((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2])) << 8 >> 8;
        else s = dv.getInt32(p, little) / 2147483648;
        out[c][i] = bps === 3 && !isFloat ? s / 8388608 : s;
      }
    }
    return { rate: Math.round(comm.rate), channels: out, sourceBits: isFloat ? "float" : comm.bits };
  }

  // Reads WAV or AIFF; returns null for anything else.
  function read(bytes) { return readWav(bytes) || readAiff(bytes); }

  // In the page: WAV/AIFF ourselves, everything else (MP3, FLAC, OGG...) by the browser.
  function decode(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var mine = read(bytes);
    if (mine) return Promise.resolve(mine);
    var Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return Promise.reject(new Error("This file type can't be read here."));
    var ctx = new Ctx();
    return ctx.decodeAudioData(arrayBuffer.slice(0)).then(function (buf) {
      var ch = [];
      for (var c = 0; c < buf.numberOfChannels; c++) ch.push(new Float32Array(buf.getChannelData(c)));
      ctx.close && ctx.close();
      return { rate: buf.sampleRate, channels: ch, sourceBits: "compressed" };
    }, function () {
      ctx.close && ctx.close();
      throw new Error("This browser can't read this file type. WAV and AIFF always work.");
    });
  }

  // ---------------------------------------------------------------- preparing

  // Windowed-sinc resampler: 64 taps, Blackman-Harris window, 512 phases with
  // linear interpolation between them.
  var TAPS = 64, PHASES = 512, tables = {};
  function sincTable(cutoff) {
    var key = cutoff.toFixed(6);
    if (tables[key]) return tables[key];
    var t = new Float32Array((PHASES + 1) * TAPS);
    for (var ph = 0; ph <= PHASES; ph++) {
      var frac = ph / PHASES, sum = 0;
      for (var k = 0; k < TAPS; k++) {
        var x = k - (TAPS / 2 - 1) - frac;           // distance from the output point
        var arg = Math.PI * cutoff * x;
        var sinc = x === 0 ? 1 : Math.sin(arg) / arg;
        var n = (x + TAPS / 2) / TAPS;               // 0..1 across the window
        var w = n <= 0 || n >= 1 ? 0 : 0.35875 - 0.48829 * Math.cos(2 * Math.PI * n) + 0.14128 * Math.cos(4 * Math.PI * n) - 0.01168 * Math.cos(6 * Math.PI * n);
        t[ph * TAPS + k] = sinc * w;
        sum += sinc * w;
      }
      for (k = 0; k < TAPS; k++) t[ph * TAPS + k] /= sum;   // unity gain at DC
    }
    tables[key] = t;
    return t;
  }

  function resampleChannel(x, ratio, table) {
    var n = Math.floor(x.length * ratio), y = new Float32Array(n), step = 1 / ratio;
    for (var i = 0; i < n; i++) {
      var pos = i * step, base = Math.floor(pos), frac = pos - base;
      var fp = frac * PHASES, ph = Math.floor(fp), w = fp - ph;
      var o0 = ph * TAPS, o1 = o0 + TAPS, s0 = 0, s1 = 0;
      var start = base - (TAPS / 2 - 1);
      for (var k = 0; k < TAPS; k++) {
        var j = start + k;
        if (j >= 0 && j < x.length) { s0 += x[j] * table[o0 + k]; s1 += x[j] * table[o1 + k]; }
      }
      y[i] = s0 + w * (s1 - s0);
    }
    return y;
  }

  function resample(sound, rate) {
    if (sound.rate === rate) return sound;
    var ratio = rate / sound.rate;
    var table = sincTable(Math.min(1, ratio) * 0.96);   // below both Nyquists
    return { rate: rate, channels: sound.channels.map(function (c) { return resampleChannel(c, ratio, table); }), sourceBits: sound.sourceBits };
  }

  function peak(sound) {
    var p = 0;
    sound.channels.forEach(function (c) { for (var i = 0; i < c.length; i++) { var a = Math.abs(c[i]); if (a > p) p = a; } });
    return p;
  }

  // Stereo whose two sides are the same is really mono.
  function isDualMono(sound) {
    if (sound.channels.length !== 2) return false;
    var l = sound.channels[0], r = sound.channels[1];
    for (var i = 0; i < l.length; i++) if (Math.abs(l[i] - r[i]) > 1e-4) return false;
    return true;
  }

  // Trims silence before the first sound and after the last (with a short fade out).
  var SILENCE = 0.0005;   // about -66 dBFS
  function trim(sound) {
    var len = sound.channels[0].length, first = len, last = -1;
    sound.channels.forEach(function (c) {
      for (var i = 0; i < len; i++) if (Math.abs(c[i]) > SILENCE) { if (i < first) first = i; break; }
      for (i = len - 1; i >= 0; i--) if (Math.abs(c[i]) > SILENCE) { if (i > last) last = i; break; }
    });
    if (last < first) return sound;   // all silence: leave it
    var pre = Math.min(first, Math.round(sound.rate * 0.0005));   // keep 0.5 ms before the hit
    var start = first - pre, fade = Math.round(sound.rate * 0.005), end = Math.min(len, last + 1 + fade);
    var chans = sound.channels.map(function (c) {
      var y = c.slice(start, end);
      for (var i = 0; i < Math.min(fade, y.length); i++) y[y.length - 1 - i] *= i / fade;
      return y;
    });
    return { rate: sound.rate, channels: chans, sourceBits: sound.sourceBits };
  }

  function gain(sound, g) {
    return { rate: sound.rate, sourceBits: sound.sourceBits, channels: sound.channels.map(function (c) {
      var y = new Float32Array(c.length); for (var i = 0; i < c.length; i++) y[i] = c[i] * g; return y; }) };
  }

  /*
   * Prepares a sound for the NT. opts: { rate (48000, or 0 to keep), trim, mono, normalise }.
   * Returns the prepared sound and notes about what changed.
   */
  function prepare(sound, opts) {
    var notes = [], s = sound;
    if (opts.mono && isDualMono(s)) { s = { rate: s.rate, channels: [s.channels[0]], sourceBits: s.sourceBits }; notes.push("stereo with identical sides made mono"); }
    if (s.channels.length > 2) { s = { rate: s.rate, channels: s.channels.slice(0, 2), sourceBits: s.sourceBits }; notes.push("kept the first two of " + sound.channels.length + " channels"); }
    if (opts.trim) {
      var before = s.channels[0].length; s = trim(s);
      var cut = (before - s.channels[0].length) / s.rate;
      if (cut > 0.001) notes.push("trimmed " + Math.round(cut * 1000) + " ms of silence");
    }
    if (opts.rate && s.rate !== opts.rate) { notes.push("resampled " + s.rate + " → " + opts.rate + " Hz"); s = resample(s, opts.rate); }
    var p = peak(s);
    if (opts.normalise && p > 0) {
      var target = Math.pow(10, -0.3 / 20);
      s = gain(s, target / p); notes.push("normalised to -0.3 dBFS (" + (20 * Math.log10(target / p) >= 0 ? "+" : "") + (20 * Math.log10(target / p)).toFixed(1) + " dB)");
    } else if (p > 1) {
      s = gain(s, 0.999 / p); notes.push("turned down " + (20 * Math.log10(p / 0.999)).toFixed(1) + " dB to avoid clipping");
    }
    return { sound: s, notes: notes, bits: outputBits(sound) };
  }

  // The NT reads 8, 16 and 24-bit and float WAV, so nothing is reduced below what it was:
  // 8 and 16-bit sources are written as 16-bit, everything else (24, 32, float, MP3...) as 24-bit.
  function outputBits(sound) { return sound.sourceBits === 8 || sound.sourceBits === 16 ? 16 : 24; }

  // ---------------------------------------------------------------- writing

  // PCM WAV, 16-bit (with TPDF dither; seed makes it repeatable) or 24-bit.
  function encodeWav(sound, bits, seed) {
    var ch = sound.channels.length, frames = sound.channels[0].length, bps = bits === 24 ? 3 : 2;
    var dataLen = frames * ch * bps, buf = new ArrayBuffer(44 + dataLen + (dataLen & 1)), dv = new DataView(buf);
    function s4(o, s) { for (var i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    s4(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); s4(8, "WAVE");
    s4(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sound.rate, true); dv.setUint32(28, sound.rate * ch * bps, true);
    dv.setUint16(32, ch * bps, true); dv.setUint16(34, bps * 8, true);
    s4(36, "data"); dv.setUint32(40, dataLen, true);
    var o = 44;
    if (bps === 3) {
      for (var i = 0; i < frames; i++) for (var c = 0; c < ch; c++, o += 3) {
        var v = Math.round(sound.channels[c][i] * 8388607);
        v = v > 8388607 ? 8388607 : v < -8388608 ? -8388608 : v;
        dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255);
      }
      return new Uint8Array(buf);
    }
    var r = (seed || 1) >>> 0;
    function rnd() { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; }
    for (i = 0; i < frames; i++) for (c = 0; c < ch; c++, o += 2) {
      v = sound.channels[c][i] * 32767 + (rnd() - rnd());
      v = Math.round(v);
      dv.setInt16(o, v > 32767 ? 32767 : v < -32768 ? -32768 : v, true);
    }
    return new Uint8Array(buf);
  }
  function encodeWav16(sound, seed) { return encodeWav(sound, 16, seed); }

  return {
    read: read, readWav: readWav, readAiff: readAiff, decode: decode,
    resample: resample, trim: trim, peak: peak, isDualMono: isDualMono, prepare: prepare, outputBits: outputBits,
    encodeWav: encodeWav, encodeWav16: encodeWav16,
  };
})();

if (typeof module !== "undefined") module.exports = PDAudio;
