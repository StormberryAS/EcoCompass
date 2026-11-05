#!/usr/bin/env bash
# Compile EcoCompass's TypeScript (ts/) into the JavaScript the page loads.
#
# Copied on 5 November 2026 from SolarFlare's tools/build-ts.sh (itself from WeatherWhisper's,
# MeteorWatch's, AstroQuiz's, GDPRLetterBuilder's, EclipseTracker's and the Website's). Changed for
# EcoCompass: one source, ts/app.ts, which compiles to app.js. EcoCompass has no ES modules:
# index.html loads suncalc.js, cities.js and app.js as classic scripts that share one global scope,
# as in SunApp.
# ts/suncalc.d.ts types suncalc.js, the vendored SunCalc 1.8.0, and ts/cities.d.ts types cities.js,
# the shared Labs city catalogue, which SunApp's update_cities.py writes. These two and gate.js, the
# first-run notice, which build-gates.py at the root of the GitHub folder writes, are vendored or
# generator output kept byte for byte, and the only other JavaScript allowed at the root.
#
#   tools/build-ts.sh           install the pinned compiler, compile ts/app.ts into app.js at the
#                               repository root, then run bump_assets.py so the page carries the
#                               current ?v= stamps
#   tools/build-ts.sh --force   the same, but overwrite app.js even when it holds a hand edit
#   tools/build-ts.sh --check   change nothing: fail when app.js is missing, is not tracked by git
#                               (in a git checkout), or is not (stamps aside) byte for byte what
#                               ts/app.ts compiles to; when the root holds a .js that no source
#                               compiles to, other than the vendored suncalc.js and the generated
#                               cities.js and gate.js; or when a page carries a stale ?v=
#
# Stamps. bump_assets.py stamps the page's src and href with each file's hash (?v=...). app.js
# imports nothing, but every comparison below strips a stamp from a relative import first
# ("normalised"), as in the other Labs apps, so a stamped import would not read as a hand edit.
# bump_assets.py --check then proves the page's stamps are current.
#
# Every mode first type-checks, and writes nothing when one fails:
#   * the tests (tests/*.ts, run by Node 24 directly) with tests/tsconfig.json, strict.
#   * ts/ with tsconfig.json, strict, which also emits.
#
# The compiled .js files are committed on purpose: GitHub Pages publishes the repository's files as
# they are, with no build step of its own. Edit the TypeScript, never the .js. .gitattributes marks
# app.js linguist-generated (with cities.js and gate.js), and suncalc.js linguist-vendored.
#
# Hand edits. A build never overwrites a compiled .js silently. It writes only when the .js now on
# disk, normalised, is one some TypeScript source produced: what the committed sources (HEAD)
# compile to, what the current sources compile to, or what this script wrote last time. Anything
# else is an edit made in the .js itself: the build stops and writes nothing. Port the edit into
# the TypeScript and build again, or rerun with --force to drop it. The record of the last build
# lives in the git directory (build-ts.last), so it is never committed or published; outside a git
# checkout it is .build-ts.last at the root, a dot file that Pages never publishes.
#
# The compiler is the exact version in package-lock.json, installed with `npm ci` (a frozen install)
# and with install scripts off. Needs Node 24 and npm, python3, and git only for the HEAD record
# and the tracked-file check (both are skipped outside a git checkout).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$#:${1:-}" in
  0:)        MODE=build ;;
  1:--force) MODE=force ;;
  1:--check) MODE=check ;;
  *)         echo "usage: $0 [--check | --force]" >&2; exit 2 ;;
esac

