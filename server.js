import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurations
const PORT = process.env.PORT || 8383;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1521254361433505922/50CJR3_yifDYyD4H9UuPjIxbZHWpYo2lqk71cZjZN8eIpV5rfRFhByzItiP1wtgmJ1UT';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);
const WEBHOOK_TEST_PASSWORD = process.env.WEBHOOK_TEST_PASSWORD || 'nemo123';

let robloxUserId = process.env.ROBLOX_USER_ID || '162336333';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory application state
let userProfile = {
  id: robloxUserId,
  username: 'Unknown',
  displayName: 'Loading User...',
  avatarUrl: 'https://images.rbxcdn.com/3d559e2b17a149b5dfd4f8f4117b3a72.png'
};

let currentPresence = {
  userPresenceType: null, // null = uninitialized
  lastLocation: 'Unknown',
  placeId: null,
  rootPlaceId: null,
  gameId: null,
  universeId: null,
  lastUpdated: null
};

// Activity logs history (limit to 50)
const logs = [];
function addLog(type, message, details = '') {
  const timestamp = new Date();
  logs.unshift({
    timestamp: timestamp.toISOString(),
    type,
    message,
    details
  });
  if (logs.length > 50) {
    logs.pop();
  }
}

// Map Presence Type number to human-readable string & color
const PRESENCE_TYPES = {
  0: { label: 'Offline', color: 0x7f8c8d, hexColor: '#7f8c8d' },
  1: { label: 'Online', color: 0x2ecc71, hexColor: '#2ecc71' },
  2: { label: 'In-Game', color: 0x3498db, hexColor: '#3498db' },
  3: { label: 'In-Studio', color: 0xf1c40f, hexColor: '#f1c40f' },
  4: { label: 'Invisible', color: 0x7f8c8d, hexColor: '#7f8c8d' }
};

function getPresenceInfo(presenceType) {
  return PRESENCE_TYPES[presenceType] || { label: 'Unknown', color: 0x7f8c8d, hexColor: '#7f8c8d' };
}

