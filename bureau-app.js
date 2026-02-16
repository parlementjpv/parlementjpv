// =========================================================
// PARLEMENT JPV — BUREAU APP V2
// Multi-user collaborative platform
// =========================================================

const APP = {
  version: '2.0',
  currentUser: null,
  currentMonth: new Date(),
  
  storage: {
    users: 'bureau_users_v2',
    articles: 'bureau_articles_v2',
    events: 'bureau_events_v2',
    tasks: 'bureau_tasks_v2',
    files: 'bureau_files_v2',
    notifications: 'bureau_notifications_v2',
    session: 'bureau_session_v2'
  },

  // Default users (setup initial)
  defaultUsers: [
    { id: 1, username: 'president', password: 'President2026!', name: 'Président', role: 'Président', email: 'president@parlementjpv.fr' },
    { id: 2, username: 'secretaire', password: 'Secretaire2026!', name: 'Secrétaire', role: 'Secrétaire Général', email: 'secretaire@parlementjpv.fr' },
    { id: 3, username: 'tresorier', password: 'Tresorier2026!', name: 'Trésorier', role: 'Trésorier', email: 'tresorier@parlementjpv.fr' },
    { id: 4, username: 'communication', password: 'Comm2026!', name: 'Responsable Com', role: 'Communication', email: 'com@parlementjpv.fr' }
  ]
};

// =========================================================
// UTILITY FUNCTIONS
// =========================================================

function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Storage error:', e);
    return false;
  }
}

function getData(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Retrieval error:', e);
    return null;
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getAvatar(name) {
  return name.charAt(0).toUpperCase();
}

function showAlert(message, type = 'info') {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  
  const container = document.getElementById('loginAlert') || document.querySelector('.container');
  if (container) {
    container.insertBefore(alert, container.firstChild);
    setTimeout(() => alert.remove(), 4000);
  }
}

// =========================================================
// AUTHENTICATION
// =========================================================

function initializeUsers() {
  let users = getData(APP.storage.users);
  if (!users) {
    users = APP.defaultUsers;
    saveData(APP.storage.users, users);
  }
  return users;
}

function showFirstTimeSetup() {
  const html = `
    <div class="alert alert-info">
      <strong>Configuration initiale</strong><br>
      Comptes par défaut créés :<br>
      <ul style="margin: 0.5rem 0 0 1.5rem; font-size: 0.875rem;">
        <li>president / President2026!</li>
        <li>secretaire / Secretaire2026!</li>
        <li>tresorier / Tresorier2026!</li>
        <li>communication / Comm2026!</li>
      </ul>
      <small>⚠️ Changez ces mots de passe après première connexion</small>
    </div>
  `;
  
  document.getElementById('loginAlert').innerHTML = html;
  initializeUsers();
}

function login(username, password) {
  const users = getData(APP.storage.users) || APP.defaultUsers;
  const user = users.find(u => u.username === username && u.password === password);
  
  if (user) {
    APP.currentUser = user;
    saveData(APP.storage.session, { userId: user.id, loginTime: Date.now() });
    showDashboard();
    addNotification('Connexion réussie', `Bienvenue ${user.name} !`, 'success');
    return true;
  }
  
  return false;
}

function checkSession() {
  const session = getData(APP.storage.session);
  if (session) {
    const users = getData(APP.storage.users) || APP.defaultUsers;
    const user = users.find(u => u.id === session.userId);
    if (user) {
      APP.currentUser = user;
      showDashboard();
      return true;
    }
  }
  return false;
}

function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    localStorage.removeItem(APP.storage.session);
    location.reload();
  }
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  
  document.getElementById('userName').textContent = APP.currentUser.name;
  document.getElementById('userAvatar').textContent = getAvatar(APP.currentUser.name);
  
  loadAllData();
  updateStats();
  populateAssigneeDropdown();
  renderCalendar();
}

// =========================================================
// ARTICLES
// =========================================================

