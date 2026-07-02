const RESTORE_DELAY = 2000;
const STATUS_REFRESH_INTERVAL = 60000;

const STATUS_ICON = {
  online: "\u{1F7E2}", // ??
  sleeping: "\u{1F7E0}", // ??
  offline: "\u{1F534}", // ??
  warning: "\u26A0\uFE0F", // ??
};

const MINECRAFT_HOST = 'serber.kadents.com';
// Optional: set this to a deployed proxy URL (Cloudflare Worker, Vercel function, etc.)
// Example: const PROXY_URL = 'https://your-worker.example.workers.dev';
const PROXY_URL = null;

// Public status APIs to try (in order). Some networks block specific domains,
// so we try multiple providers before giving up.
const PUBLIC_STATUS_APIS = [
  (host) => `https://api.mcsrvstat.us/2/${host}`,
  (host) => `https://api.mcstatus.io/v2/status/java/${host}`,
  (host) => `https://eu.mcapi.us/server/status?ip=${host}`,
];

function fetchWithTimeout(url, opts = {}, timeout = 7000) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
  ]);
}
const PLAYER_UUID_OVERRIDES = {
  '00000000-0000-0000-0000-000000000000': 'Kaden (Admin)',
};
const PLAYER_ALIAS_OVERRIDES = {
  'Anonymous Player': 'Kaden (Admin)',
};

function initCopyControls() {
  const controls = Array.from(document.querySelectorAll('[data-copy]'));
  if (!controls.length) return;

  controls.forEach((control) => {
    control.dataset.originalLabel ??= control.textContent.trim();

    control.addEventListener('click', async () => {
      const value = control.dataset.copy;
      if (!value) return;

      const success = await tryCopy(value);
      renderCopyFeedback(control, success ? 'success' : 'error');
    });
  });
}

async function tryCopy(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    // continue to fallback
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const storedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.select();
    const result = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (storedRange) {
      selection.removeAllRanges();
      selection.addRange(storedRange);
    }

    if (result) return true;
  } catch (error) {
    // fallback to prompt
  }

  const response = window.prompt('Copy the value below and press OK', value);
  return response !== null;
}

function renderCopyFeedback(element, status) {
  const isActionButton = element.classList.contains('btn');

  if (isActionButton) {
    const original = element.dataset.originalLabel ?? element.textContent.trim();
    element.dataset.originalLabel = original;

    element.textContent = status === 'success' ? 'Copied!' : 'Copy failed';
    element.classList.remove('success', 'error');
    element.classList.add(status);

    window.setTimeout(() => {
      element.textContent = element.dataset.originalLabel;
      element.classList.remove('success', 'error');
    }, RESTORE_DELAY);
    return;
  }

  element.dataset.status = status;

  window.setTimeout(() => {
    delete element.dataset.status;
  }, RESTORE_DELAY);
}

