/* ═══════════════════════════════════════════════════════════════════════════
   VOICE SPEAK — Turkish language pack.

   Classic script, loaded after the inline block; it registers itself with
   vtSpkLangReg (index.html, "languages"), which is the only thing it touches.
   If this file fails to load the language toggle simply never appears.

   Turkish is NOT the English table with a different dictionary. Measured on the
   shipped tract, four things in the English setup destroy it, and each has its
   answer here:

     rounding   A rounded vowel's lip constriction used to become effective in
                the vowel's last third, so at mid-vowel ü measured as i, ö as e
                and u as ı — and Turkish separates those pairs by rounding
                alone. `lead` makes the compiler set the lip (and throat) target
                on the rows before the vowel.
     timing     English vowels spend 70ms arriving and 15ms there. Eight short
                monophthongs smear into each other that way; the same length
                split 30 + 50 puts every one of them on target by its midpoint.
     tongue     The English consonants pin a tongue shape of their own. Between
                two /n/ an /i/ came out as a back vowel — in Turkish that is a
                different suffix. Here a consonant states only the constriction
                that makes it, and the tongue body stays the vowels' business.
     r          A tap. The tract cannot close and reopen inside one audio block
                reliably, so its audible part is a brief dip in the VOICE
                (sub-target `vo`) riding on a near-closure that never reaches
                zero and therefore fires no burst.

   Vowel targets are real tract values, not table-space: `expI/expD` of 1 turn
   the English clear-speech expansion off, since with this timing the vowels
   arrive. They were fitted at 48kHz against Malkoç (2009), ten male speakers of
   standard Turkish — the tract's formants scale with the sample rate (8.8%
   between 44.1 and 48kHz) and 48 is what phones and most machines run at.

   ü and ö carry a throat constriction. Tongue and lips cannot move F3 in this
   tract; narrowing the pharynx does, and it stands in for the lowered larynx
   that gives front rounded vowels their low F3.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
/* ═══ text → tokens ═══════════════════════════════════════════════════════════
   Turkish spelling says nearly everything, so this is rules where English needs
   a 20,000-word dictionary. Against 11,430 reference words (Wiktionary, via
   WikiPron) the rules alone reproduce 87% exactly, and what is left is almost
   all ONE thing — a long vowel the spelling does not show — which a small
   exception dictionary supplies.

   Every lookup table here is prototype-free: someone will type "constructor". */
function table(pairs){var o=Object.create(null);for(var i=0;i<pairs.length;i+=2)o[pairs[i]]=pairs[i+1];return o;}
function set(words){var o=Object.create(null),a=words.split(' ');for(var i=0;i<a.length;i++)o[a[i]]=1;return o;}

var VOW='aeıioöuü',FRONT='eiöü';
function isV(c){return c!==undefined&&VOW.indexOf(c)>=0;}
function isVL(c){return isV(c)||c==='â'||c==='î'||c==='û';}   /* as spelled */
var MAP=table(['a','a','e','e','ı','ɯ','i','i','o','o','ö','œ','u','u','ü','y',
  'b','b','c','dʒ','ç','tʃ','d','d','f','f','g','g','h','h','j','ʒ','k','k','l','l','m','m','n','n',
  'p','p','r','ɾ','s','s','ş','ʃ','t','t','v','v','y','j','z','z']);
var VPH=set('a e ɛ ɯ i o œ u y'),STOPS=set('p b t d k g c ɟ');
/* Hold multipliers. `len` scales only the hold, so 2.0 on a 30+50ms vowel is
   130ms: the ×1.6 measured for a lexical long vowel. ğ, and two vowels merged
   across a ğ, run longer (×2 measured). A doubled stop is a long closure —
   ×2.9 in the literature; a doubled anything else less. */
var LONG=2.0,GH=2.6,GEM=1.8,GEM_STOP=2.6;

/* Default toLowerCase() gives "I" → "i" and "İ" → "i" + U+0307, both wrong
   here. toLocaleLowerCase('tr') would do it, but depends on the browser's ICU. */
function lower(s){return s.replace(/I/g,'ı').replace(/İ/g,'i').toLowerCase().replace(/\u0307/g,'');}

/* Words that lean on their neighbours: no accent, a little shorter and lower. */
var FN=set('ve ile de da ki ya ise bile için gibi kadar ama fakat çünkü veya diye bir');
/* The question particle, with whatever person and tense it carries. */
var MI=/^m[ıiuü](?:y[ıiuü]m|s[ıiuü]n(?:[ıiuü]z)?|y[ıiuü]z|d[ıiuü]r(?:l[ae]r)?|yd[ıiuü](?:m|n|k|n[ıiuü]z|l[ae]r)?|ym[ıiuü]ş(?:[ıiuü]m|s[ıiuü]n|[ıiuü]z|s[ıiuü]n[ıiuü]z|l[ae]r)?)?$/;
function isFn(w){return FN[w]===1||MI.test(w);}