function publishArticle(title, category, content, isPublic) {
  const articles = getData(APP.storage.articles) || [];
  
  const article = {
    id: Date.now(),
    title,
    category,
    content,
    isPublic,
    author: APP.currentUser.name,
    authorId: APP.currentUser.id,
    createdAt: new Date().toISOString(),
    likes: 0,
    views: 0
  };
  
  articles.unshift(article);
  saveData(APP.storage.articles, articles);
  
  // Create notification for all members
  if (isPublic) {
    addNotification(
      'Nouvel article publié',
      `${APP.currentUser.name} a publié : "${title}"`,
      'info'
    );
  }
  
  loadArticles();
  updateStats();
  showAlert('Article publié avec succès !', 'success');
}

function loadArticles(filter = 'all') {
  const articles = getData(APP.storage.articles) || [];
  const container = document.getElementById('articlesList');
  
  let filtered = articles;
  
  if (filter === 'public') filtered = articles.filter(a => a.isPublic);
  else if (filter === 'private') filtered = articles.filter(a => !a.isPublic);
  else if (filter === 'mine') filtered = articles.filter(a => a.authorId === APP.currentUser.id);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--clr-slate); padding: 2rem;">Aucun article</p>';
    return;
  }
  
  container.innerHTML = filtered.map(article => `
    <div class="item">
      <div class="item-meta">
        <div class="item-title">${article.title}</div>
        <div class="item-info">
          <span>✍️ ${article.author}</span>
          <span>📅 ${formatDate(article.createdAt)}</span>
          <span>📂 ${article.category}</span>
          <span class="badge ${article.isPublic ? 'badge-success' : 'badge-warning'}">
            ${article.isPublic ? '🌐 Public' : '🔒 Privé'}
          </span>
        </div>
        <div class="item-content">${article.content.substring(0, 200)}${article.content.length > 200 ? '...' : ''}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" onclick="viewArticle(${article.id})">👁️ Voir</button>
        ${article.authorId === APP.currentUser.id ? `
          <button class="btn btn-danger btn-sm" onclick="deleteArticle(${article.id})">🗑️</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function viewArticle(id) {
  const articles = getData(APP.storage.articles) || [];
  const article = articles.find(a => a.id === id);
  
  if (article) {
    // Increment views
    article.views++;
    saveData(APP.storage.articles, articles);
    
    alert(`📝 ${article.title}\n\n✍️ Par ${article.author}\n📅 ${formatDate(article.createdAt)}\n📂 ${article.category}\n${article.isPublic ? '🌐 Public' : '🔒 Privé'}\n\n${article.content}`);
  }
}

function deleteArticle(id) {
  if (confirm('Supprimer cet article ?')) {
    let articles = getData(APP.storage.articles) || [];
    articles = articles.filter(a => a.id !== id);
    saveData(APP.storage.articles, articles);
    loadArticles();
    updateStats();
    showAlert('Article supprimé', 'success');
  }
}

// =========================================================
// EVENTS
// =========================================================

function createEvent(title, date, time, location, description) {
  const events = getData(APP.storage.events) || [];
  
  const event = {
    id: Date.now(),
    title,
    date,
    time,
    location,
    description,
    creator: APP.currentUser.name,
    creatorId: APP.currentUser.id,
    createdAt: new Date().toISOString(),
    attendees: []
  };
  
  events.push(event);
  saveData(APP.storage.events, events);
  
  addNotification(
    'Nouvel événement',
    `${APP.currentUser.name} a créé : ${title} le ${formatDate(date)}`,
    'info'
  );
  
  loadEvents();
  updateStats();
  renderCalendar();
  showAlert('Événement créé !', 'success');
}

function loadEvents() {
  const events = getData(APP.storage.events) || [];
  const container = document.getElementById('eventsList');
  
  // Sort by date
  const sorted = events.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  if (sorted.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--clr-slate); padding: 2rem;">Aucun événement</p>';
    return;
  }
  
  container.innerHTML = sorted.map(event => `
    <div class="item">
      <div class="item-meta">
        <div class="item-title">${event.title}</div>
        <div class="item-info">
          <span>📅 ${formatDate(event.date)}</span>
          <span>🕐 ${event.time}</span>
          <span>📍 ${event.location}</span>
          <span>👤 ${event.creator}</span>
        </div>
        <div class="item-content">${event.description}</div>
      </div>
      <div class="item-actions">
        ${event.creatorId === APP.currentUser.id ? `
          <button class="btn btn-danger btn-sm" onclick="deleteEvent(${event.id})">🗑️</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function deleteEvent(id) {
  if (confirm('Supprimer cet événement ?')) {
    let events = getData(APP.storage.events) || [];
    events = events.filter(e => e.id !== id);
    saveData(APP.storage.events, events);
    loadEvents();
    updateStats();
    renderCalendar();
  }
}

// =========================================================
// TASKS
// =========================================================

function createTask(title, assigneeId, priority, deadline) {
  const tasks = getData(APP.storage.tasks) || [];
  const users = getData(APP.storage.users) || APP.defaultUsers;
  const assignee = users.find(u => u.id === parseInt(assigneeId));
  
  const task = {
    id: Date.now(),
    title,
    assigneeId: parseInt(assigneeId),
    assigneeName: assignee.name,
    priority,
    deadline,
    creator: APP.currentUser.name,
    creatorId: APP.currentUser.id,
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: null
  };
  
  tasks.push(task);
  saveData(APP.storage.tasks, tasks);
  
  if (assigneeId !== APP.currentUser.id) {
    addNotification(
      'Nouvelle tâche assignée',
      `${APP.currentUser.name} vous a assigné : ${title}`,
      'warning',
      parseInt(assigneeId)
    );
  }
  
  loadTasks();
  updateStats();
  showAlert('Tâche créée !', 'success');
}

function loadTasks(filter = 'active') {
  const tasks = getData(APP.storage.tasks) || [];
  const container = document.getElementById('tasksList');
  
  let filtered = tasks;
  
  if (filter === 'active') filtered = tasks.filter(t => !t.completed);
  else if (filter === 'completed') filtered = tasks.filter(t => t.completed);
  else if (filter === 'mine') filtered = tasks.filter(t => t.assigneeId === APP.currentUser.id && !t.completed);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--clr-slate); padding: 2rem;">Aucune tâche</p>';
    return;
  }
  
  const priorityIcons = { low: '🟢', medium: '🟡', high: '🔴' };
  
  container.innerHTML = filtered.map(task => `
    <div class="item" style="${task.completed ? 'opacity: 0.6;' : ''}">
      <div class="item-meta">
        <div class="item-title" style="${task.completed ? 'text-decoration: line-through;' : ''}">
          ${priorityIcons[task.priority]} ${task.title}
        </div>
        <div class="item-info">
          <span>👤 ${task.assigneeName}</span>
          <span>📅 ${formatDate(task.deadline)}</span>
          <span>✍️ ${task.creator}</span>
          <span class="badge ${task.completed ? 'badge-success' : 'badge-warning'}">
            ${task.completed ? '✅ Terminée' : '⏳ En cours'}
          </span>
        </div>
      </div>
      <div class="item-actions">
        ${!task.completed && task.assigneeId === APP.currentUser.id ? `
          <button class="btn btn-success btn-sm" onclick="completeTask(${task.id})">✅</button>
        ` : ''}
        ${task.creatorId === APP.currentUser.id ? `
          <button class="btn btn-danger btn-sm" onclick="deleteTask(${task.id})">🗑️</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function completeTask(id) {
  const tasks = getData(APP.storage.tasks) || [];
  const task = tasks.find(t => t.id === id);
  
  if (task) {
    task.completed = true;
    task.completedAt = new Date().toISOString();
    saveData(APP.storage.tasks, tasks);
    
    addNotification(
      'Tâche terminée',
      `${APP.currentUser.name} a terminé : ${task.title}`,
      'success'
    );
    
    loadTasks();
    updateStats();
  }
}

function deleteTask(id) {
  if (confirm('Supprimer cette tâche ?')) {
    let tasks = getData(APP.storage.tasks) || [];
    tasks = tasks.filter(t => t.id !== id);
    saveData(APP.storage.tasks, tasks);
    loadTasks();
    updateStats();
  }
}

// =========================================================
// FILES
// =========================================================

function handleFileUpload(files) {
  const fileData = getData(APP.storage.files) || [];
  
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const fileObj = {
        id: Date.now() + Math.random(),
        name: file.name,
        type: file.type,
        size: file.size,
        data: e.target.result,
        uploadedBy: APP.currentUser.name,
        uploadedById: APP.currentUser.id,
        uploadedAt: new Date().toISOString()
      };
      
      fileData.push(fileObj);
      saveData(APP.storage.files, fileData);
      loadFiles();
      
      addNotification(
        'Fichier ajouté',
        `${APP.currentUser.name} a ajouté : ${file.name}`,
        'info'
      );
    };
    reader.readAsDataURL(file);
  });
}