die() { echo "build-ts: $*" >&2; exit 1; }
command -v node >/dev/null || die "node not found"
command -v npm >/dev/null || die "npm not found"
command -v python3 >/dev/null || die "python3 not found"
GIT=0
if command -v git >/dev/null && [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$ROOT" ]; then GIT=1; fi

npm ci --ignore-scripts --no-audit --no-fund --prefer-offline --loglevel=error >/dev/null \
  || die "npm ci failed (package.json and package-lock.json must agree; nothing was compiled)"
TSC=(node "$ROOT/node_modules/typescript/bin/tsc")
echo "build-ts: TypeScript $("${TSC[@]}" --version | sed 's/^Version //')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A relative import with its ?v= stamp removed: from './x.js?v=0123abcd' to from './x.js'.
normalise() { sed -E "s#(['\"]\\.{1,2}/[^'\"?]+\\.js)\\?v=[0-9a-f]{8}(['\"])#\\1\\2#g" "$1"; }
nsha() { normalise "$1" | sha256sum | cut -d' ' -f1; }

"${TSC[@]}" -p "$ROOT/tests/tsconfig.json" || die "the tests (tests/*.ts) do not type-check; nothing was written"
"${TSC[@]}" -p "$ROOT/tsconfig.json" --outDir "$tmp/out" || die "ts/ does not compile; nothing was written"

mapfile -t OUTPUTS < <(cd "$tmp/out" && find . -type f -printf '%P\n' | LC_ALL=C sort)
mapfile -t EXPECTED < <(cd ts && find . -type f -name '*.ts' ! -name '*.d.ts' -printf '%P\n' | sed 's/\.ts$/.js/' | LC_ALL=C sort)
[ "${#OUTPUTS[@]}" -gt 0 ] || die "tsc emitted nothing"
[ "${OUTPUTS[*]}" = "${EXPECTED[*]}" ] \
  || die "tsc emitted [${OUTPUTS[*]}] but ts/ holds sources for [${EXPECTED[*]}]; look at tsconfig.json"

# The JavaScript at the root that is not compiled from ts/: the vendored suncalc.js and the
# generator output cities.js and gate.js (tests/build.test.ts holds all three to their hashes).
# Nothing else may sit beside the compiled file.
NOT_COMPILED=(suncalc.js cities.js gate.js)

# "./$1": a path that git reads as a path, whatever it starts with.
tracked() { [ "$GIT" = 1 ] && git ls-files --error-unmatch "./$1" >/dev/null 2>&1; }

if [ "$MODE" = check ]; then
  bad=0
  [ "$GIT" = 1 ] || echo "build-ts: not a git checkout; skipping the tracked-file check"
  for f in "${OUTPUTS[@]}"; do
    if [ ! -f "$f" ]; then
      echo "build-ts: $f is missing: run tools/build-ts.sh" >&2; bad=1
    elif [ "$(nsha "$f")" != "$(nsha "$tmp/out/$f")" ]; then
      echo "build-ts: $f is NOT what ts/${f%.js}.ts compiles to: edit ts/${f%.js}.ts, then run tools/build-ts.sh" >&2; bad=1
    elif [ "$GIT" = 1 ] && ! tracked "$f"; then
      echo "build-ts: $f is what ts/${f%.js}.ts compiles to but is not tracked by git: git add it" >&2; bad=1
    else
      echo "build-ts: $f matches ts/${f%.js}.ts"
    fi
  done
  # JavaScript with no source: the root holds only what the TypeScript compiles to, suncalc.js,
  # cities.js and gate.js.
  mapfile -t PRESENT < <(find . -maxdepth 1 -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -printf '%P\n' | LC_ALL=C sort)
  for f in "${PRESENT[@]}"; do
    case " ${OUTPUTS[*]} ${NOT_COMPILED[*]} " in
      *" $f "*) ;;
      *) echo "build-ts: $f is JavaScript that no TypeScript source compiles to: delete it, or restore its source" >&2; bad=1 ;;
    esac
  done
  python3 -I "$ROOT/bump_assets.py" --check || bad=1
  [ "$bad" = 0 ] || exit 1
  echo "build-ts: check passed"
  exit 0
fi

if [ "$GIT" = 1 ]; then STATE="$(git rev-parse --absolute-git-dir)/build-ts.last"; else STATE="$ROOT/.build-ts.last"; fi

if [ "$MODE" = build ]; then
  if [ "$GIT" = 1 ] && git cat-file -e HEAD:tsconfig.json 2>/dev/null && git cat-file -e HEAD:ts 2>/dev/null; then
    mkdir -p "$tmp/head"
    git archive HEAD tsconfig.json ts | tar -x -C "$tmp/head"
    "${TSC[@]}" -p "$tmp/head/tsconfig.json" --outDir "$tmp/head-out" >/dev/null 2>&1 || true
  fi
  hand=()
  for f in "${OUTPUTS[@]}"; do
    [ -f "$f" ] || continue
    cur="$(nsha "$f")"
    [ "$cur" = "$(nsha "$tmp/out/$f")" ] && continue
    [ -f "$tmp/head-out/$f" ] && [ "$cur" = "$(nsha "$tmp/head-out/$f")" ] && continue
    [ -f "$STATE" ] && grep -qxF "$cur  $f" "$STATE" && continue
    hand+=("$f")
  done
  if [ "${#hand[@]}" -gt 0 ]; then
    for f in "${hand[@]}"; do
      echo "build-ts: $f holds changes that no TypeScript source produced (edited by hand?)" >&2
    done
    die "nothing was written. Port the change into its TypeScript source, then build again; or run tools/build-ts.sh --force to overwrite it."
  fi
fi

wrote=0
for f in "${OUTPUTS[@]}"; do
  if [ -f "$f" ] && [ "$(nsha "$f")" = "$(nsha "$tmp/out/$f")" ]; then continue; fi
  cp "$tmp/out/$f" "$f"
  echo "build-ts: wrote $f"
  wrote=1
  if [ "$GIT" = 1 ] && ! tracked "$f"; then
    echo "build-ts: $f is new: git add it" >&2
  fi
done
[ "$wrote" = 1 ] || echo "build-ts: compiled output unchanged"
for f in "${OUTPUTS[@]}"; do printf '%s  %s\n' "$(nsha "$f")" "$f"; done > "$STATE"

# Always: bump_assets.py changes nothing when every stamp is current, and repairs a stale one even
# when the compiled output did not change.
python3 -I "$ROOT/bump_assets.py"
