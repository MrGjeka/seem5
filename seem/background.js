const CLIENT_ID = 'c08dd0211d9247a3b9f70cc54033f6ac';
const CLIENT_SECRET = '3847e81123c241fc8479c4d4ecf8f485';
const REDIRECT_URI = 'https://hfiaballdkncfjfbnahiclnfockjnbpc.chromiumapp.org/';
const SCOPE = 'user-read-private user-read-email playlist-read-private user-library-read user-modify-playback-state user-read-playback-state';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

function encodeFormData(data) {
  return Object.keys(data)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
    .join('&');
}

async function refreshAccessToken(refreshToken) {
  const params = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeFormData(params)
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token');
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in
  };
}

let isAudioPlaying = false;

function isSpotifyUrl(url) {
  return url.includes('open.spotify.com') || url.includes('spotify.com');
}

function checkAudioStatus() {
  chrome.storage.sync.get(['autoReplayEnabled', 'autoPauseEnabled'], (settings) => {
    chrome.tabs.query({}, (tabs) => {
      const wasPlaying = isAudioPlaying;

      // Filter out Spotify tabs
      const nonSpotifyAudibleTabs = tabs.filter(tab => tab.audible && !isSpotifyUrl(tab.url));
      isAudioPlaying = nonSpotifyAudibleTabs.length > 0;

      if (!wasPlaying && isAudioPlaying) {
        // Non-Spotify audio started
        console.log('Non-Spotify audio started');
        if (settings.autoPauseEnabled !== false) {
          console.log('Auto Pause is enabled, pausing music');
          pausePlayback();
        } else {
          console.log('Auto Pause is disabled, not pausing music');
        }
      } else if (wasPlaying && !isAudioPlaying) {
        // Non-Spotify audio stopped
        console.log('Non-Spotify audio stopped');
        if (settings.autoReplayEnabled !== false) {
          console.log('Auto Replay is enabled, starting music');
          startPlayback();
        } else {
          console.log('Auto Replay is disabled, not starting music');
        }
      }
    });
  });
}

chrome.alarms.create('checkAudio', { periodInMinutes: 1 / 60 }); // Check every second

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAudio') {
    checkAudioStatus();
  }
});

async function startPlayback() {
  try {
    const { spotifyAccessToken, spotifyRefreshToken, spotifyTokenExpiration, selectedPlaylistId } = await getStoredData([
      'spotifyAccessToken',
      'spotifyRefreshToken',
      'spotifyTokenExpiration',
      'selectedPlaylistId'
    ]);

    let accessToken = spotifyAccessToken;

    if (!accessToken || !spotifyRefreshToken) {
      console.error('No access token available');
      return;
    }

    // Refresh token if expired
    if (Date.now() > spotifyTokenExpiration) {
      const { accessToken: newAccessToken, expiresIn } = await refreshAccessToken(spotifyRefreshToken);
      accessToken = newAccessToken;
      const newExpirationTime = Date.now() + expiresIn * 1000;

      // Save new token and expiration
      await setStoredData({
        spotifyAccessToken: accessToken,
        spotifyTokenExpiration: newExpirationTime
      });
    }

    const deviceId = await getActiveDevice(accessToken);
    if (!deviceId) {
      console.error('No active Spotify device found');
      return;
    }

    const playlistId = selectedPlaylistId || 'liked';
    let trackUris;

    if (playlistId === 'liked') {
      trackUris = await getLikedSongs(accessToken);
    } else {
      trackUris = await getPlaylistTracks(accessToken, playlistId);
    }

    if (!trackUris || trackUris.length === 0) {
      console.error('No tracks found in the selected playlist');
      return;
    }

    // Start playback
    await playTracksOnDevice(accessToken, deviceId, trackUris);

    console.log('Playback started!');
  } catch (error) {
    console.error('Error starting playback:', error);
  }
}

async function pausePlayback() {
  try {
    const { spotifyAccessToken, spotifyRefreshToken, spotifyTokenExpiration } = await getStoredData([
      'spotifyAccessToken',
      'spotifyRefreshToken',
      'spotifyTokenExpiration'
    ]);

    let accessToken = spotifyAccessToken;

    if (!accessToken || !spotifyRefreshToken) {
      console.error('No access token available to pause playback');
      return;
    }

    // Refresh token if expired
    if (Date.now() > spotifyTokenExpiration) {
      const { accessToken: newAccessToken, expiresIn } = await refreshAccessToken(spotifyRefreshToken);
      accessToken = newAccessToken;
      const newExpirationTime = Date.now() + expiresIn * 1000;

      // Save new token and expiration
      await setStoredData({
        spotifyAccessToken: accessToken,
        spotifyTokenExpiration: newExpirationTime
      });
    }

    const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error pausing playback:', errorData.error.message || 'Unknown error occurred');
      return;
    }

    console.log('Playback paused!');
  } catch (error) {
    console.error('Error pausing playback:', error);
  }
}

