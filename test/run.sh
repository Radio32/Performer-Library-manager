#!/bin/sh
# Runs the manager's tests with macOS's built-in JavaScript engine.
#   test/run.sh ["path/to/BY KIT" ["path/to/DRUMS.LIB" ["path/to/patterns-v2"]]]
# With a kit folder, every WAV in it is also read and prepared. With the Performer's DRUMS.LIB
# it is read and written back (it must come out byte for byte the same), and with the folder of
# the pattern pack's MIDI files each one is imported and compared with the library.
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
LIST="${TMPDIR:-/tmp}/pd-manager-kitfiles.txt"
: > "$LIST"
if [ -n "$1" ]; then find "$1" -iname '*.wav' | sort > "$LIST"; fi
exec "$JSC" js/naming.js js/audio.js js/drumlib.js test/test.js -- "$LIST" "$2" "$3"