function loadFiles() {
  const files = getData(APP.storage.files) || [];
  const container = document.getElementById('filesList');
  
  if (files.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--clr-slate); padding: 2rem;">Aucun fichier</p>';
    return;
  }
  
  container.innerHTML = files.map(file => `
    <div class="item">
      <div class="item-meta">
        <div class="item-title">📎 ${file.name}</div>
        <div class="item-info">
          <span>👤 ${file.uploadedBy}</span>
          <span>📅 ${formatDate(file.uploadedAt)}</span>
          <span>📊 ${(file.size / 1024).toFixed(1)} KB</span>
        </div>
      </div>
      <div class="item-actions">
        <a href="${file.data}" download="${file.name}" class="btn btn-primary btn-sm">⬇️</a>
        ${file.uploadedById === APP.currentUser.id ? `
          <button class="btn btn-danger btn-sm" onclick="deleteFile(${file.id})">🗑️</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function deleteFile(id) {
  if (confirm('Supprimer ce fichier ?')) {
    let files = getData(APP.storage.files) || [];
    files = files.filter(f => f.id !== id);
    saveData(APP.storage.files, files);
    loadFiles();
  }
}

// =========================================================
// NOTIFICATIONS
// =========================================================

function addNotification(title, message, type = 'info', targetUserId = null) {
  const notifications = getData(APP.storage.notifications) || [];
  
  const notification = {
    id: Date.now(),
    title,
    message,
    type,
    targetUserId, // null = tous les membres
    createdAt: new Date().toISOString(),
    read: false
  };
  
  notifications.unshift(notification);
  saveData(APP.storage.notifications, notifications);
  
  loadNotifications();
}

function loadNotifications() {
  const notifications = getData(APP.storage.notifications) || [];
  const container = document.getElementById('notificationsList');
  
  // Filter for current user
  const userNotifs = notifications.filter(n => 
    n.targetUserId === null || n.targetUserId === APP.currentUser.id
  );
  
  if (userNotifs.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--clr-slate); padding: 2rem;">Aucune notification</p>';
    return;
  }
  
  container.innerHTML = userNotifs.map(notif => `
    <div class="notification ${!notif.read ? 'unread' : ''}" onclick="markAsRead(${notif.id})">
      <div class="notification-title">${notif.title}</div>
      <div>${notif.message}</div>
      <div class="notification-time">${formatDate(notif.createdAt)} à ${formatTime(notif.createdAt)}</div>
    </div>
  `).join('');
}

