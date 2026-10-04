#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Builds public/vtdict-tr.txt — the long vowels Turkish spelling does not show.

   VOICE SPEAK reads Turkish by rule (public/js/voice-tr.js). The rules cannot
   know that the second a of "adalet" is long; a reference can. This runs every
   word of a reference list through THE SAME rules the app runs and keeps only
   the words whose vowel lengths come out wrong — so the dictionary is, by
   construction, exactly what the rules lack, and nothing they already get right.

   Because of that it must be RE-RUN WHENEVER THE RULES CHANGE:

       node tools/build-vtdict-tr.js            fetch the pinned list, write the file
       node tools/build-vtdict-tr.js --check    rebuild in memory; exit 1 if the file differs
       node tools/build-vtdict-tr.js --stats    how the rules score, and what was decided
       … --src FILE                             read the list from disk instead of fetching

   Reference: WikiPron's Turkish list (pronunciations scraped from Wiktionary),
   pinned to one commit and one hash so the output is reproducible byte for byte.
   Wiktionary's text is CC BY-SA 4.0, and so is the file this writes — it says so
   in its own header. No dependencies; Node 18 or later (for fetch).
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const TR = require('../public/js/voice-tr.js');

const COMMIT = '1b6fce9d894e38eb65431676e4b2fcfc3db19db8';
const SRC_FILE = 'data/scrape/tsv/tur_latn_broad.tsv';
const SRC_URL = 'https://raw.githubusercontent.com/CUNY-CL/wikipron/' + COMMIT + '/' + SRC_FILE;
const SRC_SHA256 = '97161a54316c54c15549e5b6127c11aef8b65c213fea3f432f99459763085177';
const OUT = path.join(__dirname, '..', 'public', 'vtdict-tr.txt');

/* Hand-written, and they win over the reference. Same code the file uses:
   digits = which vowel letters are long (0 is the first), digits after "/" =
   long only when a suffix opens the syllable, "-" = none.

   Wiktionary's Turkish coverage is thin exactly where it hurts — everyday loans
   like zaman, kanun, mavi, dünya are missing or listed short — so this list is
   the commonest of those, each checked against the standard pronunciation
   (TDK's length marks). A wrong one costs one word; delete its entry, re-run.
   A trailing "!" marks a word that takes no suffixes (hâlâ, asla), so that
   it matches only itself: aslan is not asla + n. */
const OVERRIDES = {};
[
  /* the reference lists two readings and the rules pick the short one, or it has the word short */
  'devam:/1 selam:1 katil:0 hala:01! asla:1! dünya:1 hile:0 maden:0 hafız:0 haziran:1 endişe:1 define:1 muhafaza:1 muhacir:1 hatta:1!',
  /* not in the reference at all */
  'hafıza:0 şair:0 mavi:0 kaza:1 zira:01! zalim:0 acil:0 ifade:1 hadise:0 hakikat:1 hakim:0 dahil:0 aşık:0 alem:0 alim:0',
  'feda:1 gıda:1 eşya:1 taze:0 vade:0 gaye:0 sade:0 yani:0! ahali:1 ticari:1',
  'ali:0 isa:01 mustafa:2 ismail:1 yusuf:0 yunus:0 adem:0 nazım:0 kazım:0 salih:0 ziya:1 hatice:1 emine:1 esra:1',
  /* Long only before a vowel suffix: zaman is short, zamanı long. The reference
     marks this for 87 words and misses the commonest. */
  'zaman:/1 hesap:/1 cevap:/1 kitap:/1 mektup:/1 insan:/1 hayvan:/1 meydan:/1 ilaç:/1 ihtiyaç:/2 karar:/1 tekrar:/1',
  'bahar:/1 mezar:/1 kenar:/1 civar:/1 esas:/1 cihaz:/1 misal:/1 hayal:/1 ihtimal:/2 iptal:/1 ihmal:/1 evlat:/1 inat:/1',
  'meşhur:/1 mecbur:/1 memnun:/1 usul:/1 kabul:/1 meşgul:/1 hukuk:/1 vücut:/1 mevcut:/1 hudut:/1 umum:/1 sultan:/1',
  'fakir:/1 vezir:/1 esir:/1 delil:/1 tahlil:/1 teslim:/1 taklit:/1 tehdit:/1 şehit:/1 ümit:/1 nasip:/1 garip:/1',
  'tertip:/1 tebrik:/1 teşvik:/1 vekil:/1 intikam:/2 hal:/0 can:/0 ruh:/0 din:/0',
  /* both: a vowel that is always long, and a last one that a suffix lengthens */
  'kanun:0/1 iman:0/1 takip:0/1 tamir:0/1 tatil:0/1 tesir:0/1 mimar:0/1 malum:0/1 makul:0/1 icat:0/1 itibar:0/2 ilan:0/1'
].join(' ').split(' ').forEach(e => { const at = e.indexOf(':'); OVERRIDES[e.slice(0, at)] = e.slice(at + 1); });

