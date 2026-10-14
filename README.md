# Assistax — Project Page

Project page for **Assistax: A Multi-Agent Hardware-Accelerated Reinforcement Learning Benchmark for Assistive Robotics** (Hinckeldey et al., RLC 2026).

This is a static site (no build step). To preview locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Open placeholders

- `https://huggingface.co/assistive-autonomy` — confirm the Hugging Face org/collection URL.
- `static/images/favicon.ico` — replace with the Assistax favicon.

## Search indexing

- `index.html` has a canonical URL and Open Graph / Twitter / JSON-LD tags pointing at `https://leohinckeldey.dev/assistax-project/`.
- `static/images/social_preview.jpg` is the 1200×630 link-preview image (cropped from `banner/stills/t8_80.png`).
- `sitemap.xml` lists the page. Submit `https://leohinckeldey.dev/assistax-project/sitemap.xml` in Google Search Console under the `leohinckeldey.dev` property. Bump `<lastmod>` after substantial edits.
- `docs.html` is deliberately `noindex` while it is a stub.

## Editing content

- `index.html` — landing page (hero, abstract, key results, task carousel, method, BibTeX).
- `docs.html` — stub linking to the GitHub README until full docs land.
- `static/css/index.css` — site styles. Key Results card styles live near the top.
- `static/js/index.js` — Bulma carousel init, BibTeX copy button, scroll-to-top, video-on-visible autoplay.

## Asset pipeline

Paper figures and policy videos are sourced from:

- LaTeX figures: `/home/leo/Documents/1_PhD/1-paper-writing/assistax_rlc_2026/figures/`
- Policy rollouts: `/home/leo/Videos/assistax_policy_videos/`

To regenerate:

```bash
# PNGs from paper PDFs
pdftoppm -png -r 200 figures/sps_scaling.pdf static/images/speedup_chart
pdftoppm -png -r 200 figures/aht_ppo_pref_norm_minmax.pdf static/images/coordination_gap
pdftoppm -png -r 200 figures/assistax_training_loop.pdf static/images/training_loop
# (rename trailing -1.png suffix afterwards)

# Re-encode task videos for web
ffmpeg -i in.mp4 -vcodec libx264 -crf 28 -preset fast -vf "scale=1280:-2" -an -movflags +faststart out.mp4
```

## Template attribution

This page is built on the [Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template), adapted from the [Nerfies](https://nerfies.github.io/) project page. Licensed under [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/).
