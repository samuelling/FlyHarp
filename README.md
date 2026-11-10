# FlyHarp

A synthesizer played by the *Drosophila* visual system. A stimulus (or your webcam) drives the photoreceptors of a connectome-constrained model of the fly optic lobe. The resulting cascade through retina → lamina → medulla → lobula plate is turned into notes.

**Play:** https://samuelling.github.io/FlyHarp/ (GitHub Pages from `main`, root)

## How it works

- **The fly.** This is the best model of the 50-model flyvis ensemble (Lappalainen et al., *Nature* 2024): 45,669 neurons in 65 cell types and 1.45 M synapses on a 721-column hex eye. Its wiring comes from the FIB-SEM optic-lobe connectome, and its cell and synapse parameters were trained so the network computes optic flow. Every pair of cell types connects through one spatial filter that repeats at every column, so the whole network ships as 2,355 filters (`data/fly.json`, 57 kB). The browser rebuilds it and integrates it in a Web Worker at 20 ms per step (about 2.5 ms of compute per step). The JS port matches PyTorch to a median correlation of 1.000 (minimum 0.996 across cell types; `tools/validate_engine.js`).
- **The eye.** Stimuli are drawn directly onto the 721 ommatidia: gratings, moving edges and bars, looming disks, drifting dots, full-field flashes, drawing with the pointer, or the webcam sampled at each ommatidium.
- **The strings.** Each string is a cell type, optionally split into 7 regions of the eye. It plucks when its depolarization relative to grey rises past a threshold, measured in units of that type's own response range. It re-arms once it falls back below.
- **Pitch** follows depth in the visual system: retina lowest, then lamina, medulla, transmedulla and T4/T5 highest. Within a layer, strings climb the chosen scale. **Pan** follows the region's position on the eye, and **loudness** follows response size.
- **Tempo** slows fly time relative to real time, so the cascade's real latencies become audible arpeggios.
- **Sound:** a Karplus–Strong harp in an AudioWorklet with reverb, plus Web MIDI out (one channel per layer, or all on channel 1).

## Files

```
index.html  css/style.css
js/engine.js         the network (shared by the worker and Node tests)
js/worker.js         simulation + per-type, per-region activity + response calibration
js/stimuli.js        stimuli and webcam on the hex eye
js/audio.js          Web Audio harp + Web MIDI
js/harp-worklet.js   Karplus–Strong voices
js/app.js            UI, string detectors, drawing
data/fly.json        exported model
tools/export_model.py   export from flyvis (pip install flyvis; flyvis download-pretrained)
tools/validate_engine.js  compare the JS engine with a PyTorch reference trace
```
