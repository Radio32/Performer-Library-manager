/*
 * The built-in sounds for previews, made with Web Audio (no samples needed):
 * a drum kit in the manner of a 1980s drum machine (a short, punchy kick, a
 * tight snare, metallic hats and cymbal, a layered clap, two toms), a bass, a
 * lead and a soft chord voice.
 *
 * Every sound is scheduled at a time on an AudioContext and goes to `out`.
 * The drum voices are the Performer's eight: BD SNR CLP CHH OHH P1 P2 CYM.
 */
"use strict";

var PDSynth = (function () {

  var noise = null;
  function noiseBuffer(ctx) {
    if (!noise || noise.sampleRate !== ctx.sampleRate) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  }
  function noiseSource(ctx, t, dur) {
    var n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur);
    return n;
  }
  function hz(pitch) { return 440 * Math.pow(2, (pitch - 69) / 12); }
  function env(g, t, level, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  // the hats' and cymbal's metal: six square waves at inharmonic ratios
  var METAL = [1, 1.483, 1.932, 2.546, 2.630, 3.897];
  function metal(ctx, t, dur, base) {
    var mix = ctx.createGain();
    mix.gain.value = 0.45;
    METAL.forEach(function (r) {
      var o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = base * r;
      o.connect(mix);
      o.start(t); o.stop(t + dur);
    });
    return mix;
  }

  var openHat = null;   // the open hat, cut by the closed one (as on the drum machines)

  /* One drum hit: voice BD SNR CLP CHH OHH P1 P2 CYM, accent true / false (or a gain 0..1). */
  function drum(ctx, out, t, voice, accent) {
    var level = typeof accent === "number" ? accent : (accent ? 1 : 0.62);
    var g = ctx.createGain();
    g.connect(out);
    var o, n, f, hp;
    switch (voice) {
    case "BD":
      o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.045);
      env(g, t, level * 0.8, 0.38);
      o.connect(g); o.start(t); o.stop(t + 0.4);
      // the beater's click
      var click = ctx.createGain(); click.connect(out);
      env(click, t, level * 0.35, 0.012);
      hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
      noiseSource(ctx, t, 0.02).connect(hp); hp.connect(click);
      break;
    case "SNR":
      [185, 330].forEach(function (fr, k) {
        var to = ctx.createOscillator(), tg = ctx.createGain();
        to.type = "triangle"; to.frequency.setValueAtTime(fr * 1.15, t); to.frequency.exponentialRampToValueAtTime(fr, t + 0.02);
        env(tg, t, level * (k ? 0.35 : 0.5), 0.11);
        to.connect(tg); tg.connect(out); to.start(t); to.stop(t + 0.15);
      });
      f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1400;
      env(g, t, level * 0.6, 0.2);
      noiseSource(ctx, t, 0.22).connect(f); f.connect(g);
      break;
    case "CLP":
      // three quick bursts, then the room
      f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1100; f.Q.value = 1.4;
      f.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach(function (d) {
        g.gain.setValueAtTime(level * 1.6, t + d);
        g.gain.exponentialRampToValueAtTime(level * 0.2, t + d + 0.009);
      });
      g.gain.setValueAtTime(level * 1.0, t + 0.031);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      noiseSource(ctx, t, 0.22).connect(f);
      break;
    case "CHH":
    case "OHH":
    case "CYM":
      var dur = voice === "CHH" ? 0.06 : voice === "OHH" ? 0.42 : 1.3;
      var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = voice === "CYM" ? 7000 : 10000; bp.Q.value = 0.8;
      hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = voice === "CYM" ? 4500 : 7000;
      metal(ctx, t, dur + 0.05, voice === "CYM" ? 300 : 400).connect(bp);
      bp.connect(hp); hp.connect(g);
      env(g, t, level * (voice === "CYM" ? 0.8 : 1), dur);
      if (voice === "CHH" && openHat && openHat.end > t) {
        // the closed hat cuts the open one
        openHat.g.gain.cancelScheduledValues(t);
        openHat.g.gain.setTargetAtTime(0.0001, t, 0.004);
      }
      if (voice === "OHH") openHat = { g: g, end: t + dur };
      break;
    case "P1":
    case "P2":
      // the toms: low and mid
      var from = voice === "P1" ? 150 : 215, to2 = voice === "P1" ? 105 : 160;
      o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to2, t + 0.2);
      env(g, t, level * 0.8, 0.32);
      o.connect(g); o.start(t); o.stop(t + 0.35);
      break;
    default:
      break;
    }
  }

  /* A bass note: a sawtooth and a square an octave down, through a filter that closes. */
  function bass(ctx, out, t, dur, pitch, accent) {
    var level = accent ? 0.5 : 0.36;
    var f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.Q.value = 7;
    var top = accent ? 2400 : 1500;
    f.frequency.setValueAtTime(top, t);
    f.frequency.exponentialRampToValueAtTime(220, t + Math.max(0.08, Math.min(dur, 0.3)));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.setValueAtTime(level, t + Math.max(0.01, dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    [["sawtooth", 1, 0.7], ["square", 0.5, 0.45]].forEach(function (w) {
      var o = ctx.createOscillator(), og = ctx.createGain();
      o.type = w[0]; o.frequency.value = hz(pitch) * w[1]; og.gain.value = w[2];
      o.connect(og); og.connect(f);
      o.start(t); o.stop(t + dur + 0.06);
    });
    f.connect(g); g.connect(out);
  }

  /* A lead note: two slightly detuned saws, a little filter movement. */
  function lead(ctx, out, t, dur, pitch, accent) {
    var level = accent ? 0.3 : 0.22;
    var f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.Q.value = 2;
    var base = Math.min(7000, hz(pitch) * 8);
    f.frequency.setValueAtTime(base * 1.6, t);
    f.frequency.exponentialRampToValueAtTime(base, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.setValueAtTime(level * 0.8, t + Math.max(0.02, dur - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    [-6, 6].forEach(function (cents) {
      var o = ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = hz(pitch); o.detune.value = cents;
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    });
    f.connect(g); g.connect(out);
  }

  /* A chord tone: soft attack and release (k = 0 is the bass note, played by the bass). */
  function chordTone(ctx, out, t, dur, pitch, k) {
    if (k === 0) { bass(ctx, out, t, dur, pitch, false); return; }
    var g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 2200;
    var level = 0.09;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.06);
    g.gain.setValueAtTime(level, t + Math.max(0.07, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    [["sawtooth", -7], ["triangle", 7]].forEach(function (w) {
      var o = ctx.createOscillator();
      o.type = w[0]; o.frequency.value = hz(pitch); o.detune.value = w[1];
      o.connect(f); o.start(t); o.stop(t + dur + 0.2);
    });
    f.connect(g); g.connect(out);
  }

  return { drum: drum, bass: bass, lead: lead, chordTone: chordTone, VOICES: ["BD", "SNR", "CLP", "CHH", "OHH", "P1", "P2", "CYM"] };
})();
