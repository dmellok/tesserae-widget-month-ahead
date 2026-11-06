/* Month Ahead: a wall calendar for a whole panel. Today up close in a panel (beside the grid on a
   landscape cell, across the top on a portrait one), then the next weeks as tiles, each event edged
   in its calendar's colour. Five looks, muted colour or black and white.

   The layout is drawn at a panel's own size (1872 wide landscape, 1200 wide portrait) and scaled to
   the cell, so type and spacing keep their proportions on any panel. render() waits for the look's
   faces, so a screenshot never catches a fallback font. */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WD = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- faces

const FACES = [
  ['MA Fraunces', 'fraunces-normal-400_900.woff2', '400 900', 'normal'],
  ['MA Inter', 'inter-normal-400_800.woff2', '400 800', 'normal'],
  ['MA Cormorant', 'cormorant-normal-500_700.woff2', '500 700', 'normal'],
  ['MA Cormorant', 'cormorant-italic-500_700.woff2', '500 700', 'italic'],
  ['MA Archivo', 'archivo-normal-500_900.woff2', '500 900', 'normal'],
  ['MA Plex Mono', 'plexmono-normal-400.woff2', '400', 'normal'],
  ['MA Plex Mono', 'plexmono-normal-600.woff2', '600', 'normal'],
  ['MA Plex Mono', 'plexmono-normal-700.woff2', '700', 'normal'],
  ['MA Manrope', 'manrope-normal-300_700.woff2', '300 700', 'normal'],
];

// The faces each look actually paints with, so render() only waits on those.
const LOOK_FACES = {
  noir: ["800 40px 'MA Fraunces'", "600 20px 'MA Inter'"],
  paper: ["700 40px 'MA Cormorant'", "italic 600 40px 'MA Cormorant'", "600 20px 'MA Inter'"],
  poster: ["900 40px 'MA Archivo'", "700 20px 'MA Archivo'"],
  ledger: ["700 40px 'MA Plex Mono'", "400 20px 'MA Plex Mono'"],
  soft: ["300 40px 'MA Manrope'", "500 20px 'MA Manrope'"],
};

async function useFaces(theme) {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('month-ahead-faces')) {
    const rules = FACES.map(([family, file, weight, style]) => {
      const url = new URL(`./static/fonts/${file}`, import.meta.url).href;
      return `@font-face{font-family:'${family}';src:url('${url}') format('woff2');font-weight:${weight};font-style:${style};font-display:block}`;
    });
    const el = document.createElement('style');
    el.id = 'month-ahead-faces';
    el.textContent = rules.join('\n');
    document.head.appendChild(el);
  }
  // Fonts declared inside a shadow root are ignored, so the icon face is linked at page level too
  // (a no-op where the page already has it).
  let sheet = Promise.resolve();
  if (!document.querySelector('link[href$="/icons/phosphor/bold/style.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/static/icons/phosphor/bold/style.css';
    sheet = new Promise((res) => { link.onload = res; link.onerror = res; });
    document.head.appendChild(link);
  }
  const icons = sheet.then(() => document.fonts.load("20px 'Phosphor-Bold'", '')).catch(() => {});
  try {
    await Promise.race([
      Promise.all([icons, ...(LOOK_FACES[theme] || LOOK_FACES.noir).map((f) => document.fonts.load(f, 'November 0123456789'))]),
      new Promise((res) => setTimeout(res, 3000)),
    ]);
  } catch (e) { /* the fallback faces still read */ }
}

// ---------------------------------------------------------------- sample month