function initBackground() {
  const canvas = document.getElementById('background');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let orbs = [];
  const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
  let width = 0;
  let height = 0;

  function buildOrbs(count) {
    const randomBetween = (min, max) => min + Math.random() * (max - min);
    return Array.from({ length: count }, () => ({
      speed: randomBetween(0.04, 0.11),
      radius: randomBetween(140, 340),
      orbit: randomBetween(140, 420),
      hue: randomBetween(250, 275),
      alpha: randomBetween(0.2, 0.42),
      offset: Math.random() * Math.PI * 2,
      wobble: randomBetween(0.35, 0.9),
    }));
  }

  function desiredOrbCount() {
    return window.matchMedia('(min-width: 1024px)').matches ? 24 : 16;
  }

  function syncOrbCount() {
    const nextCount = desiredOrbCount();
    if (orbs.length !== nextCount) {
      orbs = buildOrbs(nextCount);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncOrbCount();
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function handlePointerMove(clientX, clientY) {
    if (!width || !height) return;
    pointer.targetX = clamp01(clientX / width);
    pointer.targetY = clamp01(clientY / height);
  }

  function renderFrame(time) {
    const seconds = time * 0.001;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(10, 5, 24, 0.35)';
    ctx.fillRect(0, 0, width, height);

    pointer.x += (pointer.targetX - pointer.x) * 0.05;
    pointer.y += (pointer.targetY - pointer.y) * 0.05;

    const pointerOffsetX = (pointer.x - 0.5) * 180;
    const pointerOffsetY = (pointer.y - 0.5) * 120;

    ctx.globalCompositeOperation = 'lighter';

    orbs.forEach((orb, index) => {
      const angle = orb.offset + seconds * orb.speed * Math.PI * 2;
      const wobble = (Math.sin(seconds * 0.6 + index) + 1) * 0.5;

      const baseX = width * 0.5;
      const baseY = height * 0.42;
      const x = baseX + Math.cos(angle) * (orb.orbit + pointerOffsetX * 0.4);
      const y = baseY + Math.sin(angle) * (orb.orbit * 0.5) + pointerOffsetY;
      const radius = orb.radius * (0.35 + wobble * orb.wobble);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `hsla(${orb.hue}, 95%, 65%, ${orb.alpha})`);
      gradient.addColorStop(0.45, `hsla(${orb.hue + 25}, 90%, 60%, ${orb.alpha * 0.7})`);
      gradient.addColorStop(1, 'rgba(10, 5, 24, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';
    window.requestAnimationFrame(renderFrame);
  }

  const onPointerMove = (event) => handlePointerMove(event.clientX, event.clientY);
  const onTouchMove = (event) => {
    if (event.touches.length === 0) return;
    const touch = event.touches[0];
    handlePointerMove(touch.clientX, touch.clientY);
  };
  const resetPointer = () => {
    pointer.targetX = 0.5;
    pointer.targetY = 0.5;
  };

  resize();
  window.requestAnimationFrame(renderFrame);

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerleave', resetPointer);
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', resetPointer);
}

function updateStatusChip(element, statusClass, message) {
  if (!element) return;
  element.textContent = message;
  element.setAttribute('aria-label', message);
  element.classList.remove('is-online', 'is-sleeping', 'is-offline', 'is-error');
  if (statusClass) {
    element.classList.add(statusClass);
  }
}

function setStatusTooltip(element, message) {
  if (!element) return;
  if (message) {
    element.dataset.tooltip = message;
  } else {
    delete element.dataset.tooltip;
  }
}

async function fetchAdditionalMinecraftNames() {
  try {
    const response = await fetch(`https://api.mcstatus.io/v2/status/java/${MINECRAFT_HOST}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    const entries = Array.isArray(payload?.players?.list) ? payload.players.list : [];
    return entries
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          const uuidValue =
            typeof entry.uuid === 'string'
              ? entry.uuid.trim().toLowerCase()
              : null;
          if (uuidValue && PLAYER_UUID_OVERRIDES[uuidValue]) {
            return PLAYER_UUID_OVERRIDES[uuidValue];
          }

          return (
            entry.name_clean ??
            entry.name_raw ??
            entry.name ??
            entry.ign ??
            null
          );
        }
        return null;
      })
      .filter((value) => typeof value === 'string' && value.trim().length > 0);
  } catch (error) {
    return [];
  }
}

async function fetchMinecraftStatus(element) {
  if (!element) return;
  updateStatusChip(element, null, 'Checking server status...');
  setStatusTooltip(element, null);
  try {
    let data = null;

    // 1) If a proxy URL is configured, try it first. The proxy should accept
    //    a `host` query parameter and return the same JSON shape as mcsrvstat.
    if (PROXY_URL) {
      try {
        const url = new URL(PROXY_URL);
        url.searchParams.set('host', MINECRAFT_HOST);
        const resp = await fetchWithTimeout(url.toString(), { cache: 'no-store' }, 8000);
        if (resp.ok) data = await resp.json();
      } catch (e) {
        // proxy failed — continue to public APIs
      }
    }

    // 2) Try a list of public status APIs until one returns usable data.
    if (!data) {
      for (const makeUrl of PUBLIC_STATUS_APIS) {
        try {
          const url = makeUrl(MINECRAFT_HOST);
          const resp = await fetchWithTimeout(url, { cache: 'no-store' }, 7000);
          if (!resp.ok) continue;
          data = await resp.json();
          if (data) break;
        } catch (e) {
          // try next API
        }
      }
    }

    if (!data) throw new Error('No status provider responded');

    if (data?.online) {
      const collectedNames = [];
      const seenNames = new Set();

      const addName = (value) => {
        if (typeof value !== 'string') return;
        const rawName = value.trim();
        if (!rawName.length) return;
        const displayName = PLAYER_ALIAS_OVERRIDES[rawName] ?? rawName;
        const key = displayName.toLowerCase();
        if (seenNames.has(key)) return;
        seenNames.add(key);
        collectedNames.push(displayName);
      };

      if (Array.isArray(data?.players?.list)) {
        data.players.list.forEach(addName);
      }

      if (Array.isArray(data?.players?.sample)) {
        data.players.sample.forEach((entry) => {
          if (entry && typeof entry === 'object') {
            if ('name' in entry) addName(entry.name);
            if ('ign' in entry) addName(entry.ign);
          }
        });
      }

      if (data?.players?.uuid && typeof data.players.uuid === 'object') {
        Object.keys(data.players.uuid).forEach(addName);
      }

      const reportedCount = Number.isFinite(data?.players?.online) ? data.players.online : collectedNames.length;
      const playerCount = Math.max(0, reportedCount);
      const suffix = playerCount === 1 ? 'player' : 'players';

      if (playerCount > collectedNames.length) {
        const fallbackNames = await fetchAdditionalMinecraftNames();
        if (fallbackNames.length) {
          fallbackNames.forEach(addName);
        }
      }

      const playerList = collectedNames;
      const hiddenCount = Math.max(0, playerCount - playerList.length);

      if (playerCount > 0) {
        updateStatusChip(
          element,
          'is-online',
          `${STATUS_ICON.online} Minecraft Server - Online (${playerCount} ${suffix})`
        );

        const tooltipLines = ['Players online: ' + playerCount];

        if (playerList.length) {
          tooltipLines.push(...playerList);
        }

        if (hiddenCount > 0) {
          const hiddenSuffix = hiddenCount === 1 ? 'player' : 'players';
          tooltipLines.push(`+${hiddenCount} more ${hiddenSuffix} online`);
        }

        setStatusTooltip(element, tooltipLines.join('\n'));
      } else {
        updateStatusChip(
          element,
          'is-sleeping',
          `${STATUS_ICON.sleeping} Minecraft Server - Sleeping (0 players online)`
        );
        setStatusTooltip(element, 'Server is idle and ready for players.');
      }
    } else {
      updateStatusChip(element, 'is-offline', `${STATUS_ICON.offline} Minecraft Server -  Offline`);
      setStatusTooltip(element, null);
    }
  } catch (error) {
    updateStatusChip(element, 'is-error', `${STATUS_ICON.warning} Error checking Minecraft`);
    setStatusTooltip(element, null);
  }
}

async function fetchNasStatus(element) {
  if (!element) return;
  updateStatusChip(element, null, 'Checking NAS...');
  try {
    const response = await fetch('https://fin.kadents.com/health', {
      cache: 'no-store',
      mode: 'no-cors',
    });

    const reachable = response.ok || response.type === 'opaque';
    if (reachable) {
      updateStatusChip(element, 'is-online', `${STATUS_ICON.online} NAS - Online`);
    } else {
      updateStatusChip(element, 'is-offline', `${STATUS_ICON.offline} NAS - Offline`);
    }
  } catch (error) {
    updateStatusChip(element, 'is-offline', `${STATUS_ICON.offline} NAS - Offline`);
  }
}

function initStatusChecks() {
  const minecraftStatusEl = document.getElementById('mc-status');
  const nasStatusEl = document.getElementById('nas-status');

  if (minecraftStatusEl) {
    const runMinecraftCheck = () => fetchMinecraftStatus(minecraftStatusEl);
    runMinecraftCheck();
    window.setInterval(runMinecraftCheck, STATUS_REFRESH_INTERVAL);
  }

  if (nasStatusEl) {
    const runNasCheck = () => fetchNasStatus(nasStatusEl);
    runNasCheck();
    window.setInterval(runNasCheck, STATUS_REFRESH_INTERVAL);
  }
}

initBackground();
initCopyControls();
initStatusChecks();
