/* ═══════════════════════════════════════════════════════════════════════════
   PLATE — Jon Dattorro's 1997 plate reverb ("Effect Design Part 1", JAES 45/9),
   the simplified plate-class topology in the style of Griesinger.

   Mono in, STEREO out. Written from the paper's published constants; the delay
   and tap numbers below are his, in samples at his reference rate of 29761 Hz,
   scaled to the live sampleRate at construction.

   Why a worklet rather than native nodes: a DelayNode inside a graph cycle has
   its delayTime clamped to one render quantum (128 frames), and every allpass
   here IS a cycle. In a worklet that floor does not exist, and SIZE can scale
   every delay line continuously.

   Parameters arrive by postMessage, not as AudioParams: they only change when a
   knob moves, and AudioWorklet cost scales with the number of declared params.
   Everything is smoothed per sample, so a slider drag glides instead of zipping.
   ═══════════════════════════════════════════════════════════════════════════ */
const DREF = 29761;                                   // Dattorro's reference rate

const N_IN  = [142, 107, 379, 277];                   // input diffusers
const G_IN  = [0.75, 0.75, 0.625, 0.625];
const N_DD1 = [672, 908];                             // decay diffuser 1 (modulated)
const N_PRE = [4453, 4217];                           // pre-damping delay
const N_DD2 = [1800, 2656];                           // decay diffuser 2
const N_PST = [3720, 3163];                           // post-damping delay
const G_DD1 = 0.70, G_DD2 = 0.50;

/* Output taps, per tank half. The alternating signs and the way each channel
   draws from BOTH halves are what decorrelate L from R — this is where the
   stereo image comes from, so the signs are load-bearing. */
const T_PRE = [[353, 3627, 1990], [266, 2974, 2111]];
const T_DD2 = [[187, 1228], [335, 1913]];
const T_PST = [[1066, 2673], [121, 1996]];

function line(n) { var s = 1; while (s < n) s <<= 1; return { b: new Float32Array(s), m: s - 1, w: 0 }; }
/* fractional read, linear interpolation — needed both for SIZE scaling and for
   the modulated diffusers. Negative indices wrap correctly under & (two's complement). */
function rd(l, d) {
  var i = l.w - d, i0 = Math.floor(i), f = i - i0;
  var a = l.b[i0 & l.m], c = l.b[(i0 + 1) & l.m];
  return a + (c - a) * f;
}
/* one-multiply Schroeder allpass: v = x + g·v[n−M], y = v[n−M] − g·v */
function ap(l, d, g, x) {
  var dl = rd(l, d), v = x + g * dl;
  l.b[l.w & l.m] = v; l.w = (l.w + 1) | 0;
  return dl - g * v;
}
function dly(l, d, x) {
  var o = rd(l, d);
  l.b[l.w & l.m] = x; l.w = (l.w + 1) | 0;
  return o;
}