// Helper functions
function getStoredData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

function setStoredData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => {
      resolve();
    });
  });
}

async function getActiveDevice(accessToken) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    const activeDevice = data.devices.find(device => device.is_active);
    return activeDevice ? activeDevice.id : null;
  } catch (error) {
    console.error('Error getting active device:', error);
    return null;
  }
}

async function getLikedSongs(accessToken) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.items.map(item => item.track.uri);
  } catch (error) {
    console.error('Error fetching liked songs:', error);
    return [];
  }
}

async function getPlaylistTracks(accessToken, playlistId) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.items.map(item => item.track.uri);
  } catch (error) {
    console.error('Error fetching playlist tracks:', error);
    return [];
  }
}

async function playTracksOnDevice(accessToken, deviceId, trackUris) {
  const body = JSON.stringify({
    uris: trackUris.sort(() => 0.5 - Math.random()).slice(0, 50)
  });

  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: body
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message || 'Unknown error occurred');
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, async (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Auth error:', chrome.runtime.lastError);
        sendResponse({success: false, error: chrome.runtime.lastError.message});
        return;
      }
      
      // ... token exchange code ...

      const code = new URL(redirectUrl).searchParams.get('code');
      
      if (!code) {
        console.error('No code in redirect URL');
        sendResponse({success: false, error: 'Authentication failed - no code received'});
        return;
      }

      try {
        const tokenResponse = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET)
          },
          body: encodeFormData({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
          })
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange code for token');
        }

        const tokenData = await tokenResponse.json();
        const expirationTime = Date.now() + tokenData.expires_in * 1000;

        chrome.storage.local.set({
          spotifyAccessToken: tokenData.access_token,
          spotifyRefreshToken: tokenData.refresh_token,
          spotifyTokenExpiration: expirationTime
        }, () => {
          console.log('Access token stored');
          sendResponse({success: true});
        });
      } catch (error) {
        console.error('Error during token exchange:', error);
        sendResponse({success: false, error: error.message});
      }
    });
    
    return true; // Indicates we will respond asynchronously
  } else if (request.action === 'logout') {
    chrome.storage.local.remove(['spotifyAccessToken', 'spotifyRefreshToken', 'spotifyTokenExpiration'], () => {
      sendResponse({success: true});
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSpotifyToken') {
    chrome.storage.local.get(['spotifyAccessToken', 'spotifyRefreshToken', 'spotifyTokenExpiration'], async (result) => {
      if (!result.spotifyAccessToken || !result.spotifyRefreshToken) {
        sendResponse({success: false, error: 'No token available'});
        return;
      }

      if (Date.now() > result.spotifyTokenExpiration) {
        try {
          const { accessToken, expiresIn } = await refreshAccessToken(result.spotifyRefreshToken);
          const newExpirationTime = Date.now() + expiresIn * 1000;

          chrome.storage.local.set({
            spotifyAccessToken: accessToken,
            spotifyTokenExpiration: newExpirationTime
          }, () => {
            sendResponse({success: true, token: accessToken});
          });
        } catch (error) {
          sendResponse({success: false, error: 'Failed to refresh token'});
        }
      } else {
        sendResponse({success: true, token: result.spotifyAccessToken});
      }
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAudioStatus') {
    sendResponse({isPlaying: isAudioPlaying});
  }
  // ... existing message handlers ...
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'playSelected') {
    chrome.tabs.query({url: '*://open.spotify.com/*'}, (tabs) => {
      if (tabs.length === 0) {
        chrome.tabs.create({url: 'https://open.spotify.com'}, (tab) => {
          sendResponse({success: true, message: 'Spotify tab opened'});
        });
      } else {
        // Logic to play the selected song
        sendResponse({success: true, message: 'Spotify tab found'});
      }
    });
    return true; // Indicates we will respond asynchronously
  }
  // ... existing message handlers ...
});