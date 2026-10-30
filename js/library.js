/*
 * The Library page: two panes, each with a phrase library of the Performer (bass, melody, drums,
 * progressions). Preview, select several, copy, cut, paste, duplicate, move and delete within a
 * pane and between the two; edit a phrase's name, style, tempo and key, and a progression's chords.
 */
"use strict";

(function () {
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function pad3(n) { return ("00" + n).slice(-3); }
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // ---------------------------------------------------------------- state

  function newPane(index) {
    return { index: index, kind: null, name: "", handle: null, phrases: [], sel: [], anchor: -1, cursor: -1,
             dirty: false, undo: [], redo: [], filter: "", status: "", statusKind: "",
             empty: [] };      // categories added that have no phrases yet (a file only stores those with phrases)
  }
  var panes = [newPane(0), newPane(1)];
  var active = 0;               // the pane keys act on
  var clipboard = null;         // { kind, phrases }

  function pane() { return panes[active]; }
  function compatible(a, b) {
    if (a === b) return true;
    var notes = { bass: 1, melody: 1 };
    return !!(notes[a] && notes[b]);
  }

  function snapshot(p) { return { phrases: p.phrases.slice(), sel: p.sel.slice(), cursor: p.cursor, empty: p.empty.slice() }; }
  function change(p, fn) {
    p.undo.push(snapshot(p));
    if (p.undo.length > 200) p.undo.shift();
    p.redo = [];
    fn();
    p.dirty = true;
  }
  function restore(p, from, to) {
    if (!from.length) return false;
    to.push(snapshot(p));
    var s = from.pop();
    p.phrases = s.phrases; p.sel = s.sel; p.cursor = s.cursor; p.empty = s.empty; p.dirty = true;
    return true;
  }

  function setStatus(p, text, kind) { p.status = text; p.statusKind = kind || ""; renderPaneStatus(p); }

  // ---------------------------------------------------------------- dialog

  function ask(text, yesLabel, withInput, value) {
    var box = $("dialog");
    return new Promise(function (resolve) {
      box.textContent = "";
      var input = null;
      var yes = el("button", "btn primary", yesLabel), no = el("button", "btn", "Cancel");
      yes.type = no.type = "button";
      function close(v) { box.hidden = true; document.removeEventListener("keydown", onKey, true); resolve(v); }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(withInput ? null : false); }
        if (e.key === "Enter") { e.preventDefault(); close(withInput ? input.value : true); }
      }
      yes.addEventListener("click", function () { close(withInput ? input.value : true); });
      no.addEventListener("click", function () { close(withInput ? null : false); });
      box.append(el("span", null, text));
      if (withInput) {
        input = el("input"); input.type = "text"; input.maxLength = PhraseLib.MAX_NAME; input.value = value || ""; input.spellcheck = false;
        box.append(input);
      }
      box.append(yes, no);
      box.hidden = false;
      document.addEventListener("keydown", onKey, true);
      (input || yes).focus();
      if (input) input.select();
    });
  }

  /* A category picked from a menu (or a new one typed in): resolves to its name, or null. */
  function chooseCategory(text, yesLabel, choices, extra) {
    var box = $("dialog");
    return new Promise(function (resolve) {
      box.textContent = "";
      var select = el("select"), input = el("input");
      choices.forEach(function (c) { var o = el("option", null, c); o.value = c; select.append(o); });
      (extra || []).forEach(function (c) { var o = el("option", null, c[1]); o.value = c[0]; select.append(o); });
      var neu = el("option", null, "A new category…"); neu.value = "\u0000new"; select.append(neu);
      input.type = "text"; input.maxLength = PhraseLib.MAX_NAME; input.spellcheck = false; input.placeholder = "Its name"; input.hidden = true;
      select.addEventListener("change", function () { input.hidden = select.value !== "\u0000new"; if (!input.hidden) input.focus(); });
      var yes = el("button", "btn primary", yesLabel), no = el("button", "btn", "Cancel");
      yes.type = no.type = "button";
      function value() { return select.value === "\u0000new" ? input.value.trim() || null : select.value; }
      function close(v) { box.hidden = true; document.removeEventListener("keydown", onKey, true); resolve(v); }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(null); }
        if (e.key === "Enter") { e.preventDefault(); close(value()); }
      }
      yes.addEventListener("click", function () { close(value()); });
      no.addEventListener("click", function () { close(null); });
      box.append(el("span", null, text), select, input, yes, no);
      box.hidden = false;
      document.addEventListener("keydown", onKey, true);
      select.focus();
    });
  }

  // ---------------------------------------------------------------- files

  function openBytes(p, bytes, name, handle) {
    var lib;
    try { lib = PhraseLib.read(bytes); } catch (e) { setStatus(p, e.message, "err"); return; }
    var go = function () {
      stop();
      Object.assign(p, newPane(p.index), { kind: lib.kind, name: name, handle: handle || null, phrases: lib.phrases });
      setStatus(p, "Opened " + name + ": " + lib.phrases.length + " " + PhraseLib.KIND_NAMES[lib.kind].toLowerCase() + " in " + PhraseLib.styleRuns(lib.phrases).length + " categories.", "ok");
      active = p.index;
      render();
    };
    if (p.dirty) {
      ask("The library in this pane has changes that aren't saved. Open the other one anyway?", "Open").then(function (ok) { if (ok) go(); });
    } else {
      go();
    }
  }

  function openFile(p) {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ id: "pl-library", types: [{ description: "Performer library", accept: { "application/octet-stream": [".LIB", ".lib"] } }] })
        .then(function (handles) {
          var h = handles[0];
          return h.getFile().then(function (f) { return f.arrayBuffer().then(function (b) { openBytes(p, new Uint8Array(b), f.name, h); }); });
        }).catch(function (e) { if (e && e.name !== "AbortError") setStatus(p, "Couldn't open it: " + e.message, "err"); });
    } else {
      var input = el("input"); input.type = "file"; input.accept = ".lib,.LIB";
      input.addEventListener("change", function () {
        var f = input.files[0]; if (!f) return;
        f.arrayBuffer().then(function (b) { openBytes(p, new Uint8Array(b), f.name, null); });
      });
      input.click();
    }
  }

  function saveFile(p) {
    if (!p.kind) return;
    var problem = PhraseLib.problems(p.kind, p.phrases);
    if (problem) { setStatus(p, "Not saved: " + problem, "err"); return; }
    var grouped = PhraseLib.groupStyles(p.phrases);
    var moved = grouped.some(function (x, i) { return x !== p.phrases[i]; });
    if (moved) {
      // keep the selection on the same phrases
      var selected = p.sel.map(function (i) { return p.phrases[i]; });
      change(p, function () { p.phrases = grouped; });
      p.sel = selected.map(function (x) { return grouped.indexOf(x); }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
    }
    var dropped = p.empty.filter(function (c) { return !p.phrases.some(function (x) { return x.style === c; }); });
    p.empty = [];
    var bytes = PhraseLib.write(p.kind, p.phrases);
    var fileName = PhraseLib.FILE_NAMES[p.kind];
    function done(where) {
      p.dirty = false;
      setStatus(p, "Saved " + p.phrases.length + " phrases to " + where + "." + (moved ? " Each category's phrases are together now." : "") +
        (dropped.length ? " Left out the empty " + (dropped.length === 1 ? "category " : "categories ") + dropped.join(", ") + "." : ""), "ok");
      render();
    }
    function download() {
      var a = el("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      a.download = fileName;
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      done("a downloaded " + fileName + " (copy it into the card's LIBRARY folder)");
    }
    function writeTo(h) {
      return h.createWritable().then(function (w) { return w.write(bytes).then(function () { return w.close(); }); })
        .then(function () { p.handle = h; p.name = h.name; done(h.name); });
    }
    if (p.handle && p.handle.createWritable) {
      writeTo(p.handle).catch(function (e) { setStatus(p, "Couldn't save in place (" + e.message + "). Downloading it instead.", "err"); download(); });
    } else if (window.showSaveFilePicker) {
      window.showSaveFilePicker({ id: "pl-library", suggestedName: fileName }).then(writeTo)
        .catch(function (e) { if (e && e.name === "AbortError") setStatus(p, "Nothing saved."); else download(); });
    } else {
      download();
    }
  }

  // ---------------------------------------------------------------- selection

  function visible(p) {
    var f = p.filter.trim().toLowerCase();
    var out = [];
    p.phrases.forEach(function (x, i) {
      if (!f || x.title.toLowerCase().indexOf(f) >= 0 || x.style.toLowerCase().indexOf(f) >= 0) out.push(i);
    });
    return out;
  }
  function setSel(p, list) {
    p.sel = list.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }
  function clickRow(p, i, e) {
    active = p.index;
    var vis = visible(p);
    if (e.shiftKey && p.anchor >= 0) {
      var a = vis.indexOf(p.anchor), b = vis.indexOf(i);
      if (a < 0) a = b;
      var range = vis.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSel(p, (e.metaKey || e.ctrlKey) ? p.sel.concat(range) : range);
    } else if (e.metaKey || e.ctrlKey) {
      setSel(p, p.sel.indexOf(i) >= 0 ? p.sel.filter(function (x) { return x !== i; }) : p.sel.concat([i]));
      p.anchor = i;
    } else {
      setSel(p, [i]);
      p.anchor = i;
    }
    p.cursor = i;
    render();
  }
  function selectStyle(p, style, e) {
    active = p.index;
    var all = visible(p).filter(function (i) { return p.phrases[i].style === style; });
    setSel(p, (e.metaKey || e.ctrlKey || e.shiftKey) ? p.sel.concat(all) : all);
    p.anchor = all[0]; p.cursor = all[0];
    render();
  }
  function moveCursor(p, d, extend) {
    var vis = visible(p);
    if (!vis.length) return;
    var at = vis.indexOf(p.cursor);
    var next = vis[Math.max(0, Math.min(vis.length - 1, at < 0 ? 0 : at + d))];
    if (extend && p.anchor >= 0) {
      var a = vis.indexOf(p.anchor), b = vis.indexOf(next);
      setSel(p, vis.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      setSel(p, [next]); p.anchor = next;
    }
    p.cursor = next;
    render();
    var row = document.querySelector('[data-pane="' + p.index + '"] [data-i="' + next + '"]');
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  // ---------------------------------------------------------------- edits

  function copy(p, cut) {
    if (!p.sel.length) { setStatus(p, "Select phrases first."); return; }
    clipboard = { kind: p.kind, phrases: p.sel.map(function (i) { return PhraseLib.clone(p.phrases[i]); }) };
    if (cut) {
      var n = p.sel.length;
      removeSelected(p);
      setStatus(p, "Cut " + n + ". Paste them here or in the other library (" + (isMac ? "⌘" : "Ctrl+") + "V).");
    } else {
      setStatus(p, "Copied " + clipboard.phrases.length + ".");
    }
    renderToolbars();
  }

  function paste(p) {
    if (!clipboard) { setStatus(p, "Nothing copied yet."); return; }
    if (!p.kind) { setStatus(p, "Open a library in this pane first.", "err"); return; }
    if (!compatible(clipboard.kind, p.kind)) {
      setStatus(p, PhraseLib.KIND_NAMES[clipboard.kind] + " can't go into a library of " + PhraseLib.KIND_NAMES[p.kind].toLowerCase() + ".", "err");
      return;
    }
    var at = p.sel.length ? p.sel[p.sel.length - 1] + 1 : p.phrases.length;
    var style = p.sel.length ? p.phrases[p.sel[p.sel.length - 1]].style : null;
    var items = clipboard.phrases.map(function (x) { var c = PhraseLib.clone(x); if (style) c.style = style; return c; });
    change(p, function () {
      p.phrases = p.phrases.slice(0, at).concat(items, p.phrases.slice(at));
      setSel(p, items.map(function (x, k) { return at + k; }));
      p.anchor = at; p.cursor = at;
    });
    setStatus(p, "Pasted " + items.length + (style ? " into " + style : " at the end") + ".", "ok");
    render();
  }

  function duplicate(p) {
    if (!p.sel.length) return;
    change(p, function () {
      var out = [], sel = [];
      p.phrases.forEach(function (x, i) {
        out.push(x);
        if (p.sel.indexOf(i) >= 0) { var c = PhraseLib.clone(x); out.push(c); sel.push(out.length - 1); }
      });
      p.phrases = out; p.sel = sel; p.cursor = sel[0]; p.anchor = sel[0];
    });
    setStatus(p, "Duplicated " + p.sel.length + ".");
    render();
  }

  function removeSelected(p) {
    if (!p.sel.length) return;
    var n = p.sel.length, first = p.sel[0];
    change(p, function () {
      p.phrases = p.phrases.filter(function (x, i) { return p.sel.indexOf(i) < 0; });
      var next = Math.min(first, p.phrases.length - 1);
      p.sel = next >= 0 ? [next] : []; p.cursor = next; p.anchor = next;
    });
    setStatus(p, "Deleted " + n + ". " + (isMac ? "⌘" : "Ctrl+") + "Z brings them back.");
    render();
  }

  function moveSelected(p, d) {
    if (!p.sel.length) return;
    var sel = p.sel;
    if ((d < 0 && sel[0] === 0) || (d > 0 && sel[sel.length - 1] === p.phrases.length - 1)) return;
    change(p, function () {
      var arr = p.phrases.slice(), set = {};
      sel.forEach(function (i) { set[i] = true; });
      var order = d < 0 ? sel : sel.slice().reverse();
      order.forEach(function (i) {
        var j = i + d, t = arr[j]; arr[j] = arr[i]; arr[i] = t;
      });
      // a phrase moved past the edge of its style joins the neighbouring one
      var moved = sel.map(function (i) { return i + d; });
      moved.forEach(function (j) {
        var before = arr[j - 1], after = arr[j + 1];
        if (before && after && before.style === after.style && arr[j].style !== before.style) {
          arr[j] = Object.assign(PhraseLib.clone(arr[j]), { style: before.style });
        }
      });
      p.phrases = arr; p.sel = moved; p.cursor = p.cursor + d; p.anchor = p.anchor + d;
    });
    render();
  }

  /* The categories in their order: as the phrases have them, then the empty ones. */
  function categories(p) {
    var out = [];
    p.phrases.forEach(function (x) { if (out.indexOf(x.style) < 0) out.push(x.style); });
    p.empty.forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function categoryCount(p, c) { return p.phrases.filter(function (x) { return x.style === c; }).length; }

  /* Moves phrases (indices) into a category: after its last phrase (at the end when it has none). */
  function moveToCategory(p, indices, cat) {
    var moving = indices.map(function (i) { return Object.assign(PhraseLib.clone(p.phrases[i]), { style: cat }); });
    var rest = p.phrases.filter(function (x, i) { return indices.indexOf(i) < 0; });
    var at = rest.length;
    for (var i = rest.length - 1; i >= 0; i--) if (rest[i].style === cat) { at = i + 1; break; }
    p.phrases = rest.slice(0, at).concat(moving, rest.slice(at));
    p.empty = p.empty.filter(function (c) { return c !== cat; });
    p.sel = moving.map(function (x, k) { return at + k; });
    p.cursor = at; p.anchor = at;
  }

  function renamePhrase(p) {
    if (p.sel.length !== 1) { setStatus(p, "Select one phrase to rename it."); return; }
    var i = p.sel[0];
    ask("Rename the phrase:", "Rename", true, p.phrases[i].title).then(function (name) {
      name = (name || "").trim();
      if (!name || name === p.phrases[i].title) return;
      change(p, function () {
        p.phrases = p.phrases.slice();
        p.phrases[i] = Object.assign(PhraseLib.clone(p.phrases[i]), { title: name });
      });
      render();
    });
  }

  function moveSelectedTo(p) {
    if (!p.sel.length) return;
    var current = p.phrases[p.sel[0]].style;
    var cats = categories(p).filter(function (c) { return c !== current; });
    chooseCategory("Move the " + (p.sel.length === 1 ? "phrase" : p.sel.length + " phrases") + " to:", "Move", cats).then(function (cat) {
      if (!cat) return;
      if (categories(p).indexOf(cat) < 0 && categories(p).length >= PhraseLib.MAX_STYLES) {
        setStatus(p, "The Performer browses up to " + PhraseLib.MAX_STYLES + " categories; this library has them all.", "err");
        return;
      }
      var n = p.sel.length;
      change(p, function () { moveToCategory(p, p.sel, cat); });
      setStatus(p, "Moved " + n + " to " + cat + ".", "ok");
      render();
    });
  }

  function addCategory(p) {
    if (!p.kind) return;
    if (categories(p).length >= PhraseLib.MAX_STYLES) {
      setStatus(p, "The Performer browses up to " + PhraseLib.MAX_STYLES + " categories; this library has them all.", "err");
      return;
    }
    ask("A new category:", "Add", true, "").then(function (name) {
      name = (name || "").trim();
      if (!name) return;
      if (categories(p).indexOf(name) >= 0) { setStatus(p, "There is a category " + name + " already.", "err"); return; }
      change(p, function () { p.empty = p.empty.concat([name]); });
      setStatus(p, "Added " + name + ". Move phrases into it with Move to… (a category with no phrases isn't saved).", "ok");
      render();
    });
  }

  function renameStyle(p, style) {
    ask("Rename the category " + style + " to:", "Rename", true, style).then(function (name) {
      name = (name || "").trim();
      if (!name || name === style) return;
      var merge = categories(p).indexOf(name) >= 0;
      change(p, function () {
        p.phrases = p.phrases.map(function (x) { return x.style === style ? Object.assign(PhraseLib.clone(x), { style: name }) : x; });
        p.empty = p.empty.map(function (c) { return c === style ? name : c; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
        if (merge) p.phrases = PhraseLib.groupStyles(p.phrases);
      });
      setStatus(p, merge ? style + " joined " + name + "." : "Renamed " + style + " to " + name + ".", "ok");
      render();
    });
  }

  function deleteCategory(p, style) {
    var n = categoryCount(p, style);
    if (!n) {
      change(p, function () { p.empty = p.empty.filter(function (c) { return c !== style; }); });
      setStatus(p, "Deleted the empty category " + style + ".");
      render();
      return;
    }
    var others = categories(p).filter(function (c) { return c !== style; });
    var DELETE = "\u0000delete";
    chooseCategory("Delete the category " + style + ". Its " + n + " phrases:", "Delete category",
      others.map(function (c) { return c; }), [[DELETE, "Delete them too"]]).then(function (target) {
      if (!target) return;
      var idx = [];
      p.phrases.forEach(function (x, i) { if (x.style === style) idx.push(i); });
      change(p, function () {
        if (target === DELETE) {
          p.phrases = p.phrases.filter(function (x) { return x.style !== style; });
          p.sel = []; p.cursor = -1; p.anchor = -1;
        } else {
          moveToCategory(p, idx, target);
        }
        p.empty = p.empty.filter(function (c) { return c !== style; });
      });
      setStatus(p, target === DELETE ? "Deleted " + style + " and its " + n + " phrases. " + (isMac ? "⌘" : "Ctrl+") + "Z brings them back." :
        "Deleted " + style + "; its " + n + " phrases are in " + target + ".", "ok");
      render();
    });
  }

  /* A category one place up or down in the library (with all its phrases). */
  function moveCategory(p, style, d) {
    var cats = categories(p), i = cats.indexOf(style), j = i + d;
    if (i < 0 || j < 0 || j >= cats.length) return;
    cats[i] = cats[j]; cats[j] = style;
    change(p, function () {
      var selected = p.sel.map(function (k) { return p.phrases[k]; });
      p.phrases = cats.reduce(function (out, c) { return out.concat(p.phrases.filter(function (x) { return x.style === c; })); }, []);
      p.empty = cats.filter(function (c) { return p.empty.indexOf(c) >= 0; });
      p.sel = selected.map(function (x) { return p.phrases.indexOf(x); }).sort(function (a, b) { return a - b; });
    });
    render();
  }

  function undo(p) { if (restore(p, p.undo, p.redo)) render(); }
  function redo(p) { if (restore(p, p.redo, p.undo)) render(); }

  /* A detail field's edit: replaces the phrase (one undo step per field while it has focus). */
  var editKey = null;
  function editPhrase(p, i, fn, key) {
    var next = PhraseLib.clone(p.phrases[i]);
    fn(next);
    if (key !== editKey || !key) {
      change(p, function () {});
      editKey = key;
    }
    p.phrases = p.phrases.slice();
    p.phrases[i] = next;
    p.dirty = true;
    renderPaneList(p);
    renderPaneHead(p);
  }

  // ---------------------------------------------------------------- audio

  var ctx = null, playing = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  /* Plays a phrase once; the detail preview shows where it is. */
  function play(kind, x) {
    stop();
    var c = audio(), out = c.createGain();
    out.gain.value = 0.7; out.connect(c.destination);
    var stepSec = 60 / Math.max(40, x.bpm || 120) / 4, t0 = c.currentTime + 0.05, total = 0;
    if (kind === "progs") {
      var at = 0;
      PhraseLib.readSlots(x).forEach(function (s) {
        var dur = s.steps * stepSec;
        PhraseLib.chordPitches(s).forEach(function (pitch, k) { PDSynth.chordTone(c, out, t0 + at, dur, pitch, k); });
        at += dur;
      });
      total = at;
    } else if (kind === "drums") {
      var d = PhraseLib.readLanes(x), steps = x.bars * 16;
      PhraseLib.DRUM_VOICES.forEach(function (v) {
        for (var s = 0; s < steps; s++) if (d.lanes[v][s]) PDSynth.drum(c, out, t0 + s * stepSec, v, d.accents[v][s]);
      });
      total = steps * stepSec;
    } else {
      PhraseLib.readNotes(x).forEach(function (n) {
        (kind === "bass" ? PDSynth.bass : PDSynth.lead)(c, out, t0 + n.start / 8 * stepSec, Math.max(0.04, n.length / 8 * stepSec), PhraseLib.notePitch(x, n), n.accent);
      });
      total = x.bars * 16 * stepSec;
    }
    playing = { out: out, t0: t0, total: total, x: x, stepSec: stepSec };
    tick();
    renderToolbars();
  }
  function stop() {
    if (!playing) return;
    var out = playing.out;
    try { out.gain.setTargetAtTime(0, ctx.currentTime, 0.02); } catch (e) { /* ignore */ }
    setTimeout(function () { out.disconnect(); }, 200);
    playing = null;
    drawDetailPreview();
    renderToolbars();
  }
  function tick() {
    if (!playing) return;
    if (ctx.currentTime - playing.t0 > playing.total + 0.1) { stop(); return; }
    drawDetailPreview();
    requestAnimationFrame(tick);
  }
  function playCursor(p) {
    if (playing) { stop(); return; }
    var i = p.cursor >= 0 ? p.cursor : p.sel[0];
    if (i == null || i < 0 || !p.phrases[i]) return;
    play(p.kind, p.phrases[i]);
  }

  // ---------------------------------------------------------------- drawing previews

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawPhrase(canvas, kind, x, playhead) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    var g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    var fg = css("--wave"), dim = css("--wave-dim"), acc = css("--accent");
    if (kind === "progs") {
      var slots = PhraseLib.readSlots(x), total = slots.reduce(function (n, s) { return n + s.steps; }, 0) || 1, at = 0;
      slots.forEach(function (s, k) {
        var x0 = at / total * w, x1 = (at + s.steps) / total * w;
        g.fillStyle = k % 2 ? dim : fg; g.globalAlpha = k % 2 ? 0.55 : 0.18;
        g.fillRect(x0, 0, x1 - x0 - 1, h);
        g.globalAlpha = 1;
        if (h >= 24 && x1 - x0 > 26) {
          g.fillStyle = fg; g.font = (h >= 60 ? 15 : 11) + "px " + css("--font-mono");
          g.fillText(PhraseLib.chordName(s), x0 + 4, h >= 60 ? 22 : 14);
        }
        at += s.steps;
      });
      if (playhead != null) { g.fillStyle = acc; g.fillRect(playhead / total * w, 0, 2, h); }
      return;
    }
    var steps = Math.max(16, x.bars * 16);
    // bar lines
    g.fillStyle = dim; g.globalAlpha = 0.5;
    for (var b = 1; b < steps / 16; b++) g.fillRect(b * 16 / steps * w, 0, 1, h);
    g.globalAlpha = 1;
    if (kind === "drums") {
      var d = PhraseLib.readLanes(x), lh = h / 8;
      PhraseLib.DRUM_VOICES.forEach(function (v, li) {
        for (var s = 0; s < steps; s++) {
          if (!d.lanes[v][s]) continue;
          g.fillStyle = d.accents[v][s] ? acc : fg;
          g.fillRect(s / steps * w + 0.5, li * lh + 0.5, Math.max(1, w / steps - 1), Math.max(1, lh - 1));
        }
      });
    } else {
      var notes = PhraseLib.readNotes(x);
      if (notes.length) {
        var ps = notes.map(function (n) { return n.rel; }), lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
        var span = Math.max(12, hi - lo + 1), nh = Math.max(3, h / span);
        notes.forEach(function (n) {
          g.fillStyle = n.accent ? acc : fg;
          var y = h - (n.rel - lo + 1) / span * h;
          g.fillRect(n.start / 8 / steps * w, y, Math.max(2, n.length / 8 / steps * w - 0.5), Math.min(nh, h / 5));
        });
      }
    }
    if (playhead != null) { g.fillStyle = acc; g.fillRect(playhead / steps * w, 0, 2, h); }
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    panes.forEach(function (p) { renderPaneHead(p); renderPaneList(p); renderPaneStatus(p); });
    renderToolbars();
    renderDetail();
  }

  function buildPanes() {
    var root = $("panes");
    panes.forEach(function (p) {
      var s = el("section", "lpane");
      s.dataset.pane = p.index;
      s.setAttribute("aria-label", "Library " + "AB"[p.index]);
      s.innerHTML =
        '<div class="lpane-head"><div class="lpane-title"><h2>' + "AB"[p.index] + '</h2><span class="lpane-file"></span></div>' +
        '<div class="btnrow"><button class="btn small" data-act="undo" type="button" aria-label="Undo" title="Undo">↶</button>' +
        '<button class="btn small" data-act="redo" type="button" aria-label="Redo" title="Redo">↷</button>' +
        '<button class="btn small" data-act="open" type="button">Open…</button>' +
        '<button class="btn small primary" data-act="save" type="button">Save</button></div></div>' +
        '<div class="ltools btnrow">' +
        '<button class="btn small" data-act="play" type="button">▶ Play</button>' +
        '<button class="btn small" data-act="copy" type="button">Copy</button>' +
        '<button class="btn small" data-act="cut" type="button">Cut</button>' +
        '<button class="btn small" data-act="paste" type="button">Paste</button>' +
        '<button class="btn small" data-act="dup" type="button" title="Duplicate (⌘D)">Dup</button>' +
        '<button class="btn small" data-act="up" type="button" aria-label="Move up">↑</button>' +
        '<button class="btn small" data-act="down" type="button" aria-label="Move down">↓</button>' +
        '<button class="btn small" data-act="rename" type="button">Rename…</button>' +
        '<button class="btn small" data-act="moveto" type="button">Move to…</button>' +
        '<button class="btn small danger" data-act="del" type="button">Delete</button></div>' +
        '<details class="lcats"><summary><span class="lcats-title">Categories</span></summary><div class="lcats-body"></div></details>' +
        '<div class="lfilter"><input type="search" placeholder="Find a name or category" spellcheck="false"><span class="help lcount"></span></div>' +
        '<ol class="llist" tabindex="0"></ol>' +
        '<p class="status lstatus" role="status" aria-live="polite"></p>';
      root.append(s);
      var acts = {
        open: function () { openFile(p); }, save: function () { saveFile(p); }, play: function () { playCursor(p); },
        copy: function () { copy(p, false); }, cut: function () { copy(p, true); }, paste: function () { paste(p); },
        dup: function () { duplicate(p); }, up: function () { moveSelected(p, -1); }, down: function () { moveSelected(p, 1); },
        rename: function () { renamePhrase(p); }, moveto: function () { moveSelectedTo(p); }, addcat: function () { addCategory(p); }, del: function () { removeSelected(p); }, undo: function () { undo(p); }, redo: function () { redo(p); },
      };
      s.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (b && acts[b.dataset.act]) { active = p.index; acts[b.dataset.act](); renderToolbars(); }
      });
      s.addEventListener("mousedown", function () { if (active !== p.index) { active = p.index; renderToolbars(); } });
      s.querySelector(".lfilter input").addEventListener("input", function () { p.filter = this.value; renderPaneList(p); });
      // drop a library file on the pane
      s.addEventListener("dragover", function (e) { e.preventDefault(); s.classList.add("over"); });
      s.addEventListener("dragleave", function () { s.classList.remove("over"); });
      s.addEventListener("drop", function (e) {
        e.preventDefault(); s.classList.remove("over");
        var f = e.dataTransfer.files[0];
        if (f) f.arrayBuffer().then(function (b) { openBytes(p, new Uint8Array(b), f.name, null); });
      });
    });
  }

  function paneEl(p) { return document.querySelector('.lpane[data-pane="' + p.index + '"]'); }

  function renderPaneHead(p) {
    var s = paneEl(p), file = s.querySelector(".lpane-file");
    file.textContent = p.kind ? p.name + " · " + PhraseLib.KIND_NAMES[p.kind] + (p.dirty ? " · not saved" : "") : "No library open";
    file.classList.toggle("dirty", p.dirty);
    s.classList.toggle("active", p.index === active);
    var runs = p.kind ? PhraseLib.styleRuns(PhraseLib.groupStyles(p.phrases)) : [];
    s.querySelector(".lcount").textContent = p.kind ? p.phrases.length + " phrases · " + runs.length + "/" + PhraseLib.MAX_STYLES + " categories" + (p.sel.length > 1 ? " · " + p.sel.length + " selected" : "") : "";
  }
  function renderPaneStatus(p) {
    var st = paneEl(p).querySelector(".lstatus");
    st.textContent = p.status;
    st.className = "status lstatus" + (p.statusKind ? " " + p.statusKind : "");
  }

  function meta(kind, x) {
    if (kind === "progs") {
      var slots = PhraseLib.readSlots(x);
      return slots.slice(0, 8).map(PhraseLib.chordName).join(" ") + (slots.length > 8 ? " …" : "");
    }
    return x.bars + (x.bars === 1 ? " bar" : " bars") + " · " + PhraseLib.keyName(x) + " · " + x.bpm;
  }

  function renderPaneList(p) {
    var s = paneEl(p), list = s.querySelector(".llist");
    list.textContent = "";
    if (!p.kind) {
      renderCategories(p);
      var empty = el("li", "lempty");
      empty.append(el("span", null, "Open a library from the card's LIBRARY folder, or drop a .LIB file here."));
      list.append(empty);
      return;
    }
    var vis = visible(p), lastStyle = null, seen = {};
    vis.forEach(function (i) {
      var x = p.phrases[i];
      if (x.style !== lastStyle) {
        var head = el("li", "lstyle");
        var name = el("button", "lstyle-name", x.style);
        name.type = "button";
        name.title = "Select the category (double-click: rename it)";
        var again = seen[x.style];
        if (again) name.title = "This category also comes earlier; saving puts its phrases together";
        name.addEventListener("click", function (e) { selectStyle(p, x.style, e); });
        name.addEventListener("dblclick", function () { renameStyle(p, x.style); });
        head.append(name);
        if (again) head.append(el("span", "pill warn", "again"));
        list.append(head);
        lastStyle = x.style; seen[x.style] = true;
      }
      var li = el("li", "lrow" + (p.sel.indexOf(i) >= 0 ? " on" : "") + (i === p.cursor ? " cursor" : ""));
      li.dataset.i = i;
      li.append(el("span", "lno", pad3(i)));
      var t = el("span", "lname", x.title); li.append(t);
      li.append(el("span", "lmeta", meta(p.kind, x)));
      if (p.kind !== "progs") {
        var cv = el("canvas", "lmini"); li.append(cv);
      }
      li.addEventListener("mousedown", function (e) { if (e.shiftKey || e.metaKey || e.ctrlKey) e.preventDefault(); });
      li.addEventListener("click", function (e) { clickRow(p, i, e); });
      li.addEventListener("dblclick", function () { renamePhrase(p); });
      list.append(li);
    });
    if (!vis.length && !p.empty.length) list.append(el("li", "lempty", "Nothing matches."));
    // the categories added that have no phrases yet
    p.empty.forEach(function (c) {
      var head = el("li", "lstyle");
      var name = el("button", "lstyle-name", c); name.type = "button"; name.title = "Double-click: rename it";
      name.addEventListener("dblclick", function () { renameStyle(p, c); });
      head.append(name, el("span", "pill", "empty"));
      list.append(head);
      list.append(el("li", "lempty", "No phrases yet: select some and use Move to…"));
    });
    renderCategories(p);
    // the small previews, once laid out
    requestAnimationFrame(function () {
      list.querySelectorAll(".lrow").forEach(function (li) {
        var cv = li.querySelector("canvas");
        if (cv) drawPhrase(cv, p.kind, p.phrases[+li.dataset.i]);
      });
    });
  }

  function renderCategories(p) {
    var s = paneEl(p), body = s.querySelector(".lcats-body"), cats = p.kind ? categories(p) : [];
    s.querySelector(".lcats").hidden = !p.kind;
    s.querySelector(".lcats-title").textContent = "Categories (" + cats.length + "/" + PhraseLib.MAX_STYLES + ")";
    body.textContent = "";
    cats.forEach(function (c, k) {
      var row = el("div", "lcat");
      var name = el("button", "lcat-name", c); name.type = "button"; name.title = "Select its phrases";
      name.addEventListener("click", function (e) { selectStyle(p, c, e); });
      row.append(name, el("span", "help", String(categoryCount(p, c))));
      [["↑", -1, "Move the category up"], ["↓", 1, "Move the category down"]].forEach(function (m) {
        var b = el("button", "btn small", m[0]); b.type = "button"; b.title = m[2]; b.setAttribute("aria-label", m[2]);
        b.disabled = (m[1] < 0 && k === 0) || (m[1] > 0 && k === cats.length - 1);
        b.addEventListener("click", function () { active = p.index; moveCategory(p, c, m[1]); });
        row.append(b);
      });
      var rn = el("button", "btn small", "Rename"); rn.type = "button";
      rn.addEventListener("click", function () { active = p.index; renameStyle(p, c); });
      var del = el("button", "btn small danger", "Delete"); del.type = "button";
      del.addEventListener("click", function () { active = p.index; deleteCategory(p, c); });
      row.append(rn, del);
      body.append(row);
    });
    var add = el("button", "btn small", "+ Category"); add.type = "button";
    add.disabled = cats.length >= PhraseLib.MAX_STYLES;
    add.addEventListener("click", function () { active = p.index; addCategory(p); });
    body.append(add);
  }

  function renderToolbars() {
    panes.forEach(function (p) {
      var s = paneEl(p), has = !!p.kind, sel = p.sel.length > 0;
      s.classList.toggle("active", p.index === active);
      var set = function (act, on) { var b = s.querySelector('[data-act="' + act + '"]'); if (b) b.disabled = !on; };
      set("save", has && p.phrases.length > 0);
      ["copy", "cut", "dup", "del", "up", "down", "moveto"].forEach(function (a) { set(a, has && sel); });
      set("rename", has && p.sel.length === 1);
      set("play", has && (sel || p.cursor >= 0));
      set("paste", has && !!clipboard && compatible(clipboard.kind, p.kind));
      set("undo", p.undo.length > 0); set("redo", p.redo.length > 0);
      var pb = s.querySelector('[data-act="play"]');
      pb.textContent = playing ? "■ Stop" : "▶ Play";
    });
  }

  // ---------------------------------------------------------------- detail

  var detailCanvas = null;
  function detailTarget() {
    var p = pane();
    if (!p.kind || p.sel.length !== 1) return null;
    return { p: p, i: p.sel[0], x: p.phrases[p.sel[0]] };
  }

  function drawDetailPreview() {
    var d = detailTarget();
    if (!detailCanvas || !d) return;
    var head = null;
    if (playing && playing.x === d.x) head = (ctx.currentTime - playing.t0) / playing.stepSec;
    drawPhrase(detailCanvas, d.p.kind, d.x, head != null && head >= 0 ? head : null);
  }

  function field(label, input) {
    var f = el("div", "field"), l = el("label", null, label);
    f.append(l, input);
    return f;
  }

  function renderDetail() {
    var box = $("detail"), d = detailTarget();
    editKey = null;
    if (!d) {
      var p = pane();
      box.hidden = !p.kind;
      box.textContent = "";
      if (p.kind) box.append(el("p", "help", p.sel.length > 1 ? p.sel.length + " phrases selected. Select one to see it and edit it." : "Select a phrase to see it and edit it."));
      detailCanvas = null;
      return;
    }
    box.hidden = false;
    box.textContent = "";
    var x = d.x, kind = d.p.kind;
    var head = el("div", "ldetail-head");
    head.append(el("h2", null, "AB"[d.p.index] + " · " + pad3(d.i) + "  " + x.title));
    var pl = el("button", "btn primary", playing && playing.x === x ? "■ Stop" : "▶ Play");
    pl.type = "button";
    pl.addEventListener("click", function () { if (playing) stop(); else play(kind, d.p.phrases[d.i]); renderDetail(); });
    head.append(pl);
    box.append(head);

    var fields = el("div", "pfields");
    var name = el("input"); name.type = "text"; name.maxLength = PhraseLib.MAX_NAME; name.value = x.title; name.spellcheck = false;
    name.addEventListener("input", function () { var v = this.value; editPhrase(d.p, d.i, function (q) { q.title = v; }, "title"); head.querySelector("h2").textContent = "AB"[d.p.index] + " · " + pad3(d.i) + "  " + v; });
    fields.append(field("Name", name));
    var style = el("input"); style.type = "text"; style.maxLength = PhraseLib.MAX_NAME; style.value = x.style; style.spellcheck = false;
    style.addEventListener("change", function () {
      var v = this.value.trim();
      if (!v || v === d.p.phrases[d.i].style) return;
      change(d.p, function () { moveToCategory(d.p, [d.i], v); });
      render();
    });
    fields.append(field("Category", style));
    var bpm = el("input"); bpm.type = "number"; bpm.min = 40; bpm.max = 255; bpm.value = x.bpm;
    bpm.addEventListener("change", function () { var v = Math.max(40, Math.min(255, +this.value || 120)); editPhrase(d.p, d.i, function (q) { q.bpm = v; }, "bpm"); });
    var f = field("Tempo", bpm); f.classList.add("small"); fields.append(f);
    if (kind !== "progs") {
      var swing = el("input"); swing.type = "number"; swing.min = 50; swing.max = 75; swing.value = x.swing;
      swing.addEventListener("change", function () { var v = Math.max(50, Math.min(75, +this.value || 50)); editPhrase(d.p, d.i, function (q) { q.swing = v; }, "swing"); });
      f = field("Swing %", swing); f.classList.add("small"); fields.append(f);
    }
    if (!(x.key & 0x80)) {
      var key = el("select");
      PhraseLib.NOTE.forEach(function (n, k) {
        [0, 1].forEach(function (minor) {
          var o = el("option", null, n + (minor ? " minor" : " major")); o.value = k + minor * 16; key.append(o);
        });
      });
      key.value = (x.key & 0x0f) + (x.key & 0x10);
      key.addEventListener("change", function () { var v = +this.value; editPhrase(d.p, d.i, function (q) { q.key = (q.key & 0xe0) | v; }, "key"); });
      f = field("Key", key); fields.append(f);
    } else {
      fields.append(field("Key", el("span", "help", "Chord tones (saved from the Performer)")));
    }
    box.append(fields);

    detailCanvas = el("canvas", "lbig" + (kind === "drums" ? " drums" : ""));
    box.append(detailCanvas);
    if (kind === "drums") box.append(el("p", "help", "Lanes from the top: " + PhraseLib.DRUM_VOICES.join(" ") + ". Accents in yellow. The drum patterns' steps are edited on the Patterns page."));
    if (kind === "bass" || kind === "melody") box.append(el("p", "help", "Notes from the phrase's key; accents in yellow. " + (x.key & 0x40 ? "A bass line written over the tonic: on a Bass track its notes become chord tones." : "")));
    if (kind === "progs") box.append(progEditor(d));
    requestAnimationFrame(drawDetailPreview);
  }

  // ---------------------------------------------------------------- the progression editor

  var LENGTHS = [[4, "1 beat"], [8, "2 beats"], [12, "3 beats"], [16, "1 bar"], [24, "1½ bars"], [32, "2 bars"], [48, "3 bars"],
                 [64, "4 bars"], [96, "6 bars"], [128, "8 bars"], [192, "12 bars"], [256, "16 bars"]];
  var VOICINGS = [[-3, "−3 (lower)"], [-2, "−2"], [-1, "−1"], [0, "root position"], [1, "1st inversion"], [2, "2nd inversion"], [3, "3rd inversion"]];

  function progEditor(d) {
    var wrap = el("div", "pedit"), slots = PhraseLib.readSlots(d.x);
    function commit(next, key) {
      editPhrase(d.p, d.i, function (q) {
        var w = PhraseLib.writeSlots(q, next);
        q.body = w.body; q.bars = w.bars;
      }, key);
      d.x = d.p.phrases[d.i];
      slots = PhraseLib.readSlots(d.x);
      renderCards();
      drawDetailPreview();
    }
    var bar = el("div", "btnrow pedit-bar");
    var total = el("span", "help");
    function updateTotal() {
      var steps = slots.reduce(function (n, s) { return n + s.steps; }, 0);
      total.textContent = slots.length + "/" + PhraseLib.MAX_SLOTS + " chords · " + (steps / 16) + " bars" +
        (slots.some(function (s) { return PhraseLib.SIMPLE_TYPES.indexOf(s.type) < 0; }) ? " · has chords that aren't simple (triads, sus4, 7ths)" : "");
    }
    [["−1 st", -1], ["+1 st", 1]].forEach(function (t) {
      var b = el("button", "btn small", "Transpose " + t[0]); b.type = "button";
      b.addEventListener("click", function () { commit(slots.map(function (s) { return Object.assign({}, s, { root: (s.root + t[1] + 12) % 12 }); }), null); });
      bar.append(b);
    });
    var add = el("button", "btn small", "+ Chord"); add.type = "button";
    add.addEventListener("click", function () {
      if (slots.length >= PhraseLib.MAX_SLOTS) return;
      var last = slots[slots.length - 1] || { root: 0, type: 0, voicing: 0, steps: 16 };
      commit(slots.concat([{ root: last.root, type: last.type, voicing: 0, steps: last.steps, colour: null }]), null);
    });
    var plain = el("button", "btn small", "All plain chords"); plain.type = "button";
    plain.title = "Forget every voicing as played in the MIDI file: the chords play as the conductor voices them";
    plain.addEventListener("click", function () { commit(slots.map(function (s) { return Object.assign({}, s, { colour: null }); }), null); });
    bar.append(add, plain, total);
    wrap.append(bar);
    var cards = el("div", "pcards");
    wrap.append(cards);
    wrap.append(el("p", "help", "A chord's voicing as played (from the MIDI file) is what the arp and the conductor's MIDI chord play; changing the chord's root or type drops it, and it plays as the conductor voices it. Transposing keeps it."));

    function sel(options, value, onChange) {
      var s = el("select");
      options.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; s.append(op); });
      s.value = value;
      s.addEventListener("change", function () { onChange(+this.value); });
      return s;
    }
    function renderCards() {
      cards.textContent = "";
      updateTotal();
      slots.forEach(function (s, k) {
        var c = el("div", "pcard");
        var top = el("div", "pcard-top");
        top.append(el("span", "pcard-no", String(k + 1)), el("b", "pcard-name", PhraseLib.chordName(s)));
        var hear = el("button", "btn small", "▶"); hear.type = "button"; hear.setAttribute("aria-label", "Hear the chord");
        hear.addEventListener("click", function () {
          stop();
          var ac = audio(), out = ac.createGain(); out.gain.value = 0.7; out.connect(ac.destination);
          PhraseLib.chordPitches(s).forEach(function (pitch, j) { PDSynth.chordTone(ac, out, ac.currentTime + 0.02, 1.2, pitch, j); });
        });
        top.append(hear);
        c.append(top);
        var rootOpts = PhraseLib.NOTE.map(function (n, r) { return [r, n]; });
        var typeOpts = PhraseLib.SIMPLE_TYPES.map(function (t) { return [t, PhraseLib.CHORD_TYPES[t][0] || "maj"]; })
          .concat(PhraseLib.CHORD_TYPES.map(function (t, i) { return [i, (t[0] || "maj") + " (not simple)"]; }).filter(function (o) { return PhraseLib.SIMPLE_TYPES.indexOf(o[0]) < 0; }));
        function upd(fn, key, dropColour) {
          var next = slots.map(function (x) { return Object.assign({}, x); });
          fn(next[k]);
          if (dropColour) next[k].colour = null;
          commit(next, key);
        }
        var row = el("div", "pcard-fields");
        row.append(sel(rootOpts, s.root, function (v) { upd(function (x) { x.root = v; }, null, true); }));
        row.append(sel(typeOpts, s.type, function (v) { upd(function (x) { x.type = v; }, null, true); }));
        c.append(row);
        var lens = LENGTHS.slice();
        if (!lens.some(function (l) { return l[0] === s.steps; })) lens.push([s.steps, s.steps + " steps"]);
        lens.sort(function (a, b) { return a[0] - b[0]; });
        c.append(sel(lens, s.steps, function (v) { upd(function (x) { x.steps = v; }, null, false); }));
        c.append(sel(VOICINGS, s.voicing, function (v) { upd(function (x) { x.voicing = v; }, null, false); }));
        if (s.colour) {
          var cl = el("div", "pcard-colour");
          var ref = 60 + (s.root > 6 ? s.root - 12 : s.root);
          var noteName = function (m) { return PhraseLib.NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
          cl.append(el("span", "help", "As played: " + [ref + s.colour.bass].concat(s.colour.tones.map(function (t) { return ref + t; })).map(noteName).join(" ")));
          var x = el("button", "btn small", "Plain"); x.type = "button"; x.title = "Play it as the conductor voices it";
          x.addEventListener("click", function () { upd(function () {}, null, true); });
          cl.append(x);
          c.append(cl);
        }
        var acts = el("div", "btnrow pcard-acts");
        [["◀", -1, "Move left"], ["▶", 1, "Move right"]].forEach(function (m) {
          var b = el("button", "btn small", m[0]); b.type = "button"; b.setAttribute("aria-label", m[2]);
          b.disabled = (m[1] < 0 && k === 0) || (m[1] > 0 && k === slots.length - 1);
          b.addEventListener("click", function () {
            var next = slots.slice(), j = k + m[1], t = next[j]; next[j] = next[k]; next[k] = t;
            commit(next, null);
          });
          acts.append(b);
        });
        var dup = el("button", "btn small", "Dup"); dup.type = "button"; dup.disabled = slots.length >= PhraseLib.MAX_SLOTS;
        dup.addEventListener("click", function () { var next = slots.slice(); next.splice(k + 1, 0, Object.assign({}, s)); commit(next, null); });
        var del = el("button", "btn small danger", "Del"); del.type = "button"; del.disabled = slots.length <= 1;
        del.addEventListener("click", function () { var next = slots.slice(); next.splice(k, 1); commit(next, null); });
        acts.append(dup, del);
        c.append(acts);
        cards.append(c);
      });
    }
    renderCards();
    return wrap;
  }

  // ---------------------------------------------------------------- keys

  document.addEventListener("keydown", function (e) {
    if (!$("dialog").hidden) return;
    var t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    if (typing) return;
    var p = pane(), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    var handled = true;
    if (mod && k === "c") copy(p, false);
    else if (mod && k === "x") copy(p, true);
    else if (mod && k === "v") paste(p);
    else if (mod && k === "d") duplicate(p);
    else if (mod && k === "a") { setSel(p, visible(p)); render(); }
    else if (mod && k === "z" && e.shiftKey) redo(p);
    else if (mod && k === "z") undo(p);
    else if (mod && k === "y") redo(p);
    else if (mod && k === "s") saveFile(p);
    else if (k === "backspace" || k === "delete") removeSelected(p);
    else if (k === " ") playCursor(p);
    else if (k === "enter") renamePhrase(p);
    else if (e.altKey && k === "arrowup") moveSelected(p, -1);
    else if (e.altKey && k === "arrowdown") moveSelected(p, 1);
    else if (k === "arrowup") moveCursor(p, -1, e.shiftKey);
    else if (k === "arrowdown") moveCursor(p, 1, e.shiftKey);
    else if (k === "tab" && !mod && !e.shiftKey && panes[1 - active].kind) { active = 1 - active; render(); }
    else handled = false;
    if (handled) e.preventDefault();
  });

  window.addEventListener("beforeunload", function (e) {
    if (panes.some(function (p) { return p.dirty; })) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("resize", function () { render(); });

  // for the browser console and the tests: open library bytes in a pane
  window.PDLibrary = {
    open: function (pane, bytes, name) { openBytes(panes[pane], bytes, name || "LIBRARY.LIB", null); },
  };

  buildPanes();
  render();
})();