// While no calendar feed is set up the grid shows a made-up (and slightly silly) household, so the
// layout can be judged. Events are placed by position in the grid; four pretend calendars carry
// muted colours so the calendar-colour edges show.
const CAL = { kids: '#B5654A', home: '#5E7F62', social: '#4F6A92', chores: '#A08536' };
const WEEKLY = {
  1: [['7:30a', 'Gym (drive past it)', CAL.home]],
  3: [['7p', 'Choir: lip-sync section', CAL.kids]],
  4: [['4:30p', "Robotics club: it's alive", CAL.kids]],
  6: [['11a', 'Mow lawn, maybe', CAL.chores]],
  0: [['5p', 'Taco summit', CAL.social]],
};
const FORTNIGHTLY = { 2: [['8p', 'Trivia: proudly last', CAL.social]] };
const ONCE = {
  1: [['6p', 'Plant funeral (basil)', CAL.social]],
  4: [['2p', 'Bake-off vs. next door', CAL.social]],
  5: [['8a', 'Find the other sock', CAL.home], ['3p', 'Ambitious nap', CAL.home]],
  8: [['8:15a', 'Dentist: "I floss"', CAL.home]],
  12: [['10a', 'Build flat-pack shelf', CAL.chores]],
  13: [['10a', 'Shelf, part two', CAL.chores]],
  17: [['7:30p', 'Escape room (stuck)', CAL.social]],
  20: [['3p', 'Teach Nan the group chat', CAL.kids]],
  29: [['1p', 'Kite vs. tree: rematch', CAL.kids]],
  31: [['6:30p', 'Budget meeting (snacks)', CAL.chores]],
  33: [['9:30a', 'Llama farm. Yes, really', CAL.kids]],
};
const STAY = [23, 26];
const toMin = (t) => {
  const m = /^(\d+)(?::(\d+))?([ap])$/.exec(t);
  if (!m) return 0;
  return ((+m[1] % 12) + (m[3] === 'p' ? 12 : 0)) * 60 + (+m[2] || 0);
};

export function sampleEvents(days) {
  return days.map((d, i) => {
    const evs = [];
    if (i >= STAY[0] && i <= STAY[1]) {
      evs.push({ summary: 'In-laws visit (deep breaths)', all_day: true, continued: i > STAY[0], colour: CAL.social, time: '' });
    }
    const rows = [...(WEEKLY[d.weekday] || []), ...(ONCE[i] || [])];
    if (FORTNIGHTLY[d.weekday] && Math.floor(i / 7) % 2 === 0) rows.push(...FORTNIGHTLY[d.weekday]);
    rows.sort((a, b) => toMin(a[0]) - toMin(b[0]))
      .forEach(([time, summary, colour]) => evs.push({ summary, time, all_day: false, continued: false, colour }));
    return { ...d, events: evs };
  });
}

// ---------------------------------------------------------------- pieces

function iconName(code) {
  if (code == null) return 'cloud';
  if (code === 0) return 'sun';
  if (code <= 2) return 'cloud-sun';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'cloud-fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud-snow';
  if (code >= 95) return 'cloud-lightning';
  return 'cloud-rain';
}
const icon = (code) => `<i class="ph-bold ph-${iconName(code)}"></i>`;
const binIcons = (bins) => bins.map((n) => `<i class="ph-bold ph-${n}"></i>`).join('');
const tint = (c) => (c ? ` hasc" style="--ec:${esc(c)}` : '');
const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);

function dateOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

function agenda(day) {
  const evs = (day && day.events) || [];
  if (!evs.length) return '<div class="none">Nothing planned</div>';
  return evs.slice(0, 4).map((e) =>
    `<div class="tm">${e.all_day ? 'all day' : esc(e.time)}</div><div class="${tint(e.colour)}">${esc(e.summary)}</div>`).join('');
}

function todayPanel(data, days) {
  const day = days[data.today] || days[0];
  const tmrw = days[data.today + 1];
  const { y, m, d } = dateOf(day.date);
  const w0 = day.wx;
  const date = `<div class="col ca"><div class="wd">${WD[day.weekday]}</div><div class="big">${d}</div><div class="my">${MONTHS[m]} ${y}</div></div>`;
  let weather = '';
  if (w0) {
    weather += `<div class="now">${icon(w0.code)}<div><div class="t">${deg(w0.hi)}<span> / ${deg(w0.lo)}</span></div>`
      + `<div class="c">${esc(w0.cond)}${w0.rain ? ` · ${w0.rain}% rain` : ''}</div></div></div>`;
  }
  if ((data.ahead || []).length) {
    weather += `<div class="fc">${data.ahead.map((f) => {
      const p = dateOf(f.date);
      const wd = new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay();
      return `<div><div class="d">${DOW[wd]}</div>${icon(f.code)}<div class="h">${deg(f.hi)}<span> ${deg(f.lo)}</span></div></div>`;
    }).join('')}</div>`;
  }
  let plans = `<div class="lab">TODAY</div><div class="ag">${agenda(day)}</div>`;
  if (tmrw) plans += `<div class="lab">TOMORROW</div><div class="ag">${agenda(tmrw)}</div>`;
  if ((day.bins || []).length) {
    plans += `<div class="binnote">${binIcons(day.bins)}<span>Bins out tonight${day.bins.length > 1 ? ' · recycling too' : ''}</span></div>`;
  }
  return `<div class="side">${date}<div class="col cb">${weather}</div><div class="col cc">${plans}</div></div>`;
}

