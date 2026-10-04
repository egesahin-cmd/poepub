// Probe values for the round-trip check in rows.mjs: for each row, set(p) then get() must equal p.
// Every registered row must appear here or in EXEMPT, so a new row cannot skip the check.
export const PROBES = {
  // stage 1
  'rs.on': [1, 0], 'bb.on': [1, 0], 'ns.on': [1, 0], 'mu.on': [1, 0],
  'app.vol': [0, 37, 100],
  // stage 2: MIXER
  'mx.voice': [0, 37, 100], 'mx.multi': [0, 37, 100], 'mx.birdbox': [0, 37, 100], 'mx.noise': [0, 37, 100],
  'app.auto': [0, 1], 'app.lim': [0, 1],
  // stage 2: NOISE
  'ns.spd': [0, 1234, 4000],
  'ns.vr': [[10, 20], [66, 100]], 'ns.vr.on': [1, 0],
  'ns.rf.on': [1, 0], 'ns.rf.q': [1, 57.33, 200, 12], 'ns.rf.mix': [0, 57, 100], 'ns.rf.tilt': [-100, -37, 100, 40],
  'ns.rf.spr': [-100, 25, 100, 0], 'ns.rf.oct': [-4, 3, 0], 'ns.rf.bands': [[5, 9], [7, 7], [1, 32]], 'ns.rf.open': [1, 0],
  'ns.vs.on': [1, 0], 'ns.vs.auto': [1, 0], 'ns.vs.a': [0.25, 0.001], 'ns.vs.b': [0.5, 10], 'ns.vs.dur': [0.01, 300, 12.5],
  'ns.vs.dir': ['rev', 'pp', 'fwd'], 'ns.vs.fader': [0, 333, 1000], 'ns.vs.env': [[0.5, 0.01], [0.002, 0.15]], 'ns.vs.open': [1, 0],
  // stage 3: TONE GEN
  'rs.wv': [2, 3, 0], 'rs.freq': [523.25, 1, 20000, 440], 'rs.fqb': [1200.5, 8000], 'rs.vol': [0, 55, 100, 70],
  'rs.sw.on': [1, 0], 'rs.sw.dur': [0.1, 12.3, 60, 4], 'rs.sw.type': ['wobble', 'surge', 'linear'], 'rs.sw.dir': ['rev', 'pp', 'fwd'],
  'rs.vp.on': [1, 0], 'rs.vp.dur': [0.1, 60, 4], 'rs.vp.type': ['log', 'linear'], 'rs.vp.dir': ['pp', 'fwd'],
  // stage 3: anchors (row level, in local time; the clock conversion is unit-tested)
  'rs.sw.t0': [1000.5, 0], 'rs.vp.t0': [2000.25, 0], 'ns.vs.t0': [3000.75, 0],
  // stage 3: BIRDBOX
  'bb.tempo': [0, 5000.5, 10000, 2140], 'bb.range': [[3, 7], [1, 32]], 'bb.filt': [[10, 90], [0, 100]], 'bb.pause': [[20, 60], [0, 100]],
  'bb.durh': [1, 0], 'bb.fqr': [2.5, 1], 'bb.shape': [['wobble', 'l2'], ['linear', 'r1']],
  // stage 4: MATHS
  'mu.fund': [110, 49], 'mu.wv': [1, 3, 0], 'mu.hi': [3, 0, 1],
  'mu.dur': [0.1, 12.34, 30, 5], 'mu.vrate': [0.05, 7.5, 60, 5], 'mu.vr': [[10, 40], [65, 100]],
  'mu.vco': [1, 0], 'mu.auto': [0, 1], 'mu.fmd': [0, 80, 100, 50], 'mu.filt': [[20, 70], [0, 100]], 'mu.filt.on': [1, 0], 'mu.set.open': [1, 0],
  'mu.vs.on': [1, 0], 'mu.vs.perosc': [0, 1], 'mu.vs.auto': [1, 0], 'mu.vs.a': [0.2, 0.001], 'mu.vs.b': [3, 10], 'mu.vs.dur': [2.5, 10],
  'mu.vs.dir': ['pp', 'fwd'], 'mu.vs.fader': [300, 500], 'mu.vs.env': [[0.3, 0.02], [0.002, 0.15]], 'mu.vs.open': [1, 0], 'mu.vs.t0': [4000.5, 0],
  // the operator list: [masterId, cell, ratio, wave (-1 = follow the module), muted, target Hz]
  'mu.ops': [
    [[901, 0, 3, -1, 0, 147], [902, 5, 2, 1, 1, 98]],
    [[902, 6, 2, 1, 0, 98], [903, 1, 5, -1, 0, 245], [904, 2, 7, 2, 0, 343]],     // 902 moves and unmutes, 901 goes, two arrive
  ],
  'mu.hold': [[6, 42], null],                                                       // [cell, level] of the selected operator
  // stage 4: the FX rack. Sends are 0..100 per mixer channel; COMP alone has one on the master strip.
  'fx.drive.voice': [35, 0], 'fx.drive.multi': [100, 0], 'fx.drive.birdbox': [12, 0], 'fx.drive.noise': [77, 0],
  'fx.comp.voice': [35, 0], 'fx.comp.multi': [100, 0], 'fx.comp.birdbox': [12, 0], 'fx.comp.noise': [77, 0], 'fx.comp.master': [50, 0],
  'fx.verb.voice': [35, 0], 'fx.verb.multi': [100, 0], 'fx.verb.birdbox': [12, 0], 'fx.verb.noise': [77, 0],
  'fx.drive.on': [0, 1], 'fx.drive.type': [3, 1, 0], 'fx.drive.mode': ['direct', 'send'], 'fx.drive.drive': [0, 100, 45], 'fx.drive.crush': [60, 0], 'fx.drive.tone': [20, 100],
  'fx.comp.on': [0, 1], 'fx.comp.type': [2, 0], 'fx.comp.squash': [0, 100, 45], 'fx.comp.speed': [80, 30], 'fx.comp.makeup': [-12, 12, 0],
  'fx.verb.on': [0, 1], 'fx.verb.type': [0, 3, 2], 'fx.verb.mode': ['direct', 'send'], 'fx.verb.size': [10, 52], 'fx.verb.decay': [100, 68], 'fx.verb.tone': [5, 71],
  // stage 5: VOICE and SPEAK
  'vt.oto': [1, 0], 'vt.free': [1, 0], 'vt.wob': [1, 0], 'vt.av': [1, 0],
  'vt.spk.text': ['merhaba dünya', 'hello'], 'vt.spk.lang': ['tr', 'en'], 'vt.spk.rate': [0.6, 1.8, 1.44], 'vt.spk.loop': [1, 0],
};
// Trigger counters: not state, nothing to round-trip.
// 'vt.spk' is an event too: [speaking, starts, cuts].
export const EXEMPT = ['ns.roll', 'bb.roll', 'vt.spk'];
