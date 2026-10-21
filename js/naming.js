/*
 * Kit and file naming for Performer Drums (see SPEC.md section 3 in the
 * Performer-Drums repository). Kept in step with src/kit.h there.
 */
"use strict";

var Naming = (function () {
  // The machine's order: slots, screen and filling of free voices.
  var VOICES = ["BD", "SNR", "CHH", "OHH", "CLP", "P1", "P2", "CYM"];

  var VOICE_TITLES = {
    BD: "Bass drum", SNR: "Snare", CHH: "Closed hi-hat", OHH: "Open hi-hat",
    CLP: "Clap", P1: "Percussion 1", P2: "Percussion 2", CYM: "Cymbal",
  };

  // The names the manager writes, as in the BY KIT kits: 1KIK-012.wav etc.
  var FILE_PREFIX = { BD: "1KIK", CLP: "2CLP", CHH: "3CHH", OHH: "4OHH", SNR: "5SNR", P1: "6PRC1", P2: "7PRC2", CYM: "8CYM" };

  // Longest first, so CHH wins over CH and PERC1 over P1 (as in kit.h).
  var ALIASES = [
    ["SHAKER", "P2"],
    ["PERC1", "P1"], ["PERC2", "P2"], ["SNARE", "SNR"], ["CRASH", "CYM"],
    ["KICK", "BD"], ["CLAP", "CLP"], ["PRC1", "P1"], ["PRC2", "P2"], ["RIDE", "CYM"],
    ["KIK", "BD"], ["SNR", "SNR"], ["CLP", "CLP"], ["CHH", "CHH"], ["OHH", "OHH"],
    ["TOM", "P1"], ["RIM", "P1"], ["COW", "P2"], ["CYM", "CYM"],
    ["BD", "BD"], ["SD", "SNR"], ["CP", "CLP"], ["HH", "CHH"], ["CH", "CHH"],
    ["OH", "OHH"], ["P1", "P1"], ["P2", "P2"],
  ];

  function aliasAt(s, i) {
    var up = s.toUpperCase();
    for (var k = 0; k < ALIASES.length; k++)
      if (up.substr(i, ALIASES[k][0].length) === ALIASES[k][0]) return ALIASES[k][1];
    return null;
  }

  // The voice a file name names, or null: at the start, after a leading
  // number ("1KIK-001"), or after '_' or '-'. The first position wins.
  function voiceForFileName(name) {
    if (!name) return null;
    var v = aliasAt(name, 0);
    if (v) return v;
    var i = 0;
    while (i < name.length && name[i] >= "0" && name[i] <= "9") i++;
    if (i > 0 && (v = aliasAt(name, i))) return v;
    for (i = 0; i < name.length; i++)
      if ((name[i] === "_" || name[i] === "-") && (v = aliasAt(name, i + 1))) return v;
    return null;
  }

  function isHidden(name) { return !name || name[0] === "_" || name[0] === "."; }

  function compareNoCase(a, b) {
    a = a.toUpperCase(); b = b.toUpperCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /*
   * Assigns file names to voices, as the plug-in does:
   * 1. a file that names a voice goes to it (first alphabetically wins);
   * 2. files naming no voice fill the free voices, alphabetically, in the
   *    machine's order. A file naming a voice never fills another one.
   * Returns { BD: index or -1, ... } into names.
   */
  function assign(names) {
    var out = {};
    VOICES.forEach(function (v) { out[v] = -1; });
    names.forEach(function (n, i) {
      if (isHidden(n)) return;
      var v = voiceForFileName(n);
      if (v && (out[v] < 0 || compareNoCase(n, names[out[v]]) < 0)) out[v] = i;
    });
    var free = names.map(function (n, i) { return i; })
      .filter(function (i) { return !isHidden(names[i]) && !voiceForFileName(names[i]); })
      .sort(function (a, b) { return compareNoCase(names[a], names[b]); });
    VOICES.forEach(function (v) { if (out[v] < 0 && free.length) out[v] = free.shift(); });
    return out;
  }

  function pad3(n) { return ("00" + n).slice(-3); }

  // Kit names: up to 8 characters; letters, digits and ! & + (no spaces).
  var NAME_MAX = 8;
  function cleanKitName(s) { return (s || "").replace(/[^A-Za-z0-9!&+]/g, "").slice(0, NAME_MAX); }
  function kitFolder(number, name) { return pad3(number) + "-" + cleanKitName(name).trim(); }
  function fileFor(voice, number) { return FILE_PREFIX[voice] + "-" + pad3(number) + ".wav"; }

  // "012-Sampling" -> { number: 12, name: "Sampling" }; null if it isn't a kit folder name
  function parseKitFolder(s) {
    var m = /^(\d{1,3})[-_ ](.*)$/.exec(s || "");
    return m ? { number: parseInt(m[1], 10), name: cleanKitName(m[2]) } : null;
  }

  return {
    VOICES: VOICES, VOICE_TITLES: VOICE_TITLES, FILE_PREFIX: FILE_PREFIX, NAME_MAX: NAME_MAX,
    voiceForFileName: voiceForFileName, isHidden: isHidden, assign: assign,
    cleanKitName: cleanKitName, kitFolder: kitFolder, fileFor: fileFor, parseKitFolder: parseKitFolder, pad3: pad3,
  };
})();

if (typeof module !== "undefined") module.exports = Naming;
