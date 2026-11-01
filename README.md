# Neural Resonance

A music visualizer that draws a human brain as clouds of tonally shaded dots inside a translucent bluish skull, and maps what it hears onto brain function. It is a single self-contained page (`index.html`) that also installs as an app: a Progressive Web App on phones and desktops, and an Electron desktop build in `desktop/`.

## Playing music

- **Add tracks**: pick one or many audio files, or drop them anywhere on the page. They are kept in the browser's own storage (IndexedDB), so the library is still there next time you open the app. Nothing is uploaded anywhere.
- **Library**: a queue with previous and next, shuffle, repeat all or repeat one, and a volume control. Durations fill in as tracks play.
- **Transport** controls also appear on lock screens and respond to media keys (Media Session API). Keyboard: space play or pause, arrow keys seek 5 s, N and P next and previous, L opens the library, + − 0 zoom.
- **Demo loop**: a synthesised loop (four chords, a repeating lead motif, a shift to a minor section, a tempo change from 112 to 126 bpm, breakdowns and drops) so the mapping can be seen without a track.
- When installed as an app, audio files can be opened with it from the file manager (the manifest registers it as a handler for common audio formats).

Microphone input is parked for now; the focus is on tracks.

## What maps to what

| Audio | Brain |
| --- | --- |
| Live spectrum | Auditory cortex, tonotopic: low frequencies at the front, high at the back. Each dot follows one spectral band. |
| Onsets and beats | Motor and premotor cortex pulse; striatum locks to the groove; cerebellum ticks on every *predicted* beat, even through silence. |
| Tempo change | Locus coeruleus releases norepinephrine (amber) along noradrenergic projections to the cortex and hypothalamus. |
| Drops, cadences (V to I), melodic leaps, beats landing where predicted, recognised motifs | Ventral tegmental area releases dopamine (magenta) along the mesolimbic and mesocortical pathways to the nucleus accumbens and prefrontal cortex. |
| Chord change | Prefrontal cortex flashes in the chord's colour: gold major, indigo minor, teal diminished, magenta suspended. The arcuate fasciculus carries the signal from the auditory cortex. |
| Key mode (long-term major/minor) | The limbic system (cingulate, hippocampus, amygdala, hypothalamus) slowly undulates and shifts hue: warm in major, cool violet in minor. Amygdala brightens in minor passages and on startling transients. |
| Steady tempo and major tonality | Raphe nuclei release serotonin (green) to the limbic system. |
| Repeated melody, chord progression or sample | Hippocampus flashes and neurons connect: synapses form between auditory cortex, hippocampus and prefrontal cortex for melodies, between prefrontal and limbic regions for progressions, and within the auditory cortex for samples. Each repetition of the same material strengthens the same connections. |

## Zooming in

Scroll, pinch, or use the + and − buttons. Double-click a region (or pick it from the legend) to fly to it. Past roughly 3x zoom each dot becomes a neuron: soma, dendrites, a presynaptic bouton with vesicles, and a row of receptors on the postsynaptic membrane. When that region's neuromodulator arrives, molecules cross the cleft, dock, light the receptor, and (for dopamine, norepinephrine and serotonin) are taken back up. Receptor glyphs differ by transmitter: cups for dopamine, triangles for β-adrenergic, hexagons for 5-HT, bars for glutamate. Hover a region for its name, what drives it, and its receptor activity.

## Rendering

Every structure is a cloud of dots (about 6,300 in total plus the pathways). All dots are drawn by the GPU as point sprites in WebGL: one draw call for the clouds and one for their bloom per frame, with per-dot hue, tone and size. A transparent 2D canvas on top draws the skull, synapse lines, labels and the zoomed-in neuron detail. If WebGL is unavailable the 2D canvas draws the dots too, more slowly. On slow devices with high-density screens the page drops to 1x pixel density automatically.

## How the analysis works

All analysis runs in the browser with the Web Audio API (`AnalyserNode`, 4096-point FFT):

- **Onsets**: spectral flux with adaptive thresholding and peak picking.
- **Tempo**: a voting tempogram. Every pair of onsets in the last 8 seconds votes for the tempos at which its gap is a whole number of beats (1 to 4), weighted by onset strength. A sustained disagreement switches tempo and fires norepinephrine. Beat phase is tracked from onsets landing near predicted beats.
- **Chords**: peak-picked chroma matched against major, minor, diminished and sus4 templates with hysteresis.
- **Key**: Krumhansl-Kessler profiles correlated against a slow chroma average; the major/minor balance drives the limbic hue.
- **Pitch**: normalised autocorrelation (McLeod-style) on the downsampled waveform; stable notes feed a melody of intervals.
- **Repetition**: n-gram matching on the chord sequence and on the interval sequence (transposition-invariant); samples are recognised by cosine similarity of 24-band spectral fingerprints taken at onsets.

## Installing as an app

**Web app (PWA).** Serve the repository root over HTTPS (or localhost) and open `index.html`. Chrome and Edge show an **Install app** button in the page; Safari on iOS uses Share → Add to Home Screen; Android Chrome offers Install from the menu. The service worker (`sw.js`) caches the shell, so the installed app opens offline; the library lives in IndexedDB on the device. `manifest.webmanifest` and `icons/` carry the app identity.

A GitHub Pages workflow is included (`.github/workflows/pages.yml`): enable Pages with the "GitHub Actions" source in the repository settings and it deploys the root on every push to `main`.

**Desktop app (Electron).** In `desktop/`:

```sh
npm install
npm start        # runs the app in a window
npm run dist     # builds installers for the current platform into desktop/dist
```

`sync.js` copies `index.html` and the icons into `desktop/app` before each run or build. Installers are produced by electron-builder (dmg and zip on macOS, NSIS and portable on Windows, AppImage and deb on Linux) and register the app for common audio file types.

## Development

Source lives in `src/` as parts (`p1_head.html` styles, `p2_body.html` markup, `p3_a.js` anatomy, `p3_b.js` analysis, `p3_c.js` brain model, `p3_d.js` renderer, `p3_e.js` player, demo synth and UI). `sh src/build.sh` concatenates them into `index.html`. `node tools/make-icons.js` regenerates the icons. There are no runtime dependencies.