class Plate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var k = sampleRate / DREF, i;
    this.k = k;
    /* every line is allocated at 2x nominal so SIZE can scale up without
       reallocating, plus headroom for excursion and the interpolation read-ahead */
    var alloc = function (n) { return line(Math.ceil(n * k * 2) + 64); };

    this.pre  = line(Math.ceil(0.12 * sampleRate) + 64);      // 120ms of pre-delay
    this.din = []; this.dinD = [];
    for (i = 0; i < 4; i++) { this.din.push(alloc(N_IN[i])); this.dinD.push(N_IN[i] * k); }
    this.dd1 = []; this.dd1D = []; this.pd = []; this.pdD = [];
    this.dd2 = []; this.dd2D = []; this.pst = []; this.pstD = [];
    for (i = 0; i < 2; i++) {
      this.dd1.push(alloc(N_DD1[i])); this.dd1D.push(N_DD1[i] * k);
      this.pd .push(alloc(N_PRE[i])); this.pdD .push(N_PRE[i] * k);
      this.dd2.push(alloc(N_DD2[i])); this.dd2D.push(N_DD2[i] * k);
      this.pst.push(alloc(N_PST[i])); this.pstD.push(N_PST[i] * k);
    }
    this.tPre = T_PRE.map(function (r) { return r.map(function (v) { return v * k; }); });
    this.tDd2 = T_DD2.map(function (r) { return r.map(function (v) { return v * k; }); });
    this.tPst = T_PST.map(function (r) { return r.map(function (v) { return v * k; }); });

    this.bwS = 0; this.dampS = [0, 0];
    this.lfo0 = 0; this.lfo1 = 1.7;
    this.w0 = 2 * Math.PI * 0.93 / sampleRate;         // two slightly different rates so the
    this.w1 = 2 * Math.PI * 1.19 / sampleRate;         // halves never lock together

    /* target (t*) and smoothed (c*) parameter pairs */
    this.t = { size: 1, dec: 0.7, bw: 0.6, damp: 0.25, pdly: 0.02, exc: 16 * k, dif: 1, ig: 1 };
    /* Seed from processorOptions, which arrive with the constructor. postMessage is
       a queued round trip: an OfflineAudioContext renders faster than the message
       is delivered, so a short render would run entirely on defaults — and even in
       the live context the first block would. Starting `c` settled at `t` also means
       no audible glide up from the defaults on the very first sound. */
    var po = options && options.processorOptions;
    if (po) for (var q in po) if (q in this.t && typeof po[q] === 'number') this.t[q] = po[q];
    this.c = Object.assign({}, this.t);
    this.port.onmessage = function (e) {
      var d = e.data; for (var q in d) if (q in this.t) this.t[q] = d[q];
    }.bind(this);
  }

  process(inputs, outputs) {
    var out = outputs[0];
    if (!out || out.length < 2) return true;
    var L = out[0], R = out[1], n = L.length;
    var inp = inputs[0];
    var src = (inp && inp.length && inp[0] && inp[0].length) ? inp[0] : null;

    var t = this.t, c = this.c, S = 0.0008;             // ~40ms glide at 48k
    var din = this.din, dinD = this.dinD, dd1 = this.dd1, dd1D = this.dd1D;
    var pd = this.pd, pdD = this.pdD, dd2 = this.dd2, dd2D = this.dd2D;
    var pst = this.pst, pstD = this.pstD;
    var tPre = this.tPre, tDd2 = this.tDd2, tPst = this.tPst;

    for (var i = 0; i < n; i++) {
      c.size += (t.size - c.size) * S; c.dec  += (t.dec  - c.dec)  * S;
      c.bw   += (t.bw   - c.bw)   * S; c.damp += (t.damp - c.damp) * S;
      c.pdly += (t.pdly - c.pdly) * S; c.exc  += (t.exc  - c.exc)  * S;
      c.ig   += (t.ig   - c.ig)   * S; c.dif  += (t.dif  - c.dif)  * S;
      var sz = c.size, dec = c.dec, dmp = 1 - c.damp;

      var x = dly(this.pre, Math.max(1, c.pdly * sampleRate), src ? src[i] : 0) * c.ig;
      this.bwS += c.bw * (x - this.bwS); x = this.bwS;
      for (var j = 0; j < 4; j++) x = ap(din[j], dinD[j] * sz, G_IN[j] * c.dif, x);

      /* Both cross-feedback taps are read BEFORE either half is written, so the
         two halves see the same state. Reading half 1's feedback after half 0 has
         already advanced its write pointer would make the halves asymmetric. */
      var fb0 = rd(pst[0], pstD[0] * sz), fb1 = rd(pst[1], pstD[1] * sz);
      this.lfo0 += this.w0; this.lfo1 += this.w1;
      var e = c.exc;
      /* unipolar excursion: the line contracts from its nominal length rather than
         oscillating around it, so it can never read past the write pointer */
      var md0 = dd1D[0] * sz - e + e * (0.5 - 0.5 * Math.cos(this.lfo0));
      var md1 = dd1D[1] * sz - e + e * (0.5 - 0.5 * Math.cos(this.lfo1));

      var y0 = ap(dd1[0], md0, -G_DD1, x + fb1 * dec);
      y0 = dly(pd[0], pdD[0] * sz, y0);
      this.dampS[0] += dmp * (y0 - this.dampS[0]); y0 = this.dampS[0] * dec;
      y0 = ap(dd2[0], dd2D[0] * sz, G_DD2, y0);
      pst[0].b[pst[0].w & pst[0].m] = y0; pst[0].w = (pst[0].w + 1) | 0;

      var y1 = ap(dd1[1], md1, -G_DD1, x + fb0 * dec);
      y1 = dly(pd[1], pdD[1] * sz, y1);
      this.dampS[1] += dmp * (y1 - this.dampS[1]); y1 = this.dampS[1] * dec;
      y1 = ap(dd2[1], dd2D[1] * sz, G_DD2, y1);
      pst[1].b[pst[1].w & pst[1].m] = y1; pst[1].w = (pst[1].w + 1) | 0;

      L[i] = rd(pd[1], tPre[1][0] * sz) + rd(pd[1], tPre[1][1] * sz)
           - rd(dd2[1], tDd2[1][1] * sz) + rd(pst[1], tPst[1][1] * sz)
           - rd(pd[0], tPre[0][2] * sz) - rd(dd2[0], tDd2[0][0] * sz)
           + rd(pst[0], tPst[0][0] * sz);
      R[i] = rd(pd[0], tPre[0][0] * sz) + rd(pd[0], tPre[0][1] * sz)
           - rd(dd2[0], tDd2[0][1] * sz) + rd(pst[0], tPst[0][1] * sz)
           - rd(pd[1], tPre[1][2] * sz) - rd(dd2[1], tDd2[1][0] * sz)
           + rd(pst[1], tPst[1][0] * sz);
      L[i] *= 0.6; R[i] *= 0.6;
    }
    /* flush the damping states out of denormal range — a long quiet tail otherwise
       drags the whole audio thread down on some CPUs */
    if (this.dampS[0] > -1e-25 && this.dampS[0] < 1e-25) this.dampS[0] = 0;
    if (this.dampS[1] > -1e-25 && this.dampS[1] < 1e-25) this.dampS[1] = 0;
    if (this.lfo0 > 1e6) { this.lfo0 %= 2 * Math.PI; this.lfo1 %= 2 * Math.PI; }
    return true;
  }
}
registerProcessor('plate', Plate);