function grid(data, days, look) {
  const today = days[data.today] || days[0];
  const first = dateOf(days[0].date);
  const last = dateOf(days[days.length - 1].date);
  const title = MONTHS[first.m] + (last.m !== first.m ? ` – ${MONTHS[last.m]}` : '');
  const weeks = Math.ceil(days.length / 7);
  let h = `<div class="main"><div class="mh"><div class="m">${title}</div><div class="s">the next ${weeks} weeks</div>`
    + `${data.sample ? '<div class="note">sample events</div>' : ''}</div><div class="dow">`;
  for (let i = 0; i < 7; i++) h += `<div>${DOW[days[i] ? days[i].weekday : i]}</div>`;
  h += `</div><div class="grid" style="grid-template-rows:repeat(${weeks},1fr)">`;
  days.forEach((d) => {
    const past = d.date < today.date;
    const { m, d: dn } = dateOf(d.date);
    let top = `<span class="num">${dn}</span>`;
    if (dn === 1) top += `<span class="mo">${MONTHS[m].slice(0, 3).toUpperCase()}</span>`;
    if (!past && (d.bins || []).length) top += `<span class="bins">${binIcons(d.bins)}</span>`;
    let body = '';
    (d.events || []).forEach((e) => {
      if (e.all_day) body += `<div class="trip${e.continued ? ' cont' : ''}${tint(e.colour)}">${esc(e.summary)}</div>`;
      else body += `<div class="ev${tint(e.colour)}">${esc(e.summary)}${e.time ? `<span class="tm">${esc(e.time)}</span>` : ''}</div>`;
    });
    if (d.extra) body += `<div class="more">+${d.extra} more</div>`;
    let wx = '';
    if (!look.sidebar && !past && d.wx) {
      wx = `<div class="cwx">${icon(d.wx.code)}<span class="hi">${deg(d.wx.hi)}</span><span class="lo">${deg(d.wx.lo)}</span></div>`;
    }
    const weekend = d.weekday === 0 || d.weekday === 6;
    const cls = `tile${past ? ' past' : ''}${d.is_today ? ' today' : ''}${weekend ? ' weekend' : ''}${wx ? ' has-wx' : ''}`;
    h += `<div class="${cls}"><div class="top">${top}</div>${body}${wx}</div>`;
  });
  return `${h}</div></div>`;
}

// ---------------------------------------------------------------- render

export default async function render(shadow, ctx) {
  const data = (ctx && ctx.data) || {};
  const look = data.look || { theme: 'noir', colour: true, sidebar: true };
  const host = shadow.host;
  const W = (host && host.clientWidth) || 1872;
  const H = (host && host.clientHeight) || 1404;
  const tall = H > W;
  const DW = tall ? 1200 : 1872;
  const DH = Math.round((DW * H) / W);

  let days = Array.isArray(data.days) ? data.days : [];
  if (!days.length) {
    shadow.innerHTML = `<style>${CSS}</style><div class="ma empty"><p>${esc(data.error || 'No calendar to show yet.')}</p></div>`;
    return;
  }
  if (data.sample) days = sampleEvents(days);

  await useFaces(look.theme);

  const classes = ['ma', `th-${look.theme}`];
  if (tall) classes.push('tall');
  if (!look.sidebar) classes.push('nosb');
  if (look.colour) classes.push('color');
  const css = `<link rel="stylesheet" href="/static/icons/phosphor/bold/style.css">`;
  shadow.innerHTML = `${css}<style>${CSS}</style>`
    + `<div class="${classes.join(' ')}" style="width:${DW}px;height:${DH}px;transform:scale(${W / DW})">`
    + `<div class="wrap">${look.sidebar ? todayPanel(data, days) : ''}${grid(data, days, look)}</div></div>`;
}

