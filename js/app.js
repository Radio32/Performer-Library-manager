/*
 * The page: eight slots, conversion options, and saving a kit folder.
 */
"use strict";

(function () {
  var VOICES = Naming.VOICES;
  var PLUGIN_MEMORY = 2 * 1048576;     // Performer Drums' default sample memory

  var state = {
    number: 1,
    name: "",
    opts: { rate: 48000, trim: true, mono: true, normalise: false },
    slots: {},    // voice -> { fileName, sound, prepared, notes, error, busy }
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    number: $("kitNumber"), name: $("kitName"), nameCount: $("nameCount"), folder: $("folderName"), numberHelp: $("numberHelp"),
    optRate: $("optRate"), optTrim: $("optTrim"), optMono: $("optMono"), optNorm: $("optNorm"),
    slots: $("slots"), summary: $("summary"), status: $("status"), confirm: $("confirm"),
    saveCard: $("saveCard"), saveZip: $("saveZip"),
  };

  // ---------------------------------------------------------------- small helpers

  function setStatus(text, kind) {
    els.status.textContent = text || "";
    els.status.className = "status" + (kind ? " " + kind : "");
  }
  function folderName() { return Naming.kitFolder(state.number, state.name); }
  function fmtRate(r) { return (r / 1000).toFixed(r % 1000 ? 1 : 0) + " kHz"; }
  function fmtSecs(s) { return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(2) + " s"; }
  function fmtBytes(b) { return b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(2) + " MB"; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function savePrefs() {
    try { localStorage.setItem("pd-manager", JSON.stringify({ number: state.number, name: state.name, opts: state.opts })); } catch (e) {}
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem("pd-manager") || "null");
      if (p) { state.number = p.number | 0; state.name = Naming.cleanKitName(p.name); Object.assign(state.opts, p.opts || {}); }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- slots

  function buildSlots() {
    VOICES.forEach(function (v) {
      var card = el("article", "slot");
      card.id = "slot-" + v;
      card.setAttribute("aria-label", Naming.VOICE_TITLES[v]);
      var head = el("div", "slot-head");
      head.append(el("span", "voice", v), el("span", "voice-title", Naming.VOICE_TITLES[v]), el("span", "target", ""));
      var body = el("div", "slot-body");
      var input = el("input");
      input.type = "file"; input.accept = "audio/*,.wav,.aif,.aiff,.aifc"; input.hidden = true; input.id = "pick-" + v;
      input.addEventListener("change", function () { if (input.files[0]) loadInto(v, input.files[0]); input.value = ""; });
      var actions = el("div", "slot-actions");
      card.append(head, body, actions, input);
      card.addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); card.classList.add("over"); });
      card.addEventListener("dragleave", function () { card.classList.remove("over"); });
      card.addEventListener("drop", function (e) {
        e.preventDefault(); e.stopPropagation(); card.classList.remove("over");
        filesFromDrop(e.dataTransfer).then(function (files) {
          var audio = files.filter(isAudioFile);
          if (audio.length) loadInto(v, audio[0]);
        });
      });
      els.slots.append(card);
    });
  }

  function renderSlot(v) {
    var card = $("slot-" + v), s = state.slots[v];
    var body = card.querySelector(".slot-body"), actions = card.querySelector(".slot-actions");
    card.querySelector(".target").textContent = Naming.fileFor(v, state.number);
    card.classList.toggle("filled", !!(s && s.prepared));
    body.textContent = ""; actions.textContent = "";

    if (!s) {
      var drop = el("label", "drop", "Drop a sound here, or click to choose a file");
      drop.htmlFor = "pick-" + v;
      body.append(drop);
      return;
    }
    if (s.busy) { body.append(el("div", "drop", "Reading " + s.fileName + "…")); return; }
    if (s.error) {
      var m = el("div", "meta");
      m.append(el("div", "src", s.fileName), el("div", "error", s.error));
      body.append(m);
    } else {
      var canvas = el("canvas", "wave");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Waveform of " + s.fileName);
      body.append(canvas);
      var p = s.prepared.sound, o = s.sound;
      var meta = el("div", "meta");
      meta.append(el("div", "src", s.fileName));
      meta.append(el("div", null, fmtRate(o.rate) + " · " + (o.sourceBits === "float" ? "32-bit float" : o.sourceBits === "compressed" ? "compressed" : o.sourceBits + "-bit") +
        " · " + (o.channels.length === 1 ? "mono" : "stereo") + "  →  " + s.prepared.bits + "-bit " + (p.channels.length === 1 ? "mono" : "stereo") + ", " + fmtSecs(p.channels[0].length / p.rate)));
      if (s.prepared.notes.length) meta.append(el("div", "notes", s.prepared.notes.join(" · ")));
      body.append(meta);
      requestAnimationFrame(function () { drawWave(canvas, p); });
      var play = el("button", "btn small", "▶ Play");
      play.type = "button";
      play.setAttribute("aria-label", "Play " + v);
      play.addEventListener("click", function () { playSound(p); });
      actions.append(play);
    }
    var replace = el("label", "btn small", "Replace");
    replace.htmlFor = "pick-" + v;
    var remove = el("button", "btn small danger", "Remove");
    remove.type = "button";
    remove.addEventListener("click", function () { delete state.slots[v]; renderSlot(v); renderSummary(); });
    actions.append(replace, remove);
  }

  function renderAll() { VOICES.forEach(renderSlot); renderKit(); renderSummary(); }

  function drawWave(canvas, sound) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d"), cs = getComputedStyle(document.documentElement);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var n = sound.channels[0].length, per = Math.max(1, n / w), mid = h / 2;
    ctx.fillStyle = cs.getPropertyValue("--wave-dim").trim();
    ctx.fillRect(0, mid, w, 1);
    ctx.fillStyle = cs.getPropertyValue("--wave").trim();
    for (var x = 0; x < w; x++) {
      var a = Math.floor(x * per), b = Math.min(n, Math.floor((x + 1) * per)), lo = 0, hi = 0;
      for (var c = 0; c < sound.channels.length; c++) {
        var ch = sound.channels[c];
        for (var i = a; i < b; i++) { if (ch[i] < lo) lo = ch[i]; if (ch[i] > hi) hi = ch[i]; }
      }
      var top = mid - hi * (mid - 2), bottom = mid - lo * (mid - 2);
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }

  // ---------------------------------------------------------------- loading files

  var AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc|mp3|flac|ogg|oga|opus|m4a|aac|caf)$/i;
  function isAudioFile(f) { return AUDIO_EXT.test(f.name) && !Naming.isHidden(f.name); }

  function prepare(v) {
    var s = state.slots[v];
    if (!s || !s.sound) return;
    s.prepared = PDAudio.prepare(s.sound, { rate: state.opts.rate, trim: state.opts.trim, mono: state.opts.mono, normalise: state.opts.normalise });
  }

  function loadInto(v, file) {
    state.slots[v] = { fileName: file.name, busy: true };
    renderSlot(v);
    return file.arrayBuffer().then(PDAudio.decode).then(function (sound) {
      if (!sound.channels.length || !sound.channels[0].length) throw new Error("This file has no audio in it.");
      state.slots[v] = { fileName: file.name, sound: sound };
      prepare(v);
    }).catch(function (e) {
      state.slots[v] = { fileName: file.name, error: e.message || String(e) };
    }).then(function () { renderSlot(v); renderSummary(); });
  }

  // Many files at once: by name, the rest into free slots (as the plug-in assigns them).
  function loadMany(files, kitFolderName) {
    var audio = files.filter(isAudioFile);
    if (!audio.length) { setStatus("None of those are sound files.", "err"); return; }
    if (kitFolderName) {
      var k = Naming.parseKitFolder(kitFolderName);
      if (k) { state.number = k.number; state.name = k.name; renderKit(); savePrefs(); }
    }
    var names = audio.map(function (f) { return f.name; });
    var a = Naming.assign(names), used = 0;
    VOICES.forEach(function (v) { if (a[v] >= 0) { loadInto(v, audio[a[v]]); used++; } });
    var left = audio.length - used;
    setStatus(used + " sound" + (used === 1 ? "" : "s") + " placed" + (left > 0 ? "; " + left + " left over (more sounds than free slots, or a second sound for the same voice)." : "."), left > 0 ? "" : "ok");
  }

  // Files from a drop, including the contents of dropped folders.
  function filesFromDrop(dt) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
    if (!entries.length) return Promise.resolve(Array.prototype.slice.call(dt.files || []));
    var out = [];
    function walk(entry) {
      if (entry.isFile) return new Promise(function (res) { entry.file(function (f) { out.push(f); res(); }, function () { res(); }); });
      if (!entry.isDirectory) return Promise.resolve();
      var reader = entry.createReader();
      return new Promise(function (res) {
        var all = [];
        (function more() {
          reader.readEntries(function (batch) {
            if (!batch.length) Promise.all(all.map(walk)).then(res);
            else { all = all.concat(Array.prototype.slice.call(batch)); more(); }
          }, function () { res(); });
        })();
      });
    }
    return Promise.all(entries.map(walk)).then(function () {
      out.kitFolder = entries.length === 1 && entries[0].isDirectory ? entries[0].name : null;
      return out;
    });
  }

  // ---------------------------------------------------------------- playing

  var actx = null, playing = null;
  function playSound(sound) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!actx) actx = new Ctx();
    if (playing) { try { playing.stop(); } catch (e) {} }
    var buf = actx.createBuffer(sound.channels.length, sound.channels[0].length, sound.rate);
    sound.channels.forEach(function (c, i) { buf.copyToChannel ? buf.copyToChannel(c, i) : buf.getChannelData(i).set(c); });
    var src = actx.createBufferSource();
    src.buffer = buf; src.connect(actx.destination); src.start();
    playing = src;
  }

  // ---------------------------------------------------------------- kit and summary

  function renderKit() {
    if (document.activeElement !== els.number) els.number.value = state.number;
    if (document.activeElement !== els.name) els.name.value = state.name;
    els.nameCount.textContent = state.name.length + "/" + Naming.NAME_MAX;
    els.folder.textContent = folderName();
    els.numberHelp.textContent = state.number > 127
      ? "Program change only reaches kits 0–127, so the Performer can't select this kit by number."
      : "Program change " + state.number + " selects this kit, and the Performer's pattern " + Naming.pad3(state.number) + " plays it.";
    VOICES.forEach(function (v) { var t = $("slot-" + v).querySelector(".target"); t.textContent = Naming.fileFor(v, state.number); });
    els.optRate.checked = state.opts.rate === 48000;
    els.optTrim.checked = state.opts.trim;
    els.optMono.checked = state.opts.mono;
    els.optNorm.checked = state.opts.normalise;
  }

  function readySlots() { return VOICES.filter(function (v) { var s = state.slots[v]; return s && s.prepared; }); }
  function bytesOnCard() {
    return readySlots().reduce(function (sum, v) { var p = state.slots[v].prepared.sound; return sum + p.channels.length * p.channels[0].length * 2; }, 0);
  }

  function renderSummary() {
    var ready = readySlots(), bytes = bytesOnCard(), empty = VOICES.length - ready.length;
    els.summary.textContent = "";
    var a = el("span"); a.append(el("b", null, ready.length + " of 8"), document.createTextNode(" slots filled"));
    var b = el("span"); b.append(el("b", null, fmtBytes(bytes)), document.createTextNode(" in the plug-in's memory"));
    els.summary.append(a, b);
    if (bytes > PLUGIN_MEMORY) els.summary.append(el("span", "pill warn", "More than the plug-in's 2 MB default: raise Sample memory in its specification, or long sounds get cut short"));
    if (!state.name) els.summary.append(el("span", "pill warn", "Give the kit a name"));
    else if (empty && ready.length) els.summary.append(el("span", "pill", empty + " empty slot" + (empty === 1 ? "" : "s") + ": those voices stay silent"));
    var can = ready.length > 0 && !!state.name;
    els.saveCard.disabled = !can || !window.showDirectoryPicker;
    els.saveZip.disabled = !can;
    els.saveCard.title = window.showDirectoryPicker ? "" : "Saving straight to a card needs Chrome or Edge. Use Download zip.";
  }

  // ---------------------------------------------------------------- saving

  function kitFiles() {
    return readySlots().map(function (v, i) {
      return { name: Naming.fileFor(v, state.number), bytes: PDAudio.encodeWav(state.slots[v].prepared.sound, state.slots[v].prepared.bits, 1 + i) };
    });
  }

  function askConfirm(text, yesLabel) {
    return new Promise(function (resolve) {
      els.confirm.textContent = "";
      var yes = el("button", "btn primary", yesLabel), no = el("button", "btn", "Cancel");
      yes.type = no.type = "button";
      yes.addEventListener("click", function () { els.confirm.hidden = true; resolve(true); });
      no.addEventListener("click", function () { els.confirm.hidden = true; resolve(false); });
      els.confirm.append(el("span", null, text), yes, no);
      els.confirm.hidden = false;
      yes.focus();
    });
  }

  function saveToCard() {
    var name = folderName();
    var parent;
    setStatus("Choose the card's samples folder (or a folder inside it).");
    window.showDirectoryPicker({ id: "pd-samples", mode: "readwrite" }).then(function (dir) {
      parent = dir;
      return dir.getDirectoryHandle(name).then(function (existing) { return existing; }, function () { return null; });
    }).then(function (existing) {
      if (!existing) return parent.getDirectoryHandle(name, { create: true });
      return askConfirm(name + " already exists in " + parent.name + ". Replace the sounds in it?", "Replace").then(function (ok) {
        if (!ok) throw { cancelled: true };
        var removals = [];
        var it = existing.values();
        function next() {
          return it.next().then(function (r) {
            if (r.done) return;
            if (r.value.kind === "file" && /\.wav$/i.test(r.value.name)) removals.push(existing.removeEntry(r.value.name));
            return next();
          });
        }
        return next().then(function () { return Promise.all(removals); }).then(function () { return existing; });
      });
    }).then(function (kitDir) {
      var files = kitFiles();
      setStatus("Writing " + files.length + " files…");
      return files.reduce(function (p, f) {
        return p.then(function () {
          return kitDir.getFileHandle(f.name, { create: true }).then(function (h) { return h.createWritable(); })
            .then(function (w) { return w.write(f.bytes).then(function () { return w.close(); }); });
        });
      }, Promise.resolve()).then(function () { return files.length; });
    }).then(function (n) {
      setStatus("Saved " + n + " sounds to " + parent.name + "/" + name + ". Put the card back in the NT and restart it to pick up the new kit.", "ok");
    }).catch(function (e) {
      if (e && (e.cancelled || e.name === "AbortError")) { setStatus("Nothing saved."); return; }
      setStatus("Couldn't save to the card: " + (e && e.message ? e.message : e) + ". Download zip works instead.", "err");
    });
  }

  function saveZip() {
    if (typeof JSZip === "undefined") { setStatus("The zip library didn't load. Check the connection and reload the page.", "err"); return; }
    var name = folderName(), zip = new JSZip(), dir = zip.folder(name);
    kitFiles().forEach(function (f) { dir.file(f.name, f.bytes); });
    setStatus("Making the zip…");
    zip.generateAsync({ type: "blob", compression: "STORE" }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name + ".zip";
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      setStatus("Downloaded " + name + ".zip. Unzip it and copy the " + name + " folder into the card's samples folder.", "ok");
    }, function (e) { setStatus("Couldn't make the zip: " + e.message, "err"); });
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    els.number.addEventListener("input", function () {
      var n = parseInt(els.number.value, 10);
      state.number = isNaN(n) ? 0 : Math.max(0, Math.min(999, n));
      renderKit(); savePrefs();
    });
    els.number.addEventListener("blur", renderKit);
    els.name.addEventListener("input", function () {
      var clean = Naming.cleanKitName(els.name.value);
      if (clean !== els.name.value) {
        var pos = Math.max(0, (els.name.selectionStart || 0) - (els.name.value.length - clean.length));
        els.name.value = clean;
        try { els.name.setSelectionRange(pos, pos); } catch (e) {}
      }
      state.name = clean; renderKit(); renderSummary(); savePrefs();
    });
    function optChanged() {
      state.opts = { rate: els.optRate.checked ? 48000 : 0, trim: els.optTrim.checked, mono: els.optMono.checked, normalise: els.optNorm.checked };
      VOICES.forEach(function (v) { prepare(v); });
      renderAll(); savePrefs();
    }
    [els.optRate, els.optTrim, els.optMono, els.optNorm].forEach(function (c) { c.addEventListener("change", optChanged); });

    $("pickMany").addEventListener("change", function (e) { loadMany(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
    $("pickFolder").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files), rel = files[0] && files[0].webkitRelativePath;
      loadMany(files, rel ? rel.split("/")[0] : null); e.target.value = "";
    });
    $("clearAll").addEventListener("click", function () { state.slots = {}; renderAll(); setStatus(""); });

    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      e.preventDefault();
      // the Patterns page handles its own drops; nothing lands on the hidden Kits page
      if (location.hash === "#patterns") return;
      filesFromDrop(e.dataTransfer).then(function (files) { loadMany(files, files.kitFolder); });
    });

    els.saveCard.addEventListener("click", saveToCard);
    els.saveZip.addEventListener("click", saveZip);
    window.addEventListener("resize", function () {
      VOICES.forEach(function (v) { var c = $("slot-" + v).querySelector("canvas"), s = state.slots[v]; if (c && s && s.prepared) drawWave(c, s.prepared.sound); });
    });
  }

  // for the Patterns page: the kit being built
  window.PDKits = {
    sounds: function () {
      var out = {};
      readySlots().forEach(function (v) { out[v] = state.slots[v].prepared.sound; });
      return out;
    },
    label: function () { return folderName(); },
  };

  loadPrefs();
  buildSlots();
  wire();
  renderAll();
})();
