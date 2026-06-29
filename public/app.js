// Application State
let config = {
  pollIntervalMs: 15000,
  robloxUserId: '162336333'
};
let countdownTimer = null;
let countdownRemaining = 15; // in seconds
let lastUpdatedTime = null;

// DOM Elements
const userAvatar = document.getElementById('user-avatar');
const avatarPulseRing = document.getElementById('avatar-pulse-ring');
const avatarStatusDot = document.getElementById('avatar-status-dot');
const displayName = document.getElementById('display-name');
const username = document.getElementById('username');
const robloxUserId = document.getElementById('roblox-user-id');
const statusBadge = document.getElementById('status-badge');
const statusLocation = document.getElementById('status-location');
const statusLastUpdated = document.getElementById('status-last-updated');
const robloxProfileLink = document.getElementById('roblox-profile-link');
const statusCard = document.querySelector('.status-card');

const countdownText = document.getElementById('countdown-text');
const countdownFill = document.getElementById('countdown-fill');
const btnRefresh = document.getElementById('btn-refresh');
const refreshIcon = document.getElementById('refresh-icon');

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const webhookModal = document.getElementById('webhook-modal');
const userModal = document.getElementById('user-modal');

const btnOpenWebhookModal = document.getElementById('btn-open-webhook-modal');
const btnOpenUserModal = document.getElementById('btn-open-user-modal');

const btnCloseWebhookModal = document.getElementById('btn-close-webhook-modal');
const btnCloseUserModal = document.getElementById('btn-close-user-modal');

const btnCancelWebhook = document.getElementById('btn-cancel-webhook');
const btnCancelUser = document.getElementById('btn-cancel-user');

const btnSubmitWebhook = document.getElementById('btn-submit-webhook');
const btnSubmitUser = document.getElementById('btn-submit-user');

const webhookPassword = document.getElementById('webhook-password');
const inputUserId = document.getElementById('input-userid');
const userPassword = document.getElementById('user-password');

const webhookUrlDesc = document.getElementById('webhook-url-desc');
const webhookBadgeStatus = document.getElementById('webhook-badge-status');

const logList = document.getElementById('log-list');
const logEmptyState = document.getElementById('log-empty-state');
const btnClearLogs = document.getElementById('btn-clear-logs');

const toast = document.getElementById('notification-toast');
const toastIcon = document.getElementById('toast-icon');
const toastMessage = document.getElementById('toast-message');

const footerPort = document.getElementById('footer-port');
const footerInterval = document.getElementById('footer-interval');

// Status mappings
const PRESENCE_LABELS = {
  0: 'OFFLINE',
  1: 'ONLINE',
  2: 'IN GAME',
  3: 'IN STUDIO',
  4: 'INVISIBLE'
};

const PRESENCE_CLASSES = {
  0: 'status-offline',
  1: 'status-online',
  2: 'status-ingame',
  3: 'status-instudio',
  4: 'status-offline'
};

// Relative time formatter
function getRelativeTimeString(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Show Alert Notification
function showNotification(message, type = 'info') {
  toastMessage.textContent = message;
  
  // Set icon based on notification type
  toastIcon.className = 'fa-solid toast-icon';
  if (type === 'success') {
    toastIcon.classList.add('fa-circle-check');
    toastIcon.style.color = 'var(--color-online)';
  } else if (type === 'error') {
    toastIcon.classList.add('fa-circle-exclamation');
    toastIcon.style.color = '#ef4444';
  } else {
    toastIcon.classList.add('fa-circle-info');
    toastIcon.style.color = 'var(--color-primary)';
  }
  
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// Render the activity logs
function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logList.innerHTML = '';
    logList.appendChild(logEmptyState);
    return;
  }

  // Remove empty state
  if (logList.contains(logEmptyState)) {
    logList.innerHTML = '';
  }

  // Clear current log list UI
  const childrenToRemove = Array.from(logList.children).filter(child => child !== logEmptyState);
  childrenToRemove.forEach(child => child.remove());

  logs.forEach(log => {
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    
    // Choose icon
    let iconClass = 'fa-arrow-right-arrow-left';
    if (log.type === 'error') iconClass = 'fa-circle-exclamation';
    if (log.type === 'init') iconClass = 'fa-compass';

    const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    logItem.innerHTML = `
      <div class="log-icon-wrapper log-${log.type}">
        <i class="fa-solid ${iconClass}"></i>
      </div>
      <div class="log-body">
        <span class="log-message">${log.message}</span>
        <span class="log-details">${log.details || 'No details'}</span>
      </div>
      <span class="log-time">${time}</span>
    `;

    logList.appendChild(logItem);
  });
}