/* Stress is final unless a word says otherwise, and these do: place names,
   adverbs and question words, kinship terms, old loans, language names in -ce.
   The number is the stressed vowel, counted from 0. Stress in Turkish is a small
   pitch move and little else, so a wrong guess costs naturalness, not the word —
   which is why suffix morphology (gelme, güzelce, öğrenciydi) is not attempted. */
var EXC=Object.create(null);
('ankara:0 istanbul:1 izmir:0 türkiye:0 bursa:0 adana:1 antalya:1 konya:0 edirne:1 malatya:1 mersin:0 '+
 'trabzon:0 samsun:0 erzurum:0 kayseri:0 sivas:0 manisa:1 tokat:0 sinop:0 bodrum:0 marmaris:0 üsküdar:1 '+
 'kapadokya:2 kıbrıs:0 avrupa:1 asya:0 afrika:0 amerika:1 almanya:1 fransa:0 ingiltere:2 italya:1 rusya:0 '+
 'japonya:1 londra:0 '+
 'şimdi:0 belki:0 yarın:0 bugün:0 ancak:0 yalnız:0 sonra:0 önce:0 hemen:0 henüz:0 şöyle:0 böyle:0 öyle:0 '+
 'sanki:0 ayrıca:0 sadece:0 yine:0 gene:0 hatta:0 mutlaka:0 elbette:1 lütfen:0 haydi:0 hadi:0 hayır:0 '+
 'nasıl:0 nasılsın:0 nasılsınız:0 niçin:0 niye:0 neden:0 hangi:0 hangisi:0 hani:0 nerede:0 nereye:0 nereden:0 '+
 'burada:0 şurada:0 orada:0 buraya:0 oraya:0 buradan:0 oradan:0 '+
 'merhaba:0 günaydın:1 '+
 'anne:0 teyze:0 hala:0 amca:0 dayı:0 abla:0 abi:0 '+
 'masa:0 lokanta:1 banka:0 iskemle:1 taksi:0 futbol:0 pencere:0 politika:2 radyo:0 sinema:1 tiyatro:1 '+
 'gazete:1 fabrika:0 lamba:0 posta:0 pasta:0 salata:1 domates:1 patates:1 çikolata:2 limonata:2 makarna:1 '+
 'müzik:0 tabela:1 opera:0 piyano:1 '+
 'türkçe:0 ingilizce:2 almanca:1 fransızca:1 arapça:1 rusça:0 ispanyolca:2 japonca:1 kürtçe:0 farsça:0 '+
 'italyanca:2 yunanca:1').split(' ').forEach(function(e){var p=e.split(':');EXC[p[0]]=+p[1];});

/* ── long vowels the spelling hides ──────────────────────────────────────────
   adalet, aile, alet: nothing written says the a is long. public/vtdict-tr.txt
   supplies that — about a thousand stems, generated by tools/build-vtdict-tr.js
   from the words these rules get wrong against Wiktionary's pronunciations.
   An entry never states sounds, only WHICH vowel letters of a stem are long:

       adalet 1     the second vowel
       hayat /1     the second vowel, but only once a suffix opens its syllable:
                    hayat is short, hayatı long (zaman, hesap, kitap likewise)
       bayan -      none; it is there so that "baya" + nın is not found instead
       asla 1!      takes no suffixes, so it matches only itself; place names are
                    all like this, since their suffixes follow an apostrophe

   Turkish words arrive inflected, so lookup is by stem: the word itself, else
   the longest entry it starts with, provided what follows reads as suffixes. */
var DICT=Object.create(null),MIN_STEM=3;
function dictLoad(text){
  var d=Object.create(null),lines=String(text).split('\n'),prev='';
  for(var i=0;i<lines.length;i++){
    /* front-coded, like vtdict.txt: the first letter counts the characters
       shared with the line before */
    var ln=lines[i],sp=ln.indexOf(' '),n=ln.charCodeAt(0)-97;
    if(sp<1||n<0||n>25)continue;
    var w=prev.slice(0,n)+ln.slice(1,sp),code=ln.slice(sp+1);
    if(!/^(?:-|\d+|\d*\/\d+)!?$/.test(code))continue;
    d[w]=code;prev=w;
  }
  DICT=d;
}
/* What may follow a stem. Deliberately not a morphology — just enough shape to
   tell aile-miz-de from alaka-rga, and kural-ı from kura + lı. Each form says
   where it may stand: after a vowel (v), a consonant (c), either (b), or (w)
   after a vowel that is either the stem's own (aile-m, hata-n) or a suffix's
   high one (geldi-m, evi-n-de). And each has a level: 0 derivation, plural,
   possessive; 1 case; 2 copula. Levels only go up, so a case ending is never
   followed by a possessive (hal-a-mız is not a word; hala-mız is). */
