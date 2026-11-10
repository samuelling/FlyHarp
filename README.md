# FlyHarp

A synthesizer played by the *Drosophila* visual system. A stimulus (or your webcam) drives the photoreceptors of a connectome-constrained model of the fly optic lobe. The resulting cascade through retina → lamina → medulla → lobula plate is turned into notes.

**Play:** https://samuelling.github.io/FlyHarp/ (GitHub Pages from `main`, root)

## How it works

- **The fly.** This is the best model of the 50-model flyvis ensemble (Lappalainen et al., *Nature* 2024): 45,669 neurons in 65 cell types and 1.45 M synapses on a 721-column hex eye. Its wiring comes from the FIB-SEM optic-lobe connectome, and its cell and synapse parameters were trained so the network computes optic flow. Every pair of cell types connects through one spatial filter that repeats at every column, so the whole network ships as 2,355 filters (`data/fly.json`, 57 kB). The browser rebuilds it and integrates it in a Web Worker at 20 ms per step (about 2.5 ms of compute per step). The JS port matches PyTorch to a median correlation of 1.000 (minimum 0.996 across cell types; `tools/validate_engine.js`).
- **The eye.** The webcam is the default, sampled at each ommatidium and re-centred on grey. If no camera is available it falls back to a drifting grating. Other stimuli are drawn directly onto the 721 ommatidia: gratings, moving edges and bars, looming disks, drifting dots, full-field flashes, drawing with the pointer, or the webcam sampled at each ommatidium.
- **The strings.** Each string is a cell type, optionally split into 7 regions of the eye. It plucks when its depolarization relative to grey rises past a threshold, measured in units of that type's own response range. It re-arms once it falls back below.
- **Pitch** follows depth in the visual system: retina lowest, then lamina, medulla, transmedulla and T4/T5 highest. Within a layer, strings climb the chosen scale. **Pan** follows the region's position on the eye, and **loudness** follows response size.
- **Tempo** slows fly time relative to real time, so the cascade's real latencies become audible arpeggios.
- **Two strings per cell type.** One plucks on depolarization and one on hyperpolarization. The hyperpolarization string plays an octave lower and darker, with a reversed envelope that swells in. Each area can be set to +, ± or −.
- **Hierarchy mixer.** The five areas (retina, lamina, medulla, medulla → lobula, lobula plate) can each be soloed, muted, levelled and given an instrument. Cell types are strung or unstrung with chips, or by clicking their maps in the cascade.
- **Timbre.** Each area is an instrument family: bowed pad, marimba, harp (Karplus–Strong), FM bell, glass, or pitched click. Each cell type is its own variant within that family. Its **envelope comes from the cell's fitted membrane time constant**, so fast cells are percussive and slow cells sustain, and a hash of its name sets partial ratios, FM ratio and brightness. Everything runs in one AudioWorklet (`js/voices-worklet.js`) with reverb, plus Web MIDI out (one channel per area, or all on channel 1).

- **Feedback as timbre.** The worker tracks the feedback current onto L1–L5 from medulla-resident cells in each eye region, relative to grey. These are C2, C3, Lawf and the medulla interneurons that contact L-cell terminals, about 38% of the synaptic weight onto L cells in this model. Net inhibitory feedback damps notes in that region (darker, shorter, less FM, lower resonance). Net excitatory feedback brightens them and adds shimmer. Depth and target areas are adjustable, and a bipolar meter shows the feedback live.
- **Hover cards** (`js/info.js`) give each visual area and each of the 65 cell types a short summary of its putative role, plus live facts: time constant, its notes, and how often it has plucked.

## Files

```
index.html  css/style.css
js/engine.js         the network (shared by the worker and Node tests)
js/worker.js         simulation + per-type, per-region activity + response calibration
js/stimuli.js        stimuli and webcam on the hex eye
js/audio.js          Web Audio harp + Web MIDI
js/voices-worklet.js multi-engine voices (pluck, modal, glass, FM, pad, click)
js/app.js            UI, string detectors, drawing
js/info.js           putative roles of areas and cell types (hover cards)
data/fly.json        exported model
tools/export_model.py   export from flyvis (pip install flyvis; flyvis download-pretrained)
tools/validate_engine.js  compare the JS engine with a PyTorch reference trace
tools/smoke_test.py, tools/engine_levels.py, tools/webcam_test.py  headless checks of the page, each voice engine, and the webcam path (Chrome fake camera)
```
