// Application State
let config = {
  pollIntervalMs: 15000
};
let countdownTimer = null;
let countdownRemaining = 15; // in seconds

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const webhookModal = document.getElementById('webhook-modal');
const userModal = document.getElementById('user-modal');
const untrackModal = document.getElementById('untrack-modal');

const btnOpenWebhookModal = document.getElementById('btn-open-webhook-modal');
const btnOpenUserModal = document.getElementById('btn-open-user-modal');

const btnCloseWebhookModal = document.getElementById('btn-close-webhook-modal');
const btnCloseUserModal = document.getElementById('btn-close-user-modal');
const btnCloseUntrackModal = document.getElementById('btn-close-untrack-modal');

const btnCancelWebhook = document.getElementById('btn-cancel-webhook');
const btnCancelUser = document.getElementById('btn-cancel-user');
const btnCancelUntrack = document.getElementById('btn-cancel-untrack');

const btnSubmitWebhook = document.getElementById('btn-submit-webhook');
const btnSubmitUser = document.getElementById('btn-submit-user');
const btnSubmitUntrack = document.getElementById('btn-submit-untrack');

const webhookPassword = document.getElementById('webhook-password');
const inputUserId = document.getElementById('input-userid');
const userPassword = document.getElementById('user-password');
const untrackPassword = document.getElementById('untrack-password');
const untrackUserName = document.getElementById('untrack-user-name');

const webhookUrlDesc = document.getElementById('webhook-url-desc');
const webhookBadgeStatus = document.getElementById('webhook-badge-status');

const logList = document.getElementById('log-list');
const logEmptyState = document.getElementById('log-empty-state');
const btnClearLogs = document.getElementById('btn-clear-logs');

const toast = document.getElementById('notification-toast');
const toastIcon = document.getElementById('toast-icon');
const toastMessage = document.getElementById('toast-message');

const countdownText = document.getElementById('countdown-text');
const countdownFill = document.getElementById('countdown-fill');
const btnRefresh = document.getElementById('btn-refresh');
const refreshIcon = document.getElementById('refresh-icon');

const footerInterval = document.getElementById('footer-interval');

let currentUntrackUserId = null;

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
    if (log.type === 'config_change') iconClass = 'fa-user-gear';

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

// Render dynamic tracked accounts grid
function renderUsers(users) {
  const container = document.getElementById('users-container');
  if (!users || users.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px; color: var(--text-muted); background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-lg);">
        <i class="fa-solid fa-user-xmark" style="font-size: 2.2rem; margin-bottom: 16px; color: var(--color-offline);"></i>
        <p style="font-weight: 500;">No Roblox accounts are being tracked currently.</p>
        <p style="font-size: 0.8rem; margin-top: 6px;">Click the Track User button to add one.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  users.forEach(user => {
    const card = document.createElement('section');
    const presenceClass = PRESENCE_CLASSES[user.presence.userPresenceType] || 'status-offline';
    card.className = `card status-card ${presenceClass}`;
    
    // Create the background status gradient strip
    const bgGradient = document.createElement('div');
    bgGradient.className = 'status-bg-gradient';
    card.appendChild(bgGradient);
    
    // Create the untrack button (absolute positioned top right)
    const untrackBtn = document.createElement('button');
    untrackBtn.className = 'untrack-card-btn';
    untrackBtn.title = 'Stop Tracking Account';
    untrackBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    untrackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerUntrackModal(user.profile.id, user.profile.displayName);
    });
    card.appendChild(untrackBtn);

    // Create Avatar container
    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'user-avatar-container';
    
    const avatarRing = document.createElement('div');
    avatarRing.className = 'avatar-ring';
    avatarContainer.appendChild(avatarRing);

    const img = document.createElement('img');
    img.src = user.profile.avatarUrl;
    img.alt = 'Roblox User Avatar';
    img.className = 'user-avatar';
    avatarContainer.appendChild(img);

    const statusBadgeDot = document.createElement('div');
    statusBadgeDot.className = 'avatar-status-badge';
    avatarContainer.appendChild(statusBadgeDot);

    card.appendChild(avatarContainer);

    // Create user info
    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';

    const dispName = document.createElement('h1');
    dispName.className = 'display-name';
    dispName.textContent = user.profile.displayName;
    userInfo.appendChild(dispName);

    const usernameRow = document.createElement('div');
    usernameRow.className = 'username-row';
    
    const uname = document.createElement('span');
    uname.className = 'username';
    uname.textContent = `@${user.profile.username}`;
    usernameRow.appendChild(uname);

    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = 'verified-badge';
    verifiedBadge.title = 'Verified Roblox Account';
    verifiedBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    usernameRow.appendChild(verifiedBadge);

    userInfo.appendChild(usernameRow);

    const uid = document.createElement('p');
    uid.className = 'user-id';
    uid.innerHTML = `ID: <span>${user.profile.id}</span>`;
    userInfo.appendChild(uid);

    card.appendChild(userInfo);

    // Create details
    const details = document.createElement('div');
    details.className = 'status-details';

    // Group 1: Current status
    const group1 = document.createElement('div');
    group1.className = 'detail-group';
    group1.innerHTML = `
      <span class="detail-label">Current Status</span>
      <div class="status-badge-container">
        <span class="status-badge">${PRESENCE_LABELS[user.presence.userPresenceType] || 'OFFLINE'}</span>
      </div>
    `;
    details.appendChild(group1);

    // Group 2: Activity
    const group2 = document.createElement('div');
    group2.className = 'detail-group';
    group2.innerHTML = `
      <span class="detail-label">Current Activity / Location</span>
      <span class="detail-value">${user.presence.lastLocation || 'Website'}</span>
    `;
    details.appendChild(group2);

    // Group 3: Last updated
    const group3 = document.createElement('div');
    group3.className = 'detail-group';
    
    const label = document.createElement('span');
    label.className = 'detail-label';
    label.textContent = 'Last Status Update';
    group3.appendChild(label);

    const value = document.createElement('span');
    value.className = 'detail-value relative-time-field';
    value.dataset.time = user.presence.lastUpdated || '';
    value.textContent = getRelativeTimeString(user.presence.lastUpdated);
    group3.appendChild(value);

    details.appendChild(group3);

    card.appendChild(details);

    // Actions button
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML = `
      <a href="https://www.roblox.com/users/${user.profile.id}/profile" target="_blank" class="btn btn-primary">
        <i class="fa-solid fa-up-right-from-square"></i> Roblox Profile
      </a>
    `;
    card.appendChild(actions);

    container.appendChild(card);
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

    // Render multiple user cards
    renderUsers(data.users);

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

// Timer management for updates
function updateRelativeTime() {
  const fields = document.querySelectorAll('.relative-time-field');
  fields.forEach(field => {
    const time = field.dataset.time;
    if (time) {
      field.textContent = getRelativeTimeString(time);
    }
  });
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
      fetchStatus();
      countdownRemaining = config.pollIntervalMs / 1000;
    }
  }, 1000);
}