var SUFS=(function(){
  var A='[ae]',I='[ıiuü]',D='[dt]',K='[kğ]',out=[];
  function add(where,level,from,list){
    for(var i=0;i<list.length;i++)out.push([new RegExp('^'+list[i]),where,level,from]);}
  add('b',0,0,['l'+A+'r','l'+I,'l'+I+K,'s'+I+'z','[cç]'+I,'c'+I+K,'d'+A+'ş','s'+A+'l']);
  add('v',0,0,['s'+I,'[mn]'+I+'z']);
  add('c',0,0,[I,I+'[mn]',I+'[mn]'+I+'z',I+'nc'+I]);
  add('w',0,0,['[mn]']);
  add('v',1,0,['y'+I,'y'+A,'yl'+A,'n'+I+'n']);
  add('c',1,0,[A,'en','l'+A]);
  add('w',1,0,['n'+I,'n'+A,'n'+D+A,'n'+D+A+'n']);
  add('b',1,0,[D+A,D+A+'n','[cç]'+A]);
  add('v',2,0,['y'+D+I,'ym'+I+'ş','ys'+A,'ys'+A+'[mnk]','yken','y'+I+'[mz]']);
  add('c',2,0,[D+I,'m'+I+'ş','s'+A,'s'+A+'[mnk]','ken',I+'z']);
  add('b',2,0,[D+I+'r','s'+I+'n','s'+I+'n'+I+'z']);
  /* person and plural after a copula: ydı-m, mış-sın, dır-lar */
  add('w',2,2,['[mnk]']);
  add('v',2,2,['[mn]'+I+'z']);
  add('c',2,2,[I+'[mnz]']);
  add('b',2,2,['l'+A+'r',D+I,D+I+'r','s'+I+'n','s'+I+'n'+I+'z']);
  return out;
})();
var HIGH='ıiuü';
/* Remembered per lookup on (how much is left, the letter before it, first,
   level): without that, a run of look-alike suffixes (-im-im-im…) backtracks
   exponentially and one typed word freezes the tab for seconds. */
function suffixLike(rest,prev,first,z,memo){
  if(!rest)return !first;
  memo=memo||Object.create(null);
  var key=rest.length+'|'+prev+'|'+(first?1:0)+'|'+z;
  if(key in memo)return memo[key];
  return(memo[key]=suffixTry(rest,prev,first,z,memo));
}
function suffixTry(rest,prev,first,z,memo){
  /* A noun made a verb (imza-la-, endişe-len-, sakin-leş-) conjugates every
     which way; past that point anything goes. */
  if(first&&/^l(?:[ae][nşt]?|[ıiuü]yor)/.test(rest))return true;
  if(first&&rest.slice(0,2)==='ki'&&suffixLike(rest.slice(2),'i',false,0,memo))return true;
  var v=isVL(prev),hi=first?v:HIGH.indexOf(prev)>=0;
  for(var i=0;i<SUFS.length;i++){
    var r=SUFS[i],k=r[1];
    if(k==='c'?v:(k==='v'?!v:(k==='w'&&!hi)))continue;
    if(z<r[3]||z>r[2])continue;
    var m=r[0].exec(rest);
    if(m&&suffixLike(rest.slice(m[0].length),m[0].charAt(m[0].length-1),false,r[2],memo))return true;
  }
  /* -ki (evde-ki, onun-ki) turns what came before back into a noun */
  if(!first&&z<=1&&rest.slice(0,2)==='ki')return suffixLike(rest.slice(2),'i',false,0,memo);
  return false;
}
/* Suffix vowels agree with each other, front or back — not necessarily with the
   stem: saat-ler-i, hal-i, rol-ü. -yor, -ki and -ken never change. */
function harmonic(rest){var r=rest.replace(/yor|ki|ken/g,'');return !(/[aıou]/.test(r)&&/[eiöü]/.test(r));}
var DEVOICE=table(['b','p','c','ç','d','t','ğ','k','g','k']);
/* An entry ending in "!" is a word that takes no suffixes (hâlâ, asla, hatta):
   it matches only itself, so aslan is not asla + n. */
function dictFind(w){
  var code=DICT[w];
  if(code!==undefined)return{n:w.length,code:code.replace('!','')};
  for(var n=w.length-1;n>=MIN_STEM;n--){
    var stem=w.slice(0,n),rest=w.slice(n),last=stem.charAt(n-1);
    code=DICT[stem];
    /* kitap → kitabı, ilaç → ilacı, renk → rengi: entries are spelled voiceless */
    if(code===undefined&&isV(rest.charAt(0))&&DEVOICE[last])code=DICT[stem.slice(0,n-1)+DEVOICE[last]];
    if(code===undefined)continue;
    if(code.charAt(code.length-1)==='!')continue;
    if(suffixLike(rest,last,true,0)&&harmonic(rest))return{n:n,code:code};
  }
  return null;
}
/* q w x never appear in a Turkish word; a dictionary key is spelled after this */
function loan(s){return s.replace(/q/g,'k').replace(/w/g,'v').replace(/x/g,'ks');}

