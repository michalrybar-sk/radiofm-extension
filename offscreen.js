var STREAM_HQ    = 'http://live.stvr.sk:8000/FM_256.mp3';
var STREAM_LQ    = 'https://icecast.stv.livebox.sk/fm_128.mp3';
var PLAYLIST_URL = 'https://fm.stvr.sk/json/snippet/radio_playlist.json?channel=2';
var PLAYER_URL   = 'https://fm.stvr.sk/player';
var GENRE_URL    = 'https://fm.stvr.sk/json/snippet/broadcast_right.json?channel=2&target=snippet-broadcast-2-right';

var audio       = null;
var isPlaying   = false;
var isBuffering = false;
var volume      = 1.0;
var playlist    = [];
var icyTrack    = '';
var genre       = '';
var genreTime   = '';
var quality     = '';   // '256 kbps MP3' or '128 kbps MP3'
var pollTimer   = null;
var icyAbort    = null;
var retryTimer    = null;
var fallbackTimer = null;

// ── Preload logo as base64 for MediaSession artwork ──────────────────────────
var logoDataUrl = '';
(function() {
  var img = new Image();
  var canvas = document.createElement('canvas');
  img.onload = function() {
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    logoDataUrl = canvas.toDataURL('image/png');
  };
  img.src = chrome.runtime.getURL('icons/logo_full.png');
})();