// Fetch current status and update UI
async function fetchStatus(isManual = false) {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('Network status fetch failed');
    
    const data = await response.json();
    
    // Config Updates
    config = data.config;
    footerPort.textContent = config.customPort;
    footerInterval.textContent = `${config.pollIntervalMs / 1000}s`;
    
    // Webhook UI
    if (config.discordWebhookUrlSet) {
      webhookBadgeStatus.className = 'webhook-badge active';
      webhookBadgeStatus.textContent = 'Active';
      webhookUrlDesc.textContent = 'Configured and listening for changes';
    } else {
      webhookBadgeStatus.className = 'webhook-badge';
      webhookBadgeStatus.textContent = 'Disabled';
      webhookUrlDesc.textContent = 'No Webhook URL configured';
    }

    // User Profile Card Updates
    const profile = data.userProfile;
    userAvatar.src = profile.avatarUrl;
    displayName.textContent = profile.displayName;
    username.textContent = `@${profile.username}`;
    robloxUserId.textContent = profile.id;
    robloxProfileLink.href = `https://www.roblox.com/users/${profile.id}/profile`;

    // Presence Updates
    const presence = data.currentPresence;
    lastUpdatedTime = presence.lastUpdated;
    
    // Manage status CSS classes on the card
    statusCard.className = 'card status-card';
    const presenceClass = PRESENCE_CLASSES[presence.userPresenceType] || 'status-offline';
    statusCard.classList.add(presenceClass);

    // Status badge text
    statusBadge.textContent = PRESENCE_LABELS[presence.userPresenceType] || 'OFFLINE';
    
    // Activity location
    statusLocation.textContent = presence.lastLocation || 'Website';
    
    // Update relative duration
    updateRelativeTime();

    // Logs
    renderLogs(data.logs);

    if (isManual) {
      showNotification('Successfully synced with Roblox Presence API!', 'success');
    }
  } catch (error) {
    console.error('Error fetching tracker status:', error);
    showNotification('Failed to fetch status from tracker backend.', 'error');
  }
}

// Timer management
function updateRelativeTime() {
  if (lastUpdatedTime) {
    statusLastUpdated.textContent = getRelativeTimeString(lastUpdatedTime);
  }
}

// Handles the countdown ticking
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  
  countdownRemaining = config.pollIntervalMs / 1000;
  
  countdownTimer = setInterval(() => {
    countdownRemaining--;
    
    // Update visual progress bar and text
    const percentage = (countdownRemaining / (config.pollIntervalMs / 1000)) * 100;
    countdownFill.style.width = `${Math.max(0, percentage)}%`;
    countdownText.textContent = `${Math.max(0, countdownRemaining)}s`;
    
    // Keep relative time updated
    updateRelativeTime();
    
    if (countdownRemaining <= 0) {
      // Countdown finished: fetch status and reset
      fetchStatus();
      countdownRemaining = config.pollIntervalMs / 1000;
    }
  }, 1000);
}

// Modal Toggle Handlers
function showWebhookModal() {
  modalOverlay.style.display = 'flex';
  // Force reflow
  modalOverlay.offsetHeight;
  modalOverlay.classList.add('active');
  webhookModal.classList.add('active');
  webhookPassword.focus();
}

function showUserModal() {
  modalOverlay.style.display = 'flex';
  // Force reflow
  modalOverlay.offsetHeight;
  modalOverlay.classList.add('active');
  userModal.classList.add('active');
  inputUserId.focus();
}

