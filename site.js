// Page behaviour that isn't status or copy: reading versions, the map, the LED matrix and the Easter eggs.
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(key, fallback, area = 'localStorage') {
    try {
      const value = window[area].getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },
  set(key, value, area = 'localStorage') {
    try {
      window[area].setItem(key, JSON.stringify(value));
    } catch (error) {
      // storage blocked; nothing to remember
    }
  },
};

// ---------- Toasts ----------
function toast(message, isEgg = false) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = isEgg ? 'toast egg' : 'toast';
  el.textContent = message;
  box.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  while (box.children.length > 3) box.firstElementChild.remove();
}

// ---------- Eggs ----------
const EGGS = {
  loading: ['Impatient', 'Pushed the loading bar past 99%.', 'Loading bars respond to encouragement.'],
  konami: ['RGB Edition', 'Entered the old code.', 'Up, up, down, down...'],
  finley: ['Good Boy', 'Let the dog out.', "Type the name of the lab's best boy."],
  sudo: ['Not in the Sudoers File', 'Asked for root.', 'Type the word admins put in front of everything.'],
  creeper: ['Aww Man', 'Summoned a creeper.', 'Type the name of the green thing that hisses.'],
  led: ['Lit Up', 'Turned the title into LEDs.', 'Type the three letters from chapter 06.'],
  plasma: ['Hidden Mode', "Found the matrix's secret mode.", 'The LED matrix has more modes than it admits.'],
  ping: ['Pong', 'Pinged the NAS by hand.', 'Status chips like attention.'],
  idle: ['Screensaver', 'Left the page alone long enough.', 'Walk away for a minute.'],
  rogue: ['Rogue Device', 'Found the unknown device on the map.', 'Not everything on the map is labeled.'],
  flash: ['Plugin Required', 'Typed the forbidden word.', 'Type the plugin every old website needed.'],
  four: ['Version 4', "Asked for a version that doesn't exist.", 'There are three versions. Or are there?'],
  honeypot: ['Honeypot', 'Tried to log in as admin.', 'Every site has an admin page.'],
};
const TOTAL = Object.keys(EGGS).length;
const found = new Set(store.get('kd-eggs', []).filter((key) => key in EGGS));
const eggBtn = $('eggBtn');

function paintEggs() {
  eggBtn.textContent = `Eggs ${found.size}/${TOTAL}`;
  root.classList.toggle('root', found.size === TOTAL);
}

function egg(key) {
  if (found.has(key)) return;
  found.add(key);
  store.set('kd-eggs', [...found]);
  paintEggs();
  toast(`${EGGS[key][0]} (${found.size}/${TOTAL})`, true);
  if (found.size === TOTAL) window.setTimeout(() => toast(`root access granted. All ${TOTAL} found.`, true), 1200);
}

// ---------- Modal ----------
const modal = $('modal');
const card = $('card');
let lastFocus = null;

function openModal(html) {
  lastFocus = document.activeElement;
  card.innerHTML = html;
  modal.hidden = false;
  (card.querySelector('input, [data-close]') || card).focus();
}

function closeModal() {
  modal.hidden = true;
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

modal.addEventListener('click', (event) => {
  if (event.target === modal || event.target.closest('[data-close]')) closeModal();
  if (event.target.closest('[data-reset]')) {
    found.clear();
    store.set('kd-eggs', []);
    paintEggs();
    closeModal();
    toast('Egg log cleared.');
  }
});

const openEggs = () => {
  const items = Object.entries(EGGS)
    .map(([key, [name, done, hint]]) =>
      found.has(key)
        ? `<li class="got"><span><b>${name}</b><small>${done}</small></span></li>`
        : `<li><span><b>???</b><small>${hint}</small></span></li>`
    )
    .join('');
  openModal(`<h3>Eggs ${found.size}/${TOTAL}</h3>
    <p class="mono">On a phone? Triple-tap the KADENTS title to type words.</p>
    <ul class="eggs">${items}</ul>
    <div class="card-actions"><button class="btn ghost" type="button" data-reset>Clear log</button><button class="btn primary" type="button" data-close>Close</button></div>`);
};
document.querySelectorAll('#eggBtn, [data-eggs]').forEach((button) => button.addEventListener('click', openEggs));

// ---------- Projects page ----------
document.querySelectorAll('[data-projects]').forEach((button) => button.addEventListener('click', () => {
  openModal($('projectsTpl').innerHTML);
}));
card.addEventListener('click', (event) => {
  const link = event.target.closest('[data-goto]');
  if (!link) return;
  closeModal();
  goTo(link.dataset.goto);
});

// ---------- Reading versions ----------
const MODES = ['eli5', 'tech', 'comm'];
const versMark = document.querySelector('#rail .vers-mark');

function placeVersMark() {
  const on = document.querySelector('#rail .vers button[aria-pressed="true"]');
  if (!versMark || !on) return;
  versMark.style.left = `${on.offsetLeft}px`;
  versMark.style.width = `${on.offsetWidth}px`;
}

function setMode(mode) {
  root.dataset.mode = mode;
  document.querySelectorAll('[data-mode-btn]:not([data-start])').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.modeBtn === mode));
  });
  placeVersMark();
  store.set('kd-mode', mode);
}