/* Common roots that begin like a dictionary stem and are not inflections of it
   (kural is not kura + l). Without an entry of their own their inflections would
   find the stem: kural-ı reads as kura-lı. Words in the reference get this
   automatically; these are frequent ones the reference does not have. */
const BLOCK = 'kural metal kazan'.split(' ');

/* ── the reference's notation, folded onto the rules' own ───────────────────
   WikiPron mixes broad and narrow symbols freely (a/ɑ, l/ɫ, e/ɛ/æ, c/k …).
   Only LENGTH is taken from it, so everything else is folded until two
   transcriptions of the same word compare equal. */
const REF = { a: 'a', 'ɑ': 'a', 'ɐ': 'a', 'ʌ': 'a', 'ɒ': 'a', e: 'e', 'ɛ': 'e', 'æ': 'e', 'ə': 'e', i: 'i', 'ɪ': 'i', 'ɯ': 'ɯ', 'ɨ': 'ɯ',
  o: 'o', 'ɔ': 'o', 'ø': 'œ', 'œ': 'œ', u: 'u', 'ʊ': 'u', y: 'y', 'ʏ': 'y',
  b: 'b', d: 'd', f: 'f', 'ɸ': 'f', 'ɡ': 'g', g: 'g', 'ɟ': 'g', h: 'h', x: 'h', 'χ': 'h', 'ɦ': 'h', j: 'j', 'ɥ': 'j', k: 'k', c: 'k',
  l: 'l', 'ɫ': 'l', 'ʎ': 'l', m: 'm', n: 'n', 'ŋ': 'n', 'ɲ': 'n', p: 'p', 'ɾ': 'ɾ', r: 'ɾ', 'ɹ': 'ɾ', 'ʀ': 'ɾ', s: 's', 'ʃ': 'ʃ', t: 't',
  v: 'v', 'β': 'v', 'ʋ': 'v', w: 'v', z: 'z', 'ʒ': 'ʒ', 'dʒ': 'dʒ', 'tʃ': 'tʃ', 'ɣ': '', 'ɰ': '', 'ʔ': '' };
const OURS = { 'ɛ': 'e', c: 'k', 'ɟ': 'g', 'ŋ': 'n' };
const VOWEL = new Set(['a', 'e', 'ɯ', 'i', 'o', 'œ', 'u', 'y']);
const VOICED = { p: 'b', 'tʃ': 'dʒ', t: 'd' }, VOICED_LETTER = { b: 'b', 'dʒ': 'c', d: 'd' };
const HIGH = { 'ɯ': 'ı', i: 'i', u: 'u', y: 'ü' };

/* One reference pronunciation → [{p, long}], or null if it uses a symbol not in
   the table. Two identical neighbours are one long vowel (or one consonant):
   "s a a t" and "s aː t" are the same claim. */
