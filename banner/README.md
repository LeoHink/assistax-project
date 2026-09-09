# Assistax banner video

A 12-second, silent, **seamlessly looping** 1920×1080 clip for an X/Twitter post:
the five task rollouts fly in from the frame edges into a full-bleed mosaic,
"Assistax" spells out one letter at a time, the paper subtitle appears — then the
whole thing runs backwards at ~3x and lands on exactly the opening frame.

```
banner.mp4        the deliverable — 1920×1080, 30fps, 360 frames, no audio track
banner.html       the composition; open it in a browser to watch or screen-record
render.mjs        headless Chromium → ffmpeg capture (no npm dependencies)
build-media.sh    regenerates media/ from ../static/videos/
media/*.webm      the five task clips, transcoded
```

## Watching it

Open `banner/banner.html` in any browser — it plays on a loop and scales to the
window. Nothing to install and no server needed.

## Re-rendering

```sh
node render.mjs                                  # -> banner.mp4  (~3 min)
node render.mjs --stills 0.9,2.4,4.8,7.2,10.8    # -> stills/*.png, the fast loop
node render.mjs --out /tmp/x.mp4 --crf 20        # overrides; also --fps --duration
```

Needs Node ≥22 (for the global `WebSocket` used to drive DevTools), a `chromium`
on PATH (or `CHROMIUM=/path/to/binary`), and `ffmpeg`. If Chromium refuses to
start over sandboxing, re-run with `HF_NO_SANDBOX=1`.

## Editing

Every tunable number is in the `CFG` block at the top of `banner.html`:
tile rects and entry edges, which second of each source clip a tile opens on
(`startAt`), the crop centre (`focus`), all the beat timings, and the palette.
Change a number, re-run `--stills`, look, repeat.

The subtitle is `CFG.sub.lines`. The shorter phrasing from the page's meta tags —
"A Multi-Agent Hardware-Accelerated RL Benchmark for Assistive Robotics" — fits
on one line if you prefer it.

## Two things worth knowing before you change them

**`paint(t)` is a pure function of `t`.** No CSS animations, no state that
accumulates across frames. That is what lets `render.mjs` seek to an arbitrary
frame and get a reproducible result. If you add motion, compute it from `t` too.

**`render.mjs`'s static server implements HTTP range requests, and must.**
Without them Chromium marks the media non-seekable, silently clamps every
`currentTime = x` to 0, *and still fires `seeked`* — so a capture runs at full
speed while every frame shows the clip's first frame.

## Notes

- Font is **Inter** (SIL OFL), base64-inlined into `banner.html` so it renders
  identically offline and on any machine. SF Pro is not redistributable; Inter is
  the site's existing typeface and the standard stand-in.
- `build-media.sh` transcodes to VP9 because Arch's `chromium` ships without
  proprietary codecs and may not decode the source H.264 at all. It also forces a
  short keyframe interval (`-g 15`) — a capture seeks the video 300 times, and
  with VP9's default GOP each seek would re-decode from the clip start.
- Its `TOP_CROP` shaves the dark skybox band above the horizon. Measured at
  source row 60 in `bed_bathing` and `arm_assist`; the other three clips are
  framed below the horizon and need no crop.

- Its `palindrome()` map pre-loops a clip: N seconds forward plus the same N
  reversed, so the tile repeats with no cut. `arm_assist` uses a 6s window,
  because it only does its actual work in the first ~6s (arm up at the headboard,
  reach, contact, sweep down) and then lies collapsed across the bed doing nothing
  for 26 seconds. A hard 6s loop jumps ~6x a normal frame step at the wrap; the
  palindrome measures *below* one frame step at both the turnaround and the wrap.
  The reverse leg reads as the robot lifting the arm back up, which is the task.

  Note `-t` goes **before** `-i` in those two ffmpeg calls. As an output option it
  would trim the output of `reverse`, which buffers the whole 33s clip — giving
  you the reversed dead tail instead of the reversed opening.
- **The loop is exact.** The last frame (t=11.967s) is pixel-identical to the
  first — verified, max channel difference 0 across the whole frame — so X's
  auto-replay has no visible seam. If you retime anything, keep it that way: every
  `CFG.outro` beat must finish before `duration`, and the strip scale has to come
  home to `settle.fromScale`. Re-check with:

  ```sh
  node render.mjs --stills 0,11.967
  ffmpeg -i stills/t0_00.png -i stills/t11_97.png \
         -filter_complex blend=all_mode=difference -f rawvideo -pix_fmt gray - \
    | python3 -c "import sys;d=sys.stdin.buffer.read();print('max',max(d))"   # want 0
  ```

- The reverse costs nothing structurally: each element's exit is just its entry
  progress multiplied by `(1 - exitProgress)`. Because blur, rise, scale and
  opacity are all already derived from that single number, they reverse for free.

- Frame 0 is intentionally empty — the mosaic assembles from nothing — which is
  worth knowing if you care what the poster frame is.

- Motion rates are deliberately half what a first pass used; the original read as
  hurried. `CFG.assembly.travel`, `CFG.word.stagger` and the `CFG.outro` block are
  where you dial pace.
