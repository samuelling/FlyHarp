# FlyHarp

A synthesizer played by the *Drosophila* visual system. A stimulus (or your webcam) drives the photoreceptors of a connectome-constrained model of the fly optic lobe. The resulting cascade through retina → lamina → medulla → lobula plate is turned into notes.

**Play:** https://samuelling.github.io/FlyHarp/ (GitHub Pages from `main`, root)

## How it works

- **The fly.** This is the best model of the 50-model flyvis ensemble (Lappalainen et al., *Nature* 2024): 45,669 neurons in 65 cell types and 1.45 M synapses on a 721-column hex eye. Its wiring comes from the FIB-SEM optic-lobe connectome, and its cell and synapse parameters were trained so the network computes optic flow. Every pair of cell types connects through one spatial filter that repeats at every column, so the whole network ships as 2,355 filters (`data/fly.json`, 57 kB). The browser rebuilds it and integrates it in a Web Worker at 20 ms per step (about 2.5 ms of compute per step). The JS port matches PyTorch to a median correlation of 1.000 (minimum 0.996 across cell types; `tools/validate_engine.js`).
- **The eye.** The webcam is the default, sampled at each ommatidium and re-centred on grey. If no camera is available it falls back to a drifting grating. Other stimuli are drawn directly onto the 721 ommatidia: gratings, moving edges and bars, looming disks, drifting dots, full-field flashes, drawing with the pointer, or the webcam sampled at each ommatidium.
- **What the fly sees** (the main view). A large compound-eye display with one hexagonal facet per ommatidium, plus a "what you see" inset showing the full-resolution camera or stimulus and the eye's footprint. Six lenses show the same scene at successive stages:
  - **Photoreceptors:** the input image.
  - **Lamina contrast:** L1 + L2.
  - **ON channel:** Mi1 + Tm3.
  - **OFF channel:** Tm1, Tm2, Tm4, Tm9.
  - **Motion:** a linear read-out of the eight T4/T5 subtypes into a direction vector per column. Hue shows direction, with optional arrows. The read-out (`motion_decoder` in `fly.json`) is fit by least squares to gratings and ON/OFF edges in 24 directions, with flicker and counterphase gratings as zero motion, both with and without gain control (`tools/fit_motion_decoder.js`). Held-out direction error is 9° median without gain control and 15° with it. A plain vector sum along each subtype's preferred direction is biased in this model, because T4d and T5b are only weakly direction selective and add their own direction to any response; that sum pushed everything upward.
  - **Medulla → lamina feedback.**

  The outer two rings of the eye are shown but not used as signal, because the model truncates their inputs.
- **The strings.** Each string is a cell type, optionally split into 7 regions of the eye. It plucks when its depolarization relative to grey rises past a threshold, measured in units of that type's own response range. It re-arms once it falls back below.
- **Pitch** follows depth in the visual system: retina lowest, then lamina, medulla, transmedulla and T4/T5 highest. Within a layer, strings climb the chosen scale. **Pan** follows the region's position on the eye, and **loudness** follows response size.
- **Tempo** slows fly time relative to real time, so the cascade's real latencies become audible arpeggios.
- **Two strings per cell type.** One plucks on depolarization and one on hyperpolarization. The hyperpolarization string plays an octave lower and darker, with a reversed envelope that swells in. Each area can be set to +, ± or −.
- **Hierarchy mixer.** The five areas (retina, lamina, medulla, medulla → lobula, lobula plate) can each be soloed, muted, levelled and given an instrument. Cell types are strung or unstrung with chips, or by clicking their maps in the cascade.
- **Timbre.** Each area is an instrument family: bowed pad, marimba, harp (Karplus–Strong), FM bell, glass, or pitched click. Each cell type is its own variant within that family. Its **envelope comes from the cell's fitted membrane time constant**, so fast cells are percussive and slow cells sustain, and a hash of its name sets partial ratios, FM ratio and brightness. Everything runs in one AudioWorklet (`js/voices-worklet.js`) with reverb, plus Web MIDI out (one channel per area, or all on channel 1).

- **Feedback as timbre.** The worker tracks the feedback current onto L1–L5 from medulla-resident cells in each eye region, relative to grey. These are C2, C3, Lawf and the medulla interneurons that contact L-cell terminals, about 38% of the synaptic weight onto L cells in this model. Net inhibitory feedback damps notes in that region (darker, shorter, less FM, lower resonance). Net excitatory feedback brightens them and adds shimmer. Depth and target areas are adjustable, and a bipolar meter shows the feedback live.
- **Gain control (optional, off by default).** The trained network has none: it is linear above threshold with subtractive inhibition, so responses scale with mean light and contrast without saturating, and its surrounds suppress by a fixed fraction at every contrast. `js/gain.js` adds two stages around it, labelled in the app as additions to the model:
  - **Photoreceptor adaptation.** Each ommatidium low-pass filters its own luminance (time constant 0.1–3 s) and passes on compressed Weber contrast, x / (1 + |x| / k). With it on, the webcam feeds raw luminance instead of the re-centred image, and a *light level* control (a neutral-density filter) shows the difference: a 40% grating at 1/8 of the trained light drops Mi1's response to 0.11× without adaptation and keeps it at 0.82× with it.
  - **Divisive normalization.** The drive onto the lamina (L1–L3), the T4/T5 input neurons of the medulla (Mi1, Tm3, Mi4, Mi9, Tm1, Tm2, Tm4, Tm9), or both is divided around its grey value by local contrast energy, pooled over a Gaussian of neighbouring columns: response ∝ c / (1 + c / c50). With both stages on, Mi1's size-tuning suppression index rises from 0.21 to 0.60 at 80% contrast but only from 0.25 to 0.37 at 12%, so surround suppression now grows with contrast. In this model Mi1 takes most of its drive straight from R8, so normalizing the lamina alone barely reaches the T4 pathway.
  - **Probe.** A panel below the cascade runs in-silico physiology on a private copy of the network, so the instrument keeps playing. It records the central cell of any type and plots the contrast response, size tuning at 12% and 80% contrast, and the response across mean light levels, with and without the gain control.
- **Hover cards** (`js/info.js`) give each visual area and each of the 65 cell types a short summary of its putative role, plus live facts: time constant, its notes, and how often it has plucked.

## Files

```
index.html  css/style.css
js/engine.js         the network (shared by the worker and Node tests)
js/gain.js           optional photoreceptor adaptation and divisive normalization
js/probe.js, js/probe-worker.js  in-silico physiology: contrast, size and light-level tuning
js/worker.js         simulation + per-type, per-region activity + response calibration
js/stimuli.js        stimuli and webcam on the hex eye
js/audio.js          Web Audio harp + Web MIDI
js/voices-worklet.js multi-engine voices (pluck, modal, glass, FM, pad, click)
js/app.js            UI, string detectors, drawing
js/info.js           putative roles of areas and cell types (hover cards)
data/fly.json        exported model
tools/export_model.py   export from flyvis (pip install flyvis; flyvis download-pretrained)
tools/precompute_directions.js  measure T4/T5 preferred directions into data/fly.json
tools/fit_motion_decoder.js     fit the T4/T5 → direction read-out into data/fly.json
tools/gain_smoke.py             headless check of the gain-control stages and the probe
tools/lens_test.py   screenshot each eye lens for a moving edge
tools/validate_engine.js  compare the JS engine with a PyTorch reference trace
tools/smoke_test.py, tools/engine_levels.py, tools/webcam_test.py  headless checks of the page, each voice engine, and the webcam path (Chrome fake camera)
```
