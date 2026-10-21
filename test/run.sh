#!/bin/sh
# Runs the manager's tests with macOS's built-in JavaScript engine.
#   test/run.sh ["path/to/BY KIT"]
# With a kit folder, every WAV in it is also read and prepared.
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
LIST="${TMPDIR:-/tmp}/pd-manager-kitfiles.txt"
: > "$LIST"
if [ -n "$1" ]; then find "$1" -iname '*.wav' | sort > "$LIST"; fi
exec "$JSC" js/naming.js js/audio.js test/test.js -- "$LIST"