function markAsRead(id) {
  const notifications = getData(APP.storage.notifications) || [];
  const notif = notifications.find(n => n.id === id);
  if (notif) {
    notif.read = true;
    saveData(APP.storage.notifications, notifications);
    loadNotifications();
  }
}

function markAllAsRead() {
  const notifications = getData(APP.storage.notifications) || [];
  notifications.forEach(n => {
    if (n.targetUserId === null || n.targetUserId === APP.currentUser.id) {
      n.read = true;
    }
  });
  saveData(APP.storage.notifications, notifications);
  loadNotifications();
}

// =========================================================
// CALENDAR
// =========================================================

function renderCalendar() {
  const container = document.getElementById('calendarView');
  const events = getData(APP.storage.events) || [];
  
  const year = APP.currentMonth.getFullYear();
  const month = APP.currentMonth.getMonth();
  
  document.getElementById('currentMonth').textContent = 
    APP.currentMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toDateString();
  
  let html = '<div class="calendar-grid">';
  ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].forEach(day => {
    html += `<div style="font-weight: 700; padding: 0.5rem; text-align: center;">${day}</div>`;
  });
  
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day" style="opacity: 0.3;"></div>';
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().split('T')[0];
    const hasEvent = events.some(e => e.date === dateStr);
    const isToday = date.toDateString() === today;
    
    html += `<div class="calendar-day ${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}">${day}</div>`;
  }
  
  html += '</div>';
  container.innerHTML = html;
}

