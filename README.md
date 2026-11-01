# Neural Resonance

A music visualizer that draws a human brain as clusters and pathways of tonally shaded dots inside a translucent bluish skull, and maps what it hears onto brain function. Everything is one self-contained page: `index.html`. Open it in a browser (Chrome, Edge, Firefox or Safari), pick a source, and the brain lights up.

## Sources

- **Microphone**: live input. The page asks for permission; monitoring is muted so there is no feedback.
- **Upload track**: any audio file the browser can decode. Drag and drop onto the page also works. Play, pause and seek from the transport bar.
- **Demo loop**: a synthesised loop (four chords, a repeating lead motif, a shift to a minor section, a tempo change from 112 to 126 bpm, breakdowns and drops) so the mapping can be seen without a track.

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

## How the analysis works

All analysis is done in the browser with the Web Audio API (`AnalyserNode`, 4096-point FFT):

- **Onsets**: spectral flux with adaptive thresholding and peak picking.
- **Tempo**: inter-onset-interval histogram over the last 8 seconds, folded to 60 to 180 bpm; a sustained disagreement switches tempo and fires norepinephrine. Beat phase is tracked from onsets near predicted beats.
- **Chords**: peak-picked chroma matched against major, minor, diminished and sus4 templates with hysteresis.
- **Key**: Krumhansl-Kessler profiles correlated against a slow chroma average; the major/minor balance drives the limbic hue.
- **Pitch**: normalised autocorrelation (McLeod-style) on the downsampled waveform; stable notes feed a melody of intervals.
- **Repetition**: n-gram matching on the chord sequence and on the interval sequence (transposition-invariant); samples are recognised by cosine similarity of 24-band spectral fingerprints taken at onsets.

## Development

Source lives in `src/` as parts (`p1_head.html` styles, `p2_body.html` markup, `p3_a.js` anatomy, `p3_b.js` analysis, `p3_c.js` brain model, `p3_d.js` renderer, `p3_e.js` audio engine, demo synth and UI). `sh src/build.sh` concatenates them into `index.html`. There are no dependencies and no build tooling beyond that.