// ── Pre-connect to both servers on load ───────────────────────────────────────
(function() {
  [STREAM_HQ, STREAM_LQ].forEach(function(url) {
    var ctrl = new AbortController();
    fetch(url, { cache: 'no-store', signal: ctrl.signal }).catch(function() {});
    setTimeout(function() { ctrl.abort(); }, 500);
  });
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function state() {
  var track = icyTrack || (playlist[0] ? playlist[0].artist + ' \u2013 ' + playlist[0].song : '');
  return { isPlaying, isBuffering, volume, genre, genreTime, track, playlist, quality };
}

function send(type) {
  chrome.runtime.sendMessage(Object.assign(state(), { type, from: 'offscreen' }),
    function() { void chrome.runtime.lastError; });
}

function dec(s) {
  return (s || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
}

// ── Audio ─────────────────────────────────────────────────────────────────────

function createAudio(url) {
  var a = new Audio();
  a.volume = volume;
  a.addEventListener('playing', function() {
    isPlaying = true; isBuffering = false;
    updateMediaSession(icyTrack || 'Rádio FM');
    send('STATE');
    startIcy(url);
    fetchGenre();
    startPolling();
  });
  a.addEventListener('waiting',  function() { isBuffering = true;  send('STATE'); });
  a.addEventListener('canplay',  function() { isBuffering = false; send('STATE'); });
  a.addEventListener('error',    function() {
    var was = isPlaying || isBuffering;
    isPlaying = false; isBuffering = false;
    if (was) retryTimer = setTimeout(play, 5000);
    else send('STATE');
  });
  return a;
}

function tryPlay(url, isRetry) {
  if (audio) try { audio.pause(); } catch(e) {}
  audio = createAudio(url);
  audio.preload = 'none';
  audio.src = url;

  // Timeout fallback: ak audio do 8s nevydá 'playing' event, skús LQ
  clearTimeout(fallbackTimer);
  if (!isRetry) {
    fallbackTimer = setTimeout(function() {
      if (!isPlaying && !isStopped()) tryPlay(STREAM_LQ, true);
    }, 8000);
  }

  // Zruš timer keď sa stream spustí
  audio.addEventListener('playing', function() {
    clearTimeout(fallbackTimer);
    quality = (url === STREAM_HQ) ? '256 kbps MP3' : '128 kbps MP3';
  }, { once: true });

  // Okamžitý fallback pri error evente
  audio.addEventListener('error', function() {
    clearTimeout(fallbackTimer);
    if (isStopped()) return;
    if (!isRetry) tryPlay(STREAM_LQ, true);
    else { isPlaying = false; isBuffering = false; send('STATE'); }
  }, { once: true });

  audio.play().catch(function() {
    clearTimeout(fallbackTimer);
    if (isStopped()) return;
    if (!isRetry) tryPlay(STREAM_LQ, true);
    else { isPlaying = false; isBuffering = false; send('STATE'); }
  });
}

function updateMediaSession(title) {
  if (!('mediaSession' in navigator)) return;
  var track = title || (playlist[0] ? playlist[0].artist + ' – ' + playlist[0].song : 'Rádio FM');
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track,
    artist: 'Rádio FM',
    artwork: logoDataUrl ? [{ src: logoDataUrl, sizes: '512x512', type: 'image/png' }] : []
  });
  navigator.mediaSession.playbackState = 'playing';
}

function isStopped() {
  // Returns true if user has explicitly stopped - audio has no src
  return !audio || audio.src === '' || audio.src === window.location.href;
}

function play() {
  clearTimeout(retryTimer);
  icyTrack = '';
  isPlaying = false; isBuffering = true;
  send('STATE');
  tryPlay(STREAM_HQ, false);
}

function stop() {
  clearTimeout(retryTimer);
  clearTimeout(fallbackTimer);
  stopIcy();
  clearInterval(pollTimer);
  if (audio) { try { audio.pause(); } catch(e) {} audio.src = ''; }
  isPlaying = false; isBuffering = false;
  icyTrack = ''; quality = ''; genreTime = '';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  send('STATE');
}

// ── ICY metadata ──────────────────────────────────────────────────────────────

function startIcy(streamUrl) {
  stopIcy();
  console.log('[ICY] starting for:', streamUrl);
  icyAbort = new AbortController();
  var ctrl = icyAbort;

  fetch(streamUrl, { headers: { 'Icy-MetaData': '1' }, cache: 'no-store', signal: ctrl.signal })
  .then(function(r) {
    console.log('[ICY] connected, status:', r.status);
    console.log('[ICY] icy-metaint header:', r.headers.get('icy-metaint'));
    console.log('[ICY] icy-name:', r.headers.get('icy-name'));
    var metaint = parseInt(r.headers.get('icy-metaint') || '0', 10);
    if (!metaint) { console.log('[ICY] no metaint → ICY metadata not available'); return; }
    console.log('[ICY] metaint =', metaint, 'bytes');

    var reader = r.body.getReader();
    var buf = new Uint8Array(0);

    function eat(n) {
      return new Promise(function(res, rej) {
        (function pump() {
          if (ctrl.signal.aborted) { rej(new Error('abort')); return; }
          if (buf.length >= n) { res(buf.slice(0, n)); buf = buf.slice(n); return; }
          reader.read().then(function(x) {
            if (x.done) { rej(new Error('end')); return; }
            var m = new Uint8Array(buf.length + x.value.length);
            m.set(buf); m.set(x.value, buf.length); buf = m; pump();
          }, rej);
        })();
      });
    }

    function loop() {
      if (ctrl.signal.aborted) return;
      eat(metaint)
        .then(function() { return eat(1); })
        .then(function(b) { var l = b[0] * 16; return l ? eat(l) : null; })
        .then(function(mb) {
          if (mb) {
            var m = new TextDecoder().decode(mb).match(/StreamTitle='([^']*)'/);
            if (m) {
              console.log('[ICY] raw StreamTitle:', m[1]);
              if (m[1].trim() && m[1].trim() !== icyTrack) {
                icyTrack = m[1].trim();
                console.log('[ICY] new track:', icyTrack);
                updateMediaSession(icyTrack);
                send('STATE');
                if (playlist.length) send('PLAYLIST');
              }
            } else {
              console.log('[ICY] metadata block received but no StreamTitle found');
            }
          }
          loop();
        })
        .catch(function(e) { console.log('[ICY] loop error:', e && e.message); if (!ctrl.signal.aborted && isPlaying) { console.log('[ICY] retrying in 5s...'); setTimeout(function() { startIcy(streamUrl); }, 5000); } });
    }
    loop();
  })
  .catch(function(e) {
    console.log('[ICY] fetch failed:', e && e.message);
  });
}

function stopIcy() {
  if (icyAbort) { icyAbort.abort(); icyAbort = null; }
}

// ── Playlist polling ──────────────────────────────────────────────────────────