function changeMonth(delta) {
  APP.currentMonth.setMonth(APP.currentMonth.getMonth() + delta);
  renderCalendar();
}

// =========================================================
// MEMBERS & ANALYTICS
// =========================================================

function loadMembers() {
  const users = getData(APP.storage.users) || APP.defaultUsers;
  const container = document.getElementById('membersList');
  
  container.innerHTML = users.map(user => `
    <div class="member-card">
      <div class="member-avatar">${getAvatar(user.name)}</div>
      <div class="member-info">
        <div class="member-name">${user.name}</div>
        <div class="member-role">${user.role}</div>
        <div style="font-size: 0.8125rem; color: var(--clr-mist); margin-top: 0.25rem;">${user.email}</div>
      </div>
    </div>
  `).join('');
}

function loadAnalytics() {
  const articles = getData(APP.storage.articles) || [];
  const tasks = getData(APP.storage.tasks) || [];
  const users = getData(APP.storage.users) || APP.defaultUsers;
  
  // Member Activity
  const activityContainer = document.getElementById('memberActivity');
  const activity = users.map(user => {
    const userArticles = articles.filter(a => a.authorId === user.id).length;
    const userTasks = tasks.filter(t => t.creatorId === user.id).length;
    return { name: user.name, articles: userArticles, tasks: userTasks };
  });
  
  activityContainer.innerHTML = activity.map(a => `
    <div style="padding: 0.75rem; background: var(--clr-paper); border-radius: var(--radius-lg); margin-bottom: 0.5rem;">
      <strong>${a.name}</strong>: ${a.articles} articles, ${a.tasks} tâches créées
    </div>
  `).join('');
  
  // Article Stats
  const statsContainer = document.getElementById('articleStats');
  const categories = {};
  articles.forEach(a => {
    categories[a.category] = (categories[a.category] || 0) + 1;
  });
  
  statsContainer.innerHTML = Object.entries(categories).map(([cat, count]) => `
    <div style="padding: 0.75rem; background: var(--clr-paper); border-radius: var(--radius-lg); margin-bottom: 0.5rem;">
      <strong>${cat}</strong>: ${count} article${count > 1 ? 's' : ''}
    </div>
  `).join('') || '<p style="color: var(--clr-slate);">Aucune donnée</p>';
  
  // Task Completion
  const completionContainer = document.getElementById('taskCompletion');
  const completed = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  completionContainer.innerHTML = `
    <div style="text-align: center; padding: 2rem;">
      <div style="font-size: 3rem; font-weight: 900; color: var(--clr-gold);">${rate}%</div>
      <p style="color: var(--clr-slate);">${completed} sur ${total} tâches terminées</p>
    </div>
  `;
}

// =========================================================
// DASHBOARD
// =========================================================