// Modal Toggle Handlers
function triggerUntrackModal(userId, displayName) {
  currentUntrackUserId = userId;
  untrackUserName.textContent = displayName;
  
  modalOverlay.style.display = 'flex';
  // Force reflow
  modalOverlay.offsetHeight;
  modalOverlay.classList.add('active');
  untrackModal.classList.add('active');
  untrackPassword.focus();
}

// Show Webhook Modal
function showWebhookModal() {
  modalOverlay.style.display = 'flex';
  // Force reflow
  modalOverlay.offsetHeight;
  modalOverlay.classList.add('active');
  webhookModal.classList.add('active');
  webhookPassword.focus();
}

// Show User Modal
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
  untrackModal.classList.remove('active');
  
  // Hide completely after transition completes
  setTimeout(() => {
    if (!modalOverlay.classList.contains('active')) {
      modalOverlay.style.display = 'none';
    }
  }, 250);
  
  webhookPassword.value = '';
  inputUserId.value = '';
  userPassword.value = '';
  untrackPassword.value = '';
  currentUntrackUserId = null;
}

// UI Event Handlers for Modals
btnOpenWebhookModal.addEventListener('click', showWebhookModal);
btnOpenUserModal.addEventListener('click', showUserModal);

btnCloseWebhookModal.addEventListener('click', closeAllModals);
btnCloseUserModal.addEventListener('click', closeAllModals);
btnCloseUntrackModal.addEventListener('click', closeAllModals);

btnCancelWebhook.addEventListener('click', closeAllModals);
btnCancelUser.addEventListener('click', closeAllModals);
btnCancelUntrack.addEventListener('click', closeAllModals);

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

// Submit Track User ID
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
  btnSubmitUser.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Adding...';

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
      showNotification(`Successfully added ${data.user.profile.displayName} to tracking list!`, 'success');
      closeAllModals();
      await fetchStatus();
    } else {
      showNotification(`Tracking failed: ${data.error || res.statusText}`, 'error');
    }
  } catch (err) {
    showNotification('Failed to add tracked user', 'error');
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

// Submit Stop Tracking User (Untrack)
btnSubmitUntrack.addEventListener('click', async () => {
  const password = untrackPassword.value.trim();
  if (!password) {
    showNotification('Please enter the administrator password.', 'error');
    untrackPassword.focus();
    return;
  }

  btnSubmitUntrack.disabled = true;
  btnSubmitUntrack.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Removing...';

  try {
    const res = await fetch('/api/untrack-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId: currentUntrackUserId, password })
    });
    const data = await res.json();
    
    if (res.ok) {
      showNotification(data.message || 'Stopped tracking account.', 'success');
      closeAllModals();
      await fetchStatus();
    } else {
      showNotification(`Removal failed: ${data.error || res.statusText}`, 'error');
    }
  } catch (err) {
    showNotification('Failed to stop tracking user', 'error');
  } finally {
    btnSubmitUntrack.disabled = false;
    btnSubmitUntrack.innerHTML = 'Stop Tracking';
  }
});

untrackPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitUntrack.click();
  }
});

btnClearLogs.addEventListener('click', () => {
  renderLogs([]);
  showNotification('Activity list cleared visually.', 'info');
});

// App Entry Point
async function init() {
  await fetchStatus();
  startCountdown();
}

init();
