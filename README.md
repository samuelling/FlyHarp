# FlyHarp

A synthesizer played by the *Drosophila* visual system. A stimulus (or your webcam) drives the photoreceptors of a connectome-constrained model of the fly optic lobe. The resulting cascade through retina → lamina → medulla → lobula plate is turned into notes.

**Play:** https://samuelling.github.io/FlyHarp/ (GitHub Pages from `main`, root)

**Layout.** Two views, toggled by the big tabs under the header. *What its Connectome Sees* shows the eye, its lenses and wiring, the 3D optic lobe and the cascade. *What its Connectome Hears* shows the ear pictures, the piano roll, and the auditory connectome in 3D: the ear network's 4,222 neurons at their FlyWire positions, with the 6,000 strongest synapses, lit live by the ear model. Every control lives in a drawer on the right, in four tabs: Stimulus, Instrument, Hearing and Model. Tap or drag its edge tab, or press Tab. On wide screens it opens by default and the page narrows beside it.

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
- **Eye geometry.** By default the eye is flyvis's idealization: a flat, regular hex grid with every column the same size. *Real eye* maps the same 721 columns onto the measured viewing directions of a right eye's ommatidia (whole-head micro-CT, Zhao et al., *Nature* 2025; `tools/eyemap_import.py` reads their published eye map from github.com/reiserlab/eyemap_T4 into `data/eyemap.json`). 712 of the model's columns land on real ommatidia; the 9 beyond the measured rim are extrapolated, kept in the network, and not drawn. The network and its wiring are unchanged, since the fly also wires by lattice neighbours. What changes is where each column looks:
  - **Sampling:** the median interommatidial angle is 4.8° (10th–90th percentile 3.9–6.5°). It is finest along the equator and the central meridian, so stimuli and the camera are sampled densely there and coarsely at the rim. The eye is drawn in an azimuthal-equidistant projection about the centre column, each facet where it looks.
  - **Motion:** the T4/T5 read-out is computed in lattice coordinates and turned into world directions through each column's local lattice-to-world Jacobian. Preferred directions therefore bend across the eye, as Zhao et al. found for real T4 cells, without any change to the cells.
  - **Orientation:** in flyvis's training images +y is up and +x is anterior; its T4 subtypes agree (T4a front-to-back, T4b back-to-front, T4c up, T4d down). FlyHarp now draws the eye and samples the camera with that orientation. Earlier versions fed the camera upside down relative to training and drew the eye flipped to match.
- **The strings.** Each string is a cell type, optionally split into 7 regions of the eye. It plucks when its depolarization relative to grey rises past a threshold, measured in units of that type's own response range. It re-arms once it falls back below.
- **Pitch** follows depth in the visual system: retina lowest, then lamina, medulla, transmedulla and T4/T5 highest. Within a layer, strings climb the chosen scale. **Pan** follows the region's position on the eye, and **loudness** follows response size.
- **Tempo** slows fly time relative to real time, so the cascade's real latencies become audible arpeggios.
- **Two strings per cell type.** One plucks on depolarization and one on hyperpolarization. The hyperpolarization string plays an octave lower and darker, with a reversed envelope that swells in. Each area can be set to +, ± or −.
- **Hierarchy mixer.** The five areas (retina, lamina, medulla, medulla → lobula, lobula plate) can each be soloed, muted, levelled and given an instrument. Cell types are strung or unstrung with chips, or by clicking their maps in the cascade.
- **Timbre.** Each area plays one instrument; each cell type is its own variant of it. A cell's **envelope comes from its fitted membrane time constant** (fast cells percussive, slow cells sustained), and a hash of its name sets partials, ratios and brightness. There are 24 instruments in six families: plucky (harp, synth pluck, kalimba, koto), percussive (marimba, woodblock, hand drum, shaker, pitched click), bells and glass (FM bell, glass, tubular bell, gamelan), pads and ambient (bowed pad, warm pad, shimmer cloud, drone choir), organic (choir with per-cell vowels, breathy flute, pan pipe) and additive textures (drawbar organ, hollow reed, spectral partials, octave glass). They run on 13 voice engines in one AudioWorklet (`js/voices-worklet.js`): Karplus–Strong, modal, FM, detuned pad, additive, grain cloud, formant voice, breath resonator, membrane, noise shaker, filtered saw, glass and resonant click. **Ensembles** set all five areas at once (classic, additive textures, organic, plucky, pads and ambient, percussive, bells and glass). Reverb is shared, and Web MIDI out is available (one channel per area, or all on channel 1).