function goTo(id) {
  const target = $(id);
  if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
}

document.querySelectorAll('[data-mode-btn]').forEach((button) => {
  button.addEventListener('click', () => {
    setMode(button.dataset.modeBtn);
    if (button.hasAttribute('data-start')) goTo('ch-01');
  });
});
const savedMode = store.get('kd-mode', 'eli5');
setMode(MODES.includes(savedMode) ? savedMode : 'eli5');
document.fonts?.ready.then(placeVersMark);
window.addEventListener('resize', placeVersMark);

document.querySelectorAll('#rail button[data-go], .quick button[data-go]').forEach((button) => {
  button.addEventListener('click', () => goTo(button.dataset.go));
});

// ---------- Landing map ----------
const map = $('map');
const caption = $('schemCap');
const defaultCaption = caption.textContent;
map.querySelectorAll('.wires path, .node').forEach((el, i) => el.style.setProperty('--i', i));
map.querySelectorAll('.node').forEach((node) => {
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', node.dataset.egg ? 'button' : 'link');
  node.setAttribute('aria-label', node.dataset.label);
  const show = () => { caption.textContent = node.dataset.label; };
  const hide = () => { caption.textContent = defaultCaption; };
  const go = () => {
    if (node.dataset.egg === 'rogue') {
      caption.textContent = 'Unknown device. Investigating... it is the smart fridge. Again.';
      egg('rogue');
      return;
    }
    goTo(node.dataset.go);
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  node.addEventListener('click', go);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      go();
    }
  });
});

// ---------- Scene: the map, big and fixed, framing whatever the current chapter is about ----------
const scene = $('scene');
const sceneMap = map.cloneNode(true);
sceneMap.querySelector('title')?.remove();
scene.setAttribute('viewBox', map.getAttribute('viewBox'));
scene.append(...sceneMap.childNodes);
scene.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
scene.querySelectorAll('.node').forEach((node) => node.removeAttribute('tabindex'));

const stages = [...document.querySelectorAll('.stage[data-focus]')];
const railButtons = [...document.querySelectorAll('#index button[data-go]')];
const idxMark = document.querySelector('#rail .idx-mark');
let view = stages[0].dataset.focus.split(' ').map(Number);
let viewFrom = view;
let viewTo = view;
let viewStart = 0;
let viewFrame = 0;
let current;

function applyView(box) {
  scene.setAttribute('viewBox', box.join(' '));
  const scale = Math.min(scene.clientWidth / box[2], scene.clientHeight / box[3]) || 1;
  scene.style.setProperty('--fs', `${11 / scale}px`); // labels stay about 11px on screen at any zoom
}

function tweenView(now) {
  const t = reduced ? 1 : Math.min(1, (now - viewStart) / 900);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  view = viewFrom.map((v, i) => v + (viewTo[i] - v) * e);
  applyView(view);
  if (t < 1) viewFrame = window.requestAnimationFrame(tweenView);
}

function placeIdxMark() {
  const on = railButtons.find((button) => button.hasAttribute('aria-current'));
  if (!idxMark || !on) return;
  idxMark.style.opacity = '1';
  idxMark.style.transform = `translateY(${on.offsetTop + (on.offsetHeight - 8) / 2}px)`;
}

