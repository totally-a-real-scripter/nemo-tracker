import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import tls from 'tls';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Secure HTTPS request helper enforcing SSL pinning / CA issuer checks
function secureFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const method = options.method || 'GET';
      const headers = { ...options.headers };
      const body = options.body || null;

      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const reqOptions = {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        rejectUnauthorized: true,
        checkServerIdentity: (hostname, cert) => {
          const hostCheck = tls.checkServerIdentity(hostname, cert);
          if (hostCheck) return hostCheck;

          const issuer = cert.issuer ? JSON.stringify(cert.issuer) : '';
          const allowedIssuers = ['Google Trust Services', 'Cloudflare', 'DigiCert', 'Let\'s Encrypt', 'Sectigo', 'GTS'];
          const isAllowed = allowedIssuers.some(allowed => issuer.includes(allowed));
          
          if (!isAllowed) {
            return new Error(`TLS handshake aborted: Unallowed or hijacked CA issuer: "${issuer}"`);
          }
          return undefined;
        }
      };

      const req = https.request(reqOptions, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            text: () => Promise.resolve(responseBody),
            json: () => {
              try {
                return Promise.resolve(JSON.parse(responseBody));
              } catch (e) {
                return Promise.reject(e);
              }
            }
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (body) {
        req.write(body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Configurations
const PORT = process.env.PORT || 8383;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1521254361433505922/50CJR3_yifDYyD4H9UuPjIxbZHWpYo2lqk71cZjZN8eIpV5rfRFhByzItiP1wtgmJ1UT';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);
const WEBHOOK_TEST_PASSWORD = process.env.WEBHOOK_TEST_PASSWORD || 'nemo123';

const defaultRobloxUserId = process.env.ROBLOX_USER_ID || '162336333';
const TRACKED_USERS_FILE = path.join(__dirname, 'tracked_users.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// In-memory application state: map of userId -> { profile, presence }
let trackedUsers = {};
let isRateLimited = false;
let rateLimitResetTime = null;

async function loadTrackedUsers() {
  try {
    if (existsSync(TRACKED_USERS_FILE)) {
      const fileContent = await fs.readFile(TRACKED_USERS_FILE, 'utf-8');
      const parsed = JSON.parse(fileContent);
      
      // Migrate legacy string array structure to new map object structure
      if (Array.isArray(parsed)) {
        console.log('[Config] Migrating legacy array format in tracked_users.json...');
        const migrated = {};
        for (const id of parsed) {
          migrated[id] = {
            profile: {
              id: id.toString(),
              username: 'Unknown',
              displayName: 'Loading...',
              avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
            },
            presence: {
              userPresenceType: null,
              lastLocation: 'Unknown',
              placeId: null,
              rootPlaceId: null,
              gameId: null,
              universeId: null,
              lastUpdated: null
            }
          };
        }
        await saveTrackedUsers(migrated);
        return migrated;
      }
      
      return parsed;
    }
  } catch (e) {
    console.error('[Config] Failed to read tracked_users.json:', e);
  }
  const defaultUsers = {
    [defaultRobloxUserId]: {
      profile: {
        id: defaultRobloxUserId,
        username: 'Unknown',
        displayName: 'Loading...',
        avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      },
      presence: {
        userPresenceType: null,
        lastLocation: 'Unknown',
        placeId: null,
        rootPlaceId: null,
        gameId: null,
        universeId: null,
        lastUpdated: null
      }
    }
  };
  await saveTrackedUsers(defaultUsers);
  return defaultUsers;
}

async function saveTrackedUsers(users) {
  try {
    await fs.writeFile(TRACKED_USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Config] Failed to write tracked_users.json:', e);
  }
}

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

// Fetch User details and headshot avatar for a specific user ID
async function fetchUserProfile(userId) {
  if (!trackedUsers[userId]) return;
  const user = trackedUsers[userId];

  // Skip fetching if profile is already cached/loaded
  if (user.profile.username !== 'Unknown' && user.profile.avatarUrl && !user.profile.avatarUrl.includes('data:image')) {
    console.log(`[Init] Using cached profile for Roblox ID ${userId}: ${user.profile.displayName}`);
    return;
  }

  try {
    console.log(`[Init] Fetching profile for Roblox ID ${userId}...`);
    const profileRes = await secureFetch(`https://users.roblox.com/v1/users/${userId}`);
    if (profileRes.ok) {
      const text = await profileRes.text();
      if (hasSpam(text)) {
        console.error(`[Init] Blocked profile data containing spam links for ID ${userId}.`);
        return;
      }
      const data = JSON.parse(text);
      user.profile.username = data.name;
      user.profile.displayName = data.displayName;
      console.log(`[Init] Loaded profile for ID ${userId}: ${data.displayName} (@${data.name})`);
    } else {
      console.warn(`[Init] Profile fetch failed for ID ${userId}: ${profileRes.statusText}`);
    }
  } catch (error) {
    console.error(`[Init] Error fetching user profile for ID ${userId}:`, error);
  }

  try {
    console.log(`[Init] Fetching avatar headshot for ID ${userId}...`);
    const thumbRes = await secureFetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
    if (thumbRes.ok) {
      const text = await thumbRes.text();
      if (hasSpam(text)) {
        console.error(`[Init] Blocked thumbnail data containing spam links for ID ${userId}.`);
        return;
      }
      const data = JSON.parse(text);
      if (data.data && data.data[0]) {
        user.profile.avatarUrl = data.data[0].imageUrl;
        console.log(`[Init] Avatar headshot URL loaded for ID ${userId}`);
      }
    }
  } catch (error) {
    console.error(`[Init] Error fetching avatar headshot for ID ${userId}:`, error);
  }

  // Save updated cache to disk
  await saveTrackedUsers(trackedUsers);
}

// Check if a string contains any spam signatures or links (case-insensitive)
function hasSpam(text) {
  if (!text) return false;
  const str = text.toString().toLowerCase();
  return str.includes('t.me') || 
         str.includes('a_toolsx') || 
         str.includes('a-tools') || 
         str.includes('a_tools') || 
         str.includes('telegram');
}

// Filter out any Telegram channel ads or forbidden links to prevent forwarding spam
function sanitizeText(text) {
  if (!text) return '';
  if (hasSpam(text)) {
    return '[Spam Link Filtered]';
  }
  return text;
}

// Send Embed to Discord Webhook
async function sendDiscordWebhook(oldPresence, newPresence, profile) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === 'placeholder') {
    console.log('[Discord] Webhook URL not set, skipping message.');
    return;
  }

  const oldInfo = getPresenceInfo(oldPresence?.userPresenceType);
  const newInfo = getPresenceInfo(newPresence?.userPresenceType);

  const embed = {
    title: 'Roblox Status Change Notification',
    description: sanitizeText(`**${profile.displayName}** (@${profile.username}) has updated their online status.\n\n🌐 **[View Live Tracker](https://nemotracker.breymac.space)**`),
    url: `https://www.roblox.com/users/${profile.id}/profile`,
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
      url: profile.avatarUrl
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
      value: sanitizeText(newPresence.lastLocation),
      inline: false
    });
  }

  const payload = JSON.stringify({ embeds: [embed] });
  if (hasSpam(payload)) {
    console.error('[Discord] Outgoing webhook blocked: Payload contained forbidden spam links.');
    return;
  }

  try {
    const res = await secureFetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: payload
    });

    if (res.ok) {
      console.log(`[Discord] Webhook sent successfully for status change of ${profile.displayName}: ${oldInfo.label} -> ${newInfo.label}`);
    } else {
      console.error(`[Discord] Webhook failed with status ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.error('[Discord] Error sending webhook:', err);
  }
}

// Poll Roblox API for presence status of all tracked users
async function pollRobloxPresence() {
  if (isRateLimited && Date.now() < rateLimitResetTime) {
    console.log('[Tracker] Skipping poll: Temporarily backed off due to Roblox API rate limits.');
    return;
  }

  const userIds = Object.keys(trackedUsers);
  if (userIds.length === 0) return;

  try {
    const url = 'https://presence.roblox.com/v1/presence/users';
    const body = JSON.stringify({ userIds: userIds.map(id => parseInt(id, 10)) });

    const response = await secureFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: body
    });

    if (response.status === 429) {
      console.warn('[Tracker] Roblox API Rate Limit encountered (429)! Backing off for 60 seconds.');
      isRateLimited = true;
      rateLimitResetTime = Date.now() + 60000;
      addLog('error', 'Roblox Rate Limited (429)', 'API requests throttled. Backing off for 60 seconds.');
      return;
    }

    if (!response.ok) {
      console.warn(`[Tracker] Poll failed: ${response.status} ${response.statusText}`);
      addLog('error', 'Roblox API Error', `Status ${response.status}: ${response.statusText}`);
      return;
    }

    // Success, clear rate limit
    isRateLimited = false;

    const text = await response.text();
    if (hasSpam(text)) {
      console.error('[Tracker] Blocked presence response containing spam links.');
      addLog('error', 'Blocked Spam Response', 'Roblox API response contained Telegram ad links');
      return;
    }

    const data = JSON.parse(text);
    if (!data.userPresences || data.userPresences.length === 0) {
      console.warn('[Tracker] Poll response had no user presence data');
      return;
    }

    for (const newPres of data.userPresences) {
      const userId = newPres.userId.toString();
      const user = trackedUsers[userId];
      if (!user) continue;

      const currentPresence = user.presence;
      
      const isFirstRun = currentPresence.userPresenceType === null;
      const hasStatusChanged = currentPresence.userPresenceType !== newPres.userPresenceType;

      if (isFirstRun) {
        // First run setup
        user.presence = {
          userPresenceType: newPres.userPresenceType,
          lastLocation: newPres.lastLocation || 'Unknown',
          placeId: newPres.placeId,
          rootPlaceId: newPres.rootPlaceId,
          gameId: newPres.gameId,
          universeId: newPres.universeId,
          lastUpdated: new Date().toISOString()
        };
        
        const newInfo = getPresenceInfo(newPres.userPresenceType);
        console.log(`[Tracker] Initialized status for ${user.profile.displayName}: ${newInfo.label} (${user.presence.lastLocation})`);
        addLog('init', `Tracker Initialized for ${user.profile.displayName}: Status is ${newInfo.label}`, user.presence.lastLocation);
        
        // Notify on startup
        await sendDiscordWebhook(null, user.presence, user.profile);
        
      } else if (hasStatusChanged) {
        const oldPresence = { ...currentPresence };
        
        user.presence = {
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
        
        const changeMsg = `${user.profile.displayName} Status changed: ${oldInfo.label} → ${newInfo.label}`;
        console.log(`[Tracker] ${changeMsg}`);
        addLog('status_change', changeMsg, newPres.lastLocation || 'Website');
        
        // Send Discord Webhook on status changes
        await sendDiscordWebhook(oldPresence, user.presence, user.profile);
      } else {
        // Status remains the same, update details silently
        user.presence.lastLocation = newPres.lastLocation || 'Unknown';
        user.presence.placeId = newPres.placeId;
        user.presence.rootPlaceId = newPres.rootPlaceId;
        user.presence.gameId = newPres.gameId;
        user.presence.universeId = newPres.universeId;
        user.presence.lastUpdated = new Date().toISOString();
      }
    }

  } catch (error) {
    console.error('[Tracker] Error polling Roblox presence:', error);
    addLog('error', 'Polling Error', error.message || 'Unknown network error');
  }
}

// REST Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    users: Object.values(trackedUsers).map(u => ({
      profile: u.profile,
      presence: u.presence
    })),
    logs,
    config: {
      pollIntervalMs: POLL_INTERVAL_MS,
      customPort: PORT,
      discordWebhookUrlSet: !!DISCORD_WEBHOOK_URL
    }
  });
});

app.post('/api/refresh', async (req, res) => {
  console.log('[API] Manual refresh requested');
  await pollRobloxPresence();
  res.json({ success: true, users: Object.values(trackedUsers) });
});

app.post('/api/track-user', async (req, res) => {
  const { userId, password } = req.body;
  
  if (password !== WEBHOOK_TEST_PASSWORD) {
    console.log('[API] Track user denied: invalid password');
    return res.status(403).json({ error: 'Forbidden: Incorrect password' });
  }

  if (!userId || isNaN(parseInt(userId, 10))) {
    return res.status(400).json({ error: 'Invalid User ID. Please supply a numeric Roblox User ID.' });
  }

  const targetId = parseInt(userId, 10).toString();
  if (trackedUsers[targetId]) {
    return res.status(400).json({ error: 'User is already being tracked.' });
  }

  console.log(`[API] Adding tracking target Roblox ID: ${targetId}`);
  
  // Create placeholder in memory
  trackedUsers[targetId] = {
    profile: {
      id: targetId,
      username: 'Unknown',
      displayName: 'Loading...',
      avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    },
    presence: {
      userPresenceType: null,
      lastLocation: 'Unknown',
      placeId: null,
      rootPlaceId: null,
      gameId: null,
      universeId: null,
      lastUpdated: null
    }
  };

  try {
    // Fetch profile & presence
    await fetchUserProfile(targetId);
    
    // Check if profile was loaded successfully (i.e. user actually exists in Roblox)
    if (trackedUsers[targetId].profile.username === 'Unknown') {
      delete trackedUsers[targetId];
      return res.status(404).json({ error: 'Roblox user not found. Please verify the ID.' });
    }

    await pollRobloxPresence();

    // Persist updated users state to file
    await saveTrackedUsers(trackedUsers);

    res.json({ success: true, user: trackedUsers[targetId] });
  } catch (err) {
    delete trackedUsers[targetId];
    res.status(500).json({ error: `Failed to load info for new user: ${err.message}` });
  }
});

app.post('/api/untrack-user', async (req, res) => {
  const { userId, password } = req.body;
  
  if (password !== WEBHOOK_TEST_PASSWORD) {
    console.log('[API] Untrack user denied: invalid password');
    return res.status(403).json({ error: 'Forbidden: Incorrect password' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'Please supply a Roblox User ID to untrack.' });
  }

  const targetId = userId.toString();
  if (!trackedUsers[targetId]) {
    return res.status(404).json({ error: 'User is not currently being tracked.' });
  }

  console.log(`[API] Removing tracking target Roblox ID: ${targetId}`);
  
  const displayName = trackedUsers[targetId].profile.displayName;
  delete trackedUsers[targetId];

  // Persist updated users state to file
  await saveTrackedUsers(trackedUsers);

  addLog('config_change', `Stopped tracking ${displayName} (ID: ${targetId})`, 'Removed from tracker list');

  res.json({ success: true, message: `Stopped tracking ${displayName}` });
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

  // Use first user in trackedUsers or a placeholder
  const firstUserKey = Object.keys(trackedUsers)[0];
  const exampleUser = firstUserKey ? trackedUsers[firstUserKey].profile : {
    id: '162336333',
    displayName: 'System Test',
    username: 'SystemTest',
    avatarUrl: 'https://images.rbxcdn.com/3d559e2b17a149b5dfd4f8f4117b3a72.png'
  };

  const testEmbed = {
    title: '🚀 Nemo Tracker - Webhook Test',
    description: 'This is a test notification confirming that the status change webhook integration is active and working correctly!\n\n🌐 **[View Live Tracker](https://nemotracker.breymac.space)**',
    url: `https://www.roblox.com/users/${exampleUser.id}/profile`,
    color: 0x3498db, // In-game blue
    fields: [
      {
        name: 'Example Tracked User',
        value: `${exampleUser.displayName} (@${exampleUser.username})`,
        inline: true
      },
      {
        name: 'Polling Interval',
        value: `${POLL_INTERVAL_MS / 1000}s`,
        inline: true
      }
    ],
    thumbnail: {
      url: exampleUser.avatarUrl
    },
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Nemo Tracker - System Diagnostics'
    }
  };

  const payload = JSON.stringify({ embeds: [testEmbed] });
  if (hasSpam(payload)) {
    return res.status(400).json({ error: 'Blocked: Payload contains forbidden spam links.' });
  }

  try {
    const response = await secureFetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: payload
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
  // Load tracked users (with cached profiles)
  trackedUsers = await loadTrackedUsers();
  
  const ids = Object.keys(trackedUsers);

  // Fetch initial profile information for any user that is missing details
  await Promise.all(ids.map(id => fetchUserProfile(id)));
  
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
    console.log(`Tracked Accounts count: ${Object.keys(trackedUsers).length}`);
    console.log(`Polling Frequency: Every ${POLL_INTERVAL_MS / 1000}s`);
    console.log(`========================================`);
  });
}

startApp();
