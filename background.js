var offscreenCreated = false;

var cachedState = { isPlaying: false, isBuffering: false, volume: 1.0, genre: '', genreTime: '', track: '', playlist: [], quality: '' };

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    var ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctxs && ctxs.length > 0) { offscreenCreated = true; return; }
  } catch(e) {}
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Radio FM audio playback'
    });
    offscreenCreated = true;
  } catch(e) {
    if (e.message && e.message.includes('exists')) offscreenCreated = true;
  }
}

function relay(msg, sendResponse) {
  ensureOffscreen().then(function() {
    chrome.runtime.sendMessage(Object.assign({}, msg, { target: 'offscreen' }), function(resp) {
      void chrome.runtime.lastError;
      if (sendResponse) sendResponse(resp || cachedState);
    });
  });
}

chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
  // From offscreen → update cache and forward to popup
  if (msg.from === 'offscreen') {
    Object.assign(cachedState, {
      isPlaying:  msg.isPlaying,
      isBuffering: msg.isBuffering,
      volume:   msg.volume   !== undefined ? msg.volume   : cachedState.volume,
      genre:     msg.genre     !== undefined ? msg.genre     : cachedState.genre,
      genreTime: msg.genreTime !== undefined ? msg.genreTime : cachedState.genreTime,
      quality:  msg.quality  !== undefined ? msg.quality  : cachedState.quality,
      track:    msg.track    !== undefined ? msg.track    : cachedState.track,
      playlist: msg.playlist !== undefined ? msg.playlist : cachedState.playlist
    });
    chrome.runtime.sendMessage(msg, function() { void chrome.runtime.lastError; });
    return false;
  }

  if (!msg.action) return false;

  if (msg.action === 'GET_STATE') { sendResponse(cachedState); return false; }

  if (msg.action === 'SET_VOLUME') {
    cachedState.volume = msg.volume;
    chrome.storage.local.set({ volume: msg.volume });
    relay(msg, null);
    sendResponse({ ok: true });
    return false;
  }

  relay(msg, sendResponse);
  return true;
});

// Boot: create offscreen and restore saved volume
ensureOffscreen().then(function() {
  chrome.storage.local.get(['volume'], function(r) {
    if (r && typeof r.volume === 'number') {
      cachedState.volume = r.volume;
      chrome.runtime.sendMessage({ target: 'offscreen', action: 'SET_VOLUME', volume: r.volume },
        function() { void chrome.runtime.lastError; });
    }
  });
});

chrome.runtime.onStartup.addListener(function() { offscreenCreated = false; ensureOffscreen(); });