function closeAllModals() {
  modalOverlay.classList.remove('active');
  webhookModal.classList.remove('active');
  userModal.classList.remove('active');
  
  // Hide completely after transition completes
  setTimeout(() => {
    if (!modalOverlay.classList.contains('active')) {
      modalOverlay.style.display = 'none';
    }
  }, 250);
  
  webhookPassword.value = '';
  inputUserId.value = '';
  userPassword.value = '';
}

// UI Event Handlers for Modals
btnOpenWebhookModal.addEventListener('click', showWebhookModal);
btnOpenUserModal.addEventListener('click', showUserModal);

btnCloseWebhookModal.addEventListener('click', closeAllModals);
btnCloseUserModal.addEventListener('click', closeAllModals);

btnCancelWebhook.addEventListener('click', closeAllModals);
btnCancelUser.addEventListener('click', closeAllModals);

// Close on backdrop overlay click
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    closeAllModals();
  }
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeAllModals();
  }
});

// Manual Roblox API Refresh
btnRefresh.addEventListener('click', async () => {
  // Trigger spin animation
  refreshIcon.classList.add('spin');
  btnRefresh.disabled = true;

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    if (res.ok) {
      await fetchStatus(true);
      // Reset the visual countdown
      countdownRemaining = config.pollIntervalMs / 1000;
    } else {
      showNotification('Error querying Roblox Presence API', 'error');
    }
  } catch (err) {
    showNotification('Network error during manual query', 'error');
  } finally {
    refreshIcon.classList.remove('spin');
    btnRefresh.disabled = false;
  }
});

// Submit Webhook Test
btnSubmitWebhook.addEventListener('click', async () => {
  const password = webhookPassword.value.trim();
  if (!password) {
    showNotification('Please enter the webhook test password.', 'error');
    webhookPassword.focus();
    return;
  }

  btnSubmitWebhook.disabled = true;
  btnSubmitWebhook.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Sending...';

  try {
    const res = await fetch('/api/test-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    
    if (res.ok) {
      showNotification('Discord Webhook test message sent!', 'success');
      closeAllModals();
    } else {
      showNotification(`Test failed: ${data.error || res.statusText}`, 'error');
    }
  } catch (err) {
    showNotification('Failed to reach server webhook endpoint', 'error');
  } finally {
    btnSubmitWebhook.disabled = false;
    btnSubmitWebhook.innerHTML = 'Send Test';
  }
});

// Support enter key in password field
webhookPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitWebhook.click();
  }
});

// Submit Switch Target User
btnSubmitUser.addEventListener('click', async () => {
  const userId = inputUserId.value.trim();
  if (!userId || isNaN(parseInt(userId, 10))) {
    showNotification('Please enter a valid numeric Roblox User ID.', 'error');
    inputUserId.focus();
    return;
  }

  const password = userPassword.value.trim();
  if (!password) {
    showNotification('Please enter the administrator password.', 'error');
    userPassword.focus();
    return;
  }

  btnSubmitUser.disabled = true;
  btnSubmitUser.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Updating...';

  try {
    const res = await fetch('/api/track-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, password })
    });
    const data = await res.json();
    
    if (res.ok) {
      showNotification(`Now tracking ${data.userProfile.displayName}!`, 'success');
      closeAllModals();
      
      // Update local client status and reset visual progress
      await fetchStatus();
      countdownRemaining = config.pollIntervalMs / 1000;
    } else {
      showNotification(`Update failed: ${data.error || res.statusText}`, 'error');
    }
  } catch (err) {
    showNotification('Failed to switch tracked user', 'error');
  } finally {
    btnSubmitUser.disabled = false;
    btnSubmitUser.innerHTML = 'Track User';
  }
});

// Support enter key in userid and password fields
inputUserId.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    userPassword.focus();
  }
});

userPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitUser.click();
  }
});

btnClearLogs.addEventListener('click', () => {
  // Just empty visually (backend logs remain)
  renderLogs([]);
  showNotification('Activity list cleared visually.', 'info');
});

// App Entry Point
async function init() {
  await fetchStatus();
  startCountdown();
  
  // Also poll the status API in the background (every 3 seconds) to ensure real-time UI synchronization
  setInterval(() => {
    fetchStatus();
  }, 3000);
}

init();