// Fetch User details and headshot avatar at startup
async function fetchUserProfile() {
  try {
    console.log(`[Init] Fetching profile for Roblox ID ${robloxUserId}...`);
    const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
    if (profileRes.ok) {
      const data = await profileRes.json();
      userProfile.username = data.name;
      userProfile.displayName = data.displayName;
      console.log(`[Init] Loaded profile: ${data.displayName} (@${data.name})`);
    } else {
      console.warn(`[Init] Profile fetch failed: ${profileRes.statusText}`);
    }
  } catch (error) {
    console.error('[Init] Error fetching user profile:', error);
  }

  try {
    console.log(`[Init] Fetching avatar headshot...`);
    const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=150x150&format=Png&isCircular=false`);
    if (thumbRes.ok) {
      const data = await thumbRes.json();
      if (data.data && data.data[0]) {
        userProfile.avatarUrl = data.data[0].imageUrl;
        console.log(`[Init] Avatar headshot URL loaded`);
      }
    }
  } catch (error) {
    console.error('[Init] Error fetching avatar headshot:', error);
  }
}

// Send Embed to Discord Webhook
async function sendDiscordWebhook(oldPresence, newPresence) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === 'placeholder') {
    console.log('[Discord] Webhook URL not set, skipping message.');
    return;
  }

  const oldInfo = getPresenceInfo(oldPresence?.userPresenceType);
  const newInfo = getPresenceInfo(newPresence?.userPresenceType);

  const embed = {
    title: 'Roblox Status Change Notification',
    description: `**${userProfile.displayName}** (@${userProfile.username}) has updated their online status.`,
    url: `https://www.roblox.com/users/${robloxUserId}/profile`,
    color: newInfo.color,
    fields: [
      {
        name: 'Old Status',
        value: oldPresence?.userPresenceType === null ? 'None (Tracker Started)' : oldInfo.label,
        inline: true
      },
      {
        name: 'New Status',
        value: newInfo.label,
        inline: true
      }
    ],
    thumbnail: {
      url: userProfile.avatarUrl
    },
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Nemo Tracker - Roblox Status Monitoring'
    }
  };

  // Add location field if relevant
  if (newPresence.lastLocation && newPresence.lastLocation !== 'Unknown') {
    embed.fields.push({
      name: 'Activity / Location',
      value: newPresence.lastLocation,
      inline: false
    });
  }

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });

    if (res.ok) {
      console.log(`[Discord] Webhook sent successfully for status change: ${oldInfo.label} -> ${newInfo.label}`);
    } else {
      console.error(`[Discord] Webhook failed with status ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.error('[Discord] Error sending webhook:', err);
  }
}

// Poll Roblox API for presence status
async function pollRobloxPresence() {
  try {
    const url = 'https://presence.roblox.com/v1/presence/users';
    const body = JSON.stringify({ userIds: [parseInt(robloxUserId, 10)] });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: body
    });

    if (!response.ok) {
      console.warn(`[Tracker] Poll failed: ${response.status} ${response.statusText}`);
      addLog('error', 'Roblox API Error', `Status ${response.status}: ${response.statusText}`);
      return;
    }

    const data = await response.json();
    if (!data.userPresences || !data.userPresences[0]) {
      console.warn('[Tracker] Poll response had no user presence data');
      return;
    }

    const newPres = data.userPresences[0];
    
    // Check if status changed
    const isFirstRun = currentPresence.userPresenceType === null;
    const hasStatusChanged = currentPresence.userPresenceType !== newPres.userPresenceType;
    const hasLocationChanged = currentPresence.lastLocation !== newPres.lastLocation;

    if (isFirstRun) {
      // First run: setup state
      currentPresence = {
        userPresenceType: newPres.userPresenceType,
        lastLocation: newPres.lastLocation || 'Unknown',
        placeId: newPres.placeId,
        rootPlaceId: newPres.rootPlaceId,
        gameId: newPres.gameId,
        universeId: newPres.universeId,
        lastUpdated: new Date().toISOString()
      };
      
      const newInfo = getPresenceInfo(newPres.userPresenceType);
      console.log(`[Tracker] Initialized status: ${newInfo.label} (${currentPresence.lastLocation})`);
      addLog('init', `Tracker Initialized: Status is ${newInfo.label}`, currentPresence.lastLocation);
      
      // Optionally notify on startup
      await sendDiscordWebhook(null, currentPresence);
      
    } else if (hasStatusChanged || hasLocationChanged) {
      const oldPresence = { ...currentPresence };
      
      currentPresence = {
        userPresenceType: newPres.userPresenceType,
        lastLocation: newPres.lastLocation || 'Unknown',
        placeId: newPres.placeId,
        rootPlaceId: newPres.rootPlaceId,
        gameId: newPres.gameId,
        universeId: newPres.universeId,
        lastUpdated: new Date().toISOString()
      };

      const oldInfo = getPresenceInfo(oldPresence.userPresenceType);
      const newInfo = getPresenceInfo(newPres.userPresenceType);
      
      let changeMsg = '';
      if (hasStatusChanged) {
        changeMsg = `Status changed: ${oldInfo.label} → ${newInfo.label}`;
      } else {
        changeMsg = `Location updated: ${newPres.lastLocation}`;
      }
      
      console.log(`[Tracker] ${changeMsg}`);
      addLog('status_change', changeMsg, newPres.lastLocation || 'Website');
      
      // Send Discord Webhook on status changes
      await sendDiscordWebhook(oldPresence, currentPresence);
    } else {
      // Status is the same, just update lastUpdated
      currentPresence.lastUpdated = new Date().toISOString();
    }

  } catch (error) {
    console.error('[Tracker] Error polling Roblox presence:', error);
    addLog('error', 'Polling Error', error.message || 'Unknown network error');
  }
}

// REST Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    userProfile,
    currentPresence,
    logs,
    config: {
      pollIntervalMs: POLL_INTERVAL_MS,
      customPort: PORT,
      robloxUserId: robloxUserId,
      discordWebhookUrlSet: !!DISCORD_WEBHOOK_URL
    }
  });
});

app.post('/api/refresh', async (req, res) => {
  console.log('[API] Manual refresh requested');
  await pollRobloxPresence();
  res.json({ success: true, currentPresence });
});

app.post('/api/track-user', async (req, res) => {
  const { userId } = req.body;
  if (!userId || isNaN(parseInt(userId, 10))) {
    return res.status(400).json({ error: 'Invalid User ID. Please supply a numeric Roblox User ID.' });
  }

  const targetId = parseInt(userId, 10).toString();
  console.log(`[API] Switching tracking target to Roblox ID: ${targetId}`);
  robloxUserId = targetId;

  // Reset local state for the new user
  userProfile = {
    id: robloxUserId,
    username: 'Unknown',
    displayName: 'Loading User...',
    avatarUrl: 'https://images.rbxcdn.com/3d559e2b17a149b5dfd4f8f4117b3a72.png'
  };

  currentPresence = {
    userPresenceType: null,
    lastLocation: 'Unknown',
    placeId: null,
    rootPlaceId: null,
    gameId: null,
    universeId: null,
    lastUpdated: null
  };

  // Clear logs array
  logs.length = 0;
  addLog('init', `Tracking target updated to Roblox ID ${robloxUserId}`, 'Initializing info...');

  try {
    // Fetch details & presence for the new user
    await fetchUserProfile();
    await pollRobloxPresence();
    res.json({ success: true, userProfile, currentPresence });
  } catch (err) {
    res.status(500).json({ error: `Failed to load info for new user: ${err.message}` });
  }
});

app.post('/api/test-webhook', async (req, res) => {
  console.log('[API] Webhook test requested');
  const { password } = req.body;

  if (password !== WEBHOOK_TEST_PASSWORD) {
    console.log('[API] Webhook test denied: invalid password');
    return res.status(403).json({ error: 'Forbidden: Incorrect Webhook Test Password' });
  }

  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === 'placeholder') {
    return res.status(400).json({ error: 'Webhook URL not set' });
  }

  const testEmbed = {
    title: '🚀 Nemo Tracker - Webhook Test',
    description: 'This is a test notification confirming that the status change webhook integration is active and working correctly!',
    url: `https://www.roblox.com/users/${robloxUserId}/profile`,
    color: 0x3498db, // In-game blue
    fields: [
      {
        name: 'Target User',
        value: `${userProfile.displayName} (@${userProfile.username})`,
        inline: true
      },
      {
        name: 'Configured Port',
        value: `${PORT}`,
        inline: true
      },
      {
        name: 'Polling Interval',
        value: `${POLL_INTERVAL_MS / 1000}s`,
        inline: true
      }
    ],
    thumbnail: {
      url: userProfile.avatarUrl
    },
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Nemo Tracker - System Diagnostics'
    }
  };

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [testEmbed]
      })
    });

    if (response.ok) {
      console.log('[Discord] Test Webhook sent successfully');
      res.json({ success: true, message: 'Test message sent to Discord!' });
    } else {
      res.status(response.status).json({ error: `Webhook rejected: ${response.statusText}` });
    }
  } catch (error) {
    res.status(500).json({ error: `Network error sending webhook: ${error.message}` });
  }
});

// App Startup
async function startApp() {
  // 1. Fetch initial profile information
  await fetchUserProfile();
  
  // 2. Perform initial presence poll
  await pollRobloxPresence();
  
  // 3. Start background periodic polling
  setInterval(pollRobloxPresence, POLL_INTERVAL_MS);
  
  // 4. Start the Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`Nemo Tracker is running!`);
    console.log(`Server Port: ${PORT}`);
    console.log(`Local Access: http://localhost:${PORT}`);
    console.log(`Roblox Target ID: ${robloxUserId}`);
    console.log(`Polling Frequency: Every ${POLL_INTERVAL_MS / 1000}s`);
    console.log(`========================================`);
  });
}

startApp();