function refSegs(pron) {
  const out = [];
  for (let t of pron.split(' ')) {
    const long = t.indexOf('ː') >= 0, glide = t.indexOf('̯') >= 0;
    /* ç and ö are single code points whose decomposition would turn them into c and o */
    t = t.replace(/ː/g, '').replace(/ç/g, 'h').replace(/ö/g, 'œ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʰʲʷ˕‿]/g, '');
    if (t === '') continue;
    const s = REF[t];
    if (s === undefined) return null;
    if (s === '' || glide) continue;
    const prev = out[out.length - 1];
    if (prev && prev.p === s) { if (VOWEL.has(s)) prev.long = true; continue; }
    out.push({ p: s, long: long && VOWEL.has(s) });
  }
  return out;
}
function ourSegs(g) { return g.ph.map((p, i) => { const q = OURS[p] || p; return { p: q, long: VOWEL.has(q) && g.len[i] > 1, src: g.src[i] }; }); }
const skel = a => a.map(x => x.p).join(' ');
const isVL = c => 'aeıioöuüâîû'.indexOf(c) >= 0;
function longAt(g) { const s = new Set(); g.ph.forEach((p, i) => { if (g.len[i] > 1 && VOWEL.has(OURS[p] || p)) s.add(g.src[i]); }); return s; }
function ordinal(w, at) { let n = 0; for (let i = 0; i < at; i++) if (isVL(w[i])) n++; return n; }
function encode(w, t) {
  const f = list => list.map(at => { const o = ordinal(w, at); if (o > 9) throw new Error('vowel ' + o + ' of ' + w + ' does not fit one digit'); return o; }).sort().join('');
  return (f(t.always) + (t.open.length ? '/' + f(t.open) : '')) || '-';
}
function decode(w, code) {
  const vl = []; for (let i = 0; i < w.length; i++) if (isVL(w[i])) vl.push(i);
  const part = code === '-' ? [] : code.replace('!', '').split('/'), get = s => (s || '').split('').map(d => vl[+d]);
  return { always: get(part[0]), open: get(part[1]) };
}

/* A remainder that is unmistakably inflection. When a derived word in the
   reference lacks a length its own stem has (daire is long, "daireler" is
   written short) the reference is being inconsistent, and with one of these
   the stem is believed. Anything looser — a bare vowel, -ye, -de — is how
   türki + ye and adap + te look, and there the word's own entry is believed. */
/* Endings tried on every word to see whether a stem would misread its
   inflections (both harmonies: loans often take the front one). */
const PROBE = ['ı', 'i', 'u', 'ü', 'a', 'e', 'ın', 'in', 'un', 'ün', 'ım', 'im', 'lar', 'ler', 'da', 'de', 'dan', 'den', 'yı', 'yi', 'ya', 'ye',
  'nın', 'nin', 'sı', 'si', 'lı', 'li', 'm', 'n', 'mız', 'miz', 'sın', 'sin', 'dı', 'di', 'la', 'le'];
const PLAIN = /^(?:l[ae]r(?:[ıiuü]n?|[ae]|[dt][ae]n?)?|l[ıiuü](?:k|ğ[ıiuü])?|s[ıiuü]z(?:l[ıiuü]k)?|[cç][ıiuü](?:k|l[ıiuü]k)?|y[ıiuü]|s[ıiuü](?:n[ıiuü]n?|n[ae]|n[dt][ae]n?)?|n[ıiuü]n|l[ae](?:m[ae]k|[şn]t[ıiuü]rm[ae]k))$/;

function build(tsv) {
  const stats = { lines: 0, skipped: 0, words: 0, exact: 0, lengthOnly: 0, other: 0, unknownSymbol: 0, trusted: [], twoReadings: [], oddSuffixed: [], suffixedWins: [] };
  const byWord = new Map(), proper = new Map();
  for (const line of tsv.split('\n')) {
    if (!line) continue; stats.lines++;
    const tab = line.indexOf('\t'), sp = line.slice(0, tab);
    /* single words in the Turkish alphabet only: no apostrophes, hyphens, spaces */
    if (tab < 1 || !/^[A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû]+$/.test(sp)) { stats.skipped++; continue; }
    const w = TR.key(TR.lower(sp));
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(line.slice(tab + 1));
    /* a name: its suffixes follow an apostrophe (Hatay'da), so it must not act as a stem — hata-ydı */
    proper.set(w, (proper.has(w) ? proper.get(w) : true) && /^[A-ZÇĞİÖŞÜÂÎÛ]/.test(sp));
  }
  stats.words = byWord.size;

  /* 1. What does each word need beyond the rules? */
  TR.dict(Object.create(null));
  const words = new Map();
  for (const [w, prons] of byWord) {
    const g = TR.g2p(w), o = ourSegs(g), sk = skel(o);
    let exact = false, bare = null, suff = null;
    for (const pron of prons) {
      const r = refSegs(pron);
      if (!r) { stats.unknownSymbol++; continue; }
      if (skel(r) === sk) { if (r.every((x, i) => x.long === o[i].long)) exact = true; else if (!bare) bare = r; continue; }
      /* the accusative, which Wiktionary gives for stems that lengthen in it: hayat, hayatı */
      const n = o.length;
      if (!suff && r.length === n + 1 && HIGH[r[n].p] && !VOWEL.has(o[n - 1].p) && skel(r.slice(0, n - 1)) === skel(o.slice(0, n - 1)) &&
        (r[n - 1].p === o[n - 1].p || r[n - 1].p === VOICED[o[n - 1].p])) suff = r;
    }
    if (!exact && !bare && !suff) { stats.other++; continue; }
    if (exact) stats.exact++; else if (bare) stats.lengthOnly++; else stats.other++;
    if (exact && bare) stats.twoReadings.push(w);
    const t = { rules: longAt(g), always: [], open: [], suffixed: null, trusted: false, proper: proper.get(w) };
    /* a reading the rules already give wins over a second, longer one (hala, katil): the override list decides those */
    if (!exact && bare) o.forEach((x, i) => { if (bare[i].long && !x.long) t.always.push(x.src); });
    if (suff) {
      const n = o.length, lastV = n - 2;
      o.forEach((x, i) => {
        if (!suff[i].long || x.long || t.always.indexOf(x.src) >= 0) return;
        if (i === lastV && VOWEL.has(x.p)) t.open.push(x.src); else { t.always.push(x.src); stats.oddSuffixed.push(w); }
      });
      if (t.open.length) {
        const v = suff[n - 1].p !== o[n - 1].p ? VOICED_LETTER[suff[n - 1].p] : w[w.length - 1];
        t.suffixed = w.slice(0, -1) + v + HIGH[suff[n].p];
      }
    }
    words.set(w, t);
  }
  /* "teşhis" is listed with its accusative teşhisi long, and "teşhisi" separately, short. The
     accusative under the stem is there precisely because it lengthens, so it is the one believed. */
  for (const t of words.values()) {
    const u = t.suffixed && words.get(t.suffixed);
    if (u) for (const at of t.open) if (!u.rules.has(at) && u.always.indexOf(at) < 0) { u.always.push(at); stats.suffixedWins.push(t.suffixed); }
  }
  for (const w of Object.keys(OVERRIDES)) {
    const d = decode(w, OVERRIDES[w]), t = words.get(w) || { rules: longAt(TR.g2p(w)), trusted: false };
    t.always = d.always; t.open = d.open; t.override = true;
    /* The form to prove a suffix-opened vowel on: stem + accusative. Loans often take the
       front vowel after a back one (hal, hali), and the harmonic form may be another word
       altogether (halı, a carpet) - so take whichever is not itself in the reference. */
    const last = w.replace(/[^aeıioöuüâîû]/g, '').slice(-1), acc = { a: 'ıi', 'â': 'ıi', 'ı': 'ıi', e: 'iı', i: 'iı', 'î': 'iı', o: 'uü', u: 'uü', 'û': 'uü', 'ö': 'üu', 'ü': 'üu' }[last];
    const soft = { p: 'b', 'ç': 'c', t: 'd' }[w.slice(-1)], stems = soft ? [w.slice(0, -1) + soft, w] : [w];
    t.suffixed = null;
    if (d.open.length) for (const v of acc) for (const st of stems) if (!t.suffixed && !byWord.has(st + v)) t.suffixed = st + v;
    words.set(w, t);
  }

  /* 2. Shortest first. A word gets an entry only if having one changes how it,
        or one of its common inflections, is read — so a stem that already says
        the right thing makes it unnecessary, and a stem that would say
        something false makes an empty one ("-") necessary: bayan, else
        bayan-ın reads as baya-nın. */
  const D = Object.create(null); TR.dict(D);
  for (const w of BLOCK) D[w] = '-';
  for (const w of Object.keys(OVERRIDES)) D[w] = OVERRIDES[w];
  const openOk = t => !t.open.length || !t.suffixed || (g => t.open.every(at => g.len[g.src.indexOf(at)] > 1))(TR.g2p(t.suffixed));
  const say = x => { const g = TR.g2p(x); return g.ph.map((p, i) => p + (g.len[i] > 1 ? 'ː' : '')).join(' '); };
  const probe = (w, t) => {
    if (t.proper) return say(w);
    const out = [w].concat(PROBE.map(p => w + p)), soft = { p: 'b', 'ç': 'c', t: 'd', k: 'ğ' }[w.slice(-1)];
    if (soft) for (const v of 'ıiuüae') out.push(w.slice(0, -1) + soft + v);
    return out.map(say).join('|');
  };
  const order = [...words.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const w of order) {
    const t = words.get(w);
    if (t.override || D[w] !== undefined) continue;
    const code = encode(w, t) + (t.proper ? '!' : ''), without = probe(w, t);
    D[w] = code; const withIt = probe(w, t); delete D[w];
    if (withIt === without) continue;
    /* daireler is listed short although daire is long: when the rest is plainly
       an inflection, the stem is believed over the derived word's own line */
    const f = TR.dictFind(w), got = longAt(TR.g2p(w)), want = [...t.rules, ...t.always];
    if (f && f.n < w.length && f.code !== '-' && PLAIN.test(w.slice(f.n)) && want.every(x => got.has(x)) && openOk(t)) { t.trusted = true; stats.trusted.push(w); continue; }
    D[w] = code;
  }

  /* 3. Prove it: every word comes out as the reference has it. */
  for (const [w, t] of words) {
    const got = longAt(TR.g2p(w));
    for (const at of [...t.rules, ...t.always]) if (!got.has(at)) throw new Error('self-check: ' + w + ' lost a long vowel');
    if (!t.trusted) for (const at of got) if (!t.rules.has(at) && t.always.indexOf(at) < 0) throw new Error('self-check: ' + w + ' gained a long vowel');
    if (!openOk(t)) throw new Error('self-check: ' + t.suffixed + ' is not long');
  }

  /* 4. Front-coded, in code-unit order (never locale order: this must come out
        the same on every machine). */
  const keys = Object.keys(D).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const body = []; let prev = '';
  for (const k of keys) {
    let n = 0; while (n < 25 && n < prev.length && n < k.length && prev[n] === k[n]) n++;
    body.push(String.fromCharCode(97 + n) + k.slice(n) + ' ' + D[k]); prev = k;
  }
  const head = [
    '# VOICE SPEAK, Turkish: which vowels are long. GENERATED by tools/build-vtdict-tr.js - do not edit.',
    '# line = <a letter: how many characters this word shares with the one above><the rest of it> <code>',
    '# code = which vowel letters are long, 0 being the first; after "/" = long only when a suffix opens',
    '#        the syllable (hayat, hayatı); "-" = none (stops a shorter stem from matching).',
    '# Source: pronunciations from Wiktionary (https://en.wiktionary.org), as collected by WikiPron',
    '#   (https://github.com/CUNY-CL/wikipron, commit ' + COMMIT + ', ' + SRC_FILE + '),',
    '#   compared with the rules in public/js/voice-tr.js; plus ' + Object.keys(OVERRIDES).length + ' hand-written entries.',
    '# Licence: adapted from Wiktionary, and available under CC BY-SA 4.0',
    '#   (https://creativecommons.org/licenses/by-sa/4.0/), as Wiktionary is.'
  ];
  stats.entries = keys.length; stats.blockers = keys.filter(k => D[k] === '-').length;
  stats.withOpen = keys.filter(k => D[k].indexOf('/') >= 0).length; stats.overrides = Object.keys(OVERRIDES).length;
  return { text: head.concat(body).join('\n') + '\n', words, stats, dict: D };
}

async function source(file) {
  let buf;
  if (file) buf = fs.readFileSync(file);
  else { const r = await fetch(SRC_URL); if (!r.ok) throw new Error('fetching ' + SRC_URL + ': ' + r.status); buf = Buffer.from(await r.arrayBuffer()); }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== SRC_SHA256) throw new Error('source hash mismatch: got ' + sha + ', pinned ' + SRC_SHA256 + '. This is not the pinned list; the dictionary would not be reproducible.');
  return buf.toString('utf8');
}