function enterStage(stage) {
  if (stage === current) return;
  current = stage;
  root.classList.toggle('in-chapters', Boolean(stage));
  if (!stage) return;
  root.dataset.chapter = stage.id; // city.js flies the 3D camera to this chapter

  window.cancelAnimationFrame(viewFrame);
  viewFrom = view;
  viewTo = stage.dataset.focus.split(' ').map(Number);
  viewStart = performance.now();
  viewFrame = window.requestAnimationFrame(tweenView);

  const lit = stage.dataset.lit.split(' ');
  const all = lit.includes('all');
  scene.querySelectorAll('.node').forEach((node) => node.classList.toggle('lit', all || lit.includes(node.dataset.id)));
  scene.querySelectorAll('.labels text').forEach((text) => text.classList.toggle('lit', !all && lit.includes(text.dataset.for)));
  scene.querySelector('.wires').classList.toggle('lit', all);

  railButtons.forEach((button) => button.dataset.go === stage.id ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current"));
  placeIdxMark();
}

let scrollQueued = false;
function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  window.requestAnimationFrame(() => {
    scrollQueued = false;
    const line = window.innerHeight * 0.6;
    let next = null;
    stages.forEach((stage) => {
      if (stage.getBoundingClientRect().top < line) next = stage;
    });
    enterStage(next);
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  applyView(view);
  placeIdxMark();
});
applyView(view);
onScroll();

// ---------- Loader (once per browser session): the rule over the title fills, and sticks at 99% ----------
(function loader() {
  if (store.get('kd-loaded', false, 'sessionStorage')) return;
  store.set('kd-loaded', true, 'sessionStorage');
  root.classList.add('loading');
  const bar = $('loaderBar');
  const fill = $('loaderFill');
  const pct = $('loaderPct');
  let value = 0;
  let stalled = false;
  let done = false;
  let stallTimer = 0;
  bar.tabIndex = 0;
  bar.removeAttribute('aria-hidden');

  const set = (v) => {
    value = v;
    fill.style.width = `${v}%`;
    pct.textContent = `Loading ${Math.floor(v)}%`;
  };
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(stallTimer);
    set(100);
    bar.tabIndex = -1;
    bar.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => root.classList.remove('loading'), 150);
  };
  const tick = () => {
    if (done) return;
    set(Math.min(99, value + 3 + Math.random() * 6));
    if (value >= 99) {
      stalled = true;
      pct.textContent = 'Loading 99%';
      stallTimer = window.setTimeout(finish, 1500);
      return;
    }
    window.setTimeout(tick, 40);
  };
  tick();

  bar.addEventListener('click', () => {
    if (stalled && !done) {
      egg('loading');
      finish();
    }
  });
})();

// ---------- Words and keys ----------
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
let recentKeys = [];
let typed = '';

const WORDS = {
  finley() {
    const dog = $('dog');
    dog.hidden = false;
    dog.style.animation = 'none';
    void dog.getBoundingClientRect();
    dog.style.animation = '';
    toast('Finley got loose. Good boy.');
    egg('finley');
  },
  sudo() {
    toast('kadn is not in the sudoers file. This incident will be reported.');
    egg('sudo');
  },
  creeper() {
    toast('Ssssss...');
    window.setTimeout(() => {
      [$('ch-05'), ...document.querySelectorAll('[data-id="mc"]')].forEach((el) => {
        el.classList.remove('boom');
        void el.getBoundingClientRect();
        el.classList.add('boom');
      });
      root.classList.add('boom-mc');
      window.setTimeout(() => root.classList.remove('boom-mc'), 1500);
      toast('Aww man.');
      egg('creeper');
    }, 1200);
  },
  led() {
    $('title').classList.toggle('led-type');
    egg('led');
  },
  flash() {
    const plugin = $('plugin');
    if (!plugin.hidden) return;
    plugin.hidden = false;
    window.setTimeout(() => {
      plugin.hidden = true;
      toast('Kidding. This site never needed it.');
      egg('flash');
    }, 2200);
  },
  uuddlrlrba: konami,
};

