let accessToken = '';
let isAudioPlaying = false;
let currentPlaylistId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const loginSection = document.getElementById('login-section');
    const content = document.getElementById('content');
    const statusDiv = document.getElementById('status');
    const playlistsDiv = document.getElementById('playlists');
    const shuffleLikedSongsButton = document.getElementById('shuffle-liked-songs');
    const nowPlayingDiv = document.getElementById('now-playing');
    const playlistSelector = document.getElementById('playlist-selector');
    const playButton = document.getElementById('play-button');
    const previousButton = document.getElementById('previous-button');
    const nextButton = document.getElementById('next-button');
    const autoReplayToggle = document.getElementById('auto-replay-toggle');
    const autoPauseToggle = document.getElementById('auto-pause-toggle');

    // Load stored settings
    chrome.storage.sync.get(['autoReplayEnabled', 'autoPauseEnabled'], (result) => {
        autoReplayToggle.checked = result.autoReplayEnabled !== false; // default to true
        autoPauseToggle.checked = result.autoPauseEnabled !== false;   // default to true
    });

    // Save settings when toggles change
    autoReplayToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ autoReplayEnabled: autoReplayToggle.checked });
    });

    autoPauseToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ autoPauseEnabled: autoPauseToggle.checked });
    });

    await init();

    async function init() {
        try {
            const storedData = await getStoredData(['spotifyAccessToken', 'selectedPlaylistId', 'currentPlaylistId']);
            console.log('Checking for stored access token');
            if (storedData.spotifyAccessToken) {
                accessToken = storedData.spotifyAccessToken;
                console.log('Access token found, getting profile');
                if (storedData.selectedPlaylistId) {
                    playlistSelector.value = storedData.selectedPlaylistId;
                }
                if (storedData.currentPlaylistId) {
                    currentPlaylistId = storedData.currentPlaylistId;
                }
                await getSpotifyProfile(accessToken);
                await updateNowPlaying();
            } else {
                console.log('No access token found, updating UI');
                updateUI(false);
            }
        } catch (error) {
            console.error('Error during initialization:', error);
            updateUI(false);
        }
    }

    function getStoredData(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
    }

    function updateUI(isLoggedIn, username = '') {
        console.log('Updating UI, isLoggedIn:', isLoggedIn);
        loginSection.style.display = isLoggedIn ? 'none' : 'block';
        content.style.display = isLoggedIn ? 'block' : 'none';
        statusDiv.textContent = isLoggedIn ? `Logged in as ${username}` : 'Not logged in';
    }

    async function getSpotifyProfile(token) {
        console.log('Getting Spotify profile');
        accessToken = token;
        try {
            const response = await fetch('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Profile data:', data);
            updateUI(true, data.display_name || data.id);
            await getPlaylists(token);
        } catch (error) {
            console.error('Error fetching profile:', error);
            statusDiv.textContent = `Error fetching profile: ${error.message}`;
            updateUI(false);
        }
    }

    async function getPlaylists(token) {
        console.log('Getting playlists');
        try {
            const response = await fetch('https://api.spotify.com/v1/me/playlists', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Playlists data:', data);
            playlistSelector.innerHTML = '<option value="liked">Liked Songs</option>';
            data.items.forEach(playlist => {
                const option = document.createElement('option');
                option.value = playlist.id;
                option.textContent = playlist.name;
                playlistSelector.appendChild(option);
            });

            // Retrieve and set the stored playlist ID
            const result = await getStoredData(['selectedPlaylistId']);
            if (result.selectedPlaylistId) {
                playlistSelector.value = result.selectedPlaylistId;
                console.log('Restored selected playlist ID:', result.selectedPlaylistId);
            } else {
                console.log('No stored playlist ID found');
            }
        } catch (error) {
            console.error('Error fetching playlists:', error);
            playlistSelector.innerHTML = `<option>Error fetching playlists: ${error.message}</option>`;
        }
    }

    // Add event listener to save selected playlist ID when it changes
    playlistSelector.addEventListener('change', () => {
        const selectedPlaylistId = playlistSelector.value;
        chrome.storage.local.set({ 'selectedPlaylistId': selectedPlaylistId }, () => {
            console.log('Selected playlist ID saved:', selectedPlaylistId);
        });
    });

    async function getActiveDevice() {
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
            statusDiv.textContent = `Error: ${error.message}. Make sure Spotify is open and active.`;
            return null;
        }
    }

    async function togglePlayPause() {
        const selectedPlaylistId = playlistSelector.value;
        
        if (!isAudioPlaying || currentPlaylistId !== selectedPlaylistId) {
            await playSelectedPlaylist();
        } else {
            await pausePlayback();
        }
    }

    async function playSelectedPlaylist() {
        const selectedValue = playlistSelector.value;
        const deviceId = await getActiveDevice();
        
        if (!deviceId) {
            statusDiv.textContent = "No active Spotify device found. Open Spotify and start playing, then try again.";
            return;
        }

        let endpoint, body;
        if (selectedValue === 'liked') {
            endpoint = `https://api.spotify.com/v1/me/tracks?limit=50`;
            const response = await fetch(endpoint, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            const trackUris = data.items.map(item => item.track.uri);
            body = JSON.stringify({ uris: trackUris.sort(() => 0.5 - Math.random()) });
        } else {
            endpoint = `https://api.spotify.com/v1/playlists/${selectedValue}/tracks`;
            const response = await fetch(endpoint, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            const trackUris = data.items.map(item => item.track.uri);
            body = JSON.stringify({ uris: trackUris.sort(() => 0.5 - Math.random()).slice(0, 50) });
        }

        try {
            const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: body
            });

            if (!playResponse.ok) {
                if (playResponse.status === 404) {
                    throw new Error('No active device found. Make sure Spotify is open and playing.');
                } else {
                    const errorData = await playResponse.json();
                    throw new Error(errorData.error.message || 'Unknown error occurred');
                }
            }

            isAudioPlaying = true;
            currentPlaylistId = selectedValue;
            // Save currentPlaylistId
            chrome.storage.local.set({ 'currentPlaylistId': currentPlaylistId });
            statusDiv.textContent = 'Playback started!';
            updatePlayButton();
            setTimeout(updateNowPlaying, 1000);
        } catch (error) {
            console.error('Error starting playback:', error);
            statusDiv.textContent = `Error: ${error.message}. Make sure you have Spotify Premium and an active device.`;
        }
    }

    async function pausePlayback() {
        const deviceId = await getActiveDevice();
        
        if (!deviceId) {
            statusDiv.textContent = "No active Spotify device found. Open Spotify and start playing, then try again.";
            return;
        }

        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('No active device found. Make sure Spotify is open and playing.');
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.error.message || 'Unknown error occurred');
                }
            }

            isAudioPlaying = false;
            updatePlayButton();
            setTimeout(updateNowPlaying, 1000);
        } catch (error) {
            console.error('Error pausing playback:', error);
            statusDiv.textContent = `Error: ${error.message}. Make sure you have an active Spotify device.`;
        }
    }

    async function resumePlayback() {
        const deviceId = await getActiveDevice();
        
        if (!deviceId) {
            statusDiv.textContent = "No active Spotify device found. Open Spotify and start playing, then try again.";
            return;
        }

        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('No active device found. Make sure Spotify is open and playing.');
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.error.message || 'Unknown error occurred');
                }
            }

            isAudioPlaying = true;
            statusDiv.textContent = 'Playback resumed!';
            updatePlayButton();
            setTimeout(updateNowPlaying, 1000);
        } catch (error) {
            console.error('Error resuming playback:', error);
            statusDiv.textContent = `Error: ${error.message}. Make sure you have Spotify Premium and an active device.`;
        }
    }

    async function playPreviousTrack() {
        const deviceId = await getActiveDevice();
        
        if (!deviceId) {
            statusDiv.textContent = "No active Spotify device found. Open Spotify and start playing, then try again.";
            return;
        }

        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/previous?device_id=${deviceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || 'Unknown error occurred');
            }

            setTimeout(updateNowPlaying, 1000);
        } catch (error) {
            console.error('Error playing previous track:', error);
            statusDiv.textContent = `Error: ${error.message}. Make sure you have an active Spotify device.`;
        }
    }

    async function playNextTrack() {
        const deviceId = await getActiveDevice();
        
        if (!deviceId) {
            statusDiv.textContent = "No active Spotify device found. Open Spotify and start playing, then try again.";
            return;
        }

        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/next?device_id=${deviceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || 'Unknown error occurred');
            }

            setTimeout(updateNowPlaying, 1000);
        } catch (error) {
            console.error('Error playing next track:', error);
            statusDiv.textContent = `Error: ${error.message}. Make sure you have an active Spotify device.`;
        }
    }

    function updatePlayButton() {
        playButton.textContent = isAudioPlaying ? 'Pause' : (currentPlaylistId === playlistSelector.value ? 'Resume' : 'Play Selected');
    }

    playButton.addEventListener('click', async () => {
        if (isAudioPlaying) {
            await pausePlayback();
        } else {
            if (currentPlaylistId === playlistSelector.value) {
                await resumePlayback();
            } else {
                await playSelectedPlaylist();
            }
        }
    });

    previousButton.addEventListener('click', playPreviousTrack);
    nextButton.addEventListener('click', playNextTrack);

    loginButton.addEventListener('click', () => {
        console.log('Login button clicked');
        chrome.runtime.sendMessage({action: 'login'}, async (response) => {
            console.log('Login response:', response);
            if (response && response.success) {
                chrome.storage.local.get(['spotifyAccessToken'], async (result) => {
                    if (result.spotifyAccessToken) {
                        console.log('Access token received, getting profile');
                        accessToken = result.spotifyAccessToken;
                        await getSpotifyProfile(accessToken);
                        await updateNowPlaying();
                    } else {
                        console.error('No access token received after login');
                        statusDiv.textContent = 'Login failed: No access token received';
                    }
                });
            } else {
                console.error('Login failed', response ? response.error : 'Unknown error');
                statusDiv.textContent = `Login failed: ${response ? response.error : 'Unknown error'}`;
            }
        });
    });

    logoutButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'logout'}, (response) => {
            if (response && response.success) {
                console.log('Logged out successfully');
                updateUI(false);
            } else {
                console.error('Logout failed');
                statusDiv.textContent = 'Logout failed. Please try again.';
            }
        });
    });

    async function updateNowPlaying() {
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.status === 204 || response.status === 202) {
                nowPlayingDiv.textContent = 'No track currently playing';
                isAudioPlaying = false;
                updatePlayButton();
                previousButton.disabled = true;
                nextButton.disabled = true;
                return;
            }
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data && data.item) {
                nowPlayingDiv.textContent = `Now playing: ${data.item.name} by ${data.item.artists[0].name}`;
                isAudioPlaying = data.is_playing;
                updatePlayButton();
                previousButton.disabled = data.actions.disallows.skipping_prev || false;
                nextButton.disabled = data.actions.disallows.skipping_next || false;
            } else {
                nowPlayingDiv.textContent = 'No track currently playing';
                isAudioPlaying = false;
                updatePlayButton();
                previousButton.disabled = true;
                nextButton.disabled = true;
            }
        } catch (error) {
            console.error('Error fetching now playing:', error);
            nowPlayingDiv.textContent = `Error: ${error.message}`;
            isAudioPlaying = false;
            updatePlayButton();
            previousButton.disabled = true;
            nextButton.disabled = true;
        }
    }

    // Update audio status every 5 seconds
    setInterval(updateNowPlaying, 5000);

    function openSpotifyTabIfNotOpen() {
        chrome.tabs.query({url: '*://open.spotify.com/*'}, (tabs) => {
            if (tabs.length === 0) {
                chrome.tabs.create({url: 'https://open.spotify.com'}, (tab) => {
                    console.log('Spotify tab opened');
                });
            } else {
                console.log('Spotify tab already open');
            }
        });
    }

    // Call the function to open Spotify tab if not open
    openSpotifyTabIfNotOpen();
});