- **Feedback as timbre.** The worker tracks the feedback current onto L1–L5 from medulla-resident cells in each eye region, relative to grey. These are C2, C3, Lawf and the medulla interneurons that contact L-cell terminals, about 38% of the synaptic weight onto L cells in this model. Net inhibitory feedback damps notes in that region (darker, shorter, less FM, lower resonance). Net excitatory feedback brightens them and adds shimmer. Depth and target areas are adjustable, and a bipolar meter shows the feedback live.
- **Gain control (optional, off by default).** The trained network has none: it is linear above threshold with subtractive inhibition, so responses scale with mean light and contrast without saturating, and its surrounds suppress by a fixed fraction at every contrast. `js/gain.js` adds two stages around it, labelled in the app as additions to the model:
  - **Photoreceptor adaptation.** Each ommatidium low-pass filters its own luminance (time constant 0.1–3 s) and passes on compressed Weber contrast, x / (1 + |x| / k). With it on, the webcam feeds raw luminance instead of the re-centred image, and a *light level* control (a neutral-density filter) shows the difference: a 40% grating at 1/8 of the trained light drops Mi1's response to 0.11× without adaptation and keeps it at 0.82× with it.
  - **Divisive normalization.** The drive onto the lamina (L1–L3), the T4/T5 input neurons of the medulla (Mi1, Tm3, Mi4, Mi9, Tm1, Tm2, Tm4, Tm9), or both is divided around its grey value by local contrast energy, pooled over a Gaussian of neighbouring columns: response ∝ c / (1 + c / c50). With both stages on, Mi1's size-tuning suppression index rises from 0.21 to 0.60 at 80% contrast but only from 0.25 to 0.37 at 12%, so surround suppression now grows with contrast. In this model Mi1 takes most of its drive straight from R8, so normalizing the lamina alone barely reaches the T4 pathway.
  - **Probe.** A panel below the cascade runs in-silico physiology on a private copy of the network, so the instrument keeps playing. It records the central cell of any type and plots the contrast response, size tuning at 12% and 80% contrast, and the response across mean light levels, with and without the gain control.
- **The Tonnectome**. The fly's ears listen to its eyes. Everything the instrument plays (and, optionally, the microphone) goes into a model of the fly's antennae and early auditory network, and what it hears is drawn two ways. Either picture can be sent back into the eye, as a stimulus of its own or mixed into any other, so the loop runs sight → sound → hearing → sight.
  - **Antennae** (`js/ear-worklet.js`): a stereo AudioWorklet. Each antenna is a broad mechanical resonance (peak near 250 Hz) read by 32 band-pass channels from 40 Hz to 1.6 kHz, split into push and pull half-cycles, every 5 ms.
  - **Johnston's organ and beyond** (`tools/ear_export.py`, `js/ear-net.js`, `js/ear-worker.js`): 4,222 neurons and 1.35 M synapses from FlyWire v783. They are the 1,104 Johnston's organ neurons of both antennae, then neurons getting ≥ 10 synapses from them, then two further steps of neurons getting ≥ 20–25% of their input from the steps before (AMMC, SAD, WED, AVLP and on). Weights are synapse counts × transmitter sign ÷ each cell's total input. Johnston's organ neurons are tuned by subgroup (A high, B low, D broad, C/E sustained deflection, here the slow loudness), each divided by the energy across its antenna. Downstream is a rate network, τ dV/dt = −V + G Σ w r, r = max(0, tanh V). **It is not trained or fit**: only the wiring and signs are measured, and the gain and time constants are set by hand.
  - **Pictures** (`js/tonnectome.js`): a two-antenna cochleogram is always shown, alongside one picture chosen from seven. Each is a faithful mapping of the ear model's outputs, drawn differently, and the eye gets it as brightness:
    - *cochleogram*: time × pitch.
    - *network*: the auditory neurons in frontal view, where they sit.
    - *Chladni plate*: each of the 32 bands drives one plate mode, weighted by loudness, and light falls on the nodal lines where sand would gather.
    - *ripples*: each antenna is a stone in a pond; the last 1.2 s of every band travels outward with pitch-set ring spacing, and the two ears interfere.
    - *pitch helix*: one turn per octave, chroma as angle, left and right antennae mirrored.
    - *rhythm rose*: autocorrelation of each ear's loudness in low, mid and high bands, delay as radius out to 200 ms; pulse trains such as a 35 ms courtship song draw rings.
    - *stained glass*: one pane per cell type and side, ringed by step from the ear outward, brightness = mean activity.
- **Hover cards** (`js/info.js`) give each visual area and each of the 65 cell types a short summary of its putative role, plus live facts: time constant, its notes, and how often it has plucked.

## Files

```
index.html  css/style.css
js/engine.js         the network (shared by the worker and Node tests)
js/gain.js           optional photoreceptor adaptation and divisive normalization
js/eyegeom.js        eye geometry: idealized lattice or measured eye; facets and lattice-to-world Jacobians
js/tonnectome.js     The Tonnectome: ear pictures, ear -> eye
js/ear3d.js          the auditory connectome in 3D (three.js), lit by the ear model
js/ear-worklet.js    antennae: resonance + 32-band push/pull filterbank (AudioWorklet)
js/ear-net.js, js/ear-worker.js  Johnston's organ + early auditory network from FlyWire
data/ear.json, data/ear.bin      the auditory network (tools/ear_export.py)
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
tools/eyemap_import.py          map the model's columns onto the measured eye (Zhao et al. 2025) → data/eyemap.json
data/eyemap.json                viewing direction of each model column on the real eye
tools/gain_smoke.py             headless check of the gain-control stages and the probe
tools/ear_export.py             export the auditory network from FlyWire v783
tools/tonnectome_smoke.py       headless check of the ear loop
tools/stamp.py                  cache-busting version stamp for every file the page loads
tools/lens_test.py   screenshot each eye lens for a moving edge
tools/validate_engine.js  compare the JS engine with a PyTorch reference trace
tools/smoke_test.py, tools/engine_levels.py, tools/webcam_test.py  headless checks of the page, each voice engine, and the webcam path (Chrome fake camera)
```