function konami() {
  root.classList.toggle('rgb');
  toast(root.classList.contains('rgb') ? 'RGB mode. Every homelab needs RGB.' : 'RGB off. Back to business.');
  egg('konami');
}

function checkWords(text) {
  const hit = Object.keys(WORDS).find((word) => text.endsWith(word));
  if (hit) WORDS[hit]();
  return Boolean(hit);
}

$('dog').addEventListener('animationend', () => { $('dog').hidden = true; });
document.querySelectorAll('#ch-05, [data-id="mc"]').forEach((el) => el.addEventListener('animationend', () => el.classList.remove('boom')));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) {
    closeModal();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
  if (!modal.hidden) return;
  const key = event.key.toLowerCase();

  recentKeys = [...recentKeys, key].slice(-KONAMI.length);
  if (recentKeys.join() === KONAMI.join()) {
    recentKeys = [];
    konami();
  }
  if (key === '1' || key === '2' || key === '3') setMode(MODES[Number(key) - 1]);
  if (key === '4') {
    toast('There is no version 4. Yet.');
    egg('four');
  }
  if (/^[a-z]$/.test(key)) {
    typed = (typed + key).slice(-12);
    if (checkWords(typed)) typed = '';
  }
});

$('title').addEventListener('click', (event) => {
  if (event.detail !== 3) return;
  $('console').hidden = false;
  $('cmd').focus();
});
$('console').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('cmd').value.toLowerCase().replace(/[^a-z]/g, '');
  $('cmd').value = '';
  if (value && !checkWords(value)) toast(`Unknown command: ${value.slice(0, 20)}`);
});

// ---------- Lab light in the rail, following the live NAS check ----------
const labState = $('labState');
const nasChip = $('nas-status');
if (labState && nasChip) {
  const mirror = () => {
    const up = nasChip.classList.contains('is-online');
    const down = nasChip.classList.contains('is-offline');
    labState.classList.toggle('up', up);
    labState.classList.toggle('down', down);
    labState.textContent = up ? 'Lab online' : down ? 'Lab offline' : 'Checking the lab';
  };
  new MutationObserver(mirror).observe(nasChip, { attributes: true, attributeFilter: ['class'] });
  mirror();
}

// ---------- Ping ----------
let pings = 0;
let pingTimer = 0;
$('nas-status')?.addEventListener('click', () => {
  pings += 1;
  window.clearTimeout(pingTimer);
  pingTimer = window.setTimeout(() => { pings = 0; }, 2000);
  if (pings === 5) {
    pings = 0;
    toast('PING fin.kadents.com ... PONG');
    egg('ping');
  }
});

// ---------- Honeypot ----------
$('adminLink')?.addEventListener('click', () => {
  openModal(`<h3>Admin panel</h3>
    <form id="honey" style="display:grid;gap:12px">
      <label>Username<input name="u" autocomplete="off" spellcheck="false"></label>
      <label>Passphrase<input name="p" type="password" autocomplete="off"></label>
      <p class="mono" id="honeyMsg" hidden></p>
      <div class="card-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Log in</button></div>
    </form>`);
  $('honey').addEventListener('submit', (event) => {
    event.preventDefault();
    event.target.reset(); // nothing typed here is kept or sent
    const msg = $('honeyMsg');
    msg.hidden = false;
    msg.textContent = "Access denied. This attempt has been logged. (It hasn't. Nothing you typed left this page.)";
    egg('honeypot');
  });
});

// ---------- Visitor counter ----------
const visits = store.get('kd-visits', 0) + 1;
store.set('kd-visits', visits);
if ($('digits')) $('digits').textContent = String(4810 + visits).padStart(6, '0');
$('counter')?.addEventListener('click', () => toast('You are a very important visitor.'));

// ---------- Idle screensaver ----------
const saver = $('saver');
const saverText = $('saverText');
let idleTimer = 0;
let saverFrame = 0;

