/*
 * Controller: a map of the Novation Launch Control XL 3 for the Conducting Performer.
 * Each control gets a job (a function, and for per-track, per-voice... jobs, which one).
 * Encoders and faders take values, buttons take actions. The map is kept in localStorage,
 * copied as text, or saved as a JSON file (XL3MAP.JSN) for the Performer's SD card.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- the controls

  var CONTROLS = [];
  for (var r = 1; r <= 3; r++) for (var c = 1; c <= 8; c++) CONTROLS.push({ id: "E" + r + "-" + c, kind: "value", group: "enc", name: "Encoder row " + r + ", " + c, short: "E" + r + "." + c });
  for (var f = 1; f <= 8; f++) CONTROLS.push({ id: "F" + f, kind: "value", group: "fader", name: "Fader " + f, short: "F" + f });
  for (var b = 1; b <= 2; b++) for (var c2 = 1; c2 <= 8; c2++) CONTROLS.push({ id: "B" + b + "-" + c2, kind: "action", group: "btn", name: "Button row " + b + ", " + c2, short: "B" + b + "." + c2 });
  var SIDE = [["PGUP", "Page ▲"], ["PGDN", "Page ▼"], ["TRKL", "Track ◀"], ["TRKR", "Track ▶"], ["FN1", "Function 1"], ["FN2", "Function 2"], ["PLAY", "Play"], ["REC", "Record"]];
  SIDE.forEach(function (s) { CONTROLS.push({ id: s[0], kind: "action", group: "side", name: s[1], short: s[1] }); });
  var byId = {};
  CONTROLS.forEach(function (k) { byId[k.id] = k; });

  // ---------------------------------------------------------------- the jobs

  var PER = {
    track: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"],
    voice: ["BD", "SNR", "CLP", "CHH", "OHH", "P1", "P2", "CYM"],
    lfo: ["LFO 1", "LFO 2", "LFO 3", "LFO 4"],
    slot: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"],
    repeat: ["1/4", "1/8", "1/16", "1/32", "1/4T", "1/8T", "1/16T", "1/32T"]
  };
  var CATS = {
    perform: "Perform",
    conductor: "Conductor",
    tracks: "Tracks",
    drums: "Drums",
    mod: "Modulation",
    transport: "Transport"
  };
  // id, category, kind (value | action), name, per (which), note
  var FNS = [
    ["perf.key", "perform", "value", "Key (circle of fifths)", null, "A fifth per step, at the launch timing."],
    ["perf.morph", "perform", "value", "Morph", null, "Drums into the next entry, following tracks toward the next chord."],
    ["perf.tension", "perform", "value", "Tension", null, "Sevenths, ninths and more chord jumps."],
    ["perf.harmony", "perform", "value", "Harmony (complexity)", null, "Down: triads, and notes move to chord tones and roots."],
    ["perf.drums", "perform", "value", "Drums (complexity)", null, "Down: the strongest voices on the strongest beats."],
    ["perf.fill", "perform", "action", "Drum fill (hold)", "slot", "The drums play that slot while held."],
    ["perf.repeat", "perform", "action", "Beat repeat (hold)", "repeat", "Every track repeats while held."],
    ["perf.capture", "perform", "action", "Capture", null, "What plays, into a free pattern."],
    ["cond.next", "conductor", "action", "Next chord", null, "At the trigger timing (conductor SETUP)."],
    ["cond.group", "conductor", "action", "Next group", null, "The next loop group or HOLD slot."],
    ["cond.swing", "conductor", "value", "Swing", null, ""],
    ["cond.tempo", "conductor", "value", "Tempo", null, ""],
    ["cond.jump", "conductor", "value", "Chord jump", null, ""],
    ["cond.colour", "conductor", "value", "Chord colour", null, "Triads, as written, sevenths, ninths."],
    ["cond.voicing", "conductor", "value", "Voicing", null, ""],
    ["trk.warp", "tracks", "value", "Warp", "track", ""],
    ["trk.density", "tracks", "value", "Density", "track", ""],
    ["trk.magnet", "tracks", "value", "Magnet", "track", ""],
    ["trk.octave", "tracks", "value", "Octave", "track", ""],
    ["trk.transpose", "tracks", "value", "Transpose", "track", ""],
    ["trk.rotate", "tracks", "value", "Rotate", "track", ""],
    ["trk.gate", "tracks", "value", "Gate probability", "track", ""],
    ["trk.note", "tracks", "value", "Note probability", "track", ""],
    ["trk.length", "tracks", "value", "Gate length", "track", ""],
    ["trk.mute", "tracks", "action", "Mute", "track", "A press toggles."],
    ["trk.solo", "tracks", "action", "Solo", "track", ""],
    ["trk.select", "tracks", "action", "Select", "track", "The track the Performer's pages show."],
    ["trk.prev", "tracks", "action", "Select previous track", null, ""],
    ["trk.next", "tracks", "action", "Select next track", null, ""],
    ["drm.chance", "drums", "value", "Voice chance", "voice", "T3: how often the voice's hits play."],
    ["drm.slot", "drums", "value", "Voice slot", "voice", "Follow, or slot 1-16 (a variation)."],
    ["drm.density", "drums", "value", "Drum density", null, ""],
    ["drm.fillamount", "drums", "value", "Drum fill amount", null, ""],
    ["drm.mute", "drums", "action", "Voice mute", "voice", ""],
    ["drm.next", "drums", "action", "Drum list: next entry", null, ""],
    ["drm.list", "drums", "action", "Drum list on/off", null, ""],
    ["mod.rate", "mod", "value", "LFO rate", "lfo", ""],
    ["mod.shape", "mod", "value", "LFO shape", "lfo", ""],
    ["mod.phase", "mod", "value", "LFO phase", "lfo", ""],
    ["tr.play", "transport", "action", "Play / stop", null, ""],
    ["tr.record", "transport", "action", "Record", null, ""],
    ["tr.tap", "transport", "action", "Tap tempo", null, ""]
  ];
  var fnById = {};
  FNS.forEach(function (x) { fnById[x[0]] = { id: x[0], cat: x[1], kind: x[2], name: x[3], per: x[4], note: x[5] }; });

  // ---------------------------------------------------------------- the map

  var KEY = "pd-xl3-map-1";
  var map = {};
  try { map = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { map = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* the page works without it */ } }

  function suggested() {
    var m = {};
    var row1 = ["perf.key", "perf.morph", "perf.tension", "perf.harmony", "perf.drums", "cond.swing", "cond.tempo", "cond.jump"];
    row1.forEach(function (fn, i) { m["E1-" + (i + 1)] = { fn: fn, index: 0 }; });
    for (var i = 0; i < 8; i++) {
      m["E2-" + (i + 1)] = { fn: "trk.warp", index: i };
      m["E3-" + (i + 1)] = { fn: "drm.chance", index: i };
      m["F" + (i + 1)] = { fn: "trk.density", index: i };
      m["B1-" + (i + 1)] = { fn: "trk.mute", index: i };
      m["B2-" + (i + 1)] = { fn: "drm.mute", index: i };
    }
    m.PGUP = { fn: "cond.group", index: 0 };
    m.PGDN = { fn: "cond.next", index: 0 };
    m.TRKL = { fn: "trk.prev", index: 0 };
    m.TRKR = { fn: "trk.next", index: 0 };
    m.FN1 = { fn: "perf.capture", index: 0 };
    m.FN2 = { fn: "drm.next", index: 0 };
    m.PLAY = { fn: "tr.play", index: 0 };
    m.REC = { fn: "tr.record", index: 0 };
    return m;
  }
  if (!Object.keys(map).length) map = suggested();

  function label(entry, short) {
    if (!entry || !fnById[entry.fn]) return "";
    var fn = fnById[entry.fn];
    var which = fn.per ? PER[fn.per][entry.index] : "";
    if (short) {
      var n = fn.name.replace(/ \(.*\)$/, "");
      return which ? which + " " + n : n;
    }
    return fn.name + (which ? " · " + (fn.per === "slot" ? "slot " + which : fn.per === "repeat" ? which : which) : "");
  }

  // ---------------------------------------------------------------- drawing

  var selected = null;

  function controlEl(k) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "xl-ctl xl-" + k.group;
    el.dataset.id = k.id;
    el.setAttribute("aria-label", k.name);
    var face = document.createElement("span");
    face.className = "xl-face";
    var cap = document.createElement("span");
    cap.className = "xl-cap";
    el.append(face, cap);
    el.addEventListener("click", function () { select(k.id); });
    return el;
  }

  function build() {
    var enc = $("xlEncoders"), fad = $("xlFaders"), btn = $("xlButtons"), side = $("xlSide");
    CONTROLS.forEach(function (k) {
      var el = controlEl(k);
      (k.group === "enc" ? enc : k.group === "fader" ? fad : k.group === "btn" ? btn : side).append(el);
    });
    var legend = $("xlLegend");
    Object.keys(CATS).forEach(function (cat) {
      var s = document.createElement("span");
      s.className = "xl-chip";
      s.dataset.cat = cat;
      s.textContent = CATS[cat];
      legend.append(s);
    });
  }

  function render() {
    CONTROLS.forEach(function (k) {
      var el = document.querySelector('.xl-ctl[data-id="' + k.id + '"]');
      var entry = map[k.id];
      var fn = entry && fnById[entry.fn];
      el.dataset.cat = fn ? fn.cat : "";
      el.classList.toggle("on", k.id === selected);
      el.querySelector(".xl-cap").textContent = fn ? label(entry, true) : (k.group === "side" ? k.short : "");
      el.title = k.name + (fn ? ": " + label(entry) : ": nothing");
    });
    var k = byId[selected];
    $("xlOled").innerHTML = "";
    var l1 = document.createElement("div"), l2 = document.createElement("div");
    l1.textContent = k ? k.short.toUpperCase() : "PERFORMER";
    l2.textContent = k ? (map[k.id] ? label(map[k.id]).toUpperCase() : "—") : "PICK A CONTROL";
    $("xlOled").append(l1, l2);
    renderEditor();
    renderTable();
  }

  function renderEditor() {
    var k = byId[selected], fnSel = $("xlFn"), idxSel = $("xlIndex");
    fnSel.innerHTML = "";
    if (!k) {
      fnSel.disabled = true; $("xlClear").disabled = true; $("xlIndexLabel").hidden = true;
      return;
    }
    $("xlTitle").textContent = k.name;
    $("xlKind").textContent = k.kind === "value" ? "Turns a value." : "A press does something" + (k.group === "side" ? " (check in Novation Components that a custom mode can use this button)." : ".");
    fnSel.disabled = false; $("xlClear").disabled = false;
    var none = document.createElement("option");
    none.value = ""; none.textContent = "Nothing";
    fnSel.append(none);
    Object.keys(CATS).forEach(function (cat) {
      var g = document.createElement("optgroup");
      g.label = CATS[cat];
      FNS.forEach(function (x) {
        var fn = fnById[x[0]];
        if (fn.cat !== cat || fn.kind !== k.kind) return;
        var o = document.createElement("option");
        o.value = fn.id; o.textContent = fn.name;
        g.append(o);
      });
      if (g.children.length) fnSel.append(g);
    });
    var entry = map[k.id];
    fnSel.value = entry ? entry.fn : "";
    var fn = entry && fnById[entry.fn];
    $("xlIndexLabel").hidden = !(fn && fn.per);
    idxSel.innerHTML = "";
    if (fn && fn.per) {
      PER[fn.per].forEach(function (name, i) {
        var o = document.createElement("option");
        o.value = String(i); o.textContent = fn.per === "slot" ? "Slot " + name : name;
        idxSel.append(o);
      });
      idxSel.value = String(entry.index || 0);
    }
    $("xlNote").textContent = fn ? fn.note : "";
  }

  function renderTable() {
    var t = $("xlTable");
    t.innerHTML = "";
    var head = document.createElement("tr");
    ["Control", "Does"].forEach(function (h) { var th = document.createElement("th"); th.textContent = h; head.append(th); });
    t.append(head);
    CONTROLS.forEach(function (k) {
      var tr = document.createElement("tr");
      if (k.id === selected) tr.className = "on";
      var a = document.createElement("td"), b2 = document.createElement("td");
      a.textContent = k.name;
      b2.textContent = map[k.id] ? label(map[k.id]) : "—";
      if (map[k.id] && fnById[map[k.id].fn]) b2.dataset.cat = fnById[map[k.id].fn].cat;
      tr.append(a, b2);
      tr.addEventListener("click", function () { select(k.id); });
      t.append(tr);
    });
  }

  function select(id) { selected = id; render(); }

  // ---------------------------------------------------------------- editing

  $("xlFn").addEventListener("change", function () {
    if (!selected) return;
    var v = $("xlFn").value;
    if (v) map[selected] = { fn: v, index: 0 }; else delete map[selected];
    save(); render();
  });
  $("xlIndex").addEventListener("change", function () {
    if (!selected || !map[selected]) return;
    map[selected].index = parseInt($("xlIndex").value, 10) || 0;
    save(); render();
  });
  $("xlClear").addEventListener("click", function () {
    if (!selected) return;
    delete map[selected]; save(); render();
  });

  function ask(question, yes) {
    var box = $("xlConfirm");
    box.innerHTML = "";
    var p = document.createElement("span"); p.textContent = question;
    var ok = document.createElement("button"); ok.className = "btn small danger"; ok.textContent = "Yes";
    var no = document.createElement("button"); no.className = "btn small"; no.textContent = "Cancel";
    ok.addEventListener("click", function () { box.hidden = true; yes(); });
    no.addEventListener("click", function () { box.hidden = true; });
    box.append(p, ok, no);
    box.hidden = false;
  }
  $("xlSuggest").addEventListener("click", function () {
    ask("Replace the whole map with the suggested layout?", function () { map = suggested(); save(); render(); status("The suggested layout is in."); });
  });
  $("xlClearAll").addEventListener("click", function () {
    ask("Clear every control?", function () { map = {}; save(); render(); status("Every control is clear."); });
  });

  function status(text) { $("xlStatus").textContent = text; }

  function asText() {
    var lines = ["LAUNCH CONTROL XL 3 MAP (Conducting Performer)", ""];
    var groups = { enc: "Encoders", fader: "Faders", btn: "Buttons", side: "Side buttons" };
    Object.keys(groups).forEach(function (g) {
      lines.push(groups[g] + ":");
      CONTROLS.forEach(function (k) {
        if (k.group !== g) return;
        lines.push("  " + k.short + "  " + (map[k.id] ? label(map[k.id]) : "-"));
      });
      lines.push("");
    });
    return lines.join("\n");
  }
  $("xlCopy").addEventListener("click", function () {
    var text = asText(), box = $("xlText");
    box.value = text; box.hidden = false;
    function fallback() { box.focus(); box.select(); status("The map is selected below: copy it with Cmd+C."); }
    try {
      navigator.clipboard.writeText(text).then(function () { status("Copied. Paste it wherever you like."); }, fallback);
    } catch (e) { fallback(); }
  });
  $("xlSave").addEventListener("click", function () {
    var data = { format: "conducting-performer-xl3-map", version: 1, controls: map };
    var blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "XL3MAP.JSN";
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    status("Saved as XL3MAP.JSN. The Performer will read it from the SD card once the firmware supports the XL 3.");
  });

  build();
  render();

  window.PDController = { map: function () { return map; }, select: select, text: asText };
})();
