/*
 * The Patterns page: open the Performer's drum library (DRUMS.LIB), edit its
 * patterns on an eight-lane step grid, play them with a kit, import and export
 * MIDI, and save the library back.
 */
"use strict";

(function () {
  var VOICES = Naming.VOICES;                 // the machine's order (rows)
  // the plug-in's level for a velocity at its default velocity depth (100 %): (velocity / 127)²
  function velocityGain(velocity) { var v = velocity / 127; return v * v; }
  var NORMAL = velocityGain(90);              // the Performer's velocity 90, accents 127

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function pad3(n) { return ("00" + n).slice(-3); }

  var lib = {
    name: null,          // file name shown
    handle: null,        // FileSystemFileHandle when opened with the picker (saved in place)
    patterns: [],
    dirty: false,
  };
  var sel = -1;

  // ---------------------------------------------------------------- pages

  function showPage() {
    var patterns = location.hash === "#patterns";
    $("pageKits").hidden = patterns;
    $("pagePatterns").hidden = !patterns;
    $("tabKits").classList.toggle("on", !patterns);
    $("tabPatterns").classList.toggle("on", patterns);
    $("tabKits").setAttribute("aria-current", patterns ? "false" : "page");
    $("tabPatterns").setAttribute("aria-current", patterns ? "page" : "false");
    if (!patterns) stop();
    else renderGrid();
  }

  // ---------------------------------------------------------------- status

  function setStatus(text, kind) {
    var s = $("patStatus");
    s.textContent = text || "";
    s.className = "status" + (kind ? " " + kind : "");
  }
  function askConfirm(text, yesLabel) {
    var box = $("patConfirm");
    return new Promise(function (resolve) {
      box.textContent = "";
      var yes = el("button", "btn primary", yesLabel), no = el("button", "btn", "Cancel");
      yes.type = no.type = "button";
      yes.addEventListener("click", function () { box.hidden = true; resolve(true); });
      no.addEventListener("click", function () { box.hidden = true; resolve(false); });
      box.append(el("span", null, text), yes, no);
      box.hidden = false;
      yes.focus();
    });
  }
  function markDirty() { lib.dirty = true; renderLibrary(); }

  // ---------------------------------------------------------------- library

  function openBytes(bytes, name, handle) {
    var r;
    try { r = DrumLib.readLibrary(bytes); }
    catch (e) { setStatus(e.message, "err"); return; }
    stop();
    lib = { name: name, handle: handle || null, patterns: r.patterns, dirty: false };
    select(0);
    renderLibrary();
    setStatus("Opened " + name + ": " + r.patterns.length + " patterns.", "ok");
  }

  function openLibrary() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ id: "pd-library", types: [{ description: "Performer drum library", accept: { "application/octet-stream": [".LIB", ".lib"] } }] })
        .then(function (handles) {
          var h = handles[0];
          return h.getFile().then(function (f) { return f.arrayBuffer().then(function (b) { openBytes(new Uint8Array(b), f.name, h); }); });
        }).catch(function (e) { if (e && e.name !== "AbortError") setStatus("Couldn't open it: " + e.message, "err"); });
    } else {
      $("libPick").click();
    }
  }

  function newLibrary() {
    stop();
    lib = { name: "DRUMS.LIB (new)", handle: null, patterns: [DrumLib.emptyPattern("Pattern 000", "User")], dirty: true };
    select(0);
    renderLibrary();
    setStatus("A new library with one empty pattern. Save it as LIBRARY/DRUMS.LIB on the Performer's card (it replaces the patterns there).");
  }

  function saveLibrary() {
    var bytes;
    try { bytes = DrumLib.writeLibrary(lib.patterns); }
    catch (e) { setStatus(e.message, "err"); return; }
    function done(where) { lib.dirty = false; renderLibrary(); setStatus("Saved " + lib.patterns.length + " patterns to " + where + ". On the Performer: put the card back and browse on T3 or T4.", "ok"); }
    function download() {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      a.download = "DRUMS.LIB";
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      done("a downloaded DRUMS.LIB (copy it into the card's LIBRARY folder)");
    }
    function write(h) {
      return h.createWritable().then(function (w) { return w.write(bytes).then(function () { return w.close(); }); }).then(function () { lib.handle = h; lib.name = h.name; done(h.name); });
    }
    if (lib.handle && lib.handle.createWritable) {
      write(lib.handle).catch(function (e) { setStatus("Couldn't save in place (" + e.message + "). Downloading it instead.", "err"); download(); });
    } else if (window.showSaveFilePicker) {
      window.showSaveFilePicker({ id: "pd-library", suggestedName: "DRUMS.LIB" }).then(write)
        .catch(function (e) { if (e && e.name === "AbortError") setStatus("Nothing saved."); else download(); });
    } else {
      download();
    }
  }

  function renderLibrary() {
    $("libName").textContent = (lib.name || "No library open") + (lib.dirty ? " · not saved" : "");
    $("libCount").textContent = lib.patterns.length ? lib.patterns.length + " pattern" + (lib.patterns.length === 1 ? "" : "s") : "";
    $("libSave").disabled = !lib.patterns.length;
    ["patNew", "patDup", "patDel"].forEach(function (id) { $(id).disabled = !lib.patterns.length && id !== "patNew"; });
    renderList();
    renderFields();
  }

  // ---------------------------------------------------------------- the list

  function renderList() {
    var list = $("patList");
    list.textContent = "";
    var style = null;
    lib.patterns.forEach(function (p, i) {
      if (p.style !== style) {
        style = p.style;
        list.append(el("li", "pstyle", style || "—"));
      }
      var item = el("li", "pitem" + (i === sel ? " on" : ""));
      var b = el("button", null);
      b.type = "button";
      b.append(el("span", "pno", pad3(i)), el("span", "pname", p.name));
      b.addEventListener("click", function () { select(i); });
      item.append(b);
      list.append(item);
    });
    var on = list.querySelector(".pitem.on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  function select(i) {
    sel = lib.patterns.length ? Math.max(0, Math.min(lib.patterns.length - 1, i)) : -1;
    renderList();
    renderFields();
    renderGrid();
    if (playing) restartPlay();
    updateKitLabel();
  }
  function current() { return sel >= 0 ? lib.patterns[sel] : null; }

  function addPattern(p) {
    // always at the end: the numbers of the patterns before stay (they pair with kits)
    lib.patterns.push(p);
    markDirty();
    select(lib.patterns.length - 1);
  }

  function newPattern() {
    if (!lib.patterns.length) { newLibrary(); return; }
    var last = lib.patterns[lib.patterns.length - 1];
    var p = DrumLib.emptyPattern("Pattern " + pad3(lib.patterns.length), last.style === "patterns-v2" ? "User" : last.style);
    addPattern(p);
    setStatus("Pattern " + pad3(sel) + " added at the end.");
  }
  function duplicatePattern() {
    var p = current();
    if (!p) return;
    var c = DrumLib.clonePattern(p);
    c.name = (p.name + " copy").slice(0, 31);
    c.style = p.style === "patterns-v2" ? "User" : p.style;
    addPattern(c);
    setStatus("A copy is pattern " + pad3(sel) + ", at the end.");
  }
  function deletePattern() {
    var p = current();
    if (!p) return;
    if (lib.patterns.length === 1) { setStatus("A library keeps at least one pattern.", "err"); return; }
    var last = sel === lib.patterns.length - 1;
    var text = last ? "Delete pattern " + pad3(sel) + " (" + p.name + ")?"
                    : "Delete pattern " + pad3(sel) + "? The " + (lib.patterns.length - 1 - sel) + " after it move down one number, so they no longer match their kits.";
    askConfirm(text, "Delete").then(function (ok) {
      if (!ok) return;
      lib.patterns.splice(sel, 1);
      markDirty();
      select(Math.min(sel, lib.patterns.length - 1));
    });
  }

  // ---------------------------------------------------------------- the fields

  function renderFields() {
    var p = current(), on = !!p;
    ["patName", "patStyle", "patBars", "patBpm", "patSwing", "play", "midiGm", "midiPack"].forEach(function (id) { $(id).disabled = !on; });
    $("patNumber").textContent = on ? pad3(sel) : "—";
    if (!on) return;
    if (document.activeElement !== $("patName")) $("patName").value = p.name;
    if (document.activeElement !== $("patStyle")) $("patStyle").value = p.style;
    $("patBars").value = String(p.steps);
    if (document.activeElement !== $("patBpm")) $("patBpm").value = p.bpm;
    if (document.activeElement !== $("patSwing")) $("patSwing").value = p.swing;
  }

  function wireFields() {
    $("patName").addEventListener("input", function () { var p = current(); if (!p) return; p.name = this.value.slice(0, 31); markDirty(); });
    $("patStyle").addEventListener("input", function () { var p = current(); if (!p) return; p.style = this.value.slice(0, 31); markDirty(); });
    $("patBars").addEventListener("change", function () { var p = current(); if (!p) return; p.steps = parseInt(this.value, 10); markDirty(); renderGrid(); });
    $("patBpm").addEventListener("change", function () { var p = current(); if (!p) return; p.bpm = Math.max(40, Math.min(255, parseInt(this.value, 10) || 120)); markDirty(); });
    $("patSwing").addEventListener("change", function () { var p = current(); if (!p) return; p.swing = Math.max(50, Math.min(75, parseInt(this.value, 10) || 50)); markDirty(); });
  }

  // ---------------------------------------------------------------- the grid

  var paint = null;     // { mode: "on" | "off" | "accent", voice } while dragging

  function cellState(p, v, s) { var l = p.lanes[v]; return l.gates[s] ? (l.accents[s] ? "accent" : "on") : "off"; }
  function setCell(p, v, s, mode) {
    var l = p.lanes[v];
    l.gates[s] = mode !== "off";
    l.accents[s] = mode === "accent";
  }

  function renderGrid() {
    var grid = $("grid"), p = current();
    grid.textContent = "";
    if (!p) { grid.append(el("p", "help", "Open the Performer's DRUMS.LIB, make a new library, or import a MIDI file.")); return; }
    grid.style.setProperty("--steps", p.steps);
    VOICES.forEach(function (v) {
      var row = el("div", "grow");
      row.setAttribute("role", "row");
      var name = el("button", "gvoice", v);
      name.type = "button";
      name.title = "Hear " + Naming.VOICE_TITLES[v];
      name.addEventListener("click", function () { audition(v); });
      row.append(name);
      for (var s = 0; s < p.steps; s++) {
        (function (s) {
          var c = el("button", "gcell " + cellState(p, v, s) + (s % 4 === 0 ? " beat" : "") + (s % 16 === 0 ? " bar" : ""));
          c.type = "button";
          c.dataset.voice = v; c.dataset.step = s;
          c.setAttribute("role", "gridcell");
          c.setAttribute("aria-label", v + " step " + (s + 1));
          c.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            var st = cellState(p, v, s), accent = e.shiftKey || e.button === 2;
            var mode = accent ? (st === "accent" ? "on" : "accent") : (st === "off" ? "on" : "off");
            paint = { mode: mode, voice: v };
            setCell(p, v, s, mode);
            c.className = c.className.replace(/\b(off|on|accent)\b/, mode);
            markDirty();
          });
          c.addEventListener("pointerenter", function () {
            if (!paint || paint.voice !== v) return;
            setCell(p, v, s, paint.mode);
            c.className = c.className.replace(/\b(off|on|accent)\b/, paint.mode);
          });
          c.addEventListener("contextmenu", function (e) { e.preventDefault(); });
          c.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            var st = cellState(p, v, s), mode = e.shiftKey ? (st === "accent" ? "on" : "accent") : (st === "off" ? "on" : "off");
            setCell(p, v, s, mode);
            c.className = c.className.replace(/\b(off|on|accent)\b/, mode);
            markDirty();
          });
          row.append(c);
        })(s);
      }
      grid.append(row);
    });
  }

  function markPlayhead(step) {
    var grid = $("grid");
    var old = grid.querySelectorAll(".gcell.now");
    for (var i = 0; i < old.length; i++) old[i].classList.remove("now");
    if (step < 0) return;
    var now = grid.querySelectorAll('.gcell[data-step="' + step + '"]');
    for (i = 0; i < now.length; i++) now[i].classList.add("now");
  }

  // ---------------------------------------------------------------- kits

  var kitsFolder = {};    // number -> { name, files: [File] }
  var kitCache = {};      // number -> Promise of { voice: AudioBuffer }

  function readKitsFolder(files) {
    kitsFolder = {}; kitCache = {};
    files.forEach(function (f) {
      var parts = (f.webkitRelativePath || f.name).split("/");
      if (parts.length < 2 || Naming.isHidden(f.name)) return;
      var folder = parts[parts.length - 2], k = Naming.parseKitFolder(folder);
      if (!k || !/\.(wav|wave|aif|aiff|aifc)$/i.test(f.name)) return;
      (kitsFolder[k.number] = kitsFolder[k.number] || { name: folder, files: [] }).files.push(f);
    });
    var n = Object.keys(kitsFolder).length;
    setStatus(n ? n + " kits found. Pattern N plays kit N." : "No kit folders (NNN-Name) in that folder.", n ? "ok" : "err");
    $("kitSource").value = "match";
    updateKitLabel();
  }

  function toBuffer(sound) {
    var ctx = audio();
    var buf = ctx.createBuffer(sound.channels.length, sound.channels[0].length, sound.rate);
    sound.channels.forEach(function (c, i) { buf.copyToChannel ? buf.copyToChannel(c, i) : buf.getChannelData(i).set(c); });
    return buf;
  }

  function nearestKit(number) {
    var nums = Object.keys(kitsFolder).map(Number).sort(function (a, b) { return a - b; });
    if (!nums.length) return -1;
    var below = nums.filter(function (n) { return n <= number; });
    return below.length ? below[below.length - 1] : nums[0];
  }

  // the sounds for the selected pattern: { voice: AudioBuffer } and a label
  function kitFor(number) {
    if ($("kitSource").value === "kits") {
      var sounds = window.PDKits ? window.PDKits.sounds() : {}, out = {};
      Object.keys(sounds).forEach(function (v) { out[v] = toBuffer(sounds[v]); });
      return Promise.resolve({ buffers: out, label: Object.keys(out).length ? "the Kits page (" + window.PDKits.label() + ")" : null });
    }
    var kit = kitsFolder[number];
    if (!kit) {
      // no kit with this number: the nearest one below it (or the first), so the pattern still sounds
      var near = nearestKit(number);
      if (near < 0) return Promise.resolve({ buffers: {}, label: null });
      return kitFor(near);
    }
    if (!kitCache[number]) {
      var names = kit.files.map(function (f) { return f.name; }), a = Naming.assign(names), out2 = {};
      kitCache[number] = Promise.all(VOICES.map(function (v) {
        if (a[v] < 0) return null;
        return kit.files[a[v]].arrayBuffer().then(function (b) {
          var s = PDAudio.read(new Uint8Array(b));
          if (s && s.channels.length && s.channels[0].length) out2[v] = toBuffer(s);
        }).catch(function () {});
      })).then(function () { return out2; });
    }
    return kitCache[number].then(function (buffers) { return { buffers: buffers, label: kit.name }; });
  }

  function updateKitLabel() {
    var label = $("kitPlaying");
    if (sel < 0) { label.textContent = ""; return; }
    if ($("kitSource").value === "kits") {
      var n = window.PDKits ? Object.keys(window.PDKits.sounds()).length : 0;
      label.textContent = n ? "Plays " + window.PDKits.label() + " (" + n + " sounds)" : "The Kits page has no sounds yet.";
    } else if (!Object.keys(kitsFolder).length) {
      label.textContent = "Open a folder of kits (like BY KIT) and pattern " + pad3(sel) + " plays kit " + pad3(sel) + ".";
    } else {
      var near = nearestKit(sel);
      label.textContent = kitsFolder[sel] ? "Plays kit " + kitsFolder[sel].name : "No kit " + pad3(sel) + ": playing " + kitsFolder[near].name + ".";
    }
  }

  // ---------------------------------------------------------------- playing

  var actx = null, out = null, playing = false, timer = null, kit = { buffers: {} };
  var nextStep = 0, loopStart = 0, hats = {}, pending = [];
  var AHEAD = 0.12;

  function audio() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!actx) { actx = new Ctx(); out = actx.createGain(); out.gain.value = 0.9; out.connect(actx.destination); }
    return actx;
  }

  function hit(v, time, gain) {
    var buf = kit.buffers[v];
    if (!buf) return;
    var src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = buf; g.gain.value = gain;
    src.connect(g); g.connect(out);
    // the two hi-hats cut each other (the plug-in's choke group A, a 5 ms fade)
    var other = v === "CHH" ? "OHH" : v === "OHH" ? "CHH" : null;
    if (other && hats[other]) {
      try { hats[other].g.gain.setTargetAtTime(0, time, 0.004); hats[other].src.stop(time + 0.03); } catch (e) {}
      hats[other] = null;
    }
    src.start(time);
    if (other) hats[v] = { src: src, g: g };
  }

  function schedule() {
    var p = current();
    if (!p) return;
    var stepDur = 60 / p.bpm / 4;
    while (true) {
      var bar = Math.floor(nextStep / p.steps), s = nextStep % p.steps;
      var t = loopStart + bar * p.steps * stepDur + DrumLib.stepTime(s, p.bpm, p.swing);
      if (t > actx.currentTime + AHEAD) break;
      VOICES.forEach(function (v) {
        var l = p.lanes[v];
        if (l.gates[s]) hit(v, t, l.accents[s] ? velocityGain(127) : NORMAL);
      });
      pending.push({ t: t, s: s });
      nextStep++;
    }
    while (pending.length && pending[0].t <= actx.currentTime) markPlayhead(pending.shift().s);
  }

  function start() {
    if (!current()) return;
    audio();
    if (actx.state === "suspended") actx.resume();
    kitFor(sel).then(function (k) {
      kit = k;
      updateKitLabel();
      if (!Object.keys(k.buffers).length) setStatus($("kitSource").value === "kits" ? "No sounds on the Kits page: add some there first." : "No kit to play: open a kits folder, or choose the Kits page.", "err");
      else setStatus("Playing pattern " + pad3(sel) + " with " + k.label + ".");
      playing = true;
      nextStep = 0; pending = []; hats = {};
      loopStart = actx.currentTime + 0.05;
      clearInterval(timer);
      timer = setInterval(schedule, 25);
      schedule();
      $("play").textContent = "■ Stop"; $("play").setAttribute("aria-pressed", "true");
    });
  }
  function stop() {
    playing = false;
    clearInterval(timer); timer = null;
    pending = [];
    markPlayhead(-1);
    var b = $("play");
    if (b) { b.textContent = "▶ Play"; b.setAttribute("aria-pressed", "false"); }
  }
  function restartPlay() { stop(); start(); }

  function audition(v) {
    audio();
    if (actx.state === "suspended") actx.resume();
    kitFor(sel).then(function (k) {
      kit = k;
      if (!k.buffers[v]) { setStatus("No " + v + " sound in " + (k.label || "the kit") + ".", "err"); return; }
      hit(v, actx.currentTime + 0.01, 1);
    });
  }

  // ---------------------------------------------------------------- MIDI

  function importFiles(files) {
    var pending = files.filter(function (f) { return /\.midi?$/i.test(f.name); });
    if (!pending.length) { setStatus("None of those are MIDI files.", "err"); return; }
    if (!lib.patterns.length) { lib = { name: "DRUMS.LIB (new)", handle: null, patterns: [], dirty: true }; }
    var added = 0, first = lib.patterns.length, notes = [];
    pending.reduce(function (chain, f) {
      return chain.then(function () {
        return f.arrayBuffer().then(function (b) {
          var r = DrumLib.importMidi(new Uint8Array(b), { name: f.name.replace(/\.midi?$/i, "").slice(0, 28), style: "Imported" });
          r.patterns.forEach(function (p) { lib.patterns.push(p); added++; });
          notes.push(f.name + ": " + DrumLib.LAYOUTS[r.layout].name + (r.ignored ? ", " + r.ignored + " notes with no voice left out" : ""));
        }).catch(function (e) { notes.push(f.name + ": " + e.message); });
      });
    }, Promise.resolve()).then(function () {
      if (added) { lib.dirty = true; renderLibrary(); select(first); }
      setStatus("Imported " + added + " pattern" + (added === 1 ? "" : "s") + " (from " + pad3(first) + "). " + notes.join(" · "), added ? "ok" : "err");
    });
  }

  function exportMidi(layout) {
    var p = current();
    if (!p) return;
    var bytes = DrumLib.exportMidi(p, { layout: layout });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
    a.download = pad3(sel) + "-" + (p.name || "pattern").replace(/[^A-Za-z0-9 _-]/g, "").trim() + ".mid";
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
    setStatus("Exported " + a.download + (layout === "pack" ? " with the pattern pack's notes (60–67)." : " with General MIDI drum notes on channel 10."), "ok");
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    window.addEventListener("hashchange", showPage);
    $("libOpen").addEventListener("click", openLibrary);
    $("libPick").addEventListener("change", function (e) {
      var f = e.target.files[0]; e.target.value = "";
      if (f) f.arrayBuffer().then(function (b) { openBytes(new Uint8Array(b), f.name, null); });
    });
    $("libNew").addEventListener("click", function () {
      if (lib.dirty) askConfirm("The open library has changes that aren't saved. Start a new one anyway?", "New library").then(function (ok) { if (ok) newLibrary(); });
      else newLibrary();
    });
    $("libSave").addEventListener("click", saveLibrary);
    $("midiPick").addEventListener("change", function (e) { importFiles(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
    $("patNew").addEventListener("click", newPattern);
    $("patDup").addEventListener("click", duplicatePattern);
    $("patDel").addEventListener("click", deletePattern);
    $("play").addEventListener("click", function () { if (playing) stop(); else start(); });
    $("kitSource").addEventListener("change", function () { kitCache = {}; updateKitLabel(); if (playing) restartPlay(); });
    $("kitsFolder").addEventListener("change", function (e) { readKitsFolder(Array.prototype.slice.call(e.target.files)); e.target.value = ""; if (playing) restartPlay(); });
    $("midiGm").addEventListener("click", function () { exportMidi("gm"); });
    $("midiPack").addEventListener("click", function () { exportMidi("pack"); });
    document.addEventListener("pointerup", function () { if (paint) { paint = null; } });
    document.addEventListener("keydown", function (e) {
      if (location.hash !== "#patterns" || e.target.closest("input, select, textarea")) return;
      if (e.code === "Space" && !e.target.closest("button")) { e.preventDefault(); if (playing) stop(); else start(); }
    });
    // MIDI files and DRUMS.LIB dropped on the Patterns page (the Kits page takes sounds)
    $("pagePatterns").addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); });
    $("pagePatterns").addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      var libFile = files.filter(function (f) { return /\.lib$/i.test(f.name); })[0];
      if (libFile) libFile.arrayBuffer().then(function (b) { openBytes(new Uint8Array(b), libFile.name, null); });
      else importFiles(files);
    });
    window.addEventListener("beforeunload", function (e) { if (lib.dirty) { e.preventDefault(); e.returnValue = ""; } });
  }

  // for the browser console and the tests: open library bytes, read the state
  window.PDPatterns = {
    open: function (bytes, name) { openBytes(bytes, name || "DRUMS.LIB", null); },
    library: function () { return lib; },
    selected: function () { return sel; },
    bytes: function () { return DrumLib.writeLibrary(lib.patterns); },
  };

  wire();
  wireFields();
  renderLibrary();
  showPage();
})();