function loadDashboard() {
  // Recent Activity
  const articles = getData(APP.storage.articles) || [];
  const events = getData(APP.storage.events) || [];
  const tasks = getData(APP.storage.tasks) || [];
  
  const activityContainer = document.getElementById('recentActivity');
  const recent = [
    ...articles.slice(0, 3).map(a => ({ type: '📝', text: `${a.author} a publié "${a.title}"`, date: a.createdAt })),
    ...tasks.slice(0, 2).map(t => ({ type: '✅', text: `Tâche "${t.title}" assignée à ${t.assigneeName}`, date: t.createdAt }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  
  activityContainer.innerHTML = recent.map(item => `
    <div style="padding: 0.75rem; border-left: 3px solid var(--clr-gold); background: var(--clr-paper); margin-bottom: 0.5rem; border-radius: var(--radius-lg);">
      ${item.type} ${item.text}
      <div style="font-size: 0.75rem; color: var(--clr-mist); margin-top: 0.25rem;">${formatDate(item.date)}</div>
    </div>
  `).join('') || '<p style="color: var(--clr-slate);">Aucune activité récente</p>';
  
  // Urgent Tasks
  const urgentContainer = document.getElementById('urgentTasks');
  const urgent = tasks
    .filter(t => !t.completed && t.priority === 'high')
    .slice(0, 5);
  
  urgentContainer.innerHTML = urgent.map(t => `
    <div style="padding: 0.75rem; border-left: 3px solid var(--clr-danger); background: var(--clr-paper); margin-bottom: 0.5rem; border-radius: var(--radius-lg);">
      🔴 ${t.title}
      <div style="font-size: 0.75rem; color: var(--clr-mist); margin-top: 0.25rem;">
        📅 ${formatDate(t.deadline)} • 👤 ${t.assigneeName}
      </div>
    </div>
  `).join('') || '<p style="color: var(--clr-slate);">Aucune tâche urgente</p>';
  
  // Upcoming Events
  const upcomingContainer = document.getElementById('upcomingEvents');
  const upcoming = events
    .filter(e => new Date(e.date) >= new Date())
    .slice(0, 3);
  
  upcomingContainer.innerHTML = upcoming.map(e => `
    <div style="padding: 0.75rem; border-left: 3px solid var(--clr-info); background: var(--clr-paper); margin-bottom: 0.5rem; border-radius: var(--radius-lg);">
      📅 ${e.title}
      <div style="font-size: 0.75rem; color: var(--clr-mist); margin-top: 0.25rem;">
        ${formatDate(e.date)} à ${e.time} • 📍 ${e.location}
      </div>
    </div>
  `).join('') || '<p style="color: var(--clr-slate);">Aucun événement à venir</p>';
}

// =========================================================
// STATS
// =========================================================

function updateStats() {
  const articles = getData(APP.storage.articles) || [];
  const events = getData(APP.storage.events) || [];
  const tasks = getData(APP.storage.tasks) || [];
  const users = getData(APP.storage.users) || APP.defaultUsers;
  
  document.getElementById('statArticles').textContent = articles.length;
  document.getElementById('statEvents').textContent = events.length;
  document.getElementById('statTasks').textContent = tasks.filter(t => !t.completed).length;
  document.getElementById('statMembers').textContent = users.length;
}

// =========================================================
// HELPERS
// =========================================================

function populateAssigneeDropdown() {
  const users = getData(APP.storage.users) || APP.defaultUsers;
  const select = document.getElementById('taskAssignee');
  
  select.innerHTML = users.map(u => 
    `<option value="${u.id}">${u.name} (${u.role})</option>`
  ).join('');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  event.target.classList.add('active');
  const content = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (content) content.classList.add('active');
  
  // Load data for tab
  if (tabName === 'members') loadMembers();
  if (tabName === 'analytics') loadAnalytics();
  if (tabName === 'dashboard') loadDashboard();
}

function loadAllData() {
  loadArticles();
  loadEvents();
  loadTasks();
  loadFiles();
  loadNotifications();
  loadMembers();
  loadDashboard();
  loadAnalytics();
}

// =========================================================
// EVENT LISTENERS
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  initializeUsers();
  
  if (!checkSession()) {
    // Show login
  }
  
  // Login form
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (login(username, password)) {
      e.target.reset();
    } else {
      showAlert('Identifiants incorrects', 'error');
    }
  });
  
  // Article form
  document.getElementById('articleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    publishArticle(
      document.getElementById('articleTitle').value,
      document.getElementById('articleCategory').value,
      document.getElementById('articleContent').value,
      document.getElementById('articlePublic').checked
    );
    e.target.reset();
  });
  
  // Article filter
  document.getElementById('articleFilter').addEventListener('change', (e) => {
    loadArticles(e.target.value);
  });
  
  // Event form
  document.getElementById('eventForm').addEventListener('submit', (e) => {
    e.preventDefault();
    createEvent(
      document.getElementById('eventTitle').value,
      document.getElementById('eventDate').value,
      document.getElementById('eventTime').value,
      document.getElementById('eventLocation').value,
      document.getElementById('eventDescription').value
    );
    e.target.reset();
  });
  
  // Task form
  document.getElementById('taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    createTask(
      document.getElementById('taskTitle').value,
      document.getElementById('taskAssignee').value,
      document.getElementById('taskPriority').value,
      document.getElementById('taskDeadline').value
    );
    e.target.reset();
  });
  
  // Task filter
  document.getElementById('taskFilter').addEventListener('change', (e) => {
    loadTasks(e.target.value);
  });
  
  // File upload
  document.getElementById('fileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files);
      e.target.value = '';
    }
  });
});
