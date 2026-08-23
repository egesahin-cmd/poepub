/* ═══════ REDUX — sample-rate reduction (sample & hold) ═══════
   The one part of DRIVE that cannot live in the WaveShaper curve. Waveshaping and bit-depth
   quantisation are memoryless, so fx-drive bakes them both into a single lookup table; holding a
   sample across time needs state, and state needs a processor.

   Mono by contract — every source in this app is mono into a GainNode, and a single shared phase
   is what makes the hold coherent. `norm` is the target rate as a FRACTION of sampleRate, so
   1 = off (hold every sample = passthrough) and 0.01 = ~441 Hz at 44.1k.

   Kept deliberately tiny: two adds, a compare and a branch per sample. */
class ReduxProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'norm', defaultValue: 1, minValue: 0.002, maxValue: 1, automationRate: 'a-rate' }];
  }
  constructor() { super(); this.ph = 1; this.hold = 0; }

  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const dst = out[0];
    /* A connected-but-silent source arrives as an empty channel array, NOT as zeros. Returning
       early here (rather than indexing into nothing) is what keeps the node alive through gaps. */
    if (!inp || !inp.length || !inp[0] || !inp[0].length) { dst.fill(0); return true; }
    const src = inp[0];
    const p = params.norm, aRate = p.length > 1;
    let ph = this.ph, hold = this.hold;
    for (let i = 0; i < dst.length; i++) {
      ph += aRate ? p[i] : p[0];
      if (ph >= 1) { ph -= 1; hold = src[i]; }   // wrap → latch a fresh sample
      dst[i] = hold;
    }
    this.ph = ph; this.hold = hold;
    return true;
  }
}
registerProcessor('redux', ReduxProcessor);
