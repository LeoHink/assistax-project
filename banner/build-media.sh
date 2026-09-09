#!/usr/bin/env bash
# Transcode the site's task clips into the WebM panels banner.html plays.
#
#   ./build-media.sh              rebuild all five
#   ./build-media.sh bed_bathing  rebuild just one (name without the task_ prefix)
#
# Two things this does beyond a straight copy:
#
#  * VP9 instead of the source H.264. Arch's chromium ships without proprietary
#    codecs, so the source mp4s may not decode in-browser at all; VP9 always does.
#
#  * -g 15, a short keyframe interval. render.mjs seeks the video 300 times, and
#    with VP9's default (near-infinite) GOP each seek would re-decode from the
#    clip start, making the render O(n^2).
#
# TOP_CROP removes the dark skybox band above the horizon. MuJoCo's camera sits
# lower in some tasks than others, so it is per-clip: without it, bed_bathing
# lands in the mosaic with what looks like a letterbox bar across its top edge.
set -euo pipefail
cd "$(dirname "$0")"

SRC=../static/videos
OUT=media
mkdir -p "$OUT"

# source is 960x720; pixels of sky to shave off the top
top_crop() {
  case "$1" in
    # measured: in both of these the horizon sits at source row 60
    # (luma ~50 above it, ~65 below); +2 for margin.
    bed_bathing) echo 62 ;;
    arm_assist)  echo 62 ;;
    # the other three are framed below the horizon - no sky in shot at all
    *)           echo 0  ;;
  esac
}

# PALINDROME trims a clip to its first N seconds and appends that same stretch
# reversed, so the panel repeats forever with no cut. arm_assist only does its
# actual work in the first ~6s -- arm up at the headboard, reach, contact, sweep
# down -- and then lies collapsed across the bed doing nothing for 26 seconds.
# A hard 6s loop would jump hard at the wrap (measured: ~6x a normal frame step).
# Reversed, the return leg reads as the robot lifting the arm back up, which is
# exactly what the task is.
palindrome() {
  case "$1" in
    arm_assist) echo 6 ;;
    *)          echo 0 ;;
  esac
}

VP9=(-c:v libvpx-vp9 -crf 30 -b:v 0 -row-mt 1 -speed 2
     -g 15 -auto-alt-ref 0 -lag-in-frames 0 -pix_fmt yuv420p)

CLIPS=(scratch bed_bathing feeding tooth_brushing arm_assist)
[ $# -gt 0 ] && CLIPS=("$@")

for name in "${CLIPS[@]}"; do
  crop=$(top_crop "$name")
  win=$(palindrome "$name")
  chain="crop=960:$((720 - crop)):0:${crop}"

  if [ "$win" != "0" ]; then
    echo "==> task_$name  (top crop ${crop}px, ${win}s palindrome)"
    # reverse before scaling: `reverse` buffers every frame in RAM, and at the
    # source's 960x658 that is ~340MB instead of ~900MB at 1576x1080.
    # -t BEFORE -i, so only $win seconds are ever decoded. As an output option it
    # would instead trim the result of `reverse`, which buffers the whole 33s
    # clip -- yielding the reversed dead tail rather than the reversed opening.
    ffmpeg -nostdin -y -loglevel error -t "$win" -i "$SRC/task_$name.mp4" -an \
      -vf "${chain},scale=-2:1080:flags=lanczos" "${VP9[@]}" "$OUT/.fwd.webm"
    ffmpeg -nostdin -y -loglevel error -t "$win" -i "$SRC/task_$name.mp4" -an \
      -vf "${chain},reverse,scale=-2:1080:flags=lanczos" "${VP9[@]}" "$OUT/.rev.webm"
    printf "file '.fwd.webm'\nfile '.rev.webm'\n" > "$OUT/.concat.txt"
    ffmpeg -nostdin -y -loglevel error -f concat -safe 0 -i "$OUT/.concat.txt" \
      -c copy "$OUT/task_$name.webm"
    rm -f "$OUT/.fwd.webm" "$OUT/.rev.webm" "$OUT/.concat.txt"
  else
    echo "==> task_$name  (top crop ${crop}px)"
    # Tiles are at most 960x540 and use object-fit:cover, so encoding at 1080
    # height means the browser never has to upscale.
    ffmpeg -nostdin -y -loglevel error -i "$SRC/task_$name.mp4" -an \
      -vf "${chain},scale=-2:1080:flags=lanczos" "${VP9[@]}" "$OUT/task_$name.webm"
  fi
done

echo
echo "== verify =="
for name in "${CLIPS[@]}"; do
  printf '%-26s ' "task_$name.webm"
  ffprobe -v error -show_entries stream=codec_type,codec_name,width,height \
          -show_entries format=duration -of csv=p=0:nk=1 "$OUT/task_$name.webm" | tr '\n' ' '
  echo
done