function scheduleGenre() {
  var now = new Date();
  var ms = now.getSeconds() * 1000 + now.getMilliseconds();
  var minInCycle = now.getMinutes() % 5;
  // ms until next 5-min mark + 20s offset
  var msUntilNext = ((5 - minInCycle) * 60 * 1000) - ms + 20000;
  // If we already passed the :20s mark of current 5-min slot, wait for next
  if (minInCycle === 0 && now.getSeconds() < 20) {
    msUntilNext = (20 - now.getSeconds()) * 1000 - now.getMilliseconds();
  }
  console.log('[GENRE] dalsi fetch o', Math.round(msUntilNext/1000), 's');
  setTimeout(function() {
    fetchGenre();
    scheduleGenre(); // reschedule
  }, msUntilNext);
}

function startPolling() {
  clearInterval(pollTimer);
  // Fetch immediately only if playlist is empty, otherwise wait for next interval
  if (!playlist.length) { fetchPlaylist(); fetchGenre(); }
  else { fetchPlaylist(); }
  pollTimer = setInterval(fetchPlaylist, 30000);
  scheduleGenre();
}

function fetchPlaylist() {
  fetch(PLAYLIST_URL, { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(d) {
      var html = (d.snippets || {})['snippet-playlist'] || '';
      var items = [], re = /<li[^>]*class="[^"]*list[^"]*"[^>]*>([\s\S]*?)<\/li>/g, m;
      while ((m = re.exec(html)) !== null && items.length < 8) {
        var b = m[1];
        var t = dec((b.match(/<span[^>]*class="[^"]*programmeTime[^"]*"[^>]*>([^<]+)</) || [])[1]);
        var a = dec((b.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</) || [])[1]);
        var s = dec((b.match(/<span[^>]*class="[^"]*song[^"]*"[^>]*>([^<]+)</) || [])[1]);
        if (a || s) items.push({ time: t, artist: a, song: s });
      }
      if (items.length) {
        console.log('[PLAYLIST] načítaný z:', PLAYLIST_URL, '– skladieb:', items.length);
        playlist = items;
        if (!icyTrack && isPlaying) updateMediaSession('');
        send('PLAYLIST');
      }
    })
    .catch(function() { console.log('[PLAYLIST] fetch zlyhal:', PLAYLIST_URL); });
}

function fetchGenre() {
  fetch(GENRE_URL, { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(d) {
      var html = (d.snippets || {})['snippet-broadcast-2-right'] || '';
      var mt = html.match(/<strong class="time--start">([^<]+)<\/strong>/);
      var mg = html.match(/<span>([^<]+)<\/span>\s*<\/span>/);
      if (mg) {
        var g = dec(mg[1]);
        var t = mt ? dec(mt[1]) : '';
        console.log('[GENRE] načítaný z JSON:', g, t);
        if (g !== genre || t !== genreTime) { genre = g; genreTime = t; send('GENRE'); }
      }
    })
    .catch(function() {
      console.log('[GENRE] JSON zlyhal, skúšam /player fallback');
      fetch(PLAYER_URL, { cache: 'no-store' })
        .then(function(r) { return r.ok ? r.text() : Promise.reject(); })
        .then(function(html) {
          var m = html.match(/class="[^"]*genre[^"]*animate[^"]*"[^>]*>[^<]*<span>([^<]+)<\/span>/);
          if (m) { var g = dec(m[1]); console.log('[GENRE] fallback z /player:', g); if (g !== genre) { genre = g; send('GENRE'); } }
        }).catch(function() { console.log('[GENRE] oba zdroje zlyhali'); });
    });
}

// ── Message handler ───────────────────────────────────────────────────────────

// Načítaj playlist pri štarte (oneskorene, aby sa predišlo konfliktu s playing eventom)
setTimeout(fetchPlaylist, 1000);

chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
  if (msg.target !== 'offscreen') return false;
  if (msg.action === 'PLAY')        play();
  else if (msg.action === 'STOP')   stop();
  else if (msg.action === 'TOGGLE') (isPlaying || isBuffering) ? stop() : play();
  else if (msg.action === 'SET_VOLUME') { volume = Math.max(0, Math.min(1, msg.volume)); if (audio) audio.volume = volume; }
  else if (msg.action === 'SET_MUTE')   { if (audio) audio.muted = msg.muted; }
  sendResponse(state());
  return true;
});