/* One word, already lower-cased → {ph, stress, len}. An apostrophe marks where a
   proper noun stops and its suffixes start (Ankara'da), which is exactly what
   the exception lookup wants to know. */
function g2p(word){
  var w=loan(word.replace(/'/g,'')),stem=loan(word.split("'")[0]);
  var L=[],i,ch;
  for(i=0;i<w.length;i++){ch=w.charAt(i);
    /* a circumflex is length — where the syllable lets it be, see open() —
       and after k g l it also means "this consonant is the front one even
       though the vowel is back": kâr, rüzgâr, mahkûm */
    if(ch==='â')L.push({c:'a',lg:1,pal:1});
    else if(ch==='î')L.push({c:'i',lg:1});
    else if(ch==='û')L.push({c:'u',lg:1,pal:1});
    else L.push({c:ch});}
  var n=L.length,vi=[];
  for(i=0;i<n;i++)if(isV(L[i].c))vi.push(i);
  /* The vowel a consonant belongs to. Turkish syllables are V.CV, VC.CV,
     VCC.CV: between two vowels only the last consonant opens the next one. */
  function nuc(at){var p=-1,q=-1,k;
    for(k=0;k<vi.length;k++){if(vi[k]<at)p=vi[k];else if(vi[k]>at){q=vi[k];break;}}
    if(p<0)return q;if(q<0)return p;
    return at===q-1?q:p;}
  function palatal(at){var k=nuc(at);
    return !!(L[at+1]&&L[at+1].pal)||(k>=0&&FRONT.indexOf(L[k].c)>=0);}
  /* A long vowel is only long while its syllable is open: hâl is short, hâli
     long; kâr, kârı; dükkân, dükkânı. One consonant before a vowel starts the
     next syllable (hâ.li), anything else closes this one (hâl, hâl.de). The
     reference agrees 104 times to 26. */
  function open(at){var a=L[at+1],b=L[at+2];return !a||isV(a.c)||(!!b&&isV(b.c));}
  var ph=[],len=[],src=[];
  function push(p,l,at){ph.push(p);len.push(l);src.push(at);}
  function stretch(l){var k=ph.length-1;if(k>=0&&VPH[ph[k]]&&len[k]<l)len[k]=l;}

  for(i=0;i<n;i++){
    var o=L[i],c=o.c,nx=L[i+1]?L[i+1].c:undefined,pv=i>0?L[i-1].c:undefined;
    if(o.skip)continue;
    if(isV(c)){
      if(pv===c&&!o.lg){stretch(LONG);continue;}                         /* saat, şiir */
      /* e opens before l m n r when that consonant closes the syllable:
         gel, ben, -ler — but not gelin, benim */
      var p=(c==='e'&&nx!==undefined&&'lmnr'.indexOf(nx)>=0&&nuc(i+1)===i)?'ɛ':MAP[c];
      push(p,(o.lg&&open(i))?LONG:1,i);continue;
    }
    if(c==='ğ'){
      /* Never a consonant of its own. Closing a syllable it lengthens the vowel
         (a glide after e); between identical vowels the two become one long
         vowel; between e and i it is a glide; otherwise nothing at all. */
      if(!isV(nx)){if(pv==='e')push('j',1,i);else stretch(GH);continue;}  /* dağ, öğle; eğlence */
      if(pv==='e'&&nx==='e'){push('j',1,i);continue;}                      /* eğer */
      if(pv===nx){stretch(GH);L[i+1].skip=1;continue;}                     /* dağa, düğün */
      if((pv==='e'||pv==='i')&&(nx==='e'||nx==='i'))push('j',1,i);         /* değil, diğer */
      continue;                                                            /* soğuk */
    }
    if(nx===c)continue;                    /* first half of a doubled consonant */
    var q=MAP[c];if(q===undefined)continue;
    if(c==='k'||c==='g'){if(palatal(i))q=c==='k'?'c':'ɟ';}
    else if(c==='n'&&(nx==='k'||nx==='g')&&!palatal(i+1))q='ŋ';
    push(q,pv===c?(STOPS[q]?GEM_STOP:GEM):1,i);
  }

  /* The dictionary only ever lengthens: the digits before "/" always, the ones
     after it when the syllable is open in THIS word. With an apostrophe the
     writer has already said where the stem ends (Ali'nin). */
  var f=dictFind(word.indexOf("'")<0?w:stem);
  if(f&&f.code!=='-'){
    var part=f.code.split('/');
    for(var s=0;s<part.length;s++)for(i=0;i<part[s].length;i++){
      var at=vi[+part[s].charAt(i)],k=src.indexOf(at);
      if(k>=0&&(s===0||open(at))&&len[k]<LONG)len[k]=LONG;
    }
  }

  var vp=[],stress=[];
  for(i=0;i<ph.length;i++){stress.push(0);if(VPH[ph[i]])vp.push(i);}
  if(vp.length){
    var pick=vp.length-1,e=EXC[w]!==undefined?EXC[w]:EXC[stem];
    if(e!==undefined)pick=Math.min(e,vp.length-1);
    else{
      /* -(I)yor carries its own stress: gelíyor. With the negative in front of
         it the stress moves before that: gélmiyor. */
      var m=/[ıiuü]yor(?!.*[ıiuü]yor)/.exec(w);
      if(m){var at=m.index;
        if(L[at-1]&&L[at-1].c==='m'){for(i=at-2;i>=0;i--)if(isV(L[i].c)){at=i;break;}}
        for(i=0;i<vp.length;i++)if(src[vp[i]]===at)pick=i;}
    }
    stress[vp[pick]]=1;
  }
  return{ph:ph,stress:stress,len:len,src:src};
}

var ONES=['sıfır','bir','iki','üç','dört','beş','altı','yedi','sekiz','dokuz'];
var TENS=['','on','yirmi','otuz','kırk','elli','altmış','yetmiş','seksen','doksan'];
var GROUPS=['','bin','milyon','milyar','trilyon'];
/* Read from the digit STRING, not a number: nobody typed 1e+21. Leading zeros
   are said one by one, and so is anything longer than the named groups reach. */
function num(s){
  var out=[],i=0;
  while(i<s.length-1&&s.charAt(i)==='0'){out.push(ONES[0]);i++;}
  s=s.slice(i);
  if(s.length>15){for(i=0;i<s.length;i++)out.push(ONES[+s.charAt(i)]);return out;}
  if(/^0*$/.test(s)){out.push(ONES[0]);return out;}
  var groups=[];while(s.length){groups.unshift(s.slice(-3));s=s.slice(0,-3);}
  for(i=0;i<groups.length;i++){
    var g=+groups[i],gi=groups.length-1-i;if(!g)continue;
    if(gi===1&&g===1){out.push('bin');continue;}              /* bin, never "bir bin" */
    var h=Math.floor(g/100),t=Math.floor(g%100/10),u=g%10;
    if(h){if(h>1)out.push(ONES[h]);out.push('yüz');}          /* yüz, never "bir yüz" */
    if(t)out.push(TENS[t]);
    if(u)out.push(ONES[u]);
    if(gi)out.push(GROUPS[gi]);
  }
  return out;
}

/* A run of three or more of one letter is a held sound, as in English — but it
   collapses to ONE letter here. English keeps two to dodge its dictionary
   ("aaa" is "triple A"); in Turkish two is a real spelling (saat, anne). */
var HOLD_PER=typeof VT_SPK_HOLD_PER==='number'?VT_SPK_HOLD_PER:0.1,HOLD_MAX=typeof VT_SPK_HOLD_MAX==='number'?VT_SPK_HOLD_MAX:2;
function elong(w){
  var m=w.match(/(.)\1{2,}/g);if(!m)return null;
  var longest=0;for(var i=0;i<m.length;i++)if(m[i].length>longest)longest=m[i].length;
  return{hold:Math.min(HOLD_MAX,(longest-2)*HOLD_PER),canon:w.replace(/(.)\1{2,}/g,'$1')};
}

/* Number punctuation, before tokenising, because Turkish writes it the other
   way round: 1.000.000 is a million, 3,5 is three and a half, 17.30 is a time,
   and the percent sign is read first. */
function pre(text){
  var t=text.replace(/[‘’ʼ]/g,"'").replace(/[“”]/g,'');
  t=t.replace(/(\d)\.(?=\d{3}(?!\d))/g,'$1');
  t=t.replace(/%\s*(\d+(?:,\d+)?)/g,' yüzde $1 ').replace(/(\d+(?:,\d+)?)\s*%/g,' yüzde $1 ');
  t=t.replace(/(\d+),(\d+)/g,'$1 virgül $2');
  t=t.replace(/(\d{1,2})\.(\d{2})(?!\d)/g,'$1 $2');
  return t;
}

var LETTERS='A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû';
var TOKEN=new RegExp('(['+LETTERS+"']+)|(\\d+)|([,;:])|([.!?\\n])|([-\\u2013\\u2014])|(\\S)",'g');
var SUFFIX=new RegExp("^'(["+LETTERS+']+)');

function wordTok(raw0){
  var raw=raw0.replace(/^'+|'+$/g,'');if(!raw)return null;
  var w=lower(raw);
  /* All capitals is a shout — judged before folding, and by the absence of any
     lower-case letter, since "İ" and "I" do not round-trip through toUpperCase. */
  var sh=raw.length>=2&&!/[a-zçğıöşüâîû]/.test(raw);
  var el=elong(w),g=g2p(el?el.canon:w),fn=isFn(w);
  if(!g.ph.length)return null;
  if(fn)g.stress=g.stress.map(function(){return 0;});
  return{w:w,ph:g.ph,stress:g.stress,len:g.len,fn:fn,shout:sh,hold:el?el.hold:0};
}
/* ═══ sentence melody ═════════════════════════════════════════════════════════
   Turkish stress is pitch and very little else (Pycha 2006: a final stressed
   syllable sits ~2.6 semitones up, a non-final one ~5 and falls after it), and
   the sentence melody is built out of it:
     statement    every word rises onto its stressed syllable; the word before
                  the final verb carries the peak — it is where Turkish puts its
                  focus — the verb is low and the end falls
     mi-question  the peak is on the word before mi; mi and anything after it
                  are low and the end falls (33 of 42 in Kawaguchi et al. 2006)
     wh-question  the peak is on the question word, what follows is flatter,
                  and the end rises a little
     other "?"    the English rise
   All of it through three fields the compiler reads: acc (accent size, in
   semitones), st0 (register for the whole word) and, on the end token, st (the
   final move, relative to where the last sound left off). These are starting
   values, to be tuned by ear. */
var MEL={acc:2.6,accNon:5,nuc:4.5,nucNon:6,peak:6,verb:-2,verbAcc:0.8,after:-1.5,afterAcc:0.8,
  endLow:-1.5,endMi:-2,endWh:2};
var WH=/^(?:ne(?:yi|ye|de|den|yle|si|yin)?|nere(?:de|ye|den|si|yi)|kim(?:i|e|de|den|in|inle)?|nasıl(?:s[ıi]n(?:[ıi]z)?)?|niye|niçin|hangi(?:si|sini|sine|sinde|den)?|kaç(?:ta|a|ıncı)?)$/;
/* A finite verb, judged by its ending alone. Turkish verbs end in tense and
   person suffixes that nouns mostly do not — the past tense is the exception
   (kedi, kadın, altın end like geldi, geldin), hence the list. değil, var, yok
   are predicates and behave like verbs. */
var NOT_VERB=set('kedi kedim kedin kendi kendim kendin şimdi kutu ütü örtü hindi kadın kadim altın yardım adım adın bütün odun ödün satın aydın kamış gümüş yemiş');
var PRED=/^(?:değil|var|yok|lazım|gerek)(?:[dt][ıiu](?:m|n|k|n[ıiu]z|l[ae]r)?|m[ıiu]ş[a-zçğıöşü]*|s[ae][a-zçğıöşü]*|[dt][ıiu]r|im|sin|iz|siniz|ler)?$/;
var VERB=new RegExp('(?:'+[
  'yor(?:um|sun|uz|sunuz|lar|du[mnk]?|dunuz|dular|muş[a-zçğıöşü]*|sa[a-zçğıöşü]*)?',
  'm[ıiuü]ş(?:[ıiuü]m|s[ıiuü]n|[ıiuü]z|s[ıiuü]n[ıiuü]z|l[ae]r|t[ıiuü][a-zçğıöşü]*)?',
  '[ae]c[ae](?:k|ğ[ıiuü][mz]|ks[ıiuü]n(?:[ıiuü]z)?|kl[ae]r)',
  'm[ae]l[ıiuü](?:y[ıiuü][mz]|s[ıiuü]n(?:[ıiuü]z)?|l[ae]r)?',
  '[dt][ıiuü](?:m|n|k|n[ıiuü]z|l[ae]r)?',
  'm[ae]z(?:s[ıiuü]n(?:[ıiuü]z)?|l[ae]r)?',
  '[ıiuüae]r(?:[ıiuü]m|s[ıiuü]n|[ıiuü]z|s[ıiuü]n[ıiuü]z)'
].join('|')+')$');
function isVerb(w){
  if(NOT_VERB[w])return false;
  if(PRED.test(w))return true;
  return VERB.test(w)&&(w.match(/[aeıioöuüâîû]/g)||[]).length>=2;
}
function finalStress(t){
  var s=-1,v=-1;
  for(var j=0;j<t.ph.length;j++){if(VPH[t.ph[j]])v=j;if(t.stress[j])s=j;}
  return s<0||s===v;
}
function melody(sen){
  var end=sen[sen.length-1],q=!!end.q,words=[],start=0,i,k;
  /* the statement or question melody belongs to the last clause; anything
     before a comma keeps plain accents and the comma's continuation rise */
  for(i=0;i<sen.length;i++)if(sen[i].brk==='comma')start=i+1;
  for(i=0;i<sen.length;i++){
    if(sen[i].brk)continue;
    sen[i].acc=finalStress(sen[i])?MEL.acc:MEL.accNon;
    if(i>=start)words.push(sen[i]);
  }
  if(!words.length)return;
  function content(k){for(;k>=0;k--)if(!words[k].fn)return k;return -1;}
  function top(t){t.acc=finalStress(t)?MEL.nuc:MEL.nucNon;}
  function low(from){for(var k=from;k<words.length;k++){words[k].st0=MEL.after;words[k].acc=MEL.afterAcc;}}
  var mi=-1,wh=-1;
  for(k=0;k<words.length;k++){if(MI.test(words[k].w))mi=k;else if(wh<0&&WH.test(words[k].w))wh=k;}
  if(mi>=0&&(q||mi===words.length-1)){
    k=content(mi-1);
    if(k>=0){words[k].acc=MEL.peak;low(k+1);}
    end.st=MEL.endMi;
  }else if(wh>=0&&q){
    words[wh].acc=MEL.peak;low(wh+1);
    end.st=MEL.endWh;
  }else if(q){
    k=content(words.length-1);if(k>=0)top(words[k]);
  }else{
    var v=content(words.length-1),n=(v===words.length-1&&isVerb(words[v].w))?content(v-1):-1;
    if(n>=0){top(words[n]);words[v].st0=MEL.verb;words[v].acc=MEL.verbAcc;}
    else if(v>=0)top(words[v]);
    end.st=MEL.endLow;
  }
}

/* Text → sentences of tokens, the same shape vtSpkNormText returns: words
   {w,ph,stress,len,fn,shout,hold,acc,st0} and breaks {brk:'comma'} /
   {brk:'end',q,st}. */
function norm(text){
  var sentences=[],cur=[],t=pre(text.normalize('NFC')),m,i;
  TOKEN.lastIndex=0;
  while((m=TOKEN.exec(t))!==null){
    if(m[1]){var tok=wordTok(m[1]);if(tok)cur.push(tok);}
    else if(m[2]){
      var ws=num(m[2]);
      /* 1990'da: the suffix belongs to the last word of the number */
      var sfx=SUFFIX.exec(t.slice(TOKEN.lastIndex));
      if(sfx){ws[ws.length-1]+=lower(sfx[1]);TOKEN.lastIndex+=sfx[0].length;}
      for(i=0;i<ws.length;i++){var g=g2p(ws[i]);
        if(g.ph.length)cur.push({w:ws[i],ph:g.ph,stress:g.stress,len:g.len,fn:false});}
    }
    else if(m[5])continue;                 /* a dash separates words rather than vanishing */
    else if(m[3]){if(cur.length)cur.push({brk:'comma'});}
    else if(m[4]){if(cur.length){cur.push({brk:'end',q:m[4]==='?'});sentences.push(cur);cur=[];}}
  }
  if(cur.length){cur.push({brk:'end',q:false});sentences.push(cur);}
  for(i=0;i<sentences.length;i++)melody(sentences[i]);
  return sentences;
}

/* Node loads this file for the text rules alone: tools/build-vtdict-tr.js has to
   run the very rules the app runs, because the dictionary is defined as "what the
   rules get wrong". Everything above this line touches nothing in the page. */
var TEXT={g2p:g2p,norm:norm,num:num,lower:lower,dictLoad:dictLoad,dictFind:dictFind,
  dict:function(d){if(d)DICT=d;return DICT;},key:function(word){return loan(word.replace(/'/g,''));}};
if(typeof window==='undefined'&&typeof module==='object'&&module.exports){module.exports=TEXT;return;}
if(typeof vtSpkLangReg!=='function')return;

/* ═══ sounds ══════════════════════════════════════════════════════════════════ */
var VOICED=vtSpkVoiceness(VT_SPK_VOICED),VOICELESS=vtSpkVoiceness(VT_SPK_VOICELESS);
function copy(o,skip){var n={};for(var k in o)if(k!==skip)n[k]=o[k];return n;}

/* The English entry with its tongue target removed. */
function noTongue(key,each){
  var e=vtSpkInfo(key),o=copy(e,'alt');
  o.c=e.c.map(function(s){var n=copy(s,'t');if(each)each(n);return n;});
  return o;
}
/* A nasal: the English closure, then a release step. The closure is a negative
   diameter, and without the step the slot is still climbing out of it at the
   next vowel's midpoint. `nasal` keeps the voice running through the closure;
   `lou` sets the murmur a few dB under the vowels. Every release here is
   `preV`: the compiler drops it when no vowel follows in the word, where it
   would only open the tract into a vowel nobody wrote. */
function nasal(key,zone,open){
  var e=vtSpkInfo(key),z=e.c[0][zone],shut={dur:[0.035,0.030]},rel={dur:[0.012,0.012],preV:1};
  shut[zone]=z;rel[zone]=[z[0],open];
  return{v:1,nasal:1,ten:e.ten,lou:0.55,c:[shut,rel]};
}
/* A sibilant or affricate: the English hiss exactly as it is — same geometry,
   same tongue, same source, which is what keeps s and ş apart — followed by a
   24ms release with NO tongue of its own. During it the tongue is already on its
   way to the vowel; without it /a/ after ş, z or c arrived about a Bark late.
   `vo` on the hiss restates the entry's own voicing, because the compiler
   otherwise silences the first sub-target of any two-part consonant. */
function hiss(key,dur){
  var e=vtSpkInfo(key),vc=e.v?VOICED:VOICELESS,o=copy(e,'alt');
  var f=copy(e.c[0]);f.dur=dur;
  f.vo=[1,e.ten!==undefined?e.ten:vc.ten,e.lou!==undefined?e.lou:vc.lou];
  var rel={tip:[f.tip[0],1.5],dur:[0.012,0.012],preV:1,vo:[1,VOICED.ten,VOICED.lou*VT_SPK_VOWLOU]};
  if(f.lip)rel.lip=f.lip;
  o.c=[f,rel];return o;
}
function front(s){s.bod=[25.5,s.bod[1]];}

var PH={
  /* ── vowels: tongue [index,diameter], lip, throat ── */
  a:{c:[{t:[17,2.1]}]},
  e:{c:[{t:[24,2.4]}]},
  'ɯ':{c:[{t:[21.5,2.0]}]},
  i:{c:[{t:[25.5,2.1]}]},
  o:{c:[{t:[13,2.1],lip:[40.5,0.9]}]},
  'œ':{c:[{t:[25.5,3.1],lip:[40.5,0.8],thr:[7,0.9]}]},
  u:{c:[{t:[23,2.2],lip:[40.5,0.8]}]},
  y:{c:[{t:[28.5,2.3],lip:[40.5,0.8],thr:[8,0.9]}]},
  /* the lowered e of gel, ben, -ler */
  'ɛ':{c:[{t:[23,3.2]}]},

  /* ── sonorants ── */
  m:nasal('m','lip',1.2),
  n:nasal('n','tip',0.9),
  l:{v:1,c:[{tip:[37.938,0.75]}]},
  /* The tap: closure with a voicing dip [int,ten,lou], then release. 0.36 is a
     near-closure: it must stay above 0.3, where the carve reaches zero and the
     engine would fire a stop burst on the way out. */
  'ɾ':{v:1,c:[{tip:[36,0.36],dur:[0.012,0.012],vo:[0.30,0.60,0.40]},{tip:[36,1.4],dur:[0.012,0.012],preV:1}]},

  /* ── palatal stops: what k and g are in a front-vowel syllable. The English
     closure moved forward, with no tongue of its own — the English velars pin a
     back tongue, which is right next to a o ı u (measured: within 0.2 Bark, so
     they are inherited untouched) and drags e i ö ü most of a Bark. ── */
  c:noTongue('k',front),'ɟ':noTongue('g',front),

  /* ── sibilants and affricates ── */
  s:hiss('s',[0.022,0.030]),z:hiss('z',[0.022,0.030]),
  'ʃ':hiss('ʃ',[0.022,0.030]),'ʒ':hiss('ʒ',[0.022,0.030]),
  'tʃ':hiss('tʃ',[0.020,0.065]),'dʒ':hiss('dʒ',[0.020,0.065]),

  /* v is weak in Turkish, closer to an approximant: wide enough to sit outside
     the turbulence window. */
  v:{v:1,c:[{lip:[39.6,0.75]}]}
};

/* The dictionary is fetched the first time Turkish speaks, never before. If it
   cannot be had, the rules read everything anyway — a little flatter. */
var dictP=null;
function prepare(){
  if(!dictP)dictP=fetch('vtdict-tr.txt').then(function(r){
    if(!r.ok)throw new Error('vtdict-tr.txt '+r.status);return r.text();
  }).then(dictLoad).catch(function(){});
  return dictP;
}

vtSpkLangReg({
  id:'tr',label:'tr',placeholder:'okuması için bir şey yaz…',
  ph:PH,
  cls:{vowel:['a','e','ɯ','o','œ','y','ɛ'],liquid:['ɾ'],stop:['c','ɟ']},
  vstop:['ɟ'],
  /* no stress lengthening: Turkish stress is pitch, and 7ms */
  dur:{vowel:[0.030,0.050],vowelS:[0.030,0.050]},
  dUnstr:1,
  expI:1,expD:1,
  lead:['lip','thr'],leadMax:0.14,
  norm:norm,prepare:prepare
});

/* exposed for the headless checks */
window.__trTest={ph:PH,text:TEXT,g2p:g2p,norm:norm,num:num,lower:lower,MEL:MEL,isVerb:isVerb,melody:melody};
})();
