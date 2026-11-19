#!/bin/bash
# Makes a small music folder for the end-to-end tests: every format and folder shape the shelf
# must handle. Needs ffmpeg. Usage: bash tests/e2e/fixtures.sh <out dir>
# Tag titles differ from file names on purpose: a test can tell tags that were read from a guess.
set -euo pipefail
OUT=${1:?out dir}
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$OUT"
q() { ffmpeg -loglevel error -y "$@"; }
tone() { echo "sine=frequency=$1:duration=$2"; }
art() { q -f lavfi -i "color=c=$1:s=320x320" -frames:v 1 "$2"; }

art '#c0392b' red.jpg
art '#2471a3' blue.png
art '#1e8449' green.jpg
art '#d4ac0d' gold.jpg

# MP3: ID3v2 with art on the first track, year and genre.
d='Ada Fictional/Blue Hours (1961)'
mkdir -p "$d"
for n in 1 2 3; do
  if [ $n = 1 ]; then pic=(-i red.jpg -map 0:a -map 1:v -c:v mjpeg -disposition:v attached_pic -id3v2_version 3); else pic=(-id3v2_version 3); fi
  q -f lavfi -i "$(tone $((300 + n * 40)) 3)" "${pic[@]}" -c:a libmp3lame -b:a 96k \
    -metadata title="Blue Hour Part $n" -metadata artist='Ada Fictional' -metadata album='Blue Hours' \
    -metadata date=1961 -metadata genre=Jazz -metadata track="$n/3" "$d/0$n track.mp3"
done

# FLAC: Vorbis comments and a PICTURE block.
d='Night Trains'
mkdir -p "$d"
for n in 1 2; do
  q -f lavfi -i "$(tone $((220 + n * 30)) 3)" -i blue.png -map 0:a -map 1:v -c:a flac -c:v png -disposition:v attached_pic \
    -metadata title="Platform $n" -metadata artist='The Sleeper Cars' -metadata album='Night Trains' \
    -metadata date=1974 -metadata genre=Rock -metadata track=$n "$d/side-$n.flac"
done

# M4A: iTunes atoms with covr.
d='Orchard Radio/Low Sun'
mkdir -p "$d"
for n in 1 2; do
  q -f lavfi -i "$(tone $((400 + n * 25)) 3)" -i green.jpg -map 0:a -map 1:v -c:a aac -b:a 96k -c:v mjpeg -disposition:v attached_pic \
    -metadata title="Low Sun $n" -metadata artist='Orchard Radio' -metadata album='Low Sun' \
    -metadata date=2009 -metadata genre=Folk -metadata track=$n "$d/$n.m4a"
done

# Untagged WAVs, named Artist/Album/NN Title, with a cover.jpg beside them.
d='Folder Artist/Folder Album'
mkdir -p "$d"
for n in 1 2; do q -f lavfi -i "$(tone $((500 + n * 20)) 2)" -ac 1 -ar 22050 "$d/0$n Untagged Song $n.wav"; done
cp gold.jpg "$d/cover.jpg"

# Two discs in CD1/CD2, with an album artist.
for disc in 1 2; do
  d="Double Feature/CD$disc"
  mkdir -p "$d"
  for n in 1 2; do
    q -f lavfi -i "$(tone $((600 + disc * 50 + n * 10)) 2)" -c:a libmp3lame -b:a 64k \
      -metadata title="Reel $disc-$n" -metadata artist='Cinema Twins' -metadata album_artist='Cinema Twins' \
      -metadata album='Double Feature' -metadata disc=$disc -metadata track=$n -metadata date=1988 "$d/$n.mp3"
  done
done

# A compilation: three artists, one album.
d='Mixtape'
mkdir -p "$d"
n=0
for a in 'Kite Signal' 'Velvet Ferry' 'Juno Halloran'; do
  n=$((n + 1))
  q -f lavfi -i "$(tone $((700 + n * 33)) 2)" -c:a libmp3lame -b:a 64k \
    -metadata title="Mix Song $n" -metadata artist="$a" -metadata album='Summer Mixtape' \
    -metadata compilation=1 -metadata track=$n -metadata date=2001 "$d/$n.mp3"
done

# Things to skip: AppleDouble and hidden files, notes.
printf 'x' > "Mixtape/._1.mp3"
printf 'x' > ".hidden.mp3"
printf 'notes' > "Mixtape/notes.txt"
rm red.jpg blue.png green.jpg gold.jpg
echo "fixtures in $OUT"