function startSaver() {
  if (!modal.hidden) return resetIdle();
  saver.hidden = false;
  const pos = { x: 40, y: 40, dx: 1.6, dy: 1.2 };
  const colors = ['#e4e3de', '#9a9a9a', '#ffffff', '#6e6e6e', '#c8c8c4'];
  let c = 0;
  const step = () => {
    const maxX = window.innerWidth - saverText.offsetWidth;
    const maxY = window.innerHeight - saverText.offsetHeight;
    pos.x += pos.dx;
    pos.y += pos.dy;
    if (pos.x <= 0 || pos.x >= maxX) { pos.dx *= -1; c += 1; }
    if (pos.y <= 0 || pos.y >= maxY) { pos.dy *= -1; c += 1; }
    pos.x = Math.max(0, Math.min(maxX, pos.x));
    pos.y = Math.max(0, Math.min(maxY, pos.y));
    saverText.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    saverText.style.color = colors[c % colors.length];
    saverFrame = window.requestAnimationFrame(step);
  };
  step();
}

function resetIdle() {
  if (!saver.hidden) {
    saver.hidden = true;
    window.cancelAnimationFrame(saverFrame);
    toast('Welcome back.');
    egg('idle');
  }
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(startSaver, 60000);
}
['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((type) =>
  window.addEventListener(type, resetIdle, { passive: true })
);
resetIdle();

// ---------- LED matrix ----------
(function led() {
  const canvas = $('led');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  off.width = 64;
  off.height = 64;
  const octx = off.getContext('2d', { willReadFrequently: true });
  const DOT = canvas.width / 64;
  const MESSAGE = 'KADENTS NETWORK  *  HOMELAB ONLINE  *  ';
  let mode = 0; // 0 clock, 1 scroller, 2 plasma (hidden)
  let scroll = 64;
  let last = 0;

  canvas.addEventListener('click', () => {
    mode = (mode + 1) % 3;
    if (mode === 2) egg('plasma');
  });

  function textFrame(now) {
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, 64, 64);
    octx.textBaseline = 'middle';
    if (mode === 0) {
      const d = new Date();
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      octx.textAlign = 'center';
      octx.fillStyle = '#ecebe6';
      octx.font = 'bold 17px monospace';
      octx.fillText(hm, 32, 26);
      octx.fillStyle = '#9d9d9a';
      octx.font = 'bold 9px monospace';
      octx.fillText(d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit' }).toUpperCase(), 32, 44);
      // seconds bar along the bottom edge
      octx.fillStyle = '#c8c8c4';
      octx.fillRect(2, 58, Math.round((d.getSeconds() / 59) * 60), 2);
    } else {
      octx.textAlign = 'left';
      octx.fillStyle = '#ecebe6';
      octx.font = 'bold 14px monospace';
      octx.fillText(MESSAGE, scroll, 32);
      const width = octx.measureText(MESSAGE).width;
      scroll -= 1;
      if (scroll < -width) scroll = 64;
    }
    return octx.getImageData(0, 0, 64, 64).data;
  }

  function draw(now) {
    window.requestAnimationFrame(draw);
    if (now - last < 50) return;
    last = now;
    const t = now / 1000;
    const data = mode === 2 ? null : textFrame(now);
    ctx.fillStyle = '#111214';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        let r;
        let g;
        let b;
        if (data) {
          const i = (y * 64 + x) * 4;
          const lit = data[i] + data[i + 1] + data[i + 2] > 180;
          [r, g, b] = lit ? [data[i], data[i + 1], data[i + 2]] : [38, 39, 43];
        } else {
          const v = Math.sin(x * 0.18 + t) + Math.sin(y * 0.14 + t * 1.3) + Math.sin((x + y) * 0.09 + t * 0.7);
          r = g = b = 128 + 127 * Math.sin(v * Math.PI); // grayscale plasma
        }
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(x * DOT + 1, y * DOT + 1, DOT - 1.5, DOT - 1.5);
      }
    }
  }
  window.requestAnimationFrame(draw);
})();

paintEggs();

// a hello for anyone who opens the developer tools
console.log(
  [
    '%cKADENTS%c',
    "Hi, I'm Kaden. Poking around under the hood? Good instinct.",
    'The code is public: https://github.com/Kadn0/Domain',
    'There are 13 eggs on this page. The console will not give you any of them.',
  ].join('\n'),
  'font: 300 28px "Hanken Grotesk", sans-serif; letter-spacing: -0.02em;',
  'font: 12px "Martian Mono", monospace; line-height: 1.6;'
);