async function main(argv) {
  const at = argv.indexOf('--src'), tsv = await source(at >= 0 ? argv[at + 1] : null);
  const b = build(tsv), s = b.stats;
  if (argv.includes('--stats')) {
    const usable = s.exact + s.lengthOnly, pct = n => (100 * n / s.words).toFixed(1) + '%';
    console.log('reference: ' + s.lines + ' lines, ' + s.words + ' words (' + s.skipped + ' lines skipped: not a single word in the Turkish alphabet)');
    console.log('rules alone: exact ' + s.exact + ' (' + pct(s.exact) + '), wrong only in vowel length ' + s.lengthOnly + ' (' + pct(s.lengthOnly) + '), different otherwise ' + s.other + ' (' + pct(s.other) + ')');
    console.log('dictionary: ' + s.entries + ' entries; ' + s.withOpen + ' carry a suffix-opened vowel; ' + s.blockers + ' are empty (they block a shorter stem); ' + s.overrides + ' hand-written');
    console.log('stem believed over the derived word\'s own entry (' + s.trusted.length + '): ' + s.trusted.join(' '));
    console.log('two readings, the rules\' one kept (' + s.twoReadings.length + '): ' + s.twoReadings.join(' '));
    console.log('suffixed form long on a vowel that is not the last (' + s.oddSuffixed.length + '): ' + s.oddSuffixed.join(' '));
    console.log('accusative under the stem believed over its own separate entry (' + s.suffixedWins.length + '): ' + s.suffixedWins.join(' '));
    void usable;
  }
  if (argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (cur !== b.text) { console.error('public/vtdict-tr.txt is out of date: run node tools/build-vtdict-tr.js'); process.exitCode = 1; return; }
    console.log('public/vtdict-tr.txt is up to date (' + s.entries + ' entries)'); return;
  }
  if (argv.includes('--stats') && !argv.includes('--write')) return;
  fs.writeFileSync(OUT, b.text);
  console.log('wrote public/vtdict-tr.txt: ' + s.entries + ' entries, ' + Buffer.byteLength(b.text) + ' bytes');
}

module.exports = { build, reference: tsv => build(tsv).words, OVERRIDES };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