// ---------------------------------------------------------------- styles

const CSS = `
:host{display:block;position:relative;width:100%;height:100%;overflow:hidden}
*{box-sizing:border-box;margin:0;padding:0}
.ma{position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;color:#000;font-family:'MA Inter',system-ui,sans-serif;overflow:hidden}
.ma.empty{position:static;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#555;padding:24px;text-align:center}
.wrap{display:flex;height:100%}
.side{width:470px;flex:none;background:#111;color:#fff;padding:44px 40px 36px;display:flex;flex-direction:column}
.col{display:contents}
/* landscape: one column, in reading order (the column groups only matter in portrait) */
.now{order:1}.lab,.ag{order:2}.fc{order:3}.binnote{order:4}
.wd{font-size:28px;font-weight:700;letter-spacing:.32em;color:#bbb}
.big{font-family:'MA Fraunces',Georgia,serif;font-weight:800;font-size:250px;line-height:.9;margin:6px 0 0 -8px;font-variant-numeric:lining-nums}
.my{font-family:'MA Fraunces',Georgia,serif;font-weight:400;font-size:46px;margin-top:8px}
.now{display:flex;align-items:center;gap:20px;margin-top:34px;padding:22px 0;border-top:2px solid #555;border-bottom:2px solid #555}
.now i{font-size:84px}
.now .t{font-size:56px;font-weight:700;line-height:1}
.now .t span{color:#999;font-weight:500}
.now .c{font-size:24px;color:#ccc;margin-top:6px}
.lab{font-size:20px;font-weight:700;letter-spacing:.28em;color:#999;margin:30px 0 12px}
.ag{display:grid;grid-template-columns:118px 1fr;row-gap:10px;font-size:27px;line-height:1.2}
.ag .tm{color:#bbb;font-weight:600;font-size:23px;padding-top:3px}
.ag .none{grid-column:1/-1;color:#888;font-style:italic}
.binnote{margin-top:26px;display:flex;align-items:center;gap:16px;background:#fff;color:#000;border-radius:16px;padding:18px 22px;font-size:24px;font-weight:700}
.binnote i{font-size:40px}
.fc{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:auto;padding-top:24px;border-top:2px solid #555;text-align:center}
.fc .d{font-size:19px;font-weight:700;letter-spacing:.14em;color:#999}
.fc i{font-size:42px;margin:6px 0 2px;display:block}
.fc .h{font-size:22px;font-weight:700}
.fc .h span{color:#888;font-weight:500}
.main{flex:1;display:flex;flex-direction:column;padding:40px 32px 32px 30px;min-width:0}
.mh{display:flex;align-items:baseline;gap:20px;margin-bottom:18px}
.mh .m{font-family:'MA Fraunces',Georgia,serif;font-weight:600;font-size:60px;line-height:1}
.mh .s{font-size:22px;color:#777}
.mh .note{margin-left:auto;font-size:19px;color:#888;font-style:italic}
.dow{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:8px}
.dow div{font-size:19px;font-weight:700;letter-spacing:.2em;color:#777;padding-left:14px}
.grid{flex:1;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;min-height:0}
.tile{position:relative;background:#ececec;border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;overflow:hidden;min-width:0}
.tile.past{background:transparent;border:2px dashed #ccc;color:#aaa}
.tile.today{background:#111;color:#fff}
.top{display:flex;align-items:center;min-height:38px}
.num{font-family:'MA Fraunces',Georgia,serif;font-weight:600;font-size:34px;line-height:1;font-variant-numeric:lining-nums}
.mo{font-size:15px;font-weight:700;letter-spacing:.18em;margin-left:8px;color:#777}
.bins{margin-left:auto;display:flex;gap:4px;font-size:24px}
.ev{font-size:20px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ev .tm{font-size:17px;color:#666;font-weight:600;margin-left:4px;white-space:nowrap}
.today .ev .tm{color:#aaa}
.past .ev .tm{color:#bbb}
.trip{font-size:18px;font-weight:700;border:2px solid #000;background:#fff;border-radius:10px;padding:4px 10px;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.trip.cont{border-style:dashed;color:#666;font-weight:600}
.more{font-size:16px;color:#777;font-weight:700}
.nosb .main{padding-left:36px}
.nosb .tile.has-wx{padding-bottom:50px}
.cwx{position:absolute;right:12px;bottom:10px;display:flex;align-items:center;gap:6px;font-size:20px;font-weight:700;line-height:1}
.cwx i{font-size:36px}
.cwx .lo{opacity:.55;font-weight:500}

/* Paper: a printed desk planner */
.th-paper .side{background:#fff;color:#000;border-right:2px solid #000}
.th-paper .wd{color:#555;font-family:'MA Cormorant',serif;font-style:italic;letter-spacing:.04em;font-size:40px;font-weight:600}
.th-paper .big,.th-paper .my,.th-paper .mh .m,.th-paper .num,.th-paper .lab{font-family:'MA Cormorant',Georgia,serif}
.th-paper .big{font-weight:700;font-size:290px}
.th-paper .my{font-style:italic;font-weight:600;font-size:50px}
.th-paper .now,.th-paper .fc{border-color:#000;border-width:1px}
.th-paper .now .c,.th-paper .ag .tm,.th-paper .fc .d{color:#555}
.th-paper .lab{color:#000;font-style:italic;letter-spacing:.02em;font-size:30px;font-weight:700;border-bottom:1px solid #000;padding-bottom:4px}
.th-paper .binnote{background:#000;color:#fff;border-radius:0}
.th-paper .mh .m{font-weight:700;font-style:italic;font-size:70px}
.th-paper .dow div{color:#000;border-bottom:2px solid #000;padding-bottom:6px}
.th-paper .grid{gap:0 14px}
.th-paper .tile{background:transparent;border-radius:0;border-bottom:1px solid #000;padding:10px 2px}
.th-paper .tile.past{border:0;border-bottom:1px solid #bbb;color:#999}
.th-paper .tile.today{background:transparent;color:#000;border-bottom:5px double #000}
.th-paper .tile.today .num{text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:3px}
.th-paper .tile.today .ev .tm{color:#555}
.th-paper .num{font-size:42px;font-weight:700}
.th-paper .ev .tm{color:#555;font-style:italic}
.th-paper .trip{border:0;border-radius:0;background:transparent;font-family:'MA Cormorant',serif;font-style:italic;font-size:24px;padding:0;border-top:2px solid #000;border-bottom:2px solid #000}
.th-paper .trip.cont{color:#555;border-style:solid;border-color:#888}

/* Poster: heavy grotesk, hard edges */
.th-poster{font-family:'MA Archivo',sans-serif}
.th-poster .side{background:#fff;color:#000;border-right:10px solid #000}
.th-poster .wd{color:#000;font-weight:900;font-size:40px;letter-spacing:.02em}
.th-poster .big,.th-poster .my,.th-poster .mh .m,.th-poster .num{font-family:'MA Archivo',sans-serif}
.th-poster .big{font-weight:900;font-size:330px;letter-spacing:-.06em;line-height:.8;margin-top:14px}
.th-poster .my{font-weight:900;font-size:40px;text-transform:uppercase}
.th-poster .now{border:0;background:#000;color:#fff;padding:20px 22px;margin-top:28px}
.th-poster .now .t span,.th-poster .now .c{color:#ccc}
.th-poster .lab{color:#000;font-weight:900;font-size:24px;letter-spacing:.06em;border-bottom:5px solid #000;padding-bottom:6px}
.th-poster .ag{font-weight:700}
.th-poster .ag .tm{color:#000;font-weight:900}
.th-poster .fc{border-top:5px solid #000}
.th-poster .fc .d{color:#000;font-weight:900}
.th-poster .fc .h span{color:#555}
.th-poster .binnote{border:5px solid #000;border-radius:0;font-weight:900;text-transform:uppercase;font-size:22px}
.th-poster .mh .m{font-weight:900;text-transform:uppercase;font-size:66px;letter-spacing:-.02em}
.th-poster .mh .s{color:#000;font-weight:700}
.th-poster .dow div{background:#000;color:#fff;font-weight:900;padding:6px 10px;letter-spacing:.1em}
.th-poster .grid,.th-poster .dow{gap:6px}
.th-poster .tile{background:#fff;border:4px solid #000;border-radius:0}
.th-poster .tile.past{border:4px solid #ccc;color:#aaa}
.th-poster .tile.today{background:#000}
.th-poster .num{font-weight:900;font-size:40px;letter-spacing:-.04em}
.th-poster .ev{font-weight:700;font-size:19px}
.th-poster .ev .tm{color:#000;font-weight:900}
.th-poster .today .ev .tm{color:#fff}
.th-poster .past .ev .tm{color:#aaa}
.th-poster .trip{background:#000;color:#fff;border-radius:0;border:0;font-weight:900;text-transform:uppercase;font-size:16px}
.th-poster .trip.cont{background:repeating-linear-gradient(45deg,#000 0 6px,#fff 6px 12px);color:transparent}
.th-poster .cwx{font-weight:900}

/* Ledger: monospaced, dotted rules */
.th-ledger,.th-ledger .big,.th-ledger .my,.th-ledger .mh .m,.th-ledger .num{font-family:'MA Plex Mono',monospace}
.th-ledger .side{background:#fff;color:#000;border-right:3px dotted #000}
.th-ledger .wd{color:#000;letter-spacing:.1em;font-weight:600}
.th-ledger .wd::before{content:"> "}
.th-ledger .big{font-weight:700;font-size:230px;letter-spacing:-.04em;line-height:1;margin-top:10px}
.th-ledger .my{font-size:34px;text-transform:uppercase;letter-spacing:.08em}
.th-ledger .now,.th-ledger .fc{border-style:dotted;border-color:#000}
.th-ledger .now .t{font-size:42px;white-space:nowrap}
.th-ledger .now .c{font-size:20px}
.th-ledger .now .c,.th-ledger .ag .tm,.th-ledger .fc .d,.th-ledger .lab{color:#555}
.th-ledger .fc .h{font-size:17px;white-space:nowrap;letter-spacing:-.04em}
.th-ledger .lab::before{content:"// "}
.th-ledger .ag{font-size:24px}
.th-ledger .binnote{background:#fff;border:3px dashed #000;border-radius:0;font-size:21px}
.th-ledger .mh .m{font-size:50px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.th-ledger .dow div{color:#000;border-bottom:3px dotted #000;padding-bottom:4px}
.th-ledger .grid{gap:0}
.th-ledger .tile{background:transparent;border-radius:0;border-right:2px dotted #888;border-bottom:2px dotted #888}
.th-ledger .tile.past{border:0;border-right:2px dotted #ccc;border-bottom:2px dotted #ccc;color:#aaa}
.th-ledger .tile.today{background:#000}
.th-ledger .num{font-size:30px;font-weight:700}
.th-ledger .num::before{content:"#"}
.th-ledger .ev{font-size:17px}
.th-ledger .ev .tm{font-size:16px;font-weight:400}
.th-ledger .trip{border-radius:0;border:2px solid #000;font-size:16px}
.th-ledger .trip.cont{border-style:dotted}
.th-ledger .cwx{font-size:17px}

/* Soft: airy, light weights */
.th-soft,.th-soft .big,.th-soft .my,.th-soft .mh .m,.th-soft .num{font-family:'MA Manrope',sans-serif}
.ma.th-soft{background:#f2f2f2}
.th-soft .side{background:#ddd;color:#000;margin:24px 0 24px 24px;border-radius:36px;padding:40px 36px}
.th-soft .wd{color:#555;font-weight:500;letter-spacing:.2em}
.th-soft .big{font-weight:300;font-size:270px;letter-spacing:-.05em}
.th-soft .my{font-weight:300;font-size:42px}
.th-soft .now,.th-soft .fc{border-color:#aaa;border-width:1px}
.th-soft .now .t{font-weight:300;font-size:64px}
.th-soft .now .c,.th-soft .ag .tm,.th-soft .fc .d,.th-soft .lab{color:#555}
.th-soft .ag{font-weight:500}
.th-soft .binnote{border-radius:24px;font-weight:500}
.th-soft .mh .m{font-weight:300;font-size:62px;letter-spacing:-.02em}
.th-soft .dow div{color:#777;font-weight:500}
.th-soft .grid,.th-soft .dow{gap:12px}
.th-soft .tile{background:#fff;border-radius:24px;padding:14px 16px}
.th-soft .tile.past{background:transparent;border:0;color:#aaa}
.th-soft .tile.today{background:#fff;color:#000;box-shadow:inset 0 0 0 5px #000}
.th-soft .num{font-weight:300;font-size:36px}
.th-soft .today .num{font-weight:700}
.th-soft .today .ev .tm{color:#666}
.th-soft .ev{font-weight:500;font-size:19px}
.th-soft .ev .tm{font-weight:500;color:#888}
.th-soft .trip{border:0;background:#ccc;font-weight:700}
.th-soft .trip.cont{background:#e2e2e2;color:#777}

/* Portrait: the today panel becomes a band across the top, in three columns */
.tall .wrap{flex-direction:column}
.tall .side{width:auto;flex-direction:row;gap:34px;padding:30px 34px 28px;margin:0;border-right:0}
.tall .col{display:flex;flex-direction:column;min-width:0}
.tall .ca{flex:none}
.tall .cb{flex:none;width:300px}
.tall .cc{flex:1}
.tall .big{font-size:190px}
.tall .my{font-size:34px;white-space:nowrap}
.tall .now{margin-top:0;padding:0 0 18px;border-top:0}
.tall .now i{font-size:64px}
.tall .now .t{font-size:44px}
.tall .now .c{font-size:20px}
.tall .fc{margin-top:16px;padding-top:0;border-top:0}
.tall .fc i{font-size:34px}
.tall .fc .h{font-size:18px}
.tall .fc .d{font-size:16px}
.tall .lab{margin:0 0 8px;font-size:17px}
.tall .lab ~ .lab{margin-top:18px}
.tall .ag{grid-template-columns:90px 1fr;font-size:23px;row-gap:6px}
.tall .ag .tm{font-size:20px}
.tall .binnote{margin-top:auto;padding:12px 16px;font-size:20px;border-radius:12px}
.tall .binnote i{font-size:30px}
.tall .main{padding:24px}
.tall .mh{margin-bottom:12px}
.tall .mh .m{font-size:44px}
.tall .mh .s{font-size:18px}
.tall .dow div{font-size:15px;letter-spacing:.12em;padding-left:8px}
.tall .grid,.tall .dow{gap:6px}
.tall .tile{padding:8px 9px;gap:4px;border-radius:10px}
.tall .num{font-size:28px}
.tall .top{min-height:30px}
.tall .bins{font-size:19px;gap:2px}
.tall .ev{font-size:16px;line-height:1.15}
.tall .ev .tm{font-size:14px;margin-left:3px}
.tall .trip{font-size:14px;padding:3px 7px}
.tall .cwx{font-size:16px;right:8px;bottom:8px}
.tall .cwx i{font-size:28px}
.tall.nosb .tile.has-wx{padding-bottom:40px}
.tall.nosb .main{padding-left:24px}
.th-soft.tall .side{margin:18px 18px 0;border-radius:28px}
.th-paper.tall .side{border-bottom:2px solid #000}
.th-poster.tall .side{border-bottom:10px solid #000}
.th-ledger.tall .side{border-bottom:3px dotted #000}
.th-paper.tall .big{font-size:220px}
.th-poster.tall .big{font-size:230px}
.th-ledger.tall .big{font-size:170px}
.th-ledger.tall .ev{font-size:14px}
.th-paper.tall .num{font-size:34px}
.th-poster.tall .num{font-size:32px}
.th-poster.tall .trip{font-size:12px;letter-spacing:.02em;line-height:1.25}

/* Muted colour: dithered tones, and each event edged in its calendar's colour */
.color{--rust:#8C2A1C;--navy:#1F2E5C;--forest:#2F5A38;--ochre:#B08A2E;--slate:#4F6A92;--blush:#F2D6CC;--cream:#F4EAC8;--sage:#DCE5D2}
.color .ph-recycle{color:var(--forest)}
.color .ph-sun,.color .ph-cloud-sun{color:var(--ochre)}
.color .ph-cloud-rain,.color .ph-cloud-snow,.color .ph-cloud-lightning{color:var(--slate)}
.color .tile.today{background:var(--rust);color:#fff}
.color .tile.today .ev .tm{color:#fff}
.color .tile.today i{color:#fff}
.color .ev.hasc{border-left:5px solid var(--ec);padding-left:7px;margin-left:-2px}
.color .tile.today .ev.hasc{border-left-color:#fff}
.color .tile.past .ev.hasc{border-left-color:color-mix(in srgb,var(--ec) 35%,#fff)}
.color .trip.hasc{border-color:var(--ec);background:color-mix(in srgb,var(--ec) 22%,#fff);color:#000}
.color .trip.cont.hasc{background:color-mix(in srgb,var(--ec) 10%,#fff);color:#444}
.color .ag > div.hasc{border-left:5px solid var(--ec);padding-left:10px}
.color.th-noir .side{background:#1d1d1d}
.color.th-noir .big,.color.th-noir .lab{color:var(--cream)}
.color.th-noir .side .ph-sun,.color.th-noir .side .ph-cloud-sun{color:#E8C468}
.color.th-noir .side .ph-cloud-rain,.color.th-noir .side .ph-cloud-snow{color:#B9C6DC}
.color.th-noir .tile:not(.past):not(.today){background:#fff;box-shadow:inset 0 0 0 2px #000}
.color.th-noir .tile.weekend:not(.past):not(.today){background:var(--cream)}
.color.th-paper .big,.color.th-paper .mh .m{color:var(--rust)}
.color.th-paper .tile.today,.color.th-soft .tile.today{color:#000}
.color.th-paper .tile.today{background:transparent;border-bottom-color:var(--rust)}
.color.th-paper .tile.today .num,.color.th-soft .tile.today .num{color:var(--rust)}
.color.th-paper .tile.today .ev .tm,.color.th-soft .tile.today .ev .tm{color:#555}
.color.th-paper .tile.today .ev.hasc,.color.th-soft .tile.today .ev.hasc{border-left-color:var(--ec)}
.color.th-paper .tile.today .ph-cloud-rain,.color.th-soft .tile.today .ph-cloud-rain,.color.th-paper .tile.today .ph-cloud-snow,.color.th-soft .tile.today .ph-cloud-snow{color:var(--slate)}
.color.th-paper .tile.today .ph-sun,.color.th-soft .tile.today .ph-sun,.color.th-paper .tile.today .ph-cloud-sun,.color.th-soft .tile.today .ph-cloud-sun{color:var(--ochre)}
.color.th-paper .tile.today .ph-recycle,.color.th-soft .tile.today .ph-recycle{color:var(--forest)}
.color.th-paper .tile.today .ph-trash,.color.th-soft .tile.today .ph-trash,.color.th-paper .tile.today .ph-cloud,.color.th-soft .tile.today .ph-cloud{color:#000}
.color.th-paper .binnote{background:var(--rust)}
.color.th-poster .now,.color.th-poster .dow div{background:var(--navy)}
.color.th-poster .now i{color:#fff}
.color.th-poster .big{color:var(--rust)}
.color.th-poster .trip.hasc{background:var(--ec);color:#fff}
.color.th-poster .trip.cont.hasc{background:repeating-linear-gradient(45deg,var(--ec) 0 6px,#fff 6px 12px);color:transparent}
.color.th-ledger .tile.today{background:var(--navy)}
.color.th-ledger .wd,.color.th-ledger .lab{color:var(--rust)}
.ma.color.th-soft,.color.th-soft .tile.past{background:#fff}
.color.th-soft .side{background:var(--sage)}
.color.th-soft .tile:not(.past){background:#fff;box-shadow:inset 0 0 0 2px #999}
.color.th-soft .tile.today{background:var(--blush);box-shadow:inset 0 0 0 4px var(--rust)}
`;
