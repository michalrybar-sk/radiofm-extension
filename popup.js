const $ = id => document.getElementById(id);
const playBtn   = $('playBtn'),   iconPlay = $('iconPlay'), iconStop = $('iconStop');
const footerQual = $('footerQual');
const genreTime = $('genreTime');
const trackEl   = $('trackName'), loadingEl = $('loadingEl'), viz = $('viz');
const liveBadge = $('liveBadge'), liveDot = $('liveDot'),   liveText = $('liveText');
const volSlider = $('volSlider'), volVal = $('volVal'),     volIcon = $('volIcon');
const genreBar  = $('genreBar'),  genreText = $('genreText');
const plToggle  = $('plToggle'),  plArrow = $('plArrow'),   plBody = $('plBody'), plCount = $('plCount');

let plOpen = false, isCurrentlyPlaying = false;
let countdownTimer = null, countdownSec = 0;
let isMuted = false;

// ── Countdown ────────────────────────────────────────────────────────────────

function startCountdown(sec) {
  stopCountdown();
  countdownSec = sec;
  const txt = loadingEl.querySelector('.loading-txt');
  txt.innerHTML = 'NAČÍTAVAM STREAM… <span class="loading-count">' + countdownSec + 's</span>';
  countdownTimer = setInterval(function() {
    countdownSec--;
    if (countdownSec <= 0) { stopCountdown(); return; }
    txt.innerHTML = 'NAČÍTAVAM STREAM… <span class="loading-count">' + countdownSec + 's</span>';
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  const txt = loadingEl.querySelector('.loading-txt');
  if (txt) txt.textContent = 'NAČÍTAVAM STREAM…';
}

// ── Volume ────────────────────────────────────────────────────────────────────

function setSlider(v) {
  volSlider.value = v;
  volSlider.style.background = `linear-gradient(to right,#E30613 ${v}%,#222 ${v}%)`;
  volVal.textContent = v + '%';
  volIcon.classList.toggle('active', v > 0);
}
setSlider(100);

volIcon.addEventListener('click', () => {
  isMuted = !isMuted;
  volIcon.classList.toggle('muted', isMuted);
  volIcon.closest('.vol-section').classList.toggle('muted', isMuted);
  volIcon.querySelector('.icon-sound').style.display = isMuted ? 'none' : '';
  volIcon.querySelector('.icon-mute').style.display  = isMuted ? '' : 'none';
  chrome.runtime.sendMessage({ action: 'SET_MUTE', muted: isMuted });
});

volSlider.addEventListener('input', () => {
  const v = +volSlider.value;
  setSlider(v);
  chrome.runtime.sendMessage({ action: 'SET_VOLUME', volume: v / 100 });
});

// ── Playlist ──────────────────────────────────────────────────────────────────

plToggle.addEventListener('click', () => {
  plOpen = !plOpen;
  plBody.classList.toggle('open', plOpen);
  plArrow.classList.toggle('open', plOpen);
});

function renderPlaylist(items) {
  if (!items || !items.length) {
    plCount.textContent = '—';
    plBody.innerHTML = '<div class="pl-empty">Zapni rádio pre načítanie playlistu…</div>';
    return;
  }
  plCount.textContent = items.length;
  plBody.innerHTML = items.map((item, i) => `
    <div class="pl-row${i === 0 ? ' current' : ''}">
      <div class="pl-left">
        <span class="pl-time">${item.time}</span>
        <div class="pl-mini-viz${i === 0 && isCurrentlyPlaying ? ' active' : ''}">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="pl-info">
        <div class="pl-artist">${item.artist}</div>
        <div class="pl-song">${item.song}</div>
      </div>
    </div>`).join('');
  if (!plOpen) { plOpen = true; plBody.classList.add('open'); plArrow.classList.add('open'); }
}

// ── Now playing ───────────────────────────────────────────────────────────────

function showTrack(track) {
  loadingEl.classList.remove('show');
  if (!track) { trackEl.className = 'track-name'; trackEl.innerHTML = '<span class="track-idle">Načítavam…</span>'; return; }
  const scroll = track.length > 30;
  trackEl.className = 'track-name' + (scroll ? ' scroll' : '');
  trackEl.innerHTML = scroll ? `<span>${track}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${track}</span>` : `<span>${track}</span>`;
}

function showIdle(text = 'Stlač play') {
  loadingEl.classList.remove('show');
  trackEl.className = 'track-name';
  trackEl.innerHTML = `<span class="track-idle">${text}</span>`;
}

// ── State ─────────────────────────────────────────────────────────────────────

function applyState(s) {
  const active = s.isPlaying || s.isBuffering;
  isCurrentlyPlaying = s.isPlaying;

  playBtn.classList.toggle('playing', active);
  iconPlay.style.display = active ? 'none' : 'block';
  iconStop.style.display = active ? 'block' : 'none';
  viz.classList.toggle('on', s.isPlaying);
  liveBadge.classList.toggle('off', !active);
  liveDot.classList.toggle('pulse', active);
  liveText.textContent = active ? 'LIVE' : 'OFFLINE';

  stopCountdown();
  if (!active)       showIdle();
  else if (s.isBuffering) {
    trackEl.innerHTML = '';
    loadingEl.classList.add('show');
    startCountdown(8);
  }
  else               showTrack(s.track || '');

  if (s.genre) {
    const g = s.genre;
    const scroll = g.length > 28;
    genreText.className = 'genre-text' + (scroll ? ' scroll' : '');
    genreText.innerHTML = scroll ? `<span>${g}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${g}</span>` : g;
    genreTime.textContent = s.genreTime || '';
    genreBar.classList.remove('hidden');
  }
  if (s.quality)                        { footerQual.textContent = s.quality; }
  if (!active)                          { footerQual.textContent = '—'; }
  if (typeof s.volume === 'number')     setSlider(Math.round(s.volume * 100));
  if (s.playlist && s.playlist.length) renderPlaylist(s.playlist);
}

// ── Play button ───────────────────────────────────────────────────────────────

playBtn.addEventListener('click', () => {
  const active = playBtn.classList.contains('playing');
  // Optimistic UI
  playBtn.classList.toggle('playing', !active);
  iconPlay.style.display = active ? 'block' : 'none';
  iconStop.style.display = active ? 'none'  : 'block';
  if (active) { viz.classList.remove('on'); showIdle(); liveBadge.classList.add('off'); liveDot.classList.remove('pulse'); liveText.textContent = 'OFFLINE'; isCurrentlyPlaying = false; }
  else        { trackEl.innerHTML = ''; loadingEl.classList.add('show'); startCountdown(8); liveBadge.classList.remove('off'); liveDot.classList.add('pulse'); liveText.textContent = 'LIVE'; }
  chrome.runtime.sendMessage({ action: 'TOGGLE' });
});

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'STATE' || msg.type === 'PLAYLIST' || msg.type === 'GENRE') applyState(msg);
});

// Init
chrome.runtime.sendMessage({ action: 'GET_STATE' }, s => {
  if (!chrome.runtime.lastError && s) {
    applyState(s);
    if (s.playlist && s.playlist.length && !plOpen) {
      plOpen = true;
      plBody.classList.add('open');
      plArrow.classList.add('open');
    }
  }
});