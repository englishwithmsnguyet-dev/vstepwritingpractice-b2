
// --- Mindmap Dual Language Switcher ---
let currentMindmapLang = 'vi';

function switchMindmapLang(lang) {
  currentMindmapLang = lang;
  const imgEl = document.getElementById('active-mindmap-img');
  const btnVi = document.getElementById('btn-mindmap-vi');
  const btnEn = document.getElementById('btn-mindmap-en');
  if (!currentTopic || !currentTopic.details) return;
  const targetSrc = (lang === 'en' && currentTopic.details.mindmap_img_en) ? currentTopic.details.mindmap_img_en : currentTopic.details.mindmap_img;
  if (imgEl) imgEl.src = targetSrc;
  if (btnVi && btnEn) {
    if (lang === 'en') {
      btnEn.style.background = 'var(--accent-primary)';
      btnEn.style.color = '#fff';
      btnVi.style.background = 'transparent';
      btnVi.style.color = 'var(--text-secondary)';
    } else {
      btnVi.style.background = 'var(--accent-primary)';
      btnVi.style.color = '#fff';
      btnEn.style.background = 'transparent';
      btnEn.style.color = 'var(--text-secondary)';
    }
  }
}

function openActiveMindmapModal() {
  if (!currentTopic || !currentTopic.details) return;
  const targetSrc = (currentMindmapLang === 'en' && currentTopic.details.mindmap_img_en) ? currentTopic.details.mindmap_img_en : currentTopic.details.mindmap_img;
  const title = (currentMindmapLang === 'en') ? `Mindmap: ${currentTopic.title_en}` : `Sơ đồ tư duy: ${currentTopic.title_vi || currentTopic.title_en}`;
  openMindmapModal(targetSrc, title);
}

// State Management
let currentScreen = 'dashboard';
let currentCategory = null;
let currentTopic = null;
let currentOutlineLevel = 'B2';
let currentSampleLevel = 'B2';
let currentTransLevel = 'B2'; // active level for translation exercises
let currentVocabLevel = 'B2'; // active level for vocabulary booster step
let currentStep = 1; // 1: Reading, 2: Translation Practice, 3: Full Essay Editor, 4: Model Essay Reference
let hasSubmitted = false; // Tracks if the essay has been submitted for grading
let currentPage = 1;
const itemsPerPage = 9;
let currentTopicStatusFilter = 'all'; // 'all' | 'written' | 'unwritten'

// Timer State
let timerInterval = null;
let timerSeconds = 40 * 60; // 40 minutes VSTEP standard
let writingElapsedSeconds = 0;
let overtimeNotified = false;
let isTimerRunning = false;

// Unsaved Progress State
let isDirty = false;

// Anti-Cheat & Exam Lock State
let cheatViolationCount = 0;
let cheatTabSwitchCount = 0;
let cheatPasteCount = 0;
let lastCheatAlertTime = 0;
let isPromptingUser = false;
let currentEvaluationData = null;

function isExamModeActive() {
  const userName = sessionStorage.getItem('current_user_name') || '';
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return false; // Teachers have zero restrictions
  }
  return currentScreen === 'workspace' && currentStepKey === 'write' && !hasSubmitted;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Per-Student Storage Key Helpers (isolated & cloud-synced by student name) ---
function getStudentHistoryKey() {
  return (window.StudentHistorySync && typeof window.StudentHistorySync.getHistoryKey === 'function')
    ? window.StudentHistorySync.getHistoryKey()
    : 'writing_history';
}

function getStudentDraftKey(catId, topicId) {
  return (window.StudentHistorySync && typeof window.StudentHistorySync.getDraftKey === 'function')
    ? window.StudentHistorySync.getDraftKey(catId, topicId)
    : `draft_${catId}_${topicId}`;
}

function getStudentDraftPrefix() {
  return (window.StudentHistorySync && typeof window.StudentHistorySync.getDraftPrefix === 'function')
    ? window.StudentHistorySync.getDraftPrefix()
    : 'draft_';
}

function getStudentTransKey(type, catId, topicId, level, idx) {
  return (window.StudentHistorySync && typeof window.StudentHistorySync.getTransKey === 'function')
    ? window.StudentHistorySync.getTransKey(type, catId, topicId, level, idx)
    : `trans_${type}_${catId}_${topicId}_${level}_${idx}`;
}

function getStudentTransTopicPrefix(type, catId, topicId) {
  return (window.StudentHistorySync && typeof window.StudentHistorySync.getTransTopicPrefix === 'function')
    ? window.StudentHistorySync.getTransTopicPrefix(type, catId, topicId)
    : `trans_${type}_${catId}_${topicId}_`;
}

// --- Stick / Checkmark Topic Feature ---
function getStudentStickKey() {
  if (window.StudentHistorySync && typeof window.StudentHistorySync.getStickKey === 'function') {
    return window.StudentHistorySync.getStickKey();
  }
  const userName = (sessionStorage.getItem('current_user_name') || 'default').trim().toLowerCase();
  return `vstep_stick_topics_${userName}`;
}

function getStudentUnstickKey() {
  if (window.StudentHistorySync && typeof window.StudentHistorySync.getUnstickKey === 'function') {
    return window.StudentHistorySync.getUnstickKey();
  }
  const userName = (sessionStorage.getItem('current_user_name') || 'default').trim().toLowerCase();
  return `vstep_unstick_topics_${userName}`;
}

function getManualStickList() {
  try {
    const raw = localStorage.getItem(getStudentStickKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getManualUnstickList() {
  try {
    const raw = localStorage.getItem(getStudentUnstickKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getTopicSubmissionInfo(catId, topicId) {
  try {
    const history = typeof getHistory === 'function' ? getHistory() : [];
    return history.find(item => item.catId === catId && item.topicId === topicId) || null;
  } catch (e) {
    return null;
  }
}

function isTopicWritten(catId, topicId) {
  const topicKey = `${catId}_${topicId}`;
  const unstickList = getManualUnstickList();
  if (unstickList.includes(topicKey)) return false;
  
  const stickList = getManualStickList();
  if (stickList.includes(topicKey)) return true;
  
  const subInfo = getTopicSubmissionInfo(catId, topicId);
  return !!subInfo;
}

function toggleTopicStick(catId, topicId, event) {
  if (event) {
    event.stopPropagation(); // Avoid triggering startPractice
  }
  const topicKey = `${catId}_${topicId}`;
  const currentlyWritten = isTopicWritten(catId, topicId);
  let stickList = getManualStickList();
  let unstickList = getManualUnstickList();

  if (currentlyWritten) {
    stickList = stickList.filter(k => k !== topicKey);
    if (!unstickList.includes(topicKey)) unstickList.push(topicKey);
    localStorage.setItem(getStudentStickKey(), JSON.stringify(stickList));
    localStorage.setItem(getStudentUnstickKey(), JSON.stringify(unstickList));
    showToast(`Đã bỏ đánh dấu: Đề ${topicId}`, 'info');
  } else {
    unstickList = unstickList.filter(k => k !== topicKey);
    if (!stickList.includes(topicKey)) stickList.push(topicKey);
    localStorage.setItem(getStudentStickKey(), JSON.stringify(stickList));
    localStorage.setItem(getStudentUnstickKey(), JSON.stringify(unstickList));
    showToast(`Đã đánh dấu hoàn thành: Đề ${topicId} ✓`, 'success');
  }

  if (window.StudentHistorySync && typeof window.StudentHistorySync.recordStickChange === 'function') {
    window.StudentHistorySync.recordStickChange();
  }
  updateStats();
  if (currentScreen === 'category') {
    const searchVal = document.getElementById('search-input-field') ? document.getElementById('search-input-field').value : '';
    renderCategoryTopics(searchVal);
  }
  if (currentScreen === 'workspace' && currentTopic && currentTopic.id === topicId) {
    updateWorkspaceStickBadge();
  }
}

function toggleCurrentTopicStick() {
  if (!currentCategory || !currentTopic) return;
  toggleTopicStick(currentCategory.id, currentTopic.id);
}

function updateWorkspaceStickBadge() {
  const badge = document.getElementById('workspace-stick-badge');
  if (!badge || !currentCategory || !currentTopic) return;
  const written = isTopicWritten(currentCategory.id, currentTopic.id);
  const subInfo = getTopicSubmissionInfo(currentCategory.id, currentTopic.id);
  
  badge.style.display = 'inline-flex';
  if (written) {
    const scoreText = subInfo && typeof subInfo.score === 'number' ? ` (${subInfo.score.toFixed(1)}đ)` : '';
    badge.className = 'workspace-stick-badge';
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    badge.style.color = '#059669';
    badge.innerHTML = `✓ ĐÃ VIẾT${scoreText}`;
    badge.title = 'Bài viết đã hoàn thành. Nhấp để chuyển trạng thái Chưa viết.';
  } else {
    badge.className = 'workspace-stick-badge';
    badge.style.background = 'rgba(100, 116, 139, 0.1)';
    badge.style.borderColor = 'rgba(100, 116, 139, 0.3)';
    badge.style.color = 'var(--text-muted)';
    badge.innerHTML = `○ Chưa viết (Stick)`;
    badge.title = 'Nhấp để đánh dấu Đã viết';
  }
}

function setTopicStatusFilter(status) {
  currentTopicStatusFilter = status;
  currentPage = 1;
  const btnAll = document.getElementById('filter-all-btn');
  const btnWritten = document.getElementById('filter-written-btn');
  const btnUnwritten = document.getElementById('filter-unwritten-btn');
  if (btnAll) btnAll.classList.toggle('active', status === 'all');
  if (btnWritten) btnWritten.classList.toggle('active', status === 'written');
  if (btnUnwritten) btnUnwritten.classList.toggle('active', status === 'unwritten');
  
  const searchVal = document.getElementById('search-input-field') ? document.getElementById('search-input-field').value : '';
  renderCategoryTopics(searchVal);
}

// Mock database check
if (typeof ESSAY_DATA === 'undefined') {
  console.error("ESSAY_DATA is not loaded! Please check if topics_db.js is imported properly.");
}

// Initialize Application on DOM Content Loaded
document.addEventListener("DOMContentLoaded", () => {
  setTheme(localStorage.getItem("vstep_essay_theme_light") || 'light');
  renderDashboard();
  updateStats();
  
  // Warn if leaving page with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  
  // Listen for escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeComparisonModal();
    }
  });
});

// --- Theme Toggler ---
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem("vstep_essay_theme_light", theme);
  localStorage.setItem("theme", theme);
  
  // Update UI buttons active state
  const btnLight = document.getElementById('theme-light');
  const btnDark = document.getElementById('theme-dark');
  
  if (theme === 'light') {
    if (btnLight) btnLight.classList.add('active');
    if (btnDark) btnDark.classList.remove('active');
  } else {
    if (btnDark) btnDark.classList.add('active');
    if (btnLight) btnLight.classList.remove('active');
  }
}

// --- Router / Screen switcher ---
function switchScreen(screenName) {
  if (isCurrentStudentLocked()) {
    showAccountLockedModal('tab_switch');
    return;
  }
  // Anti-cheat Exam Lock
  if (isExamModeActive() && screenName !== 'workspace') {
    isPromptingUser = true;
    const confirmLeave = confirm("⚠️ BẠN ĐANG TRONG PHÒNG THI VIẾT BÀI LUẬN:\n\nBạn có chắc chắn muốn THOÁT PHÒNG THI để rời đi không?\n(Tiến độ viết bài của bạn sẽ được tự động lưu lại vào Bản nháp)");
    setTimeout(() => { isPromptingUser = false; }, 500);
    if (!confirmLeave) return; // cancel navigation
    saveProgressAction(true);
    stopTimer();
    isDirty = false;
  } else if (currentScreen === 'workspace' && screenName !== 'workspace') {
    // Hide active workspace editor panels if we leave workspace
    if (isDirty) {
      isPromptingUser = true;
      const confirmLeave = confirm("Bạn có tiến độ chưa được sao lưu. Nếu thoát bây giờ, các thay đổi sẽ bị mất. Bạn có chắc chắn muốn thoát?");
      setTimeout(() => { isPromptingUser = false; }, 500);
      if (!confirmLeave) return; // cancel navigation
    }
    stopTimer();
    isDirty = false;
    // Explicitly wipe the DOM so the browser doesn't cache unsaved data
    document.getElementById('essay-textarea').value = '';
    document.querySelectorAll('.trans-input-area').forEach(input => input.value = '');
  }

  // Remove category & workspace view classes from header
  const header = document.querySelector('.top-header');
  if (header) {
    header.classList.remove('view-category');
    header.classList.remove('view-workspace');
  }

  // Close mobile sidebar on navigation
  closeMobileSidebar();

  // Update screen visibility
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const targetScreen = document.getElementById(`screen-${screenName}`);
  if (targetScreen) {
    targetScreen.classList.add('active');
  }
  
  // Update sidebar nav active state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  
  // Find which sidebar button matches this screen
  const links = document.querySelectorAll('.nav-link');
  if (screenName === 'dashboard') {
    links[0].classList.add('active');
    document.getElementById('page-header-title').innerText = 'PHÒNG VIẾT LUẬN B2';
    document.getElementById('global-search-container').style.display = 'block';
    renderDashboard();
  } else if (screenName === 'history') {
    if (header) header.classList.add('view-workspace');
    links[5].classList.add('active');
    document.getElementById('page-header-title').innerText = 'Lịch sử luyện tập';
    document.getElementById('global-search-container').style.display = 'none';
    renderHistory();
  } else if (screenName === 'drafts') {
    if (header) header.classList.add('view-workspace');
    links[6].classList.add('active');
    document.getElementById('page-header-title').innerText = 'Bản nháp đã lưu';
    document.getElementById('global-search-container').style.display = 'none';
    renderDrafts();
  } else if (screenName === 'workspace') {
    if (header) header.classList.add('view-workspace');
    document.getElementById('page-header-title').innerText = 'Phòng luyện viết luận - B2 Level';
    document.getElementById('global-search-container').style.display = 'none';
    isDirty = false;
  }
  
  currentScreen = screenName;
  window.scrollTo(0, 0);
}

// Get theme group for Category 3 (Opinion Essays)
function getCategory3Group(t) {
  if (!t) return 'GIÁO DỤC, HỌC ĐƯỜNG & PHÁT TRIỂN KỸ NĂNG';
  const id = t.id;
  if ([1, 2, 4, 5, 8, 9, 13, 15, 16, 17, 20, 21, 29].includes(id)) {
    return 'GIÁO DỤC, HỌC ĐƯỜNG & PHÁT TRIỂN KỸ NĂNG';
  }
  if ([6, 12, 18, 22, 30].includes(id)) {
    return 'CÔNG NGHỆ, MẠNG XÃ HỘI & TRÍ TUỆ NHÂN TẠO';
  }
  if ([3, 7, 11, 23, 24, 25].includes(id)) {
    return 'MÔI TRƯỜNG, GIAO THÔNG & TRÁCH NHIỆM XÃ HỘI';
  }
  if ([10, 14, 19, 26, 27, 28].includes(id)) {
    return 'SỨC KHỎE, VĂN HÓA & LỐI SỐNG HIỆN ĐẠI';
  }
  return 'GIÁO DỤC, HỌC ĐƯỜNG & PHÁT TRIỂN KỸ NĂNG';
}

// Switch to a Category browse screen
function switchCategory(catId) {
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';
  if (typeof isCategoryAllowedForUser === 'function' && !isCategoryAllowedForUser(catId)) {
    if (userClass === 'B212') {
      showToast('🔒 Dạng luận này tạm thời chưa mở cho lớp B212. Hiện tại lớp mở tất cả các đề thuộc DẠNG LUẬN 01!', 'warning');
    } else if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
      showToast(`🔒 Dạng luận này tạm thời chưa mở cho lớp ${userClass}. Lớp hiện đã mở Dạng 01 & Dạng 02!`, 'warning');
    } else if (userClass === 'CB210') {
      showToast('🔒 Dạng luận này tạm thời chưa mở cho lớp CB210. Lớp hiện mở Dạng 1, 2 và 3!', 'warning');
    } else {
      showToast('🔒 Dạng luận này tạm thời chưa mở!', 'warning');
    }
    return;
  }

  if (isExamModeActive()) {
    isPromptingUser = true;
    const confirmLeave = confirm("⚠️ BẠN ĐANG TRONG PHÒNG THI VIẾT BÀI LUẬN:\n\nBạn có chắc chắn muốn THOÁT PHÒNG THI để rời đi không?\n(Tiến độ viết bài của bạn sẽ được tự động lưu lại vào Bản nháp)");
    setTimeout(() => { isPromptingUser = false; }, 500);
    if (!confirmLeave) return;
    saveProgressAction(true);
    stopTimer();
    isDirty = false;
  } else if (currentScreen === 'workspace') {
    if (isDirty) {
      isPromptingUser = true;
      const confirmLeave = confirm("Bạn có tiến độ chưa được sao lưu. Nếu thoát bây giờ, các thay đổi sẽ bị mất. Bạn có chắc chắn muốn thoát?");
      setTimeout(() => { isPromptingUser = false; }, 500);
      if (!confirmLeave) return;
    }
    stopTimer();
    isDirty = false;
    // Explicitly wipe the DOM so the browser doesn't cache unsaved data
    document.getElementById('essay-textarea').value = '';
    document.querySelectorAll('.trans-input-area').forEach(input => input.value = '');
  }

  // Clear search field
  document.getElementById('search-input-field').value = '';
  
  // Add category view class to header
  const header = document.querySelector('.top-header');
  if (header) {
    header.classList.remove('view-workspace');
    header.classList.add('view-category');
  }
  
  currentCategory = ESSAY_DATA.find(cat => cat.id === catId);
  if (!currentCategory) return;
  
  currentPage = 1;
  currentScreen = 'category';
  
  // Update active category sidebar link
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  const links = document.querySelectorAll('.nav-link');
  links[catId].classList.add('active');
  
  document.getElementById('page-header-title').innerText = currentCategory.title_vi;
  if (typeof updateCategoryCatBanner === 'function') updateCategoryCatBanner(currentCategory.id);
  if (currentCategory.id === 1) {
    const total = currentCategory.topics.length;
    const isBenefitsOnly = (t) => {
      if (t.type === 'benefits_only') return true;
      const ideas = t.details && (t.details.ideas_b2 || t.details.ideas_b1);
      if (ideas && ideas.benefits && (!ideas.drawbacks || ideas.drawbacks.length === 0)) return true;
      const p = (t.prompt || '').toLowerCase();
      if ((p.includes('advantages of') || p.includes('benefits of') || p.includes('importance of')) && !p.includes('and disadvantages') && !p.includes('and drawbacks')) return true;
      return false;
    };
    const onlyAdv = currentCategory.topics.filter(t => isBenefitsOnly(t)).length;
    const both = total - onlyAdv;
    document.getElementById('category-description').innerText = `Trong dạng luận này, hệ thống bao gồm ${both} đề phân tích thuận lợi & bất lợi và ${onlyAdv} đề chỉ phân tích thuận lợi.`;
  } else if (currentCategory.id === 2) {
    let cs = 0, ce = 0, es = 0, oc = 0, oe = 0, os = 0;
    currentCategory.topics.forEach(t => {
      const rawTag = (Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '')).trim();
      let firstTag = '';
      if (rawTag.includes(']')) {
        firstTag = rawTag.split(']')[0].trim() + ']';
      } else {
        firstTag = rawTag;
      }
      firstTag = firstTag.toLowerCase();
      
      if (firstTag === '[causes & solutions]' || firstTag === '[problems & solutions]' || (firstTag.includes('causes') && firstTag.includes('solutions'))) {
        cs++;
      } else if (firstTag === '[causes & effects]' || firstTag === '[causes & effects – on youth and society]' || (firstTag.includes('causes') && firstTag.includes('effects'))) {
        ce++;
      } else if (firstTag === '[effects & solutions]' || firstTag === '[impacts & solutions]') {
        es++;
      } else if (firstTag === '[causes]' || firstTag === '[factors]' || firstTag === '[causes / factors]' || firstTag === '[causes / reasons]') {
        oc++;
      } else if (firstTag === '[effects]' || firstTag === '[positive & negative effects]') {
        oe++;
      } else if (firstTag === '[measures]' || firstTag === '[solutions]' || firstTag === '[measures / solutions]') {
        os++;
      }
    });
    document.getElementById('category-description').innerText = `Trong dạng luận này, hệ thống bao gồm ${cs} đề phân tích nguyên nhân & giải pháp, ${ce} đề phân tích nguyên nhân & ảnh hưởng, ${es} đề phân tích ảnh hưởng & giải pháp, ${oc} đề chỉ phân tích nguyên nhân, ${oe} đề chỉ phân tích ảnh hưởng và ${os} đề chỉ phân tích giải pháp.`;
  } else if (currentCategory.id === 3) {
    const total = currentCategory.topics.length;
    let gEdu = 0, gTech = 0, gEnv = 0, gLife = 0;
    currentCategory.topics.forEach(t => {
      const g = getCategory3Group(t);
      if (g.includes('GIÁO DỤC')) gEdu++;
      else if (g.includes('CÔNG NGHỆ')) gTech++;
      else if (g.includes('MÔI TRƯỜNG')) gEnv++;
      else gLife++;
    });
    document.getElementById('category-description').innerText = `Trong dạng luận này, hệ thống bao gồm ${total} đề luyện tập viết luận bày tỏ quan điểm (Agree / Disagree), được chia thành 4 nhóm chuyên đề: ${gEdu} đề Giáo dục & Kỹ năng, ${gTech} đề Công nghệ & AI, ${gEnv} đề Môi trường & Xã hội, và ${gLife} đề Sức khỏe & Lối sống.`;
  } else if (currentCategory.id === 4) {
    document.getElementById('category-description').innerText = `Trong dạng luận này, hệ thống bao gồm ${currentCategory.topics.length} đề luyện tập bàn luận hai luồng quan điểm trái chiều và đưa ra ý kiến cá nhân.`;
  } else {
    document.getElementById('category-description').innerText = currentCategory.title + " (VSTEP Writing Task 2). Hệ thống cung cấp " + currentCategory.topics.length + " chủ đề mẫu thuộc nhóm này.";
  }
  document.getElementById('global-search-container').style.display = 'block';
  
  renderCategoryTopics();
  
  // Update screen visibility
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-category').classList.add('active');
  window.scrollTo(0, 0);
}

// --- Render Dashboard ---
function renderDashboard() {
  const container = document.getElementById('featured-topics-container');
  container.innerHTML = '';

  // Grab all topics that have full details (ideas and sample essays)
  const featuredTopics = [];
  ESSAY_DATA.forEach(cat => {
    cat.topics.forEach(t => {
      if (t.hidden) return;
      if (typeof isTopicAllowedForUser === 'function' && !isTopicAllowedForUser(cat.id, t.id, t)) return;
      if (t.has_full_details) {
        featuredTopics.push({
          catId: cat.id,
          catTitle: cat.title,
          catTitleVi: cat.title_vi,
          topic: t
        });
      }
    });
  });

  featuredTopics.forEach(item => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.onclick = () => startPractice(item.catId, item.topic.id);
    
    let tagClass = 'tag-adv';
    if (item.catId === 2) tagClass = 'tag-cause';
    if (item.catId === 3) tagClass = 'tag-opinion';
    if (item.catId === 4) tagClass = 'tag-discussion';
    
    const badgeText = item.topic.has_full_details ? '<span class="detail-badge">Đã cập nhật</span>' : '<span class="detail-badge" style="background: var(--panel-border); color: var(--text-secondary); border: 1px solid var(--panel-border)">Đang cập nhật</span>';
    
    card.innerHTML = `
      <div class="card-header">
        <span class="category-tag ${tagClass}">${getTopicSubtypeLabel(item.topic, item.catId)}</span>
        ${badgeText}
      </div>
      <div class="card-body">
        <h4>${item.topic.id}. ${item.topic.title_en}</h4>
        <p class="translation">${item.topic.title_vi}</p>
      </div>
      <div class="card-footer">
        <span>Đầy đủ: Dịch ý, Từ vựng, Bài mẫu</span>
        <div class="start-btn">
          Vào luyện tập
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </div>
    `;
    container.innerHTML += card.outerHTML;
  });
  
  renderRecentActivity();
}

// Render Recent Submissions on Dashboard Sidebar
function renderRecentActivity() {
  const list = document.getElementById('recent-activity-list');
  const history = getHistory();
  
  if (history.length === 0) {
    list.innerHTML = '<li class="empty-state">Chưa có bài viết nào được nộp</li>';
    return;
  }
  
  list.innerHTML = '';
  // Show last 3 submissions
  history.slice(0, 3).forEach(item => {
    const li = document.createElement('li');
    li.className = 'panel-list-item';
    li.innerHTML = `
      <span class="item-title" title="${item.topicTitle}">${item.topicTitle}</span>
      <span class="item-meta">${item.wordCount} từ</span>
      <span class="item-stat" style="display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25;">
        <span style="font-weight: 700;">${item.score} / 10</span>
        <span style="font-size: 0.72rem; color: #059669; font-weight: 600;">Quy đổi: ${((item.score * 7) / 10).toFixed(1)}/7.0</span>
      </span>
    `;
    list.appendChild(li);
  });
}

// --- Render Category View with Pagination ---
function renderCategoryTopics(searchQuery = '') {
  if (!currentCategory) return;
  
  // Calculate status filter counts for this category
  const allCategoryTopics = currentCategory.topics;
  let writtenCount = 0;
  allCategoryTopics.forEach(t => {
    if (isTopicWritten(currentCategory.id, t.id)) writtenCount++;
  });
  const unwrittenCount = allCategoryTopics.length - writtenCount;
  
  const elCountAll = document.getElementById('count-filter-all');
  const elCountWritten = document.getElementById('count-filter-written');
  const elCountUnwritten = document.getElementById('count-filter-unwritten');
  if (elCountAll) elCountAll.innerText = allCategoryTopics.length;
  if (elCountWritten) elCountWritten.innerText = writtenCount;
  if (elCountUnwritten) elCountUnwritten.innerText = unwrittenCount;

  const container = document.getElementById('topics-list-container');
  container.innerHTML = '';

  // Create Banner for updated topics
  const updatedTopics = currentCategory.topics.filter(t => t.has_full_details);
  if (updatedTopics.length > 0 && !searchQuery.trim()) {
    const banner = document.createElement('div');
    banner.className = 'updated-topics-banner';

    // Cute peeking doodle cat perched on the top-right border
    const peekCat = document.createElement('div');
    peekCat.className = 'banner-peeking-cat';
    peekCat.setAttribute('aria-hidden', 'true');
    peekCat.innerHTML = `
      <svg viewBox="0 0 110 56" width="84" height="43" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 46 C22 24, 30 14, 34 10 L40 22 C46 19, 64 19, 70 22 L76 10 C80 14, 88 24, 88 46" fill="#1e293b" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M35 16 L39 23 L32 23 Z" fill="#fda4af"/>
        <path d="M75 16 L71 23 L78 23 Z" fill="#fda4af"/>
        <circle class="cat-eye" cx="43" cy="34" r="4.6" fill="#ffffff"/>
        <circle class="cat-pupil" cx="43.8" cy="34" r="2.2" fill="#0f172a"/>
        <circle class="cat-eye" cx="67" cy="34" r="4.6" fill="#ffffff"/>
        <circle class="cat-pupil" cx="66.2" cy="34" r="2.2" fill="#0f172a"/>
        <path d="M52 38 Q55 41 58 38" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="55" cy="36.5" r="1.8" fill="#fda4af"/>
        <ellipse cx="26" cy="47" rx="8.5" ry="5.5" fill="#ffffff" stroke="#0f172a" stroke-width="2.8"/>
        <ellipse cx="84" cy="47" rx="8.5" ry="5.5" fill="#ffffff" stroke="#0f172a" stroke-width="2.8"/>
      </svg>
    `;
    banner.appendChild(peekCat);

    const writtenUpdatedCount = updatedTopics.filter(t => isTopicWritten(currentCategory.id, t.id)).length;
    const collapseKey = `updated_banner_collapsed_cat_${currentCategory.id}`;
    const isCollapsed = sessionStorage.getItem(collapseKey) === '1';
    if (isCollapsed) banner.classList.add('is-collapsed');

    // Header Row
    const headerRow = document.createElement('div');
    headerRow.className = 'updated-banner-header';
    headerRow.innerHTML = `
      <div class="updated-banner-title-wrap">
        <span class="updated-banner-flame">🔥</span>
        <h3>NHỮNG ĐỀ ĐÃ CẬP NHẬT</h3>
        <span class="updated-banner-count">${updatedTopics.length} đề</span>
      </div>
      <div class="updated-banner-actions">
        <span class="updated-banner-progress ${writtenUpdatedCount > 0 ? 'has-progress' : ''}">
          ✓ Đã viết: <strong>${writtenUpdatedCount}/${updatedTopics.length}</strong>
        </span>
        <button type="button" class="updated-banner-toggle" aria-expanded="${!isCollapsed}">
          <span class="toggle-label">${isCollapsed ? 'Mở rộng' : 'Thu gọn'}</span>
          <span class="toggle-chevron">${isCollapsed ? '▾' : '▴'}</span>
        </button>
      </div>
    `;
    banner.appendChild(headerRow);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'updated-banner-body';

    const toggleBtn = headerRow.querySelector('.updated-banner-toggle');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        const nowCollapsed = banner.classList.toggle('is-collapsed');
        sessionStorage.setItem(collapseKey, nowCollapsed ? '1' : '0');
        toggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
        toggleBtn.querySelector('.toggle-label').textContent = nowCollapsed ? 'Mở rộng' : 'Thu gọn';
        toggleBtn.querySelector('.toggle-chevron').textContent = nowCollapsed ? '▾' : '▴';
      };
    }

    // Build groups per category
    const groups = [];
    if (currentCategory.id === 1) {
      const isBenefitsOnly = (t) => {
        if (t.type === 'benefits_only') return true;
        const ideas = t.details && (t.details.ideas_b2 || t.details.ideas_b1);
        if (ideas && ideas.benefits && (!ideas.drawbacks || ideas.drawbacks.length === 0)) return true;
        const p = (t.prompt || '').toLowerCase();
        if ((p.includes('advantages of') || p.includes('benefits of') || p.includes('importance of')) && !p.includes('and disadvantages') && !p.includes('and drawbacks')) return true;
        return false;
      };
      groups.push(
        { id: 'cat1_both', name: 'PHÂN TÍCH THUẬN LỢI & BẤT LỢI', shortName: 'Thuận lợi & Bất lợi', icon: '📌', color: '#4f46e5', list: updatedTopics.filter(t => !isBenefitsOnly(t)) },
        { id: 'cat1_adv', name: 'CHỈ PHÂN TÍCH THUẬN LỢI', shortName: 'Chỉ Thuận lợi', icon: '✨', color: '#10b981', list: updatedTopics.filter(t => isBenefitsOnly(t)) }
      );
    } else if (currentCategory.id === 2) {
      const getCategory2Group = (t) => {
        const rawTag = (Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '')).trim();
        let firstTag = rawTag.includes(']') ? (rawTag.split(']')[0].trim() + ']').toLowerCase() : rawTag.toLowerCase();
        const tag = rawTag.toLowerCase();
        const prompt = (t.prompt || '').toLowerCase();

        if (firstTag === '[causes & solutions]' || firstTag === '[problems & solutions]') return 'PHÂN TÍCH NGUYÊN NHÂN & GIẢI PHÁP';
        if (firstTag === '[causes & effects]' || firstTag === '[causes & effects – on youth and society]') return 'PHÂN TÍCH NGUYÊN NHÂN & ẢNH HƯỞNG';
        if (firstTag === '[effects & solutions]' || firstTag === '[impacts & solutions]') return 'PHÂN TÍCH ẢNH HƯỞNG & GIẢI PHÁP';
        if (firstTag === '[causes]' || firstTag === '[factors]' || firstTag === '[causes / factors]' || firstTag === '[causes / reasons]') return 'PHÂN TÍCH NGUYÊN NHÂN';
        if (firstTag === '[effects]' || firstTag === '[positive & negative effects]') return 'PHÂN TÍCH ẢNH HƯỞNG';
        if (firstTag === '[measures]' || firstTag === '[solutions]' || firstTag === '[measures / solutions]') return 'PHÂN TÍCH GIẢI PHÁP';

        const ideasObj = t.details && (t.details.ideas_b2 || t.details.ideas_b1);
        if (ideasObj) {
          const keys = Object.keys(ideasObj);
          if (keys.includes('causes') && keys.includes('solutions')) return 'PHÂN TÍCH NGUYÊN NHÂN & GIẢI PHÁP';
          if (keys.includes('causes') && keys.includes('effects')) return 'PHÂN TÍCH NGUYÊN NHÂN & ẢNH HƯỞNG';
          if (keys.includes('effects') && keys.includes('solutions')) return 'PHÂN TÍCH ẢNH HƯỞNG & GIẢI PHÁP';
          if (keys.includes('causes') || keys.includes('factors') || keys.includes('reasons')) return 'PHÂN TÍCH NGUYÊN NHÂN';
          if (keys.includes('effects') || keys.includes('impacts')) return 'PHÂN TÍCH ẢNH HƯỞNG';
          if (keys.includes('solutions') || keys.includes('measures')) return 'PHÂN TÍCH GIẢI PHÁP';
        }

        if (tag.includes('causes & solutions') || (prompt.includes('causes') && (prompt.includes('solutions') || prompt.includes('measures') || prompt.includes('suggest')))) return 'PHÂN TÍCH NGUYÊN NHÂN & GIẢI PHÁP';
        if (tag.includes('causes & effects') || (prompt.includes('causes') && (prompt.includes('effects') || prompt.includes('consequences') || prompt.includes('impacts')))) return 'PHÂN TÍCH NGUYÊN NHÂN & ẢNH HƯỞNG';
        if (tag.includes('effects & solutions') || tag.includes('problems & solutions') || tag.includes('impacts & solutions') || ((prompt.includes('effects') || prompt.includes('problems') || prompt.includes('impacts')) && (prompt.includes('solutions') || prompt.includes('measures')))) return 'PHÂN TÍCH ẢNH HƯỞNG & GIẢI PHÁP';
        if (tag.includes('measures') || tag.includes('solutions') || prompt.includes('measures for') || prompt.includes('solutions to')) return 'PHÂN TÍCH GIẢI PHÁP';
        if (tag.includes('effects') || tag.includes('impacts') || prompt.includes('effects of') || prompt.includes('impacts of')) return 'PHÂN TÍCH ẢNH HƯỞNG';
        if (tag.includes('causes') || tag.includes('factors') || prompt.includes('reasons for') || prompt.includes('factors that') || prompt.includes('causes of')) return 'PHÂN TÍCH NGUYÊN NHÂN';
        return 'PHÂN TÍCH NGUYÊN NHÂN & GIẢI PHÁP';
      };

      const groupsConfig = [
        { id: 'c2_cs', name: 'PHÂN TÍCH NGUYÊN NHÂN & GIẢI PHÁP', shortName: 'Nguyên nhân & Giải pháp', icon: '📌', color: '#4f46e5' },
        { id: 'c2_ce', name: 'PHÂN TÍCH NGUYÊN NHÂN & ẢNH HƯỞNG', shortName: 'Nguyên nhân & Ảnh hưởng', icon: '⚡', color: '#8b5cf6' },
        { id: 'c2_es', name: 'PHÂN TÍCH ẢNH HƯỞNG & GIẢI PHÁP', shortName: 'Ảnh hưởng & Giải pháp', icon: '🛡️', color: '#ec4899' },
        { id: 'c2_c', name: 'PHÂN TÍCH NGUYÊN NHÂN', shortName: 'Nguyên nhân', icon: '🔍', color: '#d97706' },
        { id: 'c2_e', name: 'PHÂN TÍCH ẢNH HƯỞNG', shortName: 'Ảnh hưởng', icon: '💥', color: '#ef4444' },
        { id: 'c2_s', name: 'PHÂN TÍCH GIẢI PHÁP', shortName: 'Giải pháp', icon: '✨', color: '#10b981' }
      ];
      groupsConfig.forEach(cfg => {
        groups.push({ ...cfg, list: updatedTopics.filter(t => getCategory2Group(t) === cfg.name) });
      });
    } else if (currentCategory.id === 3) {
      const groupsConfig3 = [
        { id: 'c3_edu', name: 'GIÁO DỤC, HỌC ĐƯỜNG & PHÁT TRIỂN KỸ NĂNG', shortName: 'Giáo dục & Kỹ năng', icon: '🎓', color: '#4f46e5' },
        { id: 'c3_tech', name: 'CÔNG NGHỆ, MẠNG XÃ HỘI & TRÍ TUỆ NHÂN TẠO', shortName: 'Công nghệ & AI', icon: '💻', color: '#8b5cf6' },
        { id: 'c3_env', name: 'MÔI TRƯỜNG, GIAO THÔNG & TRÁCH NHIỆM XÃ HỘI', shortName: 'Môi trường & Xã hội', icon: '🌍', color: '#10b981' },
        { id: 'c3_life', name: 'SỨC KHỎE, VĂN HÓA & LỐI SỐNG HIỆN ĐẠI', shortName: 'Văn hóa & Đời sống', icon: '🥗', color: '#d97706' }
      ];
      groupsConfig3.forEach(cfg => {
        groups.push({ ...cfg, list: updatedTopics.filter(t => getCategory3Group(t) === cfg.name) });
      });
    } else {
      groups.push({ id: 'cat_all', name: 'DANH SÁCH ĐỀ ĐẦY ĐỦ 5 BƯỚC', shortName: 'Tất cả', icon: '📚', color: '#4f46e5', list: updatedTopics });
    }

    const activeGroups = groups.filter(g => g.list && g.list.length > 0);
    const activeTabKey = `updated_banner_tab_cat_${currentCategory.id}`;
    let selectedGroupId = sessionStorage.getItem(activeTabKey) || 'all';
    if (selectedGroupId !== 'all' && !activeGroups.some(g => g.id === selectedGroupId)) {
      selectedGroupId = 'all';
    }

    const createTopicPill = (topic, accentColor) => {
      const isAllowed = typeof isTopicAllowedForUser === 'function' ? isTopicAllowedForUser(currentCategory.id, topic.id, topic) : true;
      const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
      const isWritten = isTopicWritten(currentCategory.id, topic.id);
      const pill = document.createElement('div');
      pill.className = 'updated-topic-pill' + (isWritten ? ' is-completed' : '') + (!isAllowed ? ' is-locked' : '');
      pill.style.setProperty('--pill-accent', accentColor || '#4f46e5');
      pill.setAttribute('title', !isAllowed
        ? `Đề bài này tạm thời chưa mở cho lớp ${userClass}`
        : `Đề ${topic.id}: ${topic.title_vi}`);
      pill.onclick = () => startPractice(currentCategory.id, topic.id);

      const numLabel = String(topic.id).padStart(2, '0');
      const apprBadge = (currentCategory.id === 3 && topic.approaches && topic.approaches.length > 0)
        ? `<span class="pill-appr-badge">${topic.approaches.length} hướng</span>`
        : '';
      const statusHtml = !isAllowed
        ? `<span class="pill-status-lock">Khoá</span>`
        : (isWritten
            ? `<span class="pill-status-done">✓ Đã viết</span>`
            : `<span class="pill-arrow">›</span>`);

      pill.innerHTML = `
        <span class="pill-num">${!isAllowed ? '🔒' : (isWritten ? '✓' : numLabel)}</span>
        <span class="item-text">${topic.title_vi}</span>
        <span class="pill-right">${apprBadge}${statusHtml}</span>
      `;
      return pill;
    };

    const groupsHost = document.createElement('div');
    groupsHost.className = 'updated-groups-host';

    const renderGroupsContent = () => {
      groupsHost.innerHTML = '';
      const toRender = selectedGroupId === 'all' ? activeGroups : activeGroups.filter(g => g.id === selectedGroupId);
      toRender.forEach(cfg => {
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'updated-group-section';
        groupWrapper.style.setProperty('--grp-accent', cfg.color);

        if (activeGroups.length > 1) {
          const groupHeader = document.createElement('div');
          groupHeader.className = 'updated-group-header';
          groupHeader.innerHTML = `
            <span class="updated-group-icon">${cfg.icon}</span>
            <span class="updated-group-name">${cfg.name}</span>
            <span class="updated-group-count">${cfg.list.length}</span>
            <span class="updated-group-line"></span>
          `;
          groupWrapper.appendChild(groupHeader);
        }

        const groupGrid = document.createElement('div');
        groupGrid.className = 'updated-topics-grid';
        cfg.list.forEach(topic => groupGrid.appendChild(createTopicPill(topic, cfg.color)));
        groupWrapper.appendChild(groupGrid);
        groupsHost.appendChild(groupWrapper);
      });
    };

    // Subtype Filter Tabs (only when there are 2+ groups)
    if (activeGroups.length > 1) {
      const tabsBar = document.createElement('div');
      tabsBar.className = 'updated-filter-tabs';

      const makeTab = (id, icon, label, count, color) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'updated-filter-tab' + (selectedGroupId === id ? ' is-active' : '');
        btn.style.setProperty('--tab-accent', color);
        btn.innerHTML = `
          ${icon ? `<span class="tab-icon">${icon}</span>` : ''}
          <span class="tab-label">${label}</span>
          <span class="tab-count">${count}</span>
        `;
        btn.onclick = () => {
          selectedGroupId = id;
          sessionStorage.setItem(activeTabKey, id);
          tabsBar.querySelectorAll('.updated-filter-tab').forEach(el => el.classList.remove('is-active'));
          btn.classList.add('is-active');
          renderGroupsContent();
        };
        return btn;
      };

      tabsBar.appendChild(makeTab('all', '✨', 'Tất cả', updatedTopics.length, '#4f46e5'));
      activeGroups.forEach(cfg => {
        tabsBar.appendChild(makeTab(cfg.id, cfg.icon, cfg.shortName || cfg.name, cfg.list.length, cfg.color));
      });
      bodyWrap.appendChild(tabsBar);
    }

    renderGroupsContent();
    bodyWrap.appendChild(groupsHost);
    banner.appendChild(bodyWrap);
    container.appendChild(banner);
  }

  
  let topics = currentCategory.topics;
  
  // Apply Written/Unwritten Status Filter
  if (currentTopicStatusFilter === 'written') {
    topics = topics.filter(t => isTopicWritten(currentCategory.id, t.id));
  } else if (currentTopicStatusFilter === 'unwritten') {
    topics = topics.filter(t => !isTopicWritten(currentCategory.id, t.id));
  }
  
  // Filter by search query if present
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    topics = topics.filter(t => 
      t.title_en.toLowerCase().includes(q) || 
      t.title_vi.toLowerCase().includes(q) ||
      (t.context && t.context.toLowerCase().includes(q))
    );
  }
  
  if (topics.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: span 3; padding: 4rem;">Không tìm thấy chủ đề nào khớp với từ khóa "${searchQuery}"</div>`;
    document.getElementById('topics-pagination').innerHTML = '';
    return;
  }
  
  // Paginate
  const totalPages = Math.ceil(topics.length / itemsPerPage);
  if (currentPage > totalPages) currentPage = totalPages || 1;
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, topics.length);
  const pageItems = topics.slice(startIndex, endIndex);
  
  let tagClass = 'tag-adv';
  if (currentCategory.id === 2) tagClass = 'tag-cause';
  if (currentCategory.id === 3) tagClass = 'tag-opinion';
  if (currentCategory.id === 4) tagClass = 'tag-discussion';
  
  pageItems.forEach(topic => {
    const isAllowed = typeof isTopicAllowedForUser === 'function' ? isTopicAllowedForUser(currentCategory.id, topic.id, topic) : true;
    const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
    const isWritten = isTopicWritten(currentCategory.id, topic.id);
    const subInfo = getTopicSubmissionInfo(currentCategory.id, topic.id);
    const scoreText = subInfo && typeof subInfo.score === 'number' ? ` (${subInfo.score.toFixed(1)}đ)` : '';
    
    const card = document.createElement('div');
    card.className = 'topic-card' + (isWritten ? ' is-completed' : '') + (!isAllowed ? ' is-locked' : '');
    card.onclick = () => startPractice(currentCategory.id, topic.id);
    if (!isAllowed) {
      card.style.opacity = '0.65';
      card.setAttribute('title', `Đề bài này tạm thời chưa mở cho lớp ${userClass}`);
    }
    
    let badgeText = topic.has_full_details ? '<span class="detail-badge">Đã cập nhật</span>' : '<span class="detail-badge" style="background: var(--panel-border); color: var(--text-secondary); border: 1px solid var(--panel-border)">Đang cập nhật</span>';
    if (!isAllowed) {
      badgeText = '<span class="detail-badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3)">🔒 Khoá</span>';
    } else if (typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser('write', currentCategory.id, topic.id, topic)) {
      badgeText += '<span class="detail-badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; margin-left: 0.35rem;">Mở Bước 1-3</span>';
    }

    const stickBtn = `
      <button class="topic-stick-btn ${isWritten ? 'completed' : 'uncompleted'}" 
              onclick="toggleTopicStick(${currentCategory.id}, ${topic.id}, event)"
              title="${isWritten ? 'Nhấp để bỏ đánh dấu Đã viết' : 'Nhấp để đánh dấu Đã viết'}">
        ${isWritten ? `✓ ĐÃ VIẾT${scoreText}` : `○ Chưa viết`}
      </button>
    `;
    
    card.innerHTML = `
      <div class="card-header">
        <span class="category-tag ${tagClass}">${getTopicSubtypeLabel(topic, currentCategory.id)}</span>
        <div style="display: flex; align-items: center; gap: 0.45rem;">
          ${stickBtn}
          ${badgeText}
        </div>
      </div>
      <div class="card-body">
        <h4>${topic.id}. ${topic.title_en}</h4>
        <p class="translation">${topic.title_vi}</p>
      </div>
      <div class="card-footer">
        <span>VSTEP Task 2</span>
        <div class="start-btn" style="${!isAllowed ? 'background: #64748b; color: white;' : (isWritten ? 'background: #10b981; color: white;' : '')}">
          ${isAllowed ? (isWritten ? 'Luyện lại' : 'Luyện tập') : '🔒 Chưa mở'}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
  
  renderPagination(totalPages);
}

// Render Pagination Buttons
function renderPagination(totalPages) {
  const container = document.getElementById('topics-pagination');
  container.innerHTML = '';
  
  if (totalPages <= 1) return;
  
  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerText = '‹ Trước';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => {
    currentPage--;
    renderCategoryTopics(document.getElementById('search-input-field').value);
  };
  container.appendChild(prevBtn);
  
  // Page number buttons
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
    pageBtn.innerText = i;
    pageBtn.onclick = () => {
      currentPage = i;
      renderCategoryTopics(document.getElementById('search-input-field').value);
    };
    container.appendChild(pageBtn);
  }
  
  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerText = 'Sau ›';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => {
    currentPage++;
    renderCategoryTopics(document.getElementById('search-input-field').value);
  };
  container.appendChild(nextBtn);
}

// Global search function
function handleSearch(val) {
  if (currentScreen === 'dashboard') {
    const query = val.toLowerCase().trim();
    document.querySelectorAll('#featured-topics-container .topic-card').forEach(card => {
      const text = card.innerText.toLowerCase();
      if (text.includes(query)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  } else if (currentScreen === 'category') {
    currentPage = 1;
    renderCategoryTopics(val);
  }
}

// --- Practice Workspace Logic ---
function startPractice(catId, topicId) {
  if (isCurrentStudentLocked()) {
    showAccountLockedModal('tab_switch');
    return;
  }
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';
  if (typeof isCategoryAllowedForUser === 'function' && !isCategoryAllowedForUser(catId)) {
    if (userClass === 'B212') {
      showToast('🔒 Dạng luận này tạm thời chưa mở cho lớp B212. Hiện tại lớp mở tất cả các đề thuộc DẠNG LUẬN 01!', 'warning');
    } else if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
      showToast(`🔒 Đề bài thuộc Dạng luận chưa mở cho lớp ${userClass}. Hiện tại lớp đã mở DẠNG LUẬN 01 & DẠNG LUẬN 02!`, 'warning');
    } else if (userClass === 'CB210') {
      showToast('🔒 Đề bài thuộc Dạng luận chưa mở cho lớp CB210. Lớp hiện mở Dạng 1, 2 và 3!', 'warning');
    } else {
      showToast('🔒 Đề bài thuộc Dạng luận tạm thời chưa mở!', 'warning');
    }
    return;
  }

  const category = ESSAY_DATA.find(cat => cat.id === catId);
  if (!category) return;
  
  const topic = category.topics.find(t => t.id === topicId);
  if (!topic) return;

  if (typeof isTopicAllowedForUser === 'function' && !isTopicAllowedForUser(catId, topicId, topic)) {
    if (userClass === 'B212') {
      showToast('🔒 Đề bài này tạm thời chưa mở cho lớp B212. Lớp hiện mở tất cả các đề thuộc DẠNG LUẬN 01!', 'warning');
    } else if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
      showToast(`🔒 Đề bài này tạm thời chưa mở cho lớp ${userClass}. Hiện tại Dạng 02 mở các đề phân tích "Nguyên nhân & Giải pháp", "Nguyên nhân & Ảnh hưởng" cùng Đề 16 & 28 (đủ 5 bước)!`, 'warning');
    } else {
      showToast(`🔒 Đề bài này tạm thời chưa mở cho lớp ${userClass}!`, 'warning');
    }
    return;
  }
  
  currentCategory = category;
  currentTopic = topic;
  recordTopicVisit(category, topic);
  if (typeof resetTopicStepTracking === 'function') resetTopicStepTracking();
  currentApproachIndex = 0;
  if (topic.approaches && topic.approaches.length > 0) {
    topic.details = topic.approaches[0].details;
    if (topic.approaches[0].tags) topic.tags = topic.approaches[0].tags;
    if (topic.approaches[0].paraphrases) topic.paraphrases = topic.approaches[0].paraphrases;
  }
  const siteLevel = (typeof currentVocabLevel !== 'undefined' && currentVocabLevel === 'B1') ? 'B1' : 'B2';
  currentOutlineLevel = siteLevel;
  currentTransLevel = siteLevel;
  currentVocabLevel = siteLevel;
  currentSampleLevel = siteLevel;
  
  // Switch to Workspace view state
  switchScreen('workspace');
  
  // Reset UI View State (remove submitted class)
  document.getElementById('workspace-layout-container').classList.remove('submitted');
  
  // Setup Workspace Headers
  document.getElementById('workspace-topic-title').innerText = topic.title_en;
  document.getElementById('workspace-topic-category').innerText = category.title_vi;
  
  const badge = document.getElementById('workspace-enrichment-badge');
  if (topic.has_full_details) {
    badge.innerText = 'Đã cập nhật';
    badge.style.background = 'var(--accent-gradient)';
  } else {
    badge.innerText = 'Đang cập nhật';
    badge.style.background = 'var(--panel-border)';
    badge.style.color = 'var(--text-secondary)';
    badge.style.border = '1px solid var(--panel-border)';
  }

  // Update stick badge in workspace header
  updateWorkspaceStickBadge();
  
  // Populate Left Resource Pane if elements exist (Optional reference)
  const wsPromptEn = document.getElementById('ws-prompt-en');
  if (wsPromptEn) {
    let ctx = topic.context;
    let prm = topic.prompt;
    if (!prm && topic.subtopics && topic.subtopics.length > 0) {
      ctx = topic.subtopics[0].context || '';
      prm = topic.subtopics[0].prompt || '';
    }
    wsPromptEn.innerText = ctx ? `${ctx}\n\n${prm}` : (prm || '');
  }
  const wsPromptVi = document.getElementById('ws-prompt-vi');
  if (wsPromptVi) {
    wsPromptVi.innerHTML = getPromptTranslation(topic, category);
  }
  
  // Populate Paraphrases if present and element exists
  const paraphraseContainer = document.getElementById('ws-paraphrase-container');
  const paraphraseList = document.getElementById('ws-paraphrase-list');
  if (paraphraseContainer && paraphraseList) {
    paraphraseList.innerHTML = '';
    if (topic.paraphrases && topic.paraphrases.length > 0) {
      paraphraseContainer.style.display = 'block';
      topic.paraphrases.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p;
        paraphraseList.appendChild(li);
      });
    } else {
      paraphraseContainer.style.display = 'none';
    }
  }
  
  // Populate Vocabulary Flashcards if element exists
  const vocabList = document.getElementById('ws-vocab-list');
  if (vocabList) {
    vocabList.innerHTML = '';
    if (topic.has_full_details && topic.details && topic.details.vocab && topic.details.vocab.length > 0) {
      topic.details.vocab.forEach(v => {
        const card = document.createElement('div');
        card.className = 'flashcard-wrapper';
        card.onclick = () => card.classList.toggle('flipped');
        card.innerHTML = `
          <div class="flashcard">
            <div class="flashcard-front">
              <span class="vocab-word">${v.en}</span>
              <span class="vocab-type">Collocation</span>
            </div>
            <div class="flashcard-back">
              <span class="vocab-translation">${v.vi}</span>
              <span class="vocab-hint">Chạm để đóng</span>
            </div>
          </div>
        `;
        vocabList.appendChild(card);
      });
    } else {
      vocabList.innerHTML = `
        <div class="empty-state">
          Chủ đề này viết tự do, không có danh sách từ vựng gợi ý sẵn.
        </div>
      `;
    }
  }
  
  // Populate Outlines accordion data if elements exist
  renderOutline();
  renderVietnameseOutline();
  
  // Load full essay draft if exists (per student)
  const draftKey = getStudentDraftKey(catId, topicId);
  const savedDraft = localStorage.getItem(draftKey);
  const textarea = document.getElementById('essay-textarea');
  if (savedDraft) {
    textarea.value = savedDraft;
  } else {
    textarea.value = '';
  }
  
  updateWordCount();
  
  // Reset Timer state
  resetTimer();
  
  // Reset VSTEP evaluation state
  hasSubmitted = false;
  cheatViolationCount = 0;
  cheatTabSwitchCount = 0;
  cheatPasteCount = 0;
  currentEvaluationData = null;
  document.getElementById('step3-editor-view').style.display = 'flex';
  document.getElementById('step3-evaluation-view').style.display = 'none';
  
  // Set translation level selectors safely
  const transB1 = document.getElementById('ws-trans-level-b1');
  const transB2 = document.getElementById('ws-trans-level-b2');
  if (transB1) transB1.classList.remove('active');
  if (transB2) transB2.classList.add('active');
  
  // Set model essay level selectors safely
  const modelB1 = document.getElementById('ws-model-level-b1');
  const modelB2 = document.getElementById('ws-model-level-b2');
  if (modelB1) modelB1.classList.remove('active');
  if (modelB2) modelB2.classList.add('active');
  currentSampleLevel = 'B2';
  
  // Render approach switcher if topic has multiple approaches
  renderWorkspaceApproachSwitcher();

  // Render workspace step tabs dynamically based on topic features
  renderWorkspaceStepHeader();

  // Switch to Step 1 (Reading & Analysis) by default
  switchStep('read');
}

// --- WORKSPACE MULTI-APPROACH LOGIC ---
let currentApproachIndex = 0;

function renderWorkspaceApproachSwitcher() {
  const container = document.getElementById('workspace-approach-switcher');
  if (!container) return;
  
  if (!currentTopic || !currentTopic.approaches || currentTopic.approaches.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  
  const isOpinion = currentCategory && currentCategory.id === 3;
  const switcherLabel = isOpinion ? "QUAN ĐIỂM BÀI VIẾT (YOUR STANCE):" : "HƯỚNG BÀI VIẾT:";

  container.style.display = 'flex';
  container.innerHTML = `
    <span class="approach-switcher-label">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
      </svg>
      ${switcherLabel}
    </span>
    <div class="approach-pills-list">
      ${currentTopic.approaches.map((appr, idx) => {
        const isAgree = appr.stance === 'agree' || (appr.name && appr.name.includes('ĐỒNG Ý') && !appr.name.includes('KHÔNG ĐỒNG Ý'));
        const isDisagree = appr.stance === 'disagree' || (appr.name && appr.name.includes('KHÔNG ĐỒNG Ý'));
        const stanceClass = isAgree ? 'stance-agree' : (isDisagree ? 'stance-disagree' : '');
        const stanceIcon = isAgree ? '👍 ' : (isDisagree ? '👎 ' : '');
        return `
          <button class="approach-pill-btn ${idx === currentApproachIndex ? 'active' : ''} ${stanceClass}" onclick="switchTopicApproach(${idx})">
            ${stanceIcon}${appr.name}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function switchTopicApproach(index) {
  if (!currentTopic || !currentTopic.approaches || !currentTopic.approaches[index]) return;
  currentApproachIndex = index;
  
  const chosen = currentTopic.approaches[index];
  currentTopic.details = chosen.details;
  if (chosen.tags) currentTopic.tags = chosen.tags;
  if (chosen.paraphrases) currentTopic.paraphrases = chosen.paraphrases;
  
  // Update left pane flashcards if present
  const vocabList = document.getElementById('ws-vocab-list');
  if (vocabList && currentTopic.details && currentTopic.details.vocab && currentTopic.details.vocab.length > 0) {
    vocabList.innerHTML = '';
    currentTopic.details.vocab.forEach(v => {
      const card = document.createElement('div');
      card.className = 'flashcard-wrapper';
      card.onclick = () => card.classList.toggle('flipped');
      card.innerHTML = `
        <div class="flashcard">
          <div class="flashcard-front">
            <span class="vocab-word">${v.en}</span>
            <span class="vocab-type">Collocation</span>
          </div>
          <div class="flashcard-back">
            <span class="vocab-translation">${v.vi}</span>
            <span class="vocab-hint">Chạm để đóng</span>
          </div>
        </div>
      `;
      vocabList.appendChild(card);
    });
  }

  // Re-render UI components
  renderWorkspaceApproachSwitcher();
  renderWorkspaceStepHeader();
  
  // Re-render active views
  renderStep1Reading();
  if (hasVocabStep()) renderStepVocab();
  renderTranslationExercises();
  renderOutline();
  renderVietnameseOutline();
  renderStep4ModelEssay();
}

function renderModelEssay() {
  renderStep4ModelEssay();
}

// --- WORKSPACE PRACTICE WORKFLOW CONTROLS ---

function hasVocabStep() {
  return !!(currentTopic && currentTopic.details && currentTopic.details.vocab_step);
}

function renderWorkspaceStepHeader() {
  const container = document.getElementById('workspace-step-header-tabs');
  if (!container) return;
  
  const activeKey = currentStepKey || 'read';
  const withVocab = hasVocabStep();
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const catId = currentCategory ? currentCategory.id : 0;
  const topicId = currentTopic ? currentTopic.id : 0;

  const isWriteClassLocked = typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser('write', catId, topicId, currentTopic);
  const isModelClassLocked = typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser('model', catId, topicId, currentTopic);

  const writeGate = (!isWriteClassLocked && typeof getSequentialStepGate === 'function')
    ? getSequentialStepGate('write', catId, topicId, currentTopic)
    : { allowed: !isWriteClassLocked };
  const modelGate = (!isModelClassLocked && typeof getSequentialStepGate === 'function')
    ? getSequentialStepGate('model', catId, topicId, currentTopic)
    : { allowed: !isModelClassLocked };

  const isWriteLocked = isWriteClassLocked || !writeGate.allowed;
  const isModelLocked = isModelClassLocked || !modelGate.allowed;

  const writeLockTag = isWriteClassLocked
    ? '(Khoá)'
    : (!writeGate.allowed ? (writeGate.shortLabel || '(Xong B1-3)') : '');
  const modelLockTag = isModelClassLocked
    ? '(Khoá)'
    : (!modelGate.allowed ? (modelGate.shortLabel || '(Nộp B4)') : '');

  const writeTitle = isWriteClassLocked
    ? `Bước 04 tạm thời chưa mở cho lớp ${userClass}`
    : (!writeGate.allowed ? `Cần hoàn thành Bước 01–02–03 trước khi viết bài` : '');
  const modelTitle = isModelClassLocked
    ? `Bước 05 tạm thời chưa mở cho lớp ${userClass}`
    : (!modelGate.allowed ? `Cần nộp bài viết ở Bước 04 trước khi xem bài mẫu` : '');

  if (withVocab) {
    container.innerHTML = `
      <div class="step-tab ${activeKey === 'read' ? 'active' : ''}" id="ws-tab-read" onclick="switchStep('read')">
        <span class="step-num">1</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 01</span>
          <span class="step-title">ĐỌC HIỂU ĐỀ</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'vocab' ? 'active' : ''}" id="ws-tab-vocab" onclick="switchStep('vocab')">
        <span class="step-num">2</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 02</span>
          <span class="step-title">NẠP TỪ VỰNG</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'trans' ? 'active' : ''}" id="ws-tab-trans" onclick="switchStep('trans')">
        <span class="step-num">3</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 03</span>
          <span class="step-title">TẬP DIỄN ĐẠT Ý TƯỞNG</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'write' ? 'active' : ''} ${isWriteLocked ? 'is-locked' : ''}" id="ws-tab-write" onclick="switchStep('write')" style="${isWriteLocked ? 'opacity: 0.65; cursor: not-allowed;' : ''}" title="${writeTitle}">
        <span class="step-num">${isWriteLocked ? '🔒' : '4'}</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 04</span>
          <span class="step-title">VIẾT BÀI LUẬN ${isWriteLocked ? `<span style="font-size:0.7rem; color:#ef4444; font-weight:700;">${writeLockTag}</span>` : ''}</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'model' ? 'active' : ''} ${isModelLocked ? 'is-locked' : ''}" id="ws-tab-model" onclick="switchStep('model')" style="${isModelLocked ? 'opacity: 0.65; cursor: not-allowed;' : ''}" title="${modelTitle}">
        <span class="step-num">${isModelLocked ? '🔒' : '5'}</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 05</span>
          <span class="step-title">THAM KHẢO BÀI MẪU ${isModelLocked ? `<span style="font-size:0.7rem; color:#ef4444; font-weight:700;">${modelLockTag}</span>` : ''}</span>
        </span>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="step-tab ${activeKey === 'read' ? 'active' : ''}" id="ws-tab-read" onclick="switchStep('read')">
        <span class="step-num">1</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 01</span>
          <span class="step-title">ĐỌC HIỂU ĐỀ</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'trans' ? 'active' : ''}" id="ws-tab-trans" onclick="switchStep('trans')">
        <span class="step-num">2</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 02</span>
          <span class="step-title">TẬP DIỄN ĐẠT Ý TƯỞNG</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'write' ? 'active' : ''} ${isWriteLocked ? 'is-locked' : ''}" id="ws-tab-write" onclick="switchStep('write')" style="${isWriteLocked ? 'opacity: 0.65; cursor: not-allowed;' : ''}" title="${writeTitle}">
        <span class="step-num">${isWriteLocked ? '🔒' : '3'}</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 03</span>
          <span class="step-title">VIẾT BÀI LUẬN ${isWriteLocked ? `<span style="font-size:0.7rem; color:#ef4444; font-weight:700;">${writeLockTag}</span>` : ''}</span>
        </span>
      </div>
      <div class="step-tab ${activeKey === 'model' ? 'active' : ''} ${isModelLocked ? 'is-locked' : ''}" id="ws-tab-model" onclick="switchStep('model')" style="${isModelLocked ? 'opacity: 0.65; cursor: not-allowed;' : ''}" title="${modelTitle}">
        <span class="step-num">${isModelLocked ? '🔒' : '4'}</span>
        <span class="step-label">
          <span class="step-kicker">BƯỚC 04</span>
          <span class="step-title">THAM KHẢO BÀI LUẬN MẪU ${isModelLocked ? `<span style="font-size:0.7rem; color:#ef4444; font-weight:700;">${modelLockTag}</span>` : ''}</span>
        </span>
      </div>
    `;
  }
}

let currentStepKey = 'read';

// Switch between workspace steps (supports both step numbers and step keys)
function switchStep(stepTarget, options) {
  if (isCurrentStudentLocked()) {
    showAccountLockedModal('tab_switch');
    return;
  }
  if (!currentTopic) return;
  const withVocab = hasVocabStep();
  
  let targetKey = 'read';
  if (typeof stepTarget === 'number') {
    if (withVocab) {
      if (stepTarget === 1) targetKey = 'read';
      else if (stepTarget === 2) targetKey = 'vocab';
      else if (stepTarget === 3) targetKey = 'trans';
      else if (stepTarget === 4) targetKey = 'write';
      else if (stepTarget === 5) targetKey = 'model';
    } else {
      if (stepTarget === 1) targetKey = 'read';
      else if (stepTarget === 2) targetKey = 'trans';
      else if (stepTarget === 3) targetKey = 'write';
      else if (stepTarget === 4) targetKey = 'model';
      else if (stepTarget === 5) targetKey = 'model';
    }
  } else if (typeof stepTarget === 'string') {
    targetKey = stepTarget;
  }
  
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const catId = currentCategory ? currentCategory.id : 0;
  const topicId = currentTopic ? currentTopic.id : 0;
  if (typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser(targetKey, catId, topicId, currentTopic)) {
    showToast(`🔒 Bước 04 (Viết bài luận) và Bước 05 (Bài mẫu) tạm thời chưa mở cho lớp ${userClass} ở đề này! Vui lòng hoàn thành 3 bước đầu của đề.`, 'warning');
    return;
  }

  // Step 4 Pre-Write Confirmation Gate ("Bạn đã hoàn thành BƯỚC 1, 2, 3 chưa?" + real history verification)
  const skipConfirm = Boolean(options && options.skipStep4Confirm);
  const currentUserName = sessionStorage.getItem('current_user_name') || '';
  const isTeacherUser = (
    userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' ||
    (typeof checkIsTeacher === 'function' && checkIsTeacher(currentUserName, userClass, ''))
  );
  if (targetKey === 'write' && !skipConfirm && !isTeacherUser && !hasSubmitted && currentStepKey !== 'write') {
    openStep4ConfirmModal();
    return;
  }

  // Strict Sequential Step Gate: must finish Steps 1-2-3 before Step 4, and must submit Step 4 before Step 5
  if (typeof getSequentialStepGate === 'function') {
    const seqGate = getSequentialStepGate(targetKey, catId, topicId, currentTopic);
    if (!seqGate.allowed) {
      const detail = (seqGate.missing && seqGate.missing.length > 0)
        ? seqGate.missing.join(' • ')
        : 'Vui lòng hoàn thành đầy đủ các bước trước đó.';
      showToast(`🔒 Chưa mở bước này! ${detail}`, 'warning');
      return;
    }
  }
  
  // Anti-cheat Exam Lock: prevent leaving 'write' step during active exam without explicit exit confirmation
  if (isExamModeActive() && targetKey !== 'write') {
    isPromptingUser = true;
    const confirmLeave = confirm("⚠️ PHÒNG THI ĐANG KHÓA CHẾ ĐỘ TẬP TRUNG:\n\nBạn không thể chuyển tab khi đang làm bài thi viết luận.\nBạn có muốn THOÁT PHÒNG THI hoàn toàn để quay lại xem tài liệu không?\n(Bài viết của bạn sẽ được tự động lưu lại vào Bản nháp)");
    setTimeout(() => { isPromptingUser = false; }, 500);
    if (!confirmLeave) return;
    saveProgressAction(true);
    stopTimer();
  }

  if (typeof currentStepKey !== 'undefined' && currentStepKey === 'trans' && targetKey !== 'trans') {
    reportTranslationProgressIfAny();
  }

  currentStepKey = targetKey;
  
  // Update wizard tabs active & exam-locked state
  const stepTabs = document.querySelectorAll('#workspace-step-header-tabs .step-tab');
  stepTabs.forEach(tab => {
    tab.classList.remove('active');
    if (targetKey === 'write' && !hasSubmitted) {
      if (tab.id !== 'ws-tab-write') {
        tab.classList.add('exam-locked');
        tab.title = 'Phòng thi đang khóa: bấm để xác nhận thoát hoàn toàn';
      } else {
        tab.classList.remove('exam-locked');
      }
    } else {
      tab.classList.remove('exam-locked');
      tab.title = '';
    }
  });
  renderWorkspaceStepHeader();
  const activeTabId = (targetKey === 'vocab' && !withVocab) ? 'ws-tab-trans' : `ws-tab-${targetKey}`;
  const activeTab = document.getElementById(activeTabId);
  if (activeTab) activeTab.classList.add('active');
  
  // Containers
  const cRead = document.getElementById('workspace-step1-container');
  const cVocab = document.getElementById('workspace-vocab-container');
  const cTrans = document.getElementById('workspace-step2-container');
  const cWrite = document.getElementById('workspace-step3-container');
  const cModel = document.getElementById('workspace-step4-container');
  
  if (cRead) { cRead.classList.remove('active'); cRead.style.display = 'none'; }
  if (cVocab) { cVocab.classList.remove('active'); cVocab.style.display = 'none'; }
  if (cTrans) { cTrans.classList.remove('active'); cTrans.style.display = 'none'; }
  if (cWrite) { cWrite.classList.remove('active'); cWrite.style.display = 'none'; }
  if (cModel) { cModel.classList.remove('active'); cModel.style.display = 'none'; }
  
  if (targetKey === 'read') {
    if (cRead) { cRead.classList.add('active'); cRead.style.display = 'block'; }
    renderStep1Reading();
  } else if (targetKey === 'vocab') {
    if (cVocab) { cVocab.classList.add('active'); cVocab.style.display = 'block'; }
    renderStepVocab();
  } else if (targetKey === 'trans') {
    if (cTrans) { cTrans.classList.add('active'); cTrans.style.display = 'block'; }
    renderTranslationExercises();
  } else if (targetKey === 'write') {
    if (cWrite) { cWrite.classList.add('active'); cWrite.style.display = 'block'; }
    if (hasSubmitted) {
      document.getElementById('step3-editor-view').style.display = 'none';
      document.getElementById('step3-evaluation-view').style.display = 'flex';
      stopTimer();
    } else {
      document.getElementById('step3-editor-view').style.display = 'flex';
      document.getElementById('step3-evaluation-view').style.display = 'none';
      startTimer();
      document.getElementById('essay-textarea').focus();
      const isTeacher = (typeof checkIsTeacher === 'function' && checkIsTeacher(sessionStorage.getItem('current_user_name') || '', sessionStorage.getItem('current_user_class') || '', ''));
      if (!isTeacher) {
        showToast("🔒 PHÒNG THI ĐÃ KHÓA: Chế độ tập trung cao độ, không chuyển tab hoặc thoát cửa sổ!", "warning");
      }
    }
  } else if (targetKey === 'model') {
    if (cModel) { cModel.classList.add('active'); cModel.style.display = 'block'; }
    renderStep4ModelEssay();
  }
  
  if (targetKey !== 'write') {
    stopTimer();
  }
}

// Vocabulary Booster Step Logic
let currentVocabFilter = 'all';
let currentVocabSearch = '';

function filterVocabCategory(catId) {
  currentVocabFilter = catId;
  renderStepVocab();
}

function switchVocabLevel(level) {
  currentVocabLevel = level;
  currentVocabFilter = 'all';
  renderStepVocab();
}

function handleVocabSearch(query) {
  currentVocabSearch = (query || '').trim().toLowerCase();
  renderStepVocab();
}

function formatCollocationType(type) {
  if (!type) return '';
  const t = type.toLowerCase().trim();
  if (t === 'v.phr' || t.includes('verb') || t.startsWith('v ') || t.startsWith('v+')) return 'v.phr';
  if (t === 'adj.phr' || t.startsWith('adj')) return 'adj.phr';
  if (t === 'n.phr' || t.includes('noun') || t.includes('cụm n') || t.includes('chuỗi n')) return 'n.phr';
  if (t === 'clause' || t.includes('sentence') || t.includes('clause') || t.includes('mệnh đề')) return 'clause';
  return type;
}

function renderStepVocab() {
  const container = document.getElementById('ws-vocab-step-content');
  if (!container) return;
  const topic = currentTopic;
  if (!topic || !topic.details) {
    container.innerHTML = '<div class="empty-state">Chủ đề này chưa có dữ liệu Nạp từ vựng.</div>';
    return;
  }

  // Gracefully handle legacy vocab schema if modern vocab_step is not present
  if (!topic.details.vocab_step) {
    if (topic.details.vocab && topic.details.vocab.length > 0) {
      const vList = topic.details.vocab;
      const filterQuery = (currentVocabSearch || '').trim().toLowerCase();
      const filteredVocab = vList.filter(item => {
        if (!filterQuery) return true;
        return (item.en && item.en.toLowerCase().includes(filterQuery)) || (item.vi && item.vi.toLowerCase().includes(filterQuery));
      });

      container.innerHTML = `
        <div class="vocab-hero-banner">
          <span class="vocab-hero-badge">PHÒNG LUYỆN VIẾT VSTEP • BƯỚC 02: NẠP TỪ VỰNG CHỦ ĐỀ</span>
          <h2>${topic.title_vi || topic.title_en} (Topic Vocabulary)</h2>
          <p>Tổng hợp các từ vựng và cụm từ cốt lõi được chọn lọc kỹ lưỡng cho chủ đề này.</p>
        </div>

        <div class="vocab-controls-bar" style="margin-top: 1rem;">
          <div class="vocab-search-box" style="max-width: 100%; width: 100%;">
            <svg class="vocab-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" class="vocab-search-input" placeholder="Tìm nhanh từ vựng, cụm từ..." value="${currentVocabSearch}" oninput="handleVocabSearch(this.value)">
          </div>
        </div>

        <div class="vocab-group-section" style="margin-top: 1.5rem;">
          <div class="vocab-group-header">
            <div class="vocab-group-title">
              <span>📚</span>
              <span>Từ vựng & Cụm từ then chốt &bull; ${filteredVocab.length} mục</span>
            </div>
          </div>
          <div class="collocation-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem;">
            ${filteredVocab.map(v => `
              <div class="collocation-card" style="background: var(--bg-primary); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); padding: 0.85rem 1rem;">
                <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-primary); margin-bottom: 0.25rem;">${v.en}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">${v.vi}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      return;
    }
    container.innerHTML = '<div class="empty-state">Chủ đề này chưa có dữ liệu Nạp từ vựng.</div>';
    return;
  }
  
  const vData = topic.details.vocab_step;
  const search = currentVocabSearch;
  const activeCat = currentVocabFilter;
  
  // Detect if modern schema (single_words + collocation_groups) or legacy categories
  const hasModernSchema = Boolean(vData.single_words || vData.collocation_groups);

  let rawGroups = vData.collocation_groups;
  if ((!rawGroups || rawGroups.length === 0) && vData.collocations && vData.collocations.length > 0) {
    rawGroups = [
      {
        id: 'all_cols',
        name: 'Cụm từ liên kết chủ đề (Topic Collocations)',
        icon: '🔗',
        badge: 'Collocations',
        items: vData.collocations.map(c => ({
          en: c.en || c.phrase,
          vi: c.vi,
          type: c.type || (c.phrase ? 'phrase' : ''),
          level: c.level || 'B2',
          example_en: c.example_en || c.example,
          example_vi: c.example_vi
        }))
      }
    ];
  }

  // Detect current site level (B1 vs B2)
  const siteLevel = (typeof currentVocabLevel !== 'undefined' && currentVocabLevel === 'B1') ? 'B1' : 'B2';
  currentVocabLevel = siteLevel;

  // Level filter strictly for current site level
  const filterByLevel = (item) => {
    if (!item) return false;
    const lvl = (item.level || '').toUpperCase().trim();
    if (!lvl) return true; // available for both if unlabelled
    if (siteLevel === 'B1') {
      return lvl.includes('B1') || lvl === 'ALL';
    } else {
      return lvl.includes('B2') || lvl === 'ALL';
    }
  };

  let hasMatchingLevelSingle = (vData.single_words || []).some(filterByLevel);
  let hasMatchingLevelCols = false;
  (rawGroups || []).forEach(group => {
    const rawItems = group.items || group.collocations || [];
    if (rawItems.some(filterByLevel)) {
      hasMatchingLevelCols = true;
    }
  });

  const isLevelEmpty = !hasMatchingLevelSingle && !hasMatchingLevelCols;
  const effectiveFilter = isLevelEmpty ? () => true : filterByLevel;

  const levelSingleWords = (vData.single_words || []).filter(effectiveFilter);
  const singleWordsCount = levelSingleWords.length;

  let collocationsCount = 0;
  const levelCollocationGroups = (rawGroups || []).map(group => {
    const rawItems = group.items || group.collocations || [];
    const items = rawItems.map(c => ({
      ...c,
      en: c.en || c.phrase,
      example_en: c.example_en || c.example
    })).filter(effectiveFilter);
    collocationsCount += items.length;
    return { ...group, items };
  });

  let paraphrasesCount = vData.paraphrases ? vData.paraphrases.length : 0;
  
  let legacyWordCount = 0;
  if (vData.categories) {
    vData.categories.forEach(c => legacyWordCount += (c.words ? c.words.length : 0));
  }
  
  // Filter pills
  let pills = [];
  if (hasModernSchema) {
    pills = [
      { id: 'all', label: `🌟 Tất cả (${singleWordsCount + collocationsCount})` },
      { id: 'single_words', label: `🔤 Từ đơn (${singleWordsCount})` },
      { id: 'collocations', label: `🔗 Cụm Collocations (${collocationsCount})` }
    ];
  } else {
    pills = [
      { id: 'all', label: `Tất cả (${legacyWordCount})` },
      ...(vData.categories || []).map(c => ({ id: c.id, label: `${c.icon || ''} ${c.name} (${c.words ? c.words.length : 0})` })),
      { id: 'paraphrases', label: `🔄 Paraphrase & Đồng nghĩa (${paraphrasesCount})` }
    ];
  }
  
  const pillsHtml = pills.map(p => `
    <button class="vocab-filter-pill ${activeCat === p.id ? 'active' : ''}" onclick="filterVocabCategory('${p.id}')">
      ${p.label}
    </button>
  `).join('');
  
  let sectionsHtml = '';
  let matchFound = false;
  
  if (hasModernSchema) {
    // 1. SECTION: SINGLE WORDS
    if (levelSingleWords.length > 0 && (activeCat === 'all' || activeCat === 'single_words')) {
      const matchedSingle = levelSingleWords.filter(w => {
        if (!search) return true;
        return (
          (w.word && w.word.toLowerCase().includes(search)) ||
          (w.ipa && w.ipa.toLowerCase().includes(search)) ||
          (w.vi && w.vi.toLowerCase().includes(search)) ||
          (w.family && w.family.toLowerCase().includes(search)) ||
          (w.example_en && w.example_en.toLowerCase().includes(search)) ||
          (w.example_vi && w.example_vi.toLowerCase().includes(search))
        );
      });
      
      if (matchedSingle.length > 0) {
        matchFound = true;
        const singleCardsHtml = matchedSingle.map(w => `
          <div class="vocab-card">
            <div class="vocab-card-top">
              <div class="vocab-card-title-area">
                <span class="vocab-card-en">${w.word}</span>
                ${w.ipa ? `<span class="vocab-ipa">${w.ipa}</span>` : ''}
              </div>
              <div class="vocab-card-meta">
                ${w.pos ? `<span class="vocab-pos-tag">${w.pos}</span>` : ''}
                ${w.level ? `<span class="vocab-level-badge ${w.level.toLowerCase()}">${w.level}</span>` : ''}
              </div>
            </div>
            <div class="vocab-card-vi">👉 ${w.vi}</div>
            ${w.family ? `
              <div class="vocab-family-box">
                <span class="vocab-family-label">🌱 Họ từ:</span>
                <span class="vocab-family-chips">
                  ${w.family.split(',').map(f => `<span class="vocab-family-chip">${f.trim()}</span>`).join('')}
                </span>
              </div>
            ` : ''}
            ${w.example_en ? `
              <div class="vocab-example-box">
                <div class="vocab-example-en"><strong>VD:</strong> ${w.example_en}</div>
                ${w.example_vi ? `<div class="vocab-example-vi">(${w.example_vi})</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('');
        
        sectionsHtml += `
          <div class="vocab-group-section">
            <div class="vocab-group-header">
              <div class="vocab-group-title">
                <span>🔤</span>
                <span>Từ đơn cốt lõi ${currentVocabLevel !== 'all' ? `[Cấp độ ${currentVocabLevel}]` : ''} &bull; ${matchedSingle.length} từ</span>
              </div>
              <div class="vocab-group-desc">
                Cung cấp từ gốc, phiên âm quốc tế IPA chuẩn, từ loại và họ từ (Word Family) giúp bạn phát triển câu từ linh hoạt.
              </div>
            </div>
            <div class="vocab-grid">
              ${singleCardsHtml}
            </div>
          </div>
        `;
      }
    }
    
    // 2. SECTION: COLLOCATION GROUPS
    if (levelCollocationGroups.length > 0 && (activeCat === 'all' || activeCat === 'collocations')) {
      let collocationsGroupHtml = '';
      let totalGroupMatches = 0;
      
      levelCollocationGroups.forEach(group => {
        const items = group.items || [];
        const matchedCols = items.filter(c => {
          if (!search) return true;
          return (
            (c.en && c.en.toLowerCase().includes(search)) ||
            (c.vi && c.vi.toLowerCase().includes(search)) ||
            (c.type && c.type.toLowerCase().includes(search)) ||
            (c.example && c.example.toLowerCase().includes(search)) ||
            (c.example_en && c.example_en.toLowerCase().includes(search)) ||
            (c.example_vi && c.example_vi.toLowerCase().includes(search))
          );
        });
        
        if (matchedCols.length > 0) {
          totalGroupMatches += matchedCols.length;
          const colCardsHtml = matchedCols.map(c => `
            <div class="vocab-card">
              <div class="vocab-card-top">
                <div class="vocab-card-title-area">
                  <span class="vocab-card-en">${c.en}</span>
                </div>
                <div class="vocab-card-meta">
                  ${c.type ? `<span class="collocation-type-tag">${formatCollocationType(c.type)}</span>` : ''}
                  ${c.level ? `<span class="vocab-level-badge ${c.level.toLowerCase()}">${c.level}</span>` : ''}
                </div>
              </div>
              <div class="vocab-card-vi">👉 ${c.vi}</div>
              ${(c.example || c.example_en) ? `
                <div class="vocab-example-box">
                  <div class="vocab-example-en"><strong>VD:</strong> ${c.example || c.example_en}</div>
                  ${c.example_vi ? `<div class="vocab-example-vi">(${c.example_vi})</div>` : ''}
                </div>
              ` : ''}
            </div>
          `).join('');
          
          collocationsGroupHtml += `
            <div class="collocation-subgroup">
              <div class="collocation-subgroup-title">
                <span>${group.icon || '📌'}</span>
                <span>${group.name || group.title} (${matchedCols.length} cụm)</span>
                ${group.badge ? `<span style="margin-left: auto; font-size: 0.75rem; font-weight: normal; background: rgba(99,102,241,0.1); color: var(--accent-primary); padding: 2px 8px; border-radius: 4px;">${group.badge}</span>` : ''}
              </div>
              <div class="vocab-grid">
                ${colCardsHtml}
              </div>
            </div>
          `;
        }
      });
      
      if (totalGroupMatches > 0) {
        matchFound = true;
        sectionsHtml += `
          <div class="vocab-group-section">
            <div class="vocab-group-header">
              <div class="vocab-group-title">
                <span>🔗</span>
                <span>Cụm từ ${currentVocabLevel !== 'all' ? `[Cấp độ ${currentVocabLevel}]` : 'học thuật'} (Collocations) theo Dàn bài &bull; ${totalGroupMatches} cụm</span>
              </div>
              <div class="vocab-group-desc">
                Các cụm từ tự nhiên theo chuẩn bài thi VSTEP được phân bổ theo các phần trọng tâm của bài viết.
              </div>
            </div>
            ${collocationsGroupHtml}
          </div>
        `;
      }
    }
  } else {
    // Legacy categories rendering
    if (vData.categories) {
      vData.categories.forEach(cat => {
        if (activeCat !== 'all' && activeCat !== 'paraphrases' && activeCat !== cat.id) return;
        if (activeCat === 'paraphrases') return;
        
        const matchedWords = (cat.words || []).filter(w => {
          if (!search) return true;
          return (
            (w.en && w.en.toLowerCase().includes(search)) ||
            (w.vi && w.vi.toLowerCase().includes(search)) ||
            (w.example_en && w.example_en.toLowerCase().includes(search)) ||
            (w.example_vi && w.example_vi.toLowerCase().includes(search))
          );
        });
        
        if (matchedWords.length === 0) return;
        matchFound = true;
        
        const wordsHtml = matchedWords.map(w => `
          <div class="vocab-card">
            <div class="vocab-card-top">
              <span class="vocab-card-en">${w.en}</span>
              <div class="vocab-card-meta">
                ${w.pos ? `<span class="vocab-pos-tag">${w.pos}</span>` : ''}
                ${w.level ? `<span class="vocab-level-badge ${w.level.toLowerCase()}">${w.level}</span>` : ''}
              </div>
            </div>
            <div class="vocab-card-vi">👉 ${w.vi}</div>
            ${w.example_en ? `
              <div class="vocab-example-box">
                <div class="vocab-example-en"><strong>VD:</strong> ${w.example_en}</div>
                ${w.example_vi ? `<div class="vocab-example-vi">(${w.example_vi})</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('');
        
        sectionsHtml += `
          <div class="vocab-group-section">
            <div class="vocab-group-header">
              <div class="vocab-group-title">
                <span>${cat.icon || '📌'}</span>
                <span>${cat.name} (${matchedWords.length})</span>
              </div>
            </div>
            <div class="vocab-grid">
              ${wordsHtml}
            </div>
          </div>
        `;
      });
    }
    
    if (vData.paraphrases && vData.paraphrases.length > 0 && (activeCat === 'all' || activeCat === 'paraphrases')) {
      const matchedParaphrases = vData.paraphrases.filter(p => {
        if (!search) return true;
        const matchOrig = p.original && p.original.toLowerCase().includes(search);
        const matchSub = p.paraphrases && p.paraphrases.some(sp => 
          (sp.en && sp.en.toLowerCase().includes(search)) || (sp.vi && sp.vi.toLowerCase().includes(search))
        );
        return matchOrig || matchSub;
      });
      
      if (matchedParaphrases.length > 0) {
        matchFound = true;
        const pCardsHtml = matchedParaphrases.map(p => `
          <div class="paraphrase-card">
            <div class="paraphrase-card-header">
              <span class="paraphrase-orig">Từ gốc: <strong>${p.original}</strong></span>
              <span class="vocab-pos-tag">Paraphrase</span>
            </div>
            <div class="paraphrase-items-list">
              ${p.paraphrases.map(sp => `
                <div class="paraphrase-item">
                  <strong>${sp.en}</strong>
                  <span>${sp.vi}</span>
                </div>
              `).join('')}
            </div>
            ${p.usage ? `<div class="paraphrase-usage-tip">💡 <strong>Mẹo dùng:</strong> ${p.usage}</div>` : ''}
          </div>
        `).join('');
        
        sectionsHtml += `
          <div class="vocab-group-section" style="margin-top: 1rem;">
            <div class="vocab-group-header">
              <div class="vocab-group-title">
                <span>🔄</span>
                <span>Cặp từ đồng nghĩa & Diễn đạt tương đương (Paraphrase)</span>
              </div>
            </div>
            <div class="paraphrase-grid">
              ${pCardsHtml}
            </div>
          </div>
        `;
      }
    }
  }
  
  // Summary Stats Banner (for modern schema)
  const statsSummaryHtml = hasModernSchema ? `
    <div class="vocab-stats-summary" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
      <div class="vocab-stat-card" onclick="filterVocabCategory('single_words')" style="cursor: pointer;">
        <div class="vocab-stat-icon">🔤</div>
        <div class="vocab-stat-info">
          <h4>${singleWordsCount} Từ đơn cốt lõi (Bậc ${siteLevel})</h4>
          <p>Kèm phiên âm IPA & Họ từ (Word Family)</p>
        </div>
      </div>
      <div class="vocab-stat-card" onclick="filterVocabCategory('collocations')" style="cursor: pointer;">
        <div class="vocab-stat-icon">🔗</div>
        <div class="vocab-stat-info">
          <h4>${collocationsCount} Cụm Collocations & Cấu trúc (Bậc ${siteLevel})</h4>
          <p>Phân loại: Nguyên nhân • Hậu quả • Giải pháp</p>
        </div>
      </div>
    </div>
  ` : '';

  let safeThemeTitle = '';
  if (typeof vData.theme === 'string' && vData.theme.trim()) {
    safeThemeTitle = vData.theme;
  } else if (Array.isArray(vData.theme) && vData.theme.length > 0) {
    safeThemeTitle = (topic.title_vi || topic.title_en || 'Từ vựng chủ đề') + ' (Topic Vocabulary)';
  } else {
    safeThemeTitle = (topic.title_vi || topic.title_en || 'Từ vựng chủ đề') + ' (Topic Vocabulary)';
  }

  container.innerHTML = `
    <div class="vocab-hero-banner">
      <span class="vocab-hero-badge">PHÒNG LUYỆN VIẾT VSTEP • BƯỚC 02: NẠP TỪ VỰNG THEO CẤP ĐỘ</span>
      <h2>${safeThemeTitle}</h2>
      ${vData.overview ? `<p>${vData.overview}</p>` : ''}
    </div>
    
    <!-- LEVEL BANNER: Trang web bậc nào chỉ hiện đúng bậc đó -->
    <div class="outline-level-selector" style="margin: 0 auto 1.5rem auto; max-width: 680px; justify-content: center;">
      <div class="level-pill active" style="pointer-events: none; width: 100%; justify-content: center; font-weight: 700; font-size: 0.95rem; padding: 0.65rem 1.25rem; ${siteLevel === 'B1' ? 'background: rgba(59, 130, 246, 0.12); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.35);' : 'background: rgba(225, 29, 72, 0.12); color: #e11d48; border: 1px solid rgba(225, 29, 72, 0.35);'}">
        ${siteLevel === 'B1' ? '📘 BỘ TỪ VỰNG & CẤU TRÚC DIỄN ĐẠT BẬC B1 (DỄ HỌC - VỪA SỨC - DỄ ÁP DỤNG)' : '📕 BỘ TỪ VỰNG & CẤU TRÚC HỌC THUẬT BẬC B2 (NÂNG CAO - ĂN ĐIỂM TỪ VỰNG)'}
      </div>
    </div>
    ${isLevelEmpty ? `
      <div style="font-size: 0.85rem; color: var(--accent-primary); margin: -0.5rem auto 1rem auto; max-width: 680px; text-align: center; padding: 0.5rem 0.75rem; background: rgba(99, 102, 241, 0.08); border-radius: 6px; border: 1px dashed var(--accent-primary);">
        💡 Chủ đề này đang hiển thị toàn bộ từ vựng trọng tâm để bạn tham khảo đầy đủ nhất.
      </div>
    ` : ''}
    
    ${statsSummaryHtml}
    
    <div class="vocab-controls-bar">
      <div class="vocab-filter-pills">
        ${pillsHtml}
      </div>
      <div class="vocab-search-box">
        <svg class="vocab-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" class="vocab-search-input" placeholder="Tìm nhanh từ vựng, phiên âm, nghĩa..." value="${search}" oninput="handleVocabSearch(this.value)">
      </div>
    </div>
    
    ${sectionsHtml || '<div class="empty-state" style="padding: 2.5rem; text-align: center;">Không tìm thấy từ vựng hoặc cụm từ phù hợp với từ khóa tìm kiếm.</div>'}
    
    <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin: 1.5rem 0 2.5rem 0;">
      <button class="btn btn-secondary" style="padding: 0.85rem 1.75rem; font-size: 1rem; font-weight: 600;" onclick="switchStep('read')">
        ← QUAY LẠI: BƯỚC 01 - ĐỌC HIỂU ĐỀ
      </button>
      <button class="btn btn-primary" style="padding: 0.85rem 2.25rem; font-size: 1.05rem; box-shadow: var(--shadow-glow); font-weight: 700;" onclick="switchStep('trans')">
        TIẾP THEO: BƯỚC 03 - TẬP DIỄN ĐẠT Ý TƯỞNG →
      </button>
    </div>
  `;
}

// Switch between B1 and B2 level outlines for Step 1 Translation Exercises
function switchTransLevel(level) {
  if (level !== 'B1' && level !== 'B2') {
    level = (typeof currentTransLevel !== 'undefined' && currentTransLevel === 'B1') ? 'B1' : 'B2';
  }
  currentTransLevel = level;
  currentVocabLevel = level;
  
  const b1El = document.getElementById('ws-trans-level-b1');
  const b2El = document.getElementById('ws-trans-level-b2');
  const targetEl = document.getElementById(`ws-trans-level-${level.toLowerCase()}`);
  if (b1El) b1El.classList.remove('active');
  if (b2El) b2El.classList.remove('active');
  if (targetEl) targetEl.classList.add('active');
  
  renderTranslationExercises();
}

function normalizeTextForMatching(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsEqual(w1, w2) {
  if (w1 === w2) return true;
  if (!w1 || !w2) return false;
  // Plural & verb inflection checks: -s, -es, -d, -ed, -ing, -ies
  if (w1 + 's' === w2 || w2 + 's' === w1) return true;
  if (w1 + 'es' === w2 || w2 + 'es' === w1) return true;
  if (w1 + 'd' === w2 || w2 + 'd' === w1) return true;
  if (w1 + 'ed' === w2 || w2 + 'ed' === w1) return true;
  if (w1.replace(/ing$/, '') === w2 || w2.replace(/ing$/, '') === w1) return true;
  if (w1.replace(/ies$/, 'y') === w2 || w2.replace(/ies$/, 'y') === w1) return true;
  return false;
}

function matchWordsInSequence(phraseWords, sentenceWords, maxGap = 3) {
  if (!phraseWords || phraseWords.length === 0) return false;
  if (!sentenceWords || sentenceWords.length === 0) return false;
  
  let pIdx = 0;
  let lastSIdx = -1;
  for (let sIdx = 0; sIdx < sentenceWords.length; sIdx++) {
    if (wordsEqual(sentenceWords[sIdx], phraseWords[pIdx])) {
      if (pIdx === 0 || (sIdx - lastSIdx - 1) <= maxGap) {
        pIdx++;
        lastSIdx = sIdx;
        if (pIdx === phraseWords.length) {
          return true;
        }
      } else {
        pIdx = 0;
        if (wordsEqual(sentenceWords[sIdx], phraseWords[0])) {
          pIdx = 1;
          lastSIdx = sIdx;
        }
      }
    }
  }
  return false;
}

const IGNORED_LINKING_WORDS = [
  'therefore', 'as a result', 'for example', 'for instance',
  'in addition', 'furthermore', 'moreover', 'consequently',
  'however', 'on the other hand', 'besides', 'thus', 'hence'
];

function wordsAreFormsOfSame(w1, w2) {
  if (w1 === w2) return true;
  if (w1 + "s" === w2 || w1 + "es" === w2 || w1 + "d" === w2 || w1 + "ed" === w2 || w1 + "ing" === w2) return true;
  if (w2 + "s" === w1 || w2 + "es" === w1 || w2 + "d" === w1 || w2 + "ed" === w1 || w2 + "ing" === w1) return true;
  return false;
}

function isWordSubphrase(shortPhrase, longPhrase) {
  const normS = (shortPhrase || "").toLowerCase().trim();
  const normL = (longPhrase || "").toLowerCase().trim();
  if (!normS || !normL || normS === normL) return false;
  if ((" " + normL + " ").includes(" " + normS + " ")) return true;
  
  const sWords = normS.split(" ").filter(Boolean);
  const lWords = normL.split(" ").filter(Boolean);
  if (sWords.length < lWords.length) {
    for (let i = 0; i <= lWords.length - sWords.length; i++) {
      let match = true;
      for (let j = 0; j < sWords.length; j++) {
        if (!wordsAreFormsOfSame(sWords[j], lWords[i + j])) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

function deduplicateCollocations(cols, filterSubphrases = true) {
  if (!Array.isArray(cols)) return [];
  const unique = [];
  cols.forEach(c => {
    if (!c || !c.en) return;
    const norm = c.en.toLowerCase().trim();
    if (!unique.some(u => u.en.toLowerCase().trim() === norm)) {
      unique.push(c);
    }
  });

  if (!filterSubphrases) return unique;

  return unique.filter(c => {
    const isSub = unique.some(other => {
      if (other === c) return false;
      return isWordSubphrase(c.en, other.en);
    });
    return !isSub;
  });
}

function filterCollocationsForSentence(sentenceVi, sentenceEn, collocations) {
  if (!collocations || collocations.length === 0) return [];
  const normVi = ' ' + normalizeTextForMatching(sentenceVi) + ' ';
  const normEn = ' ' + normalizeTextForMatching(sentenceEn) + ' ';
  const sWordsVi = normalizeTextForMatching(sentenceVi).split(' ').filter(Boolean);
  const sWordsEn = normalizeTextForMatching(sentenceEn).split(' ').filter(Boolean);

  const matched = collocations.filter(col => {
    if (!col || !col.en) return false;
    const rawEnLower = col.en.toLowerCase().trim();
    if (IGNORED_LINKING_WORDS.includes(rawEnLower)) {
      if (!normEn.includes(' ' + rawEnLower + ' ')) return false;
    }

    const colEn = normalizeTextForMatching(col.en);
    const colVi = normalizeTextForMatching(col.vi);

    const enWords = colEn.split(' ').filter(w => w.length > 2 && !['and', 'the', 'for', 'with', 'that', 'this', 'are', 'can', 'may', 'has', 'have', 'from', 'also', 'their', 'some', 'sb', 'sth'].includes(w));
    const viWords = colVi.split(' ').filter(w => w.length > 1 && !['và', 'các', 'những', 'của', 'trong', 'được', 'cho', 'có', 'là', 'nhiều', 'thể', 'cũng', 'một', 'số', 'sự', 'việc', 'tính'].includes(w));

    // 1. Direct substring match (EN or VI)
    const enMatchesExact = Boolean(colEn && normEn.includes(' ' + colEn + ' '));
    const viMatchesExact = Boolean(colVi && normVi.includes(' ' + colVi + ' '));
    if (enMatchesExact || viMatchesExact) return true;

    // 2. In-sequence phrase matching allowing up to 3 filler words between keywords
    const enMatchesSeq = enWords.length >= 2 && matchWordsInSequence(enWords, sWordsEn, 3);
    const viMatchesSeq = viWords.length >= 2 && matchWordsInSequence(viWords, sWordsVi, 3);
    if (enMatchesSeq || viMatchesSeq) return true;

    // 3. Short key phrase / key content word match
    if (enWords.length === 1 && enWords[0].length >= 4 && sWordsEn.some(sw => wordsAreFormsOfSame(sw, enWords[0]))) {
      return true;
    }
    if (viWords.length === 1 && viWords[0].length >= 3 && sWordsVi.some(sw => sw === viWords[0])) {
      return true;
    }

    return false;
  });

  return deduplicateCollocations(matched);
}

// Match strictly sentence-specific vocabulary suggestions ordered by appearance in sentence
function getRichCollocationsForSentence(viSentence, enSentence, itemCollocations, topicFallbackCols, targetMin = 3, targetMax = 6) {
  // Step 1: Match directly from current idea item collocations
  let matched = filterCollocationsForSentence(viSentence, enSentence, itemCollocations);

  // Step 2: Also match against topic-level vocabulary (without redundant subphrases)
  if (topicFallbackCols && topicFallbackCols.length > 0) {
    const topicMatched = filterCollocationsForSentence(viSentence, enSentence, topicFallbackCols);
    topicMatched.forEach(col => {
      const colNorm = normalizeTextForMatching(col.en || '');
      const isDup = matched.some(m => {
        const mNorm = normalizeTextForMatching(m.en || '');
        return mNorm === colNorm || (' ' + mNorm + ' ').includes(' ' + colNorm + ' ') || (' ' + colNorm + ' ').includes(' ' + mNorm + ' ');
      });
      if (!isDup) {
        matched.push(col);
      }
    });
  }

  // Sort matched phrases by their appearance position in enSentence
  const normSentEn = normalizeTextForMatching(enSentence || '');
  const getPhrasePos = (phrase) => {
    const pNorm = normalizeTextForMatching((phrase || '').replace(/\(.*?\)/g, ''));
    const directIdx = normSentEn.indexOf(pNorm);
    if (directIdx !== -1) return directIdx;
    const words = pNorm.split(' ').filter(w => w.length > 2);
    for (const w of words) {
      const wIdx = normSentEn.indexOf(w);
      if (wIdx !== -1) return wIdx;
    }
    return 9999;
  };
  matched.sort((a, b) => getPhrasePos(a.en) - getPhrasePos(b.en));

  return matched.slice(0, targetMax);
}

// Helper to split paragraph into sentences
function splitSentences(text) {
  if (!text) return [];
  let cleaned = text.replace(/\\n/g, ' ').replace(/\n/g, ' ');
  let parts = cleaned.split(/\.\s+/);
  let sentences = [];
  parts.forEach(part => {
    let trimmed = part.trim();
    if (trimmed) {
      if (!trimmed.endsWith('.')) {
        trimmed += '.';
      }
      sentences.push(trimmed);
    }
  });
  return sentences;
}

// --- Interactive Idea Selection Helpers ---
function hasSelectableIdeas(topic) {
  if (!topic) return false;
  let details = topic.details;
  if (!details && topic.approaches && topic.approaches.length > 0) {
    details = topic.approaches[0].details;
  }
  if (!details) return false;
  const ideas = details.ideas_b2 || details.ideas_b1;
  if (!ideas) return false;
  const isCausesSolutions = currentCategory && currentCategory.id === 2;
  const bGroup = isCausesSolutions
    ? (ideas.causes || ideas.problems || ideas.benefits || ideas.reasons || ideas.views || ideas.factors || [])
    : (ideas.benefits || ideas.causes || ideas.reasons || ideas.views || ideas.factors || []);
  const dGroup = isCausesSolutions
    ? (ideas.solutions || ideas.effects || ideas.drawbacks || ideas.problems || ideas.measures || [])
    : (ideas.drawbacks || ideas.effects || ideas.solutions || ideas.problems || ideas.measures || []);
  return bGroup.length > 3 || dGroup.length > 3;
}

function getSelectedIdeaIndices(topic, groupType) {
  if (!topic) return [];
  let details = topic.details;
  if (!details && topic.approaches && topic.approaches.length > 0) {
    details = topic.approaches[0].details;
  }
  if (!details) return [];
  const ideas = details.ideas_b2 || details.ideas_b1;
  if (!ideas) return [];
  
  const isCausesSolutions = currentCategory && currentCategory.id === 2;
  let items = [];
  if (groupType === 'benefits') {
    items = isCausesSolutions
      ? (ideas.causes || ideas.problems || ideas.benefits || ideas.reasons || ideas.views || ideas.factors || [])
      : (ideas.benefits || ideas.causes || ideas.reasons || ideas.views || ideas.factors || []);
  } else if (groupType === 'drawbacks') {
    items = isCausesSolutions
      ? (ideas.solutions || ideas.effects || ideas.drawbacks || ideas.problems || ideas.measures || [])
      : (ideas.drawbacks || ideas.effects || ideas.solutions || ideas.problems || ideas.measures || []);
  } else {
    items = ideas[groupType] || [];
  }
  
  const total = items.length;
  if (total <= 3) {
    return items.map((_, i) => i);
  }
  const catId = (currentCategory && currentCategory.id) || 1;
  const apprSuffix = (topic.approaches && topic.approaches.length > 0) ? `_appr${currentApproachIndex}` : '';
  const storageKey = `idea_sel_${catId}_${topic.id}_${groupType}${apprSuffix}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(idx => idx >= 0 && idx < total);
      }
    }
  } catch (e) {}

  // Default selection if not yet set
  const dItems = ideas.drawbacks || ideas.effects || ideas.solutions || ideas.problems || ideas.measures || [];
  if (groupType === 'benefits' && dItems.length === 0) {
    return [0, 1, 2].slice(0, total);
  }
  return [0, 1].slice(0, total);
}

function toggleIdeaSelection(groupType, index) {
  const topic = currentTopic;
  if (!topic || !hasSelectableIdeas(topic)) return;
  const currentSelected = getSelectedIdeaIndices(topic, groupType);
  const exists = currentSelected.includes(index);
  let updated = [];
  if (exists) {
    if (currentSelected.length <= 2) {
      showToast("Bạn nên chọn ít nhất 2 gợi ý để phát triển thân bài nhé!", "warning");
      return;
    }
    updated = currentSelected.filter(i => i !== index);
  } else {
    if (currentSelected.length >= 3) {
      showToast("Khuyên chọn tối đa 3 gợi ý để bài viết có chiều sâu theo chuẩn VSTEP nhé!", "warning");
      return;
    }
    updated = [...currentSelected, index].sort((a, b) => a - b);
  }
  const catId = (currentCategory && currentCategory.id) || 1;
  const apprSuffix = (topic.approaches && topic.approaches.length > 0) ? `_appr${currentApproachIndex}` : '';
  localStorage.setItem(`idea_sel_${catId}_${topic.id}_${groupType}${apprSuffix}`, JSON.stringify(updated));

  // Re-render UI components
  if (currentStepKey === 'read') {
    renderStep1Reading();
  } else if (currentStepKey === 'trans') {
    renderTranslationExercises();
  }
  renderOutline();
  renderVietnameseOutline();
  showToast("Đã cập nhật lựa chọn gợi ý!", "info");
}

function renderIdeaSelectionComponent(topic) {
  if (!topic || !hasSelectableIdeas(topic)) return '';
  let details = topic.details;
  if (!details && topic.approaches && topic.approaches.length > 0) {
    details = topic.approaches[0].details;
  }
  if (!details) return '';
  const b2IdeasObj = details.ideas_b2 || details.ideas_b1;
  if (!b2IdeasObj) return '';

  const bItems = b2IdeasObj.benefits || b2IdeasObj.causes || b2IdeasObj.reasons || b2IdeasObj.views || b2IdeasObj.factors || [];
  const dItems = b2IdeasObj.drawbacks || b2IdeasObj.effects || b2IdeasObj.solutions || b2IdeasObj.problems || b2IdeasObj.measures || [];
  const selB = getSelectedIdeaIndices(topic, 'benefits');
  const selD = getSelectedIdeaIndices(topic, 'drawbacks');

  const isCausesSolutions = currentCategory && currentCategory.id === 2;
  const isOpinion = currentCategory && currentCategory.id === 3;
  const isDiscussion = currentCategory && currentCategory.id === 4;

  const activeApp = (topic.approaches && typeof currentApproachIndex !== 'undefined' && topic.approaches[currentApproachIndex])
    ? topic.approaches[currentApproachIndex]
    : null;
  const isOpinionDisagree = isOpinion && activeApp && (activeApp.stance === 'disagree' || (activeApp.name && activeApp.name.includes('KHÔNG ĐỒNG Ý')));

  const topicTagsLower = ((Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || ''))).toLowerCase();

  let bLabel = isOpinion ? (isOpinionDisagree ? "LÝ DO PHẢN ĐỐI / KHÔNG ĐỒNG Ý (DISAGREE)" : "LÝ DO ĐỒNG Ý (AGREE)") : (isDiscussion ? "QUAN ĐIỂM 1" : "THUẬN LỢI / LỢI ÍCH");
  let dLabel = isOpinion ? "LÝ DO ĐỐI LẬP" : (isDiscussion ? "QUAN ĐIỂM 2" : "BẤT LỢI / HẠN CHẾ");
  let bIcon = isOpinion ? (isOpinionDisagree ? "👎" : "👍") : (isDiscussion ? "👥" : "✨");
  let dIcon = isOpinion ? "💭" : (isDiscussion ? "🗣️" : "⚠️");

  if (isCausesSolutions) {
    const subtype = typeof getTopicSubtypeLabel === 'function' ? getTopicSubtypeLabel(topic, 2) : '';
    const appName = (activeApp && activeApp.name) ? activeApp.name.toUpperCase() : '';
    if (appName.includes('TÍCH CỰC') && appName.includes('TIÊU CỰC')) {
      bLabel = "ẢNH HƯỞNG TÍCH CỰC";
      dLabel = "ẢNH HƯỞNG TIÊU CỰC";
      bIcon = "✨";
      dIcon = "⚠️";
    } else if (appName.includes('TÍCH CỰC')) {
      bLabel = "ẢNH HƯỞNG TÍCH CỰC";
      bIcon = "✨";
    } else if (appName.includes('TIÊU CỰC')) {
      bLabel = "ẢNH HƯỞNG TIÊU CỰC";
      bIcon = "⚠️";
    } else if (subtype === "NGUYÊN NHÂN & ẢNH HƯỞNG") {
      bLabel = "NGUYÊN NHÂN";
      dLabel = "ẢNH HƯỞNG / HỆ QUẢ";
      bIcon = "🔍";
      dIcon = "⚠️";
    } else if (subtype === "ẢNH HƯỞNG & GIẢI PHÁP") {
      bLabel = "ẢNH HƯỞNG / TÁC ĐỘNG";
      dLabel = "GIẢI PHÁP / BIỆN PHÁP";
      bIcon = "⚠️";
      dIcon = "💡";
    } else if (subtype === "CHỈ PHÂN TÍCH GIẢI PHÁP") {
      bLabel = "GIẢI PHÁP / BIỆN PHÁP ĐỀ XUẤT";
      bIcon = "💡";
    } else if (subtype === "CHỈ PHÂN TÍCH ẢNH HƯỞNG") {
      bLabel = "ẢNH HƯỞNG / TÁC ĐỘNG";
      bIcon = "⚠️";
    } else if (subtype === "CHỈ PHÂN TÍCH NGUYÊN NHÂN") {
      bLabel = topicTagsLower.includes('factor') ? "YẾU TỐ ẢNH HƯỞNG" : "NGUYÊN NHÂN / LÝ DO";
      bIcon = "🔍";
    } else {
      bLabel = "NGUYÊN NHÂN / VẤN ĐỀ";
      dLabel = "GIẢI PHÁP / BIỆN PHÁP";
      bIcon = "🔍";
      dIcon = "💡";
    }
  }

  return `
    <div class="reading-section-card idea-selection-card" style="margin-bottom: 1.5rem;">
      <div class="idea-selection-header">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
            <h3 style="margin-bottom: 0;">🎯 Tự chọn Gợi ý Luận điểm bạn muốn đưa vào bài viết</h3>
            <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: var(--accent-primary); font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px;">TÙY CHỌN 5 GỢI Ý</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0;">
            Học viên tự do tick chọn các gợi ý mình tự tin nhất (chọn <strong>2 hoặc 3 gợi ý</strong>). Dàn ý tóm tắt và bài tập diễn đạt (luyện dịch câu) bên dưới sẽ tự động hiển thị theo đúng các ý bạn đã chọn!
          </p>
        </div>
      </div>

      <div class="idea-selection-grid">
        ${bItems.length > 0 ? `
          <div class="idea-group-col">
            <div class="idea-group-title-row">
              <span class="idea-group-title benefit">
                <span>${bIcon}</span> ${bLabel}
              </span>
              <span class="idea-group-badge">Đã chọn: ${selB.length} / ${bItems.length} ý</span>
            </div>
            ${bItems.map((b, idx) => {
              const isChecked = selB.includes(idx);
              return `
                <div class="idea-checkbox-card benefit-card ${isChecked ? 'is-selected' : ''}" onclick="toggleIdeaSelection('benefits', ${idx})">
                  <div class="idea-checkbox-custom">
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                    </svg>
                  </div>
                  <div class="idea-card-content">
                    <div class="idea-card-title">${b.title || `${bLabel} 0${idx+1}`}</div>
                    <div class="idea-card-point">${b.point_vi}</div>
                    ${b.point_en ? `<div style="font-size: 0.8rem; color: var(--accent-primary); margin-top: 0.2rem; font-style: italic;">↳ ${b.point_en}</div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${dItems.length > 0 ? `
          <div class="idea-group-col">
            <div class="idea-group-title-row">
              <span class="idea-group-title drawback">
                <span>${dIcon}</span> ${dLabel}
              </span>
              <span class="idea-group-badge">Đã chọn: ${selD.length} / ${dItems.length} ý</span>
            </div>
            ${dItems.map((d, idx) => {
              const isChecked = selD.includes(idx);
              return `
                <div class="idea-checkbox-card drawback-card ${isChecked ? 'is-selected' : ''}" onclick="toggleIdeaSelection('drawbacks', ${idx})">
                  <div class="idea-checkbox-custom">
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                    </svg>
                  </div>
                  <div class="idea-card-content">
                    <div class="idea-card-title">${d.title || `${dLabel} 0${idx+1}`}</div>
                    <div class="idea-card-point">${d.point_vi}</div>
                    ${d.point_en ? `<div style="font-size: 0.8rem; color: var(--danger-color, #f43f5e); margin-top: 0.2rem; font-style: italic;">↳ ${d.point_en}</div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Helper to build flat translation exercises list
// Level adaptation helper to ensure B1 translation hints and model answers are genuinely simple & appropriate
function adaptCollocationForB1(col) {
  if (!col || !col.en) return col;
  let en = col.en;
  let vi = col.vi || '';
  
  const b1Map = [
    { pattern: /\benable participants to\b/gi, replacement: 'helps participants' },
    { pattern: /\benable participants\b/gi, replacement: 'helps participants / helps people' },
    { pattern: /\benables participants\b/gi, replacement: 'helps participants / helps people' },
    { pattern: /\benables? (people|students|workers|children|learners)\b/gi, replacement: 'helps $1' },
    { pattern: /\benables? (them|us|individuals)\b/gi, replacement: 'helps $1' },
    { pattern: /\bdevelop essential practical skills\b/gi, replacement: 'develop practical skills' },
    { pattern: /\bessential practical skills\b/gi, replacement: 'important practical skills' },
    { pattern: /\bessential skills\b/gi, replacement: 'important skills' },
    { pattern: /\bessential\b/gi, replacement: 'important' },
    { pattern: /\bsubstantial income\b/gi, replacement: 'high income' },
    { pattern: /\bfoster teamwork and effective cooperation\b/gi, replacement: 'work better in teams' },
    { pattern: /\bfoster teamwork\b/gi, replacement: 'improve teamwork' },
    { pattern: /\bfoster\b/gi, replacement: 'build / learn' },
    { pattern: /\bstrengthen problem-solving skills\b/gi, replacement: 'solve difficult problems' },
    { pattern: /\bfacilitate\b/gi, replacement: 'help' },
    { pattern: /\bindispensable\b/gi, replacement: 'very important' },
    { pattern: /\bcultivate\b/gi, replacement: 'learn / build' },
    { pattern: /\butilize\b/gi, replacement: 'use' },
    { pattern: /\bmitigate\b/gi, replacement: 'reduce' },
    { pattern: /\balleviate\b/gi, replacement: 'reduce' }
  ];

  for (const item of b1Map) {
    if (item.pattern.test(en)) {
      en = en.replace(item.pattern, item.replacement);
    }
  }
  
  if (vi.includes('thiết yếu') && !vi.includes('cần thiết')) {
    vi = vi.replace('thiết yếu', 'quan trọng / thực tế');
  }
  
  return { ...col, en, vi };
}

function adaptSentenceForB1(enStr) {
  if (!enStr || typeof enStr !== 'string') return enStr;
  let s = enStr;
  s = s.replace(/\bcommunity service enables participants to develop essential practical skills\b/gi, 'Doing community work helps participants develop important practical skills');
  s = s.replace(/\benables? participants to develop essential practical skills\b/gi, 'helps participants develop important practical skills');
  s = s.replace(/\benables? (participants|people|students|workers|learners) to\b/gi, 'helps $1');
  s = s.replace(/\bessential practical skills\b/gi, 'important practical skills');
  s = s.replace(/\bessential skills\b/gi, 'important skills');
  s = s.replace(/\bsubstantial income\b/gi, 'high income');
  s = s.replace(/\bfoster teamwork and effective cooperation\b/gi, 'work better in teams');
  return s;
}

function buildTranslationExercises(topic, transLevel, category) {
  const ideasObj = transLevel === 'B1' ? topic.details.ideas_b1 : topic.details.ideas_b2;
  if (!ideasObj) return [];
  
  const exercises = [];
  const isCausesSolutions = category.id === 2;
  const isOpinion = category.id === 3;
  const isDiscussion = category.id === 4;
  let benefitLabel = isCausesSolutions ? "Nguyên nhân" : (isOpinion ? "Lý do" : (isDiscussion ? "Quan điểm 1" : "Lợi ích"));
  let drawbackLabel = isCausesSolutions ? "Giải pháp" : (isOpinion ? "Lý do" : (isDiscussion ? "Quan điểm 2" : "Bất lợi"));
  if (isCausesSolutions) {
    const tags = (Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || '')).toLowerCase();
    if (tags.includes('effect') || tags.includes('impact')) {
      if (tags.includes('cause')) {
        benefitLabel = "Nguyên nhân";
        drawbackLabel = "Ảnh hưởng";
      } else if (tags.includes('solution') || tags.includes('measure')) {
        benefitLabel = "Ảnh hưởng";
        drawbackLabel = "Giải pháp";
      } else if (tags.includes('positive')) {
        benefitLabel = "Ảnh hưởng tích cực";
        drawbackLabel = "Ảnh hưởng tiêu cực";
      } else {
        benefitLabel = "Ảnh hưởng";
        drawbackLabel = "Ảnh hưởng";
      }
    } else if (tags.includes('solution') || tags.includes('measure')) {
      benefitLabel = "Giải pháp";
      drawbackLabel = "Giải pháp";
    } else if (tags.includes('problem')) {
      benefitLabel = "Vấn đề";
      drawbackLabel = "Giải pháp";
    }
  }
  
  const allGroup1 = isCausesSolutions
    ? (ideasObj.causes || ideasObj.problems || ideasObj.benefits || ideasObj.reasons || ideasObj.factors)
    : (ideasObj.benefits || ideasObj.causes || ideasObj.reasons || ideasObj.views || ideasObj.factors);
  const allGroup2 = isCausesSolutions
    ? (ideasObj.solutions || ideasObj.effects || ideasObj.drawbacks || ideasObj.problems || ideasObj.measures)
    : (ideasObj.drawbacks || ideasObj.effects || ideasObj.solutions || ideasObj.problems || ideasObj.measures);

  let group1Items = allGroup1;
  let group2Items = allGroup2;

  if (hasSelectableIdeas(topic)) {
    if (allGroup1 && allGroup1.length > 3) {
      const sel1 = getSelectedIdeaIndices(topic, 'benefits');
      group1Items = allGroup1.filter((_, idx) => sel1.includes(idx));
    }
    if (allGroup2 && allGroup2.length > 3) {
      const sel2 = getSelectedIdeaIndices(topic, 'drawbacks');
      group2Items = allGroup2.filter((_, idx) => sel2.includes(idx));
    }
  }

  // Extract topic-level fallback collocations strictly matching current transLevel
  let topicFallbackCols = [];
  const pushFallback = (enVal, viVal, lvl) => {
    if (!enVal || !viVal) return;
    const l = (lvl || '').toUpperCase().trim();
    if (transLevel === 'B1' && l.includes('B2') && !l.includes('B1')) return;
    if (transLevel === 'B2' && l.includes('B1') && !l.includes('B2')) return;
    if (!topicFallbackCols.some(x => (x.en || '').toLowerCase() === enVal.toLowerCase())) {
      topicFallbackCols.push({ en: enVal, vi: viVal });
    }
  };
  if (topic.details.vocab_step && Array.isArray(topic.details.vocab_step.collocations)) {
    topic.details.vocab_step.collocations.forEach(c => pushFallback(c.en || c.phrase, c.vi, c.level));
  }
  if (topic.details.vocab_step && Array.isArray(topic.details.vocab_step.collocation_groups)) {
    topic.details.vocab_step.collocation_groups.forEach(g => {
      (g.items || g.collocations || []).forEach(c => pushFallback(c.en || c.phrase, c.vi, c.level));
    });
  }
  if (Array.isArray(topic.details.vocab)) {
    topic.details.vocab.forEach(c => pushFallback(c.en || c.phrase, c.vi, c.level));
  }
  if (topic.details.vocab_step && Array.isArray(topic.details.vocab_step.single_words)) {
    topic.details.vocab_step.single_words.forEach(w => pushFallback(w.word || w.en, w.meaning || w.vi, w.level));
  }

  // Push group 1 (benefits / causes / reasons)
  if (group1Items && group1Items.length > 0) {
    group1Items.forEach((item, idx) => {
      const baseTitle = item.title ? item.title : (isDiscussion ? benefitLabel : `${benefitLabel} 0${idx+1}`);
      const itemCollocations = (item.collocations && item.collocations.length > 0) ? item.collocations : topicFallbackCols;
      // 1. Point
      const hasExplicitPointCols = Array.isArray(item.point_collocations) && item.point_collocations.length > 0;
      let pointCols = hasExplicitPointCols
        ? deduplicateCollocations(item.point_collocations, false)
        : deduplicateCollocations(getRichCollocationsForSentence(item.point_vi, item.point_en, itemCollocations, topicFallbackCols, 3, 6));
      if (!hasExplicitPointCols) {
        pointCols = deduplicateCollocations(pointCols);
      }
      if (transLevel === 'B1') {
        pointCols = pointCols.map(adaptCollocationForB1);
      }
      exercises.push({
        type: 'benefit_point',
        title: `${baseTitle}<br/>Luận điểm`,
        vi: item.point_vi,
        en: transLevel === 'B1' ? adaptSentenceForB1(item.point_en) : item.point_en,
        collocations: pointCols
      });
      // 2. Evidence
      const viSentences = splitSentences(item.evidence_vi);
      const enSentences = splitSentences(item.evidence_en);
      viSentences.forEach((viS, sIdx) => {
        const enS = enSentences[sIdx] || "";
        const sNum = String(sIdx + 1).padStart(2, '0');
        const explicitEvCols = Array.isArray(item.evidence_collocations)
          ? (Array.isArray(item.evidence_collocations[sIdx])
              ? item.evidence_collocations[sIdx]
              : (sIdx === 0 && !Array.isArray(item.evidence_collocations[0]) ? item.evidence_collocations : []))
          : [];
        const hasExplicitEvCols = explicitEvCols && explicitEvCols.length > 0;
        let evCols = hasExplicitEvCols
          ? deduplicateCollocations(explicitEvCols, false)
          : deduplicateCollocations(getRichCollocationsForSentence(viS, enS, itemCollocations, topicFallbackCols, 3, 6));
        if (!hasExplicitEvCols) {
          evCols = deduplicateCollocations(evCols);
        }
        if (transLevel === 'B1') {
          evCols = evCols.map(adaptCollocationForB1);
        }
        exercises.push({
          type: 'benefit_evidence',
          title: `${baseTitle}<br/>Luận cứ ${sNum}`,
          vi: viS,
          en: transLevel === 'B1' ? adaptSentenceForB1(enS) : enS,
          collocations: evCols
        });
      });
    });
  }
  
  // Push group 2 (drawbacks / effects / solutions)
  if (group2Items && group2Items.length > 0) {
    group2Items.forEach((item, idx) => {
      const baseTitle = item.title ? item.title : (isDiscussion ? drawbackLabel : `${drawbackLabel} 0${idx+1}`);
      const itemCollocations = (item.collocations && item.collocations.length > 0) ? item.collocations : topicFallbackCols;
      // 1. Point
      const hasExplicitPointCols = Array.isArray(item.point_collocations) && item.point_collocations.length > 0;
      let pointCols = hasExplicitPointCols
        ? deduplicateCollocations(item.point_collocations, false)
        : deduplicateCollocations(getRichCollocationsForSentence(item.point_vi, item.point_en, itemCollocations, topicFallbackCols, 3, 6));
      if (!hasExplicitPointCols) {
        pointCols = deduplicateCollocations(pointCols);
      }
      if (transLevel === 'B1') {
        pointCols = pointCols.map(adaptCollocationForB1);
      }
      exercises.push({
        type: 'drawback_point',
        title: `${baseTitle}<br/>Luận điểm`,
        vi: item.point_vi,
        en: transLevel === 'B1' ? adaptSentenceForB1(item.point_en) : item.point_en,
        collocations: pointCols
      });
      // 2. Evidence
      const viSentences = splitSentences(item.evidence_vi);
      const enSentences = splitSentences(item.evidence_en);
      viSentences.forEach((viS, sIdx) => {
        const enS = enSentences[sIdx] || "";
        const sNum = String(sIdx + 1).padStart(2, '0');
        const explicitEvCols = Array.isArray(item.evidence_collocations)
          ? (Array.isArray(item.evidence_collocations[sIdx])
              ? item.evidence_collocations[sIdx]
              : (sIdx === 0 && !Array.isArray(item.evidence_collocations[0]) ? item.evidence_collocations : []))
          : [];
        const hasExplicitEvCols = explicitEvCols && explicitEvCols.length > 0;
        let evCols = hasExplicitEvCols
          ? deduplicateCollocations(explicitEvCols, false)
          : deduplicateCollocations(getRichCollocationsForSentence(viS, enS, itemCollocations, topicFallbackCols, 3, 6));
        if (!hasExplicitEvCols) {
          evCols = deduplicateCollocations(evCols);
        }
        if (transLevel === 'B1') {
          evCols = evCols.map(adaptCollocationForB1);
        }
        exercises.push({
          type: 'drawback_evidence',
          title: `${baseTitle}<br/>Luận cứ ${sNum}`,
          vi: viS,
          en: transLevel === 'B1' ? adaptSentenceForB1(enS) : enS,
          collocations: evCols
        });
      });
    });
  }
  
  return exercises;
}

// Render dynamic translation cards for Step 1
function renderTranslationExercises() {
  const btnVocab = document.getElementById('btn-view-vocab-step');
  if (btnVocab) { btnVocab.style.display = hasVocabStep() ? 'inline-flex' : 'none'; }
  const container = document.getElementById('ws-translation-list');
  container.innerHTML = '';
  
  const topic = currentTopic;
  if (!topic || !topic.has_full_details || !topic.details) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 4rem 1.5rem;">
        <h3 style="font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 0.5rem;">Đề bài Viết tự do</h3>
        <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 1.5rem auto; line-height: 1.5;">
          Chủ đề này chưa có dàn ý, nếu muốn viết thì hãy viết tự do nhé.
        </p>
      </div>
    `;
    return;
  }
  
  const exercises = buildTranslationExercises(topic, currentTransLevel, currentCategory);
  
  if (exercises.length === 0) {
    container.innerHTML = '<div class="empty-state">Chưa có bài tập dịch cho cấp độ này.</div>';
    return;
  }

  if (hasSelectableIdeas(topic)) {
    const selWrapper = document.createElement('div');
    selWrapper.innerHTML = renderIdeaSelectionComponent(topic);
    container.appendChild(selWrapper);
  }
  
  exercises.forEach((ex, idx) => {
    const card = document.createElement('div');
    card.className = 'translation-card';
    
    // Check local storage for persistent values (per student)
    const inputKey = getStudentTransKey('input', currentCategory.id, currentTopic.id, currentTransLevel, idx);
    const checkedKey = getStudentTransKey('checked', currentCategory.id, currentTopic.id, currentTransLevel, idx);
    
    const savedInput = localStorage.getItem(inputKey) || '';
    const isChecked = localStorage.getItem(checkedKey) === 'true';
    
    // Format collocations hints as line-by-line list, strictly for this sentence
    let vocabHintsHtml = '';
    let hintsListHtml = '';
    if (ex.collocations && ex.collocations.length > 0) {
      hintsListHtml = ex.collocations.map(c => `<li><strong>${c.en}</strong>: ${c.vi}</li>`).join('');
    }

    if (hintsListHtml) {
      vocabHintsHtml = `
        <div class="trans-vocab-toggle-wrapper">
          <button class="vocab-toggle-btn" onclick="toggleVocabHints(${idx})">
            <span>💡 Hiện gợi ý từ vựng </span>
            <svg class="chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 14px; height: 14px; transition: transform 0.2s;">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div class="trans-vocab-hints" id="trans-vocab-hints-${idx}" style="display: none; margin-top: 0.5rem;">
            <ul class="vocab-hints-list">
              ${hintsListHtml}
            </ul>
          </div>
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="trans-card-header">
        <span class="part-title">${ex.title}</span>
        <span style="font-size: 0.75rem; text-transform: none; color: var(--text-muted);">Cấp độ ${currentTransLevel}</span>
      </div>
      <div class="trans-vi-prompt">${ex.vi}</div>
      ${vocabHintsHtml}
      <textarea class="trans-input-area" autocomplete="off" id="trans-input-${idx}" placeholder="Gõ câu dịch tiếng Anh của bạn tại đây..." oninput="saveTransInput(${idx})">${savedInput}</textarea>
      
      <div class="trans-actions">
        <button class="btn ${isChecked ? 'btn-secondary' : 'btn-success'}" id="trans-check-btn-${idx}" onclick="checkTranslation(${idx})">
          ${isChecked ? 'Xem đáp án gợi ý' : 'Kiểm tra & Xem đáp án'}
        </button>
      </div>
      
      <div class="trans-answer-box" id="trans-answer-box-${idx}">
        <div id="trans-eval-result-${idx}"></div>
        <div class="trans-answer-title" style="margin-top: 0.5rem; border-top: 1px dashed var(--panel-border); padding-top: 0.5rem;">Đáp án gợi ý</div>
        <div class="trans-answer-text">${ex.en}</div>
      </div>
    `;
    container.appendChild(card);
  });
  
  // Footer navigation button
  const footerDiv = document.createElement('div');
  footerDiv.style.display = 'flex';
  footerDiv.style.justifyContent = 'center';
  footerDiv.style.gap = '1rem';
  footerDiv.style.padding = '1rem 0 2rem 0';
  footerDiv.innerHTML = `
    ${hasVocabStep() ? `
      <button class="btn btn-secondary" style="padding: 0.75rem 1.75rem; font-size: 1rem; font-weight: 600;" onclick="switchStep('vocab')">
        ← QUAY LẠI: BƯỚC 02 - NẠP TỪ VỰNG
      </button>
    ` : `
      <button class="btn btn-secondary" style="padding: 0.75rem 1.75rem; font-size: 1rem; font-weight: 600;" onclick="switchStep('read')">
        ← QUAY LẠI: BƯỚC 01 - ĐỌC HIỂU ĐỀ
      </button>
    `}
    ${(typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser('write', currentCategory ? currentCategory.id : 0, currentTopic ? currentTopic.id : 0, currentTopic)) ? `
      <button class="btn btn-primary" style="padding: 0.75rem 2rem; font-size: 1rem; opacity: 0.85; background: #64748b; cursor: not-allowed;" onclick="showToast('🔒 Bước 04 (Viết bài luận) và Bước 05 (Bài mẫu) tạm thời chưa mở cho lớp của bạn! Bạn đã hoàn thành xuất sắc 3 bước học đầu tiên của đề này.', 'warning')">
        🔒 ĐÃ HOÀN THÀNH 3 BƯỚC ĐẦU (BƯỚC 04 & 05 TẠM KHOÁ)
      </button>
    ` : `
      <button class="btn btn-primary" style="padding: 0.75rem 2rem; font-size: 1rem; box-shadow: var(--shadow-glow);" onclick="switchStep('write')">
        HOÀN THÀNH DỊCH Ý TƯỞNG → CHUYỂN SANG VIẾT BÀI LUẬN
      </button>
    `}
  `;
  container.appendChild(footerDiv);
}

// Auto-save translation input per student as they type
function saveTransInput(idx) {
  isDirty = true;
  try {
    const inputEl = document.getElementById(`trans-input-${idx}`);
    if (inputEl && currentCategory && currentTopic) {
      const inputKey = getStudentTransKey('input', currentCategory.id, currentTopic.id, currentTransLevel, idx);
      localStorage.setItem(inputKey, inputEl.value);
      if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
        window.StudentHistorySync.schedulePush(false);
      }
    }
  } catch (e) {}
}

// Check translation card and reveal correct answer with VSTEP grammar/semantic checks
function checkTranslation(idx) {
  const ansBox = document.getElementById(`trans-answer-box-${idx}`);
  const btn = document.getElementById(`trans-check-btn-${idx}`);
  if (!ansBox || !btn) return;
  
  // Reconstruct the flat list of exercises to get the model answer
  const topic = currentTopic;
  const exercises = buildTranslationExercises(topic, currentTransLevel, currentCategory);
  
  const modelAnswer = exercises[idx] ? exercises[idx].en : "";
  
  const checkedKey = getStudentTransKey('checked', currentCategory.id, currentTopic.id, currentTransLevel, idx);
  const isChecked = localStorage.getItem(checkedKey) === 'true';
  
  // Evaluate the student's text
  const userInput = document.getElementById(`trans-input-${idx}`).value;
  const evalResult = evaluateTranslationInput(userInput, modelAnswer);
  
  // Render evaluation block in answer container
  const evalResultDiv = document.getElementById(`trans-eval-result-${idx}`);
  if (evalResultDiv) {
    if (evalResult.isCorrect) {
      evalResultDiv.innerHTML = `
        <div class="eval-badge eval-correct" style="display: inline-flex; align-items: center; gap: 0.35rem; background-color: var(--success-bg); color: var(--success); padding: 0.35rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 700; margin-bottom: 0.75rem; border: 1px solid var(--success);">
          ✓ ĐÚNG
        </div>
        <div style="font-size: 0.9rem; color: var(--text-primary); margin-bottom: 1rem; line-height: 1.4; font-family: inherit;">
          ${evalResult.feedback}
        </div>
      `;
    } else {
      evalResultDiv.innerHTML = `
        <div class="eval-badge eval-incorrect" style="display: inline-flex; align-items: center; gap: 0.35rem; background-color: var(--danger-bg); color: var(--danger); padding: 0.35rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 700; margin-bottom: 0.75rem; border: 1px solid var(--danger);">
          ✗ CHƯA ĐÚNG
        </div>
        <div style="font-size: 0.9rem; color: var(--text-primary); margin-bottom: 1rem; line-height: 1.4; font-family: inherit;">
          ${evalResult.reason}
        </div>
      `;
    }
  }
  
  // Track real typed attempt (>= 3 English words) so students cannot empty-click to bypass Step 3
  const typedWords = (userInput || '').trim().split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
  const transKey = `${currentCategory.id}_${currentTopic.id}_${currentTransLevel}_${idx}`;
  const inputKey = getStudentTransKey('input', currentCategory.id, currentTopic.id, currentTransLevel, idx);
  if (userInput && userInput.trim()) {
    localStorage.setItem(inputKey, userInput);
  }
  if (typedWords >= 3) {
    localStorage.setItem(getStudentTransKey('attempted', currentCategory.id, currentTopic.id, currentTransLevel, idx), 'true');
    if (sessionTracking.isLoggedIn && currentCategory && currentTopic) {
      sessionTracking.transResults[transKey] = { isCorrect: Boolean(evalResult.isCorrect) };
      localStorage.setItem(getStudentTransKey('correct', currentCategory.id, currentTopic.id, currentTransLevel, idx), evalResult.isCorrect ? 'true' : 'false');
      const transStats = getTranslationSessionStats(currentTopic, currentCategory, currentTransLevel);
      if (transStats.topicTotal > 0 && transStats.topicAttempted === transStats.topicTotal) {
        reportTranslationProgressIfAny();
      }
    }
    if (typeof checkAndNotifyWriteStepUnlocked === 'function') {
      checkAndNotifyWriteStepUnlocked();
    }
    if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
      window.StudentHistorySync.schedulePush(true);
    }
  } else if (!isChecked) {
    showToast("⚠️ Bạn cần tự gõ câu dịch tiếng Anh (ít nhất 3 từ) rồi bấm Kiểm tra mới được tính hoàn thành câu này để mở khóa Bước 04!", "warning");
  }

  if (!isChecked) {
    // First time checking: reveal answer, mark as checked
    ansBox.classList.add('active');
    btn.innerText = "Ẩn đáp án gợi ý";
    btn.className = "btn btn-secondary";
    localStorage.setItem(checkedKey, 'true');
    saveTransInput(idx);
    if (evalResult.isCorrect) {
      showToast("🎉 Chúc mừng! Câu dịch của bạn đã được đánh giá là ĐÚNG.", "success");
    } else {
      showToast("🔍 Câu dịch chưa chính xác hoàn toàn. Xem gợi ý chỉnh sửa nhé!", "warning");
    }
  } else {
    // Already checked in the past: toggle visibility
    if (ansBox.classList.contains('active')) {
      ansBox.classList.remove('active');
      btn.innerText = "Xem đáp án gợi ý";
    } else {
      ansBox.classList.add('active');
      btn.innerText = "Ẩn đáp án gợi ý";
    }
  }
}

// Levenshtein distance helper
function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Common english vocabulary words
const COMMON_ENGLISH_WORDS = new Set([
  
  "a", "abilities", "ability", "able", "about", "above", "abroad", "academic", "academically", "accelerating", "accept", "acceptable",
  "access", "accessed", "accesses", "accessibility", "accessible", "accessing", "accident", "accidental", "accidentally", "accidents", "accuracy", "accurate",
  "accurately", "achieve", "achievement", "achievements", "acquire", "acquisition", "across", "act", "action", "actions", "activating", "active",
  "actively", "activities", "activity", "actors", "actual", "actually", "adapt", "add", "added", "addiction", "addition", "additional",
  "additionally", "address", "addressed", "addressing", "adds", "administer", "administration", "administrative", "administrators", "admit", "admitted", "adopt",
  "adopting", "adoption", "adult", "adulthood", "adults", "advance", "advanced", "advancement", "advances", "advantage", "advantages", "adventure",
  "adverse", "advertise", "advertisement", "advertisements", "advertising", "advice", "advise", "advisor", "advocate", "aesthetic", "affect", "affected",
  "affecting", "affects", "afford", "affordability", "affordable", "afraid", "after", "afternoon", "afterwards", "again", "against", "age",
  "agency", "agent", "agents", "ages", "aggressive", "ago", "agree", "agreed", "agreement", "agrees", "agriculture", "ahead",
  "ai", "aid", "aim", "aimed", "aims", "air", "alarm", "alarming", "alcohol", "alike", "alive", "all",
  "alleviate", "allocate", "allocating", "allow", "allowed", "allowing", "allows", "allure", "almost", "alone", "along", "already",
  "also", "alter", "alternative", "alternatives", "although", "always", "am", "amaze", "amazing", "ambition", "among", "amount",
  "amounts", "an", "analyse", "analysis", "analyze", "ancient", "and", "anger", "angle", "angry", "animal", "animals",
  "annoy", "annual", "another", "answer", "answered", "answering", "answers", "anxiety", "anxious", "any", "anybody", "anymore",
  "anyone", "anything", "anytime", "anyway", "anywhere", "apart", "apartment", "apartments", "apologize", "app", "apparent", "apparently",
  "appeal", "appear", "appearance", "appeared", "appearing", "appears", "appetite", "apple", "apples", "appliances", "application", "applications",
  "applied", "applies", "apply", "applying", "appoint", "appointment", "appreciate", "appreciated", "appreciation", "approach", "approached", "approaches",
  "approaching", "appropriate", "appropriately", "approval", "approve", "approximate", "approximately", "apps", "april", "are", "area", "areas",
  "argue", "argued", "argues", "arguing", "argument", "arguments", "arise", "arisen", "arises", "arising", "arm", "arms",
  "army", "arose", "around", "arrange", "arranged", "arrangement", "arrangements", "arrest", "arrival", "arrive", "arrived", "arrives",
  "arriving", "art", "article", "articles", "artificial", "artist", "artistic", "artists", "as", "ashamed", "asian", "aside",
  "ask", "asked", "asking", "asks", "asleep", "aspect", "aspects", "aspiration", "aspirations", "aspire", "assessment", "assessments",
  "assign", "assignment", "assignments", "assist", "assistance", "assistant", "assistants", "associate", "associated", "associates", "associating", "association",
  "associations", "assume", "assumption", "assumptions", "assure", "at", "ate", "athlete", "athletes", "athletic", "atmosphere", "attach",
  "attack", "attempt", "attempted", "attempts", "attend", "attendance", "attended", "attending", "attends", "attention", "attitude", "attitudes",
  "attract", "attracted", "attracting", "attraction", "attractions", "attractive", "attracts", "attribute", "audience", "audiences", "august", "aunt",
  "authentic", "author", "authorities", "authority", "authors", "automobiles", "autumn", "availability", "available", "average", "avoid", "avoidance",
  "avoided", "avoiding", "awake", "award", "awards", "aware", "awareness", "away", "awful", "babies", "baby", "back",
  "background", "backgrounds", "backward", "bacon", "bad", "badly", "bag", "baggage", "bags", "bake", "baker", "balance",
  "balanced", "balances", "ball", "balls", "ban", "band", "bands", "bank", "banking", "banks", "banned", "banning",
  "bans", "bar", "barrier", "barriers", "bars", "base", "based", "bases", "basic", "basically", "basis", "basket",
  "basketball", "bath", "bathroom", "bathrooms", "batteries", "battery", "battle", "battlefields", "be", "beach", "beaches", "beam",
  "bear", "beard", "bears", "beast", "beat", "beaten", "beating", "beats", "beautiful", "beautifully", "beauty", "became",
  "because", "become", "becomes", "becoming", "bed", "bedroom", "bedrooms", "beds", "beef", "been", "beer", "before",
  "beforehand", "beg", "began", "begin", "beginning", "beginnings", "begins", "begun", "behalf", "behave", "behavior", "behaviors",
  "behaviour", "behaviours", "behind", "being", "beings", "belief", "beliefs", "believe", "believed", "believes", "believing", "bell",
  "bells", "belong", "belonged", "belonging", "belongs", "below", "belt", "belts", "bench", "bend", "beneath", "beneficial",
  "benefit", "benefited", "benefiting", "benefits", "beside", "besides", "best", "bet", "better", "between", "beyond", "bicycle",
  "bicycles", "big", "bigger", "biggest", "bike", "bikes", "bill", "billboards", "billion", "bills", "bind", "biodiversity",
  "biography", "biological", "biology", "biotech", "biotechnology", "bird", "birds", "birth", "birthday", "birthdays", "biscuit", "biscuits",
  "bit", "bite", "bites", "bitter", "black", "blade", "blame", "blank", "blanket", "blast", "bleed", "blend",
  "bless", "blind", "block", "blocks", "blood", "blow", "blows", "blue", "board", "boards", "boast", "boat",
  "boats", "bodies", "body", "boil", "bold", "bomb", "bombs", "bond", "bonds", "bone", "bones", "book",
  "books", "boosts", "boot", "boots", "border", "borders", "bore", "bored", "boring", "born", "borrow", "borrowed",
  "boss", "bosses", "both", "bother", "bottle", "bottleneck", "bottlenecks", "bottles", "bottom", "bought", "bound", "boundaries",
  "boundary", "bow", "bowl", "box", "boxes", "boy", "boys", "brain", "brains", "branch", "branches", "brand",
  "brands", "brave", "breaches", "bread", "break", "breakfast", "breakfasts", "breaking", "breaks", "breast", "breath", "breathe",
  "breathless", "breeze", "brick", "bricks", "bridge", "bridges", "brief", "briefly", "bright", "brightened", "brightly", "brilliant",
  "bring", "bringing", "brings", "broad", "broadcast", "broke", "broken", "brother", "brothers", "brought", "brown", "brt",
  "brush", "bubble", "bucket", "budget", "budgets", "bug", "bugs", "build", "building", "buildings", "builds", "built",
  "bullet", "bulletin", "bunch", "burden", "burn", "burned", "burning", "burns", "burnt", "burst", "bury", "bus",
  "buses", "bush", "bushes", "business", "businesses", "busy", "but", "butter", "button", "buttons", "buy", "buyer",
  "buyers", "buying", "buys", "by", "bypass", "cab", "cabin", "cabinet", "cable", "cables", "cafe", "cafes",
  "cake", "cakes", "calculate", "calculation", "calculations", "calendar", "calendars", "call", "called", "calling", "calls", "calm",
  "came", "camera", "cameras", "camp", "campaign", "campaigns", "can", "canal", "cancel", "cancer", "cancers", "candidate",
  "candidates", "candle", "cannot", "cap", "capable", "capacities", "capacity", "capital", "capitals", "caps", "captain", "capture",
  "car", "card", "cards", "care", "cared", "career", "careers", "careful", "carefully", "careless", "cares", "cargo",
  "caring", "carpet", "carriage", "carried", "carrier", "carries", "carry", "carrying", "cars", "cart", "cartoons", "case",
  "cases", "cash", "cashless", "castle", "cat", "catalog", "catch", "catches", "catching", "categories", "category", "cats",
  "cattle", "caught", "cause", "caused", "causes", "causing", "caution", "cautious", "cave", "caves", "cease", "ceeded",
  "ceiling", "celebrate", "celebration", "celebrations", "celebrities", "celebrity", "cell", "cellphone", "cellphones", "cells", "cement", "cemetery",
  "cent", "center", "centers", "central", "centralized", "centre", "centres", "cents", "centuries", "century", "ceremonies", "ceremony",
  "certain", "certainly", "certificate", "certificates", "cessant", "chain", "chains", "chair", "chairman", "chairs", "challenge", "challenges",
  "challenging", "chamber", "champion", "championship", "championships", "chance", "chances", "change", "changed", "changes", "changing", "channel",
  "channels", "chapter", "chapters", "character", "characteristic", "characteristics", "characters", "charge", "charged", "charges", "charging", "charities",
  "charity", "charm", "charming", "chart", "charts", "chase", "chat", "chatgpt", "cheap", "cheaper", "cheapest", "cheat",
  "check", "checked", "checking", "checks", "cheek", "cheer", "cheerful", "cheese", "chef", "chemical", "chemicals", "chemistry",
  "chest", "chew", "chicken", "chickens", "chief", "child", "childbirth", "childhood", "children", "chimney", "chin", "china",
  "chinese", "chip", "chips", "chocolate", "chocolates", "choice", "choices", "choke", "choose", "chooses", "choosing", "chop",
  "chore", "chores", "chorus", "chose", "chosen", "christ", "christian", "christmas", "chronic", "church", "churches", "cigarette",
  "cigarettes", "cinema", "cinemas", "circle", "circles", "circular", "circumstance", "circumstances", "cities", "citizen", "citizens", "city",
  "civil", "civilization", "claim", "claimed", "claims", "clarification", "clarifications", "clarified", "clarifies", "clarify", "clarifying", "clash",
  "class", "classes", "classic", "classical", "classification", "classmates", "classroom", "classrooms", "clay", "clean", "cleaned", "cleaner",
  "cleanest", "cleaning", "clear", "cleared", "clearly", "clerk", "clever", "click", "client", "clients", "cliff", "climate",
  "climates", "climb", "climbed", "climbing", "clinic", "clinical", "clip", "clock", "clocks", "close", "closed", "closely",
  "closer", "closest", "closet", "cloth", "clothes", "clothing", "cloud", "clouds", "cloudy", "club", "clubs", "clue",
  "clues", "cluster", "coach", "coaches", "coal", "coast", "coasts", "coat", "coats", "code", "codes", "coffee",
  "coffees", "cognitive", "coin", "coins", "cold", "colder", "coldest", "collaboration", "collapse", "collar", "colleague", "colleagues",
  "collect", "collection", "collections", "collective", "college", "colleges", "collision", "collocation", "collocations", "colloquial", "colony", "color",
  "colorful", "colors", "colourful", "column", "columns", "combat", "combination", "combinations", "combine", "combined", "combining", "come",
  "comedy", "comes", "comfort", "comfortable", "comfortably", "comic", "coming", "command", "comment", "comments", "commerce", "commercial",
  "commit", "commitment", "commitments", "committed", "committee", "committees", "common", "commonly", "communicate", "communicated", "communicates", "communicating",
  "communication", "communications", "communion", "communities", "community", "commute", "commuted", "commuter", "commuters", "commutes", "commuting", "companies",
  "companion", "companions", "companionship", "company", "comparative", "compare", "compared", "comparing", "comparison", "comparisons", "compass", "compatibility",
  "compel", "compensate", "compensation", "compete", "competent", "competition", "competitions", "competitive", "competitor", "competitors", "complain", "complaint",
  "complaints", "complete", "completely", "completing", "completion", "complex", "complexities", "complexity", "compliance", "complicate", "complicated", "complication",
  "complications", "comply", "component", "components", "compose", "composition", "compositions", "compound", "compounded", "comprehend", "comprehension", "comprehensive",
  "comprise", "compromise", "computer", "computers", "computing", "conceal", "concede", "concentrate", "concentrated", "concentrates", "concentration", "concept",
  "concepts", "concern", "concerned", "concerning", "concerns", "concert", "concerts", "conclude", "concluded", "concludes", "conclusion", "conclusions",
  "concrete", "condition", "conditions", "conduct", "conductor", "conference", "conferences", "conferencing", "confess", "confidence", "confident", "confidential",
  "confine", "confirm", "confirmation", "conflict", "conflicts", "confront", "confuse", "confused", "confusing", "confusion", "congestion", "congratulate",
  "congratulation", "congratulations", "congress", "connect", "connected", "connecting", "connection", "connections", "connects", "conquer", "conscience", "conscious",
  "consciousness", "consent", "consequence", "consequences", "consequently", "conservation", "conservative", "conserving", "consider", "considerable", "considerably", "consideration",
  "considerations", "considered", "considering", "considers", "consist", "consisted", "consistent", "consistently", "consists", "consoles", "constant", "constantly",
  "constitute", "constitution", "constrain", "constraint", "constraints", "construct", "constructing", "construction", "constructions", "consult", "consultant", "consultants",
  "consume", "consumer", "consumers", "consumption", "contact", "contacts", "contain", "contained", "containing", "contains", "contemporary", "contempt",
  "contend", "content", "contents", "contest", "context", "contexts", "continent", "continual", "continually", "continue", "continued", "continues",
  "continuing", "continuous", "continuously", "contract", "contracts", "contradict", "contradiction", "contrary", "contrast", "contrasts", "contribute", "contributed",
  "contributes", "contributing", "contribution", "contributions", "contributor", "control", "controlled", "controlling", "controls", "controversial", "controversy", "convenience",
  "conveniences", "convenient", "conveniently", "convention", "conventional", "conventions", "conversation", "conversations", "convert", "convey", "convinced", "cook",
  "cooked", "cooking", "cooks", "cool", "cooperate", "cooperation", "cooperative", "coordinate", "cope", "copies", "coping", "copy",
  "cord", "core", "corn", "corner", "corners", "corporate", "corporation", "corporations", "correct", "correctly", "correlation", "correspond",
  "correspondence", "corridor", "cost", "costly", "costs", "cottage", "cotton", "couch", "cough", "could", "council", "councils",
  "counsel", "count", "counted", "counter", "countless", "countries", "country", "countryside", "counts", "county", "couple", "coupled",
  "couples", "courage", "course", "courses", "court", "courts", "cousin", "cousins", "cover", "coverage", "covered", "covering",
  "covers", "cow", "cows", "crack", "craft", "crash", "crazy", "cream", "create", "created", "creates", "creating",
  "creation", "creations", "creative", "creativity", "creator", "creators", "creature", "creatures", "credit", "credits", "crew", "crews",
  "cries", "crime", "crimes", "criminal", "criminals", "crises", "crisis", "criteria", "criterion", "critic", "critical", "critically",
  "criticism", "criticize", "critics", "crop", "crops", "cross", "crossing", "crowd", "crowded", "crowds", "crown", "crucial",
  "crucially", "crude", "cruel", "crush", "cry", "crying", "crystal", "cues", "cuisine", "cultivate", "cultivation", "cultural",
  "culturally", "culture", "cultures", "cup", "cups", "cure", "curiosity", "curious", "currencies", "currency", "current", "currently",
  "curricula", "curriculum", "curriculums", "curtain", "curtains", "curve", "cushion", "custom", "customer", "customers", "customs", "cut",
  "cuts", "cutting", "cyberattacks", "cyberbullying", "cybercrime", "cycle", "cycles", "daily", "dairy", "dam", "damage", "damaged",
  "damages", "damaging", "damp", "dance", "dancer", "dancers", "dancing", "danger", "dangerous", "dangerously", "dangers", "dare",
  "dark", "darkness", "darling", "dash", "data", "database", "date", "dates", "daughter", "daughters", "dawn", "day",
  "days", "dead", "deadline", "deadlines", "deaf", "deal", "dealing", "deals", "dealt", "dear", "death", "deaths",
  "debate", "debated", "debates", "debris", "debt", "debts", "decade", "decades", "decay", "december", "decent", "decentralize",
  "decentralizing", "decide", "decided", "decides", "deciding", "decision", "decisions", "deck", "declaration", "declare", "decline", "declined",
  "declines", "declining", "decomposing", "decorate", "decoration", "decorations", "decrease", "decreased", "decreases", "decreasing", "dedicate", "dedicated",
  "dedication", "deed", "deeds", "deep", "deeper", "deeply", "deer", "defeat", "defend", "defendant", "defense", "defensive",
  "deficiency", "deficit", "define", "defined", "defines", "defining", "definite", "definitely", "definition", "definitions", "deforestation", "defy",
  "degradation", "degrading", "degree", "degrees", "delay", "delayed", "delaying", "delays", "deliberate", "deliberately", "delicate", "delicious",
  "delight", "delighted", "deliver", "delivered", "deliveries", "delivering", "delivers", "delivery", "demand", "demanding", "demands", "democracy",
  "democratic", "demolish", "demonstrate", "demonstrated", "demonstrates", "demonstration", "denial", "denied", "denies", "denote", "dense", "density",
  "dentist", "dentists", "deny", "denying", "depart", "department", "departments", "departure", "departures", "depend", "depended", "dependence",
  "dependency", "dependent", "depending", "depends", "depict", "depicted", "deploy", "deport", "deposit", "depress", "depressed", "depressing",
  "depression", "deprive", "deprived", "depth", "depths", "derive", "derived", "descend", "descendant", "describe", "described", "describes",
  "describing", "description", "descriptions", "desert", "deserts", "deserve", "deserved", "deserves", "design", "designed", "designer", "designers",
  "designing", "designs", "desire", "desired", "desires", "desk", "desks", "despair", "desperate", "despite", "destination", "destinations",
  "destroy", "destroyed", "destroying", "destroys", "destruction", "destructive", "detach", "detail", "detailed", "details", "detain", "detect",
  "detected", "detective", "deter", "determination", "determine", "determined", "determines", "develop", "developed", "developing", "development", "developmental",
  "developments", "develops", "device", "devices", "devil", "devise", "devote", "devoted", "devotion", "diagnose", "diagnosis", "diagram",
  "diagrams", "dial", "dialect", "dialogue", "dialogues", "diamond", "diamonds", "diaries", "diary", "dictate", "dictionaries", "dictionary",
  "did", "die", "died", "dies", "diesel", "diet", "diets", "differ", "differed", "difference", "differences", "different",
  "differently", "differs", "difficult", "difficulties", "difficulty", "dig", "digest", "digestion", "digging", "digital", "dignity", "digs",
  "dilemma", "dilemmas", "diligent", "dim", "dimension", "dimensions", "diminished", "dining", "dinner", "dinners", "dinosaur", "dinosaurs",
  "dip", "direct", "direction", "directions", "directly", "director", "directors", "directory", "dirt", "dirty", "disabilities", "disability",
  "disabled", "disadvantage", "disadvantages", "disagree", "disagreeable", "disagreed", "disagreeing", "disagreement", "disagreements", "disagrees", "disappear", "disappearance",
  "disappoint", "disappointed", "disappointing", "disappointment", "disaster", "disasters", "disastrous", "disc", "discard", "discern", "discharge", "discipline",
  "disciplined", "disciplines", "disclose", "disclosure", "discount", "discounts", "discourage", "discouraged", "discouragement", "discourages", "discouraging", "discourse",
  "discover", "discovered", "discoveries", "discovering", "discovery", "discretion", "discriminate", "discrimination", "discs", "discuss", "discussed", "discusses",
  "discussing", "discussion", "discussions", "disease", "diseases", "disgrace", "disguise", "disgust", "dish", "dishes", "disincentives", "dislike",
  "disliked", "dislikes", "dismiss", "disney", "disorder", "disorders", "dispatch", "displace", "display", "displays", "disposal", "dispose",
  "dispute", "disputes", "disrupt", "disrupted", "disruption", "disruptions", "dissolve", "distance", "distances", "distant", "distract", "distracted",
  "distracting", "distraction", "distractions", "distracts", "distribute", "distributed", "distribution", "district", "districts", "distrust", "disturb", "disturbance",
  "disturbed", "dive", "diverse", "diversity", "divert", "diverts", "divide", "divided", "dividers", "dividing", "division", "divorce",
  "do", "dock", "doctor", "doctors", "doctrine", "document", "documentaries", "documentary", "documents", "does", "dog", "dogs",
  "doing", "doll", "dollar", "dollars", "dolls", "domain", "domains", "domestic", "dominant", "dominate", "donation", "donations",
  "done", "donor", "donors", "door", "doors", "doorway", "dose", "dot", "dots", "double", "doubt", "doubtful",
  "doubts", "down", "downtown", "downward", "draft", "drag", "dragon", "dragons", "drain", "drama", "dramas", "dramatic",
  "dramatically", "drank", "draw", "drawback", "drawbacks", "drawing", "drawings", "drawn", "draws", "dread", "dreadful", "dream",
  "dreamed", "dreams", "dreamt", "dress", "dressed", "dresses", "dressing", "drew", "drift", "drill", "drink", "drinking",
  "drinks", "drip", "drive", "driven", "driver", "drivers", "drives", "driving", "drop", "dropped", "dropping", "drops",
  "drought", "droughts", "drove", "drown", "drowned", "drug", "drugs", "drum", "drums", "drunk", "dry", "dual",
  "duck", "ducks", "due", "dull", "dumb", "dump", "durable", "during", "dust", "dusty", "duties", "duty",
  "dwell", "dwelling", "dying", "dynamic", "each", "eager", "eagle", "ear", "earlier", "earliest", "early", "earn",
  "earned", "earning", "earnings", "earns", "ears", "earth", "earthquake", "earthquakes", "ease", "easier", "easiest", "easily",
  "east", "eastern", "easy", "eat", "eaten", "eating", "eats", "echo", "ecological", "ecology", "economic", "economical",
  "economics", "economies", "economy", "ecosystems", "edge", "edges", "edit", "edition", "editions", "editor", "editorial", "editors",
  "educate", "educated", "educating", "education", "educational", "educator", "educators", "eel", "eels", "effect", "effective", "effectively",
  "effectiveness", "effects", "efficiency", "efficient", "efficiently", "effort", "efforts", "egg", "eggs", "eight", "eighteen", "eighth",
  "eighty", "either", "elaborate", "elbow", "elder", "elderly", "elect", "election", "elections", "electric", "electrical", "electricity",
  "electronic", "elegant", "element", "elementary", "elements", "elephant", "elephants", "elevated", "elevation", "eleven", "eleventh", "eliminate",
  "elimination", "elite", "else", "elsewhere", "email", "emails", "embarrass", "embarrassed", "embarrassing", "embarrassment", "embassy", "embrace",
  "emerge", "emerged", "emergence", "emergencies", "emergency", "emission", "emissions", "emotion", "emotional", "emotionally", "emotions", "empathy",
  "emperor", "emphasis", "emphasize", "emphasized", "emphasizes", "empire", "employ", "employee", "employees", "employer", "employers", "employment",
  "empty", "en", "enable", "enabled", "enables", "enabling", "encourage", "encouraged", "encourages", "encouraging", "end", "energy",
  "enforce", "enforcement", "engage", "engaged", "engagement", "engaging", "engine", "engineer", "engineering", "engineers", "engines", "english",
  "enjoy", "enjoyable", "enjoyed", "enjoying", "enjoyment", "enjoys", "enlarge", "enormous", "enough", "enroll", "enrollment", "ensure",
  "ensured", "ensures", "ensuring", "enter", "entered", "entering", "enterprise", "enterprises", "enters", "entertain", "entertainment", "enthusiasm",
  "enthusiastic", "entire", "entirely", "entitle", "entrance", "entrepreneurs", "entries", "entry", "envelope", "envelopes", "environment", "environmental",
  "environmentalists", "environmentally", "environments", "envy", "epidemic", "episode", "episodes", "equal", "equality", "equally", "equation", "equations",
  "equip", "equipment", "equipped", "equivalent", "era", "eras", "erase", "erect", "errand", "errands", "error", "errors",
  "escape", "escaped", "escapes", "escaping", "especially", "essay", "essays", "essence", "essential", "essentially", "establish", "established",
  "establishes", "establishment", "estate", "estimate", "estimated", "estimates", "etc", "eternal", "ethical", "ethics", "ethnic", "euro",
  "europe", "european", "evaluate", "evaluated", "evaluates", "evaluating", "evaluation", "evaluations", "evaporate", "evaporation", "eve", "even",
  "evening", "evenings", "event", "events", "eventual", "eventually", "ever", "every", "everybody", "everyday", "everyone", "everything",
  "everywhere", "evidence", "evident", "evidently", "evil", "evolution", "evolve", "ex", "exact", "exactly", "exaggerate", "exaggeration",
  "exam", "examination", "examinations", "examine", "examined", "examiner", "examiners", "examines", "examining", "example", "examples", "exams",
  "exasperate", "exceed", "excel", "excellent", "except", "exception", "exceptional", "exceptions", "excess", "excessive", "exchange", "exchanged",
  "exchanges", "exchanging", "excite", "excited", "excitement", "exciting", "exclude", "exclusion", "exclusive", "exclusively", "excursion", "excursions",
  "excuse", "excuses", "execute", "execution", "executive", "executives", "exempt", "exercise", "exercised", "exercises", "exercising", "exert",
  "exhale", "exhaust", "exhausted", "exhausting", "exhibit", "exhibition", "exhibitions", "exhibits", "exile", "exist", "existed", "existence",
  "existences", "existing", "exists", "exit", "exits", "exotic", "expand", "expanded", "expanding", "expands", "expansion", "expect",
  "expectation", "expectations", "expected", "expecting", "expects", "expedition", "expeditions", "expel", "expenditure", "expense", "expenses", "expensive",
  "experience", "experienced", "experiences", "experiencing", "experiment", "experimental", "experiments", "expert", "expertise", "experts", "explain", "explained",
  "explaining", "explains", "explanation", "explanations", "explicit", "explicitly", "explode", "exploit", "exploration", "explore", "explored", "explorer",
  "explorers", "exploring", "explosion", "explosions", "export", "exports", "expose", "exposed", "exposes", "exposure", "express", "expressed",
  "expression", "expressions", "expressive", "exquisite", "extend", "extended", "extending", "extension", "extensive", "extent", "exterior", "external",
  "extinct", "extinction", "extra", "extract", "extraordinary", "extravagant", "extreme", "extremely", "eye", "eyes", "fabric", "fabrics",
  "face", "facebook", "faced", "faces", "facilitate", "facilities", "facility", "facing", "fact", "factor", "factories", "factors",
  "factory", "facts", "faculties", "faculty", "fade", "faded", "fades", "fading", "fail", "failed", "failing", "fails",
  "failure", "failures", "faint", "fair", "fairly", "fairy", "faith", "faithful", "fake", "fall", "fallen", "falling",
  "falls", "false", "fame", "familiar", "families", "family", "famine", "famines", "famous", "fan", "fancy", "fans",
  "fantastic", "far", "fare", "fares", "farewell", "farm", "farmer", "farmers", "farming", "farms", "farther", "farthest",
  "fascinate", "fascinating", "fascination", "fashion", "fashionable", "fast", "fasten", "faster", "fastest", "fat", "fatal", "fate",
  "father", "fathers", "fatigue", "fault", "faults", "favor", "favorable", "favorite", "favorites", "favors", "favour", "fear",
  "fearful", "fears", "feasible", "feast", "feat", "feather", "feathers", "feature", "features", "february", "fed", "federal",
  "fee", "feeble", "feed", "feedback", "feeding", "feeds", "feel", "feeling", "feelings", "feels", "fees", "feet",
  "fell", "fellow", "felt", "female", "females", "feminine", "fence", "fences", "ferry", "fertile", "fertilizer", "fertilizers",
  "festival", "festivals", "fetch", "fever", "few", "fewer", "fewest", "fiber", "fibers", "fiction", "field", "fields",
  "fierce", "fifteen", "fifth", "fifty", "fig", "fight", "fighter", "fighters", "fighting", "fights", "figure", "figures",
  "file", "files", "fill", "filled", "filling", "fills", "film", "films", "filter", "filters", "filthy", "final",
  "finally", "finance", "finances", "financial", "financially", "find", "finding", "findings", "finds", "fine", "finger", "fingers",
  "finish", "finished", "finishes", "finishing", "finite", "fir", "fire", "fired", "fireplace", "fires", "fireworks", "firing",
  "firm", "firmly", "firms", "first", "firstly", "fish", "fishes", "fishing", "fist", "fists", "fit", "fitness",
  "fits", "fitted", "fitting", "five", "fix", "fixed", "fixes", "fixing", "fixture", "flag", "flags", "flame",
  "flames", "flap", "flash", "flat", "flavor", "flavors", "flaw", "flaws", "fled", "flee", "fleeing", "flees",
  "fleet", "flesh", "flew", "flexibility", "flexible", "flicker", "flies", "flight", "flights", "float", "flock", "flood",
  "flooded", "floods", "floor", "floors", "flour", "flow", "flowed", "flower", "flowers", "flowing", "flown", "flows",
  "flu", "fluency", "fluent", "fluid", "flush", "flute", "fly", "flying", "foam", "focus", "focused", "focuses",
  "focusing", "foe", "foes", "fog", "foggy", "fold", "folded", "folds", "foliage", "folk", "folklore", "follow",
  "followed", "follower", "followers", "following", "follows", "fond", "food", "foods", "fool", "foolish", "fools", "foot",
  "football", "footnote", "footnotes", "for", "forbade", "forbid", "forbidden", "forbids", "force", "forced", "forces", "forcing",
  "forecast", "forecasts", "forehead", "foreign", "foreigner", "foreigners", "forest", "forests", "forever", "forgave", "forge", "forget",
  "forgetful", "forgive", "forgiven", "forgives", "forgiving", "fork", "forks", "form", "formal", "formally", "format", "formation",
  "formations", "formats", "formed", "former", "formerly", "forming", "forms", "formula", "formulae", "formulas", "fort", "forth",
  "fortnight", "fortunate", "fortunately", "fortune", "fortunes", "forty", "forward", "fossil", "fossils", "foster", "fought", "foul",
  "found", "foundation", "foundations", "founder", "fountain", "four", "fourteen", "fourth", "fraction", "frail", "frame", "frames",
  "framework", "frameworks", "frank", "frankly", "fraud", "free", "freedom", "freedoms", "freelancers", "freely", "freeze", "freezes",
  "freight", "french", "frequencies", "frequency", "frequent", "frequently", "fresh", "freshly", "freshwater", "friction", "friday", "friend",
  "friendly", "friends", "friendship", "friendships", "fright", "frighten", "frightened", "frightening", "frog", "frogs", "from", "front",
  "frontier", "frontiers", "frost", "frown", "froze", "frozen", "fruit", "fruits", "frustrate", "frustrated", "frustrating", "frustration",
  "frustrations", "fry", "fuel", "fuels", "fulfill", "fulfilled", "fulfilling", "fulfillment", "full", "fully", "fume", "fumes",
  "fun", "function", "functional", "functions", "fund", "fundamental", "fundamentally", "funds", "funeral", "funerals", "funny", "fur",
  "furious", "furnace", "furnish", "furniture", "further", "furthermore", "fury", "fuse", "fuss", "future", "futures", "gain",
  "gained", "gaining", "gains", "gale", "gales", "galleries", "gallery", "gallon", "gallons", "gamble", "gambling", "game",
  "games", "gaming", "gang", "gangs", "gap", "gaps", "garage", "garages", "garden", "gardener", "gardens", "garlic",
  "garment", "garments", "gas", "gases", "gasoline", "gasp", "gate", "gates", "gather", "gathered", "gathering", "gathers",
  "gauge", "gave", "gay", "gaze", "gear", "gears", "geese", "gem", "gemini", "gems", "gender", "general",
  "generally", "generate", "generated", "generates", "generating", "generation", "generations", "generosity", "generous", "genius", "geniuses", "gentle",
  "gentleman", "gently", "genuine", "genuinely", "geographical", "geography", "geology", "germ", "germs", "gesture", "gestures", "get",
  "gets", "getting", "ghost", "ghosts", "giant", "giants", "gift", "gifted", "gifts", "gigantic", "girl", "girls",
  "give", "given", "gives", "giving", "glad", "glance", "glances", "glass", "glasses", "gleam", "glide", "glimpse",
  "glitch", "glitches", "glitter", "global", "globalization", "globalized", "globally", "globe", "gloom", "gloomy", "glorious", "glory",
  "glove", "gloves", "glow", "glue", "go", "goal", "goals", "goat", "goats", "god", "goddess", "gods",
  "goes", "going", "gold", "golden", "golf", "gone", "good", "goodbye", "goodness", "goods", "google", "goose",
  "gossip", "got", "gotten", "govern", "governess", "governing", "government", "governmental", "governments", "governor", "governors", "gown",
  "gowns", "grace", "graceful", "grade", "graded", "grades", "grading", "gradual", "gradually", "graduate", "graduated", "graduates",
  "graduating", "graduation", "grain", "grains", "grammar", "grammarly", "grammatical", "grand", "grandchild", "grandchildren", "granddaughter", "grandfather",
  "grandmother", "grandparent", "grandparents", "grandson", "granite", "grant", "granted", "grants", "grape", "grapes", "grasp", "grass",
  "grasshopper", "grateful", "gratefully", "grave", "graves", "gravity", "gray", "grease", "great", "greater", "greatest", "greatly",
  "greed", "greedy", "greek", "green", "greet", "greeted", "greeting", "greetings", "greets", "grew", "gridlock", "gridlocks",
  "grief", "grieve", "grim", "grin", "grind", "grip", "groan", "grocer", "groceries", "grocery", "groove", "gross",
  "ground", "grounds", "group", "grouped", "grouping", "groups", "grove", "grow", "growing", "grown", "grows", "growth",
  "growths", "grumble", "guarantee", "guaranteed", "guarantees", "guard", "guardian", "guards", "guess", "guessed", "guesses", "guessing",
  "guest", "guests", "guidance", "guide", "guided", "guideline", "guidelines", "guides", "guiding", "guilt", "guilty", "guitar",
  "gulf", "gum", "gun", "guns", "gust", "gym", "gymnasium", "habit", "habitat", "habitats", "habits", "hacking",
  "had", "hail", "hair", "haircut", "hairs", "half", "hall", "halls", "halt", "halves", "ham", "hammer",
  "hand", "handed", "handful", "handicap", "handicapped", "handing", "handkerchief", "handle", "handled", "handles", "handling", "hands",
  "handsome", "handwriting", "handy", "hang", "hanging", "hangs", "happen", "happened", "happening", "happens", "happily", "happiness",
  "happings", "happy", "harbor", "harbors", "hard", "harder", "hardest", "hardly", "hardship", "hardships", "hardware", "hare",
  "hares", "harm", "harmed", "harmful", "harming", "harmless", "harmonious", "harmony", "harms", "harness", "harsh", "harvest",
  "harvests", "has", "haste", "hasten", "hasty", "hat", "hate", "hated", "hates", "hating", "hatred", "hats",
  "haul", "have", "having", "hawk", "hawks", "hay", "hazard", "hazardous", "hazards", "he", "head", "headache",
  "headaches", "headed", "heading", "headings", "headline", "headlines", "headquarters", "heads", "heal", "healed", "healing", "health",
  "healthcare", "healthier", "healthiest", "healthy", "heap", "heaps", "hear", "heard", "hearing", "hears", "hearse", "heart",
  "hearts", "heat", "heated", "heater", "heaters", "heating", "heaven", "heavens", "heavier", "heaviest", "heavily", "heavy",
  "hedge", "hedges", "heel", "heels", "height", "heights", "heir", "heirs", "held", "helicopter", "helicopters", "hell",
  "hello", "helmet", "helmets", "help", "helped", "helper", "helpers", "helpful", "helping", "helpless", "helps", "hem",
  "hemispheres", "hen", "hence", "hens", "her", "herb", "herbs", "herd", "herds", "here", "hereafter", "hereby",
  "heritage", "hero", "heroes", "heroic", "heroine", "hers", "herself", "hesitate", "hesitated", "hesitating", "hesitation", "hey",
  "hid", "hidden", "hide", "hides", "hiding", "high", "higher", "highest", "highlight", "highlighting", "highly", "highway",
  "highways", "hill", "hills", "hilly", "him", "himself", "hind", "hinder", "hindrance", "hint", "hints", "hip",
  "hips", "hire", "hired", "hiring", "his", "historian", "historians", "historic", "historical", "historically", "histories", "history",
  "hit", "hitherto", "hits", "hitting", "hive", "hives", "hobbies", "hobby", "hoe", "hoes", "hold", "holder",
  "holders", "holding", "holds", "hole", "holes", "holiday", "holidays", "hollow", "holy", "home", "homeland", "homes",
  "homeschooling", "homesickness", "homework", "honest", "honesty", "honey", "honor", "honors", "honour", "honoured", "honours", "hood",
  "hook", "hooks", "hop", "hope", "hoped", "hopeful", "hopeless", "hopes", "hoping", "hopping", "horizon", "horizons",
  "horn", "horns", "horrible", "horror", "horrors", "horse", "horses", "hospital", "hospitals", "host", "hostess", "hostile",
  "hostility", "hosts", "hot", "hotel", "hotels", "hotter", "hottest", "hour", "hourly", "hours", "house", "housed",
  "household", "households", "houses", "housewife", "housewives", "housework", "housing", "how", "however", "howl", "hug", "huge",
  "hugs", "human", "humanity", "humans", "humble", "humid", "humidity", "humiliate", "humor", "humorous", "humour", "hundred",
  "hundreds", "hung", "hunger", "hungry", "hunt", "hunted", "hunter", "hunters", "hunting", "hunts", "hurdle", "hurdles",
  "hurl", "hurricane", "hurried", "hurry", "hurrying", "hurt", "hurting", "hurts", "husband", "husbands", "hut", "huts",
  "hydrogen", "hydropower", "hygiene", "hymn", "hypocrisy", "hypotheses", "hypothesis", "i", "ice", "icy", "id", "idea",
  "ideal", "ideals", "ideas", "identification", "identified", "identifies", "identify", "identifying", "identities", "identity", "idiom", "idiomatic",
  "idioms", "idle", "idol", "if", "ignorance", "ignorant", "ignore", "ignored", "ignores", "ignoring", "ill", "illegal",
  "illegally", "illiteracy", "illness", "illnesses", "illuminate", "illusion", "illusions", "illustrate", "illustrated", "illustrates", "illustration", "illustrations",
  "image", "images", "imagination", "imaginative", "imagine", "imagined", "imagining", "imitate", "imitation", "immediacy", "immediate", "immediately",
  "immense", "immensely", "immigrant", "immigrants", "immigration", "imminent", "immoral", "immortality", "immune", "immunity", "impact", "impacted",
  "impacts", "impair", "impartial", "impatience", "impatient", "imperative", "imperfect", "imperial", "implement", "implementation", "implemented", "implementing",
  "implication", "implications", "implied", "implies", "implore", "imply", "implying", "import", "importance", "important", "importantly", "imported",
  "imports", "impose", "imposed", "imposes", "imposing", "impossibility", "impossible", "impress", "impressed", "impression", "impressions", "impressive",
  "imprison", "imprisonment", "improbable", "improper", "improve", "improved", "improvement", "improvements", "improves", "improving", "impulse", "impulses",
  "in", "inadequacy", "inadequate", "inappropriate", "inaugurate", "incapable", "incense", "incentive", "incentives", "inception", "inch", "inches",
  "incident", "incidental", "incidentally", "incidents", "inclination", "incline", "inclined", "include", "included", "includes", "including", "inclusion",
  "income", "incomes", "incomparable", "incompatible", "incompetent", "incomplete", "inconceivable", "inconsistent", "inconvenience", "inconveniences", "inconvenient", "incorporate",
  "incorrect", "incorrectly", "increase", "increased", "increases", "increasing", "increasingly", "incredible", "incredibly", "incur", "indeed", "indefinite",
  "indefinitely", "independence", "independent", "independently", "index", "indexes", "india", "indian", "indicate", "indicated", "indicates", "indicating",
  "indication", "indications", "indicator", "indicators", "indices", "indifference", "indifferent", "indigenous", "indignant", "indignation", "indirect", "indirectly",
  "indiscretion", "indispensable", "individual", "individuals", "induce", "indulge", "indulgence", "industrial", "industrialization", "industries", "industry", "ineffective",
  "inefficient", "inefficiently", "inequalities", "inevitable", "inevitably", "inexpensive", "infancy", "infant", "infants", "infect", "infection", "infections",
  "infectious", "infer", "inferior", "inferiority", "infinite", "inflation", "influence", "influenced", "influencers", "influences", "influencing", "influential",
  "influenza", "inform", "informal", "informally", "informant", "information", "informed", "informing", "infrastructure", "infrequent", "infringe", "infringement",
  "ingenious", "ingenuity", "ingredient", "ingredients", "inhabit", "inhabitant", "inhabitants", "inherent", "inherently", "inherit", "inheritance", "inherited",
  "inhibit", "inhibition", "initial", "initially", "initiate", "initiative", "initiatives", "inject", "injection", "injure", "injured", "injuries",
  "injury", "injustice", "ink", "inland", "inmate", "inmates", "inn", "inner", "innocence", "innocent", "innovate", "innovation",
  "innovations", "innovative", "inns", "innumerable", "inoculate", "input", "inputs", "inquire", "inquiries", "inquiry", "insane", "insanity",
  "inscribe", "inscription", "insect", "insects", "insecurity", "insert", "inserted", "insertion", "inside", "insight", "insights", "insignificant",
  "insist", "insisted", "insistent", "insists", "insolent", "inspect", "inspection", "inspections", "inspector", "inspectors", "inspiration", "inspirations",
  "inspire", "inspired", "inspires", "inspiring", "instagram", "install", "installation", "installed", "installing", "instance", "instances", "instant",
  "instantly", "instead", "instinct", "instinctive", "instincts", "institute", "institutes", "institution", "institutions", "instruct", "instructed", "instruction",
  "instructions", "instructive", "instructor", "instructors", "instrument", "instruments", "insufficient", "insult", "insulted", "insults", "insurance", "insure",
  "insurgent", "insurmountable", "intact", "intake", "integrate", "integrated", "integration", "integrity", "intellect", "intellectual", "intelligence", "intelligent",
  "intend", "intended", "intending", "intends", "intense", "intent", "intention", "intentional", "intentionally", "intentions", "intents", "interact",
  "interacted", "interacting", "interaction", "interactions", "interactive", "interacts", "intercept", "interchange", "interconnected", "intercourse", "interest", "interested",
  "interesting", "interestingly", "interests", "interfere", "interference", "interior", "intermediate", "intermittent", "internal", "internally", "international", "internationally",
  "internet", "interpersonal", "interpret", "interpretation", "interpretations", "interpreter", "interrupt", "interrupted", "interruption", "interruptions", "intersections", "interval",
  "intervals", "intervene", "intervention", "interventions", "interview", "interviewed", "interviewing", "interviews", "intimacy", "intimate", "into", "intolerable",
  "intolerance", "intolerant", "intoxicate", "intricate", "intrigue", "intrinsic", "intrinsically", "intro", "introduce", "introduced", "introduces", "introducing",
  "introduction", "introductions", "intrude", "intrusion", "intuition", "invade", "invader", "invaders", "invalid", "invaluable", "invariable", "invariably",
  "invasion", "invent", "invented", "invention", "inventions", "inventor", "inventors", "inventory", "inverse", "invert", "invest", "invested",
  "investigate", "investigated", "investigating", "investigation", "investigations", "investigator", "investigators", "investing", "investment", "investments", "investor", "investors",
  "invisible", "invitation", "invitations", "invite", "invited", "invites", "inviting", "invoice", "invoices", "invoke", "invoked", "involuntary",
  "involve", "involved", "involvement", "involves", "involving", "inward", "inwards", "iron", "irony", "irresponsible", "irrigate", "irrigation",
  "irritate", "irritated", "irritating", "irritation", "is", "island", "islands", "isolate", "isolated", "isolates", "isolating", "isolation",
  "issue", "issued", "issues", "it", "italian", "item", "items", "its", "itself", "ivory", "jacket", "jackets",
  "jail", "jails", "jam", "jams", "january", "japan", "japanese", "jar", "jars", "jaw", "jaws", "jazz",
  "jealous", "jealousy", "jeans", "jelly", "jeopardize", "jeopardy", "jerk", "jet", "jets", "jewel", "jewelry", "jewels",
  "job", "jobrelated", "jobs", "join", "joined", "joining", "joins", "joint", "joints", "joke", "jokes", "journal",
  "journalism", "journalist", "journalists", "journals", "journey", "journeys", "joy", "joyful", "joys", "judge", "judged", "judgements",
  "judges", "judging", "judgment", "judicial", "jug", "juice", "july", "jump", "jumped", "jumping", "jumps", "junction",
  "june", "jungle", "jungles", "junior", "juries", "jury", "just", "justice", "justification", "justified", "justifies", "justify",
  "justifying", "juvenile", "kahoot", "keen", "keep", "keeper", "keepers", "keeping", "keeps", "kept", "kettle", "key",
  "keys", "kick", "kicked", "kicking", "kicks", "kid", "kidnap", "kidnapped", "kidney", "kidneys", "kids", "kill",
  "killed", "killer", "killers", "killing", "kills", "kilogram", "kilograms", "kilometer", "kilometers", "kin", "kind", "kinder",
  "kindest", "kindly", "kindness", "kinds", "king", "kingdom", "kingdoms", "kings", "kiss", "kissed", "kisses", "kissing",
  "kitchen", "kitchens", "kite", "kites", "kitten", "kittens", "knee", "kneel", "kneels", "knees", "knelt", "knew",
  "knife", "knight", "knights", "knit", "knits", "knitted", "knitting", "knives", "knob", "knobs", "knock", "knocked",
  "knocking", "knocks", "knot", "knots", "know", "knowing", "knowledge", "known", "knows", "lab", "label", "labeled",
  "labels", "labor", "laboratories", "laboratory", "labour", "labs", "lace", "lack", "lacked", "lacking", "lacks", "lad",
  "ladder", "ladders", "ladies", "lads", "lady", "lag", "laid", "lain", "lake", "lakes", "lamb", "lambs",
  "lame", "lament", "lamp", "lamps", "land", "landed", "landing", "landlord", "landlords", "landmark", "landmarks", "lands",
  "landscape", "landscapes", "landslides", "lane", "lanes", "language", "languages", "lantern", "lanterns", "lap", "laps", "lapse",
  "laptop", "laptops", "large", "largely", "larger", "largest", "lark", "laser", "lasers", "last", "lastly", "lasts",
  "late", "lately", "latent", "later", "latest", "latitude", "latter", "laugh", "laughed", "laughing", "laughs", "laughter",
  "launch", "launched", "launching", "laundry", "laurel", "lavish", "law", "lawful", "lawn", "lawns", "laws", "lawyer",
  "lawyers", "lay", "layer", "layers", "laying", "lays", "laziness", "lazy", "lead", "leader", "leaders", "leadership",
  "leading", "leads", "leaf", "leaflet", "leaflets", "league", "leagues", "leak", "leaked", "leaking", "leaks", "lean",
  "leaned", "leaning", "leans", "leant", "leap", "leaped", "leaping", "leaps", "leapt", "learn", "learned", "learner",
  "learners", "learning", "learns", "learnt", "lease", "least", "leather", "leave", "leaves", "leaving", "lecture", "lectured",
  "lecturer", "lecturers", "lectures", "lecturing", "led", "ledge", "lee", "leek", "leeks", "left", "leg", "legal",
  "legally", "legend", "legendary", "legends", "legislation", "legislative", "legs", "leisure", "lemon", "lemons", "lend", "lending",
  "lends", "length", "lengthen", "lengths", "lenient", "lens", "lenses", "lent", "leopard", "leopards", "less", "lessen",
  "lesson", "lessons", "lest", "let", "lets", "letter", "letters", "letting", "level", "levels", "lever", "levers",
  "levy", "liabilities", "liability", "liable", "liar", "liars", "liberal", "liberate", "liberties", "liberty", "librarian", "librarians",
  "libraries", "library", "licence", "licences", "license", "licensed", "licenses", "lick", "licked", "licking", "licks", "lid",
  "lids", "lie", "lied", "lies", "life", "lifelong", "lifestyle", "lifestyles", "lifetime", "lift", "lifted", "lifting",
  "lifts", "light", "lighted", "lighter", "lightest", "lighting", "lightly", "lightning", "lights", "like", "liked", "likelihood",
  "likely", "likes", "likewise", "liking", "limb", "limbs", "lime", "limes", "limit", "limitation", "limitations", "limited",
  "limiting", "limits", "limp", "line", "linear", "lined", "lines", "linger", "linguistic", "linguistics", "lining", "link",
  "linked", "linking", "links", "lion", "lions", "lip", "lips", "liquid", "liquids", "liquor", "list", "listed",
  "listen", "listened", "listener", "listeners", "listening", "listens", "listing", "lists", "lit", "literacy", "literal", "literally",
  "literary", "literate", "literature", "litter", "litters", "little", "live", "lived", "livelihood", "lively", "liver", "livers",
  "lives", "livestock", "living", "lizard", "lizards", "load", "loaded", "loading", "loads", "loaf", "loan", "loans",
  "loath", "loathe", "loaves", "lobbies", "lobby", "local", "locally", "locate", "located", "locates", "locating", "location",
  "locations", "lock", "locked", "locking", "locks", "locomotive", "locomotives", "locust", "locusts", "lodge", "lodges", "lodging",
  "loft", "log", "logic", "logical", "logically", "logs", "lone", "loneliness", "lonely", "long", "longer", "longest",
  "longitude", "look", "looked", "looking", "looks", "loom", "loop", "loops", "loose", "loosely", "loosen", "lord",
  "lords", "lorries", "lorry", "lose", "loser", "losers", "loses", "losing", "loss", "losses", "lost", "lot",
  "lotion", "lotions", "lots", "loud", "loudly", "lounge", "love", "loved", "lovely", "lover", "lovers", "loves",
  "loving", "low", "lower", "lowering", "lowers", "lowest", "loyal", "loyalties", "loyalty", "lubricate", "luck", "luckily",
  "lucky", "lucrative", "luggage", "lumber", "lump", "lumps", "lunar", "lunch", "lunches", "lung", "lungs", "lure",
  "lurk", "lust", "luxuries", "luxurious", "luxury", "lying", "lyrics", "machine", "machinery", "machines", "mad", "madam",
  "made", "madness", "magazine", "magazines", "magic", "magical", "magistrate", "magnet", "magnetic", "magnets", "magnificent", "magnify",
  "magnitude", "maid", "maids", "mail", "mailbox", "mailboxes", "main", "mainland", "mainly", "maintain", "maintained", "maintaining",
  "maintains", "maintenance", "majesty", "major", "majorities", "majority", "make", "maker", "makers", "makes", "making", "maladies",
  "malady", "malaria", "male", "males", "malfunction", "malfunctioning", "malfunctions", "malice", "malicious", "mammal", "mammals", "man",
  "manage", "managed", "management", "manager", "managers", "manages", "managing", "mandate", "mandates", "mandatory", "manifest", "manifestation",
  "manipulate", "manipulation", "mankind", "manner", "manners", "manor", "manors", "mansion", "mansions", "manual", "manually", "manufacture",
  "manufactured", "manufacturer", "manufacturers", "manufacturing", "manuscript", "manuscripts", "many", "map", "maple", "maps", "marble", "marbles",
  "march", "marching", "margin", "marginal", "margins", "marine", "mark", "marked", "market", "marketing", "marketplace", "markets",
  "marking", "marks", "marriage", "marriages", "married", "marries", "marry", "marrying", "mars", "marsh", "marshes", "martial",
  "marvel", "marvelous", "masculine", "mask", "masks", "mass", "masses", "massive", "mast", "master", "masterpiece", "masterpieces",
  "masters", "mastery", "masts", "mat", "match", "matched", "matches", "matching", "mate", "material", "materials", "maternal",
  "mates", "math", "mathematical", "mathematics", "maths", "matrimony", "mats", "matter", "mattered", "matters", "mature", "maturity",
  "maximizing", "maximum", "may", "maybe", "mayor", "mayors", "me", "meadow", "meadows", "meal", "meals", "mean",
  "meaning", "meaningful", "meaningless", "meanings", "means", "meant", "meantime", "meanwhile", "measure", "measured", "measurement", "measurements",
  "measures", "measuring", "meat", "meats", "mechanic", "mechanical", "mechanics", "mechanism", "mechanisms", "medal", "medals", "media",
  "mediate", "mediation", "medical", "medication", "medicinal", "medicine", "medicines", "medieval", "mediocre", "meditate", "meditation", "medium",
  "meet", "meeting", "meetings", "meets", "melancholy", "melodies", "melody", "melon", "melons", "melt", "melted", "melting",
  "melts", "member", "members", "membership", "memberships", "memoir", "memoirs", "memorable", "memories", "memorize", "memorized", "memory",
  "men", "mental", "mentally", "mention", "mentioned", "mentioning", "mentions", "menu", "menus", "merchandise", "merchant", "merchants",
  "merciful", "merciless", "mercy", "merely", "merge", "merged", "merger", "mergers", "merit", "merits", "merry", "mess",
  "message", "messages", "messaging", "messenger", "messengers", "messy", "met", "metal", "metallic", "metals", "metaphor", "metaphors",
  "method", "methodical", "methodologies", "methodology", "methods", "metric", "metro", "metropolis", "metropolitan", "mexican", "mice", "microscope",
  "microscopes", "mid", "midday", "middle", "midnight", "midst", "might", "mighty", "migrant", "migrants", "migrate", "migration",
  "migrations", "mild", "mildly", "mile", "miles", "milestones", "military", "milk", "milky", "mill", "million", "millionaire",
  "millionaires", "millions", "mills", "mind", "minded", "mindful", "minding", "minds", "mine", "miner", "mineral", "minerals",
  "miners", "mines", "mingle", "miniature", "minimize", "minimized", "minimizes", "minimizing", "minimum", "minister", "ministers", "ministries",
  "ministry", "minor", "minorities", "minority", "mint", "minute", "minutes", "miracle", "miracles", "miraculous", "mirror", "mirrors",
  "mirth", "mischief", "mischievous", "miserable", "miseries", "misery", "misfortune", "misfortunes", "mislead", "misleading", "misleads", "misled",
  "miss", "missed", "misses", "missile", "missiles", "missing", "mission", "missionaries", "missionary", "missions", "mist", "mistake",
  "mistaken", "mistakes", "mistress", "mistresses", "misty", "misunderstand", "misunderstanding", "misunderstandings", "misunderstands", "misunderstood", "mitigate", "mix",
  "mixed", "mixes", "mixing", "mixture", "mixtures", "moan", "moans", "mob", "mobile", "mobs", "mock", "mode",
  "model", "models", "moderate", "moderately", "moderation", "modern", "modernize", "modernized", "modes", "modest", "modesty", "modification",
  "modifications", "modified", "modifies", "modify", "modifying", "moist", "moisture", "mold", "mole", "molecule", "molecules", "moles",
  "moment", "momentary", "momentous", "moments", "monarch", "monarchies", "monarchs", "monarchy", "monasteries", "monastery", "monday", "money",
  "monies", "monitor", "monitored", "monitoring", "monitors", "monkey", "monkeys", "monopolies", "monopoly", "monotonous", "monotony", "monster",
  "monsters", "monstrous", "month", "monthly", "months", "monument", "monumental", "monuments", "mood", "moods", "moody", "moon",
  "moonlight", "moral", "morality", "morally", "morals", "more", "moreover", "morning", "mornings", "mortal", "mortality", "mortgage",
  "mortgages", "mosque", "mosques", "moss", "most", "mostly", "mother", "motherhood", "mothers", "motif", "motifs", "motion",
  "motions", "motivate", "motivated", "motivates", "motivating", "motivation", "motivations", "motive", "motives", "motor", "motorbikes", "motorcycle",
  "motorcycles", "motorist", "motorists", "motors", "motto", "mottoes", "mottos", "mould", "mount", "mountain", "mountainous", "mountains",
  "mourn", "mournful", "mouse", "mouth", "mouths", "move", "moved", "movement", "movements", "moves", "movie", "movies",
  "moving", "much", "mud", "muddy", "mug", "mule", "mules", "multiple", "multiplied", "multiplies", "multiply", "multiplying",
  "multitasking", "multitude", "multitudes", "municipal", "murder", "murderer", "murderers", "murders", "murmur", "murmurs", "muscle", "muscles",
  "muscular", "museum", "museums", "music", "musical", "musician", "musicians", "must", "mustard", "mute", "mutter", "mutual",
  "my", "myself", "mysteries", "mysterious", "mysteriously", "mystery", "myth", "mythology", "myths", "n", "nail", "nails",
  "naked", "name", "named", "namely", "names", "naming", "nap", "napkin", "napkins", "narrative", "narratives", "narrow",
  "narrowly", "nasty", "nation", "national", "nationalities", "nationality", "nationally", "nations", "native", "natives", "natural", "naturally",
  "nature", "natures", "naval", "navies", "navigation", "navy", "near", "nearby", "nearly", "neat", "neatly", "necessarily",
  "necessary", "necessities", "necessity", "neck", "necklace", "necklaces", "necks", "need", "needed", "needing", "needle", "needles",
  "needs", "negative", "negatively", "neglect", "neglected", "neglecting", "negotiate", "negotiated", "negotiating", "negotiation", "negotiations", "negro",
  "negroes", "neighbor", "neighborhood", "neighborhoods", "neighbors", "neighbour", "neighbourhood", "neighbourhoods", "neighbours", "neither", "nephew", "nephews",
  "nerve", "nerves", "nervous", "nervously", "nest", "nests", "net", "netflix", "nets", "network", "networking", "networks",
  "neutral", "never", "nevertheless", "new", "newer", "newest", "newly", "news", "newspaper", "newspapers", "next", "nice",
  "nicely", "niche", "niches", "nickel", "niece", "nieces", "night", "nightmare", "nightmares", "nights", "nin", "nine",
  "nineteen", "ninety", "ninth", "no", "nobility", "noble", "nobles", "nobody", "nod", "nodded", "nodding", "nods",
  "noise", "noises", "noisily", "noisy", "nominal", "nominate", "nomination", "non", "none", "nonetheless", "nonsense", "noodle",
  "noodles", "noon", "nor", "normal", "normally", "north", "northern", "nose", "noses", "not", "note", "notebook",
  "notebooks", "noted", "notes", "nothing", "notice", "noticeable", "noticeably", "noticed", "notices", "noticing", "notification", "notifications",
  "notified", "notifies", "notify", "notifying", "noting", "notion", "notions", "noun", "nouns", "nourish", "nourishment", "novel",
  "novelist", "novelists", "novels", "november", "now", "nowadays", "nowhere", "nthe", "nthere", "nto", "nuclear", "nuisance",
  "nuisances", "null", "numb", "number", "numbered", "numbers", "numeral", "numerals", "numerous", "nun", "nuns", "nurse",
  "nurseries", "nursery", "nurses", "nut", "nutrients", "nutrition", "nutritional", "nutritious", "nuts", "oak", "oaks", "oar",
  "oars", "oat", "oath", "oaths", "oats", "obedience", "obedient", "obese", "obesity", "obey", "obeyed", "obeying",
  "obeys", "object", "objection", "objections", "objective", "objectives", "objects", "obligate", "obligation", "obligations", "oblige", "obliged",
  "obscure", "observable", "observance", "observation", "observations", "observe", "observed", "observer", "observers", "observes", "observing", "obstacle",
  "obstacles", "obstinate", "obtain", "obtained", "obtaining", "obvious", "obviously", "occasion", "occasional", "occasionally", "occasions", "occupation",
  "occupations", "occupied", "occupies", "occupy", "occupying", "occur", "occurred", "occurrence", "occurrences", "occurring", "occurs", "ocean",
  "oceans", "october", "odd", "odds", "odor", "odors", "odour", "odours", "of", "off", "offend", "offended",
  "offending", "offense", "offenses", "offensive", "offer", "offered", "offering", "offers", "office", "officer", "officers", "offices",
  "official", "officially", "offline", "offset", "offspring", "often", "oh", "oil", "oils", "oily", "ointment", "old",
  "older", "oldest", "olive", "olives", "omen", "omens", "omission", "omissions", "omit", "omits", "omitted", "omitting",
  "on", "once", "one", "ones", "ongoing", "onion", "onions", "online", "only", "onset", "onto", "open",
  "opened", "opening", "openly", "opens", "opera", "operate", "operated", "operates", "operating", "operation", "operational", "operations",
  "operator", "operators", "opinion", "opinions", "opponent", "opponents", "opportunities", "opportunity", "oppose", "opposed", "opposing", "opposite",
  "opposition", "oppress", "oppression", "optimism", "optimistic", "optimizes", "option", "optional", "options", "or", "oral", "orange",
  "oranges", "orbit", "orbits", "orchard", "orchards", "order", "ordered", "ordering", "orderly", "orders", "ordinarily", "ordinary",
  "organ", "organic", "organism", "organisms", "organization", "organizations", "organize", "organized", "organizes", "organizing", "organs", "orient",
  "oriental", "orientation", "origin", "original", "originally", "originate", "origins", "ornament", "ornaments", "orphan", "orphans", "other",
  "others", "otherwise", "ought", "ounce", "ounces", "our", "ours", "ourselves", "out", "outage", "outages", "outbreak",
  "outbreaks", "outcome", "outcomes", "outdated", "outdoor", "outdoors", "outer", "outlaw", "outlaws", "outlet", "outlets", "outline",
  "outlined", "outlines", "outlining", "outlook", "outlooks", "output", "outputs", "outrage", "outrageous", "outset", "outside", "outskirts",
  "outstanding", "outweigh", "oval", "oven", "ovens", "over", "overall", "overcame", "overcoat", "overcoats", "overcome", "overcomes",
  "overcoming", "overcrowding", "overland", "overlap", "overlaps", "overloaded", "overlook", "overlooked", "overlooking", "overnight", "overpopulation", "oversaw",
  "overseas", "oversee", "overseen", "oversees", "oversight", "overtake", "overtaken", "overtakes", "overthrow", "overtime", "overtook", "overuse",
  "overusing", "overweight", "overwhelm", "overwhelming", "owe", "owed", "owes", "owing", "owl", "owls", "own", "owned",
  "owner", "owners", "ownership", "owning", "owns", "ox", "oxen", "oxygen", "oyster", "oysters", "pace", "paces",
  "pacific", "pack", "package", "packages", "packed", "packet", "packets", "packing", "packs", "pad", "paddle", "paddles",
  "pads", "page", "pages", "pagodas", "paid", "pain", "painful", "painfully", "pains", "paint", "painted", "painter",
  "painters", "painting", "paintings", "paints", "pair", "pairs", "palace", "palaces", "pale", "palm", "palms", "pan",
  "pane", "panel", "panels", "panes", "panic", "panicked", "panics", "pans", "pant", "pantry", "pants", "paper",
  "papers", "par", "parade", "parades", "paragraph", "paragraphs", "parallel", "paralysis", "paralyze", "paraphrases", "parcel", "parcels",
  "pardon", "parent", "parental", "parentheses", "parenthesis", "parents", "parish", "parishes", "park", "parking", "parks", "parliament",
  "parlor", "parlors", "part", "partial", "partially", "participant", "participants", "participate", "participated", "participates", "participating", "participation",
  "particle", "particles", "particular", "particularly", "parties", "partisan", "partition", "partly", "partner", "partners", "partnership", "partnerships",
  "parts", "parttime", "party", "pass", "passage", "passages", "passed", "passenger", "passengers", "passes", "passing", "passion",
  "passionate", "passions", "passive", "passport", "passports", "past", "paste", "pastime", "pasture", "pastures", "pat", "patch",
  "patches", "patent", "patents", "path", "paths", "pathway", "patience", "patient", "patiently", "patients", "patriot", "patriotic",
  "patriots", "patron", "patrons", "pats", "patted", "pattern", "patterned", "patterns", "pause", "paused", "pauses", "pausing",
  "pave", "pavement", "pavements", "paw", "paws", "pay", "paying", "payment", "payments", "pays", "peace", "peaceful",
  "peacefully", "peach", "peaches", "peacock", "peacocks", "peak", "peaks", "pear", "pearl", "pearls", "pears", "peasant",
  "peasants", "pebble", "pebbles", "peculiar", "peculiarities", "peculiarity", "pedestrian", "pedestrians", "peel", "peels", "peep", "peer",
  "peered", "peering", "peers", "pen", "penalties", "penalty", "pencil", "pencils", "penetrate", "penetration", "penguin", "penguins",
  "peninsula", "peninsulas", "pennies", "penny", "pens", "pension", "pensions", "people", "peoples", "pepper", "peppers", "per",
  "perceive", "perceived", "percent", "percentage", "percentages", "perception", "perceptions", "perch", "perfect", "perfection", "perfectly", "perform",
  "performance", "performances", "performed", "performer", "performers", "performing", "performs", "perfume", "perfumes", "perhaps", "peril", "perilous",
  "perils", "period", "periodic", "periodical", "periodically", "periods", "perish", "permanent", "permanently", "permission", "permit", "permits",
  "permitted", "permitting", "perpendicular", "perpetual", "perplex", "persecute", "persecution", "perseverance", "persevere", "persist", "persisted", "persistence",
  "persistent", "persists", "person", "personal", "personalities", "personality", "personally", "personnel", "persons", "perspective", "perspectives", "persuade",
  "persuaded", "persuading", "persuasion", "pertain", "pertinent", "pessimism", "pessimistic", "pest", "pests", "pet", "petition", "petitions",
  "petroleum", "pets", "petty", "phase", "phases", "phenomena", "phenomenon", "philosopher", "philosophers", "philosophical", "philosophies", "philosophy",
  "phone", "phoned", "phones", "phonetic", "phoning", "photo", "photograph", "photographer", "photographers", "photographs", "photography", "photos",
  "phrase", "phrases", "physical", "physically", "physician", "physicians", "physicist", "physicists", "physics", "physiology", "piano", "pianos",
  "pick", "picked", "picking", "picks", "picnic", "picnics", "picture", "pictured", "pictures", "pie", "piece", "pieces",
  "pier", "pierce", "piers", "pies", "pig", "pigeon", "pigeons", "pigs", "pile", "piled", "piles", "pilgrim",
  "pilgrimage", "pilgrimages", "pilgrims", "piling", "pill", "pillar", "pillars", "pillow", "pillows", "pills", "pilot", "pilots",
  "pin", "pinch", "pine", "pineapple", "pineapples", "pines", "pink", "pins", "pint", "pints", "pioneer", "pioneers",
  "pipe", "pipeline", "pipes", "pirate", "pirates", "pistol", "pistols", "pit", "pitch", "pits", "pity", "place",
  "placed", "placement", "places", "placing", "plague", "plagues", "plaguing", "plain", "plainly", "plains", "plan", "plane",
  "planes", "planet", "planetary", "planets", "planned", "planner", "planners", "planning", "plans", "plant", "plantation", "plantations",
  "planted", "planting", "plants", "plaster", "plastic", "plastics", "plate", "plateau", "plateaus", "plates", "platform", "platforms",
  "platinum", "play", "played", "player", "players", "playground", "playgrounds", "playing", "plays", "playwright", "playwrights", "plea",
  "plead", "pleas", "pleasant", "pleasantly", "please", "pleased", "pleasing", "pleasure", "pleasures", "pledge", "plentiful", "plenty",
  "plight", "plot", "plots", "plough", "plow", "pluck", "plug", "plugs", "plum", "plumber", "plumbers", "plumbing",
  "plump", "plums", "plunge", "plural", "plurals", "plus", "pocket", "pockets", "poem", "poems", "poet", "poetry",
  "poets", "point", "pointed", "pointing", "points", "poison", "poisonous", "poisons", "pole", "poles", "police", "policeman",
  "policemen", "policies", "policy", "policymakers", "polish", "polished", "polite", "politely", "politeness", "political", "politically", "politician",
  "politicians", "politics", "poll", "pollen", "polls", "pollute", "polluted", "pollutes", "polluting", "pollution", "pond", "ponder",
  "ponds", "ponies", "pony", "pool", "pools", "poor", "poorer", "poorest", "poorly", "pop", "pope", "popular",
  "popularity", "popularly", "populate", "populated", "population", "populations", "porch", "porches", "pork", "port", "portable", "porter",
  "porters", "portfolio", "portfolios", "portion", "portions", "portrait", "portraits", "portray", "portrayal", "portrayed", "ports", "pose",
  "posed", "poses", "posing", "position", "positioned", "positions", "positive", "positively", "possess", "possessed", "possesses", "possession",
  "possessions", "possessor", "possibilities", "possibility", "possible", "possibly", "post", "postage", "postal", "posted", "poster", "posters",
  "posting", "postman", "postmen", "postpone", "postponed", "postponement", "posts", "posture", "postures", "pot", "potato", "potatoes",
  "potent", "potential", "potentially", "pots", "potter", "pottery", "pouch", "pouches", "poultry", "pound", "pounds", "pour",
  "poured", "pouring", "pours", "poverty", "powder", "powders", "power", "powered", "powerful", "powerfully", "powers", "practical",
  "practically", "practice", "practiced", "practices", "practicing", "practise", "practised", "practises", "practising", "practitioner", "practitioners", "praise",
  "praised", "praises", "praiseworthy", "pray", "prayed", "prayer", "prayers", "prays", "preach", "preacher", "precaution", "precautions",
  "precede", "preceded", "precedence", "preceding", "precious", "precise", "precisely", "precision", "predecessor", "predecessors", "predict", "predictable",
  "predicted", "prediction", "predictions", "predicts", "predominant", "predominantly", "preface", "prefaces", "prefer", "preferable", "preferably", "preference",
  "preferences", "preferred", "preferring", "prefers", "pregnancies", "pregnancy", "pregnant", "prejudice", "prejudices", "preliminary", "prelude", "premature",
  "premier", "premise", "premises", "premium", "premiums", "preoccupied", "prepaid", "preparation", "preparations", "preparatory", "prepare", "prepared",
  "prepares", "preparing", "preposition", "prepositions", "preposterous", "prescribe", "prescription", "prescriptions", "presence", "present", "presentation", "presentations",
  "presented", "presenting", "presently", "presents", "preservation", "preservative", "preservatives", "preserve", "preserved", "preserves", "preserving", "preside",
  "president", "presidential", "presidents", "press", "pressed", "presses", "pressing", "pressure", "pressures", "prestige", "prestigious", "presume",
  "presumed", "presumption", "pretend", "pretended", "pretending", "pretense", "pretenses", "prettier", "prettiest", "pretty", "prevail", "prevalent",
  "prevalently", "prevent", "prevented", "preventing", "prevention", "preventive", "prevents", "previous", "previously", "prey", "price", "priced",
  "priceless", "prices", "pricing", "prick", "pride", "priest", "priests", "primarily", "primary", "prime", "primitive", "prince",
  "princes", "princess", "princesses", "principal", "principally", "principle", "principles", "print", "printed", "printer", "printers", "printing",
  "prints", "prior", "priorities", "prioritized", "prioritizing", "priority", "prison", "prisoner", "prisoners", "prisons", "privacy", "private",
  "privately", "privilege", "privileges", "prize", "prized", "prizes", "probabilities", "probability", "probable", "probably", "probation", "probe",
  "probes", "problem", "problematic", "problems", "procedure", "procedures", "proceed", "proceeded", "proceeding", "proceedings", "proceeds", "process",
  "processed", "processes", "processing", "procession", "processions", "proclaim", "proclamation", "procure", "produce", "produced", "producer", "producers",
  "produces", "producing", "product", "production", "productions", "productive", "productivity", "products", "profession", "professional", "professionally", "professionals",
  "professions", "professor", "professors", "proficiency", "proficient", "profile", "profiles", "profit", "profitable", "profits", "profound", "profoundly",
  "program", "programme", "programmed", "programmes", "programming", "programs", "progress", "progressed", "progresses", "progressing", "progression", "progressive",
  "prohibit", "prohibited", "prohibition", "prohibitions", "prohibits", "project", "projected", "projector", "projectors", "projects", "prolong", "prolonged",
  "prominent", "prominently", "promise", "promised", "promises", "promising", "promote", "promoted", "promotes", "promoting", "promotion", "promotions",
  "prompt", "prompted", "promptly", "prompts", "pronoun", "pronounce", "pronounced", "pronounces", "pronouncing", "pronouns", "pronunciation", "pronunciations",
  "proof", "proofs", "prop", "propaganda", "propel", "propeller", "proper", "properly", "properties", "property", "prophecies", "prophecy",
  "prophet", "prophets", "proponents", "proportion", "proportional", "proportions", "proposal", "proposals", "propose", "proposed", "proposes", "proposing",
  "proposition", "propositions", "prose", "prosecute", "prosecution", "prospect", "prospective", "prospects", "prosperity", "prosperous", "protect", "protected",
  "protecting", "protection", "protections", "protective", "protects", "protein", "proteins", "protest", "protested", "protestor", "protestors", "protests",
  "protocol", "protocols", "prototype", "prototypes", "proud", "proudly", "prove", "proved", "proven", "proverb", "proverbs", "proves",
  "provide", "provided", "provider", "providers", "provides", "providing", "province", "provinces", "provincial", "proving", "provision", "provisions",
  "provoke", "provoked", "provoking", "prowess", "proximity", "prudence", "prudent", "psychological", "psychologist", "psychologists", "psychology", "pub",
  "public", "publication", "publications", "publicity", "publicly", "publish", "published", "publisher", "publishers", "publishes", "publishing", "pubs",
  "pudding", "puddings", "pull", "pulled", "pulling", "pulls", "pulse", "pulses", "pump", "pumped", "pumps", "punch",
  "punches", "punctual", "punish", "punished", "punishes", "punishing", "punishment", "punishments", "pupil", "pupils", "puppet", "puppets",
  "purchase", "purchased", "purchases", "purchasing", "pure", "purely", "purify", "purity", "purple", "purpose", "purposely", "purposes",
  "purse", "purses", "pursue", "pursued", "pursues", "pursuing", "pursuit", "pursuits", "push", "pushed", "pushes", "pushing",
  "put", "puts", "putting", "puzzle", "puzzled", "puzzles", "puzzling", "pyramid", "pyramids", "qr", "qualification", "qualifications",
  "qualified", "qualifies", "qualify", "qualifying", "qualities", "quality", "quantities", "quantity", "quarrel", "quarrelled", "quarrels", "quarries",
  "quarry", "quarter", "quarters", "queen", "queens", "queer", "quell", "quench", "queries", "query", "quest", "question",
  "questioned", "questioning", "questionnaire", "questionnaires", "questions", "quests", "queue", "queues", "quick", "quicker", "quickest", "quickly",
  "quiet", "quieter", "quietest", "quietly", "quill", "quills", "quilt", "quilts", "quit", "quite", "quits", "quitting",
  "quiver", "quivers", "quiz", "quizlet", "quizzes", "quota", "quotas", "quotation", "quotations", "quote", "quoted", "quotes",
  "quoting", "rabbit", "rabbits", "race", "races", "racial", "racing", "rack", "racks", "radar", "radiant", "radiate",
  "radiation", "radical", "radically", "radio", "radios", "radish", "radishes", "raft", "rafts", "rag", "rage", "rages",
  "rags", "raid", "raids", "rail", "railroad", "railroads", "rails", "railway", "railways", "rain", "rainbow", "rainbows",
  "raincoat", "raincoats", "rained", "raining", "rains", "rainy", "raise", "raised", "raises", "raising", "rake", "rakes",
  "rallies", "rally", "ram", "rambler", "ran", "ranch", "ranches", "random", "rang", "range", "ranged", "ranges",
  "ranging", "rank", "ranked", "ranking", "ranks", "rapid", "rapidity", "rapidly", "rapids", "rare", "rarely", "rascal",
  "rascals", "rash", "rate", "rated", "rates", "rather", "ratify", "rating", "ratio", "ration", "rational", "ratios",
  "rattle", "ravage", "raw", "ray", "rays", "razor", "razors", "reach", "reached", "reaches", "reaching", "react",
  "reacted", "reacting", "reaction", "reactions", "reacts", "read", "reader", "readers", "readily", "readiness", "reading", "readings",
  "reads", "ready", "real", "realities", "reality", "realization", "realizations", "realize", "realized", "realizes", "realizing", "really",
  "realm", "realms", "reap", "rear", "rears", "reason", "reasonable", "reasonably", "reasoned", "reasoning", "reasons", "rebel",
  "rebellion", "rebellions", "rebellious", "rebels", "recall", "recalled", "recalling", "receipt", "receipts", "receive", "received", "receiver",
  "receivers", "receives", "receiving", "recent", "recently", "reception", "receptive", "recess", "recesses", "recipe", "recipes", "recipient",
  "recipients", "reciprocal", "recital", "recite", "reckless", "reckon", "reclaim", "recognition", "recognize", "recognized", "recognizes", "recognizing",
  "recommend", "recommendation", "recommendations", "recommended", "recommending", "recommends", "reconcile", "reconciliation", "record", "recorded", "recorder", "recorders",
  "recording", "records", "recount", "recover", "recovered", "recoveries", "recovering", "recovery", "recreation", "recreational", "recreations", "recruit",
  "recruitment", "recruits", "rectangle", "rectangles", "rectangular", "recur", "recycle", "recycled", "recycling", "red", "redden", "reddish",
  "redistributes", "reduce", "reduced", "reduces", "reducing", "reduction", "reductions", "redundancy", "redundant", "reed", "reeds", "reef",
  "reefs", "refer", "reference", "references", "referred", "referring", "refers", "refine", "refined", "refinement", "reflect", "reflected",
  "reflecting", "reflection", "reflections", "reflective", "reflects", "reform", "reformed", "reformer", "reformers", "reforms", "refractive", "refrain",
  "refresh", "refreshed", "refreshing", "refreshment", "refreshments", "refrigerator", "refrigerators", "refuge", "refugee", "refugees", "refusal", "refusals",
  "refuse", "refused", "refuses", "refusing", "regain", "regal", "regard", "regarded", "regarding", "regardless", "regards", "regent",
  "regime", "regiment", "regimes", "region", "regional", "regions", "register", "registered", "registration", "regret", "regretful", "regrets",
  "regretted", "regretting", "regular", "regularity", "regularly", "regulate", "regulated", "regulating", "regulation", "regulations", "regulatory", "rehabilitate",
  "rehabilitation", "rehearsal", "rehearsals", "rehearse", "reign", "reigned", "reigning", "reigns", "reinforce", "reinforced", "reinforcement", "reinforcements",
  "reject", "rejected", "rejecting", "rejection", "rejections", "rejoice", "relate", "related", "relates", "relating", "relation", "relations",
  "relationship", "relationships", "relative", "relatively", "relatives", "relax", "relaxation", "relaxed", "relay", "relays", "release", "released",
  "releases", "releasing", "relentless", "relevance", "relevant", "reliability", "reliable", "reliance", "reliant", "relied", "relief", "relies",
  "relieve", "relieved", "religion", "religions", "religious", "religiously", "relinquish", "relish", "relocate", "relocating", "reluctance", "reluctant",
  "rely", "relying", "remain", "remainder", "remained", "remaining", "remains", "remark", "remarkable", "remarkably", "remarked", "remarks",
  "remedies", "remedy", "remember", "remembered", "remembering", "remembers", "remembrance", "remind", "reminded", "reminder", "reminders", "reminding",
  "reminds", "remiss", "remit", "remittance", "remnant", "remnants", "remote", "remotely", "remoteness", "removal", "removals", "remove",
  "removed", "removes", "removing", "render", "rendered", "renders", "renew", "renewal", "renounce", "renown", "renowned", "rent",
  "rental", "renting", "rents", "repaid", "repair", "repaired", "repairing", "repairs", "repay", "repayment", "repeal", "repeat",
  "repeated", "repeatedly", "repeating", "repeats", "repel", "repent", "repentance", "repetition", "repetitions", "replace", "replaced", "replacement",
  "replacements", "replaces", "replacing", "replay", "replied", "replies", "reply", "replying", "report", "reported", "reporter", "reporters",
  "reporting", "reports", "repose", "represent", "representation", "representations", "representative", "representatives", "represented", "representing", "represents", "repress",
  "repression", "reproach", "reproduce", "reproduction", "reptile", "reptiles", "republic", "republics", "reputation", "reputations", "repute", "reputed",
  "request", "requested", "requesting", "requests", "require", "required", "requirement", "requirements", "requires", "requiring", "requisite", "rescue",
  "rescued", "rescuer", "rescuers", "rescuing", "research", "researched", "researcher", "researchers", "researches", "researching", "resemblance", "resemble",
  "resembled", "resembles", "resent", "resented", "resentment", "reservation", "reservations", "reserve", "reserved", "reserves", "reservoir", "reservoirs",
  "reside", "resided", "residence", "residences", "resident", "residential", "residents", "resides", "residual", "residue", "resign", "resignation",
  "resignations", "resigned", "resist", "resistance", "resistant", "resisted", "resists", "resolute", "resolution", "resolutions", "resolve", "resolved",
  "resolves", "resolving", "resonance", "resort", "resorts", "resource", "resourceful", "resources", "respect", "respectable", "respected", "respectful",
  "respective", "respectively", "respects", "respiration", "respiratory", "respire", "respond", "responded", "responding", "responds", "response", "responses",
  "responsibilities", "responsibility", "responsible", "responsibly", "responsive", "rest", "restaurant", "restaurants", "rested", "resting", "restless", "restoration",
  "restore", "restored", "restores", "restoring", "restrain", "restrained", "restraint", "restraints", "restrict", "restricted", "restricting", "restriction",
  "restrictions", "restrictive", "rests", "result", "resulted", "resulting", "results", "resume", "resumed", "resuming", "resumption", "retail",
  "retailer", "retailers", "retain", "retained", "retaining", "retains", "retaliate", "retaliation", "retard", "retention", "reticent", "retire",
  "retired", "retirement", "retiring", "retort", "retorts", "retreat", "retreats", "retrospect", "return", "returned", "returning", "returns",
  "reunions", "reveal", "revealed", "revealing", "reveals", "revelation", "revelations", "revenge", "revenue", "revenues", "reverence", "reverse",
  "reversed", "reverses", "reversing", "revert", "review", "reviewed", "reviewer", "reviewers", "reviewing", "reviews", "revise", "revised",
  "revising", "revision", "revisions", "revival", "revive", "revived", "revoke", "revolt", "revolts", "revolution", "revolutionary", "revolutionized",
  "revolutions", "revolve", "revolved", "revolves", "revolving", "reward", "rewarded", "rewards", "rhetoric", "rhythm", "rhythms", "rib",
  "ribbon", "ribbons", "ribs", "rice", "rich", "richer", "richest", "richly", "rid", "ridden", "ridding", "riddle",
  "riddles", "ride", "rider", "riders", "rides", "ridge", "ridges", "ridicule", "ridiculous", "riding", "rids", "rifle",
  "rifles", "rift", "rifts", "right", "righteous", "rightly", "rights", "rigid", "rigor", "rigorous", "rim", "rims",
  "ring", "ringing", "rings", "riot", "riots", "ripe", "ripen", "rise", "risen", "rises", "rising", "risk",
  "risked", "risking", "risks", "risky", "rite", "rites", "ritual", "rituals", "rival", "rivalries", "rivalry", "rivals",
  "river", "rivers", "road", "roads", "roadside", "roam", "roamed", "roaming", "roams", "roar", "roared", "roaring",
  "roars", "roast", "roasts", "rob", "robbed", "robber", "robberies", "robbers", "robbery", "robbing", "robe", "robes",
  "robot", "robots", "robs", "robust", "rock", "rocket", "rockets", "rocks", "rocky", "rod", "rode", "rods",
  "rogue", "rogues", "role", "roles", "roll", "rolled", "roller", "rolling", "rolls", "roman", "romance", "romantic",
  "roof", "roofs", "room", "rooms", "roomy", "roost", "root", "rooted", "roots", "rope", "ropes", "rose",
  "roses", "rot", "rotate", "rotation", "rotations", "rots", "rotted", "rotten", "rotting", "rough", "roughly", "round",
  "rounded", "rounds", "rouse", "route", "routes", "routine", "routines", "row", "rowed", "rowing", "rows", "royal",
  "royalty", "rub", "rubbed", "rubber", "rubbers", "rubbing", "rubbish", "rubies", "rubs", "ruby", "rude", "rudely",
  "rudeness", "rug", "rugged", "rugs", "ruin", "ruined", "ruining", "ruinous", "ruins", "rule", "ruled", "ruler",
  "rulers", "rules", "ruling", "rumor", "rumors", "rumour", "rumours", "run", "rung", "runner", "runners", "running",
  "runs", "runway", "runways", "rural", "rush", "rushed", "rushes", "rushing", "rust", "rusty", "s", "sack",
  "sacks", "sacred", "sacrifice", "sacrifices", "sad", "sadden", "saddle", "saddles", "sadly", "sadness", "safe", "safeguard",
  "safely", "safety", "sag", "sage", "sages", "said", "sail", "sailed", "sailing", "sailor", "sailors", "sails",
  "saint", "saints", "sake", "salad", "salads", "salaries", "salary", "sale", "sales", "salient", "saliva", "salmon",
  "salmons", "saloon", "saloons", "salt", "salty", "salute", "salutes", "salvage", "salvation", "same", "sameness", "sample",
  "sampled", "samples", "sampling", "sanction", "sanctions", "sanctuaries", "sanctuary", "sand", "sandwich", "sandwiches", "sandy", "sane",
  "sang", "sanitary", "sanity", "sank", "sap", "sardine", "sardines", "sash", "sat", "satellite", "satellites", "satisfaction",
  "satisfactory", "satisfied", "satisfies", "satisfy", "satisfying", "saturday", "sauce", "saucer", "saucers", "sauces", "sausage", "sausages",
  "savage", "save", "saved", "saves", "saving", "savings", "savior", "saviour", "saw", "say", "saying", "says",
  "scaffold", "scaffolds", "scale", "scales", "scaly", "scan", "scandal", "scandals", "scanned", "scanning", "scar", "scarce",
  "scarcely", "scarcity", "scare", "scared", "scarf", "scarfs", "scars", "scarves", "scary", "scatter", "scattered", "scenarios",
  "scene", "scenery", "scenes", "scenic", "scent", "scents", "schedule", "scheduled", "schedules", "scheduling", "scheme", "schemes",
  "scholar", "scholars", "scholarship", "scholarships", "school", "schoolers", "schooling", "schools", "science", "sciences", "scientific", "scientifically",
  "scientist", "scientists", "scissors", "scold", "scolded", "scolding", "scolds", "scope", "scopes", "scorch", "score", "scored",
  "scores", "scoring", "scorn", "scornful", "scotch", "scoundrel", "scoundrels", "scour", "scout", "scouts", "scowl", "scram",
  "scramble", "scrap", "scrape", "scrapes", "scraps", "scratch", "scratched", "scratches", "scream", "screamed", "screaming", "screams",
  "screen", "screens", "screw", "screws", "scribble", "script", "scripts", "scrub", "sculptor", "sculptors", "sculpture", "sculptures",
  "scum", "sea", "seafood", "seal", "sealed", "seals", "seam", "seaman", "seamen", "seams", "seaport", "seaports",
  "search", "searched", "searches", "searching", "seas", "season", "seasonal", "seasons", "seat", "seated", "seating", "seats",
  "second", "secondary", "secondly", "seconds", "secrecy", "secret", "secretaries", "secretary", "secretly", "secrets", "sect", "section",
  "sections", "sector", "sectors", "sects", "secure", "secured", "securely", "securities", "security", "sedentary", "see", "seed",
  "seeds", "seeing", "seek", "seeker", "seekers", "seeking", "seeks", "seem", "seemed", "seeming", "seemingly", "seems",
  "seen", "seep", "sees", "segment", "segments", "seize", "seized", "seizes", "seizure", "seizures", "seldom", "select",
  "selected", "selecting", "selection", "selections", "selective", "self", "selfesteem", "selfish", "selfishness", "sell", "seller", "sellers",
  "selling", "sells", "semester", "semesters", "semi", "seminar", "seminars", "senate", "senator", "senators", "send", "sender",
  "senders", "sending", "sends", "senior", "sensation", "sensational", "sensations", "sense", "sensed", "senseless", "senses", "sensible",
  "sensibly", "sensing", "sensitive", "sensitivity", "sensor", "sensors", "sensory", "sensual", "sent", "sentence", "sentenced", "sentences",
  "sentiment", "sentimental", "sentiments", "sentinel", "sentinels", "sentries", "sentry", "separable", "separate", "separated", "separately", "separating",
  "separation", "separations", "september", "sequence", "sequences", "sequential", "serene", "serenity", "sergeant", "sergeants", "series", "serious",
  "seriously", "seriousness", "sermon", "sermons", "serpent", "serpents", "servant", "servants", "serve", "served", "serves", "service",
  "services", "serving", "servitude", "session", "sessions", "set", "sets", "setting", "settings", "settle", "settled", "settlement",
  "settlements", "settler", "settlers", "settles", "seven", "seventeen", "seventh", "seventy", "sever", "several", "severe", "severely",
  "severity", "sew", "sewage", "sewed", "sewer", "sewers", "sewing", "sewn", "sews", "sex", "sexes", "sexual",
  "shabby", "shack", "shacks", "shade", "shades", "shadow", "shadows", "shadowy", "shady", "shaft", "shafts", "shake",
  "shaken", "shakes", "shaking", "shaky", "shall", "shallow", "sham", "shame", "shameful", "shameless", "shampoo", "shape",
  "shaped", "shapeless", "shapes", "shaping", "share", "shared", "shareholder", "shareholders", "shares", "sharing", "shark", "sharks",
  "sharp", "sharpen", "sharper", "sharpest", "sharply", "shatter", "shattered", "shave", "shaved", "shaven", "shaves", "shaving",
  "shawl", "shawls", "she", "sheaf", "shear", "shears", "sheaves", "shed", "sheds", "sheep", "sheer", "sheet",
  "sheets", "shelf", "shell", "shells", "shelter", "sheltered", "shelters", "shelves", "shepherd", "shepherds", "sheriff", "sheriffs",
  "shield", "shields", "shift", "shifted", "shifting", "shifts", "shill", "shine", "shines", "shining", "shiny", "ship",
  "shipment", "shipments", "shipped", "shipping", "ships", "shirt", "shirts", "shiver", "shivers", "shock", "shocked", "shocking",
  "shocks", "shoe", "shoes", "shone", "shook", "shoot", "shooting", "shoots", "shop", "shopped", "shopper", "shoppers",
  "shopping", "shops", "shore", "shores", "short", "shortage", "shortages", "shortcoming", "shortcomings", "shorten", "shorter", "shortest",
  "shorthand", "shortly", "shot", "should", "shoulder", "shoulders", "shout", "shouted", "shouting", "shouts", "shove", "shovel",
  "shovels", "show", "showed", "shower", "showers", "showing", "shown", "shows", "showy", "shrank", "shrewd", "shriek",
  "shrieked", "shrieking", "shrieks", "shrill", "shrimp", "shrimps", "shrine", "shrines", "shrink", "shrinking", "shrinks", "shrub",
  "shrubs", "shrug", "shrugged", "shrugging", "shrugs", "shrunk", "shudder", "shudders", "shuffled", "shun", "shunned", "shunning",
  "shuns", "shut", "shuts", "shutter", "shutters", "shutting", "shuttle", "shuttles", "shy", "shyness", "sick", "sickly",
  "sickness", "sicknesses", "side", "sides", "sidewalk", "sidewalks", "sideways", "siege", "sieges", "sieve", "sieves", "sigh",
  "sighed", "sighing", "sighs", "sight", "sights", "sightseeing", "sign", "signal", "signals", "signature", "signatures", "signed",
  "significance", "significant", "significantly", "signified", "signifies", "signify", "signifying", "signing", "signs", "silence", "silences", "silent",
  "silently", "silk", "silks", "silky", "sill", "sills", "silly", "silver", "similar", "similarities", "similarity", "similarly",
  "simple", "simpler", "simplest", "simplicity", "simplified", "simplifies", "simplify", "simplifying", "simply", "simulation", "simultaneous", "simultaneously",
  "sin", "since", "sincere", "sincerely", "sincerity", "sinew", "sing", "singer", "singers", "singing", "single", "sings",
  "singular", "singulars", "sinister", "sink", "sinking", "sinks", "sins", "sip", "sips", "sir", "sire", "sister",
  "sisters", "sit", "site", "sites", "sits", "sitting", "situation", "situations", "six", "sixteen", "sixth", "sixty",
  "size", "sized", "sizes", "skate", "skates", "skating", "sketch", "sketches", "ski", "skies", "skiing", "skill",
  "skilled", "skillful", "skills", "skin", "skins", "skip", "skipped", "skipping", "skips", "skirt", "skirts", "skis",
  "sky", "skytrain", "skytrains", "slab", "slabs", "slack", "slain", "slam", "slams", "slang", "slant", "slants",
  "slap", "slaps", "slate", "slaughter", "slave", "slavery", "slaves", "slay", "slaying", "slays", "sled", "sledge",
  "sleep", "sleeping", "sleepless", "sleeps", "sleepy", "sleeve", "sleeves", "slender", "slept", "slew", "slice", "slices",
  "slid", "slide", "slides", "sliding", "slight", "slightly", "slim", "slime", "slimy", "sling", "slip", "slipped",
  "slipper", "slippers", "slippery", "slipping", "slips", "slit", "slits", "slogan", "slogans", "slope", "slopes", "sloping",
  "slot", "sloth", "slots", "slouch", "slow", "slower", "slowest", "slowly", "slum", "slumber", "slums", "sly",
  "smack", "small", "smaller", "smallest", "smart", "smarter", "smartest", "smartphone", "smartphones", "smash", "smashes", "smear",
  "smell", "smelled", "smelling", "smells", "smelly", "smelt", "smile", "smiled", "smiles", "smiling", "smith", "smiths",
  "smoke", "smoked", "smoker", "smokers", "smokes", "smoking", "smoky", "smooth", "smoother", "smoothly", "smother", "smuggle",
  "snack", "snacks", "snail", "snails", "snake", "snakes", "snap", "snapped", "snaps", "snare", "snatch", "sneath",
  "sneer", "sneeze", "sneezes", "sniff", "snob", "snobs", "snore", "snores", "snow", "snows", "snowy", "so",
  "soak", "soap", "soar", "soars", "sob", "sober", "sobs", "soccer", "sociable", "social", "socialize", "socially",
  "societies", "society", "sociology", "sock", "socks", "soda", "sofa", "sofas", "soft", "soften", "softer", "softest",
  "softly", "software", "softwares", "soil", "soils", "solace", "solar", "sold", "soldier", "soldiers", "sole", "solely",
  "solemn", "solicit", "solitary", "solitude", "solo", "solos", "solution", "solutions", "solve", "solved", "solves", "solving",
  "some", "somebody", "somehow", "someone", "something", "sometime", "sometimes", "somewhat", "somewhere", "son", "song", "songs",
  "sons", "soon", "sooner", "soonest", "soot", "soothe", "sophisticated", "sore", "sorrow", "sorrows", "sorry", "sort",
  "sorted", "sorts", "sought", "soul", "souls", "sound", "sounded", "sounding", "soundly", "sounds", "soup", "soups",
  "sour", "source", "sources", "south", "southern", "souvenir", "souvenirs", "sovereign", "sovereignty", "sow", "sowed", "sown",
  "sows", "space", "spaces", "spacious", "spade", "spades", "span", "spans", "spare", "spark", "sparked", "sparkle",
  "sparks", "sparrow", "sparrows", "sparse", "spat", "speak", "speaker", "speakers", "speaking", "speaks", "spear", "spears",
  "special", "specialist", "specialists", "specialize", "specialized", "specializes", "specializing", "specially", "specialties", "specialty", "species", "specific",
  "specifically", "specification", "specifications", "specified", "specifies", "specify", "specifying", "specimen", "specimens", "spectacle", "spectacles", "spectacular",
  "spectator", "spectators", "specter", "spectrum", "speculate", "speculation", "speech", "speeches", "speed", "speeds", "speedy", "spell",
  "spellcheck", "spelled", "spelling", "spells", "spelt", "spend", "spending", "spends", "spent", "sphere", "spheres", "spice",
  "spices", "spicy", "spider", "spiders", "spies", "spill", "spilled", "spills", "spilt", "spin", "spinach", "spine",
  "spines", "spinning", "spins", "spire", "spires", "spirit", "spirits", "spiritual", "spit", "spite", "spits", "spitting",
  "spoil", "spoiled", "spoils", "spoilt", "spoke", "spoken", "sponsor", "sponsored", "sponsors", "spontaneous", "spoon", "spoons",
  "sport", "sporting", "sports", "spot", "spots", "spotted", "spouse", "spouses", "spout", "sprain", "sprang", "sprawl",
  "spray", "sprays", "spread", "spreading", "spreads", "spring", "springs", "springtime", "sprinkle", "sprinkles", "sprout", "sprouts",
  "sprung", "spun", "spur", "spurs", "spy", "squad", "squads", "squalid", "squalor", "square", "squares", "squash",
  "squat", "squats", "squeeze", "squeezed", "squeezes", "squire", "squires", "squirrel", "squirrels", "stab", "stability", "stabilize",
  "stable", "stabs", "stack", "stacks", "stadium", "stadiums", "staff", "staffs", "stage", "stages", "stagger", "staggers",
  "stain", "stained", "stains", "stair", "staircase", "staircases", "stairs", "stake", "stakes", "stale", "stalk", "stalks",
  "stall", "stalls", "stamen", "stamens", "stammer", "stamp", "stamped", "stamps", "stance", "stances", "stand", "standard",
  "standardization", "standardize", "standardized", "standards", "standing", "stands", "staple", "staples", "star", "starch", "stare", "stared",
  "stares", "staring", "stars", "start", "started", "starting", "startle", "startled", "starts", "starvation", "starve", "starved",
  "starves", "state", "stated", "statement", "statements", "states", "stating", "station", "stationary", "stationery", "stations", "statistical",
  "statistics", "statue", "statues", "stature", "status", "statuses", "statute", "statutes", "stay", "stayed", "staying", "stays",
  "stead", "steadily", "steady", "steak", "steaks", "steal", "stealing", "steals", "steam", "steamer", "steamers", "steel",
  "steep", "steer", "steered", "steers", "stem", "stems", "stencil", "stencils", "step", "stepped", "stepping", "steps",
  "stereo", "stereos", "stereotype", "stereotypes", "sterile", "stern", "stew", "steward", "stewards", "stick", "sticking", "sticks",
  "sticky", "stiff", "stifle", "stigma", "stigmas", "still", "stimulate", "stimulated", "stimulates", "stimulating", "stimulation", "stimuli",
  "stimulus", "sting", "stings", "stingy", "stir", "stirred", "stirring", "stirs", "stitch", "stitches", "stock", "stocking",
  "stockings", "stocks", "stole", "stolen", "stomach", "stomachs", "stone", "stones", "stony", "stood", "stool", "stools",
  "stop", "stoppage", "stoppages", "stopped", "stopping", "stops", "storage", "store", "stored", "storehouse", "storehouses", "stores",
  "stories", "storing", "storm", "storms", "stormy", "story", "storytelling", "stout", "stove", "stoves", "straight", "straighten",
  "straightforward", "strain", "strains", "strait", "straits", "strand", "strands", "strang", "strange", "strangely", "stranger", "strangers",
  "strap", "straps", "strategic", "strategically", "strategies", "strategy", "straw", "strawberries", "strawberry", "straws", "stray", "strays",
  "streak", "streaks", "stream", "streaming", "streams", "street", "streetlights", "streets", "strength", "strengthen", "strengthened", "strengths",
  "strenuous", "stress", "stressed", "stresses", "stressful", "stretch", "stretched", "stretches", "stretching", "strict", "strictly", "stride",
  "strides", "striding", "strife", "strike", "strikes", "striking", "string", "strings", "strip", "stripe", "striped", "stripes",
  "stripped", "strips", "strive", "striven", "strives", "striving", "stroke", "strokes", "stroll", "strolls", "strong", "stronger",
  "strongest", "strongly", "strove", "struck", "structural", "structurally", "structure", "structured", "structures", "struggle", "struggled", "struggles",
  "struggling", "strung", "stubborn", "stuck", "student", "students", "studied", "studies", "studio", "studios", "studious", "study",
  "studying", "stuff", "stumble", "stumbles", "stump", "stumps", "stun", "stung", "stunned", "stuns", "stunt", "stunts",
  "stupid", "stupidity", "sturdy", "stutter", "style", "styled", "styles", "stylish", "sub", "subdivide", "subdivision", "subdue",
  "subdued", "subject", "subjection", "subjective", "subjects", "sublime", "submarine", "submarines", "submerge", "submerged", "submit", "submits",
  "submitted", "submitting", "subordinate", "subordinates", "subscribe", "subscription", "subscriptions", "subsequent", "subsequently", "subside", "subsidies", "subsidize",
  "subsidized", "subsidy", "subsist", "substance", "substances", "substantial", "substantially", "substitute", "substitutes", "substitution", "subtle", "subtly",
  "subtopics", "subtract", "subtraction", "suburb", "suburban", "suburbs", "subway", "subways", "succeed", "succeeding", "succeeds", "success",
  "successes", "successful", "successfully", "succession", "successive", "successor", "successors", "such", "suck", "sucked", "sucks", "sudden",
  "suddenly", "sue", "sued", "sues", "suffer", "suffered", "suffering", "sufferings", "suffers", "suffice", "sufficient", "sufficiently",
  "suffix", "suffixes", "sugar", "sugars", "sugary", "suggest", "suggested", "suggesting", "suggestion", "suggestions", "suggests", "suicide",
  "suicides", "suing", "suit", "suitable", "suitably", "suitcase", "suitcases", "suite", "suited", "suites", "suiting", "suits",
  "sullen", "sulphur", "sum", "summaries", "summarize", "summarized", "summarizes", "summary", "summed", "summer", "summers", "summit",
  "summits", "summon", "summons", "sums", "sun", "sunday", "sung", "sunk", "sunlight", "sunny", "sunrise", "sunset",
  "sunshine", "super", "superb", "superficial", "superfluous", "superintendent", "superior", "superiority", "supermarket", "supermarkets", "supernatural", "supersede",
  "superstition", "superstitions", "superstitious", "supervise", "supervised", "supervision", "supervisor", "supervisors", "supper", "suppers", "supplement", "supplementary",
  "supplied", "supplier", "suppliers", "supplies", "supply", "supplying", "support", "supported", "supporter", "supporters", "supporting", "supportive",
  "supports", "suppose", "supposed", "supposes", "supposing", "suppress", "suppression", "supremacy", "supreme", "sure", "surely", "surface",
  "surfaces", "surge", "surgeon", "surgeons", "surgeries", "surgery", "surgical", "surplus", "surpluses", "surprise", "surprised", "surprises",
  "surprising", "surrender", "surrendered", "surround", "surrounded", "surrounding", "surroundings", "surrounds", "survey", "surveyed", "surveying", "surveys",
  "survival", "survive", "survived", "survives", "surviving", "survivor", "survivors", "suspect", "suspected", "suspects", "suspend", "suspended",
  "suspension", "suspicion", "suspicions", "suspicious", "sustain", "sustainability", "sustainable", "sustained", "swallow", "swallowed", "swallows", "swam",
  "swamp", "swamps", "swan", "swans", "swarm", "swarms", "sway", "sways", "swear", "swearing", "swears", "sweat",
  "sweater", "sweaters", "swedish", "sweep", "sweeping", "sweeps", "sweet", "sweeter", "sweetest", "sweetly", "sweetness", "swell",
  "swelled", "swelling", "swells", "swept", "swift", "swiftly", "swim", "swimmer", "swimmers", "swimming", "swims", "swindle",
  "swing", "swings", "swiss", "switch", "switched", "switches", "switching", "swollen", "sword", "swords", "swore", "sworn",
  "swum", "swung", "syllable", "syllables", "symbol", "symbolic", "symbolize", "symbols", "symmetry", "sympathetic", "sympathies", "sympathize",
  "sympathy", "symptom", "symptoms", "synonym", "synonyms", "syntax", "system", "systematic", "systematically", "systems", "tab", "table",
  "tables", "tablet", "tablets", "tabs", "tack", "tackle", "tackled", "tact", "tactics", "tags", "tail", "tailor",
  "tailors", "tails", "take", "taken", "takes", "taking", "tale", "talent", "talented", "talents", "tales", "talk",
  "talkative", "talked", "talking", "talks", "tall", "taller", "tallest", "tame", "tan", "tangible", "tank", "tanks",
  "tap", "tape", "tapes", "tapped", "taps", "tar", "target", "targets", "tariff", "tariffs", "task", "tasks",
  "taste", "tasted", "tastes", "tasting", "tasty", "taught", "tax", "taxation", "taxes", "taxi", "taxis", "tea",
  "teach", "teacher", "teachers", "teaches", "teaching", "team", "teams", "teamwork", "tear", "tears", "teas", "tease",
  "teased", "teaspoon", "teaspoons", "technical", "technically", "technique", "techniques", "technological", "technologies", "technology", "tedious", "teenager",
  "teenagers", "teens", "teeth", "telegram", "telegrams", "telegraph", "telephone", "telephoned", "telephones", "telescope", "telescopes", "television",
  "televisions", "tell", "telling", "tells", "temper", "temperament", "temperature", "temperatures", "tempers", "tempest", "tempests", "temple",
  "temples", "temporarily", "temporary", "tempt", "temptation", "temptations", "ten", "tenant", "tenants", "tend", "tended", "tendencies",
  "tendency", "tender", "tending", "tends", "tennis", "tense", "tenses", "tension", "tensions", "tent", "tentative", "tenth",
  "tents", "term", "terminal", "terminals", "terminate", "termination", "terms", "terrace", "terraces", "terrestrial", "terrible", "terribly",
  "terrific", "terrified", "terrify", "territories", "territory", "terror", "terrorism", "terrorist", "terrorists", "terrors", "test", "testament",
  "tested", "testify", "testimony", "testing", "tests", "tet", "text", "textbook", "textbooks", "textile", "textiles", "texts",
  "textual", "than", "thank", "thanked", "thankful", "thanks", "that", "thatch", "the", "theater", "theaters", "theatre",
  "theatres", "theft", "thefts", "their", "theirs", "them", "theme", "themes", "themselves", "then", "theology", "theoretical",
  "theories", "theory", "therapies", "therapy", "there", "thereby", "therefore", "thermometer", "thermometers", "these", "theses", "thesis",
  "they", "thick", "thicken", "thickness", "thief", "thieves", "thigh", "thighs", "thin", "thing", "things", "think",
  "thinker", "thinkers", "thinking", "thinks", "thinner", "thinnest", "third", "thirdly", "thirst", "thirsty", "thirteen", "thirty",
  "this", "thorn", "thorns", "thorough", "thoroughly", "those", "though", "thought", "thoughtful", "thoughts", "thousand", "thousands",
  "thread", "threads", "threat", "threaten", "threatened", "threatening", "threatens", "threats", "three", "threshold", "threw", "thrift",
  "thrifty", "thrill", "thrilled", "thrills", "throat", "throats", "throne", "thrones", "throng", "throngs", "through", "throughout",
  "throw", "throwing", "thrown", "throws", "thrust", "thrusts", "thumb", "thumbs", "thunder", "thursday", "thus", "ticket",
  "tickets", "tide", "tides", "tidy", "tie", "tied", "ties", "tiger", "tigers", "tight", "tightly", "tiktok",
  "tile", "tiles", "till", "timber", "time", "timed", "times", "timetable", "timetables", "timid", "timidity", "timing",
  "tin", "tiny", "tip", "tips", "tire", "tired", "tires", "tiring", "tissue", "tissues", "title", "titled",
  "titles", "to", "toad", "toads", "toast", "tobacco", "today", "toddlers", "toe", "toes", "together", "toil",
  "toilet", "toilets", "token", "tokens", "told", "tolerable", "tolerant", "tolerate", "toleration", "toll", "tolls", "tomato",
  "tomatoes", "tomb", "tombs", "tomorrow", "ton", "tone", "tones", "tongue", "tongues", "tonight", "tons", "too",
  "took", "tool", "tools", "tooth", "toothbrush", "toothpaste", "top", "topic", "topical", "topics", "tops", "torch",
  "torches", "tore", "torment", "torn", "tornado", "tornadoes", "torrent", "torrents", "tortoise", "tortoises", "torture", "toss",
  "tossed", "tosses", "tossing", "total", "totally", "touch", "touched", "touches", "touching", "tough", "tour", "tourism",
  "tourist", "tourists", "tournament", "tournaments", "tours", "tow", "toward", "towards", "towel", "towels", "tower", "towers",
  "town", "towns", "toxic", "toy", "toys", "trace", "traced", "traces", "tracing", "track", "tracked", "tracks",
  "tract", "trade", "traded", "trader", "traders", "trades", "trading", "tradition", "traditional", "traditionally", "traditions", "traffic",
  "traffics", "tragedies", "tragedy", "tragic", "trail", "trails", "train", "trained", "trainee", "trainees", "trainer", "trainers",
  "training", "trains", "trait", "traitor", "traitors", "traits", "tramp", "trample", "tramps", "transact", "transaction", "transactions",
  "transcend", "transcription", "transfer", "transferred", "transferring", "transform", "transformation", "transformations", "transformed", "transforming", "transient", "transit",
  "transition", "transitional", "transitions", "translate", "translated", "translates", "translating", "translation", "translations", "translator", "translators", "translucent",
  "transmission", "transmit", "transmits", "transmitted", "transparency", "transparent", "transport", "transportable", "transportation", "transported", "transporting", "trap",
  "trapped", "trapping", "traps", "trash", "travel", "traveled", "traveler", "travelers", "traveling", "travelled", "traveller", "travellers",
  "travelling", "travels", "traverse", "tray", "trays", "treach", "tread", "treason", "treasure", "treasurer", "treasures", "treasury",
  "treat", "treated", "treaties", "treating", "treatment", "treatments", "treats", "treaty", "treble", "tree", "trees", "tremble",
  "trembled", "trembles", "trembling", "tremendous", "trench", "trenches", "trend", "trends", "trespass", "trial", "trials", "triangle",
  "triangles", "triangular", "tribe", "tribes", "tribute", "tributes", "trick", "tricks", "tricky", "tried", "tries", "trifle",
  "trifles", "trigger", "trim", "trimmed", "trimming", "trims", "trip", "trips", "triumph", "triumphant", "triumphs", "trivial",
  "trolley", "trolleys", "troop", "troops", "trophies", "trophy", "tropical", "trouble", "troubled", "troubles", "troublesome", "trough",
  "troughs", "trousers", "truck", "trucks", "true", "truly", "trumpet", "trumpets", "trunk", "trunks", "trust", "trusted",
  "trusting", "trusts", "trustworthy", "truth", "truthful", "truths", "try", "trying", "tub", "tube", "tubes", "tubs",
  "tuesday", "tuition", "tuitions", "tumble", "tumbles", "tumor", "tumors", "tune", "tunes", "tunnel", "tunnels", "turbine",
  "turbines", "turf", "turkey", "turkeys", "turn", "turned", "turning", "turnip", "turnips", "turns", "tutor", "tutorial",
  "tutorials", "tutoring", "tutors", "tv", "twelfth", "twelve", "twenty", "twice", "twig", "twigs", "twilight", "twin",
  "twinkle", "twinkles", "twins", "twist", "twisted", "twisting", "twists", "two", "tying", "type", "typed", "types",
  "typical", "typically", "typing", "tyranny", "tyrant", "tyrants", "ubiquity", "ugly", "ultimate", "ultimately", "umbrella", "umbrellas",
  "unable", "unacceptable", "unanimous", "unavoidable", "unaware", "uncertain", "uncertainties", "uncertainty", "uncle", "unclear", "uncles", "uncomfortable",
  "unconscious", "unconsciously", "uncover", "under", "undergo", "undergoes", "undergoing", "undergone", "underground", "underlie", "underline", "underlined",
  "underneath", "understand", "understanding", "understandings", "understands", "understood", "undertake", "undertaken", "undertaker", "undertakes", "undertook", "underwear",
  "underwent", "undesirable", "undoubtedly", "undress", "undressed", "undresses", "uneasy", "unemployed", "unemployment", "unequal", "unequally", "uneven",
  "unexpected", "unexpectedly", "unfair", "unfairly", "unfavorable", "unfit", "unfold", "unfortunate", "unfortunately", "unhappy", "unhealthy", "unification",
  "unified", "unifies", "uniform", "uniforms", "unify", "unifying", "union", "unions", "unique", "uniquely", "unit", "unite",
  "united", "unites", "uniting", "units", "unity", "universal", "universally", "universe", "universes", "universities", "university", "unjust",
  "unkind", "unknown", "unless", "unlike", "unlikely", "unlimited", "unload", "unlucky", "unnecessary", "unpaid", "unpleasant", "unprecedented",
  "unproductive", "unreal", "unreasonable", "unrest", "unruly", "unsafe", "unsatisfactory", "unstable", "unsuccessful", "unsuccessfully", "unsuitable", "untidy",
  "untie", "untied", "unties", "until", "untold", "unusual", "unusually", "unwilling", "unwillingness", "unworthy", "up", "updated",
  "updates", "upgrading", "upon", "upper", "upright", "uproot", "upset", "upsets", "upsetting", "upside", "upward", "urban",
  "urbanization", "urge", "urged", "urgency", "urgent", "urgently", "urges", "urging", "us", "usage", "use", "used",
  "useful", "usefully", "usefulness", "useless", "user", "users", "uses", "using", "usual", "usually", "utilities", "utility",
  "utilization", "utilize", "utilized", "utilizes", "utilizing", "utmost", "utter", "utterly", "vacancies", "vacancy", "vacant", "vacate",
  "vacation", "vacations", "vaccinate", "vaccine", "vaccines", "vacuum", "vacuums", "vague", "vaguely", "vain", "valiant", "valid",
  "validate", "validated", "validating", "validation", "validity", "valley", "valleys", "valuable", "valuables", "valuation", "value", "valued",
  "values", "valuing", "valve", "valves", "van", "vanish", "vanished", "vanishes", "vanishing", "vanity", "vanquish", "vans",
  "vapor", "vapors", "vapour", "vapours", "variable", "variables", "variance", "variant", "variation", "variations", "varied", "varies",
  "varieties", "variety", "various", "variously", "vary", "varying", "vase", "vases", "vast", "vastly", "vault", "vaults",
  "veal", "vegetable", "vegetables", "vegetarian", "vegetarians", "vehicle", "vehicles", "vehicular", "veil", "veils", "vein", "veins",
  "velocity", "velvet", "vendor", "vendors", "venerable", "vengeance", "venom", "vent", "ventilate", "ventilation", "vents", "venture",
  "ventured", "ventures", "venus", "verb", "verbal", "verbs", "verdict", "verdicts", "verge", "verified", "verifies", "verify",
  "verifying", "veritable", "verse", "verses", "version", "versions", "versus", "vertical", "vertically", "very", "vessel", "vessels",
  "vest", "vests", "veteran", "veterans", "veto", "vetoes", "vetos", "vex", "vi", "via", "viable", "viaduct",
  "viaducts", "vibrant", "vibrate", "vibration", "vibrations", "vicar", "vicars", "vice", "vices", "vicinity", "victim", "victims",
  "victories", "victorious", "victory", "video", "videos", "view", "viewed", "viewer", "viewers", "viewing", "viewpoint", "viewpoints",
  "views", "vigor", "vigorous", "vigorously", "vile", "village", "villager", "villagers", "villages", "villain", "villains", "vine",
  "vinegar", "vines", "violate", "violated", "violates", "violating", "violation", "violations", "violence", "violent", "violently", "violet",
  "violets", "violin", "violins", "virgin", "virgins", "virtual", "virtually", "virtue", "virtues", "virtuous", "virus", "viruses",
  "visa", "visas", "visibility", "visible", "visibly", "vision", "visions", "visit", "visited", "visiting", "visitor", "visitors",
  "visits", "visual", "visualization", "visually", "visuals", "vital", "vitally", "vitamin", "vitamins", "vivid", "vividly", "vocab",
  "vocabularies", "vocabulary", "vocal", "vocation", "vocational", "vogue", "voice", "voiced", "voices", "voicing", "void", "volcano",
  "volcanoes", "volcanos", "volleyball", "volt", "voltage", "voltages", "volts", "volume", "volumes", "voluntarily", "voluntary", "volunteer",
  "volunteered", "volunteering", "volunteers", "vomit", "vote", "voted", "voter", "voters", "votes", "voting", "vow", "vowel",
  "vowels", "vows", "voyage", "voyages", "vs", "vulgar", "vulnerability", "vulnerable", "wade", "wafer", "wafers", "wag",
  "wage", "wager", "wagers", "wages", "wagon", "wagons", "wags", "waist", "waists", "wait", "waited", "waiter",
  "waiters", "waiting", "waitress", "waitresses", "waits", "wake", "wakes", "waking", "walk", "walked", "walking", "walks",
  "wall", "walled", "walls", "walnut", "walnuts", "wander", "wandered", "wandering", "wanders", "want", "wanted", "wanting",
  "wants", "war", "ward", "warden", "wardens", "wardrobe", "wardrobes", "wards", "ware", "warehouse", "warehouses", "wares",
  "warm", "warmer", "warmest", "warmly", "warmth", "warn", "warned", "warning", "warnings", "warns", "warrant", "warrants",
  "warrior", "warriors", "wars", "wary", "was", "wash", "washed", "washer", "washers", "washes", "washing", "wasp",
  "wasps", "waste", "wasted", "wasteful", "wastes", "wasting", "watch", "watched", "watches", "watching", "watchman", "watchmen",
  "water", "watered", "waterfall", "waterfalls", "watering", "waterproof", "waters", "wave", "waved", "waves", "waving", "wavy",
  "wax", "way", "ways", "we", "weak", "weaken", "weaker", "weakest", "weakly", "weakness", "weaknesses", "wealth",
  "wealthier", "wealthiest", "wealthy", "weapon", "weapons", "wear", "weariness", "wearing", "wears", "weary", "weather", "weathers",
  "weave", "weaver", "weavers", "weaves", "weaving", "web", "webs", "website", "websites", "wed", "wedded", "wedding",
  "weddings", "wednesday", "weds", "weed", "weeds", "week", "weekday", "weekdays", "weekend", "weekends", "weekly", "weeks",
  "weep", "weeping", "weeps", "weigh", "weighed", "weighing", "weighs", "weight", "weighted", "weights", "welcome", "welcomed",
  "welcomes", "welcoming", "welfare", "well", "went", "wept", "were", "west", "western", "wet", "wetter", "wettest",
  "whale", "whales", "wharf", "wharves", "what", "whatever", "wheat", "wheel", "wheelbarrow", "wheelbarrows", "wheelchair", "wheelchairs",
  "wheeled", "wheels", "when", "whenever", "where", "whereabouts", "whereas", "whereby", "wherefore", "wherever", "whether", "which",
  "whichever", "while", "whip", "whipped", "whipping", "whips", "whirl", "whirls", "whiskey", "whisky", "whisper", "whispered",
  "whispering", "whispers", "whistle", "whistled", "whistles", "whistling", "white", "whiten", "whitish", "who", "whoever", "whole",
  "wholesome", "wholly", "whom", "whose", "why", "wicked", "wide", "widely", "widen", "wider", "widespread", "widest",
  "widow", "widower", "widowers", "widows", "width", "widths", "wife", "wild", "wilder", "wilderness", "wildest", "wildlife",
  "wildly", "will", "willing", "willingly", "willingness", "willow", "willows", "win", "wind", "winding", "windmill", "windmills",
  "window", "windows", "winds", "windy", "wine", "wines", "wing", "winged", "wings", "wink", "winked", "winking",
  "winks", "winner", "winners", "winning", "wins", "winter", "winters", "wipe", "wiped", "wipes", "wiping", "wire",
  "wired", "wires", "wiring", "wisdom", "wise", "wisely", "wish", "wished", "wishes", "wishing", "wit", "witch",
  "witches", "with", "withdraw", "withdrawal", "withdrawals", "withdrawing", "withdrawn", "withdraws", "withdrew", "wither", "withered", "withering",
  "withers", "within", "without", "withstand", "withstanding", "withstands", "withstood", "witness", "witnessed", "witnesses", "witnessing", "wits",
  "witty", "wives", "woke", "woken", "wolf", "wolves", "woman", "women", "won", "wonder", "wondered", "wonderful",
  "wonderfully", "wondering", "wonders", "wood", "wooden", "woods", "woody", "wool", "woollen", "wooly", "word", "worded",
  "wording", "words", "wore", "work", "worked", "worker", "workers", "workforce", "working", "workloads", "workplace", "workplaces",
  "works", "workshop", "workshops", "world", "worlds", "worldwide", "worm", "worms", "worn", "worried", "worries", "worry",
  "worrying", "worse", "worship", "worshipped", "worshipping", "worst", "worth", "worthy", "would", "wound", "wounded", "wounding",
  "wounds", "wove", "woven", "wrap", "wrapped", "wrapping", "wraps", "wrath", "wreath", "wreaths", "wreck", "wreckage",
  "wrecked", "wrecks", "wren", "wrens", "wrestle", "wrestled", "wrestler", "wrestlers", "wrestles", "wrestling", "wretched", "wrinkle",
  "wrinkled", "wrinkles", "wrist", "wrists", "write", "writer", "writers", "writes", "writing", "writings", "written", "wrong",
  "wrongdoing", "wrongdoings", "wrongly", "wrote", "x", "yard", "yards", "yarn", "yarns", "yawn", "yawned", "yawning",
  "yawns", "year", "yearly", "yearn", "yearned", "yearns", "years", "yeast", "yell", "yelled", "yelling", "yellow",
  "yells", "yes", "yesterday", "yesterdays", "yet", "yield", "yielded", "yielding", "yields", "yoke", "yokes", "yolk",
  "yolks", "you", "young", "younger", "youngest", "youngster", "youngsters", "your", "yours", "yourself", "yourselves", "youth",
  "youthful", "youths", "youtube", "zeal", "zealous", "zebra", "zebras", "zenith", "zero", "zeroes", "zeros", "zinc",
  "zone", "zones", "zoo", "zoological", "zoology", "zoos",

]);

// Build domain specific spellcheck dictionary
function getValidWordDictionary() {
  const dict = new Set(COMMON_ENGLISH_WORDS);
  if (currentTopic && currentTopic.details) {
    if (currentTopic.details.vocab) {
      currentTopic.details.vocab.forEach(v => {
        const words = v.en.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
        words.forEach(w => dict.add(w));
      });
    }
    const addFromIdeas = (ideas) => {
      if (!ideas) return;
      const processText = (text) => {
        if (!text) return;
        const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
        words.forEach(w => dict.add(w));
      };
      const allIdeaGroups = ['benefits', 'drawbacks', 'causes', 'solutions', 'problems', 'effects', 'measures', 'views', 'reasons', 'factors'];
      allIdeaGroups.forEach(grp => {
        if (Array.isArray(ideas[grp])) {
          ideas[grp].forEach(item => {
            processText(item.point_en);
            processText(item.evidence_en);
            if (Array.isArray(item.collocations)) {
              item.collocations.forEach(c => processText(c.en));
            }
            if (Array.isArray(item.point_collocations)) {
              item.point_collocations.forEach(c => processText(c.en));
            }
            if (Array.isArray(item.evidence_collocations)) {
              item.evidence_collocations.forEach(ev => {
                if (Array.isArray(ev)) ev.forEach(c => processText(c.en));
                else if (ev && ev.en) processText(ev.en);
              });
            }
          });
        }
      });
    };
    addFromIdeas(currentTopic.details.ideas_b1);
    addFromIdeas(currentTopic.details.ideas_b2);
    
    const addFromText = (text) => {
      if (!text) return;
      const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
      words.forEach(w => dict.add(w));
    };
    addFromText(currentTopic.details.sample_b1);
    addFromText(currentTopic.details.sample_b2);
  }
  return dict;
}

// Contraction mappings for academic writing check
const ACADEMIC_CONTRACTIONS = {
  "don't": "do not",
  "doesn't": "does not",
  "didn't": "did not",
  "can't": "cannot",
  "won't": "will not",
  "shouldn't": "should not",
  "wouldn't": "would not",
  "couldn't": "could not",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "haven't": "have not",
  "hasn't": "has not",
  "hadn't": "had not",
  "i'm": "I am",
  "you're": "you are",
  "they're": "they are",
  "we're": "we are",
  "he's": "he is",
  "she's": "she is",
  "it's": "it is",
  "let's": "let us",
  "there's": "there is",
  "that's": "that is",
  "who's": "who is",
  "we've": "we have",
  "they've": "they have",
  "you've": "you have",
  "i've": "I have",
  "should've": "should have",
  "would've": "would have",
  "could've": "could have",
  "might've": "might have",
  "must've": "must have",

  // Misspelled contractions without apostrophe
  "dont": "do not",
  "doesnt": "does not",
  "didnt": "did not",
  "cant": "cannot",
  "wont": "will not",
  "shouldnt": "should not",
  "wouldnt": "would not",
  "couldnt": "could not",
  "isnt": "is not",
  "arent": "are not",
  "wasnt": "was not",
  "werent": "were not",
  "havent": "have not",
  "hasnt": "has not",
  "hadnt": "had not",
  "im": "I am",
  "youre": "you are",
  "theyre": "they are",
  "theres": "there is",
  "thats": "that is",
  "whos": "who is",
  "ive": "I have",
  "youve": "you have",
  "theyve": "they have",
  "weve": "we have",
  "shouldve": "should have",
  "wouldve": "would have",
  "couldve": "could have"
};

const NOUN_SINGULAR_TO_PLURAL = {
  'learner': 'learners',
  'student': 'students',
  'teacher': 'teachers',
  'school': 'schools',
  'activity': 'activities',
  'cost': 'costs',
  'expense': 'expenses',
  'device': 'devices',
  'computer': 'computers',
  'phone': 'phones',
  'benefit': 'benefits',
  'drawback': 'drawbacks',
  'problem': 'problems',
  'solution': 'solutions',
  'parent': 'parents',
  'child': 'children',
  'class': 'classes',
  'lesson': 'lessons',
  'course': 'courses',
  'network': 'networks',
  'opportunity': 'opportunities',
  'advantage': 'advantages',
  'disadvantage': 'disadvantages',
  'peer': 'peers',
  'friend': 'friends',
  'country': 'countries',
  'skill': 'skills',
  'result': 'results',
  'connection': 'connections',
  'platform': 'platforms'
};

const NOUN_PLURAL_TO_SINGULAR = {};
for (const [sing, plur] of Object.entries(NOUN_SINGULAR_TO_PLURAL)) {
  NOUN_PLURAL_TO_SINGULAR[plur] = sing;
}

const VERB_SINGULAR_TO_PLURAL = {
  'brings': 'bring',
  'offers': 'offer',
  'provides': 'provide',
  'gives': 'give',
  'saves': 'save',
  'helps': 'help',
  'creates': 'create',
  'improves': 'improve',
  'allows': 'allow',
  'enables': 'enable',
  'becomes': 'become',
  'has': 'have',
  'affects': 'affect',
  'wants': 'want',
  'needs': 'need',
  'shares': 'share',
  'focuses': 'focus',
  'makes': 'make',
  'causes': 'cause',
  'leads': 'lead',
  'reduces': 'reduce',
  'lives': 'live',
  'is': 'are'
};
const VERB_PLURAL_TO_SINGULAR = {};
for (const [sing, plur] of Object.entries(VERB_SINGULAR_TO_PLURAL)) {
  VERB_PLURAL_TO_SINGULAR[plur] = sing;
}

const ADJECTIVE_TO_NOUN = {
  'flexible': 'flexibility',
  'convenient': 'convenience',
  'independent': 'independence',
  'distracted': 'distraction',
  'isolated': 'isolation',
  'interacted': 'interaction',
  'difficult': 'difficulty',
  'expensive': 'expense',
  'costly': 'cost'
};
const NOUN_TO_ADJECTIVE = {};
for (const [adj, noun] of Object.entries(ADJECTIVE_TO_NOUN)) {
  NOUN_TO_ADJECTIVE[noun] = adj;
}

const PAST_TO_PRESENT = {
  'brought': { sing: 'brings', plur: 'bring' },
  'offered': { sing: 'offers', plur: 'offer' },
  'provided': { sing: 'provides', plur: 'provide' },
  'gave': { sing: 'gives', plur: 'give' },
  'saved': { sing: 'saves', plur: 'save' },
  'helped': { sing: 'helps', plur: 'help' },
  'created': { sing: 'creates', plur: 'create' },
  'improved': { sing: 'improves', plur: 'improve' },
  'allowed': { sing: 'allows', plur: 'allow' },
  'enabled': { sing: 'enables', plur: 'enable' },
  'learnt': { sing: 'learns', plur: 'learn' },
  'learned': { sing: 'learns', plur: 'learn' },
  'spent': { sing: 'spends', plur: 'spend' },
  'reduced': { sing: 'reduces', plur: 'reduce' },
  'went': { sing: 'goes', plur: 'go' },
  'was': { sing: 'is', plur: 'is' },
  'were': { sing: 'are', plur: 'are' }
};

const CONTEXTUAL_WORD_CHOICES = {
  'lose costs': 'reduce costs / lower costs',
  'drop costs': 'reduce costs / lower costs',
  'fall costs': 'reduce costs / lower costs',
  'keep time': 'save time',
  'hold time': 'save time',
  'make convenience': 'bring convenience / offer convenience',
  'take convenience': 'bring convenience / offer convenience',
  'make flexibility': 'bring flexibility / offer flexibility',
  'take flexibility': 'bring flexibility / offer flexibility',
  'get benefits': 'bring benefits / provide benefits (nếu mang nghĩa là mang lại lợi ích)',
  'make benefits': 'bring benefits / provide benefits',
  'at anytime': 'at any time',
  'feel boring': 'feel bored',
  'through Internet': 'through the Internet',
  'public transports': 'public transport',
  'private transports': 'private transport'
};

// Evaluate user typed translation against VSTEP requirements
function evaluateTranslationInput(userInput, modelAnswer) {
  const trimmed = userInput.trim();
  if (trimmed === "") {
    return { isCorrect: false, reason: "Bạn chưa nhập câu trả lời." };
  }

  const structuredErrors = [];

  // Clean inputs for matching
  const cleanInput = trimmed.toLowerCase();
  const cleanModel = modelAnswer.trim().toLowerCase();

  // Tokenize user input preserving internal apostrophes and hyphens
  const userWords = trimmed.split(/\s+/)
    .map(t => t.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
    .filter(w => w.length > 0);

  const modelWords = modelAnswer.toLowerCase().split(/\s+/)
    .map(t => t.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
    .filter(w => w.length > 0);
  const modelWordsSet = new Set(modelWords);

  // 1. Check capitalization (Lỗi viết hoa/viết thường)
  // Check start of sentence
  const firstChar = trimmed.charAt(0);
  if (firstChar !== firstChar.toUpperCase() || !/[A-Z]/.test(firstChar)) {
    structuredErrors.push({
      category: "Lỗi cấu trúc câu (Sentence Structure)",
      location: `Chữ cái đầu tiên "${firstChar}"`,
      explanation: "Chữ cái đầu tiên của câu tiếng Anh phải viết hoa."
    });
  }

  // Check unnecessary capitalization inside the sentence (excluding first word, 'I', and proper nouns)
  const rawWords = trimmed.split(/\s+/).filter(w => w.length > 0);
  for (let i = 1; i < rawWords.length; i++) {
    const rawWord = rawWords[i].replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
    if (rawWord.length > 0 && rawWord !== 'I') {
      const firstL = rawWord.charAt(0);
      if (firstL === firstL.toUpperCase() && /[A-Z]/.test(firstL)) {
        const isProperInModel = modelWords.some(mw => 
          mw === rawWord.toLowerCase() || 
          (mw.charAt(0) === mw.charAt(0).toUpperCase() && mw.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '') === rawWord)
        );
        if (!isProperInModel) {
          structuredErrors.push({
            category: "Lỗi chính tả (Spelling)",
            location: `"${rawWord}"`,
            explanation: `Từ này ở giữa câu không cần viết hoa chữ cái đầu.`
          });
        }
      }
    }
  }

  // 2. Check punctuation (Lỗi dấu câu)
  const lastChar = trimmed.slice(-1);
  if (!/[.!?]/.test(lastChar)) {
    structuredErrors.push({
      category: "Lỗi dấu câu (Punctuation)",
      location: `Cuối câu`,
      explanation: "Thiếu dấu chấm (.) hoặc dấu câu kết thúc ở cuối câu."
    });
  }

  // 3. Exact match (without final punctuation)
  const cleanInputNoPunct = cleanInput.replace(/[.!?]/g, '');
  const cleanModelNoPunct = cleanModel.replace(/[.!?]/g, '');
  if (structuredErrors.length === 0 && cleanInputNoPunct === cleanModelNoPunct) {
    return { isCorrect: true, feedback: "Chính xác hoàn hảo! Câu viết đúng ngữ pháp, dấu câu và giống 100% đáp án mẫu." };
  }

  // 4. Subject-Verb Agreement checks (Lỗi sự hoà hợp giữa chủ từ và động từ)
  const ADVERBS = ["always", "often", "usually", "sometimes", "rarely", "seldom", "never", "greatly", "strongly", "actively", "directly", "indirectly", "successfully", "easily", "actually", "probably", "certainly", "definitely", "highly", "fully", "totally", "completely"];
  const adverbPattern = '(?:(?:' + ADVERBS.join('|') + ')\\s+)?';

  const singularSubjectList = [
    "online learning", "distance learning", "e-learning", "digital learning", "virtual learning",
    "studying online", "learning online", "working from home", "remote work", "telecommuting",
    "it", "he", "she", "this", "that", "education", "study", "technology", "the internet",
    "public transport", "traffic", "pollution", "the government", "society"
  ];
  singularSubjectList.sort((a, b) => b.length - a.length);

  const foundSubjectVerbErrors = [];

  // 4A. Singular subjects followed by plural/base verbs
  for (const subj of singularSubjectList) {
    for (const [plurVerb, singVerb] of Object.entries(VERB_PLURAL_TO_SINGULAR)) {
      if (modelWordsSet.has(plurVerb)) {
        continue;
      }
      const verbRegex = new RegExp('\\b(' + subj + ')\\s+(' + adverbPattern + ')(' + plurVerb + ')\\b', 'i');
      const match = verbRegex.exec(cleanInput);
      if (match) {
        const matchIdx = match.index;
        const textBefore = cleanInput.slice(0, matchIdx).trim();
        const lastWordBefore = textBefore.split(/\s+/).pop();
        if (['can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'to', 'help', 'helps', 'helped', 'make', 'makes', 'made', 'let', 'lets'].includes(lastWordBefore)) {
          continue;
        }

        const subjMatched = match[1];
        const verbMatched = match[3];
        const errorLocation = `"${subjMatched} ${verbMatched}"`;
        if (!structuredErrors.some(e => e.location === errorLocation)) {
          structuredErrors.push({
            category: "Lỗi hòa hợp chủ ngữ - động từ (Subject-Verb Agreement)",
            location: errorLocation,
            explanation: `Động từ đi sau chủ ngữ số ít '${subjMatched}' phải chia số ít ('${singVerb}' thay vì '${verbMatched}').`
          });
          foundSubjectVerbErrors.push({
            pattern: new RegExp('\\b(' + subjMatched.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s+' + adverbPattern + ')' + verbMatched + '\\b', 'gi'),
            replacement: `$1${singVerb}`
          });
        }
      }
    }
  }

  // 4B. Plural subjects followed by singular verbs (e.g., "students helps" -> "students help")
  const pluralSubjectList = ["learners", "students", "teachers", "parents", "children", "people", "they", "we", "schools", "platforms", "benefits", "drawbacks", "problems", "solutions"];
  for (const subj of pluralSubjectList) {
    for (const [singVerb, plurVerb] of Object.entries(VERB_SINGULAR_TO_PLURAL)) {
      if (modelWordsSet.has(singVerb)) {
        continue;
      }
      const verbRegex = new RegExp('\\b(' + subj + ')\\s+(' + adverbPattern + ')(' + singVerb + ')\\b', 'i');
      const match = verbRegex.exec(cleanInput);
      if (match) {
        const subjMatched = match[1];
        const verbMatched = match[3];
        const errorLocation = `"${subjMatched} ${verbMatched}"`;
        if (!structuredErrors.some(e => e.location === errorLocation)) {
          structuredErrors.push({
            category: "Lỗi hòa hợp chủ ngữ - động từ (Subject-Verb Agreement)",
            location: errorLocation,
            explanation: `Chủ ngữ số nhiều '${subjMatched}' đi với động từ chia số nhiều ('${plurVerb}' thay vì '${verbMatched}').`
          });
          foundSubjectVerbErrors.push({
            pattern: new RegExp('\\b(' + subjMatched.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s+' + adverbPattern + ')' + verbMatched + '\\b', 'gi'),
            replacement: `$1${plurVerb}`
          });
        }
      }
    }
  }

  // 5. Tense Check (Lỗi về thì)
  const foundTenseErrors = [];
  userWords.forEach((w, wIdx) => {
    const presentForms = PAST_TO_PRESENT[w];
    if (presentForms) {
      // Do not flag if model answer itself uses this exact word
      if (modelWordsSet.has(w)) return;
      // Do not flag if preceded by auxiliary verb (passive voice or perfect aspect)
      const prevWord = wIdx > 0 ? userWords[wIdx - 1] : '';
      if (['is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'having', 'get', 'gets', 'got'].includes(prevWord)) return;

      const isPluralSubject = pluralSubjectList.some(ps => cleanInput.includes(ps));
      const suggestedForm = isPluralSubject ? presentForms.plur : presentForms.sing;
      structuredErrors.push({
        category: "Lỗi thì (Tense)",
        location: `"${w}"`,
        explanation: `Hãy dùng thì Hiện tại Đơn (Present Simple) để diễn đạt chân lý/sự thật khách quan. Nên dùng '${suggestedForm}' thay vì dạng quá khứ '${w}'.`
      });
      foundTenseErrors.push({ word: w, suggestedForm });
    }
  });

  // 6. Word Form (Lỗi từ loại) Check
  const foundWordFormErrors = new Set();
  userWords.forEach(w => {
    const nounForm = ADJECTIVE_TO_NOUN[w];
    if (nounForm && modelWordsSet.has(nounForm)) {
      foundWordFormErrors.add({ adj: w, noun: nounForm });
    }
  });
  if (foundWordFormErrors.size > 0) {
    foundWordFormErrors.forEach(err => {
      structuredErrors.push({
        category: "Lỗi dạng từ (Word Form)",
        location: `"${err.adj}"`,
        explanation: `Từ '${err.adj}' là tính từ. Ở đây bạn cần dùng dạng danh từ '${err.noun}' (sự linh hoạt/sự tiện lợi) đóng vai trò làm tân ngữ.`
      });
    });
  }

  // 7. Preposition Checks (Lỗi giới từ)
  const recipients = ['learner', 'learners', 'student', 'students', 'people', 'person', 'user', 'users'];
  const hasUserForRecipient = userWords.some((w, idx) => w === 'for' && idx < userWords.length - 1 && recipients.includes(userWords[idx + 1]));
  const hasModelToRecipient = modelWords.some((w, idx) => w === 'to' && idx < modelWords.length - 1 && recipients.includes(modelWords[idx + 1]));
  if (hasUserForRecipient && hasModelToRecipient) {
    structuredErrors.push({
      category: "Lỗi giới từ (Preposition)",
      location: '"for" trước đối tượng tiếp nhận',
      explanation: "Hãy dùng giới từ 'to' thay vì 'for' để kết nối với đối tượng tiếp nhận (ví dụ: 'bring/offer flexibility to learners')."
    });
  }

  // spend time/money for -> on
  let foundSpendForError = false;
  if (cleanInput.includes("spend") && /\b(time|money|costs|hours|days)\b/.test(cleanInput)) {
    const spendIdx = userWords.indexOf("spend");
    const forIdx = userWords.indexOf("for");
    if (spendIdx !== -1 && forIdx > spendIdx && forIdx - spendIdx <= 4) {
      foundSpendForError = true;
      structuredErrors.push({
        category: "Lỗi giới từ (Preposition)",
        location: '"for" đi sau "spend"',
        explanation: "Cấu trúc 'spend time/money' đi với giới từ 'on' (ví dụ: spend time on studying), không dùng 'for'."
      });
    }
  }

  // focus to/in/at -> on
  let foundFocusError = false;
  if (userWords.includes("focus")) {
    const focusIdx = userWords.indexOf("focus");
    if (focusIdx !== -1 && focusIdx < userWords.length - 1) {
      const nextWord = userWords[focusIdx + 1];
      if (nextWord === 'to' || nextWord === 'in' || nextWord === 'at' || nextWord === 'for') {
        foundFocusError = true;
        structuredErrors.push({
          category: "Lỗi giới từ (Preposition)",
          location: `"${nextWord}" đi sau "focus"`,
          explanation: "Cấu trúc 'focus' đi với giới từ 'on' (ví dụ: focus on something)."
        });
      }
    }
  }

  // participate on/to/for -> in
  let foundParticipateError = false;
  if (userWords.includes("participate")) {
    const partIdx = userWords.indexOf("participate");
    if (partIdx !== -1 && partIdx < userWords.length - 1) {
      const nextWord = userWords[partIdx + 1];
      if (nextWord === 'on' || nextWord === 'to' || nextWord === 'at' || nextWord === 'for') {
        foundParticipateError = true;
        structuredErrors.push({
          category: "Lỗi giới từ (Preposition)",
          location: `"${nextWord}" đi sau "participate"`,
          explanation: "Cấu trúc 'participate' đi với giới từ 'in' (ví dụ: participate in learning/activities)."
        });
      }
    }
  }

  // 8. Word Choice / Context Check (Lỗi dùng từ sai ngữ cảnh)
  const foundWordChoiceErrors = [];
  for (const [wrongPhrase, suggestion] of Object.entries(CONTEXTUAL_WORD_CHOICES)) {
    if (cleanInput.includes(wrongPhrase)) {
      structuredErrors.push({
        category: "Lỗi kết hợp từ (Collocation)",
        location: `"${wrongPhrase}"`,
        explanation: `Cụm từ '${wrongPhrase}' chưa tự nhiên. Bạn nên dùng '${suggestion}'.`
      });
      foundWordChoiceErrors.push({ wrongPhrase, suggestion });
    }
  }

  // Collocation check: go to school -> travel to school / commute to school
  if (cleanInput.includes("go to school") && (cleanModel.includes("travel to school") || cleanModel.includes("commute to school"))) {
    structuredErrors.push({
      category: "Lỗi kết hợp từ (Collocation)",
      location: '"go to school"',
      explanation: "Trong bài luận học thuật khi nói về việc di chuyển/đi lại đến trường, nên dùng 'travel to school' hoặc 'commute to school' để câu văn tự nhiên và đạt điểm từ vựng cao hơn."
    });
  }

  // 9. Contraction check (Lỗi viết tắt)
  const foundContractions = new Set();
  userWords.forEach(w => {
    if (ACADEMIC_CONTRACTIONS[w]) {
      foundContractions.add(w);
    }
  });
  if (foundContractions.size > 0) {
    foundContractions.forEach(c => {
      structuredErrors.push({
        category: "Lỗi tự nhiên trong văn học thuật (Academic Style)",
        location: `"${c}"`,
        explanation: `Văn viết học thuật không được viết tắt. Hãy viết đầy đủ là '${ACADEMIC_CONTRACTIONS[c]}' thay vì '${c}'.`
      });
    });
  }

  // 10. Pluralization check (Lỗi số ít số nhiều)
  const SINGULAR_DETERMINERS = ['a', 'an', 'each', 'every', 'one', 'another', 'this', 'that'];
  const foundPluralErrors = new Set();
  for (let i = 0; i < userWords.length; i++) {
    const w = userWords[i];
    const pluralForm = NOUN_SINGULAR_TO_PLURAL[w];
    if (pluralForm && modelWordsSet.has(pluralForm)) {
      const prevWord = i > 0 ? userWords[i - 1] : null;
      if (!prevWord || !SINGULAR_DETERMINERS.includes(prevWord)) {
        foundPluralErrors.add(w);
      }
    }
  }
  if (foundPluralErrors.size > 0) {
    foundPluralErrors.forEach(sing => {
      const plur = NOUN_SINGULAR_TO_PLURAL[sing];
      structuredErrors.push({
        category: "Lỗi số ít - số nhiều (Singular/Plural)",
        location: `"${sing}"`,
        explanation: `Danh từ '${sing}' nên ở dạng số nhiều '${plur}' (thiếu '-s' hoặc '-es' ở cuối).`
      });
    });
  }

  // 11. Spellchecking (Lỗi chính tả)
  const dict = getValidWordDictionary();
  modelWords.forEach(mw => {
    const pure = mw.replace(/[^a-z]/g, '');
    if (pure) dict.add(pure);
    dict.add(mw);
  });
  const foundSpellingErrors = [];

  userWords.forEach(w => {
    if (foundContractions.has(w)) return;
    if (/[0-9]/.test(w)) return;
    
    const pureWord = w.replace(/[^a-z]/g, '');
    if (pureWord.length === 0) return;

    if (!dict.has(w) && !dict.has(pureWord)) {
      let closestWord = "";
      let minDistance = 999;
      dict.forEach(dictWord => {
        if (Math.abs(dictWord.length - w.length) <= 2) {
          const dist = getLevenshteinDistance(w, dictWord);
          if (dist < minDistance) {
            minDistance = dist;
            closestWord = dictWord;
          }
        }
      });
      
      if (minDistance <= 2 && closestWord !== "") {
        foundSpellingErrors.push({ word: w, suggestion: closestWord });
      }
    }
  });

  if (foundSpellingErrors.length > 0) {
    foundSpellingErrors.forEach(err => {
      structuredErrors.push({
        category: "Lỗi chính tả (Spelling)",
        location: `"${err.word}"`,
        explanation: `Từ '${err.word}' có vẻ bị viết sai (bạn có ý định viết là '${err.suggestion}'?).`
      });
    });
  }

  // 12. Modal Verbs Check (Kiểm tra trợ động từ khuyết thiếu: can, could, should, will, would, may, might, must)
  const MODAL_VERBS = ['can', 'could', 'should', 'will', 'would', 'may', 'might', 'must'];
  const modelModals = MODAL_VERBS.filter(m => modelWords.includes(m));
  modelModals.forEach(modal => {
    let userHasEquivalent = false;
    if (modal === 'can') {
      userHasEquivalent = userWords.includes('can') || userWords.includes('could') || cleanInput.includes('able to') || cleanInput.includes('enable');
    } else if (modal === 'could') {
      userHasEquivalent = userWords.includes('could') || userWords.includes('can') || cleanInput.includes('able to');
    } else if (modal === 'should') {
      userHasEquivalent = userWords.includes('should') || cleanInput.includes('ought to') || cleanInput.includes('need to') || cleanInput.includes('supposed to');
    } else if (modal === 'will') {
      userHasEquivalent = userWords.includes('will') || userWords.includes('would') || userWords.includes('can');
    } else if (modal === 'would') {
      userHasEquivalent = userWords.includes('would') || userWords.includes('will') || userWords.includes('could');
    } else if (modal === 'may') {
      userHasEquivalent = userWords.includes('may') || userWords.includes('might') || userWords.includes('can');
    } else if (modal === 'might') {
      userHasEquivalent = userWords.includes('might') || userWords.includes('may') || userWords.includes('could');
    } else if (modal === 'must') {
      userHasEquivalent = userWords.includes('must') || cleanInput.includes('have to') || cleanInput.includes('has to') || cleanInput.includes('need to');
    } else {
      userHasEquivalent = userWords.includes(modal);
    }

    if (!userHasEquivalent) {
      structuredErrors.push({
        category: "Lỗi trợ động từ khuyết thiếu (Modal Verb)",
        location: `Thiếu '${modal}'`,
        explanation: `Câu gốc tiếng Việt có ý diễn đạt khả năng / sự cần thiết ('có thể', 'sẽ', 'nên'). Bạn cần thêm '${modal}' trước động từ (ví dụ: '${modal} reduce' thay vì chỉ dùng 'reduce').`
      });
    }
  });

  // Return list of errors if any grammar/spelling issues exist
  if (structuredErrors.length > 0) {
    // Generate corrected sentence
    let corrected = trimmed;
    
    // 1. Contractions
    foundContractions.forEach(c => {
      const regex = new RegExp('\\b' + c + '\\b', 'gi');
      corrected = corrected.replace(regex, ACADEMIC_CONTRACTIONS[c]);
    });

    // 2. Word Choice / Context
    foundWordChoiceErrors.forEach(err => {
      const cleanSuggestion = err.suggestion.split(' / ')[0].split(' (')[0];
      const regex = new RegExp('\\b' + err.wrongPhrase + '\\b', 'gi');
      corrected = corrected.replace(regex, cleanSuggestion);
    });

    // 3. Subject-Verb Agreement corrections (ONLY for detected errors!)
    foundSubjectVerbErrors.forEach(err => {
      corrected = corrected.replace(err.pattern, err.replacement);
    });

    // 4. Tense Check (ONLY for detected tense errors!)
    foundTenseErrors.forEach(err => {
      const regex = new RegExp('\\b' + err.word + '\\b', 'gi');
      corrected = corrected.replace(regex, err.suggestedForm);
    });

    // 5. Word Form Check (ONLY for detected word form errors!)
    foundWordFormErrors.forEach(err => {
      const regex = new RegExp('\\b' + err.adj + '\\b', 'gi');
      corrected = corrected.replace(regex, err.noun);
    });

    // 6. Prepositions
    if (hasUserForRecipient && hasModelToRecipient) {
      recipients.forEach(r => {
        const regex = new RegExp('\\bfor\\s+' + r + '\\b', 'gi');
        corrected = corrected.replace(regex, "to " + r);
      });
    }
    if (foundSpendForError) {
      corrected = corrected.replace(/\b(spend\s+\w+\s+)for\b/gi, "$1on");
      corrected = corrected.replace(/\b(spend\s+\w+\s+\w+\s+)for\b/gi, "$1on");
    }
    if (foundFocusError) {
      corrected = corrected.replace(/\bfocus\s+(to|in|at|for)\b/gi, "focus on");
    }
    if (foundParticipateError) {
      corrected = corrected.replace(/\bparticipate\s+(on|to|at|for)\b/gi, "participate in");
    }

    // 7. Pluralization check (ONLY for detected plural errors!)
    foundPluralErrors.forEach(sing => {
      const plur = NOUN_SINGULAR_TO_PLURAL[sing];
      const regex = new RegExp('\\b' + sing + '\\b', 'gi');
      corrected = corrected.replace(regex, plur);
    });

    // 8. Spelling errors (ONLY for detected spelling errors!)
    foundSpellingErrors.forEach(err => {
      const regex = new RegExp('\\b' + err.word + '\\b', 'gi');
      corrected = corrected.replace(regex, err.suggestion);
    });

    // 9. Capitalization start of sentence
    if (corrected.length > 0) {
      corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
    }

    // 10. Capitalization inside sentence (unnecessary)
    for (let i = 1; i < rawWords.length; i++) {
      const rawWord = rawWords[i].replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
      if (rawWord.length > 0 && rawWord !== 'I') {
        const firstL = rawWord.charAt(0);
        if (firstL === firstL.toUpperCase() && /[A-Z]/.test(firstL)) {
          const isProperInModel = modelWords.some(mw => 
            mw === rawWord.toLowerCase() || 
            (mw.charAt(0) === mw.charAt(0).toUpperCase() && mw.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '') === rawWord)
          );
          if (!isProperInModel) {
            const regex = new RegExp('\\b' + rawWord + '\\b', 'g');
            corrected = corrected.replace(regex, rawWord.toLowerCase());
          }
        }
      }
    }

    // 11. Final punctuation
    if (corrected.length > 0 && !/[.!?]/.test(corrected.slice(-1))) {
      corrected = corrected + ".";
    }

    // Format error list HTML
    const errorsHtml = structuredErrors.map((err, idx) => `
      <div class="vstep-error-card" style="background-color: var(--panel-bg); border: 1px solid var(--panel-border); border-left: 4px solid var(--danger); padding: 0.75rem 1rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem; font-family: inherit;">
        <div style="font-weight: 700; font-size: 0.85rem; color: var(--danger); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em;">LỖI ${idx + 1}</div>
        <div style="font-size: 0.9rem; margin-bottom: 0.25rem;"><strong style="color: var(--text-muted);">Loại lỗi:</strong> <span style="font-weight: 600; color: var(--text-primary);">${err.category}</span></div>
        <div style="font-size: 0.9rem; margin-bottom: 0.25rem;"><strong style="color: var(--text-muted);">Vị trí lỗi:</strong> <span style="font-family: var(--font-mono); font-size: 0.85rem; background-color: var(--input-bg); padding: 0.1rem 0.35rem; border-radius: 3px; color: var(--danger); font-weight: 500;">${err.location}</span></div>
        <div style="font-size: 0.9rem; line-height: 1.4;"><strong style="color: var(--text-muted);">Giải thích:</strong> ${err.explanation}</div>
      </div>
    `).join('');

    return {
      isCorrect: false,
      reason: `
        <div style="margin-bottom: 1rem; font-family: inherit;">
          <div style="font-weight: 700; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; margin-bottom: 0.25rem;">CÂU GỐC:</div>
          <div style="background-color: var(--input-bg); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--panel-border); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.9rem; line-height: 1.4;">"${trimmed}"</div>
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 700; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; margin-bottom: 0.5rem;">DANH SÁCH LỖI PHÁT HIỆN:</div>
          ${errorsHtml}
        </div>

        <div style="margin-bottom: 1rem; font-family: inherit;">
          <div style="font-weight: 700; color: var(--success); font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">CÂU ĐÃ SỬA CHUẨN XÁC 100% (ĐÁP ÁN MẪU ĐỂ HỌC):</div>
          <div style="background-color: var(--success-bg); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--success); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.95rem; font-weight: 600; line-height: 1.4;">"${modelAnswer}"</div>
        </div>

        <div style="border-top: 1px solid var(--panel-border); padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">
          <div>KIỂM TRA CUỐI:</div>
          <div style="display: flex; gap: 1rem; color: var(--text-primary);">
            <span>Tổng số lỗi phát hiện: <strong style="color: var(--danger);">${structuredErrors.length}</strong></span>
            <span>|</span>
            <span>Đã chuẩn hóa: <strong style="color: var(--success);">100% Đúng chuẩn VSTEP</strong></span>
          </div>
        </div>
      `
    };
  }

  // 8. Meaning / Content matching check (Permissive 70% threshold)
  // Ensure we match at least 70% of the essential words (excluding stop words) or their synonyms
  const stopWords = ['a', 'an', 'the', 'to', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'with', 'by', 'that', 'this', 'these', 'those'];
  
  const getBaseForm = (word) => {
    if (NOUN_PLURAL_TO_SINGULAR[word]) {
      return NOUN_PLURAL_TO_SINGULAR[word];
    }
    if (word.endsWith('s') && word.length > 3) {
      return word.slice(0, -1);
    }
    return word;
  };

  const inputTokens = cleanInputNoPunct.split(/\s+/).filter(w => w.length > 0);
  const modelTokens = cleanModelNoPunct.split(/\s+/).filter(w => w.length > 0);
  const essentialModelTerms = modelTokens.filter(t => !stopWords.includes(t) && t.length > 2);
  
  const synonyms = {
    'learners': ['students', 'people', 'users', 'pupils', 'learners', 'children', 'individuals'],
    'students': ['learners', 'people', 'users', 'pupils', 'students', 'children', 'individuals'],
    'helps': ['assists', 'supports', 'allows', 'enables', 'helps', 'makes'],
    'saves': ['save', 'saves'],
    'save': ['saves', 'save'],
    'online': ['digital', 'internet', 'web', 'virtual', 'e-learning'],
    'learning': ['education', 'study', 'studying', 'learning', 'courses'],
    'internet': ['online', 'network', 'web', 'digital'],
    'travel': ['go', 'commute', 'commuting', 'travel', 'move'],
    'reduce': ['cut', 'decrease', 'lower', 'reduce', 'minimize'],
    'costs': ['expenses', 'spending', 'fees', 'costs', 'prices']
  };

  let matchedTerms = 0;
  
  essentialModelTerms.forEach(term => {
    const baseTerm = getBaseForm(term);
    
    // Check exact term or base form match
    if (inputTokens.includes(term) || inputTokens.some(it => getBaseForm(it) === baseTerm)) {
      matchedTerms++;
      return;
    }
    const termSynonyms = synonyms[term] || synonyms[baseTerm] || [];
    const hasSynonym = termSynonyms.some(syn => inputTokens.includes(syn) || inputTokens.some(it => getBaseForm(it) === getBaseForm(syn)));
    if (hasSynonym) {
      matchedTerms++;
    }
  });
  
  const matchRatio = matchedTerms / essentialModelTerms.length;
  if (matchRatio >= 0.70) {
    return { isCorrect: true, feedback: "Chính xác! Câu của bạn đúng ngữ pháp, dấu câu và truyền tải đầy đủ ý nghĩa gốc." };
  } else {
    return {
      isCorrect: false,
      reason: `
        <div style="margin-bottom: 1rem; font-family: inherit;">
          <div style="font-weight: 700; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; margin-bottom: 0.25rem;">CÂU GỐC:</div>
          <div style="background-color: var(--input-bg); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--panel-border); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.9rem; line-height: 1.4;">"${trimmed}"</div>
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 700; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; margin-bottom: 0.5rem;">DANH SÁCH LỖI PHÁT HIỆN:</div>
          <div class="vstep-error-card" style="background-color: var(--panel-bg); border: 1px solid var(--panel-border); border-left: 4px solid var(--danger); padding: 0.75rem 1rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem; font-family: inherit;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--danger); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em;">LỖI 1</div>
            <div style="font-size: 0.9rem; margin-bottom: 0.25rem;"><strong style="color: var(--text-muted);">Loại lỗi:</strong> <span style="font-weight: 600; color: var(--text-primary);">Lỗi cấu trúc câu (Sentence Structure)</span></div>
            <div style="font-size: 0.9rem; margin-bottom: 0.25rem;"><strong style="color: var(--text-muted);">Vị trí lỗi:</strong> <span style="font-family: var(--font-mono); font-size: 0.85rem; background-color: var(--input-bg); padding: 0.1rem 0.35rem; border-radius: 3px; color: var(--danger); font-weight: 500;">Cả câu</span></div>
            <div style="font-size: 0.9rem; line-height: 1.4;"><strong style="color: var(--text-muted);">Giải thích:</strong> Chưa diễn đạt đúng nghĩa gốc hoặc thiếu ý quan trọng của câu mẫu.</div>
          </div>
        </div>

        <div style="margin-bottom: 1rem; font-family: inherit;">
          <div style="font-weight: 700; color: var(--success); font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">CÂU ĐÃ SỬA CHUẨN XÁC 100% (ĐÁP ÁN MẪU ĐỂ HỌC):</div>
          <div style="background-color: var(--success-bg); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--success); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.95rem; font-weight: 600; line-height: 1.4;">"${modelAnswer}"</div>
        </div>

        <div style="border-top: 1px solid var(--panel-border); padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">
          <div>KIỂM TRA CUỐI:</div>
          <div style="display: flex; gap: 1rem; color: var(--text-primary);">
            <span>Tổng số lỗi phát hiện: <strong style="color: var(--danger);">1</strong></span>
            <span>|</span>
            <span>Đã chuẩn hóa: <strong style="color: var(--success);">100% Đúng chuẩn VSTEP</strong></span>
          </div>
        </div>
      `
    };
  }
}

function switchResourceTab(tabName) {
  // Update tabs active state
  document.querySelectorAll('.resource-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    const label = btn.innerText.toLowerCase();
    if ((tabName === 'prompt' && label.includes('đề')) || (tabName === 'vocab' && label.includes('từ'))) {
      btn.classList.add('active');
    }
  });
  
  // Show section
  document.querySelectorAll('.resource-pane-section').forEach(sec => {
    sec.classList.remove('active');
  });
  
  let targetSec = 'prompt';
  if (tabName === 'vocab') targetSec = 'vocab';
  
  const secEl = document.getElementById(`resource-sec-${targetSec}`);
  if (secEl) secEl.classList.add('active');
}

// Render Outline accordion nodes
function formatOutlineEvidence(ev) {
  if (!ev) return '';
  if (Array.isArray(ev)) {
    return ev.map(line => `• ${line}`).join('<br>');
  }
  return ev;
}

function renderOutline() {
  const container = document.getElementById('ws-outline-container');
  if (!container) return;
  container.innerHTML = '';
  
  const topic = currentTopic;
  if (!topic || !topic.has_full_details || !topic.details) {
    container.innerHTML = '<div class="empty-state">Chưa có dàn ý chi tiết mẫu. Hãy tự xây dựng bài viết dựa trên cấu trúc chuẩn của thể loại này!</div>';
    return;
  }
  
  // Get ideas based on B1 or B2 level selection
  const ideasObj = currentOutlineLevel === 'B1' ? topic.details.ideas_b1 : topic.details.ideas_b2;
  if (!ideasObj) return;
  
  // Set pills active states
  const b1Pill = document.getElementById('ws-level-b1-pill');
  const b2Pill = document.getElementById('ws-level-b2-pill');
  if (b1Pill && b2Pill) {
    if (currentOutlineLevel === 'B1') {
      b1Pill.classList.add('active');
      b2Pill.classList.remove('active');
    } else {
      b2Pill.classList.add('active');
      b1Pill.classList.remove('active');
    }
  }
  
  // Render benefits (or causes)
  const isCausesSolutions = currentCategory.id === 2;
  const isOpinion = currentCategory.id === 3;
  const isDiscussion = currentCategory.id === 4;

  const activeApp = (topic.approaches && typeof currentApproachIndex !== 'undefined' && topic.approaches[currentApproachIndex])
    ? topic.approaches[currentApproachIndex]
    : null;
  const isOpinionDisagree = isOpinion && activeApp && (activeApp.stance === 'disagree' || (activeApp.name && activeApp.name.includes('KHÔNG ĐỒNG Ý')));

  let benefitLabel = isCausesSolutions ? "CAUSES (NGUYÊN NHÂN)" : (isOpinion ? (isOpinionDisagree ? "REASONS FOR DISAGREEMENT (LÝ DO KHÔNG ĐỒNG Ý)" : "REASONS FOR AGREEMENT (LÝ DO ĐỒNG Ý)") : (isDiscussion ? "VIEW 01 (QUAN ĐIỂM 1)" : "ADVANTAGES (LỢI ÍCH)"));
  let drawbackLabel = isCausesSolutions ? "SOLUTIONS (GIẢI PHÁP)" : (isOpinion ? "REASONS (LÝ DO)" : (isDiscussion ? "VIEW 02 (QUAN ĐIỂM 2)" : "DISADVANTAGES (BẤT LỢI)"));
  if (isCausesSolutions && currentTopic) {
    const tags = (Array.isArray(currentTopic.tags) ? currentTopic.tags.join(', ') : (currentTopic.tags || '')).toLowerCase();
    if (tags.includes('effect') || tags.includes('impact')) {
      if (tags.includes('cause')) {
        benefitLabel = "CAUSES (NGUYÊN NHÂN)";
        drawbackLabel = "EFFECTS (ẢNH HƯỞNG)";
      } else if (tags.includes('solution') || tags.includes('measure')) {
        benefitLabel = "EFFECTS (ẢNH HƯỞNG)";
        drawbackLabel = "SOLUTIONS (GIẢI PHÁP)";
      } else if (tags.includes('positive')) {
        benefitLabel = "POSITIVE EFFECTS (ẢNH HƯỞNG TÍCH CỰC)";
        drawbackLabel = "NEGATIVE EFFECTS (ẢNH HƯỞNG TIÊU CỰC)";
      } else {
        benefitLabel = "EFFECTS (ẢNH HƯỞNG)";
        drawbackLabel = "EFFECTS (ẢNH HƯỞNG)";
      }
    } else if (tags.includes('solution') || tags.includes('measure')) {
      benefitLabel = "SOLUTIONS (GIẢI PHÁP)";
      drawbackLabel = "SOLUTIONS (GIẢI PHÁP)";
    } else if (tags.includes('problem')) {
      benefitLabel = "PROBLEMS (VẤN ĐỀ)";
      drawbackLabel = "SOLUTIONS (GIẢI PHÁP)";
    }
  }
  
  const group1Items = isCausesSolutions
    ? (ideasObj.causes || ideasObj.problems || ideasObj.benefits || ideasObj.reasons || ideasObj.factors)
    : (ideasObj.benefits || ideasObj.causes || ideasObj.reasons || ideasObj.views || ideasObj.factors);
  const group2Items = isCausesSolutions
    ? (ideasObj.solutions || ideasObj.effects || ideasObj.drawbacks || ideasObj.problems || ideasObj.measures)
    : (ideasObj.drawbacks || ideasObj.effects || ideasObj.solutions || ideasObj.problems || ideasObj.measures);

  const isSelectable = hasSelectableIdeas(topic);
  const selB = isSelectable ? getSelectedIdeaIndices(topic, 'benefits') : [];
  const selD = isSelectable ? getSelectedIdeaIndices(topic, 'drawbacks') : [];

  if (isSelectable) {
    const topicTagsLower = ((Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || ''))).toLowerCase();
    const isCausesSolutionsOnlySolutions = isCausesSolutions && (topicTagsLower.includes('solution') || topicTagsLower.includes('measure')) && !topicTagsLower.includes('cause') && !topicTagsLower.includes('effect') && !topicTagsLower.includes('problem');
    const group1Name = isCausesSolutions ? (isCausesSolutionsOnlySolutions ? 'giải pháp' : 'nguyên nhân') : (isOpinion ? (isOpinionDisagree ? 'lý do không đồng ý' : 'lý do đồng ý') : (isDiscussion ? 'quan điểm 1' : 'thuận lợi'));
    const group2Name = isCausesSolutions ? 'giải pháp' : (isOpinion ? 'lý do' : (isDiscussion ? 'quan điểm 2' : 'bất lợi'));
    const selBanner = document.createElement('div');
    selBanner.className = 'outline-idea-selector-banner';
    selBanner.innerHTML = `
      <div style="font-weight: 700; font-size: 0.8rem; color: var(--accent-primary);">
        🎯 Đang chọn: ${selB.length} ${group1Name} ${group2Items && group2Items.length > 0 ? `& ${selD.length} ${group2Name}` : ''}
      </div>
      <div style="font-size: 0.72rem; color: var(--text-muted);">
        (Tick chọn ý luyện viết)
      </div>
    `;
    container.appendChild(selBanner);
  }

  if (topic.details && topic.details.mindmap_img) {
    const mmBanner = document.createElement('div');
    mmBanner.style.cssText = "margin-bottom: 0.75rem; padding: 0.6rem 0.75rem; background: rgba(99, 102, 241, 0.08); border: 1px dashed var(--primary); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;";
    mmBanner.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-primary); font-weight: 600;">
        💡 Sơ đồ tư duy (${group1Items ? group1Items.length : 5} lựa chọn)
      </div>
      <button class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 600;" onclick="openMindmapModal('${topic.details.mindmap_img}', 'Sơ đồ tư duy: ${topic.title_vi || topic.title_en}')">
        Xem Mindmap
      </button>
    `;
    container.appendChild(mmBanner);
  }

  if (group1Items && group1Items.length > 0) {
    group1Items.forEach((item, idx) => {
      const isSelected = !isSelectable || group1Items.length <= 3 || selB.includes(idx);
      const node = document.createElement('div');
      node.className = `outline-node ${isSelected ? 'is-selected' : 'is-unselected'}`;
      const nodeBodyId = `outline-node-benefit-${idx}`;
      
      node.innerHTML = `
        <div class="outline-node-header benefit" onclick="toggleAccordion('${nodeBodyId}')">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0;">
            ${(isSelectable && group1Items.length > 3) ? `
              <input type="checkbox" class="outline-idea-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleIdeaSelection('benefits', ${idx});" title="Chọn / bỏ chọn ý này để luyện viết">
            ` : ''}
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title || `${benefitLabel} 0${idx+1}`}</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 14px; height: 14px; flex-shrink: 0;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
        <div class="outline-node-body" id="${nodeBodyId}" style="display: none;">
          <div class="outline-point">Luận điểm: ${item.point_vi}</div>
          <div style="font-style: italic; color: var(--text-secondary); margin-bottom: 0.5rem;">→ ${item.point_en}</div>
          
          <div class="outline-point">Luận cứ:</div>
          <div class="outline-desc">${formatOutlineEvidence(item.evidence_vi)}</div>
          <div class="outline-desc" style="font-style: italic; margin-top: 0.25rem;">${formatOutlineEvidence(item.evidence_en)}</div>
        </div>
      `;
      container.appendChild(node);
    });
  }
  
  // Render drawbacks (or solutions / effects)
  if (group2Items && group2Items.length > 0) {
    group2Items.forEach((item, idx) => {
      const isSelected = !isSelectable || group2Items.length <= 3 || selD.includes(idx);
      const node = document.createElement('div');
      node.className = `outline-node ${isSelected ? 'is-selected' : 'is-unselected'}`;
      const nodeBodyId = `outline-node-drawback-${idx}`;
      
      node.innerHTML = `
        <div class="outline-node-header drawback" onclick="toggleAccordion('${nodeBodyId}')">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0;">
            ${(isSelectable && group2Items.length > 3) ? `
              <input type="checkbox" class="outline-idea-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleIdeaSelection('drawbacks', ${idx});" title="Chọn / bỏ chọn ý này để luyện viết">
            ` : ''}
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title || `${drawbackLabel} 0${idx+1}`}</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 14px; height: 14px; flex-shrink: 0;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
        <div class="outline-node-body" id="${nodeBodyId}" style="display: none;">
          <div class="outline-point">Luận điểm: ${item.point_vi}</div>
          <div style="font-style: italic; color: var(--text-secondary); margin-bottom: 0.5rem;">→ ${item.point_en}</div>
          
          <div class="outline-point">Luận cứ:</div>
          <div class="outline-desc">${formatOutlineEvidence(item.evidence_vi)}</div>
          <div class="outline-desc" style="font-style: italic; margin-top: 0.25rem;">${formatOutlineEvidence(item.evidence_en)}</div>
        </div>
      `;
      container.appendChild(node);
    });
  }
}

// Toggle accordion items in outlines
function toggleAccordion(id) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.style.display === 'none') {
    element.style.display = 'flex';
  } else {
    element.style.display = 'none';
  }
}

// Switch outline level (B1 vs B2)
function switchOutlineLevel(level) {
  level = 'B2';
  currentOutlineLevel = level;
  currentVocabLevel = level;
  renderOutline();
}

// Render Vietnamese Outline View
function renderVietnameseOutline() {
  const container = document.getElementById('ws-vietnamese-outline-container');
  if (!container) return;
  container.innerHTML = '';
  
  const topic = currentTopic;
  if (!topic || !topic.has_full_details || !topic.details) {
    container.innerHTML = '<div class="empty-state">Chủ đề này viết tự do, bạn có thể tự xây dựng ý tưởng nháp nháp tiếng Việt trước khi bắt đầu viết luận tiếng Anh.</div>';
    return;
  }
  
  const ideasObj = topic.details.ideas_b2 || topic.details.ideas_b1; // Use B2 ideas
  if (!ideasObj) return;

  const group1Items = ideasObj.benefits || ideasObj.causes || ideasObj.reasons || ideasObj.views || ideasObj.factors || [];
  const group2Items = ideasObj.drawbacks || ideasObj.effects || ideasObj.solutions || ideasObj.problems || ideasObj.measures || [];
  
  const div = document.createElement('div');
  div.className = 'prompt-card';
  div.innerHTML = `
    <h5 style="margin-bottom: 0.75rem;">Gợi ý cấu trúc dàn bài chi tiết:</h5>
    <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary);">
      <p><strong>1. Mở bài (Introduction):</strong></p>
      <ul style="padding-left: 1rem; margin-bottom: 0.75rem;">
        <li>Dẫn dắt chủ đề (Paraphrase lại đề bài)</li>
        <li>Tuyên bố luận đề (Nêu rõ mục đích bài viết - thảo luận cả hai khía cạnh hoặc quan điểm)</li>
      </ul>
      
      ${group2Items.length > 0 ? `
      <p><strong>2. Thân bài 1 (Body Paragraph 1):</strong></p>
      <ul style="padding-left: 1rem; margin-bottom: 0.75rem;">
        ${group1Items.length > 0 ? group1Items.map((item, idx) => `
        <li style="${idx > 0 ? 'margin-top: 0.5rem;' : ''}">
          Nêu luận điểm ${idx + 1}:
          <br><span style="color: var(--text-primary); font-weight: 500;">- ${item.point_vi}</span>
          <br><span style="color: var(--text-secondary); font-size: 0.8rem;">Ý phụ bổ sung lý giải:</span>
          <br><span>${formatOutlineEvidence(item.evidence_vi)}</span>
        </li>
        `).join('') : '<li>Phát triển các ý tưởng chính cho thân bài 1</li>'}
      </ul>
      
      <p><strong>3. Thân bài 2 (Body Paragraph 2):</strong></p>
      <ul style="padding-left: 1rem; margin-bottom: 0.75rem;">
        ${group2Items.map((item, idx) => `
        <li style="${idx > 0 ? 'margin-top: 0.5rem;' : ''}">
          Nêu luận điểm ${idx + 1}:
          <br><span style="color: var(--text-primary); font-weight: 500;">- ${item.point_vi}</span>
          <br><span style="color: var(--text-secondary); font-size: 0.8rem;">Ý phụ bổ sung lý giải:</span>
          <br><span>${formatOutlineEvidence(item.evidence_vi)}</span>
        </li>
        `).join('')}
      </ul>
      
      <p><strong>4. Kết bài (Conclusion):</strong></p>
      ` : `
      <p><strong>2. Phần Thân bài (Body Paragraphs - Chọn 3 luận điểm tiêu biểu để phát triển thành 3 đoạn thân bài):</strong></p>
      <ul style="padding-left: 1rem; margin-bottom: 0.75rem;">
        ${group1Items.map((item, idx) => `
        <li style="${idx > 0 ? 'margin-top: 0.5rem;' : ''}">
          <strong>Luận điểm gợi ý 0${idx + 1}:</strong>
          <br><span style="color: var(--text-primary); font-weight: 500;">- ${item.point_vi}</span>
          <br><span style="color: var(--text-secondary); font-size: 0.8rem;">Ý phụ bổ sung lý giải:</span>
          <br><span>${formatOutlineEvidence(item.evidence_vi)}</span>
        </li>
        `).join('')}
      </ul>
      
      <p><strong>3. Kết bài (Conclusion):</strong></p>
      `}
      <ul style="padding-left: 1rem;">
        <li>Khẳng định lại vấn đề (Tóm tắt lại các điểm chính của hai đoạn thân bài)</li>
        <li>Ý kiến hoặc khuyến nghị cuối cùng của bản thân</li>
      </ul>
    </div>
  `;
  container.appendChild(div);
}

// --- Timer Controllers ---
function startTimer() {
  if (isTimerRunning) return;
  isTimerRunning = true;
  
  const timerBtn = document.getElementById('timer-toggle-btn');
  // Update timer SVG to pause icon
  document.getElementById('timer-icon-svg').innerHTML = `<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />`;
  
  timerInterval = setInterval(() => {
    writingElapsedSeconds++;
    if (timerSeconds > 0) {
      timerSeconds--;
      updateTimerDisplay();
    } else if (!overtimeNotified) {
      overtimeNotified = true;
      showToast("⏰ Hết thời gian làm bài thi 40 phút! Đồng hồ vẫn tiếp tục ghi nhận tổng thời gian viết.", "warning");
    }
  }, 1000);
}

function stopTimer() {
  if (!isTimerRunning) return;
  isTimerRunning = false;
  clearInterval(timerInterval);
  
  // Update timer SVG to play icon
  document.getElementById('timer-icon-svg').innerHTML = `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />`;
}

function toggleTimer() {
  if (isTimerRunning) {
    stopTimer();
  } else {
    startTimer();
  }
}

function resetTimer() {
  stopTimer();
  timerSeconds = 40 * 60;
  writingElapsedSeconds = 0;
  overtimeNotified = false;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  document.getElementById('timer-text').innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- Manual Progress Save System ---
function saveProgressAction(silent = false) {
  if (!currentCategory || !currentTopic) return;
  
  // 1. Save all Step 3 translation inputs (per student)
  const inputs = document.querySelectorAll('.trans-input-area');
  inputs.forEach((input) => {
    const parts = input.id.split('-');
    if (parts.length === 3) {
      const idx = parts[2];
      const text = input.value;
      const inputKey = getStudentTransKey('input', currentCategory.id, currentTopic.id, currentTransLevel, idx);
      localStorage.setItem(inputKey, text);
    }
  });

  // 2. Save Step 4 essay textarea (per student)
  const text = document.getElementById('essay-textarea').value;
  if (text.trim() || inputs.length > 0) {
    const key = getStudentDraftKey(currentCategory.id, currentTopic.id);
    if (text.trim()) {
      localStorage.setItem(key, text);
      if (window.StudentHistorySync && typeof window.StudentHistorySync.recordDraftChange === 'function') {
        window.StudentHistorySync.recordDraftChange(currentCategory.id, currentTopic.id, false);
      }
    }
  }
  if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
    window.StudentHistorySync.schedulePush(true);
  }
  
  // Update UI and state
  updateStats();
  isDirty = false;
  if (!silent) {
    showToast("💾 Đã lưu tiến độ bài làm thành công!", "success");
  }
}

// --- Textarea helper functions ---
function clearProgressAction() {
  if (!currentCategory || !currentTopic) return;
  
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ bản lưu và nội dung hiện tại của đề bài này? Hành động này không thể khôi phục.")) {
    // 1. Clear Step 3 DOM and localStorage (per student)
    const inputs = document.querySelectorAll('.trans-input-area');
    inputs.forEach((input) => {
      input.value = '';
    });

    const transPrefix = getStudentTransTopicPrefix('input', currentCategory.id, currentTopic.id);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(transPrefix)) {
        localStorage.removeItem(k);
      }
    }

    // 2. Clear Step 4 DOM and localStorage (per student)
    const textarea = document.getElementById('essay-textarea');
    if (textarea) {
      textarea.value = '';
    }
    const key = getStudentDraftKey(currentCategory.id, currentTopic.id);
    localStorage.removeItem(key);
    if (window.StudentHistorySync && typeof window.StudentHistorySync.recordDraftChange === 'function') {
      window.StudentHistorySync.recordDraftChange(currentCategory.id, currentTopic.id, true);
    }
    
    // 3. Update UI and State
    isDirty = false;
    updateWordCount();
    updateStats();
    showToast("Đã xóa bản lưu và làm mới tiến độ bài làm!", "success");
  }
}

function copyToClipboard() {
  const text = document.getElementById('essay-textarea').value;
  if (!text.trim()) {
    showToast("Nội dung trống, không thể sao chép!", "warning");
    return;
  }
  
  navigator.clipboard.writeText(text).then(() => {
    showToast("📋 Đã sao chép bài viết vào Clipboard của hệ thống!", "success");
  }).catch(() => {
    showToast("Không thể sao chép tự động. Vui lòng tự bôi đen và sao chép.", "danger");
  });
}

function updateWordCount() {
  isDirty = true;
  const text = document.getElementById('essay-textarea').value;
  
  // Calculate words
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  const chars = text.length;
  
  document.getElementById('words-typed').innerText = words;
  document.getElementById('char-count-display').innerText = `${chars} ký tự`;
  
  // Update progress bar
  const target = 250;
  const progressPercent = Math.min(100, (words / target) * 100);
  const progressBar = document.getElementById('word-progress-fill');
  progressBar.style.width = `${progressPercent}%`;
  
  if (words >= target) {
    progressBar.classList.add('target-met');
  } else {
    progressBar.classList.remove('target-met');
  }
}

// --- Simulated AI Grading & Assessment Engine ---

// --- Sentence Segmenter for Error Detection Mode ---
function segmentSentences(text) {
  if (!text) return [];
  const abbreviations = ["e.g.", "i.e.", "etc.", "a.m.", "p.m.", "dr.", "mr.", "mrs.", "vs.", "st.", "prof."];
  let sentences = [];
  let currentStart = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '.' || char === '!' || char === '?') {
      const nextChar = text[i + 1];
      if (!nextChar || /\s/.test(nextChar)) {
        let wordStart = i - 1;
        while (wordStart >= currentStart && /[\w]/.test(text[wordStart])) {
          wordStart--;
        }
        wordStart++;
        const precedingWord = text.slice(wordStart, i + 1).toLowerCase();
        
        let checkLonger = text.slice(Math.max(currentStart, i - 4), i + 1).toLowerCase();
        let isAbbrev = false;
        for (const abbrev of abbreviations) {
          if (precedingWord === abbrev || checkLonger.endsWith(abbrev)) {
            isAbbrev = true;
            break;
          }
        }
        
        if (!isAbbrev) {
          sentences.push(text.slice(currentStart, i + 1));
          currentStart = i + 1;
          while (currentStart < text.length && /\s/.test(text[currentStart])) {
            currentStart++;
          }
          i = currentStart - 1;
        }
      }
    }
  }
  
  if (currentStart < text.length) {
    const lastPart = text.slice(currentStart).trim();
    if (lastPart.length > 0) {
      sentences.push(lastPart);
    }
  }
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

// --- Word-by-Word Sentence Error Analyzer ---
function analyzeSentenceErrors(sentenceStr) {
  const trimmed = sentenceStr.trim();
  if (trimmed === "") return { errors: [], corrected: "" };
  
  const errors = [];
  const lowerSentence = trimmed.toLowerCase();
  
  const rawWords = trimmed.split(/\s+/).filter(w => w.length > 0);
  
  // 1. Capitalization (Sentence Structure)
  const firstChar = trimmed.charAt(0);
  if (/[a-z]/.test(firstChar)) {
    errors.push({
      errorType: "Sentence Structure (Viết hoa)",
      incorrect: firstChar,
      explanation: "Chữ cái đầu tiên của câu tiếng Anh phải được viết hoa.",
      correction: firstChar.toUpperCase(),
      impact: "Minor"
    });
  }
  
  for (let i = 1; i < rawWords.length; i++) {
    const rawWord = rawWords[i].replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
    if (rawWord.length > 0 && rawWord !== 'I') {
      const firstL = rawWord.charAt(0);
      if (firstL === firstL.toUpperCase() && /[A-Z]/.test(firstL)) {
        const clean = rawWord.toLowerCase();
        if (COMMON_ENGLISH_WORDS.has(clean)) {
          errors.push({
            errorType: "Sentence Structure (Viết hoa)",
            incorrect: rawWord,
            explanation: `Từ '${rawWord}' ở giữa câu không thuộc nhóm danh từ riêng, không cần viết hoa chữ cái đầu.`,
            correction: clean,
            impact: "Minor"
          });
        }
      }
    }
  }
  
  // 2. Punctuation (Sentence Structure)
  const lastChar = trimmed.slice(-1);
  if (!/[.!?]/.test(lastChar)) {
    errors.push({
      errorType: "Sentence Structure (Dấu câu)",
      incorrect: "Thiếu dấu câu cuối câu",
      explanation: "Câu viết chưa có dấu kết thúc. Vui lòng thêm dấu chấm (.) ở cuối câu.",
      correction: ".",
      impact: "Minor"
    });
  }
  
  const punctuationSpaceRegex = /\s+([,;.!?])/g;
  let punctMatch;
  while ((punctMatch = punctuationSpaceRegex.exec(trimmed)) !== null) {
    errors.push({
      errorType: "Sentence Structure (Dấu câu)",
      incorrect: punctMatch[0],
      explanation: "Quy tắc viết dấu câu tiếng Anh không cho phép khoảng trắng trước dấu câu.",
      correction: punctMatch[1],
      impact: "Minor"
    });
  }

  // Unnecessary comma immediately after subordinating conjunctions: "because,", "although,", etc.
  const badCommaConjRegex = /\b(because|although|though|while|since|that)\s*,\s*/gi;
  let badCommaMatch;
  while ((badCommaMatch = badCommaConjRegex.exec(trimmed)) !== null) {
    const conj = badCommaMatch[1];
    errors.push({
      errorType: "Sentence Structure (Dấu câu)",
      incorrect: badCommaMatch[0].trim(),
      explanation: `Không dùng dấu phẩy ngay sau liên từ '${conj}' khi liên từ này nối trực tiếp với mệnh đề theo sau.`,
      correction: conj + " ",
      impact: "Minor"
    });
  }
  
  // 3. Contractions (Vocabulary)
  for (let i = 0; i < rawWords.length; i++) {
    const rawWord = rawWords[i];
    const cleanWord = rawWord.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    if (ACADEMIC_CONTRACTIONS[cleanWord]) {
      const cleanRawWord = rawWord.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
      errors.push({
        errorType: "Vocabulary (Academic Style)",
        incorrect: cleanRawWord,
        explanation: `Từ viết tắt '${cleanRawWord}' không phù hợp với văn phong bài viết học thuật VSTEP. Nên viết đầy đủ dạng trang trọng hơn.`,
        correction: ACADEMIC_CONTRACTIONS[cleanWord],
        impact: "Minor"
      });
    }
  }
  
  // 4. Collocations (Collocation)
  for (const [wrongPhrase, suggestion] of Object.entries(CONTEXTUAL_WORD_CHOICES)) {
    const regex = new RegExp('\\b' + wrongPhrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
    if (regex.test(lowerSentence)) {
      errors.push({
        errorType: "Collocation",
        incorrect: wrongPhrase,
        explanation: `Cụm từ '${wrongPhrase}' chưa chuẩn tự nhiên trong tiếng Anh. Nên thay thế để tăng tính chuyên nghiệp.`,
        correction: suggestion.split(' / ')[0].split(' (')[0],
        impact: "Moderate"
      });
    }
  }
  
  // 5. Spelling (Vocabulary)
  const dict = getValidWordDictionary();
  dict.add("vstep");
  dict.add("ielts");
  dict.add("toefl");
  
  for (let i = 0; i < rawWords.length; i++) {
    const rawWord = rawWords[i];
    const cleanWord = rawWord.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    if (cleanWord.length === 0 || /[0-9]/.test(cleanWord) || ACADEMIC_CONTRACTIONS[cleanWord]) continue;
    
    // Avoid double-flagging if already captured by Collocation
    if (errors.some(e => e.errorType === 'Collocation' && e.incorrect.toLowerCase().includes(cleanWord))) {
      continue;
    }

    const isCapitalizedMiddle = i > 0 && rawWord[0] === rawWord[0].toUpperCase() && rawWord !== "I";
    if (isCapitalizedMiddle && !COMMON_ENGLISH_WORDS.has(cleanWord)) continue;
    
    // Check hyphenated/slashed compound words
    let isCompoundWordValid = false;
    if (cleanWord.includes('-') || cleanWord.includes('/')) {
      const parts = cleanWord.split(/[-/]/);
      isCompoundWordValid = parts.every(part => {
        const p = part.trim();
        return p.length === 0 || dict.has(p) || p.length <= 2 || /^[0-9]+$/.test(p);
      });
    }
    
    if (!dict.has(cleanWord) && !isCompoundWordValid) {
      let closestWord = "";
      let minDistance = 999;
      dict.forEach(dictWord => {
        if (Math.abs(dictWord.length - cleanWord.length) <= 2) {
          const dist = getLevenshteinDistance(cleanWord, dictWord);
          if (dist < minDistance) {
            minDistance = dist;
            closestWord = dictWord;
          }
        }
      });
      
      const cleanRawWord = rawWord.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
      let correction = "";
      let explanation = "";
      if (minDistance <= 2 && closestWord !== "") {
        correction = closestWord;
        explanation = `Từ '${cleanRawWord}' có vẻ bị viết sai chính tả. Phải chăng bạn muốn viết là '${closestWord}'?`;
      } else {
        correction = cleanWord;
        explanation = `Từ '${cleanRawWord}' viết sai chính tả hoặc không tồn tại trong từ điển chuẩn tiếng Anh.`;
      }
      
      errors.push({
        errorType: "Vocabulary (Spelling)",
        incorrect: cleanRawWord,
        explanation: explanation,
        correction: correction,
        impact: "Minor"
      });
    }
  }
  
  // 6. Prepositions (Article/Preposition)
  const spendRegex = /\b(spend\s+(?:time|money|costs|hours|days|energy|resources)\s+)(for)\b/i;
  const spendMatch = spendRegex.exec(trimmed);
  if (spendMatch) {
    errors.push({
      errorType: "Article/Preposition",
      incorrect: "for",
      explanation: "Cấu trúc 'spend time/money' đi với giới từ 'on' để liên kết danh từ, không sử dụng 'for'.",
      correction: "on",
      impact: "Moderate"
    });
  }
  
  const focusRegex = /\bfocus\s+(?:more\s+)?(to|in|at|for)\b/i;
  const focusMatch = focusRegex.exec(trimmed);
  if (focusMatch) {
    errors.push({
      errorType: "Article/Preposition",
      incorrect: focusMatch[1],
      explanation: "Động từ 'focus' đi kèm giới từ 'on' (focus on something).",
      correction: "on",
      impact: "Moderate"
    });
  }
  
  const participateRegex = /\bparticipate\s+(on|to|at|for)\b/i;
  const participateMatch = participateRegex.exec(trimmed);
  if (participateMatch) {
    errors.push({
      errorType: "Article/Preposition",
      incorrect: participateMatch[1],
      explanation: "Động từ 'participate' đi kèm giới từ 'in' (participate in something).",
      correction: "in",
      impact: "Moderate"
    });
  }
  
  // Article/determiner check: "technical problem is/was" -> "a technical problem is/was"
  const techProblemRegex = /\b(technical\s+problem)\s+(is|was)\b/i;
  const techProblemMatch = techProblemRegex.exec(trimmed);
  if (techProblemMatch) {
    errors.push({
      errorType: "Article/Preposition",
      incorrect: "technical problem",
      explanation: `Danh từ đếm được số ít 'technical problem' cần có mạo từ 'a' đi kèm ở phía trước.`,
      correction: "a technical problem",
      impact: "Minor"
    });
  }
  
  // 7. Word Form (Word Form)
  const verbAdjRegex = /\b(bring|brings|offer|offers|provide|provides|have|has|get|gets|show|shows|gain|gains)\s+(flexible|convenient|independent|distracted|isolated|interacted|difficult|expensive|costly)\b/i;
  const verbAdjMatch = verbAdjRegex.exec(trimmed);
  if (verbAdjMatch) {
    const adj = verbAdjMatch[2].toLowerCase();
    const noun = ADJECTIVE_TO_NOUN[adj] || adj;
    errors.push({
      errorType: "Word Form",
      incorrect: verbAdjMatch[2],
      explanation: `Từ '${verbAdjMatch[2]}' là tính từ. Cần sử dụng dạng danh từ '${noun}' làm tân ngữ của động từ '${verbAdjMatch[1]}'.`,
      correction: noun,
      impact: "Serious"
    });
  }
  
  // 8. Subject-Verb Agreement (Grammar)
  const ADVERBS = ["always", "often", "usually", "sometimes", "rarely", "seldom", "never", "greatly", "strongly", "actively", "directly", "indirectly", "successfully", "easily", "actually", "probably", "certainly", "definitely", "highly", "fully", "totally", "completely"];
  const adverbPattern = '(?:(?:' + ADVERBS.join('|') + ')\\s+)?';

  for (const subj of ["online learning", "distance learning", "e-learning", "it", "he", "she", "this", "that", "education", "study", "connection", "platform", "benefit", "drawback", "problem", "solution", "learner", "student", "teacher", "school", "parent", "child", "peer", "friend"]) {
    const subjIdx = lowerSentence.indexOf(subj);
    if (subjIdx !== -1) {
      for (const [plurVerb, singVerb] of Object.entries(VERB_PLURAL_TO_SINGULAR)) {
        const verbRegex = new RegExp('\\b' + subj + '\\s+' + adverbPattern + plurVerb + '\\b', 'i');
        if (verbRegex.test(trimmed)) {
          errors.push({
            errorType: "Grammar (Subject-Verb Agreement)",
            incorrect: plurVerb,
            explanation: `Chủ ngữ ngôi thứ ba số ít '${subj}' đi với động từ chia số nhiều '${plurVerb}'. Cần chia số ít là '${singVerb}'.`,
            correction: singVerb,
            impact: "Moderate"
          });
        }
      }
    }
  }
  
  for (const subj of ["learners", "students", "teachers", "schools", "parents", "children", "peers", "friends", "people", "they", "we", "connections", "platforms", "benefits", "drawbacks", "problems", "solutions"]) {
    const subjIdx = lowerSentence.indexOf(subj);
    if (subjIdx !== -1) {
      for (const [singVerb, plurVerb] of Object.entries(VERB_SINGULAR_TO_PLURAL)) {
        const verbRegex = new RegExp('\\b' + subj + '\\s+' + adverbPattern + singVerb + '\\b', 'i');
        if (verbRegex.test(trimmed)) {
          errors.push({
            errorType: "Grammar (Subject-Verb Agreement)",
            incorrect: singVerb,
            explanation: `Chủ ngữ số nhiều '${subj}' đi với động từ chia số ít '${singVerb}'. Cần chia số nhiều là '${plurVerb}'.`,
            correction: plurVerb,
            impact: "Moderate"
          });
        }
      }
    }
  }

  // S-V agreement in compound predicate: "it is ... and [plural verb]" -> "[singular verb]"
  const compoundSingRegex = /\b(it|he|she|this|that|online learning|distance learning|e-learning)\s+(?:is|was)\s+([\w\s]{1,15})\s+and\s+(become|have|save|provide|make|do|go|help|affect|bring)\b/i;
  const compoundSingMatch = compoundSingRegex.exec(trimmed);
  if (compoundSingMatch) {
    const plurVerb = compoundSingMatch[3].toLowerCase();
    const singVerb = VERB_PLURAL_TO_SINGULAR[plurVerb] || (plurVerb + 's');
    errors.push({
      errorType: "Grammar (Subject-Verb Agreement)",
      incorrect: plurVerb,
      explanation: `Chủ ngữ ngôi thứ ba số ít '${compoundSingMatch[1]}' đi với động từ chia số nhiều '${plurVerb}' sau từ nối 'and'. Cần chia số ít là '${singVerb}'.`,
      correction: singVerb,
      impact: "Moderate"
    });
  }

  // S-V agreement with relative pronoun: "who/that + plural verb" preceded by singular noun
  const relSingRegex = /\b(student|learner|person|child|parent|teacher|peer|friend)\s+(who|that)\s+(become|have|live|save|provide|make|do|go|help|affect|bring)\b/i;
  const relSingMatch = relSingRegex.exec(trimmed);
  if (relSingMatch) {
    const plurVerb = relSingMatch[3].toLowerCase();
    const singVerb = VERB_PLURAL_TO_SINGULAR[plurVerb] || (plurVerb + 's');
    errors.push({
      errorType: "Grammar (Subject-Verb Agreement)",
      incorrect: plurVerb,
      explanation: `Mệnh đề quan hệ bổ nghĩa cho danh từ số ít '${relSingMatch[1]}' phải đi với động từ số ít '${singVerb}', không dùng '${plurVerb}'.`,
      correction: singVerb,
      impact: "Moderate"
    });
  }

  // Clause-modifying "which + plural verb" -> "which + singular verb"
  const relWhichRegex = /\bwhich\s+(affect|make|cause|help|provide|lead|bring|allow|do|go)\b/i;
  const relWhichMatch = relWhichRegex.exec(trimmed);
  if (relWhichMatch) {
    const plurVerb = relWhichMatch[1].toLowerCase();
    const singVerb = VERB_PLURAL_TO_SINGULAR[plurVerb] || (plurVerb + 's');
    errors.push({
      errorType: "Grammar (Subject-Verb Agreement)",
      incorrect: plurVerb,
      explanation: `Đại từ quan hệ 'which' thay thế cho một mệnh đề/sự việc ở trước phải đi với động từ chia số ít '${singVerb}'.`,
      correction: singVerb,
      impact: "Moderate"
    });
  }
  
  // 9. Verb Tense (Grammar)
  for (let i = 0; i < rawWords.length; i++) {
    const rawWord = rawWords[i];
    const cleanWord = rawWord.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    if (PAST_TO_PRESENT[cleanWord]) {
      const cleanRawWord = rawWord.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
      const presForms = PAST_TO_PRESENT[cleanWord];
      const hasSingularSubject = /\b(online learning|distance learning|e-learning|study|education|it|he|she)\b/i.test(trimmed);
      const suggestedForm = hasSingularSubject ? presForms.sing : presForms.plur;
      
      errors.push({
        errorType: "Grammar (Verb Tense)",
        incorrect: cleanRawWord,
        explanation: `Trong văn phong nghị luận học thuật VSTEP về chủ đề thực tế, nên dùng thì Hiện tại Đơn thay vì Quá khứ Đơn '${cleanRawWord}'.`,
        correction: suggestedForm,
        impact: "Moderate"
      });
    }
  }
  
  // 10. Pluralization (Grammar)
  const DETERMINERS = ['a', 'an', 'the', 'each', 'every', 'one', 'another', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'no', 'any', 'some', 'many', 'all', 'few', 'several'];
  for (let i = 0; i < rawWords.length; i++) {
    const rawWord = rawWords[i];
    const cleanWord = rawWord.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    if (NOUN_SINGULAR_TO_PLURAL[cleanWord]) {
      const pluralForm = NOUN_SINGULAR_TO_PLURAL[cleanWord];
      
      let hasDeterminer = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const w = rawWords[j].toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
        if (DETERMINERS.includes(w) || w.endsWith('ing') || ['at', 'in', 'to', 'by', 'for', 'with', 'from', 'as', 'of', 'on', 'about', 'without', 'after', 'before', 'during', 'into', 'onto', 'upon', 'over', 'under', 'through', 'between', 'among'].includes(w)) {
          hasDeterminer = true;
          break;
        }
      }
      
      if (!hasDeterminer) {
        const cleanRawWord = rawWord.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
        errors.push({
          errorType: "Grammar (Singular/Plural)",
          incorrect: cleanRawWord,
          explanation: `Danh từ đếm được '${cleanRawWord}' dùng ở nghĩa chung chung nên để ở dạng số nhiều '${pluralForm}' hoặc thêm từ hạn định.`,
          correction: pluralForm,
          impact: "Minor"
        });
      }
    }
  }

  // 11. Verb Pattern (Grammar)
  const verbPatternRegex = /\b(avoid|suggest|mind|enjoy|practice|keep)\s+to\s+([a-z]+)\b/i;
  const verbPatternMatch = verbPatternRegex.exec(trimmed);
  if (verbPatternMatch) {
    const verb = verbPatternMatch[1].toLowerCase();
    const action = verbPatternMatch[2].toLowerCase();
    let gerund = action;
    if (action.endsWith('e') && !action.endsWith('ee')) {
      gerund = action.slice(0, -1) + 'ing';
    } else if (action.endsWith('y')) {
      gerund = action + 'ing';
    } else if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(action) && !/[aeiou]{2}[bcdfghjklmnpqrstvwxyz]$/.test(action)) {
      if (action.length <= 4) {
        gerund = action + action.slice(-1) + 'ing';
      } else {
        gerund = action + 'ing';
      }
    } else {
      gerund = action + 'ing';
    }
    errors.push({
      errorType: "Grammar (Verb Pattern)",
      incorrect: `to ${verbPatternMatch[2]}`,
      explanation: `Động từ '${verb}' đi sau bởi dạng danh động từ (Gerund - V-ing), không dùng động từ nguyên mẫu có 'to'.`,
      correction: gerund,
      impact: "Serious"
    });
  }
  
  const spendPatternRegex = /\b(spend|spends|spent|waste|wastes|wasted)\s+([\w\s]{1,15})\s+to\s+([a-z]+)\b/i;
  const spendPatternMatch = spendPatternRegex.exec(trimmed);
  if (spendPatternMatch && !/\b(money|time|hours|days|energy|resources|costs)\b/i.test(spendPatternMatch[3])) {
    const action = spendPatternMatch[3].toLowerCase();
    let gerund = action;
    if (action.endsWith('e') && !action.endsWith('ee')) {
      gerund = action.slice(0, -1) + 'ing';
    } else {
      gerund = action + 'ing';
    }
    errors.push({
      errorType: "Grammar (Verb Pattern)",
      incorrect: `to ${spendPatternMatch[3]}`,
      explanation: "Cấu trúc 'spend/waste + time/money' đi kèm danh động từ (V-ing), không sử dụng 'to + Verb'.",
      correction: gerund,
      impact: "Serious"
    });
  }

  // Check "need + base verb" -> "need to + base verb"
  const needPatternRegex = /\b(need|needs|needed)\s+(go|study|learn|have|do|take|make|provide|attend|focus)\b/i;
  const needPatternMatch = needPatternRegex.exec(trimmed);
  if (needPatternMatch) {
    errors.push({
      errorType: "Grammar (Verb Pattern)",
      incorrect: `${needPatternMatch[1]} ${needPatternMatch[2]}`,
      explanation: `Động từ '${needPatternMatch[1]}' phải đi kèm với 'to + Verb' để biểu thị nhu cầu cần làm gì.`,
      correction: `${needPatternMatch[1]} to ${needPatternMatch[2]}`,
      impact: "Serious"
    });
  }

  // 12. Relative Clauses (Grammar)
  const relPeopleRegex = /\b(people|learners?|students?|teachers?|parents?|children|kids?|peers?)\s+(which)\b/i;
  const relPeopleMatch = relPeopleRegex.exec(trimmed);
  if (relPeopleMatch) {
    errors.push({
      errorType: "Grammar (Relative Clause)",
      incorrect: "which",
      explanation: `Đại từ quan hệ chỉ người '${relPeopleMatch[1]}' phải dùng 'who' hoặc 'that', không dùng 'which'.`,
      correction: "who",
      impact: "Serious"
    });
  }
  
  const relThingRegex = /\b(devices?|computers?|phones?|schools?|things?|benefits?|drawbacks?|problems?|solutions?|courses?|networks?|opportunities?|advantages?|disadvantages?)\s+(who)\b/i;
  const relThingMatch = relThingRegex.exec(trimmed);
  if (relThingMatch) {
    errors.push({
      errorType: "Grammar (Relative Clause)",
      incorrect: "who",
      explanation: `Đại từ quan hệ chỉ vật '${relThingMatch[1]}' phải dùng 'which' hoặc 'that', không dùng 'who'.`,
      correction: "which",
      impact: "Serious"
    });
  }

  // Sentence Structure check: "make students difficult to join" -> "make it difficult for students to join"
  const makeAdjRegex = /\bmake\s+([\w\s]{1,20}?)\s+(difficult|easy|possible|impossible)\s+to\s+([a-z]+)\b/i;
  const makeAdjMatch = makeAdjRegex.exec(trimmed);
  if (makeAdjMatch) {
    errors.push({
      errorType: "Sentence Structure",
      incorrect: makeAdjMatch[0],
      explanation: "Cấu trúc 'make + tân ngữ + tính từ + to Verb' không chuẩn. Phải dùng cấu trúc chủ ngữ giả: 'make it + tính từ + for + tân ngữ + to Verb'.",
      correction: `make it ${makeAdjMatch[2]} for ${makeAdjMatch[1].trim()} to ${makeAdjMatch[3]}`,
      impact: "Serious"
    });
  }

  // Build corrected sentence
  let corrected = trimmed;
  const sortedErrors = [...errors].sort((a, b) => b.incorrect.length - a.incorrect.length);
  sortedErrors.forEach(err => {
    if (err.incorrect === "Thiếu dấu câu cuối câu" || err.incorrect === "." || (err.incorrect.includes("dấu câu") && !err.incorrect.includes(","))) {
      return;
    }
    const escIncorrect = err.incorrect.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    let pattern = escIncorrect;
    if (/^\w/.test(err.incorrect)) pattern = '\\b' + pattern;
    if (/\w$/.test(err.incorrect)) pattern = pattern + '\\b';
    const regex = new RegExp(pattern, 'gi');
    corrected = corrected.replace(regex, err.correction);
  });
  corrected = corrected.replace(/\s+([,;.!?])/g, '$1');
  corrected = corrected.replace(/\s{2,}/g, ' ');
  if (corrected.length > 0 && !/[.!?]/.test(corrected.slice(-1))) {
    corrected = corrected + ".";
  }
  if (corrected.length > 0) {
    corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
  }
  
  return { errors, corrected };
}

function detectSuperficialAttempt(text, words, elapsedSec) {
  const userName = sessionStorage.getItem('current_user_name') || '';
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  // Teachers bypass superficial attempt warning
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return { flagged: false, reasons: [], isUnder200: false, isOutlineSkeleton: false, isUnderTwoThirdsTime: false, elapsedSec };
  }

  const TWO_THIRDS_TIME_SEC = Math.floor((40 * 60 * 2) / 3); // 1600s = 26 phút 40 giây
  const isUnder200 = words < 200;
  const isUnderTwoThirdsTime = elapsedSec < TWO_THIRDS_TIME_SEC;

  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 2);
  const avgWordsPerSentence = sentences.length > 0 ? (words / sentences.length) : 0;

  // 1. Outline section headers (Introduction:, Body 1:, Conclusion:, Idea 1:, Mở bài:, ...)
  const headingRegex = /^(?:introduction|intro|body(?:\s*\d+)?|paragraph\s*\d+|conclusion|concl|overview|thesis|topic\s*sentence|idea\s*\d+|point\s*\d+|reason\s*\d+|cause\s*\d+|effect\s*\d+|solution\s*\d+|advantage\s*\d+|disadvantage\s*\d+|mở\s*bài|thân\s*bài(?:\s*\d+)?|kết\s*bài|ý\s*\d+)\s*[:\-–]/i;
  const headingLineCount = lines.filter(l => headingRegex.test(l)).length;

  // 2. Bullet / numbered outline points (-, •, *, +, 1., 2.)
  const bulletRegex = /^(?:[-•*+]|(?:\d+|[a-z])[.)])\s+/i;
  const bulletLineCount = lines.filter(l => bulletRegex.test(l)).length;

  // 3. Fragmented short lines typical of an outline
  const shortLineCount = lines.filter(l => l.split(/\s+/).length < 12).length;
  const isFragmentedOutline = lines.length >= 5 && (shortLineCount / lines.length) >= 0.6;

  // 4. Thin template skeleton (generic connectors/frame without real body development)
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  const developedParagraphs = paragraphs.filter(p => p.split(/\s+/).length >= 45).length;
  const templateMarkers = (text.match(/\b(in recent years|nowadays|this essay will|on the one hand|on the other hand|firstly|secondly|thirdly|moreover|furthermore|in addition|in conclusion|to sum up|all in all)\b/gi) || []).length;
  const isThinTemplate = (words < 200 && developedParagraphs < 2 && (templateMarkers >= 3 || avgWordsPerSentence < 11));

  // 5. Repetitive low-effort padding
  const rawWords = text.toLowerCase().replace(/[^a-z']/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const uniqueRatio = rawWords.length > 0 ? (new Set(rawWords).size / rawWords.length) : 1;
  const isLowEffortRepetition = rawWords.length >= 60 && uniqueRatio < 0.36;

  const isOutlineSkeleton = (
    headingLineCount >= 2 ||
    bulletLineCount >= 3 ||
    isFragmentedOutline ||
    isThinTemplate ||
    isLowEffortRepetition ||
    (sentences.length >= 3 && avgWordsPerSentence < 8.5)
  );

  const flagged = (
    (isUnder200 && isUnderTwoThirdsTime) ||
    (isOutlineSkeleton && isUnderTwoThirdsTime) ||
    (isUnder200 && isOutlineSkeleton)
  );

  const reasons = [];
  if (isUnder200) {
    reasons.push(`Viết dưới 200 từ (${words}/200 từ — chưa đạt chuẩn tối thiểu 250 từ VSTEP)`);
  }
  if (isOutlineSkeleton) {
    if (headingLineCount >= 2 || bulletLineCount >= 3 || isFragmentedOutline) {
      reasons.push('Chỉ viết dạng khung dàn ý / gạch đầu dòng rời rạc, chưa viết thành bài luận hoàn chỉnh');
    } else if (isLowEffortRepetition) {
      reasons.push('Nội dung lặp từ/lặp ý quá nhiều mang tính đối phó');
    } else {
      reasons.push('Chỉ viết khung sườn mở–thân–kết sơ sài, chưa triển khai lập luận và ví dụ');
    }
  }
  if (isUnderTwoThirdsTime) {
    reasons.push(`Nộp bài quá sớm: ${formatWritingDurationVi(elapsedSec)} (chưa tới 2/3 thời gian thi 26 phút 40 giây)`);
  }

  return {
    flagged,
    reasons,
    isUnder200,
    isOutlineSkeleton,
    isUnderTwoThirdsTime,
    elapsedSec
  };
}

function showSuperficialWarningModal(check) {
  let modal = document.getElementById('superficial-warning-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'superficial-warning-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.72);backdrop-filter:blur(4px);z-index:13000;display:flex;align-items:center;justify-content:center;padding:18px;';
    document.body.appendChild(modal);
  }

  const reasonsHtml = (check.reasons || []).map(r => `<li style="margin-bottom:6px;">${escapeHtml(r)}</li>`).join('');
  modal.innerHTML = `
    <div style="width:100%;max-width:540px;background:var(--bg-surface, #ffffff);color:var(--text-primary, #0f172a);border:2.5px solid #dc2626;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(220,38,38,0.32);">
      <div style="background:linear-gradient(135deg, #b91c1c, #dc2626);color:#ffffff;padding:18px 22px;text-align:center;">
        <div style="font-size:2.3rem;line-height:1;margin-bottom:8px;">🚨</div>
        <h3 style="margin:0;font-size:1.18rem;font-weight:900;letter-spacing:0.02em;line-height:1.35;">
          CÓ VẺ BẠN ĐANG CỐ GẮNG LÀM BÀI ĐỂ ĐỐI PHÓ! ĐIỀU NÀY CÓ THỂ KHIẾN GIÁO VIÊN CỦA BẠN BUỒN ĐẤY!
        </h3>
      </div>
      <div style="padding:20px 22px;">
        <p style="margin:0 0 12px 0;font-size:0.92rem;line-height:1.55;color:var(--text-primary, #1e293b);font-weight:600;">
          Hệ thống giám sát phòng thi phát hiện bài nộp của bạn có các dấu hiệu chưa nghiêm túc:
        </p>
        <ul style="margin:0 0 14px 0;padding:12px 16px 6px 30px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;color:#991b1b;font-size:0.88rem;font-weight:700;line-height:1.5;">
          ${reasonsHtml}
        </ul>
        <p style="margin:0 0 18px 0;font-size:0.84rem;line-height:1.5;color:var(--text-secondary, #475569);">
          ⚠️ Nếu vẫn cố tình nộp bài, cảnh báo <strong>"Làm bài đối phó"</strong> sẽ được in nổi bật trực tiếp trên <strong>Phiếu Báo Cáo Kết Quả</strong> và tự động gửi về Giáo viên.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" onclick="closeSuperficialWarningModal(true)" style="width:100%;padding:12px 16px;border:none;border-radius:11px;background:linear-gradient(135deg, #2563eb, #4f46e5);color:#ffffff;font-family:inherit;font-size:0.94rem;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,0.3);">
            ✏️ QUAY LẠI VIẾT BÀI NGHIÊM TÚC TIẾP
          </button>
          <button type="button" onclick="closeSuperficialWarningModal(false)" style="width:100%;padding:10px 14px;border:1.5px solid #fca5a5;border-radius:11px;background:#fef2f2;color:#b91c1c;font-family:inherit;font-size:0.83rem;font-weight:800;cursor:pointer;">
            ⚠️ Vẫn nộp bài (Chấp nhận ghi nhận cảnh báo Đối phó)
          </button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function closeSuperficialWarningModal(returnToEdit) {
  const modal = document.getElementById('superficial-warning-modal');
  if (modal) modal.style.display = 'none';
  if (returnToEdit) {
    startTimer();
    const textarea = document.getElementById('essay-textarea');
    if (textarea) textarea.focus();
    showToast('✏️ Rất tốt! Hãy triển khai đầy đủ ý và đạt ít nhất 250 từ trước khi nộp nhé.', 'info');
  } else {
    submitEssay(true);
  }
}

function submitEssay(forceSubmit = false) {
  const text = document.getElementById('essay-textarea').value;
  const trimmed = text.trim();
  
  if (trimmed === "") {
    showToast("Vui lòng nhập nội dung bài viết trước khi nộp chấm điểm!", "warning");
    return;
  }
  
  const words = trimmed.split(/\s+/).filter(w => w.length > 0).length;
  const elapsedSec = Math.max(writingElapsedSeconds || 0, Math.max(0, 40 * 60 - (timerSeconds || 0)));
  const superficialCheck = detectSuperficialAttempt(trimmed, words, elapsedSec);

  if (superficialCheck.flagged && !forceSubmit) {
    stopTimer();
    showSuperficialWarningModal(superficialCheck);
    return;
  }

  if (superficialCheck.flagged && forceSubmit) {
    const stName = sessionStorage.getItem('current_user_name') || 'Học viên';
    const stClass = sessionStorage.getItem('current_user_class') || 'Chưa xác định';
    const tTitle = (currentTopic && currentTopic.title_en) || 'Task 2 Essay';
    sendTrackingReport(`[CẢNH BÁO LÀM BÀI ĐỐI PHÓ] ${stName} - Lớp ${stClass} - Đề: ${tTitle} - ${words} từ - Thời gian: ${formatWritingDurationVi(elapsedSec)} - Lý do: ${superficialCheck.reasons.join(' | ')}`);
  }
  
  // --- ESSAY VALIDATION CHECK ---
  // 1. Check for Evaluation Comments / Random text
  const isVietnamese = (trimmed.match(/[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỹỷỵ]/gi) || []).length > 10;
  const evalKeywords = /bài viết|đề bài|chấm|điểm|hoàn thành|tương đối|bố cục|ngữ pháp|từ vựng|tiêu chí|band|score|rubric|feedback|comment|outline|prompt/gi;
  const evalMatches = (trimmed.match(evalKeywords) || []).length;
  
  if (isVietnamese || evalMatches >= 2) {
    renderStep3Rejection("Submission Rejected.\n\nThe text provided is an evaluation comment, not an essay response.", superficialCheck);
    return;
  }

  // 2. Check structure (150 words minimum, multiple sentences)
  const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 3);
  if (words < 150 || sentences.length < 5) {
    renderStep3Rejection("Submission Rejected.\n\nThe text provided is not an essay response. Please submit a complete essay written in response to the task prompt.", superficialCheck);
    return;
  }
  // --- END VALIDATION ---
  
  stopTimer();
  
  // 1. Scan and Match Vocabulary Collocations
  const vocabMatches = [];
  let matchedCount = 0;
  
  if (currentTopic.has_full_details && currentTopic.details && currentTopic.details.vocab) {
    currentTopic.details.vocab.forEach(v => {
      const regex = new RegExp(`\\b${v.en.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
      const isMatched = regex.test(text);
      if (isMatched) matchedCount++;
      vocabMatches.push({
        en: v.en,
        vi: v.vi,
        matched: isMatched
      });
    });
  }
  
  // 2. Scan for Cohesion Transitions
  const transitions = [
    'firstly', 'secondly', 'thirdly', 'furthermore', 'moreover', 'in addition', 'besides',
    'on the one hand', 'on the other hand', 'however', 'nevertheless', 'nonetheless',
    'consequently', 'therefore', 'as a result', 'in conclusion', 'to sum up', 'overall',
    'for example', 'for instance', 'in contrast', 'although', 'even though', 'despite'
  ];
  
  let transitionMatches = 0;
  const matchedTransitions = [];
  transitions.forEach(t => {
    const regex = new RegExp(`\\b${t}\\b`, 'gi');
    if (regex.test(text)) {
      transitionMatches++;
      matchedTransitions.push(t);
    }
  });

  // 3. Paragraph-based Sentence-by-Sentence Error Analysis
  const paragraphsList = text.split(/\n+/).filter(p => p.trim().length > 0);
  const sentenceAnalysisList = [];
  
  let totalSVAErrors = 0;
  let totalWFErrors = 0;
  let totalPrepErrors = 0;
  let totalCollocErrors = 0;
  let totalPlurErrors = 0;
  let totalSpellingErrors = 0;
  let totalTenseErrors = 0;
  let totalContractionErrors = 0;
  let totalStructureErrors = 0;
  let totalVerbPatternErrors = 0;
  let totalRelativeClauseErrors = 0;
  
  const paragraphErrors = {
    sva: new Set(),
    wf: new Set(),
    prep: new Set(),
    colloc: new Set(),
    plur: new Set()
  };
  
  let globalSentenceIdx = 1;
  
  paragraphsList.forEach((paraText, pIdx) => {
    const sentences = segmentSentences(paraText);
    sentences.forEach(s => {
      const analysis = analyzeSentenceErrors(s);
      
      analysis.errors.forEach(err => {
        const type = err.errorType;
        if (type === "Grammar (Subject-Verb Agreement)") {
          totalSVAErrors++;
          paragraphErrors.sva.add(pIdx);
        } else if (type === "Word Form") {
          totalWFErrors++;
          paragraphErrors.wf.add(pIdx);
        } else if (type === "Article/Preposition") {
          totalPrepErrors++;
          paragraphErrors.prep.add(pIdx);
        } else if (type === "Collocation") {
          totalCollocErrors++;
          paragraphErrors.colloc.add(pIdx);
        } else if (type === "Grammar (Singular/Plural)") {
          totalPlurErrors++;
          paragraphErrors.plur.add(pIdx);
        } else if (type === "Vocabulary (Spelling)") {
          totalSpellingErrors++;
        } else if (type === "Vocabulary (Academic Style)") {
          totalContractionErrors++;
        } else if (type === "Grammar (Verb Tense)") {
          totalTenseErrors++;
        } else if (type === "Grammar (Verb Pattern)") {
          totalVerbPatternErrors++;
        } else if (type === "Grammar (Relative Clause)") {
          totalRelativeClauseErrors++;
        } else if (type.includes("Sentence Structure") || type.includes("Dấu câu") || type.includes("Viết hoa")) {
          totalStructureErrors++;
        }
      });
      
      sentenceAnalysisList.push({
        index: globalSentenceIdx++,
        original: s,
        errors: analysis.errors,
        corrected: analysis.corrected
      });
    });
  });

  const totalGrammarErrors = totalSVAErrors + totalPlurErrors + totalTenseErrors + totalPrepErrors + totalWFErrors + totalVerbPatternErrors + totalRelativeClauseErrors;
  const totalVocabErrors = totalSpellingErrors + totalContractionErrors;

  // 4. VSTEP Band Calibration Checks
  const hasRepeatedErrors = (
    paragraphErrors.sva.size >= 2 ||
    paragraphErrors.wf.size >= 2 ||
    paragraphErrors.prep.size >= 2 ||
    paragraphErrors.colloc.size >= 2
  );
  const totalControlErrors = totalSVAErrors + totalWFErrors + totalPrepErrors + totalCollocErrors + totalPlurErrors + totalVerbPatternErrors + totalRelativeClauseErrors;
  const frequentLanguageControlIssues = (totalControlErrors >= 4 || hasRepeatedErrors);

  // 5. Compute VSTEP Criteria Scores out of 10 based on official VSTEP Writing Task Scoring Guide
  const totalSentences = sentenceAnalysisList.length;
  const sentencesWithErrors = sentenceAnalysisList.filter(s => s.errors && s.errors.length > 0).length;
  const errorFreeSentences = Math.max(0, totalSentences - sentencesWithErrors);
  const errorFreeRatio = totalSentences > 0 ? (errorFreeSentences / totalSentences) : 0;
  const errorSentenceRatio = totalSentences > 0 ? (sentencesWithErrors / totalSentences) : 0;

  // 1. TASK FULFILMENT (TF) - VSTEP Task 2 Rubric (Band 0 - 10)
  const exampleRegex = /\b(for example|for instance|such as|specifically|to illustrate|an example of this is|take .* as an example|evidence shows|studies show|a clear case in point)\b/gi;
  const exampleMatches = (trimmed.match(exampleRegex) || []).length;

  const explanationRegex = /\b(this means that|leads to|as a result|consequently|therefore|because of this|contribute to|results in|owing to|due to this|for this reason)\b/gi;
  const explanationMatches = (trimmed.match(explanationRegex) || []).length;

  let tfScore = 3.5;
  if (words >= 250) {
    let tfBase = 6.0; // Base score for fulfilling word length requirement
    if (words >= 300) tfBase = 6.5;
    if (words >= 350) tfBase = 7.0;

    // Idea development with explanations and concrete examples (VSTEP Band 6 - 9)
    if (exampleMatches >= 2 && explanationMatches >= 2) {
      tfScore = tfBase + 1.5; // Well developed with relevant details & examples (Band 8-9)
    } else if (exampleMatches >= 1 || explanationMatches >= 1) {
      tfScore = tfBase + 0.5; // Adequately presents key points (Band 6-7)
    } else {
      // Missing supporting examples & explanations: Undeveloped key points (Band 5)
      tfScore = 5.5;
    }
  } else if (words >= 230) {
    tfScore = 5.5; // Slightly underlength
  } else if (words >= 200) {
    tfScore = 4.5; // Substantially underlength (Band 4-5)
  } else if (words >= 170) {
    tfScore = 4.0;
  } else {
    tfScore = 3.5;
  }
  tfScore = Math.min(10.0, tfScore);

  // TOPIC RELEVANCE VALIDATION
  if (currentTopic && currentTopic.title_en) {
    const titleWords = currentTopic.title_en.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    let titleHits = 0;
    titleWords.forEach(w => {
      const regex = new RegExp('\\b' + w + '\\b', 'gi');
      const matches = trimmed.match(regex);
      if (matches) titleHits += matches.length;
    });
    
    const totalRelevanceScore = titleHits + matchedCount;
    let topicRelevancePenalty = 0;
    
    if (totalRelevanceScore >= 8) {
      topicRelevancePenalty = 0;
    } else if (totalRelevanceScore >= 5) {
      topicRelevancePenalty = 1.0;
    } else if (totalRelevanceScore >= 3) {
      topicRelevancePenalty = 2.0;
    } else if (totalRelevanceScore >= 1) {
      topicRelevancePenalty = 3.0;
    } else {
      tfScore = Math.min(3.0, tfScore);
    }
    
    if (totalRelevanceScore > 0 && totalRelevanceScore < 8) {
      tfScore = Math.max(1.0, tfScore - topicRelevancePenalty);
    }
  }

  // 2. ORGANIZATION (ORG) - VSTEP Rubric (Within and Across sentences & paragraphing)
  const paragraphsCount = paragraphsList.length;
  const conclusionRegex = /\b(in conclusion|to conclude|to sum up|in summary|all things considered|on the whole|in a nutshell|to encapsulate|taking everything into account)\b/i;
  const lastParagraph = paragraphsList.length > 0 ? paragraphsList[paragraphsList.length - 1] : "";
  const hasConclusion = paragraphsCount >= 3 && conclusionRegex.test(lastParagraph);

  let orgScore = 3.5;
  if (paragraphsCount >= 4) {
    orgScore = 5.5;
  } else if (paragraphsCount === 3) {
    orgScore = 4.5;
  } else {
    orgScore = 3.5;
  }

  // Cohesive devices across sentences and within sentences
  const orgBonus = Math.min(2.0, transitionMatches * 0.35);
  orgScore += orgBonus;

  // VSTEP formatting penalty: Missing clear conclusion caps ORG at Band 5
  if (!hasConclusion && paragraphsCount >= 3) {
    orgScore = Math.min(5.0, orgScore);
  }

  // Body paragraph balance check
  let isBodyUnbalanced = false;
  if (paragraphsCount >= 4) {
    const wBody1 = (paragraphsList[1].match(/\S+/g) || []).length;
    const wBody2 = (paragraphsList[2].match(/\S+/g) || []).length;
    const bodyRatio = Math.max(wBody1, wBody2) / Math.max(1, Math.min(wBody1, wBody2));
    if (bodyRatio > 2.8 && (wBody1 > 40 || wBody2 > 40)) {
      isBodyUnbalanced = true;
      orgScore = Math.max(3.5, orgScore - 1.0);
    }
  }
  orgScore = Math.min(10.0, orgScore);

  // 3. VOCABULARY (VOCAB) - VSTEP Rubric (Lexical diversity & Overuse check)
  const rawWords = trimmed.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const uniqueWords = new Set(rawWords);
  const ttr = rawWords.length > 0 ? (uniqueWords.size / rawWords.length) : 0;

  // Basic words overuse check
  const basicWords = ['good', 'bad', 'thing', 'things', 'people', 'many', 'very', 'like', 'get', 'make'];
  let maxBasicRepeat = 0;
  let overusedBasicWord = "";
  basicWords.forEach(w => {
    const count = rawWords.filter(rw => rw === w).length;
    if (count > maxBasicRepeat) {
      maxBasicRepeat = count;
      overusedBasicWord = w;
    }
  });

  let vocabBase = 5.5;
  if (vocabMatches.length > 0) {
    vocabBase += (matchedCount / vocabMatches.length) * 2.0;
  } else {
    const avgWordLen = trimmed.replace(/\s+/g, '').length / words;
    if (avgWordLen > 5.5) vocabBase += 1.5;
    else if (avgWordLen > 5.0) vocabBase += 0.5;
  }
  const vocabDeduction = (totalVocabErrors * 0.3) + (totalCollocErrors * 0.4);
  let vocabScore = Math.max(1.0, Math.min(10.0, vocabBase - vocabDeduction));

  // VSTEP Band 5 descriptor: "tends to overuse certain lexical items"
  const isLexicalOveruse = (words >= 200 && (ttr < 0.40 || maxBasicRepeat >= 6));
  if (isLexicalOveruse) {
    vocabScore = Math.min(5.0, vocabScore);
  }

  // 4. GRAMMAR & ACCURACY (GRA) - VSTEP Rubric (Sentence error-free ratio & structure control)
  let grammarBase = 5.5;
  const complexSentenceRegex = /\b(although|because|which|who|whom|whose|if|unless|while|whereas|despite|whether|provided)\b/gi;
  const complexMatches = trimmed.match(complexSentenceRegex);
  if (complexMatches && complexMatches.length >= 3) grammarBase += 1.0;
  else if (complexMatches && complexMatches.length >= 1) grammarBase += 0.5;

  const grammarDeduction = (totalGrammarErrors * 0.4) + (totalStructureErrors * 0.1);
  let grammarScore = Math.max(1.0, Math.min(10.0, grammarBase - grammarDeduction));

  // VSTEP Grammar Calibration:
  // Band 8+: "the majority of the sentences are error-free"
  if (errorFreeRatio >= 0.70 && totalGrammarErrors <= 2 && complexMatches && complexMatches.length >= 2) {
    grammarScore = Math.max(7.5, grammarScore);
  }
  // Band 5: "attempts complex structures, but most are faulty"
  else if (errorSentenceRatio > 0.35 || totalGrammarErrors >= 5) {
    grammarScore = Math.min(5.0, grammarScore);
  }
  // Band 4: "errors occur frequently"
  if (errorSentenceRatio > 0.55 || totalGrammarErrors >= 9) {
    grammarScore = Math.min(4.0, grammarScore);
  }

  // Apply calibration limits if frequent control issues exist
  if (totalControlErrors >= 12) {
    vocabScore = Math.min(4.0, vocabScore);
    grammarScore = Math.min(4.0, grammarScore);
  } else if (totalControlErrors >= 8) {
    vocabScore = Math.min(4.5, vocabScore);
    grammarScore = Math.min(4.5, grammarScore);
  } else if (frequentLanguageControlIssues) {
    vocabScore = Math.min(5.0, vocabScore);
    grammarScore = Math.min(5.0, grammarScore);
  }

  const rawScore = (tfScore + orgScore + vocabScore + grammarScore) / 4;
  let finalScore = Math.min(10.0, Math.round(rawScore * 2) / 2);

  // HARD WORD COUNT LEVEL CAP (VSTEP Task 2 quy định bài viết tối thiểu 250 từ)
  let wordCountCapTriggered = false;
  let wordCountCapLimit = 10.0;
  let wordCountCapReason = "";

  if (words < 150) {
    wordCountCapTriggered = true;
    wordCountCapLimit = 2.5;
    wordCountCapReason = `Bài viết chỉ có ${words} từ (quá ngắn so với chuẩn tối thiểu 250 từ của VSTEP Task 2). Điểm số tổng thể bị giới hạn tối đa ở mức 2.5 (Dưới B1 / Không đạt).`;
  } else if (words < 200) {
    wordCountCapTriggered = true;
    wordCountCapLimit = 3.5;
    wordCountCapReason = `Bài viết chỉ có ${words} từ (thiếu ${250 - words} từ so với chuẩn tối thiểu 250 từ). Theo quy chế khảo thí VSTEP Task 2, bài viết dưới 200 từ bị trừ nặng điểm Task Fulfillment và bị giới hạn trần điểm tối đa ở mức 3.5 (Dưới B1 / Chưa đạt chuẩn).`;
  } else if (words < 230) {
    wordCountCapTriggered = true;
    wordCountCapLimit = 5.0;
    wordCountCapReason = `Bài viết có ${words} từ (chưa đạt chuẩn tối thiểu 250 từ của VSTEP Task 2). Mặc dù các đoạn văn có thể được tổ chức tốt, dung lượng 200-229 từ chưa đủ sâu để đạt trình độ B2. Do đó, điểm số tổng thể được giới hạn tối đa ở trình độ B1 (tối đa 5.0).`;
  } else if (words < 250) {
    wordCountCapTriggered = true;
    wordCountCapLimit = 5.5;
    wordCountCapReason = `Bài viết có ${words} từ (thiếu ${250 - words} từ so với chuẩn tối thiểu 250 từ). Tiêu chí Task Fulfillment bị trừ điểm do dung lượng chưa trọn vẹn, trần điểm tổng thể được giới hạn ở mức tối đa 5.5 (B1+).`;
  }

  if (wordCountCapTriggered && finalScore > wordCountCapLimit) {
    finalScore = wordCountCapLimit;
  }

  // HOLISTIC B2 REQUIREMENT (Quy chế khảo thí VSTEP: Để đạt B2, không tiêu chí nào dưới 5.0)
  const minCriterion = Math.min(tfScore, orgScore, vocabScore, grammarScore);
  let holisticCapTriggered = false;
  let holisticCapReason = "";

  if (minCriterion < 5.0 && finalScore >= 6.0) {
    finalScore = 5.0; // Capped at B1
    holisticCapTriggered = true;
    const weakCriteriaNames = [];
    if (tfScore < 5.0) weakCriteriaNames.push(`Task Fulfillment (${tfScore.toFixed(1)})`);
    if (orgScore < 5.0) weakCriteriaNames.push(`Organization (${orgScore.toFixed(1)})`);
    if (vocabScore < 5.0) weakCriteriaNames.push(`Vocabulary (${vocabScore.toFixed(1)})`);
    if (grammarScore < 5.0) weakCriteriaNames.push(`Grammar (${grammarScore.toFixed(1)})`);
    holisticCapReason = `Để đạt chuẩn B2 (Overall ≥ 6.0), theo quy chế khảo thí VSTEP bài viết phải thể hiện năng lực đồng đều ở cả 4 tiêu chí (không có tiêu chí nào dưới 5.0). Bài viết hiện có tiêu chí chưa đạt chuẩn: ${weakCriteriaNames.join(', ')}. Do đó điểm chung được giới hạn ở trình độ B1 (5.0).`;
  }
  
  // OFF-TOPIC CRITICAL OVERRIDE
  let isOffTopic = false;
  if (currentTopic && currentTopic.title_en) {
    const titleWords = currentTopic.title_en.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    let titleHits = 0;
    titleWords.forEach(w => {
      const regex = new RegExp('\\b' + w + '\\b', 'gi');
      const matches = trimmed.match(regex);
      if (matches) titleHits += matches.length;
    });
    const totalRelevanceScore = titleHits + matchedCount;
    if (totalRelevanceScore === 0) {
      finalScore = 1.0; // Band 1: totally irrelevant or memorized response
      isOffTopic = true;
    } else if (totalRelevanceScore < 3) {
      finalScore = Math.min(4.5, finalScore);
    }
  }
  
  // Directly cap overall score to B1 (max 5.0) if frequent errors limit control
  if (frequentLanguageControlIssues) {
    finalScore = Math.min(5.0, finalScore);
  }
  
  // LANGUAGE CONTROL OVERRIDE: Grammar and Vocabulary are decisive factors
  let languageControlOverrideTriggered = false;
  let languageControlOverrideSevere = false;
  
  if (grammarScore < 4.5 && vocabScore < 4.5) {
    finalScore = Math.min(4.0, finalScore);
    languageControlOverrideSevere = true;
  } else if (grammarScore < 5.0 && vocabScore < 5.0) {
    finalScore = Math.min(4.5, finalScore);
    languageControlOverrideTriggered = true;
  }
  
  let feedbackText = "";
  if (isOffTopic) {
    feedbackText = "LẠC ĐỀ HOÀN TOÀN (0% Topic Match): Bài làm không giải quyết bất cứ yêu cầu nào của đề thi hoặc có dấu hiệu học tủ một bài mẫu khác. Ngôn ngữ mạnh không thể bù đắp cho việc trả lời sai đề. Bài viết bị đánh trượt (1.0).";
  } else if (holisticCapTriggered) {
    feedbackText = holisticCapReason;
  } else if (wordCountCapTriggered && rawScore > wordCountCapLimit) {
    feedbackText = wordCountCapReason;
  } else if (languageControlOverrideSevere && rawScore > 4.0) {
    feedbackText = "Bài viết có độ dài hoặc bố cục đạt yêu cầu nhưng việc kiểm soát ngôn ngữ (Từ vựng & Ngữ pháp) đều yếu (dưới 4.5). Điểm số tổng thể bị giới hạn tối đa ở mức 4.0 do ngôn từ không đủ chính xác để bù đắp cho cấu trúc.";
  } else if (languageControlOverrideTriggered && rawScore > 4.5) {
    feedbackText = "Mặc dù độ dài bài viết và bố cục có thể đạt yêu cầu, nhưng do cả hai tiêu chí Ngữ pháp và Từ vựng đều dưới 5.0, điểm số tổng thể bị giới hạn tối đa ở mức 4.5. Bạn cần ưu tiên cải thiện độ chính xác ngôn ngữ trước khi tập trung vào cấu trúc phức tạp.";
  } else if (frequentLanguageControlIssues && rawScore >= 5.5) {
    feedbackText = "Bài viết có độ dài tốt nhưng mắc nhiều lỗi lặp lại hoặc xuất hiện lỗi hệ thống (chia động từ, giới từ, dạng từ, collocation) tại nhiều đoạn văn khác nhau. Điều này thể hiện khả năng kiểm soát ngôn ngữ còn hạn chế, do đó điểm số được giới hạn ở trình độ B1 (tối đa 5.0).";
  } else {
    const wordStatusNote = words >= 250 
      ? "đạt chuẩn dung lượng tối thiểu (≥ 250 từ)" 
      : `chưa đủ dung lượng chuẩn VSTEP (có ${words}/250 từ)`;
    if (finalScore >= 8.5) feedbackText = `Xuất sắc! Đạt trình độ C1. Sử dụng từ vựng phong phú, bố cục chặt chẽ và ${wordStatusNote}.`;
    else if (finalScore >= 6.0) feedbackText = `Khá tốt! Đạt trình độ B2. Bài viết mạch lạc, bố cục rõ ràng và ${wordStatusNote}.`;
    else if (finalScore >= 4.0) feedbackText = `Đạt trình độ B1. Bài viết ${wordStatusNote}. Hãy mở rộng thêm luận cứ, ví dụ minh họa và từ nối chuyển ý.`;
    else feedbackText = `Dưới chuẩn B1 (${words} từ). Cần viết dài hơn (tối thiểu 250 từ) và bổ sung cấu trúc, từ vựng nền tảng.`;
  }
  
  const conv7 = ((finalScore * 7) / 10).toFixed(1);
  const conv67 = ((finalScore * 2) / 3).toFixed(1);

  document.getElementById('estimated-score').innerText = finalScore.toFixed(1);
  const elScale = document.getElementById('estimated-score-scale');
  if (elScale) elScale.innerText = '/ 10 (Thang 10)';
  
  const elDisp10 = document.getElementById('score-display-10');
  if (elDisp10) elDisp10.innerText = `${finalScore.toFixed(1)} / 10`;

  const elDispConv = document.getElementById('score-display-converted');
  if (elDispConv) elDispConv.innerText = `${conv7} / 7.0`;

  const elDispRatio = document.getElementById('score-display-ratio');
  if (elDispRatio) elDispRatio.innerText = `(Tỷ trọng 2/3 bài thi: ${conv67} / 6.7)`;

  document.getElementById('ws-feedback-general').innerText = feedbackText;
  
  const detailsList = document.getElementById('feedback-details-list');
  detailsList.innerHTML = `
    <div class="grade-detail-card ${tfScore >= 7.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="grade-detail-title" style="font-weight: 700;">1. TASK FULFILLMENT</span>
        <span style="font-weight: bold;">${tfScore.toFixed(1)} / 10</span>
      </div>
      <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
        Độ dài: ${words} từ (${words >= 250 ? 'Đạt chuẩn ≥ 250 từ' : 'Thiếu ' + (250 - words) + ' từ'}). Phát hiện ${exampleMatches} dẫn chứng/ví dụ và ${explanationMatches} cấu trúc phân tích lập luận.
      </div>
    </div>
    <div class="grade-detail-card ${orgScore >= 7.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="grade-detail-title" style="font-weight: 700;">2. ORGANIZATION</span>
        <span style="font-weight: bold;">${orgScore.toFixed(1)} / 10</span>
      </div>
      <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
        Bố cục: ${paragraphsCount} đoạn. ${hasConclusion ? 'Đã có đoạn Kết luận (Conclusion) ✓.' : '⚠️ Thiếu đoạn Kết luận chuẩn VSTEP.'} ${isBodyUnbalanced ? '⚠️ Thân bài chênh lệch độ dài.' : ''} Phát hiện ${transitionMatches} liên từ liên kết.
      </div>
    </div>
    <div class="grade-detail-card ${vocabScore >= 7.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="grade-detail-title" style="font-weight: 700;">3. LEXICAL RESOURCE</span>
        <span style="font-weight: bold;">${vocabScore.toFixed(1)} / 10</span>
      </div>
      <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
        Độ phong phú từ vựng (TTR): ${(ttr * 100).toFixed(0)}%. ${isLexicalOveruse ? '⚠️ Lặp từ nhiều / lạm dụng từ cơ bản.' : 'Vốn từ đa dạng.'} Collocations bài học: ${matchedCount}. Tổng lỗi từ vựng: ${totalVocabErrors + totalCollocErrors}.
      </div>
    </div>
    <div class="grade-detail-card ${grammarScore >= 7.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="grade-detail-title" style="font-weight: 700;">4. GRAMMAR & ACCURACY</span>
        <span style="font-weight: bold;">${grammarScore.toFixed(1)} / 10</span>
      </div>
      <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
        Tỷ lệ câu sạch lỗi: ${(errorFreeRatio * 100).toFixed(0)}% (${errorFreeSentences}/${totalSentences} câu). ${errorSentenceRatio > 0.35 ? '⚠️ Mắc lỗi ở > 35% số câu, giới hạn Band 5.' : 'Kiểm soát câu tốt.'} Tổng lỗi ngữ pháp: ${totalGrammarErrors + totalStructureErrors}.
      </div>
    </div>
  `;
  
  const matchContainer = document.getElementById('ws-vocab-match-container');
  matchContainer.innerHTML = '';
  if (vocabMatches.length > 0) {
    vocabMatches.forEach(item => {
      const div = document.createElement('div');
      div.className = `vocab-match-item ${item.matched ? 'matched' : 'unmatched'}`;
      div.innerHTML = `
        <span><strong>${item.en}</strong> (${item.vi})</span>
        <span class="match-status">${item.matched ? '✓ Sử dụng' : '✗ Chưa dùng'}</span>
      `;
      matchContainer.appendChild(div);
    });
  } else {
    matchContainer.innerHTML = '<div class="empty-state">Không có bộ collocations đối chiếu cho bài luận tự do.</div>';
  }
  
  try {
    renderSampleEssay();
  } catch (e) {
    console.warn("renderSampleEssay warning:", e);
  }
  
  try {
    saveSubmission(finalScore, words, text);
    if (window.CB210StreakGuard && typeof window.CB210StreakGuard.recordEssaySubmission === 'function') {
      const tTitle = currentTopic ? `Đề ${currentTopic.id}: ${currentTopic.title_en}` : 'VSTEP Task 2';
      window.CB210StreakGuard.recordEssaySubmission({
        topicTitle: tTitle,
        wordCount: words,
        score: finalScore
      });
    }
    updateStats();
    if (currentCategory && currentTopic) {
      const draftKey = getStudentDraftKey(currentCategory.id, currentTopic.id);
      localStorage.removeItem(draftKey);
      if (window.StudentHistorySync && typeof window.StudentHistorySync.recordDraftChange === 'function') {
        window.StudentHistorySync.recordDraftChange(currentCategory.id, currentTopic.id, true);
      }
    }
  } catch (e) {
    console.warn("Storage warning in submitEssay:", e);
  }
  
  hasSubmitted = true;
  if (typeof renderWorkspaceStepHeader === 'function') {
    renderWorkspaceStepHeader();
  }

  // Record submission and report complete results + time on site + cheating count to Google Forms
  try {
    const studentName = sessionStorage.getItem('current_user_name') || 'Học viên';
    const studentClass = sessionStorage.getItem('current_user_class') || '';
    const topicTitle = (currentTopic && currentTopic.title_en) || 'Task 2 Essay';
    if (sessionTracking.isLoggedIn) {
      sessionTracking.essaySubmissions.push({
        topicTitle,
        score: finalScore,
        tfScore,
        orgScore,
        vocabScore,
        grammarScore,
        wordCount: words,
        cheatCount: cheatViolationCount
      });
    }
  } catch (e) {}

  renderStep3VstepEvaluation({
    score: finalScore,
    wordCount: words,
    tfScore: tfScore,
    orgScore: orgScore,
    vocabScore: vocabScore,
    grammarScore: grammarScore,
    feedback: feedbackText,
    text: text,
    sentenceAnalysisList: sentenceAnalysisList,
    totalGrammarErrors: totalGrammarErrors,
    totalVocabErrors: totalVocabErrors,
    totalCollocErrors: totalCollocErrors,
    totalStructureErrors: totalStructureErrors,
    frequentLanguageControlIssues: frequentLanguageControlIssues,
    wordCountCapTriggered: wordCountCapTriggered,
    wordCountCapReason: wordCountCapReason,
    holisticCapTriggered: holisticCapTriggered,
    holisticCapReason: holisticCapReason,
    hasConclusion: hasConclusion,
    exampleMatches: exampleMatches,
    explanationMatches: explanationMatches,
    ttr: ttr,
    errorSentenceRatio: errorSentenceRatio,
    errorFreeRatio: errorFreeRatio,
    isLexicalOveruse: isLexicalOveruse,
    superficialCheck: superficialCheck
  });

  const editorView = document.getElementById('step3-editor-view');
  if (editorView) editorView.style.display = 'none';

  const evalView = document.getElementById('step3-evaluation-view');
  if (evalView) evalView.style.display = 'flex';

  const layoutContainer = document.getElementById('workspace-layout-container');
  if (layoutContainer) layoutContainer.classList.add('submitted');

  const step3Container = document.getElementById('workspace-step3-container');
  if (step3Container) step3Container.scrollTop = 0;
  
  showToast("🎉 Đã hoàn thành nộp bài! Báo cáo đánh giá chi tiết hiển thị bên dưới.", "success");
}

function renderStep3Rejection(message, superficialCheck = null) {
  const container = document.getElementById('step3-evaluation-view');
  if (!container) return;

  const superficialBannerHtml = (superficialCheck && superficialCheck.flagged) ? `
    <div style="background:linear-gradient(135deg, #fef2f2, #fee2e2);border:2.5px solid #dc2626;border-radius:14px;padding:18px 20px;margin-bottom:1.25rem;box-shadow:0 8px 24px rgba(220,38,38,0.16);">
      <div style="font-size:1.12rem;font-weight:900;color:#b91c1c;display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span>🚨 CÓ VẺ BẠN ĐANG CỐ GẮNG LÀM BÀI ĐỂ ĐỐI PHÓ! ĐIỀU NÀY CÓ THỂ KHIẾN GIÁO VIÊN CỦA BẠN BUỒN ĐẤY!</span>
      </div>
      <ul style="margin:0;padding-left:20px;color:#991b1b;font-size:0.9rem;font-weight:700;line-height:1.55;">
        ${(superficialCheck.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>
  ` : '';
  
  container.innerHTML = `
    ${superficialBannerHtml}
    <div class="evaluation-header">
      <h3 style="color: var(--danger-color); display: flex; align-items: center; gap: 0.5rem; margin: 0;">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Submission Rejected
      </h3>
      <button class="btn btn-secondary" onclick="rewriteEssay()">Viết lại / Chỉnh sửa bài</button>
    </div>
    <div class="eval-card" style="border-left: 4px solid var(--danger-color); padding: 2rem; margin-top: 1rem;">
      <p style="white-space: pre-wrap; font-size: 1.1rem; line-height: 1.6; margin: 0; color: var(--text-color);">${message}</p>
    </div>
  `;
  
  document.getElementById('step3-editor-view').style.display = 'none';
  document.getElementById('step3-evaluation-view').style.display = 'flex';
  
  showToast("Lỗi: Bài viết không hợp lệ!", "danger");
}

function renderStep3VstepEvaluation(data) {
  currentEvaluationData = data;
  const container = document.getElementById('step3-evaluation-view');
  if (!container) return;
  
  const {
    score,
    wordCount,
    tfScore,
    orgScore,
    vocabScore,
    grammarScore,
    feedback,
    text,
    sentenceAnalysisList,
    totalGrammarErrors,
    totalVocabErrors,
    totalCollocErrors,
    totalStructureErrors,
    frequentLanguageControlIssues,
    wordCountCapTriggered,
    wordCountCapReason,
    holisticCapTriggered,
    holisticCapReason,
    hasConclusion,
    exampleMatches,
    explanationMatches,
    ttr,
    errorSentenceRatio,
    errorFreeRatio,
    isLexicalOveruse
  } = data;

  const pTF = (tfScore / 10) * 100;
  const pORG = (orgScore / 10) * 100;
  const pVocab = (vocabScore / 10) * 100;
  const pGrammar = (grammarScore / 10) * 100;
  
  let commentTF = "";
  if (wordCount >= 250 && exampleMatches >= 2 && explanationMatches >= 2) {
    commentTF = `Xuất sắc! Đạt chuẩn độ dài VSTEP Task 2 (${wordCount} từ) và phát triển luận điểm rất sâu sắc với ${exampleMatches} dẫn chứng cụ thể và ${explanationMatches} phân tích nguyên nhân - hệ quả (VSTEP Band 8-9).`;
  } else if (wordCount >= 250 && (exampleMatches >= 1 || explanationMatches >= 1)) {
    commentTF = `Khá tốt! Đạt chuẩn độ dài tối thiểu (${wordCount} từ), luận điểm được trình bày rõ ràng và có dẫn chứng/giải thích minh họa (VSTEP Band 6-7).`;
  } else if (wordCount >= 250) {
    commentTF = `Bài viết đạt độ dài (${wordCount} từ) nhưng thiếu dẫn chứng thực tế (ví dụ: 'for example', 'such as'...) và thiếu phân tích chiều sâu. Luận điểm còn chung chung, giới hạn ở Band 5.`;
  } else if (wordCount >= 230) {
    commentTF = `Bài viết có ${wordCount} từ (thiếu nhẹ ${250 - wordCount} từ so với chuẩn tối thiểu 250 từ). Tiêu chí Task Fulfillment bị trừ điểm do dung lượng chưa trọn vẹn.`;
  } else if (wordCount >= 200) {
    commentTF = `Chưa đạt chuẩn độ dài VSTEP Task 2! Bài viết chỉ có ${wordCount} từ (thiếu ${250 - wordCount} từ). Với dung lượng này, bài viết chưa đủ sâu để đạt B2.`;
  } else {
    commentTF = `Bài viết quá ngắn (${wordCount} từ, thiếu ${250 - wordCount} từ). Bị trừ điểm nặng ở Task Fulfillment và giới hạn bậc trình độ.`;
  }

  let commentORG = "";
  if (orgScore >= 8.5) {
    commentORG = "Xuất sắc! Bố cục mạch lạc chuẩn 4 đoạn, mở bài và kết bài hoàn chỉnh, liên kết câu và đoạn rất tự nhiên, linh hoạt (VSTEP Band 8-9).";
  } else if (orgScore >= 7.0) {
    commentORG = "Bố cục rõ ràng, các đoạn văn cân đối và có câu kết luận. Sử dụng từ nối tương đối hiệu quả giữa các câu và đoạn.";
  } else if (hasConclusion === false) {
    commentORG = "⚠️ Thiếu đoạn Kết luận chuẩn VSTEP (chưa có từ khóa kết luận: 'in conclusion', 'to sum up'...). Bố cục chưa hoàn chỉnh, bị giới hạn ở Band 5.";
  } else {
    commentORG = "Bố cục thiếu cân đối hoặc thiếu liên từ kết nối câu và đoạn. Cần chia đoạn chuẩn (Mở, 2 Thân, Kết) và đa dạng từ nối.";
  }

  let commentVocab = "";
  if (vocabScore >= 8.5) {
    commentVocab = "Vốn từ phong phú và học thuật! Sử dụng thành thạo collocations nâng cao, độ đa dạng từ vựng cao và hầu như không mắc lỗi dùng từ (VSTEP Band 8-9).";
  } else if (vocabScore >= 7.0) {
    commentVocab = "Vốn từ khá tốt (Sufficient range). Đã sử dụng collocations chuyên đề phù hợp, độ đa dạng từ vựng đạt chuẩn B2.";
  } else if (isLexicalOveruse) {
    commentVocab = "⚠️ Lạm dụng và lặp lại từ vựng cơ bản nhiều lần (VSTEP: tends to overuse certain lexical items). Hãy dùng các từ đồng nghĩa hoặc collocations chuyên đề ở Bước 2.";
  } else {
    commentVocab = "Vốn từ còn đơn giản, lặp từ hoặc mắc lỗi từ loại/collocations. Cần bổ sung thêm từ vựng học thuật chuyên đề.";
  }

  let commentGrammar = "";
  if (grammarScore >= 8.5) {
    commentGrammar = `Ngữ pháp xuất sắc! Đa số câu trong bài hoàn toàn sạch lỗi (${(errorFreeRatio * 100).toFixed(0)}% Error-free), sử dụng linh hoạt câu phức và câu đơn (VSTEP Band 8-9).`;
  } else if (grammarScore >= 7.0) {
    commentGrammar = `Ngữ pháp khá tốt. Sử dụng được câu phức, các lỗi nhỏ xuất hiện không làm sai lệch ý nghĩa (Rarely lead to misunderstanding).`;
  } else if (errorSentenceRatio > 0.35) {
    commentGrammar = `⚠️ Mắc lỗi ngữ pháp ở nhiều câu (${(errorSentenceRatio * 100).toFixed(0)}% số câu có lỗi). Theo chuẩn VSTEP, câu phức bị lỗi nhiều (faulty complex structures) bị giới hạn ở Band 5.`;
  } else {
    commentGrammar = "Mắc nhiều lỗi ngữ pháp cơ bản (chia động từ, thì, số ít số nhiều, giới từ). Cần chú ý rà soát lỗi kĩ hơn.";
  }

  const getSummary = (freq, type) => {
    let severity = "None";
    let effect = "Không ảnh hưởng";
    
    if (type === "grammar") {
      if (freq >= 4) {
        severity = "Serious";
        effect = "Ảnh hưởng nghiêm trọng đến điểm B2 (Giới hạn tối đa 5.0 điểm Grammar)";
      } else if (freq >= 2) {
        severity = "Moderate";
        effect = "Ảnh hưởng nhẹ đến điểm B2 (Giới hạn tối đa 6.5 điểm Grammar)";
      } else if (freq >= 1) {
        severity = "Minor";
        effect = "Trừ nhẹ điểm chính xác của Grammar (-0.5 điểm)";
      }
    } else if (type === "vocab") {
      if (freq >= 4) {
        severity = "Serious";
        effect = "Giới hạn điểm từ vựng ở mức B1 (-1.5 đến -2.0 điểm)";
      } else if (freq >= 2) {
        severity = "Moderate";
        effect = "Cản trở việc đạt điểm tối đa B2 của Lexical Resource";
      } else if (freq >= 1) {
        severity = "Minor";
        effect = "Trừ điểm nhẹ đối với lỗi chính tả không hệ thống";
      }
    } else if (type === "colloc") {
      if (freq >= 3) {
        severity = "Serious";
        effect = "Hạn chế nghiêm trọng tính tự nhiên của câu (Khó đạt B2)";
      } else if (freq >= 1) {
        severity = "Moderate";
        effect = "Ảnh hưởng mức độ lưu loát và tự nhiên khi chấm thi";
      }
    } else if (type === "structure") {
      if (freq >= 5) {
        severity = "Serious";
        effect = "Cực kỳ mất thiện cảm, ảnh hưởng nghiêm trọng đến mạch lạc câu";
      } else if (freq >= 2) {
        severity = "Moderate";
        effect = "Gây gián đoạn nhẹ tiến trình đọc hiểu bài viết của giám khảo";
      } else if (freq >= 1) {
        severity = "Minor";
        effect = "Trừ lỗi hình thức nhỏ (dấu câu/viết hoa)";
      }
    }
    return { severity, effect };
  };

  const gSum = getSummary(totalGrammarErrors, "grammar");
  const vSum = getSummary(totalVocabErrors, "vocab");
  const cSum = getSummary(totalCollocErrors, "colloc");
  const sSum = getSummary(totalStructureErrors, "structure");

  // Save complete evaluation texts and error summaries for PDF export
  data.commentTF = commentTF;
  data.commentORG = commentORG;
  data.commentVocab = commentVocab;
  data.commentGrammar = commentGrammar;
  data.gSum = gSum;
  data.vSum = vSum;
  data.cSum = cSum;
  data.sSum = sSum;

  let rawReportText = "";
  sentenceAnalysisList.forEach(item => {
    const checks = [
      { name: "Subject-Verb Agreement", category: "Grammar (Subject-Verb Agreement)" },
      { name: "Verb Pattern", category: "Grammar (Verb Pattern)" },
      { name: "Tense", category: "Grammar (Verb Tense)" },
      { name: "Articles", category: "Article/Preposition", filter: err => err.errorType === "Article/Preposition" && /^(a|an|the|this|that|these|those)$/i.test(err.incorrect) },
      { name: "Prepositions", category: "Article/Preposition", filter: err => err.errorType === "Article/Preposition" && !/^(a|an|the|this|that|these|those)$/i.test(err.incorrect) },
      { name: "Word Form", category: "Word Form" },
      { name: "Singular/Plural", category: "Grammar (Singular/Plural)" },
      { name: "Relative Clauses", category: "Grammar (Relative Clause)" },
      { name: "Collocations", category: "Collocation", filter: err => err.errorType === "Collocation" || err.errorType.includes("Spelling") || err.errorType.includes("Academic Style") },
      { name: "Sentence Structure", category: "Sentence Structure", filter: err => err.errorType.includes("Sentence Structure") || err.errorType.includes("Dấu câu") || err.errorType.includes("Viết hoa") }
    ];

    const sentenceCheckResults = [];
    checks.forEach((check, index) => {
      const matchingErrors = item.errors.filter(err => {
        if (check.filter) return check.filter(err);
        return err.errorType === check.category;
      });
      
      const hasErr = matchingErrors.length > 0;
      let explanation = "";
      if (hasErr) {
        explanation = matchingErrors.map(err => `${err.explanation} (Sai: '${err.incorrect}' -> Sửa: '${err.correction}')`).join("; ");
      } else {
        explanation = `Không phát hiện lỗi về ${check.name}.`;
      }
      
      sentenceCheckResults.push({
        num: index + 1,
        name: check.name,
        result: hasErr ? "✗ Error Detected" : "✓ No Error",
        explanation: explanation,
        hasError: hasErr
      });
    });

    rawReportText += `Sentence ${item.index}\n\nOriginal:\n${item.original}\n\n`;
    rawReportText += `--- MANDATORY ERROR CHECKLIST (ONLY SHOWING ERRORS) ---\n`;
    let errorChecksCount = 0;
    sentenceCheckResults.forEach(c => {
      if (c.hasError) {
        rawReportText += `CHECK ${c.num}: ${c.name}\nResult: ${c.result}\nExplanation (Vietnamese): ${c.explanation}\n\n`;
        errorChecksCount++;
      }
    });
    if (errorChecksCount === 0) {
      rawReportText += `Tất cả các tiêu chí đều đạt chuẩn, không phát hiện lỗi.\n\n`;
    }
    rawReportText += `Conclusion: ${item.errors.length > 0 ? "✗ Error Detected" : "✓ No Error"}\n`;
    rawReportText += `Corrected Sentence:\n${item.corrected}\n\n`;
    rawReportText += `--------------------------------------------------\n\n`;
  });

  rawReportText += `Grammar Error Summary:\nFrequency: ${totalGrammarErrors}\nSeverity: ${gSum.severity}\nEffect on B1/B2 score: ${gSum.effect}\n\n`;
  rawReportText += `Vocabulary Error Summary:\nFrequency: ${totalVocabErrors}\nSeverity: ${vSum.severity}\nEffect on B1/B2 score: ${vSum.effect}\n\n`;
  rawReportText += `Collocation Error Summary:\nFrequency: ${totalCollocErrors}\nSeverity: ${cSum.severity}\nEffect on B1/B2 score: ${cSum.effect}\n\n`;
  rawReportText += `Sentence Structure Error Summary:\nFrequency: ${totalStructureErrors}\nSeverity: ${sSum.severity}\nEffect on B1/B2 score: ${sSum.effect}\n\n`;
  rawReportText += `FINAL SCORING\n\nEvaluate using VSTEP criteria:\nTask Fulfillment: ${tfScore.toFixed(1)}/10\nOrganization: ${orgScore.toFixed(1)}/10\nVocabulary: ${vocabScore.toFixed(1)}/10\nGrammar: ${grammarScore.toFixed(1)}/10\n\nEstimated Overall Band: ${score.toFixed(1)} (${score >= 8.5 ? 'C1' : score >= 6.0 ? 'B2' : score >= 4.0 ? 'B1' : 'Dưới B1'})\n`;

  let sentencesHtml = "";
  sentenceAnalysisList.forEach(item => {
    const hasErrors = item.errors.length > 0;
    
    const checks = [
      { name: "Subject-Verb Agreement", category: "Grammar (Subject-Verb Agreement)" },
      { name: "Verb Pattern", category: "Grammar (Verb Pattern)" },
      { name: "Tense", category: "Grammar (Verb Tense)" },
      { name: "Articles", category: "Article/Preposition", filter: err => err.errorType === "Article/Preposition" && /^(a|an|the|this|that|these|those)$/i.test(err.incorrect) },
      { name: "Prepositions", category: "Article/Preposition", filter: err => err.errorType === "Article/Preposition" && !/^(a|an|the|this|that|these|those)$/i.test(err.incorrect) },
      { name: "Word Form", category: "Word Form" },
      { name: "Singular/Plural", category: "Grammar (Singular/Plural)" },
      { name: "Relative Clauses", category: "Grammar (Relative Clause)" },
      { name: "Collocations", category: "Collocation", filter: err => err.errorType === "Collocation" || err.errorType.includes("Spelling") || err.errorType.includes("Academic Style") },
      { name: "Sentence Structure", category: "Sentence Structure", filter: err => err.errorType.includes("Sentence Structure") || err.errorType.includes("Dấu câu") || err.errorType.includes("Viết hoa") }
    ];

    let checklistCardsHtml = "";
    let errorChecksCount = 0;
    checks.forEach((check, index) => {
      const matchingErrors = item.errors.filter(err => {
        if (check.filter) return check.filter(err);
        return err.errorType === check.category;
      });
      
      const hasErr = matchingErrors.length > 0;
      if (!hasErr) return;
      
      errorChecksCount++;
      const badgeColor = "var(--danger)";
      const badgeBg = "rgba(239, 68, 68, 0.1)";
      const borderStyle = "1px solid var(--danger)";
      const icon = "✗";
      const resultText = "Error Detected";
      
      let explanation = matchingErrors.map(err => {
        return `${err.explanation} <span style="font-family: var(--font-mono); font-size: 0.75rem; background-color: var(--bg-secondary); padding: 0.1rem 0.3rem; border-radius: 3px; color: var(--danger); font-weight: bold;">${err.incorrect}</span> → <span style="font-family: var(--font-mono); font-size: 0.75rem; background-color: var(--success-bg); padding: 0.1rem 0.3rem; border-radius: 3px; color: var(--success); font-weight: bold;">${err.correction}</span>`;
      }).join("<br/>");
      
      checklistCardsHtml += `
        <div style="border: ${borderStyle}; border-radius: var(--radius-sm); padding: 0.75rem 1rem; background-color: var(--bg-primary); display: flex; flex-direction: column; gap: 0.25rem; transition: all 0.2s ease;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--panel-border); padding-bottom: 0.25rem;">
            <span style="font-weight: 700; font-size: 0.75rem; color: var(--text-primary); letter-spacing: 0.02em;">CHECK ${index + 1}: ${check.name.toUpperCase()}</span>
            <span style="font-size: 0.7rem; font-weight: 700; color: ${badgeColor}; background-color: ${badgeBg}; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem;">
              <span>${icon}</span> ${resultText}
            </span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; margin-top: 0.2rem;">${explanation}</div>
        </div>
      `;
    });

    if (errorChecksCount === 0) {
      checklistCardsHtml = `
        <div style="grid-column: span 2; border: 1px dashed var(--success); border-radius: var(--radius-sm); padding: 1rem; background-color: rgba(16, 185, 129, 0.05); display: flex; align-items: center; justify-content: center; gap: 0.5rem; color: var(--success); font-weight: 600; font-size: 0.9rem;">
          <span>✓</span> Tất cả các tiêu chí đều đạt chuẩn, không phát hiện lỗi.
        </div>
      `;
    }

    sentencesHtml += `
      <div class="sentence-analysis-block" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.5rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--panel-border); padding-bottom: 0.75rem;">
          <span style="font-family: var(--font-display); font-weight: 800; font-size: 1.1rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
            <span style="display: inline-flex; justify-content: center; align-items: center; background-color: var(--accent-primary); color: #fff; width: 24px; height: 24px; border-radius: 50%; font-size: 0.8rem; font-weight: bold;">${item.index}</span>
            CÂU LUYỆN TẬP ${item.index}
          </span>
          ${hasErrors 
            ? `<span class="badge" style="background-color: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid var(--danger); font-size: 0.75rem; padding: 0.25rem 0.75rem; border-radius: 50px; font-weight: 700;">✗ PHÁT HIỆN SAI PHẠM</span>`
            : `<span class="badge" style="background-color: rgba(16, 185, 129, 0.1); color: var(--success); border: 1px solid var(--success); font-size: 0.75rem; padding: 0.25rem 0.75rem; border-radius: 50px; font-weight: 700;">✓ HỢP LỆ</span>`
          }
        </div>
        
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.35rem; letter-spacing: 0.05em;">Câu gốc của bạn:</div>
          <div style="font-size: 1.05rem; line-height: 1.6; color: var(--text-primary); font-style: italic; background-color: var(--bg-primary); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px dashed var(--panel-border);">"${item.original}"</div>
        </div>

        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.5rem; letter-spacing: 0.05em;">Đánh giá theo checklist 10 tiêu chí VSTEP:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            ${checklistCardsHtml}
          </div>
        </div>

        <div style="margin-top: 0.5rem; border-top: 1px solid var(--panel-border); padding-top: 1rem;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.35rem; letter-spacing: 0.05em;">Bản sửa đề xuất chuẩn hóa:</div>
          <div style="font-size: 1.05rem; line-height: 1.6; color: var(--success); font-weight: 700; background-color: var(--success-bg); padding: 0.85rem 1.15rem; border-radius: var(--radius-sm); border: 1px solid var(--success); box-shadow: 0 2px 8px rgba(16, 185, 129, 0.05);">"${item.corrected}"</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = `
    <div id="offline-fallback-report" style="display: ${window.VstepAIGrader ? 'none' : 'flex'}; flex-direction: column; gap: 1.5rem;">
    <!-- HEADER -->
    <div class="evaluation-report-header" style="border-bottom: 2px solid var(--panel-border); padding-bottom: 1rem;">
      <h2 style="font-family: var(--font-display); font-size: 1.5rem; color: var(--accent-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 24px; height: 24px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0110 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0114 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
        </svg>
        BÁO CÁO PHÂN TÍCH LỖI & CHẤM ĐIỂM VSTEP (ERROR DETECTION MODE)
      </h2>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0.25rem 0 0 0;">Quá trình quét và rà soát lỗi toàn bộ bài luận song song đánh giá chi tiết theo 4 tiêu chí VSTEP.</p>
    </div>
    
    <!-- radial score & bands -->
    <div class="evaluation-score-overview" style="display: flex; gap: 2rem; align-items: center; background-color: var(--bg-secondary); border: 1px solid var(--panel-border); padding: 1.5rem; border-radius: var(--radius-lg);">
      <div class="score-radial-wrapper" style="position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; background: radial-gradient(closest-side, var(--bg-secondary) 85%, transparent 86% 100%), conic-gradient(var(--accent-primary) ${score * 10}%, var(--panel-border) 0); border-radius: 50%;">
        <div style="text-align: center; position: relative; z-index: 2;">
          <div style="font-size: 2.25rem; font-weight: 800; font-family: var(--font-display); color: var(--accent-primary); line-height: 1;">${score.toFixed(1)}</div>
          <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-top: 0.15rem;">Thang 10</div>
        </div>
      </div>
      
      <div class="score-text-summary" style="flex-grow: 1;">
        <div class="score-badge-level" style="display: inline-block; background: var(--accent-gradient); color: #fff; padding: 0.35rem 0.85rem; border-radius: 50px; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.25);">
          Kết quả ước lượng: Trình độ ${score >= 8.5 ? 'C1' : score >= 6.0 ? 'B2' : score >= 4.0 ? 'B1' : 'Dưới B1'}
        </div>
        
        <!-- Score conversion pill group -->
        <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.65rem; align-items: center;">
          <span style="background: rgba(59, 130, 246, 0.12); color: var(--accent-primary); border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.35rem 0.75rem; border-radius: 6px; font-weight: 700; font-size: 0.88rem;">
            🎯 Thang điểm 10: ${score.toFixed(1)} / 10
          </span>
          <span style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.35rem 0.75rem; border-radius: 6px; font-weight: 700; font-size: 0.88rem;">
            📊 Quy đổi Task 2 (Thang 7.0): ${((score * 7) / 10).toFixed(1)} / 7.0
          </span>
          <span style="background: rgba(100, 116, 139, 0.1); color: #475569; border: 1px solid rgba(100, 116, 139, 0.2); padding: 0.35rem 0.65rem; border-radius: 6px; font-weight: 600; font-size: 0.82rem;">
            (Tỷ trọng 2/3 bài thi: ${((score * 2) / 3).toFixed(1)} / 6.7)
          </span>
        </div>

        <p style="font-size: 1.05rem; font-weight: 600; line-height: 1.5; color: var(--text-primary); margin: 0;">${feedback}</p>
        <div style="display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
          <span>⏱️ Độ dài: <strong>${wordCount} từ</strong></span>
          <span>⚡ Trạng thái kiểm tra: <strong>Double-Review Pass ✓</strong></span>
        </div>
      </div>
    </div>

    <!-- WORD COUNT CALIBRATION ALERT -->
    ${wordCountCapTriggered ? `
      <div style="background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="var(--warning, #f59e0b)" style="width: 20px; height: 20px; margin-top: 0.1rem; flex-shrink: 0;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary);">
          <strong style="color: var(--warning, #d97706);">Giới hạn trình độ theo độ dài (Word Count Calibration):</strong> ${wordCountCapReason}
        </div>
      </div>
    ` : ''}

    <!-- HOLISTIC B2 CALIBRATION ALERT -->
    ${holisticCapTriggered ? `
      <div style="background-color: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#8b5cf6" style="width: 20px; height: 20px; margin-top: 0.1rem; flex-shrink: 0;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary);">
          <strong style="color: #8b5cf6;">Chuẩn năng lực toàn diện VSTEP (Holistic B2 Requirement):</strong> ${holisticCapReason}
        </div>
      </div>
    ` : ''}

    <!-- VSTEP BAND CALIBRATION ALERT -->
    ${frequentLanguageControlIssues ? `
      <div style="background-color: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="var(--danger)" style="width: 20px; height: 20px; margin-top: 0.1rem; flex-shrink: 0;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary);">
          <strong style="color: var(--danger);">Hiệu chuẩn điểm VSTEP (Band Calibration):</strong> Phát hiện các lỗi hệ thống về Hòa hợp Chủ-Vị, Giới từ, Dạng từ hoặc Collocations xuất hiện thường xuyên hoặc lặp lại qua nhiều đoạn văn. Để phản ánh đúng khả năng kiểm soát ngôn ngữ thực tế theo tiêu chuẩn khảo thí VSTEP, bài viết bị giới hạn điểm ở trình độ B1 (tối đa 5.5).
        </div>
      </div>
    ` : ''}

    <!-- DOUBLE REVIEW PASS BADGE -->
    <div style="background-color: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="var(--info)" style="width: 20px; height: 20px; margin-top: 0.1rem; flex-shrink: 0;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary);">
        <strong style="color: var(--info);">Double-Review Pass (Rà soát 2 lượt):</strong> Đã tiến hành đối chiếu kiểm tra chéo hai lần toàn diện các lỗi ngữ pháp, chính tả, dấu câu, mạo từ/giới từ, dạng từ (word forms) và collocations để đảm bảo báo cáo phân tích đạt độ chính xác tối đa.
      </div>
    </div>
    
    <!-- 4-CRITERIA SCORE GRID -->
    <div class="vstep-criteria-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
      <!-- TF -->
      <div class="vstep-criterion-card" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em;">1. Task Fulfillment ( TF )</span>
          <span style="font-weight: 700; color: var(--accent-primary); font-size: 1rem;">${tfScore.toFixed(1)} / 10</span>
        </div>
        <div class="vstep-progress-wrapper" style="background-color: var(--bg-primary); border-radius: 4px; height: 8px; overflow: hidden; width: 100%;">
          <div style="background-color: var(--success); height: 100%; width: ${pTF}%;"></div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">${commentTF}</p>
      </div>

      <!-- ORG -->
      <div class="vstep-criterion-card" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em;">2. Organization ( ORG )</span>
          <span style="font-weight: 700; color: var(--accent-primary); font-size: 1rem;">${orgScore.toFixed(1)} / 10</span>
        </div>
        <div class="vstep-progress-wrapper" style="background-color: var(--bg-primary); border-radius: 4px; height: 8px; overflow: hidden; width: 100%;">
          <div style="background-color: var(--info); height: 100%; width: ${pORG}%;"></div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">${commentORG}</p>
      </div>

      <!-- LEX -->
      <div class="vstep-criterion-card" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em;">3. Lexical Resource ( VOCAB )</span>
          <span style="font-weight: 700; color: var(--accent-primary); font-size: 1rem;">${vocabScore.toFixed(1)} / 10</span>
        </div>
        <div class="vstep-progress-wrapper" style="background-color: var(--bg-primary); border-radius: 4px; height: 8px; overflow: hidden; width: 100%;">
          <div style="background-color: var(--warning); height: 100%; width: ${pVocab}%;"></div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">${commentVocab}</p>
      </div>

      <!-- GRA -->
      <div class="vstep-criterion-card" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em;">4. Grammar & Accuracy ( GRA )</span>
          <span style="font-weight: 700; color: var(--accent-primary); font-size: 1rem;">${grammarScore.toFixed(1)} / 10</span>
        </div>
        <div class="vstep-progress-wrapper" style="background-color: var(--bg-primary); border-radius: 4px; height: 8px; overflow: hidden; width: 100%;">
          <div style="background-color: var(--accent-primary); height: 100%; width: ${pGrammar}%;"></div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">${commentGrammar}</p>
      </div>
    </div>

    <!-- ERROR SUMMARIES PANEL -->
    <div style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.5rem;">
      <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--panel-border); padding-bottom: 0.5rem; margin-top: 0; margin-bottom: 1rem;">
        BẢNG TỔNG HỢP LỖI SAI (ERROR CATEGORY SUMMARY)
      </h4>
      <div style="overflow-x: auto;">
        <table style="width: 100%; font-size: 0.85rem; text-align: left; border-collapse: collapse; border: none;">
          <thead>
            <tr style="border-bottom: 1px solid var(--panel-border); color: var(--text-secondary);">
              <th style="padding: 0.5rem;">Phân loại lỗi</th>
              <th style="padding: 0.5rem; text-align: center;">Tần suất (Số lỗi)</th>
              <th style="padding: 0.5rem; text-align: center;">Mức độ nghiêm trọng</th>
              <th style="padding: 0.5rem;">Ảnh hưởng đến điểm B1/B2</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px dashed var(--panel-border);">
              <td style="padding: 0.75rem; font-weight: 600;">Grammar (Ngữ pháp, Dạng từ, Giới từ)</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: bold; color: ${totalGrammarErrors > 0 ? 'var(--danger)' : 'var(--success)'};">${totalGrammarErrors}</td>
              <td style="padding: 0.75rem; text-align: center;"><span style="background-color: ${gSum.severity === 'Serious' ? 'var(--danger)' : gSum.severity === 'Moderate' ? 'var(--warning)' : gSum.severity === 'Minor' ? 'var(--info)' : 'var(--success)'}; color:#fff; font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:3px; font-weight:bold; text-transform:uppercase;">${gSum.severity}</span></td>
              <td style="padding: 0.75rem; color: var(--text-secondary);">${gSum.effect}</td>
            </tr>
            <tr style="border-bottom: 1px dashed var(--panel-border);">
              <td style="padding: 0.75rem; font-weight: 600;">Vocabulary (Chính tả, Từ viết tắt)</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: bold; color: ${totalVocabErrors > 0 ? 'var(--danger)' : 'var(--success)'};">${totalVocabErrors}</td>
              <td style="padding: 0.75rem; text-align: center;"><span style="background-color: ${vSum.severity === 'Serious' ? 'var(--danger)' : vSum.severity === 'Moderate' ? 'var(--warning)' : vSum.severity === 'Minor' ? 'var(--info)' : 'var(--success)'}; color:#fff; font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:3px; font-weight:bold; text-transform:uppercase;">${vSum.severity}</span></td>
              <td style="padding: 0.75rem; color: var(--text-secondary);">${vSum.effect}</td>
            </tr>
            <tr style="border-bottom: 1px dashed var(--panel-border);">
              <td style="padding: 0.75rem; font-weight: 600;">Collocation (Từ ghép tự nhiên)</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: bold; color: ${totalCollocErrors > 0 ? 'var(--danger)' : 'var(--success)'};">${totalCollocErrors}</td>
              <td style="padding: 0.75rem; text-align: center;"><span style="background-color: ${cSum.severity === 'Serious' ? 'var(--danger)' : cSum.severity === 'Moderate' ? 'var(--warning)' : cSum.severity === 'Minor' ? 'var(--info)' : 'var(--success)'}; color:#fff; font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:3px; font-weight:bold; text-transform:uppercase;">${cSum.severity}</span></td>
              <td style="padding: 0.75rem; color: var(--text-secondary);">${cSum.effect}</td>
            </tr>
            <tr>
              <td style="padding: 0.75rem; font-weight: 600;">Sentence Structure (Dấu câu, Viết hoa)</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: bold; color: ${totalStructureErrors > 0 ? 'var(--danger)' : 'var(--success)'};">${totalStructureErrors}</td>
              <td style="padding: 0.75rem; text-align: center;"><span style="background-color: ${sSum.severity === 'Serious' ? 'var(--danger)' : sSum.severity === 'Moderate' ? 'var(--warning)' : sSum.severity === 'Minor' ? 'var(--info)' : 'var(--success)'}; color:#fff; font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:3px; font-weight:bold; text-transform:uppercase;">${sSum.severity}</span></td>
              <td style="padding: 0.75rem; color: var(--text-secondary);">${sSum.effect}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- DETAILED SENTENCE REPORT -->
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--panel-border); padding-bottom: 0.5rem; margin-top: 0; margin-bottom: 0.5rem;">
        CHI TIẾT PHÂN TÍCH TỪNG CÂU (SENTENCE-BY-SENTENCE REPORT)
      </h4>
      ${sentencesHtml}
    </div>


    <!-- SUBMITTED ESSAY PREVIEW -->
    <div class="submitted-essay-preview-card" style="background-color: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 1.5rem;">
      <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--panel-border); padding-bottom: 0.5rem; margin-top: 0; margin-bottom: 1rem;">
        BÀI VIẾT ĐÃ NỘP CỦA BẠN (ORIGINAL ESSAY PREVIEW)
      </h4>
      <div style="font-family: inherit; font-size: 0.95rem; line-height: 1.7; color: var(--text-primary); white-space: pre-wrap; font-style: italic;">${text}</div>
    </div>
    
    </div>

    <!-- ACTIONS -->
    <div class="evaluation-actions-row" style="display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap; margin-bottom: 2rem;">
      <button class="btn btn-secondary" style="padding: 0.65rem 1.5rem; border-color: var(--accent-primary); color: var(--accent-primary); font-weight: 700;" onclick="downloadStudentEssay('pdf')">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px; margin-right: 0.35rem; display: inline-block; vertical-align: middle;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>📄 Xuất bài viết & Kết quả chấm (.PDF)
      </button>
      <button class="btn btn-secondary" style="padding: 0.65rem 1.5rem;" onclick="openComparisonModal()">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px; margin-right: 0.35rem; display: inline-block; vertical-align: middle;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>So sánh với bài mẫu
      </button>
      <button class="btn btn-secondary" style="padding: 0.65rem 1.5rem;" onclick="rewriteEssay()">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px; margin-right: 0.35rem; display: inline-block; vertical-align: middle;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>Viết lại bài
      </button>
      <button class="btn btn-primary" style="padding: 0.65rem 1.5rem;" onclick="switchStep('model')">
        Xem bài mẫu B2 →
      </button>
    </div>
  `;
  // Build Student Result Report Metadata BEFORE mounting AI Grader so cached AI results sync immediately
  let reportMeta = null;
  if (container) {
    const elapsedSec = Math.max(writingElapsedSeconds || 0, Math.max(0, 40 * 60 - (timerSeconds || 0)));
    const nowDt = new Date();
    const submittedAtVi = nowDt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' • ' + nowDt.toLocaleDateString('vi-VN');
    reportMeta = {
      studentName: sessionStorage.getItem('current_user_name') || 'Học viên',
      studentClass: sessionStorage.getItem('current_user_class') || 'Chưa xác định',
      topicTitle: currentTopic ? (`Đề ${currentTopic.id}: ${currentTopic.title_en}` + (currentTopic.title_vi ? ` (${currentTopic.title_vi})` : '')) : 'VSTEP Writing Task 2',
      categoryTitle: currentCategory ? (currentCategory.title_vi || currentCategory.title || '') : '',
      elapsedSeconds: elapsedSec,
      submittedAtVi: submittedAtVi,
      wordCount: wordCount,
      cheatTotal: cheatViolationCount || 0,
      cheatTabSwitches: cheatTabSwitchCount || 0,
      cheatPastes: cheatPasteCount || 0,
      score: score,
      tfScore: tfScore,
      orgScore: orgScore,
      vocabScore: vocabScore,
      grammarScore: grammarScore,
      scoreSource: (window.VstepAIGrader ? 'syncing' : 'system'),
      targetLevel: 'B2',
      passThreshold: 6.0,
      superficialCheck: data.superficialCheck || null,
      stepProgress: (typeof buildTopicStepProgressSnapshot === 'function') ? buildTopicStepProgressSnapshot() : null,
      _formReportSent: false,
      _formFallbackTimer: null
    };
    currentEvaluationData._reportMeta = reportMeta;
  }

  if (window.VstepAIGrader && container) {
    const _p = (typeof currentTopic !== 'undefined' && currentTopic) ? (currentTopic.context ? (currentTopic.context + '\n\n' + (currentTopic.prompt || '')) : (currentTopic.prompt || currentTopic.title_en || '')) : '';
    if (reportMeta) {
      reportMeta._formFallbackTimer = setTimeout(() => {
        if (reportMeta && !reportMeta._formReportSent) {
          sendEssayResultToGoogleForm(reportMeta, null);
        }
      }, 15000);
    }
    window.VstepAIGrader.mountSingle(container, {
      taskType: 'task2',
      targetLevel: 'B2',
      prompt: _p,
      essay: text || '',
      onGraded: function(aiData) {
        const offlineEl = document.getElementById('offline-fallback-report');
        if (offlineEl) offlineEl.style.display = 'none';
        updateStudentResultReportCard(aiData);
        if (reportMeta) sendEssayResultToGoogleForm(reportMeta, aiData);
      },
      onError: function() {
        const offlineEl = document.getElementById('offline-fallback-report');
        if (offlineEl) offlineEl.style.display = 'flex';
        if (currentEvaluationData && currentEvaluationData._reportMeta) {
          currentEvaluationData._reportMeta.scoreSource = 'system';
          const cardEl = document.getElementById('student-result-report-card');
          if (cardEl) cardEl.innerHTML = buildStudentResultReportCardHtml(currentEvaluationData._reportMeta);
        }
        if (reportMeta) sendEssayResultToGoogleForm(reportMeta, null);
      }
    });
  } else if (reportMeta) {
    sendEssayResultToGoogleForm(reportMeta, null);
  }

  // Render Screenshot-ready Student Result Report Card at the VERY TOP of Result Screen
  if (container && reportMeta) {
    const existingCard = document.getElementById('student-result-report-card');
    if (existingCard) existingCard.remove();
    const reportCardEl = document.createElement('div');
    reportCardEl.id = 'student-result-report-card';
    reportCardEl.innerHTML = buildStudentResultReportCardHtml(reportMeta);
    container.prepend(reportCardEl);
  }
}

function sendEssayResultToGoogleForm(meta, aiData = null, useBeacon = false) {
  if (!meta || meta._formReportSent) return;
  meta._formReportSent = true;
  if (meta._formFallbackTimer) {
    clearTimeout(meta._formFallbackTimer);
    meta._formFallbackTimer = null;
  }

  const lvl = meta.targetLevel || 'B2';
  const threshold = Number(meta.passThreshold || (lvl === 'B2' ? 6.0 : 4.0));
  const words = Number(meta.wordCount || 0);
  const minRequiredWords = (lvl === 'B2') ? 220 : 200;
  const isLengthOk = words >= minRequiredWords;

  const finalScore = (aiData && typeof aiData.overallScore !== 'undefined' && !isNaN(Number(aiData.overallScore)))
    ? Number(aiData.overallScore)
    : Number(meta.score || 0);
  const scoreLabel = (aiData && typeof aiData.overallScore !== 'undefined') ? 'AI VSTEP' : 'Hệ thống';

  let tf = meta.tfScore, org = meta.orgScore, voc = meta.vocabScore, gra = meta.grammarScore;
  if (aiData && aiData.scores) {
    const s = aiData.scores;
    if (typeof s.tf !== 'undefined') tf = Number(s.tf);
    if (typeof s.org !== 'undefined') org = Number(s.org);
    if (typeof s.voc !== 'undefined') voc = Number(s.voc);
    if (typeof s.gram !== 'undefined') gra = Number(s.gram);
  } else if (aiData && aiData.criteria) {
    const c = aiData.criteria;
    if (c.taskFulfillment && typeof c.taskFulfillment.score !== 'undefined') tf = Number(c.taskFulfillment.score);
    if (c.organization && typeof c.organization.score !== 'undefined') org = Number(c.organization.score);
    if (c.vocabulary && typeof c.vocabulary.score !== 'undefined') voc = Number(c.vocabulary.score);
    if (c.grammar && typeof c.grammar.score !== 'undefined') gra = Number(c.grammar.score);
  }
  const criteriaStr = (typeof tf === 'number' && !isNaN(tf))
    ? ` (TF:${tf.toFixed(1)} ORG:${Number(org || 0).toFixed(1)} VOC:${Number(voc || 0).toFixed(1)} GRA:${Number(gra || 0).toFixed(1)})`
    : '';

  const isPassed = (finalScore >= threshold) && isLengthOk;
  let verdictStr = '';
  if (isPassed) {
    verdictStr = `ĐẠT ${lvl}`;
  } else if (!isLengthOk) {
    verdictStr = `CHƯA ĐẠT (Thiếu từ: ${words}/250)`;
  } else {
    verdictStr = `KHÔNG ĐẠT ${lvl}`;
  }

  const durationText = formatWritingDurationVi(meta.elapsedSeconds);
  const overtimeTag = (meta.elapsedSeconds || 0) > 40 * 60 ? ' [Quá 40 phút]' : '';

  let cheatStr = 'Làm bài trung thực (0 lần chuyển tab)';
  if ((meta.cheatTotal || 0) > 0) {
    const tCnt = meta.cheatTabSwitches || 0;
    const pCnt = meta.cheatPastes || 0;
    if (tCnt > 0 && pCnt > 0) {
      cheatStr = `Chuyển tab ${tCnt} lần + Cố dán ${pCnt} lần (Tổng ${meta.cheatTotal})`;
    } else if (tCnt > 0) {
      cheatStr = `Chuyển tab ${tCnt} lần`;
    } else {
      cheatStr = `Vi phạm ${meta.cheatTotal} lần`;
    }
  }

  const superficialStr = (meta.superficialCheck && meta.superficialCheck.flagged)
    ? `CẢNH BÁO LÀM BÀI ĐỐI PHÓ (${(meta.superficialCheck.reasons || []).join('; ')})`
    : 'Không';

  const isTeacher = typeof checkIsTeacher === 'function' && checkIsTeacher(meta.studentName || '', meta.studentClass || '', '');
  const prefix = isTeacher ? '[GIÁO VIÊN TEST] ' : '';

  let stepProgressStr = '';
  if (meta.stepProgress) {
    const sp = meta.stepProgress;
    const transPart = sp.transTotal > 0 ? `${formatDurationVi(sp.transSec)} (${sp.transAttempted}/${sp.transTotal} câu, ${sp.transCorrect} đúng)` : formatDurationVi(sp.transSec);
    const skipTag = (!isTeacher && sp.skippedPrep) ? ' [⚠️ BỎ QUA BƯỚC CHUẨN BỊ]' : '';
    stepProgressStr = ` | Tiến độ 5 bước: B1 Đọc ${formatDurationVi(sp.readSec)}, B2 Từ vựng ${formatDurationVi(sp.vocabSec)}, B3 Dịch ${transPart}, B4 Viết ${formatDurationVi(sp.writeSec)}, B5 Mẫu ${formatDurationVi(sp.modelSec)}${skipTag}`;
  }

  const msg = `${prefix}[KẾT QUẢ BÀI VIẾT ${lvl}] ${meta.studentName} | Lớp: ${meta.studentClass} | ${meta.topicTitle} | Thời gian viết: ${durationText}${overtimeTag} | Số từ: ${words} từ | Điểm: ${finalScore.toFixed(1)}/10 [${scoreLabel}]${criteriaStr} | Kết quả: ${verdictStr} | Gian lận: ${cheatStr} | Đối phó: ${superficialStr}${stepProgressStr}`;

  sendTrackingReport(msg, useBeacon);
}

// Flush pending result report if student closes the tab before AI finishes grading
window.addEventListener('pagehide', () => {
  if (currentEvaluationData && currentEvaluationData._reportMeta && !currentEvaluationData._reportMeta._formReportSent) {
    sendEssayResultToGoogleForm(currentEvaluationData._reportMeta, null, true);
  }
});

function formatWritingDurationVi(totalSeconds) {
  const sec = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} giờ ${m} phút ${String(s).padStart(2, '0')} giây`;
  if (m > 0) return `${m} phút ${String(s).padStart(2, '0')} giây`;
  return `${s} giây`;
}

function buildStudentResultReportCardHtml(meta) {
  const displayScore = Number(meta.score || 0);
  const threshold = Number(meta.passThreshold || 6.0);
  const lvl = meta.targetLevel || 'B2';
  const words = Number(meta.wordCount || 0);
  const minRequiredWords = (lvl === 'B2') ? 220 : 200; // Ngưỡng sàn số từ tối thiểu để được xét Đạt
  const isLengthOk = words >= minRequiredWords;
  const isPassed = (displayScore >= threshold) && isLengthOk;

  const durationText = formatWritingDurationVi(meta.elapsedSeconds);
  const isOvertime = (meta.elapsedSeconds || 0) > 40 * 60;

  let integrityHtml = '';
  if ((meta.cheatTotal || 0) === 0) {
    integrityHtml = `
      <span style="display:inline-flex;align-items:center;gap:6px;background:#dcfce7;color:#15803d;border:1.5px solid #86efac;padding:5px 12px;border-radius:999px;font-weight:800;font-size:0.86rem;">
        ✅ Làm bài trung thực (0 lần chuyển tab)
      </span>
    `;
  } else {
    const tabCnt = meta.cheatTabSwitches || 0;
    const pasteCnt = meta.cheatPastes || 0;
    let warnDetail = '';
    if (tabCnt > 0 && pasteCnt > 0) {
      warnDetail = `Chuyển tab ${tabCnt} lần • Cố dán văn bản ${pasteCnt} lần (Tổng ${meta.cheatTotal} lần)`;
    } else if (tabCnt > 0) {
      warnDetail = `Phát hiện chuyển tab / rời phòng thi: ${tabCnt} lần`;
    } else {
      warnDetail = `Phát hiện hành vi vi phạm (chuyển tab / dán): ${meta.cheatTotal} lần`;
    }
    integrityHtml = `
      <span style="display:inline-flex;align-items:center;gap:6px;background:#fee2e2;color:#b91c1c;border:1.5px solid #fca5a5;padding:5px 12px;border-radius:999px;font-weight:800;font-size:0.86rem;">
        ⚠️ ${escapeHtml(warnDetail)}
      </span>
    `;
  }

  let passSubText = '';
  if (isPassed) {
    if (displayScore >= 8.5) passSubText = 'Vượt chuẩn — Tương đương C1';
    else if (lvl === 'B1' && displayScore >= 6.0) passSubText = 'Vượt chuẩn B1 — Tương đương B2';
    else passSubText = `Đạt chuẩn ${lvl} (từ ${threshold.toFixed(1)}/10 trở lên & đủ dung lượng)`;
  } else {
    if (!isLengthOk) {
      passSubText = `Chưa đủ dung lượng (${words}/250 từ — Cần tối thiểu ${minRequiredWords} từ để xét đạt)`;
    } else {
      passSubText = `Cần đạt từ ${threshold.toFixed(1)}/10 để đạt ${lvl}`;
    }
  }

  let scoreSourceBadge = '';
  if (meta.scoreSource === 'ai') {
    scoreSourceBadge = `<span style="font-size:0.72rem;font-weight:800;color:#1d4ed8;background:#dbeafe;padding:2px 8px;border-radius:999px;">🎓 Điểm Trợ lý Miss Nguyệt (Chuẩn VSTEP)</span>`;
  } else if (meta.scoreSource === 'syncing') {
    scoreSourceBadge = `<span style="font-size:0.72rem;font-weight:700;color:#b45309;background:#fef3c7;padding:2px 8px;border-radius:999px;">⏳ Trợ lý Miss Nguyệt đang chấm bài...</span>`;
  } else {
    scoreSourceBadge = `<span style="font-size:0.72rem;font-weight:700;color:#475569;background:#f1f5f9;padding:2px 8px;border-radius:999px;">📊 Điểm chấm hệ thống</span>`;
  }

  const statusBg = isPassed ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : 'linear-gradient(135deg, #fef2f2, #fee2e2)';
  const statusBorder = isPassed ? '#10b981' : '#ef4444';
  const statusColor = isPassed ? '#047857' : '#b91c1c';
  let statusText = '';
  if (isPassed) {
    statusText = `✅ ĐẠT ${lvl}`;
  } else if (!isLengthOk) {
    statusText = `❌ CHƯA ĐẠT (Thiếu từ: ${words}/250)`;
  } else {
    statusText = `❌ KHÔNG ĐẠT ${lvl}`;
  }

  const superficialAlertHtml = (meta.superficialCheck && meta.superficialCheck.flagged) ? `
    <div style="background:linear-gradient(135deg, #fef2f2, #fee2e2);border:2px solid #dc2626;border-radius:12px;padding:12px 15px;">
      <div style="font-size:0.98rem;font-weight:900;color:#b91c1c;display:flex;align-items:center;gap:7px;margin-bottom:5px;">
        <span>🚨 CÓ VẺ BẠN ĐANG CỐ GẮNG LÀM BÀI ĐỂ ĐỐI PHÓ! ĐIỀU NÀY CÓ THỂ KHIẾN GIÁO VIÊN CỦA BẠN BUỒN ĐẤY!</span>
      </div>
      <ul style="margin:0;padding-left:20px;color:#991b1b;font-size:0.82rem;font-weight:700;line-height:1.5;">
        ${(meta.superficialCheck.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  return `
    <div style="background:var(--bg-surface, #ffffff);border:2px solid #2563eb;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(37,99,235,0.14);margin-bottom:1.5rem;">
      <!-- Report Top Banner -->
      <div style="background:linear-gradient(135deg, #1e3a8a 0%, #2563eb 65%, #4f46e5 100%);color:#ffffff;padding:14px 20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:1.08rem;font-weight:900;letter-spacing:0.02em;display:flex;align-items:center;gap:8px;">
            <span>📋 BÁO CÁO KẾT QUẢ BÀI VIẾT VSTEP (${lvl})</span>
          </div>
          <div style="font-size:0.78rem;opacity:0.9;margin-top:2px;">ENGLISH WITH MISS NGUYET • PHIẾU XÁC NHẬN KẾT QUẢ LÀM BÀI</div>
        </div>
        <div style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:800;white-space:nowrap;">
          📸 Chụp khung này gửi Giáo viên
        </div>
      </div>

      <!-- Report Body -->
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">
        ${superficialAlertHtml}
        <!-- Info Rows -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(230px, 1fr));gap:10px 18px;background:var(--bg-secondary, #f8fafc);border:1px solid var(--panel-border, #e2e8f0);border-radius:12px;padding:14px 16px;">
          <div>
            <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;">👤 Tên học viên</div>
            <div style="font-size:1.02rem;font-weight:800;color:var(--text-primary, #0f172a);margin-top:2px;">${escapeHtml(meta.studentName)}</div>
          </div>
          <div>
            <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;">🏫 Lớp</div>
            <div style="font-size:1.02rem;font-weight:800;color:#2563eb;margin-top:2px;">${escapeHtml(meta.studentClass)}</div>
          </div>
          <div style="grid-column:1 / -1;border-top:1px dashed var(--panel-border, #cbd5e1);padding-top:10px;">
            <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;">📝 Chủ đề viết</div>
            <div style="font-size:0.96rem;font-weight:800;color:var(--text-primary, #0f172a);margin-top:2px;">
              ${escapeHtml(meta.topicTitle)}
              ${meta.categoryTitle ? `<span style="font-size:0.78rem;font-weight:600;color:var(--text-secondary, #64748b);"> • ${escapeHtml(meta.categoryTitle)}</span>` : ''}
            </div>
          </div>
          <div style="border-top:1px dashed var(--panel-border, #cbd5e1);padding-top:10px;">
            <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;">⏱️ Thời gian viết</div>
            <div style="font-size:0.95rem;font-weight:800;color:var(--text-primary, #0f172a);margin-top:2px;">
              ${escapeHtml(durationText)} ${isOvertime ? '<span style="color:#dc2626;font-size:0.78rem;">(Quá 40 phút)</span>' : ''}
            </div>
            <div style="font-size:0.76rem;color:var(--text-secondary, #64748b);margin-top:2px;">Nộp lúc ${escapeHtml(meta.submittedAtVi)} • Độ dài: <strong>${meta.wordCount} từ</strong></div>
          </div>
          <div style="border-top:1px dashed var(--panel-border, #cbd5e1);padding-top:10px;">
            <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;margin-bottom:5px;">🛡️ Cảnh báo gian lận</div>
            <div>${integrityHtml}</div>
          </div>
          ${meta.stepProgress ? `
            <div style="grid-column:1 / -1;border-top:1px dashed var(--panel-border, #cbd5e1);padding-top:10px;">
              <div style="font-size:0.73rem;font-weight:700;text-transform:uppercase;color:var(--text-muted, #64748b);letter-spacing:0.04em;margin-bottom:4px;">🧭 Tiến độ 5 bước (Đề này)</div>
              <div style="font-size:0.84rem;font-weight:700;color:var(--text-primary, #0f172a);display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;">
                <span>📖 B1 Đọc: <strong>${formatDurationVi(meta.stepProgress.readSec)}</strong></span>
                <span>📚 B2 Từ vựng: <strong>${formatDurationVi(meta.stepProgress.vocabSec)}</strong></span>
                <span>✍️ B3 Dịch ý: <strong>${formatDurationVi(meta.stepProgress.transSec)}</strong>${meta.stepProgress.transTotal > 0 ? ` (${meta.stepProgress.transAttempted}/${meta.stepProgress.transTotal} câu, ${meta.stepProgress.transCorrect} đúng)` : ''}</span>
                <span>📝 B4 Viết: <strong>${formatDurationVi(meta.stepProgress.writeSec)}</strong></span>
                ${meta.stepProgress.skippedPrep
                  ? '<span style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:2px 8px;border-radius:999px;font-size:0.74rem;font-weight:800;">⚠️ Chưa học đủ B1–B3</span>'
                  : '<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;padding:2px 8px;border-radius:999px;font-size:0.74rem;font-weight:800;">✅ Đủ lộ trình B1→B4</span>'}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Score & Pass/Fail Verdict Strip -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(230px, 1fr));gap:12px;">
          <div style="background:linear-gradient(135deg, #eff6ff, #dbeafe);border:2px solid #3b82f6;border-radius:13px;padding:14px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">
            <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;color:#1e40af;letter-spacing:0.05em;">🎯 ĐIỂM SỐ BÀI VIẾT</div>
            <div style="font-size:2.1rem;font-weight:900;color:#1d4ed8;line-height:1.1;">
              ${displayScore.toFixed(1)} <span style="font-size:1rem;font-weight:700;color:#3b82f6;">/ 10</span>
            </div>
            <div style="font-size:0.77rem;font-weight:700;color:#1e3a8a;">
              Quy đổi Task 2: ${((displayScore * 7) / 10).toFixed(1)}/7.0 • 2/3 bài thi: ${((displayScore * 2) / 3).toFixed(1)}/6.7
            </div>
            <div style="margin-top:3px;">${scoreSourceBadge}</div>
          </div>

          <div style="background:${statusBg};border:2px solid ${statusBorder};border-radius:13px;padding:14px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;">
            <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;color:${statusColor};letter-spacing:0.05em;">🏅 KẾT QUẢ XÉT CHUẨN ${lvl}</div>
            <div style="font-size:1.55rem;font-weight:900;color:${statusColor};line-height:1.15;letter-spacing:0.02em;">
              ${statusText}
            </div>
            <div style="font-size:0.8rem;font-weight:700;color:${statusColor};opacity:0.9;">
              ${escapeHtml(passSubText)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateStudentResultReportCard(aiData) {
  if (!aiData || typeof aiData.overallScore === 'undefined' || !currentEvaluationData || !currentEvaluationData._reportMeta) return;
  const aiScore = Number(aiData.overallScore);
  if (isNaN(aiScore)) return;

  // 1. Đồng bộ nguồn dữ liệu chính sang điểm Giám khảo AI VSTEP
  currentEvaluationData.aiScore = aiScore;
  currentEvaluationData.score = aiScore;
  currentEvaluationData._reportMeta.score = aiScore;
  currentEvaluationData._reportMeta.scoreSource = 'ai';

  if (aiData.scores) {
    const s = aiData.scores;
    if (typeof s.tf !== 'undefined') currentEvaluationData._reportMeta.tfScore = Number(s.tf);
    if (typeof s.org !== 'undefined') currentEvaluationData._reportMeta.orgScore = Number(s.org);
    if (typeof s.voc !== 'undefined') currentEvaluationData._reportMeta.vocabScore = Number(s.voc);
    if (typeof s.gram !== 'undefined') currentEvaluationData._reportMeta.grammarScore = Number(s.gram);
  }

  // 2. Cập nhật Phiếu báo cáo kết quả ở giữa màn hình
  const cardEl = document.getElementById('student-result-report-card');
  if (cardEl) {
    cardEl.innerHTML = buildStudentResultReportCardHtml(currentEvaluationData._reportMeta);
  }

  // 3. Đồng bộ 100% Cột bên phải (KẾT QUẢ PHÂN TÍCH BÀI) theo điểm AI
  const conv7 = ((aiScore * 7) / 10).toFixed(1);
  const conv67 = ((aiScore * 2) / 3).toFixed(1);
  const elEst = document.getElementById('estimated-score');
  if (elEst) elEst.innerText = aiScore.toFixed(1);
  const elDisp10 = document.getElementById('score-display-10');
  if (elDisp10) elDisp10.innerText = `${aiScore.toFixed(1)} / 10`;
  const elDispConv = document.getElementById('score-display-converted');
  if (elDispConv) elDispConv.innerText = `${conv7} / 7.0`;
  const elDispRatio = document.getElementById('score-display-ratio');
  if (elDispRatio) elDispRatio.innerText = `(Tỷ trọng 2/3 bài thi: ${conv67} / 6.7)`;

  const elGen = document.getElementById('ws-feedback-general');
  if (elGen) {
    const aiDiag = (aiData.diagnosis && aiData.diagnosis.overallDiagnosis) ? String(aiData.diagnosis.overallDiagnosis).trim() : '';
    const penNote = aiData.wordPenaltyNote ? String(aiData.wordPenaltyNote).trim() : '';
    if (penNote) {
      elGen.innerText = penNote;
    } else if (aiDiag) {
      elGen.innerText = aiDiag;
    }
    currentEvaluationData.feedback = elGen.innerText;
  }

  // Đồng bộ 4 thẻ tiêu chí cột bên phải theo đúng 4 tiêu chí của AI
  const detailsList = document.getElementById('feedback-details-list');
  if (detailsList && aiData.scores) {
    const s = aiData.scores;
    const c = aiData.criteria || {};
    const tf = Number(s.tf || 0);
    const org = Number(s.org || 0);
    const voc = Number(s.voc || 0);
    const gram = Number(s.gram || 0);
    detailsList.innerHTML = `
      <div class="grade-detail-card ${tf >= 6.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="grade-detail-title" style="font-weight: 700;">1. TASK FULFILLMENT</span>
          <span style="font-weight: bold;">${tf.toFixed(1)} / 10</span>
        </div>
        <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${escapeHtml((c.tf && c.tf.summary) || 'Đã đồng bộ theo Trợ lý Miss Nguyệt.')}
        </div>
      </div>
      <div class="grade-detail-card ${org >= 6.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="grade-detail-title" style="font-weight: 700;">2. ORGANIZATION</span>
          <span style="font-weight: bold;">${org.toFixed(1)} / 10</span>
        </div>
        <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${escapeHtml((c.org && c.org.summary) || 'Đã đồng bộ theo Trợ lý Miss Nguyệt.')}
        </div>
      </div>
      <div class="grade-detail-card ${voc >= 6.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="grade-detail-title" style="font-weight: 700;">3. LEXICAL RESOURCE</span>
          <span style="font-weight: bold;">${voc.toFixed(1)} / 10</span>
        </div>
        <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${escapeHtml((c.voc && c.voc.summary) || 'Đã đồng bộ theo Trợ lý Miss Nguyệt.')}
        </div>
      </div>
      <div class="grade-detail-card ${gram >= 6.0 ? 'success-card' : 'warning-card'}" style="margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="grade-detail-title" style="font-weight: 700;">4. GRAMMAR & ACCURACY</span>
          <span style="font-weight: bold;">${gram.toFixed(1)} / 10</span>
        </div>
        <div class="grade-detail-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${escapeHtml((c.gram && c.gram.summary) || 'Đã đồng bộ theo Trợ lý Miss Nguyệt.')}
        </div>
      </div>
    `;
  }

  // 4. Đồng bộ điểm mới nhất trong Lịch sử bài viết & Nút xanh "✓ ĐÃ VIẾT (x.xđ)" trên đầu trang
  try {
    const history = typeof getHistory === 'function' ? getHistory() : [];
    if (Array.isArray(history) && history.length > 0 && currentTopic) {
      const latest = history[0];
      if (latest && Number(latest.topicId) === Number(currentTopic.id)) {
        latest.score = aiScore;
        localStorage.setItem(getStudentHistoryKey(), JSON.stringify(history));
        if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
          window.StudentHistorySync.schedulePush(true);
        }
      }
    }
    if (typeof updateWorkspaceStickBadge === 'function') updateWorkspaceStickBadge();
    if (typeof updateStats === 'function') updateStats();
  } catch (e) {
    console.warn('Sync history score warning:', e);
  }
}


// Rewrite essay: toggles back to editor from grading view
function rewriteEssay() {
  hasSubmitted = false;
  document.getElementById('step3-evaluation-view').style.display = 'none';
  document.getElementById('step3-editor-view').style.display = 'flex';
  
  // Re-enable editing, resume timer, and focus textarea
  startTimer();
  const textarea = document.getElementById('essay-textarea');
  if (textarea) textarea.focus();
  
  showToast("✏️ Bạn có thể tiếp tục chỉnh sửa bài luận để cải thiện điểm số.", "info");
}

// --- Exit Exam Mode ---
function exitExamMode() {
  if (!isExamModeActive()) {
    switchStep('read');
    return;
  }
  isPromptingUser = true;
  const confirmExit = confirm("⚠️ BẠN CÓ CHẮC CHẮN MUỐN THOÁT PHÒNG THI?\n\n- Thời gian làm bài sẽ tạm dừng.\n- Bài viết hiện tại sẽ được tự động sao lưu an toàn vào Bản nháp.\n- Bạn sẽ được chuyển về màn hình Đọc hiểu đề bài.");
  setTimeout(() => { isPromptingUser = false; }, 500);
  if (!confirmExit) return;
  
  saveProgressAction(true); // silent auto-save
  stopTimer();
  switchStep('read');
  showToast("🚪 Bạn đã rời khỏi phòng thi. Bản nháp đã được lưu an toàn.", "info");
}

// --- Anti-Cheat, Time-on-Site & Result Telemetry System ---

const TRACKING_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfB9UgCMgYhwLVvjiXnGZTFlj6IwCJfjqwpBfd1qHpeOm4Lvw/formResponse';
const TRACKING_FORM_ENTRY = 'entry.1205151935';

const sessionTracking = {
  isLoggedIn: false,
  userName: '',
  userClass: '',
  isTeacher: false,
  loginTimeMs: 0,
  activeSeconds: 0,
  stepSeconds: { read: 0, vocab: 0, trans: 0, write: 0, model: 0 },
  topicStepSeconds: { read: 0, vocab: 0, trans: 0, write: 0, model: 0 },
  topicsVisited: [],
  transResults: {},
  lastTransReportKey: '',
  essaySubmissions: [],
  totalCheats: 0,
  exitReportSent: false,
  _writeUnlockNotified: false,
  tickerInterval: null
};

function getStepProgressStorageKey(catId, topicId) {
  if (window.StudentHistorySync && typeof window.StudentHistorySync.getPrepKey === 'function') {
    return window.StudentHistorySync.getPrepKey(catId, topicId);
  }
  const u = normalizeVietnameseName(sessionStorage.getItem('current_user_name') || 'guest');
  return `vstep_prep_${u}_${catId}_${topicId}`;
}

function loadTopicPrepProgress(catId, topicId) {
  try {
    const raw = localStorage.getItem(getStepProgressStorageKey(catId, topicId));
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      readSec: Number(parsed.readSec || 0),
      vocabSec: Number(parsed.vocabSec || 0),
      transSec: Number(parsed.transSec || 0),
      readDone: Boolean(parsed.readDone),
      vocabDone: Boolean(parsed.vocabDone)
    };
  } catch (e) {
    return { readSec: 0, vocabSec: 0, transSec: 0, readDone: false, vocabDone: false };
  }
}

function saveTopicPrepProgress(catId, topicId, prog) {
  try {
    localStorage.setItem(getStepProgressStorageKey(catId, topicId), JSON.stringify(prog));
    if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
      window.StudentHistorySync.schedulePush(false);
    }
  } catch (e) {}
}

function resetTopicStepTracking() {
  sessionTracking.topicStepSeconds = { read: 0, vocab: 0, trans: 0, write: 0, model: 0 };
  sessionTracking._writeUnlockNotified = false;
  if (currentCategory && currentTopic) {
    const saved = loadTopicPrepProgress(currentCategory.id, currentTopic.id);
    sessionTracking.topicStepSeconds.read = saved.readSec || 0;
    sessionTracking.topicStepSeconds.vocab = saved.vocabSec || 0;
    sessionTracking.topicStepSeconds.trans = saved.transSec || 0;
    const gate = getSequentialStepGate('write', currentCategory.id, currentTopic.id, currentTopic);
    if (gate.allowed) sessionTracking._writeUnlockNotified = true;
  }
}

function getTopicTransCompletionStats(catId, topicId, topic, level) {
  let total = 0;
  let attempted = 0;
  let correct = 0;
  if (topic && currentCategory && typeof buildTranslationExercises === 'function') {
    const effLevel = level || currentTransLevel || 'B2';
    const exercises = buildTranslationExercises(topic, effLevel, currentCategory);
    total = exercises.length;
    for (let i = 0; i < total; i++) {
      const k = `${catId}_${topicId}_${effLevel}_${i}`;
      const hasAttempt = localStorage.getItem(getStudentTransKey('attempted', catId, topicId, effLevel, i)) === 'true' ||
        Boolean(sessionTracking.transResults[k]);
      if (hasAttempt) {
        attempted++;
        if (localStorage.getItem(getStudentTransKey('correct', catId, topicId, effLevel, i)) === 'true' ||
            (sessionTracking.transResults[k] && sessionTracking.transResults[k].isCorrect)) {
          correct++;
        }
      }
    }
  }
  return { total, attempted, correct };
}

function getSequentialStepGate(stepKey, catId, topicId, topic) {
  const userName = sessionStorage.getItem('current_user_name') || '';
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();

  // Teachers always bypass sequential step locks
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' ||
      (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return { allowed: true, missing: [], shortLabel: '' };
  }

  if (stepKey === 'read' || stepKey === 'vocab' || stepKey === 'trans') {
    return { allowed: true, missing: [], shortLabel: '' };
  }

  const hasPastRealSubmission = (typeof getTopicSubmissionInfo === 'function' && getTopicSubmissionInfo(catId, topicId) !== null);
  if (hasPastRealSubmission) {
    return { allowed: true, missing: [], shortLabel: '' };
  }

  if (stepKey === 'model') {
    if (hasSubmitted) {
      return { allowed: true, missing: [], shortLabel: '' };
    }
    return {
      allowed: false,
      missing: ['Bạn cần hoàn thành và nộp bài viết ở BƯỚC 04 trước khi xem BƯỚC 05 (Bài mẫu tham khảo)'],
      shortLabel: '(Nộp B4)'
    };
  }

  if (stepKey === 'write') {
    const prog = loadTopicPrepProgress(catId, topicId);
    const readSec = Math.max(prog.readSec || 0, sessionTracking.topicStepSeconds.read || 0);
    const vocabSec = Math.max(prog.vocabSec || 0, sessionTracking.topicStepSeconds.vocab || 0);
    const withVocab = !!(topic && topic.details && topic.details.vocab_step);

    const missing = [];
    if (!prog.readDone && readSec < 10) {
      missing.push(`BƯỚC 01 (Đọc hiểu đề): cần xem tối thiểu 10 giây (còn ${Math.max(1, 10 - readSec)}s)`);
    }
    if (withVocab && !prog.vocabDone && vocabSec < 20) {
      missing.push(`BƯỚC 02 (Nạp từ vựng): cần học tối thiểu 20 giây (còn ${Math.max(1, 20 - vocabSec)}s)`);
    }

    const transStats = getTopicTransCompletionStats(catId, topicId, topic, currentTransLevel || 'B2');
    if (transStats.total > 0) {
      const reqTrans = Math.min(transStats.total, Math.max(3, Math.ceil(transStats.total * 0.5)));
      if (transStats.attempted < reqTrans) {
        missing.push(`BƯỚC 03 (Tập diễn đạt): cần tự gõ & kiểm tra ít nhất ${reqTrans}/${transStats.total} câu dịch (hiện tại: ${transStats.attempted}/${reqTrans})`);
      }
    }

    if (missing.length > 0) {
      return { allowed: false, missing, shortLabel: '(Xong B1-3)' };
    }
    return { allowed: true, missing: [], shortLabel: '' };
  }

  return { allowed: true, missing: [], shortLabel: '' };
}

function checkAndNotifyWriteStepUnlocked() {
  if (!currentCategory || !currentTopic) return;
  const isClassLocked = typeof isStepAllowedForUser === 'function' && !isStepAllowedForUser('write', currentCategory.id, currentTopic.id, currentTopic);
  if (isClassLocked) return;

  const gate = getSequentialStepGate('write', currentCategory.id, currentTopic.id, currentTopic);
  if (gate.allowed && !sessionTracking._writeUnlockNotified) {
    sessionTracking._writeUnlockNotified = true;
    renderWorkspaceStepHeader();
    showToast('🔓 Tuyệt vời! Bạn đã hoàn thành đủ lộ trình Bước 1–2–3 và MỞ KHÓA BƯỚC 04 (Viết bài luận)!', 'success');
  }
}

function buildTopicStepProgressSnapshot() {
  const catId = currentCategory ? currentCategory.id : 0;
  const topicId = currentTopic ? currentTopic.id : 0;
  const prog = (catId && topicId) ? loadTopicPrepProgress(catId, topicId) : { readSec: 0, vocabSec: 0, transSec: 0 };
  const s = sessionTracking.topicStepSeconds;
  const readSec = Math.max(prog.readSec || 0, s.read || 0);
  const vocabSec = Math.max(prog.vocabSec || 0, s.vocab || 0);
  const transSec = Math.max(prog.transSec || 0, s.trans || 0);
  const writeSec = Math.max(writingElapsedSeconds || 0, s.write || 0);
  const modelSec = s.model || 0;
  const transStats = getTopicTransCompletionStats(catId, topicId, currentTopic, currentTransLevel || 'B2');
  const withVocab = hasVocabStep();
  const skippedPrep = (withVocab && vocabSec < 10) || (transStats.total > 0 && transStats.attempted === 0);

  return {
    readSec,
    vocabSec,
    transSec,
    writeSec,
    modelSec,
    withVocab,
    transAttempted: transStats.attempted,
    transCorrect: transStats.correct,
    transTotal: transStats.total,
    skippedPrep
  };
}

/**
 * Format duration in seconds to a concise Vietnamese string.
 */
function formatDurationVi(totalSeconds) {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}g ${m}p ${s}s`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
}

/**
 * Send attendance, login, study time, result, or anti-cheat report to Google Forms.
 * Uses sendBeacon + keepalive fetch when closing the page so exit reports reliably arrive.
 */
function sendTrackingReport(message, useBeacon = false) {
  try {
    if (!message) return;
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const params = new URLSearchParams();
      params.append(TRACKING_FORM_ENTRY, message);
      if (navigator.sendBeacon(TRACKING_FORM_URL, params)) {
        return;
      }
    }
    const formData = new FormData();
    formData.append(TRACKING_FORM_ENTRY, message);
    fetch(TRACKING_FORM_URL, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: Boolean(useBeacon),
      body: formData
    }).catch(() => {});
  } catch (err) {}
}

/**
 * Initialize or reset the active session timer upon login.
 */
function startSessionTracking(userName, userClass, isTeacher) {
  if (sessionTracking.tickerInterval) {
    clearInterval(sessionTracking.tickerInterval);
    sessionTracking.tickerInterval = null;
  }
  sessionTracking.isLoggedIn = true;
  sessionTracking.userName = userName || 'Học viên';
  sessionTracking.userClass = userClass || '';
  sessionTracking.isTeacher = Boolean(isTeacher);
  sessionTracking.loginTimeMs = Date.now();
  sessionTracking.activeSeconds = 0;
  sessionTracking.stepSeconds = { read: 0, vocab: 0, trans: 0, write: 0, model: 0 };
  sessionTracking.topicStepSeconds = { read: 0, vocab: 0, trans: 0, write: 0, model: 0 };
  sessionTracking.topicsVisited = [];
  sessionTracking.transResults = {};
  sessionTracking.lastTransReportKey = '';
  sessionTracking.essaySubmissions = [];
  sessionTracking.totalCheats = 0;
  sessionTracking.exitReportSent = false;
  sessionTracking._writeUnlockNotified = false;

  sessionTracking.tickerInterval = setInterval(() => {
    if (!sessionTracking.isLoggedIn || document.hidden) return;
    sessionTracking.activeSeconds++;
    if (typeof currentScreen !== 'undefined' && currentScreen === 'workspace' &&
        typeof currentStepKey !== 'undefined' && sessionTracking.stepSeconds.hasOwnProperty(currentStepKey)) {
      sessionTracking.stepSeconds[currentStepKey]++;
      sessionTracking.topicStepSeconds[currentStepKey]++;

      if (currentCategory && currentTopic && (currentStepKey === 'read' || currentStepKey === 'vocab' || currentStepKey === 'trans')) {
        const prog = loadTopicPrepProgress(currentCategory.id, currentTopic.id);
        prog.readSec = Math.max(prog.readSec || 0, sessionTracking.topicStepSeconds.read);
        prog.vocabSec = Math.max(prog.vocabSec || 0, sessionTracking.topicStepSeconds.vocab);
        prog.transSec = Math.max(prog.transSec || 0, sessionTracking.topicStepSeconds.trans);
        let milestoneReached = false;
        if (!prog.readDone && prog.readSec >= 10) {
          prog.readDone = true;
          milestoneReached = true;
        }
        if (!prog.vocabDone && prog.vocabSec >= 20) {
          prog.vocabDone = true;
          milestoneReached = true;
        }
        if (milestoneReached || sessionTracking.activeSeconds % 5 === 0) {
          saveTopicPrepProgress(currentCategory.id, currentTopic.id, prog);
        }
        if (milestoneReached) {
          checkAndNotifyWriteStepUnlocked();
        }
      }
    }
  }, 1000);
}

/**
 * Record a topic opened during the current session.
 */
function recordTopicVisit(category, topic) {
  if (!sessionTracking.isLoggedIn || !category || !topic) return;
  const label = `Dạng ${category.id}-${topic.id}: ${topic.title_en}`;
  if (!sessionTracking.topicsVisited.includes(label)) {
    sessionTracking.topicsVisited.push(label);
  }
}

/**
 * Return elapsed wall-clock seconds and active foreground seconds for this session.
 */
function getSessionDurations() {
  const totalElapsed = sessionTracking.loginTimeMs
    ? Math.max(0, Math.round((Date.now() - sessionTracking.loginTimeMs) / 1000))
    : 0;
  return {
    totalElapsed,
    activeSeconds: sessionTracking.activeSeconds
  };
}

/**
 * Summarize translation exercise attempts & correctness across the session (and optional topic).
 */
function getTranslationSessionStats(topic = null, category = null, level = 'B2') {
  const entries = Object.values(sessionTracking.transResults);
  const totalAttempted = entries.length;
  const totalCorrect = entries.filter(e => e.isCorrect).length;

  let topicAttempted = 0;
  let topicCorrect = 0;
  let topicTotal = 0;
  if (topic && category) {
    const exercises = buildTranslationExercises(topic, level, category);
    topicTotal = exercises.length;
    const prefix = `${category.id}_${topic.id}_${level}_`;
    Object.keys(sessionTracking.transResults).forEach(k => {
      if (k.startsWith(prefix)) {
        topicAttempted++;
        if (sessionTracking.transResults[k].isCorrect) topicCorrect++;
      }
    });
  }

  return { totalAttempted, totalCorrect, topicAttempted, topicCorrect, topicTotal };
}

/**
 * Send translation practice progress report when completing exercises or moving to Write step.
 */
function reportTranslationProgressIfAny() {
  if (!sessionTracking.isLoggedIn || !currentTopic || !currentCategory) return;
  const stats = getTranslationSessionStats(currentTopic, currentCategory, currentTransLevel);
  if (stats.topicAttempted === 0) return;

  const dedupKey = `${currentCategory.id}_${currentTopic.id}_${currentTransLevel}_${stats.topicAttempted}_${stats.topicCorrect}`;
  if (sessionTracking.lastTransReportKey === dedupKey) return;
  sessionTracking.lastTransReportKey = dedupKey;

  const { totalElapsed, activeSeconds } = getSessionDurations();
  const nowVi = new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
  const prefix = sessionTracking.isTeacher ? '[GIÁO VIÊN TEST] ' : '';
  sendTrackingReport(
    `${prefix}[KẾT QUẢ DỊCH CÂU] ${sessionTracking.userName} - Lớp ${sessionTracking.userClass} - Đề: ${currentTopic.title_en} (${currentTransLevel}) - Kết quả: ${stats.topicCorrect}/${stats.topicTotal} đúng (Đã làm ${stats.topicAttempted}/${stats.topicTotal}) - Ở web: ${formatDurationVi(totalElapsed)} (Hoạt động thực: ${formatDurationVi(activeSeconds)}) - Gian lận: ${sessionTracking.totalCheats} lần lúc ${nowVi}`
  );
}

/**
 * Send final session summary (time spent on web, activities completed, scores, cheat count)
 * when the user logs out or closes the tab. Helps detect superficial logins.
 */
function sendExitSessionReport(reason = 'leave') {
  if (!sessionTracking.isLoggedIn || sessionTracking.exitReportSent) return;
  sessionTracking.exitReportSent = true;
  if (sessionTracking.tickerInterval) {
    clearInterval(sessionTracking.tickerInterval);
    sessionTracking.tickerInterval = null;
  }

  const { totalElapsed, activeSeconds } = getSessionDurations();
  const transStats = getTranslationSessionStats();
  const nowVi = new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');

  const isLowEffort = !sessionTracking.isTeacher &&
    activeSeconds < 60 &&
    transStats.totalAttempted === 0 &&
    sessionTracking.essaySubmissions.length === 0;

  const prefix = sessionTracking.isTeacher
    ? '[GIÁO VIÊN TEST] [RỜI WEB]'
    : (isLowEffort ? '[RỜI WEB - ⚠️ NGHI VẤN VÀO ĐỐI PHÓ (< 1 PHÚT)]' : '[RỜI WEB / TỔNG KẾT PHIÊN]');

  const s = sessionTracking.stepSeconds;
  const stepDetail = `Đọc: ${formatDurationVi(s.read)}, Từ vựng: ${formatDurationVi(s.vocab)}, Dịch: ${formatDurationVi(s.trans)}, Viết: ${formatDurationVi(s.write)}, Mẫu: ${formatDurationVi(s.model)}`;
  const topicsStr = sessionTracking.topicsVisited.length > 0
    ? `${sessionTracking.topicsVisited.length} đề (${sessionTracking.topicsVisited.slice(0, 3).join('; ')})`
    : 'Chưa mở đề nào';
  const transStr = transStats.totalAttempted > 0
    ? `${transStats.totalCorrect}/${transStats.totalAttempted} câu đúng`
    : 'Chưa làm dịch câu';

  let essayStr = 'Chưa nộp bài luận';
  if (sessionTracking.essaySubmissions.length > 0) {
    essayStr = sessionTracking.essaySubmissions
      .map(sub => `${sub.topicTitle}: ${sub.score.toFixed(1)}/10 (${sub.wordCount} từ)`)
      .join(' | ');
  } else {
    const textarea = document.getElementById('essay-textarea');
    const draftText = textarea ? textarea.value.trim() : '';
    if (draftText) {
      const draftWords = draftText.split(/\s+/).filter(Boolean).length;
      essayStr = `Chưa nộp (Đang gõ nháp ${draftWords} từ)`;
    }
  }

  const cheatStr = sessionTracking.totalCheats > 0
    ? `⚠️ ${sessionTracking.totalCheats} lần`
    : '0 lần';

  const msg = `${prefix} ${sessionTracking.userName} - Lớp ${sessionTracking.userClass} - Thời gian ở web: ${formatDurationVi(totalElapsed)} (Hoạt động thực: ${formatDurationVi(activeSeconds)} | ${stepDetail}) - Đề đã xem: ${topicsStr} - Dịch câu: ${transStr} - Bài luận: ${essayStr} - Số lần gian lận: ${cheatStr} (${reason}) lúc ${nowVi}`;

  sendTrackingReport(msg, true);
  sessionTracking.isLoggedIn = false;
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => sendExitSessionReport('pagehide'));
  window.addEventListener('beforeunload', () => sendExitSessionReport('beforeunload'));
}

/**
 * Convert an internal anti-cheat reason code into a readable Vietnamese label.
 */
function formatCheatReasonText(reason) {
  if (reason === 'paste') return 'Dán (Paste) nội dung ngoài';
  if (reason === 'window_blur') return 'Rời cửa sổ / chuyển ứng dụng khác';
  return 'Chuyển tab/rời phòng thi';
}

function getStudentLockKey(studentName) {
  const norm = normalizeVietnameseName(studentName || sessionStorage.getItem('current_user_name') || 'unknown');
  return `vstep_lock_${norm}`;
}

function isCurrentStudentLocked() {
  const studentName = sessionStorage.getItem('current_user_name');
  if (!studentName) return false;
  if (typeof checkIsTeacher === 'function' && checkIsTeacher(studentName, sessionStorage.getItem('current_user_class') || '', '')) {
    return false;
  }
  const lockData = localStorage.getItem(getStudentLockKey(studentName));
  if (lockData) {
    try {
      const parsed = JSON.parse(lockData);
      if (parsed && parsed.locked === true) return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function lockCurrentAccount(reason) {
  const studentName = sessionStorage.getItem('current_user_name') || localStorage.getItem('vstep_locked_student_name') || 'Học viên';
  const studentClass = sessionStorage.getItem('current_user_class') || localStorage.getItem('vstep_locked_student_class') || '';

  // Never lock teacher
  if (typeof checkIsTeacher === 'function' && checkIsTeacher(studentName, studentClass, '')) {
    return;
  }

  const lockInfo = {
    locked: true,
    studentName: studentName,
    studentClass: studentClass,
    time: new Date().toISOString(),
    timeVi: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
    reason: reason,
    violations: cheatViolationCount
  };

  localStorage.setItem(getStudentLockKey(studentName), JSON.stringify(lockInfo));
  localStorage.setItem('vstep_locked_student_name', studentName);
  localStorage.setItem('vstep_locked_student_class', studentClass);
  sessionStorage.setItem('vstep_session_locked', 'true');

  // Stop timer and auto-save current draft safely
  stopTimer();
  saveProgressAction(true);

  // Send lock event to Google Forms
  const topicTitle = (currentTopic && currentTopic.title_en) || 'Task 2 Essay';
  const reasonText = formatCheatReasonText(reason);
  const { totalElapsed } = getSessionDurations();
  sendTrackingReport(`[TẠM KHÓA TÀI KHOẢN DO VI PHẠM 3 LẦN] ${studentName} - Lớp ${studentClass} - Đề: ${topicTitle} - Lý do: ${reasonText} - Tổng số lần gian lận: ${cheatViolationCount} - Ở web: ${formatDurationVi(totalElapsed)} lúc ${lockInfo.timeVi}`);

  showAccountLockedModal(reason);
}

function showAccountLockedModal(reason = 'tab_switch') {
  const modal = document.getElementById('cheat-warning-modal');
  const countBadge = document.getElementById('cheat-warning-count');
  const title = document.getElementById('cheat-warning-title');
  const desc = document.getElementById('cheat-warning-desc');
  const btnContinue = document.getElementById('cheat-btn-continue');
  const unlockBox = document.getElementById('teacher-unlock-container');
  const icon = document.getElementById('cheat-modal-icon');
  const unlockMsg = document.getElementById('teacher-unlock-msg');
  const unlockInput = document.getElementById('teacher-unlock-code');

  const studentName = sessionStorage.getItem('current_user_name') || localStorage.getItem('vstep_locked_student_name') || 'Học viên';
  const studentClass = sessionStorage.getItem('current_user_class') || localStorage.getItem('vstep_locked_student_class') || '';

  if (icon) icon.textContent = '🔒';
  if (countBadge) {
    countBadge.textContent = '⛔ TÀI KHOẢN ĐÃ BỊ TẠM KHÓA (VI PHẠM LẦN 03)';
    countBadge.style.background = '#dc2626';
    countBadge.style.color = '#ffffff';
    countBadge.style.borderColor = '#b91c1c';
  }
  if (title) {
    title.textContent = 'TÀI KHOẢN ĐÃ BỊ TẠM KHÓA!';
    title.style.color = '#dc2626';
  }
  if (desc) {
    let reasonText = 'chuyển tab hoặc rời khỏi cửa sổ phòng thi';
    if (reason === 'paste') reasonText = 'dán (paste) nội dung từ bên ngoài';
    desc.innerHTML = `
      <div style="font-size: 0.96rem; margin-bottom: 0.65rem; color: var(--text-primary);">
        Học viên: <strong>${escapeHtml(studentName)}</strong> ${studentClass ? `(Lớp: <strong>${escapeHtml(studentClass)}</strong>)` : ''}
      </div>
      <div style="color: #ef4444; font-weight: 700; margin-bottom: 0.65rem;">
        Hệ thống phát hiện vi phạm quy chế thi LẦN 03 (${reasonText}).
      </div>
      <div style="line-height: 1.5; font-size: 0.9rem;">
        Bài viết của bạn đã được <strong>tự động lưu lại an toàn</strong>. Hệ thống đã <strong>TẠM KHÓA TÀI KHOẢN</strong> cho đến khi <strong>GIÁO VIÊN</strong> cho phép mở lại trên hệ thống.
      </div>
    `;
  }

  if (btnContinue) btnContinue.style.display = 'none';
  if (unlockBox) unlockBox.style.display = 'block';
  if (unlockMsg) unlockMsg.style.display = 'none';
  if (unlockInput) {
    unlockInput.value = '';
    setTimeout(() => unlockInput.focus(), 300);
  }

  if (modal) modal.style.display = 'flex';
}

function teacherUnlockAccount() {
  const codeInput = document.getElementById('teacher-unlock-code');
  const msgEl = document.getElementById('teacher-unlock-msg');
  if (!codeInput) return;

  const code = (codeInput.value || '').trim();
  const validCodes = ['PTMN', 'GVPTMN', 'COMINHNGUYET', 'STUDYHARD'];
  const isValid = validCodes.includes(code.toUpperCase());

  if (!isValid) {
    if (msgEl) {
      msgEl.className = 'teacher-unlock-msg error';
      msgEl.textContent = '❌ Mã xác nhận không đúng! Vui lòng nhờ Giáo viên nhập mã.';
      msgEl.style.display = 'block';
    }
    codeInput.select();
    codeInput.focus();
    return;
  }

  // Teacher unlocked successfully
  const studentName = sessionStorage.getItem('current_user_name') || localStorage.getItem('vstep_locked_student_name') || 'Học viên';
  const studentClass = sessionStorage.getItem('current_user_class') || localStorage.getItem('vstep_locked_student_class') || '';

  // Clear locks
  localStorage.removeItem(getStudentLockKey(studentName));
  localStorage.removeItem('vstep_is_account_locked');
  localStorage.removeItem('vstep_locked_student_name');
  localStorage.removeItem('vstep_locked_student_class');
  sessionStorage.removeItem('vstep_session_locked');

  // Reset violation count
  cheatViolationCount = 0;

  if (msgEl) {
    msgEl.className = 'teacher-unlock-msg success';
    msgEl.textContent = '✅ Mở khóa thành công! Đang khôi phục quyền truy cập...';
    msgEl.style.display = 'block';
  }

  // Send unlock event to Google Forms
  const nowVi = new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
  sendTrackingReport(`[MỞ KHÓA BỞI GIÁO VIÊN] ${studentName} - Lớp ${studentClass} - Giáo viên đã mở khóa tài khoản lúc ${nowVi}`);

  setTimeout(() => {
    const modal = document.getElementById('cheat-warning-modal');
    if (modal) modal.style.display = 'none';

    // If currently at Access Gateway, show success indicator
    const gateway = document.getElementById('access-gateway');
    if (gateway && gateway.style.display === 'flex') {
      const errorEl = document.getElementById('gateway-error');
      if (errorEl) {
        errorEl.textContent = 'Tài khoản đã được Giáo viên mở khóa thành công! Bạn có thể bấm BẮT ĐẦU HỌC NGAY.';
        errorEl.style.color = '#10B981';
        errorEl.style.display = 'block';
      }
    } else {
      // In workspace: resume timer if writing
      if (currentScreen === 'workspace' && currentStepKey === 'write' && !hasSubmitted) {
        startTimer();
        const textarea = document.getElementById('essay-textarea');
        if (textarea) textarea.focus();
      }
    }

    showToast(`🔓 Giáo viên đã MỞ KHÓA TÀI KHOẢN thành công cho ${studentName}!`, 'success');
  }, 800);
}

function handleCheatViolation(reason) {
  const studentName = sessionStorage.getItem('current_user_name') || 'Học viên';
  const studentClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  if (studentClass === 'GV' || studentClass === 'TEACHER' || studentClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(studentName, studentClass, ''))) {
    return; // Teachers have zero restrictions
  }
  if (!isExamModeActive() || isPromptingUser) return;
  const now = Date.now();
  if (now - lastCheatAlertTime < 2500) return; // Debounce alerts
  lastCheatAlertTime = now;
  cheatViolationCount++;
  if (reason === 'paste') {
    cheatPasteCount++;
  } else {
    cheatTabSwitchCount++;
  }
  sessionTracking.totalCheats++;

  if (cheatViolationCount >= 3) {
    lockCurrentAccount(reason);
    return;
  }

  // Report violation immediately to Google Forms (violation 3 for students is reported by lockCurrentAccount)
  const topicTitle = (currentTopic && currentTopic.title_en) || 'Task 2 Essay';
  const nowVi = new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
  const reasonText = formatCheatReasonText(reason);
  const { totalElapsed } = getSessionDurations();
  const prefix = isTeacher ? '[GIÁO VIÊN TEST] ' : '';
  sendTrackingReport(`${prefix}[VI PHẠM GIAN LẬN LẦN ${String(cheatViolationCount).padStart(2, '0')}/3] ${studentName} - Lớp ${studentClass} - Đề: ${topicTitle} - Hành vi: ${reasonText} - Tổng số lần gian lận: ${cheatViolationCount} - Tổng gian lận phiên: ${sessionTracking.totalCheats} - Ở web: ${formatDurationVi(totalElapsed)} lúc ${nowVi}`);

  const modal = document.getElementById('cheat-warning-modal');
  const countBadge = document.getElementById('cheat-warning-count');
  const title = document.getElementById('cheat-warning-title');
  const desc = document.getElementById('cheat-warning-desc');
  const btnContinue = document.getElementById('cheat-btn-continue');
  const unlockBox = document.getElementById('teacher-unlock-container');
  const icon = document.getElementById('cheat-modal-icon');

  if (icon) icon.textContent = '⚠️';
  if (countBadge) {
    countBadge.textContent = cheatViolationCount === 1 
      ? 'CẢNH BÁO VI PHẠM (LẦN 1/3)' 
      : 'CẢNH BÁO NGUY HIỂM (LẦN 2/3)';
    countBadge.style.background = 'rgba(239, 68, 68, 0.12)';
    countBadge.style.color = '#ef4444';
    countBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
  }
  if (title) {
    title.textContent = cheatViolationCount === 1 
      ? 'PHÁT HIỆN RỜI KHỎI PHÒNG THI!' 
      : 'CẢNH BÁO VI PHẠM LẦN 02!';
    title.style.color = '#ef4444';
  }

  if (desc) {
    let reasonText = (reason === 'paste')
      ? 'Phòng thi KHÔNG CHO PHÉP DÁN (PASTE) nội dung từ bên ngoài. Vui lòng tự gõ bài viết để rèn luyện kỹ năng thực tế!'
      : 'Hệ thống phát hiện bạn vừa chuyển tab hoặc rời khỏi cửa sổ phòng thi. Mọi vi phạm đều được ghi nhận vào kết quả làm bài.';
    
    let penaltyWarning = (cheatViolationCount === 1)
      ? '<div style="margin-top: 0.75rem; color: #ef4444; font-weight: 700;">⚠️ CHÚ Ý: Nếu vi phạm đến LẦN 03, tài khoản sẽ bị TẠM KHÓA cho đến khi Giáo viên cho phép mở lại!</div>'
      : '<div style="margin-top: 0.75rem; color: #dc2626; font-weight: 800; font-size: 0.98rem;">🚨 CẢNH BÁO CUỐI CÙNG: Nếu vi phạm thêm 01 LẦN NỮA (Lần 3), TÀI KHOẢN CỦA BẠN SẼ BỊ TẠM KHÓA NGAY LẬP TỨC!</div>';

    desc.innerHTML = reasonText + penaltyWarning;
  }

  if (btnContinue) {
    btnContinue.style.display = 'block';
    btnContinue.textContent = cheatViolationCount === 1
      ? 'TÔI HIỂU VÀ TIẾP TỤC LÀM BÀI'
      : 'TÔI CAM KẾT KHÔNG TÁI PHẠM VÀ TIẾP TỤC';
  }
  if (unlockBox) unlockBox.style.display = 'none';

  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeCheatWarningModal() {
  if (isCurrentStudentLocked()) {
    return; // Cannot dismiss if locked
  }
  const modal = document.getElementById('cheat-warning-modal');
  if (modal) modal.style.display = 'none';
  const textarea = document.getElementById('essay-textarea');
  if (textarea) textarea.focus();
}

// --- Export Student Essay & Comprehensive Analysis Report (PDF / DOC) ---
function downloadStudentEssay(format = 'pdf') {
  isPromptingUser = true;
  setTimeout(() => { isPromptingUser = false; }, 500);

  const studentName = sessionStorage.getItem('current_user_name') || 'Học viên';
  const studentClass = sessionStorage.getItem('current_user_class') || 'Chưa xác định';
  const topicId = currentTopic ? currentTopic.id : '';
  const topicTitleEn = currentTopic ? currentTopic.title_en : 'VSTEP Writing Task 2';
  const topicTitleVi = currentTopic ? currentTopic.title_vi : '';
  const topicCategory = currentCategory ? currentCategory.title_vi : '';
  
  let promptText = '';
  if (currentTopic) {
    promptText = currentTopic.context ? `${currentTopic.context}\n\n${currentTopic.prompt}` : (currentTopic.prompt || '');
  }
  let promptVi = '';
  if (typeof getPromptTranslation === 'function' && currentTopic && currentCategory) {
    try {
      promptVi = getPromptTranslation(currentTopic, currentCategory) || '';
    } catch (e) {}
  }
  
  let essayContent = '';
  if (hasSubmitted && currentEvaluationData && currentEvaluationData.text) {
    essayContent = currentEvaluationData.text;
  } else {
    essayContent = document.getElementById('essay-textarea') ? document.getElementById('essay-textarea').value : '';
  }
  
  if (!essayContent.trim()) {
    showToast("⚠️ Bài viết đang trống, chưa có nội dung để xuất file!", "warning");
    return;
  }
  
  const trimmed = essayContent.trim();
  const wordCount = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  const now = new Date();
  const dateStr = now.toLocaleDateString('vi-VN') + ' ' + now.toLocaleTimeString('vi-VN');
  
  const safeStudent = (studentName || 'HocVien').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  const safeTopic = (topicTitleEn || 'BaiLuan').slice(0, 30).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `BaoCao_VSTEP_Task2_${safeStudent}_${safeTopic}`;

  const evalData = (hasSubmitted && currentEvaluationData) ? currentEvaluationData : null;

  if (format === 'doc') {
    exportEssayAsDoc(studentName, studentClass, topicCategory, topicTitleEn, promptText, essayContent, wordCount, dateStr, evalData, filename);
    return;
  }

  exportEssayAsPdf(studentName, studentClass, topicCategory, topicId, topicTitleEn, topicTitleVi, promptText, promptVi, essayContent, wordCount, dateStr, evalData, filename);
}

function exportEssayAsDoc(studentName, studentClass, topicCategory, topicTitle, promptText, essayContent, wordCount, dateStr, evalData, filename) {
  let docHtml = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${escapeHtml(filename)}</title>
      <style>
        body { font-family: 'Times New Roman', Times, serif; font-size: 13pt; line-height: 1.6; color: #111827; margin: 1in; }
        h1 { font-size: 18pt; text-align: center; color: #1e3a8a; margin-bottom: 4pt; text-transform: uppercase; }
        .header-sub { text-align: center; font-size: 11pt; color: #4b5563; margin-bottom: 20pt; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
        .info-table td { padding: 6pt 10pt; font-size: 11pt; border: 1px solid #d1d5db; }
        .info-label { background-color: #f3f4f6; font-weight: bold; width: 25%; color: #374151; }
        .section-heading { font-size: 13pt; font-weight: bold; color: #1e40af; border-bottom: 1.5pt solid #2563eb; padding-bottom: 4pt; margin-top: 18pt; margin-bottom: 10pt; text-transform: uppercase; }
        .prompt-box { background-color: #f8fafc; border-left: 4pt solid #3b82f6; padding: 10pt 14pt; font-style: italic; font-size: 12pt; line-height: 1.5; margin-bottom: 16pt; }
        .essay-body { font-size: 13pt; line-height: 1.8; text-align: justify; white-space: pre-wrap; margin-bottom: 25pt; background: #ffffff; }
        .score-box { background-color: #f0fdf4; border: 1px solid #86efac; padding: 12pt; border-radius: 6pt; margin-top: 15pt; }
        .score-table { width: 100%; border-collapse: collapse; margin-top: 10pt; }
        .score-table th, .score-table td { border: 1px solid #cbd5e1; padding: 6pt 10pt; text-align: left; font-size: 11pt; }
        .score-table th { background-color: #e2e8f0; font-weight: bold; }
        .footer-note { margin-top: 30pt; font-size: 10pt; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8pt; }
      </style>
    </head>
    <body>
      <h1>BÀI LÀM LUYỆN THI VSTEP WRITING TASK 2</h1>
      <div class="header-sub">HỆ THỐNG LUYỆN VIẾT VSTEP ESSAY MASTER • ENGLISH WITH MISS NGUYET</div>
      <table class="info-table">
        <tr>
          <td class="info-label">Họ và tên học viên:</td>
          <td><strong>${escapeHtml(studentName)}</strong></td>
          <td class="info-label">Lớp:</td>
          <td><strong>${escapeHtml(studentClass)}</strong></td>
        </tr>
        <tr>
          <td class="info-label">Chủ đề bài viết:</td>
          <td colspan="3">${escapeHtml(topicCategory)} - <strong>${escapeHtml(topicTitle)}</strong></td>
        </tr>
        <tr>
          <td class="info-label">Thời gian xuất bài:</td>
          <td>${dateStr}</td>
          <td class="info-label">Tổng số từ:</td>
          <td><strong>${wordCount} từ</strong> ${wordCount >= 250 ? '(Đạt yêu cầu tối thiểu 250 từ)' : '(Chưa đạt 250 từ)'}</td>
        </tr>
      </table>
      <div class="section-heading">1. ĐỀ BÀI (WRITING PROMPT)</div>
      <div class="prompt-box">${escapeHtml(promptText).replace(/\n/g, '<br>')}</div>
      <div class="section-heading">2. BÀI LUẬN CỦA HỌC VIÊN (STUDENT'S ESSAY)</div>
      <div class="essay-body">${escapeHtml(essayContent)}</div>
  `;

  if (evalData) {
    const cefr = evalData.score >= 8.5 ? 'C1 (Advanced)' : evalData.score >= 6.5 ? 'B2 (Upper-Intermediate)' : evalData.score >= 4.0 ? 'B1 (Intermediate)' : 'Dưới B1';
    docHtml += `
      <div class="section-heading">3. KẾT QUẢ ĐÁNH GIÁ & CHẤM ĐIỂM CHI TIẾT</div>
      <div class="score-box">
        <p style="margin: 0 0 6pt 0; font-size: 13pt;"><strong>Điểm tổng (Thang 10):</strong> <span style="font-size: 16pt; color: #15803d; font-weight: bold;">${evalData.score}/10.0</span> • <strong>Quy đổi Task 2 (Thang 7.0):</strong> <span style="font-size: 14pt; color: #0284c7; font-weight: bold;">${((evalData.score * 7) / 10).toFixed(1)}/7.0</span> - Trình độ: <strong>${cefr}</strong></p>
        <table class="score-table">
          <tr><th>Tiêu chí chấm VSTEP</th><th>Điểm</th><th>Trọng số</th></tr>
          <tr><td>Task Fulfillment (Đáp ứng yêu cầu đề bài)</td><td><strong>${evalData.tfScore != null ? evalData.tfScore : '-'}/10.0</strong></td><td>25%</td></tr>
          <tr><td>Organization (Bố cục, mạch lạc & liên kết ý)</td><td><strong>${evalData.orgScore != null ? evalData.orgScore : '-'}/10.0</strong></td><td>25%</td></tr>
          <tr><td>Vocabulary (Vốn từ & Collocations)</td><td><strong>${evalData.vocabScore != null ? evalData.vocabScore : '-'}/10.0</strong></td><td>25%</td></tr>
          <tr><td>Grammar (Cấu trúc ngữ pháp & độ chính xác)</td><td><strong>${evalData.grammarScore != null ? evalData.grammarScore : '-'}/10.0</strong></td><td>25%</td></tr>
        </table>
        ${evalData.feedback ? `<div style="margin-top: 10pt;"><strong>Nhận xét tổng quan:</strong><p style="margin: 4pt 0 0 0;">${escapeHtml(evalData.feedback)}</p></div>` : ''}
      </div>
    `;
  }

  docHtml += `<div class="footer-note">Tài liệu được xuất tự động từ hệ thống Luyện viết luận VSTEP Task 2 • Giáo viên hướng dẫn: Ms. Nguyệt</div></body></html>`;

  const blob = new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' });
  const downloadLink = document.createElement('a');
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.download = `${filename}.doc`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadLink.href);

  showToast("📥 Đã tải file bài viết (.doc) thành công!", "success");
}

function exportEssayAsPdf(studentName, studentClass, topicCategory, topicId, topicTitleEn, topicTitleVi, promptText, promptVi, essayContent, wordCount, dateStr, evalData, filename) {
  let scoreBadgeHtml = '';
  let criteriaCardsHtml = '';
  let calibrationsHtml = '';
  let errorSummaryHtml = '';
  let sentenceBreakdownHtml = '';
  let vocabMatchesHtml = '';
  let modelEssayHtml = '';

  if (evalData) {
    const score = evalData.score || 0;
    const scoreConverted = ((score * 7) / 10).toFixed(1);
    const scoreRatio = ((score * 2) / 3).toFixed(1);
    const cefr = score >= 8.5 ? 'C1 (Advanced - Xuất sắc)' : score >= 6.5 ? 'B2 (Upper-Intermediate - Đạt chuẩn B2)' : score >= 6.0 ? 'B1 (Vượt chuẩn B1)' : score >= 4.0 ? 'B1 (Đạt chuẩn B1)' : 'Chưa đạt chuẩn B1';

    scoreBadgeHtml = `
      <div class="score-summary-card">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 8px;">
          <div>
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #166534; letter-spacing: 0.5px;">KẾT QUẢ ĐÁNH GIÁ ƯỚC LƯỢNG VSTEP TASK 2</span>
            <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px;">Trình độ: <span style="color: #2563eb;">${escapeHtml(cefr)}</span></div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <div style="background: #ffffff; border: 1.5px solid #2563eb; border-radius: 8px; padding: 4px 12px; text-align: center;">
              <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748b;">Thang điểm 10</div>
              <div style="font-size: 16px; font-weight: 900; color: #2563eb;">${score.toFixed(1)} <span style="font-size: 11px; font-weight: 600; color: #94a3b8;">/ 10</span></div>
            </div>
            <div style="background: #ffffff; border: 1.5px solid #10b981; border-radius: 8px; padding: 4px 12px; text-align: center;">
              <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748b;">Quy đổi Task 2</div>
              <div style="font-size: 16px; font-weight: 900; color: #059669;">${scoreConverted} <span style="font-size: 11px; font-weight: 600; color: #94a3b8;">/ 7.0</span></div>
            </div>
            <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 4px 10px; text-align: center;">
              <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748b;">Tỷ trọng 2/3 bài thi</div>
              <div style="font-size: 13px; font-weight: 800; color: #475569;">${scoreRatio} <span style="font-size: 10px; font-weight: 500; color: #94a3b8;">/ 6.7</span></div>
            </div>
          </div>
        </div>
        ${evalData.feedback ? `
          <div style="background: #ffffff; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 12px; font-size: 12px; line-height: 1.5; color: #1e293b; margin-top: 6px;">
            <strong>Nhận xét tổng quan:</strong> ${escapeHtml(evalData.feedback)}
          </div>
        ` : ''}
      </div>
    `;

    // 4 Criteria
    const tf = evalData.tfScore != null ? evalData.tfScore.toFixed(1) : '-';
    const org = evalData.orgScore != null ? evalData.orgScore.toFixed(1) : '-';
    const voc = evalData.vocabScore != null ? evalData.vocabScore.toFixed(1) : '-';
    const gra = evalData.grammarScore != null ? evalData.grammarScore.toFixed(1) : '-';

    criteriaCardsHtml = `
      <div class="section-title">📊 ĐÁNH GIÁ CHI TIẾT THEO 4 TIÊU CHÍ VSTEP TASK 2</div>
      <div class="criteria-grid">
        <div class="criteria-card">
          <div class="criteria-header">
            <span class="criteria-title">1. Task Fulfillment (TF)</span>
            <span class="criteria-score">${tf} / 10</span>
          </div>
          <p class="criteria-comment">${escapeHtml(evalData.commentTF || 'Độ dài và khả năng phát triển luận điểm.')}</p>
        </div>
        <div class="criteria-card">
          <div class="criteria-header">
            <span class="criteria-title">2. Organization (ORG)</span>
            <span class="criteria-score">${org} / 10</span>
          </div>
          <p class="criteria-comment">${escapeHtml(evalData.commentORG || 'Bố cục bài viết, tính liên kết câu và đoạn văn.')}</p>
        </div>
        <div class="criteria-card">
          <div class="criteria-header">
            <span class="criteria-title">3. Lexical Resource (VOCAB)</span>
            <span class="criteria-score">${voc} / 10</span>
          </div>
          <p class="criteria-comment">${escapeHtml(evalData.commentVocab || 'Vốn từ vựng học thuật, độ chính xác và collocations.')}</p>
        </div>
        <div class="criteria-card">
          <div class="criteria-header">
            <span class="criteria-title">4. Grammar & Accuracy (GRA)</span>
            <span class="criteria-score">${gra} / 10</span>
          </div>
          <p class="criteria-comment">${escapeHtml(evalData.commentGrammar || 'Độ chính xác ngữ pháp, câu phức và kiểm soát lỗi.')}</p>
        </div>
      </div>
    `;

    // Calibrations
    const calibs = [];
    if (evalData.wordCountCapTriggered && evalData.wordCountCapReason) {
      calibs.push(`<div style="background: #fffbeb; border-left: 3.5px solid #f59e0b; padding: 6px 10px; margin-bottom: 6px; font-size: 11.5px; color: #92400e;"><strong>Giới hạn dung lượng từ:</strong> ${escapeHtml(evalData.wordCountCapReason)}</div>`);
    }
    if (evalData.holisticCapTriggered && evalData.holisticCapReason) {
      calibs.push(`<div style="background: #faf5ff; border-left: 3.5px solid #8b5cf6; padding: 6px 10px; margin-bottom: 6px; font-size: 11.5px; color: #6b21a8;"><strong>Chuẩn năng lực toàn diện VSTEP (Holistic Requirement):</strong> ${escapeHtml(evalData.holisticCapReason)}</div>`);
    }
    if (evalData.frequentLanguageControlIssues) {
      calibs.push(`<div style="background: #fef2f2; border-left: 3.5px solid #ef4444; padding: 6px 10px; margin-bottom: 6px; font-size: 11.5px; color: #991b1b;"><strong>Hiệu chuẩn kiểm soát ngôn ngữ:</strong> Bài viết xuất hiện lỗi ngữ pháp/từ vựng hệ thống lặp lại, điểm số được điều chỉnh phản ánh đúng chuẩn kiểm soát thực tế.</div>`);
    }
    if (calibs.length > 0) {
      calibrationsHtml = `
        <div class="section-title">⚠️ THÔNG BÁO HIỆU CHUẨN ĐIỂM KHẢO THÍ (BAND CALIBRATION)</div>
        <div style="margin-bottom: 14px; page-break-inside: avoid;">${calibs.join('')}</div>
      `;
    }

    // Error summary table
    const gCount = evalData.totalGrammarErrors || 0;
    const vCount = evalData.totalVocabErrors || 0;
    const cCount = evalData.totalCollocErrors || 0;
    const sCount = evalData.totalStructureErrors || 0;
    const gSum = evalData.gSum || { severity: gCount > 3 ? 'Serious' : gCount > 1 ? 'Moderate' : gCount > 0 ? 'Minor' : 'None', effect: gCount > 0 ? 'Ảnh hưởng ngữ pháp' : 'Không ảnh hưởng' };
    const vSum = evalData.vSum || { severity: vCount > 3 ? 'Serious' : vCount > 1 ? 'Moderate' : vCount > 0 ? 'Minor' : 'None', effect: vCount > 0 ? 'Ảnh hưởng từ vựng' : 'Không ảnh hưởng' };
    const cSum = evalData.cSum || { severity: cCount > 2 ? 'Serious' : cCount > 0 ? 'Moderate' : 'None', effect: cCount > 0 ? 'Hạn chế tự nhiên' : 'Không ảnh hưởng' };
    const sSum = evalData.sSum || { severity: sCount > 3 ? 'Serious' : sCount > 0 ? 'Moderate' : 'None', effect: sCount > 0 ? 'Ảnh hưởng mạch lạc' : 'Không ảnh hưởng' };

    errorSummaryHtml = `
      <div class="section-title">🔍 BẢNG TỔNG HỢP LỖI SAI (ERROR CATEGORY SUMMARY)</div>
      <table class="error-table">
        <thead>
          <tr>
            <th style="width: 32%;">Phân loại lỗi</th>
            <th style="width: 18%; text-align: center;">Số lượng lỗi</th>
            <th style="width: 20%; text-align: center;">Mức độ nghiêm trọng</th>
            <th style="width: 30%;">Ảnh hưởng đến điểm B1/B2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Grammar</strong> (Ngữ pháp, Dạng từ, Giới từ)</td>
            <td style="text-align: center; font-weight: 700; color: ${gCount > 0 ? '#dc2626' : '#16a34a'};">${gCount}</td>
            <td style="text-align: center;"><span class="err-badge" style="background: ${gSum.severity === 'Serious' ? '#fee2e2' : gSum.severity === 'Moderate' ? '#fef3c7' : gSum.severity === 'Minor' ? '#e0f2fe' : '#dcfce7'}; color: ${gSum.severity === 'Serious' ? '#dc2626' : gSum.severity === 'Moderate' ? '#d97706' : gSum.severity === 'Minor' ? '#0284c7' : '#15803d'};">${gSum.severity}</span></td>
            <td style="color: #475569; font-size: 11px;">${escapeHtml(gSum.effect)}</td>
          </tr>
          <tr>
            <td><strong>Vocabulary</strong> (Chính tả, Dùng từ)</td>
            <td style="text-align: center; font-weight: 700; color: ${vCount > 0 ? '#dc2626' : '#16a34a'};">${vCount}</td>
            <td style="text-align: center;"><span class="err-badge" style="background: ${vSum.severity === 'Serious' ? '#fee2e2' : vSum.severity === 'Moderate' ? '#fef3c7' : vSum.severity === 'Minor' ? '#e0f2fe' : '#dcfce7'}; color: ${vSum.severity === 'Serious' ? '#dc2626' : vSum.severity === 'Moderate' ? '#d97706' : vSum.severity === 'Minor' ? '#0284c7' : '#15803d'};">${vSum.severity}</span></td>
            <td style="color: #475569; font-size: 11px;">${escapeHtml(vSum.effect)}</td>
          </tr>
          <tr>
            <td><strong>Collocation</strong> (Từ ghép tự nhiên)</td>
            <td style="text-align: center; font-weight: 700; color: ${cCount > 0 ? '#dc2626' : '#16a34a'};">${cCount}</td>
            <td style="text-align: center;"><span class="err-badge" style="background: ${cSum.severity === 'Serious' ? '#fee2e2' : cSum.severity === 'Moderate' ? '#fef3c7' : '#dcfce7'}; color: ${cSum.severity === 'Serious' ? '#dc2626' : cSum.severity === 'Moderate' ? '#d97706' : '#15803d'};">${cSum.severity}</span></td>
            <td style="color: #475569; font-size: 11px;">${escapeHtml(cSum.effect)}</td>
          </tr>
          <tr>
            <td><strong>Sentence Structure</strong> (Cấu trúc, Dấu câu)</td>
            <td style="text-align: center; font-weight: 700; color: ${sCount > 0 ? '#dc2626' : '#16a34a'};">${sCount}</td>
            <td style="text-align: center;"><span class="err-badge" style="background: ${sSum.severity === 'Serious' ? '#fee2e2' : sSum.severity === 'Moderate' ? '#fef3c7' : '#dcfce7'}; color: ${sSum.severity === 'Serious' ? '#dc2626' : sSum.severity === 'Moderate' ? '#d97706' : '#15803d'};">${sSum.severity}</span></td>
            <td style="color: #475569; font-size: 11px;">${escapeHtml(sSum.effect)}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Sentence by sentence breakdown
    if (evalData.sentenceAnalysisList && evalData.sentenceAnalysisList.length > 0) {
      const sentenceItemsHtml = evalData.sentenceAnalysisList.map((item, idx) => {
        if (item.hasError && item.errors && item.errors.length > 0) {
          const errListHtml = item.errors.map(err => `
            <tr style="border-bottom: 1px dashed #fca5a5;">
              <td style="padding: 4px 6px; color: #dc2626; font-weight: 700; width: 25%;">Sai: '${escapeHtml(err.incorrect)}'</td>
              <td style="padding: 4px 6px; color: #16a34a; font-weight: 700; width: 25%;">Sửa: '${escapeHtml(err.correction)}'</td>
              <td style="padding: 4px 6px; color: #64748b; font-size: 10.5px; width: 20%;">${escapeHtml(err.errorType)}</td>
              <td style="padding: 4px 6px; color: #334155; font-size: 11px;">${escapeHtml(err.explanation)}</td>
            </tr>
          `).join('');

          return `
            <div class="sentence-card has-error">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <strong style="color: #991b1b; font-size: 11.5px;">Câu ${idx + 1}:</strong>
                <span class="err-badge" style="background: #fee2e2; color: #dc2626;">⚠️ Phát hiện ${item.errors.length} lỗi</span>
              </div>
              <div style="font-style: italic; color: #1e293b; margin-bottom: 6px; line-height: 1.45; font-size: 12px;">"${escapeHtml(item.sentence)}"</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 11px; background: #ffffff; border: 1px solid #fee2e2; border-radius: 4px;">
                ${errListHtml}
              </table>
            </div>
          `;
        } else {
          return `
            <div class="sentence-card error-free">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: #166534; font-size: 11.5px;">Câu ${idx + 1}:</strong>
                <span class="err-badge" style="background: #dcfce7; color: #15803d;">✓ Sạch lỗi (Error-free)</span>
              </div>
              <div style="font-style: italic; color: #334155; margin-top: 3px; line-height: 1.45; font-size: 12px;">"${escapeHtml(item.sentence)}"</div>
            </div>
          `;
        }
      }).join('');

      sentenceBreakdownHtml = `
        <div class="section-title">📝 BÁO CÁO PHÂN TÍCH CHI TIẾT TỪNG CÂU & SỬA LỖI</div>
        <div style="margin-bottom: 16px;">${sentenceItemsHtml}</div>
      `;
    }

    // Collocations matches
    const matchContainer = document.getElementById('ws-vocab-match-container');
    if (matchContainer && matchContainer.children.length > 0) {
      const matched = Array.from(matchContainer.querySelectorAll('.vocab-match-item.matched')).map(el => el.innerText.trim());
      if (matched.length > 0) {
        vocabMatchesHtml = `
          <div class="section-title">📚 COLLOCATIONS TIÊU CHUẨN ĐÃ ÁP DỤNG (${matched.length})</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; page-break-inside: avoid;">
            ${matched.map(m => `<span style="background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">✓ ${escapeHtml(m)}</span>`).join('')}
          </div>
        `;
      }
    }

    // Model essay
    if (currentTopic && currentTopic.details) {
      const sampleText = (currentSampleLevel === 'B2' ? currentTopic.details.sample_b2 : currentTopic.details.sample_b1) || currentTopic.details.sample_b1 || currentTopic.details.sample_b2 || '';
      if (sampleText) {
        modelEssayHtml = `
          <div class="section-title">📘 BÀI LUẬN MẪU THAM KHẢO CHUẨN (${escapeHtml(currentSampleLevel || 'B1')})</div>
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 14px; font-size: 12px; line-height: 1.7; color: #1e293b; text-align: justify; white-space: pre-wrap; margin-bottom: 16px; page-break-inside: avoid;">${sampleText}</div>
        `;
      }
    }
  } else {
    scoreBadgeHtml = `
      <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; color: #92400e;">
        ⚠️ <em>Bài viết hiện đang trong quá trình soạn thảo (Chưa nộp bài chấm điểm). Báo cáo phân tích chi tiết sẽ được tự động tạo sau khi học viên nộp bài.</em>
      </div>
    `;
  }

  const pdfHtml = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(filename)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm 12mm 14mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 12.5px; line-height: 1.55; color: #1e293b; background: #f1f5f9; margin: 0; padding: 0; }
    @media print {
      body { background: #ffffff !important; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    .pdf-container { max-width: 820px; margin: 0 auto; background: #ffffff; padding: 22px 28px; }
    @media screen {
      .pdf-container { margin: 20px auto; box-shadow: 0 4px 24px rgba(0,0,0,0.1); border-radius: 8px; }
    }
    .top-bar-print { position: sticky; top: 0; z-index: 9999; background: #0f172a; color: #ffffff; padding: 10px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
    .header-banner { border-bottom: 2.5px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .brand-title { font-size: 11px; font-weight: 800; letter-spacing: 0.8px; color: #2563eb; text-transform: uppercase; }
    .report-main-title { font-size: 16.5px; font-weight: 800; color: #0f172a; margin: 4px 0 2px 0; text-transform: uppercase; letter-spacing: 0.3px; }
    .report-subtitle { font-size: 11.5px; color: #64748b; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; page-break-inside: avoid; }
    .meta-table td { padding: 6px 10px; border: 1px solid #e2e8f0; }
    .meta-label { background: #f1f5f9; font-weight: 700; color: #475569; width: 22%; }
    .section-title { font-size: 12.5px; font-weight: 800; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin: 18px 0 8px 0; display: flex; align-items: center; gap: 6px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; page-break-after: avoid; }
    .prompt-box { background: #f8fafc; border-left: 4px solid #3b82f6; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 12px; line-height: 1.6; color: #1e293b; margin-bottom: 14px; page-break-inside: avoid; }
    .essay-box { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px 18px; font-size: 13px; line-height: 1.8; text-align: justify; color: #0f172a; white-space: pre-wrap; margin-bottom: 16px; }
    .score-summary-card { background: linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%); border: 1.5px solid #86efac; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; page-break-inside: avoid; }
    .criteria-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; page-break-inside: avoid; }
    .criteria-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; page-break-inside: avoid; }
    .criteria-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .criteria-title { font-weight: 800; font-size: 11.5px; text-transform: uppercase; color: #0f172a; }
    .criteria-score { font-weight: 800; font-size: 13px; color: #2563eb; }
    .criteria-comment { font-size: 11px; color: #475569; line-height: 1.45; margin: 0; }
    .error-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11.5px; page-break-inside: avoid; }
    .error-table th, .error-table td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
    .error-table th { background: #f1f5f9; font-weight: 700; color: #475569; }
    .sentence-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; background: #ffffff; page-break-inside: avoid; font-size: 12px; }
    .sentence-card.has-error { border-left: 3.5px solid #ef4444; background: #fef2f2; }
    .sentence-card.error-free { border-left: 3.5px solid #10b981; background: #f0fdf4; }
    .err-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
    .signature-row { display: flex; justify-content: space-between; margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; page-break-inside: avoid; }
    .sig-col { text-align: center; width: 40%; font-size: 12px; }
  </style>
</head>
<body>
  <!-- Print control bar (hidden in actual print / PDF) -->
  <div class="top-bar-print no-print">
    <div style="font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px;">
      <span>📄 BÁO CÁO KẾT QUẢ BÀI VIẾT & CHẤM ĐIỂM VSTEP TASK 2</span>
    </div>
    <div style="display: flex; gap: 10px;">
      <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 7px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13px;">
        🖨️ In bài / Lưu thành PDF
      </button>
      <button onclick="window.close()" style="background: rgba(255,255,255,0.15); color: #fff; border: none; padding: 7px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;">
        ✕ Đóng
      </button>
    </div>
  </div>

  <div class="pdf-container">
    <!-- Header -->
    <div class="header-banner">
      <div>
        <div class="brand-title">ENGLISH WITH MISS NGUYET • VSTEP ESSAY MASTER</div>
        <div class="report-main-title">BÁO CÁO PHÂN TÍCH KẾT QUẢ BÀI VIẾT VSTEP TASK 2</div>
        <div class="report-subtitle">Hệ thống khảo thí & phân tích năng lực viết luận chuẩn khung VSTEP B1 - B2</div>
      </div>
      <div style="text-align: right; font-size: 11px; color: #64748b;">
        <div>Ngày xuất: <strong>${dateStr}</strong></div>
        <div style="margin-top: 3px;"><span style="color: #16a34a; font-weight: 700;">Double-Review Pass ✓</span></div>
      </div>
    </div>

    <!-- Meta Information -->
    <table class="meta-table">
      <tr>
        <td class="meta-label">Học viên:</td>
        <td><strong>${escapeHtml(studentName)}</strong></td>
        <td class="meta-label">Lớp học:</td>
        <td><strong>${escapeHtml(studentClass)}</strong></td>
      </tr>
      <tr>
        <td class="meta-label">Dạng bài luận:</td>
        <td colspan="3">${escapeHtml(topicCategory)} - <strong>Đề ${escapeHtml(String(topicId))}: ${escapeHtml(topicTitleEn)}</strong> ${topicTitleVi ? `(${escapeHtml(topicTitleVi)})` : ''}</td>
      </tr>
      <tr>
        <td class="meta-label">Độ dài bài viết:</td>
        <td><strong>${wordCount} từ</strong> ${wordCount >= 250 ? '<span style="color: #16a34a; font-weight: 700;">(Đạt chuẩn ≥ 250 từ)</span>' : '<span style="color: #dc2626; font-weight: 700;">(Chưa đạt 250 từ)</span>'}</td>
        <td class="meta-label">Giám sát phòng thi:</td>
        <td>${cheatViolationCount > 0 ? `<span style="color: #dc2626; font-weight: 700;">Ghi nhận ${cheatViolationCount} lần rời phòng thi</span>` : '<span style="color: #16a34a; font-weight: 700;">Hoàn thành nghiêm túc (0 vi phạm)</span>'}</td>
      </tr>
    </table>

    <!-- 1. Writing Prompt -->
    <div class="section-title">1. ĐỀ BÀI (WRITING PROMPT & CONTEXT)</div>
    <div class="prompt-box">
      <div style="white-space: pre-wrap; font-weight: 500;">${escapeHtml(promptText)}</div>
      ${promptVi ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 11.5px; color: #475569;"><strong>Dịch nghĩa đề bài:</strong> ${promptVi}</div>` : ''}
    </div>

    <!-- 2. Student Essay -->
    <div class="section-title">2. BÀI LUẬN CỦA HỌC VIÊN (STUDENT'S ESSAY)</div>
    <div class="essay-box">${escapeHtml(essayContent)}</div>

    <!-- 3. Overall Score -->
    ${scoreBadgeHtml}

    <!-- 4. 4 Criteria -->
    ${criteriaCardsHtml}

    <!-- 5. Calibrations -->
    ${calibrationsHtml}

    <!-- 6. Error Summary -->
    ${errorSummaryHtml}

    <!-- 7. Sentence Breakdown -->
    ${sentenceBreakdownHtml}

    <!-- 8. Vocab Matches -->
    ${vocabMatchesHtml}

    <!-- 9. Model Essay -->
    ${modelEssayHtml}

    <!-- 10. Signatures -->
    <div class="signature-row">
      <div class="sig-col">
        <strong>HỌC VIÊN THỰC HIỆN</strong>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">(Ký và ghi rõ họ tên)</div>
        <div style="margin-top: 45px; font-weight: 700; color: #1e293b;">${escapeHtml(studentName)}</div>
      </div>
      <div class="sig-col">
        <strong>GIÁO VIÊN HƯỚNG DẪN</strong>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">(Xác nhận kết quả khảo thí)</div>
        <div style="margin-top: 45px; font-weight: 800; color: #2563eb;">ENGLISH WITH MISS NGUYET</div>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        try { window.print(); } catch(e) {}
      }, 450);
    });
  </script>
</body>
</html>
  `;

  // Open in printable window with iframe fallback
  let printWindow = null;
  try {
    printWindow = window.open('', '_blank');
  } catch (err) {}

  if (printWindow && !printWindow.closed) {
    printWindow.document.open();
    printWindow.document.write(pdfHtml);
    printWindow.document.close();
    printWindow.focus();
  } else {
    // Popup fallback: use hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(pdfHtml);
    iframe.contentDocument.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch(e) {}
      }, 3000);
    }, 600);
  }

  showToast("📄 Đang xuất báo cáo PDF... Vui lòng chọn 'Lưu dưới dạng PDF' (Save as PDF)!", "success");
}


// Switch between Right Analysis tabs (Score, Vocab checklist, Model essay)
function switchAnalysisTab(tabName) {
  // Update active tab buttons
  document.querySelectorAll('.analysis-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.innerText.toLowerCase().includes(tabName === 'score' ? 'chấm' : tabName === 'vocab-check' ? 'đối' : 'mẫu')) {
      btn.classList.add('active');
    }
  });
  
  // Show section
  document.querySelectorAll('.analysis-section').forEach(sec => {
    sec.classList.remove('active');
  });
  
  let targetSec = 'score';
  if (tabName === 'vocab-check') targetSec = 'vocab-check';
  if (tabName === 'model') targetSec = 'model';
  
  document.getElementById(`analysis-sec-${targetSec}`).classList.add('active');
}

// Render sample essay based on B1/B2 toggle
function renderSampleEssay() {
  const textEl = document.getElementById('ws-sample-essay-text');
  
  // Set sample pills active state safely (handles B1-only and B2-only site DOM)
  const b1Pill = document.getElementById('ws-sample-b1-pill');
  const b2Pill = document.getElementById('ws-sample-b2-pill');
  
  if (currentSampleLevel === 'B1') {
    if (b1Pill) b1Pill.classList.add('active');
    if (b2Pill) b2Pill.classList.remove('active');
  } else {
    if (b2Pill) b2Pill.classList.add('active');
    if (b1Pill) b1Pill.classList.remove('active');
  }
  
  const topic = currentTopic;
  if (!topic || !topic.has_full_details || !topic.details) {
    if (textEl) textEl.innerHTML = '<div class="empty-state">Xin lỗi, chủ đề tự viết tự do này hiện chưa có bài giải mẫu được lưu trữ trong cơ sở dữ liệu.</div>';
    return;
  }
  
  const essayText = currentSampleLevel === 'B1' ? topic.details.sample_b1 : topic.details.sample_b2;
  if (textEl) textEl.innerHTML = essayText || '<div class="empty-state">Chưa có bài mẫu cho cấp độ này.</div>';
}

function switchSampleLevel(level) {
  level = 'B2';
  currentSampleLevel = level;
  renderSampleEssay();
}

function closeFeedbackPane() {
  document.getElementById('workspace-layout-container').classList.remove('submitted');
}

// --- History / Submission Storage (per student + cloud synced) ---
function getHistory() {
  const history = localStorage.getItem(getStudentHistoryKey());
  return history ? JSON.parse(history) : [];
}

function saveSubmission(score, wordCount, content) {
  try {
    const history = getHistory();
    const submission = {
      id: Date.now(),
      date: new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      catId: currentCategory ? currentCategory.id : 0,
      catTitleVi: currentCategory ? currentCategory.title_vi : '',
      topicId: currentTopic ? currentTopic.id : 0,
      topicTitle: currentTopic ? currentTopic.title_en : '',
      wordCount: wordCount,
      score: score,
      content: content,
      outlineLevel: currentOutlineLevel,
      sampleLevel: currentSampleLevel,
      cheatViolations: cheatViolationCount,
      studentName: sessionStorage.getItem('current_user_name') || '',
      studentClass: sessionStorage.getItem('current_user_class') || ''
    };
    
    history.unshift(submission); // Add to beginning
    localStorage.setItem(getStudentHistoryKey(), JSON.stringify(history));

    // Clear unstick record so submitted topic is permanently recognized as written
    if (currentCategory && currentTopic) {
      const topicKey = `${currentCategory.id}_${currentTopic.id}`;
      let unstickList = getManualUnstickList();
      if (unstickList.includes(topicKey)) {
        unstickList = unstickList.filter(k => k !== topicKey);
        localStorage.setItem(getStudentUnstickKey(), JSON.stringify(unstickList));
        if (window.StudentHistorySync && typeof window.StudentHistorySync.recordStickChange === 'function') {
          window.StudentHistorySync.recordStickChange();
        }
      }
      updateWorkspaceStickBadge();
    }
    if (window.StudentHistorySync && typeof window.StudentHistorySync.schedulePush === 'function') {
      window.StudentHistorySync.schedulePush(true);
    }
    updateStats();
  } catch (err) {
    console.warn("Could not save submission to history:", err);
  }
}

function renderHistory() {
  const tbody = document.getElementById('history-table-body');
  const history = getHistory();
  
  if (history.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">Chưa có lịch sử làm bài nào được ghi lại. Hãy chọn đề và luyện tập viết ngay nhé!</td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = '';
  history.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.catTitleVi}</td>
      <td style="font-weight: 500;">${item.topicId}. ${item.topicTitle}</td>
      <td>${item.wordCount} từ</td>
      <td>
        <strong style="color: var(--accent-primary); font-size: 1.05rem;">${item.score.toFixed(1)}</strong> / 10
        <div style="font-size: 0.72rem; color: #059669; font-weight: 600;">(Quy đổi: ${((item.score * 7) / 10).toFixed(1)}/7.0)</div>
      </td>
      <td>
        <button class="history-action-btn" onclick="reviewSubmission(${item.id})">Xem lại & So sánh</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function reviewSubmission(submissionId) {
  const history = getHistory();
  const sub = history.find(item => item.id === submissionId);
  if (!sub) return;
  
  // Load workspace context but set in submitted/feedback state
  const category = ESSAY_DATA.find(cat => cat.id === sub.catId);
  const topic = category.topics.find(t => t.id === sub.topicId);
  
  currentCategory = category;
  currentTopic = topic;
  currentOutlineLevel = 'B2';
  currentSampleLevel = 'B2';
  currentTransLevel = 'B2';
  
  // Switch to Workspace Screen
  switchScreen('workspace');
  
  // Setup Workspace Headers
  document.getElementById('workspace-topic-title').innerText = topic.title_en;
  document.getElementById('workspace-topic-category').innerText = category.title_vi;
  
  const badge = document.getElementById('workspace-enrichment-badge');
  if (topic.has_full_details) {
    badge.innerText = 'Đã cập nhật';
    badge.style.background = 'var(--accent-gradient)';
  } else {
    badge.innerText = 'Đang cập nhật';
    badge.style.background = 'var(--panel-border)';
    badge.style.color = 'var(--text-secondary)';
  }
  
  const pEn = document.getElementById('ws-prompt-en');
  const pVi = document.getElementById('ws-prompt-vi');
  if (pEn) pEn.innerText = topic.context ? `${topic.context}\n\n${topic.prompt}` : topic.prompt;
  if (pVi) pVi.innerHTML = getPromptTranslation(topic, category);
  
  // Paraphrases
  const paraphraseContainer = document.getElementById('ws-paraphrase-container');
  const paraphraseList = document.getElementById('ws-paraphrase-list');
  paraphraseList.innerHTML = '';
  
  if (topic.paraphrases && topic.paraphrases.length > 0) {
    paraphraseContainer.style.display = 'block';
    topic.paraphrases.forEach(p => {
      const li = document.createElement('li');
      li.innerText = p;
      paraphraseList.appendChild(li);
    });
  } else {
    paraphraseContainer.style.display = 'none';
  }
  
  // Vocab
  const vocabList = document.getElementById('ws-vocab-list');
  vocabList.innerHTML = '';
  if (topic.has_full_details && topic.details && topic.details.vocab && topic.details.vocab.length > 0) {
    topic.details.vocab.forEach(v => {
      const card = document.createElement('div');
      card.className = 'flashcard-wrapper';
      card.onclick = () => card.classList.toggle('flipped');
      card.innerHTML = `
        <div class="flashcard">
          <div class="flashcard-front">
            <span class="vocab-word">${v.en}</span>
            <span class="vocab-type">Collocation</span>
          </div>
          <div class="flashcard-back">
            <span class="vocab-translation">${v.vi}</span>
            <span class="vocab-hint">Chạm để đóng</span>
          </div>
        </div>
      `;
      vocabList.appendChild(card);
    });
  } else {
    vocabList.innerHTML = '<div class="empty-state">Không có danh sách từ vựng gợi ý.</div>';
  }
  
  renderOutline();
  renderVietnameseOutline();
  
  // Set Step 3 writing pane and editor content
  document.getElementById('essay-textarea').value = sub.content;
  updateWordCount();
  
  // Set submission flag to true to avoid timer/toast trigger in switchStep
  hasSubmitted = true;
  if (typeof renderWorkspaceStepHeader === 'function') {
    renderWorkspaceStepHeader();
  }
  
  // Switch to Step writing to show feedback
  switchStep('write');
  
  // Re-run evaluation to populate feedback details
  submitEssay(); 
}

// --- Render Saved Drafts Screen ---
function renderDrafts() {
  const container = document.getElementById('drafts-list-container');
  container.innerHTML = '';
  
  const drafts = [];
  const draftPrefix = getStudentDraftPrefix();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(draftPrefix)) {
      const parts = key.slice(draftPrefix.length).split("_");
      const catId = parseInt(parts[0]);
      const topicId = parseInt(parts[1]);
      const text = localStorage.getItem(key);
      
      const category = ESSAY_DATA.find(cat => cat.id === catId);
      if (category) {
        const topic = category.topics.find(t => t.id === topicId);
        if (topic) {
          drafts.push({
            key: key,
            catId: catId,
            catTitleVi: category.title_vi,
            topicId: topicId,
            topicTitle: topic.title_en,
            text: text,
            wordCount: text.trim() === "" ? 0 : text.trim().split(/\s+/).length
          });
        }
      }
    }
  }
  
  if (drafts.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: span 3; padding: 4rem;">
        Chưa có bản nháp nào được lưu. Hãy thử gõ văn bản trong phòng luyện viết, hệ thống sẽ tự động tạo bản nháp.
      </div>
    `;
    return;
  }
  
  drafts.forEach(draft => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.onclick = () => startPractice(draft.catId, draft.topicId);
    
    // Create preview
    const preview = draft.text.length > 90 ? draft.text.substring(0, 90) + "..." : draft.text;
    
    card.innerHTML = `
      <div class="card-header">
        <span class="category-tag tag-adv">${draft.catTitleVi}</span>
        <span class="detail-badge" style="background-color: var(--warning-bg); color: var(--warning)">Nháp (${draft.wordCount} từ)</span>
      </div>
      <div class="card-body">
        <h4 style="font-size: 1rem; margin-bottom: 0.5rem;">${draft.topicId}. ${draft.topicTitle}</h4>
        <p style="font-size: 0.825rem; color: var(--text-muted); line-height: 1.4; white-space: pre-line;">"${preview}"</p>
      </div>
      <div class="card-footer" style="margin-top: 1rem;">
        <button class="history-action-btn" onclick="event.stopPropagation(); deleteDraft('${draft.key}')" style="color: var(--danger)">Xóa nháp</button>
        <div class="start-btn" style="color: var(--warning);">
          Viết tiếp
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function deleteDraft(key) {
  if (confirm("Bạn có chắc chắn muốn xóa bản nháp này?")) {
    localStorage.removeItem(key);
    const draftPrefix = getStudentDraftPrefix();
    if (key && key.startsWith(draftPrefix) && window.StudentHistorySync && typeof window.StudentHistorySync.recordDraftChange === 'function') {
      const parts = key.slice(draftPrefix.length).split('_');
      if (parts.length === 2) {
        window.StudentHistorySync.recordDraftChange(parts[0], parts[1], true);
      }
    }
    renderDrafts();
    updateStats();
    showToast("Đã xóa bản nháp thành công.", "success");
  }
}

// --- Dynamic Stats calculation ---
function updateStats() {
  try {
    const history = getHistory();
    
    // 1. Completed essays (unique written topics)
    let totalUniqueWritten = 0;
    if (typeof ESSAY_DATA !== 'undefined' && Array.isArray(ESSAY_DATA)) {
      ESSAY_DATA.forEach(cat => {
        if (cat.topics && Array.isArray(cat.topics)) {
          cat.topics.forEach(t => {
            if (isTopicWritten(cat.id, t.id)) totalUniqueWritten++;
          });
        }
      });
    } else {
      totalUniqueWritten = history.length;
    }
    const elCompleted = document.getElementById('stat-completed-count');
    if (elCompleted) elCompleted.innerText = totalUniqueWritten;
    
    // 2. Drafts count (per student)
    let draftsCount = 0;
    const draftPrefix = getStudentDraftPrefix();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(draftPrefix)) draftsCount++;
    }
    const elDrafts = document.getElementById('stat-draft-count');
    if (elDrafts) elDrafts.innerText = draftsCount;
    
    // 3. Vocab accumulated
    let totalVocab = 0;
    if (typeof ESSAY_DATA !== 'undefined' && Array.isArray(ESSAY_DATA)) {
      ESSAY_DATA.forEach(cat => {
        if (cat.topics && Array.isArray(cat.topics)) {
          cat.topics.forEach(t => {
            if (t.has_full_details && t.details && t.details.vocab) {
              totalVocab += t.details.vocab.length;
            }
          });
        }
      });
    }
    const elVocab = document.getElementById('stat-vocab-count');
    if (elVocab) elVocab.innerText = totalVocab;
    
    // 4. Average score
    let avgScore = 0.0;
    if (history.length > 0) {
      const sum = history.reduce((acc, item) => acc + item.score, 0);
      avgScore = sum / history.length;
    }
    const elAvg = document.getElementById('stat-avg-score');
    if (elAvg) elAvg.innerText = avgScore.toFixed(1);
  } catch (err) {
    console.warn("Could not update stats:", err);
  }
}

// --- Side-by-Side Comparison Modal Controls ---
function openComparisonModal() {
  const text = document.getElementById('essay-textarea').value;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  
  document.getElementById('compare-user-header').innerText = `Bài viết của bạn (${words} từ)`;
  document.getElementById('compare-user-text').innerText = text;
  
  const modalHeader = document.getElementById('compare-model-header');
  const modalText = document.getElementById('compare-model-text');
  
  modalHeader.innerText = `Bài giải mẫu VSTEP ${currentSampleLevel}`;
  
  const topic = currentTopic;
  if (topic && topic.has_full_details && topic.details) {
    const essayText = currentSampleLevel === 'B1' ? topic.details.sample_b1 : topic.details.sample_b2;
    modalText.innerHTML = essayText;
  } else {
    modalText.innerHTML = '<div class="empty-state">Không có bài viết mẫu cho chủ đề này.</div>';
  }
  
  document.getElementById('comparison-modal').classList.add('active');
}

function closeComparisonModal() {
  document.getElementById('comparison-modal').classList.remove('active');
}

// --- Mindmap Modal Controls ---
function openMindmapModal(imgSrc, title) {
  const modal = document.getElementById('mindmap-modal');
  const img = document.getElementById('mindmap-modal-img');
  const titleEl = document.getElementById('mindmap-modal-title');
  if (modal && img) {
    img.src = imgSrc;
    if (titleEl && title) titleEl.textContent = title;
    modal.classList.add('active');
  }
}

function closeMindmapModal() {
  const modal = document.getElementById('mindmap-modal');
  if (modal) modal.classList.remove('active');
}

// --- Toast notification helpers ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 18px; height: 18px;">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  `; 
  
  if (type === 'warning') {
    icon = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 18px; height: 18px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    `;
  } else if (type === 'danger') {
    icon = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 18px; height: 18px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    `;
  }
  
  toast.innerHTML = `
    ${icon}
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after 3.5 seconds
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s reverse forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Get Vietnamese translation of the essay prompt context and question
function getPromptTranslation(topic, category) {
  if (!topic) return "";

  if (topic.context_vi && topic.prompt_vi) {
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> ${topic.context_vi}</p>
            <p><strong>Yêu cầu đề bài:</strong> ${topic.prompt_vi}</p>`;
  }
  
  // Hand-crafted translations for the 5 featured topics
  if (category.id === 1 && topic.id === 1) { // Online learning
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Ngày nay, việc học trực tuyến ngày càng trở nên phổ biến ở nhiều quốc gia. Nhờ sự phát triển của công nghệ, học sinh có thể tham gia các lớp học, xem bài giảng và nộp bài tập qua Internet mà không cần đến trường học hay trường đại học. Một số người tin rằng học trực tuyến mang lại nhiều lợi ích, trong khi những người khác lập luận rằng nó cũng có một vài hạn chế.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy viết một bài luận gửi đến một độc giả có học thức để thảo luận về những lợi ích và tác hại của việc học trực tuyến. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  if (category.id === 1 && topic.id === 2) { // Studying abroad
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Ngày nay, du học đã trở thành một lựa chọn phổ biến của nhiều học sinh, sinh viên. Một số học sinh tin rằng việc học tập ở một quốc gia khác mang lại cho họ cơ hội giáo dục tốt hơn và giúp họ trải nghiệm một nền văn hóa mới. Tuy nhiên, những người khác lập luận rằng điều đó cũng có thể mang lại nhiều thách thức, chẳng hạn như chi phí sinh hoạt cao, nỗi nhớ nhà và sự khác biệt về văn hóa.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy viết một bài luận gửi đến một độc giả có học thức để thảo luận về những lợi ích và tác hại của việc đi du học. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  if (category.id === 2 && topic.id === 1) { // Traffic jams
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Ùn tắc giao thông đã trở thành một vấn đề nghiêm trọng ở nhiều thành phố trên thế giới. Khi dân số đô thị tiếp tục tăng và số lượng phương tiện cá nhân ngày càng nhiều, đường sá trở nên đông đúc hơn và hệ thống giao thông phải đối mặt với áp lực lớn hơn. Tình trạng tắc nghẽn giao thông ảnh hưởng đến cuộc sống hàng ngày, gây ra sự chậm trễ và tạo ra các vấn đề về kinh tế cũng như môi trường.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy viết một bài luận gửi đến một độc giả có học thức để thảo luận về các nguyên nhân gây ùn tắc giao thông và đề xuất các giải pháp khả thi cho vấn đề này. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  if (category.id === 3 && topic.id === 1) { // Mobile phones should be banned in primary schools
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Điện thoại di động đã trở thành một phần thiết yếu của cuộc sống hàng ngày và được sử dụng rộng rãi để liên lạc, học tập và giải trí. Tuy nhiên, đang có những tranh luận liên tục về việc liệu trẻ em có nên được phép sử dụng điện thoại di động ở trường hay không. Một số người tin rằng điện thoại di động có thể hỗ trợ việc học và giúp học sinh giữ kết nối với gia đình, trong khi những người khác lập luận rằng chúng có thể gây xao nhãng và ảnh hưởng tiêu cực đến sự phát triển và giáo dục của trẻ.</p>
            <p><strong>Yêu cầu đề bài:</strong> Bạn đồng ý hay phản đối ở mức độ nào với ý kiến cho rằng điện thoại di động nên bị cấm ở các trường tiểu học? Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  if (category.id === 4 && topic.id === 1) { // Children should or should not read picture books
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Việc đọc đóng vai trò quan trọng trong sự phát triển của trẻ nhỏ, và sách tranh là một trong những tài liệu đọc phổ biến nhất đối với trẻ em. Một số người tin rằng sách tranh rất thú vị, dễ hiểu và khuyến khích trẻ phát triển thói quen đọc sách. Những người khác lại lập luận rằng sách tranh có thể làm giảm trí tưởng tượng và khả năng sáng tạo của trẻ, tương tự như tác hại của việc xem tivi.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy thảo luận về cả hai quan điểm và đưa ra ý kiến của riêng bạn. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }

  // Generative translation template for all other 171 topics
  const titleVi = topic.title_vi || "";
  const titleViLower = titleVi.charAt(0).toLowerCase() + titleVi.slice(1);
  
  if (category.id === 1) { // Advantages & Disadvantages
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Ngày nay, chủ đề về <strong>${titleViLower}</strong> đã trở nên phổ biến và thu hút nhiều sự quan tâm. Một số người tin rằng điều này mang lại nhiều lợi ích thiết thực, trong khi những người khác lập luận rằng nó cũng đi kèm với một số tác hại không mong muốn.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy viết một bài luận gửi đến một độc giả có học thức để thảo luận về những lợi ích và tác hại của <strong>${titleViLower}</strong>. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  
  if (category.id === 2) { // Causes & Solutions
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Hiện nay, vấn đề <strong>${titleViLower}</strong> đang trở thành một thách thức đáng lo ngại ở nhiều nơi. Tình trạng này gây ra nhiều ảnh hưởng tiêu cực đến đời sống xã hội cũng như sự phát triển bền vững của cộng đồng.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy viết một bài luận gửi đến một độc giả có học thức để phân tích nguyên nhân của <strong>${titleViLower}</strong> và đề xuất giải pháp khả thi nhằm khắc phục tình trạng này. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  
  if (category.id === 3) { // Opinion Essays
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Hiện nay, ý kiến về việc <strong>${titleViLower}</strong> đang nhận được nhiều sự quan tâm và tranh luận trái chiều từ công chúng. Có nhiều góc nhìn khác nhau xung quanh tính đúng đắn và hiệu quả của quan điểm này.</p>
            <p><strong>Yêu cầu đề bài:</strong> Bạn đồng ý hay phản đối ở mức độ nào với ý kiến cho rằng <strong>${titleViLower}</strong>? Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  
  if (category.id === 4) { // Discussion Essays
    return `<p style="margin-bottom: 0.75rem;"><strong>Ngữ cảnh:</strong> Trong xã hội hiện đại, vấn đề liên quan đến việc <strong>${titleViLower}</strong> đang gây ra nhiều ý kiến tranh cãi. Một bộ phận dư luận ủng hộ xu hướng này, trong khi nhóm khác lại thể hiện sự lo ngại hoặc phản đối.</p>
            <p><strong>Yêu cầu đề bài:</strong> Hãy thảo luận về cả hai quan điểm trên và đưa ra ý kiến cá nhân của riêng bạn. Đưa ra các lý do và ví dụ liên quan để hỗ trợ cho câu trả lời của bạn. Bạn nên viết ít nhất 250 từ. Bài làm của bạn sẽ được đánh giá dựa trên các tiêu chí: Hoàn thành nhiệm vụ, Bố cục bài viết, Từ vựng và Ngữ pháp.</p>`;
  }
  
  // Default fallback
  return `<p>Đề bài: ${topic.title_vi}</p>`;
}

// Get specific subtype label for a topic card
function getTopicSubtypeLabel(topic, catId) {
  if (catId === 1) {
    const isBenefitsOnly = (t) => {
      if (t.type === 'benefits_only') return true;
      const ideas = t.details && (t.details.ideas_b2 || t.details.ideas_b1);
      if (ideas && ideas.benefits && (!ideas.drawbacks || ideas.drawbacks.length === 0)) return true;
      const p = (t.prompt || '').toLowerCase();
      if ((p.includes('advantages of') || p.includes('benefits of') || p.includes('importance of')) && !p.includes('and disadvantages') && !p.includes('and drawbacks')) return true;
      return false;
    };
    if (isBenefitsOnly(topic)) {
      return "CHỈ PHÂN TÍCH THUẬN LỢI";
    }
    return "THUẬN LỢI & BẤT LỢI";
  }
  if (catId === 2) {
    const rawTag = (Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || '')).trim();
    let firstTag = '';
    if (rawTag.includes(']')) {
      firstTag = rawTag.split(']')[0].trim() + ']';
    } else {
      firstTag = rawTag;
    }
    firstTag = firstTag.toLowerCase();
    
    if (firstTag === '[causes & solutions]' || firstTag === '[problems & solutions]' || (firstTag.includes('causes') && firstTag.includes('solutions'))) {
      return "NGUYÊN NHÂN & GIẢI PHÁP";
    } else if (firstTag === '[causes & effects]' || firstTag === '[causes & effects – on youth and society]' || (firstTag.includes('causes') && firstTag.includes('effects'))) {
      return "NGUYÊN NHÂN & ẢNH HƯỞNG";
    } else if (firstTag === '[effects & solutions]' || firstTag === '[impacts & solutions]') {
      return "ẢNH HƯỞNG & GIẢI PHÁP";
    } else if (firstTag === '[causes]' || firstTag === '[factors]' || firstTag === '[causes / factors]' || firstTag === '[causes / reasons]') {
      return "CHỈ PHÂN TÍCH NGUYÊN NHÂN";
    } else if (firstTag === '[effects]' || firstTag === '[positive & negative effects]') {
      return "CHỈ PHÂN TÍCH ẢNH HƯỞNG";
    } else if (firstTag === '[measures]' || firstTag === '[solutions]' || firstTag === '[measures / solutions]') {
      return "CHỈ PHÂN TÍCH GIẢI PHÁP";
    }
    return "NGUYÊN NHÂN – TÁC ĐỘNG – GIẢI PHÁP";
  }
  if (catId === 3) {
    return "Ý KIẾN (AGREE / DISAGREE)";
  }
  if (catId === 4) {
    return "BÀN LUẬN (DISCUSS BOTH VIEWS)";
  }
  return "";
}

// Toggle vocab hints in Step 2 translation exercises
function toggleVocabHints(idx) {
  const container = document.getElementById(`trans-vocab-hints-${idx}`);
  if (!container) return;
  const btn = container.previousElementSibling;
  const chevron = btn.querySelector('.chevron');
  
  if (container.style.display === 'none') {
    container.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    btn.querySelector('span').innerText = '💡 Ẩn gợi ý từ vựng ';
  } else {
    container.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    btn.querySelector('span').innerText = '💡 Hiện gợi ý từ vựng ';
  }
}

// Get specific paraphrase expressions based on the current topic title
function getTopicParaphrases(topic) {
  if (!topic) return [];
  
  // Use custom database paraphrases if available
  if (topic.paraphrases) {
    if (Array.isArray(topic.paraphrases) && topic.paraphrases.length > 0) {
      return topic.paraphrases.map(p => {
        if (typeof p === 'string') {
          return { en: p, vi: "" };
        }
        return { en: p.en || "", vi: p.vi || "" };
      });
    } else if (typeof topic.paraphrases === 'object') {
      return topic.paraphrases;
    }
  }
  
  const title = topic.title_en.toLowerCase();
  
  if (title.includes("online learning") || title.includes("studying at school instead of online")) {
    return [
      { en: "Distance learning / Distance education", vi: "Học từ xa" },
      { en: "E-learning / Online education", vi: "Học tập trực tuyến" },
      { en: "Digital education / Virtual schooling", vi: "Giáo dục kỹ thuật số / lớp học ảo" },
      { en: "Web-based learning / Internet-based study", vi: "Học tập qua mạng internet" }
    ];
  }
  
  if (title.includes("studying abroad") || title.includes("studying in another country")) {
    return [
      { en: "Studying abroad / Studying overseas", vi: "Du học / Học tập ở nước ngoài" },
      { en: "Pursuing higher education in a foreign country", vi: "Theo đuổi giáo dục bậc cao ở quốc gia khác" },
      { en: "International education / Overseas study", vi: "Giáo dục quốc tế / Học tập tại nước ngoài" },
      { en: "Learning in a foreign academic environment", vi: "Học tập trong môi trường học thuật nước ngoài" }
    ];
  }
  
  if (title.includes("internet")) {
    return [
      { en: "The Internet / The world wide web", vi: "Mạng Internet / Mạng lưới toàn cầu" },
      { en: "Digital networks / Online platforms", vi: "Mạng lưới kỹ thuật số / Nền tảng trực tuyến" },
      { en: "Global cyber network", vi: "Mạng không gian mạng toàn cầu" },
      { en: "Information highway", vi: "Xa lộ thông tin" }
    ];
  }
  
  if (title.includes("homeschooling")) {
    return [
      { en: "Homeschooling / Home-based education", vi: "Học tập tại nhà / Giáo dục tại nhà" },
      { en: "Schooling at home / Domestic learning", vi: "Học ở nhà / Học tập tại gia đình" },
      { en: "Parent-led education", vi: "Giáo dục do cha mẹ hướng dẫn" },
      { en: "Educating children outside of traditional schools", vi: "Giáo dục trẻ em ngoài trường học truyền thống" }
    ];
  }
  
  if (title.includes("public transport")) {
    return [
      { en: "Public transport / Public transit", vi: "Giao thông công cộng / Vận tải công cộng" },
      { en: "Mass transportation / Mass transit systems", vi: "Hệ thống vận tải đại chúng" },
      { en: "Commuter buses and trains", vi: "Xe buýt và tàu hỏa chở khách đi lại hàng ngày" },
      { en: "State-funded transit services", vi: "Dịch vụ vận tải do nhà nước tài trợ" }
    ];
  }
  
  if (title.includes("working from home")) {
    return [
      { en: "Working from home / Remote working", vi: "Làm việc tại nhà / Làm việc từ xa" },
      { en: "Telecommuting / Home-based work", vi: "Làm việc từ xa qua mạng / Công việc tại nhà" },
      { en: "Flexible location working", vi: "Làm việc có địa điểm linh hoạt" },
      { en: "Performing job duties from one's residence", vi: "Thực hiện nhiệm vụ công việc từ nơi ở cá nhân" }
    ];
  }

  if (title.includes("nuclear family")) {
    return [
      { en: "Nuclear family / Nuclear household", vi: "Gia đình hạt nhân" },
      { en: "Two-generation family unit", vi: "Đơn vị gia đình hai thế hệ (cha mẹ và con cái)" },
      { en: "Small family structure", vi: "Cấu trúc gia đình nhỏ" }
    ];
  }

  if (title.includes("extended family")) {
    return [
      { en: "Extended family / Multi-generational household", vi: "Gia đình lớn / Hộ gia đình nhiều thế hệ" },
      { en: "Large family structure", vi: "Cấu trúc gia đình lớn" },
      { en: "Living with grandparents, parents, and relatives", vi: "Sống chung với ông bà, bố mẹ và họ hàng" }
    ];
  }

  // Fallback templates with keywords from the topic title based on Category
  const cleanTitle = topic.title_en
    .replace(/^(the\s+)?(impacts?|effects?|causes?(\s+and\s+effects?)?)\s+of\s+/i, "")
    .replace(/advantages\s*&\s*disadvantages\s*of\s*/i, "")
    .replace(/pros\s*&\s*cons\s*of\s*/i, "");
  const titleEn = cleanTitle.toLowerCase();
  const titleVi = topic.title_vi.toLowerCase().replace(/^(tác động|ảnh hưởng|nguyên nhân(\s+và\s+tác động)?)\s+của\s+/i, "");
  const capTitleEn = titleEn.charAt(0).toUpperCase() + titleEn.slice(1);
  const capTitleVi = titleVi.charAt(0).toUpperCase() + titleVi.slice(1);

  // Category 2 is Causes - Effects - Solutions
  if (currentCategory && currentCategory.id === 2) {
    const isPositiveOrNeutral = /communication|cooperation|collaboration|partnership|support|reading|exercise|sports/i.test(titleEn);
    if (isPositiveOrNeutral) {
      return [
        { en: `${capTitleEn} plays a vital role in modern educational and social development...`, vi: `${capTitleVi} đóng một vai trò quan trọng trong sự phát triển giáo dục và xã hội hiện đại...` },
        { en: `Promoting effective ${titleEn} has received significant attention in recent years...`, vi: `Thúc đẩy ${titleVi} hiệu quả đã nhận được nhiều sự quan tâm trong những năm gần đây...` },
        { en: `A crucial aspect of modern development is fostering constructive ${titleEn}...`, vi: `Một khía cạnh quan trọng của sự phát triển hiện đại là nuôi dưỡng ${titleVi} mang tính xây dựng...` }
      ];
    }
    return [
      { en: `${capTitleEn} has become a growing concern in today's society...`, vi: `${capTitleVi} đã trở thành một mối lo ngại ngày càng tăng trong xã hội ngày nay...` },
      { en: `One of the most pressing issues that modern society faces is ${titleEn}...`, vi: `Một trong những vấn đề cấp bách nhất mà xã hội hiện đại phải đối mặt là ${titleVi}...` },
      { en: `There is a growing concern about the negative impacts of ${titleEn}...`, vi: `Ngày càng có nhiều lo ngại về những tác động tiêu cực của ${titleVi}...` }
    ];
  }
  
  // Category 1 is Advantages & Disadvantages
  if (currentCategory && currentCategory.id === 1) {
    return [
      { en: `It is undeniable that ${titleEn} brings both benefits and drawbacks...`, vi: `Không thể phủ nhận rằng ${titleVi} mang lại cả lợi ích lẫn bất lợi...` },
      { en: `A highly controversial topic is whether the advantages of ${titleEn} outweigh its disadvantages...`, vi: `Một chủ đề gây nhiều tranh cãi là liệu lợi ích của ${titleVi} có vượt trội hơn bất lợi của nó hay không...` },
      { en: `Opinions are divided on whether ${titleEn} is a positive or negative development...`, vi: `Các ý kiến bị chia rẽ về việc liệu ${titleVi} là một sự phát triển tích cực hay tiêu cực...` }
    ];
  }

  // Default fallback for Opinion (Category 3) and Discussion (Category 4)
  return [
    { en: `It is believed by many that ${titleEn}...`, vi: `Nhiều người tin rằng ${titleVi}...` },
    { en: `A highly controversial topic is whether ${titleEn}...`, vi: `Một chủ đề gây nhiều tranh cãi là liệu ${titleVi}...` },
    { en: `Opinions are divided on whether ${titleEn}...`, vi: `Các ý kiến bị chia rẽ về việc liệu ${titleVi}...` }
  ];
}

// Resolve live / search URL for reference articles to guarantee working links
function resolveReferenceArticleUrl(article, lang) {
  if (!article) return '#';
  const rawUrl = (article.url || '').trim();
  const title = (article.title || '').trim();
  const source = (article.source || '').toLowerCase();

  // If Vietnamese newspaper source or explicitly lang === 'vi':
  if (lang === 'vi' || source.includes('vnexpress') || source.includes('tuổi trẻ') || source.includes('tuoitre') || source.includes('dân trí') || source.includes('dantri') || source.includes('nhân dân') || source.includes('thanh niên') || source.includes('vietnamnet') || source.includes('lao động')) {
    // If rawUrl is already an official search URL, use it directly
    if (rawUrl.includes('timkiem.vnexpress.net') || rawUrl.includes('/tim-kiem')) {
      return rawUrl;
    }
    
    // Clean query from title (remove punctuation like colons, quotes, and parentheses)
    const cleanQuery = title.replace(/[:"'\(\)]/g, ' ').replace(/\s+/g, ' ').trim();

    if (source.includes('vnexpress')) {
      return `https://timkiem.vnexpress.net/?q=${encodeURIComponent(cleanQuery)}`;
    }
    if (source.includes('tuổi trẻ') || source.includes('tuoitre')) {
      return `https://tuoitre.vn/tim-kiem.htm?keywords=${encodeURIComponent(cleanQuery)}`;
    }
    if (source.includes('dân trí') || source.includes('dantri')) {
      return `https://dantri.com.vn/tim-kiem/${encodeURIComponent(cleanQuery)}.htm`;
    }
    if (source.includes('nhân dân') || source.includes('nhandan')) {
      return `https://www.google.com/search?q=${encodeURIComponent('site:nhandan.vn ' + cleanQuery)}`;
    }
    if (source.includes('thanh niên') || source.includes('thanhnien')) {
      return `https://thanhnien.vn/tim-kiem.htm?keywords=${encodeURIComponent(cleanQuery)}`;
    }
    if (source.includes('vietnamnet')) {
      return `https://vietnamnet.vn/tim-kiem?q=${encodeURIComponent(cleanQuery)}`;
    }

    return `https://www.google.com/search?q=${encodeURIComponent(cleanQuery + ' ' + (article.source || ''))}`;
  }

  return rawUrl || '#';
}

// Render Step 1 Reading & Analysis
function renderStep1Reading() {
  const container = document.getElementById('ws-step1-reading-content');
  if (!container) return;
  container.innerHTML = '';
  
  const topic = currentTopic;
  const category = currentCategory;
  if (!topic) return;
  
  let ctx = topic.context;
  let prm = topic.prompt;
  if (!prm && topic.subtopics && topic.subtopics.length > 0) {
    ctx = topic.subtopics[0].context || '';
    prm = topic.subtopics[0].prompt || '';
  }
  const promptEn = ctx ? `${ctx}\n\n${prm}` : (prm || '');
  const promptVi = getPromptTranslation(topic, category);
  
  const paraphrases = getTopicParaphrases(topic);
  let paraphraseHtml = '';
  if (paraphrases) {
    if (Array.isArray(paraphrases) && paraphrases.length > 0) {
      paraphraseHtml = `
        <ul class="paraphrase-list">
          ${paraphrases.map(p => `<li><strong>${p.en}</strong>${p.vi ? ` (${p.vi})` : ''}</li>`).join('')}
        </ul>
      `;
    } else if (typeof paraphrases === 'object' && !Array.isArray(paraphrases)) {
      let partsHtml = [];
      if (paraphrases.topic) {
        partsHtml.push(`
          <div class="viewpoint-paraphrase-section" style="margin-bottom: 1.25rem;">
            <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 0.95rem; display: flex; align-items: flex-start; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; white-space: nowrap; padding-top: 2px;">
                <span class="badge" style="background-color: rgba(99, 102, 241, 0.15); color: var(--accent-primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">TOPIC</span>
                <span>Chủ đề:</span>
              </div>
              <span style="color: var(--text-primary); font-weight: 500;">"${paraphrases.topic.title_en}" (${paraphrases.topic.title_vi})</span>
            </div>
            <ul class="paraphrase-list">
              ${paraphrases.topic.items.map(p => `<li><strong>${p.en}</strong>${p.vi ? ` (${p.vi})` : ''}</li>`).join('')}
            </ul>
          </div>
        `);
      }
      if (paraphrases.view1) {
        partsHtml.push(`
          <div class="viewpoint-paraphrase-section" style="margin-bottom: 1.25rem;">
            <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 0.95rem; display: flex; align-items: flex-start; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; white-space: nowrap; padding-top: 2px;">
                <span class="badge" style="background-color: rgba(99, 102, 241, 0.15); color: var(--accent-primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">VIEW 1</span>
                <span>Quan điểm gốc 1:</span>
              </div>
              <span style="color: var(--text-primary); font-weight: 500;">"${paraphrases.view1.title_en}" (${paraphrases.view1.title_vi})</span>
            </div>
            <ul class="paraphrase-list">
              ${paraphrases.view1.items.map(p => `<li><strong>${p.en}</strong>${p.vi ? ` (${p.vi})` : ''}</li>`).join('')}
            </ul>
          </div>
        `);
      }
      if (paraphrases.view2) {
        partsHtml.push(`
          <div class="viewpoint-paraphrase-section">
            <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 0.95rem; display: flex; align-items: flex-start; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; white-space: nowrap; padding-top: 2px;">
                <span class="badge" style="background-color: rgba(99, 102, 241, 0.15); color: var(--accent-primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">VIEW 2</span>
                <span>Quan điểm gốc 2:</span>
              </div>
              <span style="color: var(--text-primary); font-weight: 500;">"${paraphrases.view2.title_en}" (${paraphrases.view2.title_vi})</span>
            </div>
            <ul class="paraphrase-list">
              ${paraphrases.view2.items.map(p => `<li><strong>${p.en}</strong>${p.vi ? ` (${p.vi})` : ''}</li>`).join('')}
            </ul>
          </div>
        `);
      }
      paraphraseHtml = partsHtml.join('');
    }
  }
  
  let outlineSummaryHtml = '';
  let outlineIntroText = 'Định hướng các luận điểm chính mà bạn sẽ phân tích trong bài viết:';
  
  if (topic.has_full_details && topic.details) {
    if (category.id === 3) {
      const activeApp = (topic.approaches && typeof currentApproachIndex !== 'undefined' && topic.approaches[currentApproachIndex]) ? topic.approaches[currentApproachIndex] : null;
      const isDisagree = activeApp && (activeApp.stance === 'disagree' || (activeApp.name && activeApp.name.includes('KHÔNG ĐỒNG Ý')));
      if (isDisagree) {
        outlineIntroText = 'Sau đây là những LÝ DO CHÍNH để bảo vệ quan điểm KHÔNG ĐỒNG Ý (DISAGREE):';
      } else {
        outlineIntroText = 'Sau đây là những LÝ DO CHÍNH để bảo vệ quan điểm ĐỒNG Ý (AGREE):';
      }
    } else if (category.id === 4) {
      outlineIntroText = 'Sau đây là những LUẬN ĐIỂM CHÍNH của hai quan điểm trái chiều và ý kiến cá nhân:';
    }
    
    const formatPoint = (p, defaultLabel, idx) => {
      let label = defaultLabel;
      if (p.title) {
        const tUpper = p.title.toUpperCase();
        if (tUpper.includes('POSITIVE EFFECT') || tUpper.startsWith('TÍCH CỰC')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `ẢNH HƯỞNG TÍCH CỰC ${num}` : 'ẢNH HƯỞNG TÍCH CỰC';
        } else if (tUpper.includes('NEGATIVE EFFECT') || tUpper.startsWith('TIÊU CỰC')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `ẢNH HƯỞNG TIÊU CỰC ${num}` : 'ẢNH HƯỞNG TIÊU CỰC';
        } else if (tUpper.includes('EFFECT') || tUpper.includes('IMPACT') || tUpper.startsWith('HẬU QUẢ') || tUpper.startsWith('ẢNH HƯỞNG')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `ẢNH HƯỞNG ${num}` : 'ẢNH HƯỞNG';
        } else if (tUpper.includes('SOLUTION') || tUpper.includes('MEASURE') || tUpper.startsWith('GIẢI PHÁP')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `GIẢI PHÁP ${num}` : 'GIẢI PHÁP';
        } else if (tUpper.includes('CAUSE') || tUpper.includes('FACTOR') || tUpper.includes('REASON') || tUpper.startsWith('NGUYÊN NHÂN')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `NGUYÊN NHÂN ${num}` : 'NGUYÊN NHÂN';
        } else if (tUpper.includes('PROBLEM') || tUpper.startsWith('VẤN ĐỀ')) {
          const num = p.title.match(/\d+/) ? p.title.match(/\d+/)[0] : (typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '');
          label = num ? `VẤN ĐỀ ${num}` : 'VẤN ĐỀ';
        } else if (p.title.includes(':')) {
          label = p.title.split(':')[0].trim();
        }
      }
      return `<li><strong>${label}:</strong> ${p.point_vi}</li>`;
    };

    let defaultLabel1 = 'LỢI ÍCH';
    let defaultLabel2 = 'BẤT LỢI';
    if (category.id === 2) {
      const tags = (Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || '')).toLowerCase();
      if (tags.includes('effect') || tags.includes('impact')) {
        if (tags.includes('cause')) {
          defaultLabel1 = 'NGUYÊN NHÂN';
          defaultLabel2 = 'ẢNH HƯỞNG';
        } else if (tags.includes('solution') || tags.includes('measure')) {
          defaultLabel1 = 'ẢNH HƯỞNG';
          defaultLabel2 = 'GIẢI PHÁP';
        } else if (tags.includes('positive')) {
          defaultLabel1 = 'ẢNH HƯỞNG TÍCH CỰC';
          defaultLabel2 = 'ẢNH HƯỞNG TIÊU CỰC';
        } else {
          defaultLabel1 = 'ẢNH HƯỞNG';
          defaultLabel2 = 'ẢNH HƯỞNG';
        }
      } else if (tags.includes('solution') || tags.includes('measure')) {
        defaultLabel1 = 'GIẢI PHÁP';
        defaultLabel2 = 'GIẢI PHÁP';
      } else if (tags.includes('problem')) {
        defaultLabel1 = 'VẤN ĐỀ';
        defaultLabel2 = 'GIẢI PHÁP';
      } else {
        defaultLabel1 = 'NGUYÊN NHÂN';
        defaultLabel2 = 'GIẢI PHÁP';
      }

      const activeApp = (topic.approaches && typeof currentApproachIndex !== 'undefined' && topic.approaches[currentApproachIndex])
        ? topic.approaches[currentApproachIndex]
        : null;
      if (activeApp && activeApp.name) {
        const appName = activeApp.name.toUpperCase();
        if (appName.includes('TÍCH CỰC') && appName.includes('TIÊU CỰC')) {
          defaultLabel1 = 'ẢNH HƯỞNG TÍCH CỰC';
          defaultLabel2 = 'ẢNH HƯỞNG TIÊU CỰC';
        } else if (appName.includes('TÍCH CỰC')) {
          defaultLabel1 = 'ẢNH HƯỞNG TÍCH CỰC';
          defaultLabel2 = 'ẢNH HƯỞNG TÍCH CỰC';
        } else if (appName.includes('TIÊU CỰC')) {
          defaultLabel1 = 'ẢNH HƯỞNG TIÊU CỰC';
          defaultLabel2 = 'ẢNH HƯỞNG TIÊU CỰC';
        }
      }
    } else if (category.id === 3) {
      defaultLabel1 = 'LÝ DO';
      defaultLabel2 = 'LÝ DO';
    } else if (category.id === 4) {
      defaultLabel1 = 'QUAN ĐIỂM 1';
      defaultLabel2 = 'QUAN ĐIỂM 2';
    }

    const b2Ideas = topic.details.ideas_b2 || topic.details.ideas_b1;
    let b1BenefitsList = (b2Ideas.benefits || b2Ideas.causes || b2Ideas.reasons || b2Ideas.views || b2Ideas.factors || []);
    let b1DrawbacksList = (b2Ideas.drawbacks || b2Ideas.solutions || b2Ideas.effects || b2Ideas.problems || b2Ideas.measures || []);

    if (hasSelectableIdeas(topic)) {
      if (b1BenefitsList.length > 3) {
        const selB = getSelectedIdeaIndices(topic, 'benefits');
        b1BenefitsList = b1BenefitsList.filter((_, idx) => selB.includes(idx));
      }
      if (b1DrawbacksList.length > 3) {
        const selD = getSelectedIdeaIndices(topic, 'drawbacks');
        b1DrawbacksList = b1DrawbacksList.filter((_, idx) => selD.includes(idx));
      }
    }

    const b1Benefits = b1BenefitsList
      .map((b, idx) => formatPoint(b, defaultLabel1, idx))
      .join('');
    const b1Drawbacks = b1DrawbacksList
      .map((d, idx) => formatPoint(d, defaultLabel2, idx))
      .join('');
    
    outlineSummaryHtml = `
      <ul class="outline-summary-list">
        ${b1Benefits}
        ${b1Drawbacks}
      </ul>
    `;
  } else {
    let customOutlineGuide = '';
    if (category.id === 3) {
      customOutlineGuide = `
        <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
          <li><strong>Mở bài (Introduction):</strong> <em>Nowadays, the idea that [quan điểm trong đề bài – mệnh đề] has become a common topic of discussion. From my perspective, I completely agree / disagree with this opinion for several important reasons. This essay will present the main arguments supporting my viewpoint.</em></li>
          <li><strong>Thân bài 1 (Body 1):</strong> <em>The first reason why I agree / disagree with this opinion is that [lý do 1 – mệnh đề].</em>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.2rem; padding-left: 0.5rem; border-left: 2px solid var(--accent-primary);">
              Phát triển theo công thức 3 bước: <strong>Bước 1</strong> (Giải thích: <em>This is because...</em> hoặc <em>In fact,...</em>) &rarr; <strong>Bước 2</strong> (Ví dụ: <em>For example,...</em>) &rarr; <strong>Bước 3</strong> (Kết quả: <em>As a result,...</em> hoặc <em>Therefore,...</em>).
            </div>
          </li>
          <li><strong>Thân bài 2 (Body 2):</strong> <em>Another important reason is that [lý do 2 – mệnh đề].</em> (Tiếp tục phát triển bằng giải thích và ví dụ cụ thể 3-4 câu).</li>
          <li><strong>Thân bài 3 (Body 3 - tùy chọn):</strong> <em>A further reason supporting my viewpoint is that [lý do 3 – mệnh đề].</em> (Phát triển lý do thứ 3 và nhấn mạnh tác động 3-4 câu).</li>
          <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, I strongly agree / disagree with the idea that [quan điểm trong đề bài – mệnh đề]. The reasons above clearly explain why I support / oppose this viewpoint. Therefore, it is essential that [đối tượng] take this matter into consideration.</em></li>
        </ul>
      `;
    } else if (category.id === 4) {
      customOutlineGuide = `
        <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
          <li><strong>Mở bài (Introduction):</strong> <em>Nowadays, [chủ đề] has become a common topic of discussion. Some people believe that [ý kiến 1 – mệnh đề], while others argue that [ý kiến 2 – mệnh đề]. This essay will discuss both views and give my own opinion.</em></li>
          <li><strong>Thân bài đoạn 1 (Body 1):</strong> <em>On the one hand, it is argued that [ý kiến 1 – mệnh đề].</em> (Phân tích và phát triển quan điểm thứ nhất bằng giải thích, ví dụ hoặc dẫn chứng phù hợp).</li>
          <li><strong>Thân bài đoạn 2 (Body 2):</strong> <em>On the other hand, it is believed that [ý kiến 2 – mệnh đề].</em> (Phân tích quan điểm đối lập bằng các lập luận và ví dụ phù hợp).</li>
          <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, both views have their own reasons. However, I believe that [quan điểm cá nhân – mệnh đề] because [lý do ngắn gọn – mệnh đề]. Therefore, it is important that people consider both views carefully.</em></li>
        </ul>
      `;
    } else if (category.id === 1) {
      const p = (topic.prompt || '').toLowerCase();
      const isAdvOnly = (p.includes('advantages of') || p.includes('benefits of') || p.includes('importance of')) && !p.includes('and disadvantages') && !p.includes('and drawbacks');
      if (isAdvOnly) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become increasingly prevalent in modern society. This has led to a range of benefits across different contexts. This essay will focus on the main advantages associated with it.</em></li>
            <li><strong>Thân bài 1 (Body 1):</strong> <em>One major benefit is that [lợi ích 1 – mệnh đề]. &rarr; [Luận cứ 1] &rarr; [Luận cứ 2] &rarr; [Luận cứ 3] &rarr; [Luận cứ 4].</em></li>
            <li><strong>Thân bài 2 (Body 2):</strong> <em>Another positive aspect is that [lợi ích 2 – mệnh đề]. &rarr; [Luận cứ 1] &rarr; [Luận cứ 2] &rarr; [Luận cứ 3] &rarr; [Luận cứ 4].</em></li>
            <li><strong>Thân bài 3 (Body 3):</strong> <em>A further advantage is that [lợi ích 3 – mệnh đề]. &rarr; [Luận cứ 1] &rarr; [Luận cứ 2] &rarr; [Luận cứ 3] &rarr; [Luận cứ 4].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] offers several notable advantages. These benefits can have a positive influence on individuals and society in various ways. Overall, its positive contributions highlight the importance of [chủ đề - danh từ / cụm danh từ] in modern life.</em></li>
          </ul>
        `;
      } else {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become increasingly prevalent in modern society. Although it brings certain benefits, there are also some negative aspects. This essay will examine both the advantages and disadvantages.</em></li>
            <li><strong>Thân bài 1 (Body 1 - Advantages):</strong> <em>On the one hand, [chủ đề - danh từ / cụm danh từ] offers several advantages. One major benefit is that [lợi ích 1 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2]. Another positive aspect is that [lợi ích 2 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2]. A further advantage to consider is that [lợi ích 3 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2].</em></li>
            <li><strong>Thân bài 2 (Body 2 - Disadvantages):</strong> <em>On the other hand, there are some disadvantages that should be considered. One possible drawback is that [bất lợi 1 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2]. Another negative aspect is that [bất lợi 2 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2]. A further concern is that [bất lợi 3 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] has both positive and negative aspects that should not be overlooked. While it offers certain benefits, its potential drawbacks may also have significant implications. Therefore, a balanced consideration of both aspects is essential.</em></li>
          </ul>
        `;
      }
    } else if (category.id === 2) {
      const rawTag = (Array.isArray(topic.tags) ? topic.tags.join(', ') : (topic.tags || '')).toLowerCase();
      const p = ((topic.prompt || '') + ' ' + rawTag).toLowerCase();
      if (rawTag.includes('causes & effects') || (p.includes('causes') && (p.includes('effects') || p.includes('consequences') || p.includes('impacts')) && !p.includes('solutions'))) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. This issue has created several challenges for both individuals and society. This essay will examine the main causes of this problem and discuss its possible effects.</em></li>
            <li><strong>Thân bài 1 (Body 1 - Causes):</strong> <em>This issue can be attributed to several key factors. One major cause is that [nguyên nhân 1 – mệnh đề]. &rarr; [luận cứ]. Another contributing factor is that [nguyên nhân 2 – mệnh đề]. &rarr; [luận cứ]. A further reason is that [nguyên nhân 3 – mệnh đề]. &rarr; [luận cứ].</em></li>
            <li><strong>Thân bài 2 (Body 2 - Effects):</strong> <em>This problem can lead to several significant consequences. One negative effect is that [ảnh hưởng 1 – mệnh đề]. &rarr; [luận cứ]. Another serious impact is that [ảnh hưởng 2 – mệnh đề]. &rarr; [luận cứ]. A further consequence is that [ảnh hưởng 3 – mệnh đề]. &rarr; [luận cứ].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] is caused by several factors and leads to various negative effects. Understanding these causes and consequences is essential to address the problem effectively in the future. Without appropriate attention, this issue may continue to affect both individuals and society.</em></li>
          </ul>
        `;
      } else if (rawTag.includes('effects & solutions') || rawTag.includes('impacts & solutions') || rawTag.includes('problems & solutions') || ((p.includes('effects') || p.includes('impacts') || p.includes('problems')) && (p.includes('solutions') || p.includes('measures')) && !p.includes('causes'))) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. This issue has had a significant impact on both individuals and society. This essay will examine its main effects and suggest possible solutions.</em></li>
            <li><strong>Thân bài 1 (Body 1 - Effects):</strong> <em>This issue can lead to several serious consequences. One major effect is that [ảnh hưởng 1 – mệnh đề]. &rarr; [luận cứ]. Another significant impact is that [ảnh hưởng 2 – mệnh đề]. &rarr; [luận cứ]. A further consequence is that [ảnh hưởng 3 – mệnh đề]. &rarr; [luận cứ].</em></li>
            <li><strong>Thân bài 2 (Body 2 - Solutions):</strong> <em>To address this problem, several practical measures can be implemented. One effective solution is to [giải pháp 1 – Vo]. &rarr; [luận cứ]. Another possible measure is to [giải pháp 2 – Vo]. &rarr; [luận cứ]. Finally, it is necessary to [giải pháp 3 – Vo]. &rarr; [luận cứ].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] causes several serious effects and requires practical solutions. Taking appropriate measures is essential to reduce its negative impacts in the future. With effective action, this problem can be better controlled, leading to positive changes in society.</em></li>
          </ul>
        `;
      } else if ((rawTag.includes('[causes]') || rawTag.includes('[factors]') || rawTag.includes('[causes /')) && !rawTag.includes('solutions') && !rawTag.includes('effects')) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. This issue has attracted increasing attention because of its impact on individuals and society. This essay will examine the main causes of this problem.</em></li>
            <li><strong>Thân bài 1 (Body 1):</strong> <em>One major cause is that [nguyên nhân 1 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 2 (Body 2):</strong> <em>Another contributing factor is that [nguyên nhân 2 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 3 (Body 3):</strong> <em>A further reason is that [nguyên nhân 3 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] can be attributed to several main factors. Understanding these causes is essential to deal with this issue effectively in the future. Greater awareness of these factors can help individuals and society respond more appropriately.</em></li>
          </ul>
        `;
      } else if ((rawTag.includes('[effects]') || rawTag.includes('positive & negative effects')) && !rawTag.includes('solutions') && !rawTag.includes('causes')) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. This issue has had a considerable impact on both individuals and society. This essay will examine the main effects of this problem.</em></li>
            <li><strong>Thân bài 1 (Body 1):</strong> <em>One major effect is that [ảnh hưởng 1 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 2 (Body 2):</strong> <em>Another significant impact is that [ảnh hưởng 2 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 3 (Body 3):</strong> <em>A further consequence is that [ảnh hưởng 3 – mệnh đề]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] leads to several serious effects on individuals and society. Recognizing these consequences is essential to address the issue more effectively in the future. Without proper attention, these impacts may become even more serious over time.</em></li>
          </ul>
        `;
      } else if ((rawTag.includes('[measures]') || rawTag.includes('[solutions]') || rawTag.includes('[measures / solutions]')) && !rawTag.includes('causes') && !rawTag.includes('effects')) {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. It has had a profound impact on both individuals and society. This essay will suggest several practical solutions to address this issue effectively.</em></li>
            <li><strong>Thân bài 1 (Body 1):</strong> <em>One effective solution is to [giải pháp 1 – Vo]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 2 (Body 2):</strong> <em>Another possible measure is to [giải pháp 2 – Vo]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Thân bài 3 (Body 3):</strong> <em>A further approach is to [giải pháp 3 – Vo]. &rarr; [luận cứ 1] &rarr; [luận cứ 2] &rarr; [luận cứ 3].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, several practical measures can be taken to address [chủ đề - danh từ / cụm danh từ]. Implementing these solutions is essential to improve the situation in the future. With appropriate action from both individuals and authorities, this problem can be significantly reduced over time.</em></li>
          </ul>
        `;
      } else {
        customOutlineGuide = `
          <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.45rem;">
            <li><strong>Mở bài (Introduction):</strong> <em>In recent years, [chủ đề - danh từ / cụm danh từ] has become a growing concern in many parts of the world. This issue has created several challenges for both individuals and society. This essay will examine the main causes of this problem and suggest possible solutions.</em></li>
            <li><strong>Thân bài 1 (Body 1 - Causes):</strong> <em>This issue can be attributed to several key factors. One major cause is that [nguyên nhân 1 – mệnh đề]. &rarr; [luận cứ]. Another contributing factor is that [nguyên nhân 2 – mệnh đề]. &rarr; [luận cứ]. A further reason is that [nguyên nhân 3 – mệnh đề]. &rarr; [luận cứ].</em></li>
            <li><strong>Thân bài 2 (Body 2 - Solutions):</strong> <em>To address this problem, several practical solutions can be implemented. One effective solution is to [giải pháp 1 – Vo]. &rarr; [luận cứ]. Another possible measure is to [giải pháp 2 – Vo]. &rarr; [luận cứ]. Finally, it is necessary to [giải pháp 3 – Vo]. &rarr; [luận cứ].</em></li>
            <li><strong>Kết bài (Conclusion):</strong> <em>In conclusion, [chủ đề - danh từ / cụm danh từ] is caused by several factors and requires practical solutions to address it effectively. Addressing these causes is essential to improve the situation in the future. With appropriate measures, this issue can be reduced, leading to positive changes in society.</em></li>
          </ul>
        `;
      }
    } else {
      customOutlineGuide = `
        <ul style="padding-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
          <li>Mở bài (Introduction): Nêu ngữ cảnh và quan điểm tổng quan.</li>
          <li>Thân bài đoạn 1 (Body Paragraph 1): Phân tích khía cạnh thứ nhất (thuận lợi / nguyên nhân).</li>
          <li>Thân bài đoạn 2 (Body Paragraph 2): Phân tích khía cạnh thứ hai (bất lợi / giải pháp).</li>
          <li>Kết bài (Conclusion): Tóm tắt lại vấn đề và đưa ra ý kiến chốt hạ.</li>
        </ul>
      `;
    }

    outlineSummaryHtml = `
      <div class="empty-state" style="padding: 1.5rem; border: 1px dashed var(--panel-border); text-align: left; font-size: 0.9rem; border-radius: var(--radius-md);">
        Chủ đề tự viết tự do này không có dàn ý ý tưởng sẵn. Bạn có thể dựa trên cấu trúc chuẩn của thể loại này để triển khai:
        ${customOutlineGuide}
      </div>
    `;
  }

  let stanceSelectorHtml = '';
  if (currentCategory && currentCategory.id === 3 && topic.approaches && topic.approaches.length > 0) {
    stanceSelectorHtml = `
      <div class="stance-selector-card">
        <div class="stance-selector-header">
          <div class="stance-selector-title">
            <span>⚖️</span>
            <span>BẠN LỰA CHỌN QUAN ĐIỂM NÀO CHO BÀI VIẾT NÀY?</span>
          </div>
          <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: var(--accent-primary); font-weight: 700; font-size: 0.75rem; padding: 0.25rem 0.65rem; border-radius: 999px;">
            TÙY CHỌN 2 HƯỚNG BÀI VIẾT
          </span>
        </div>
        <p class="stance-selector-desc">
          Đề thi yêu cầu bày tỏ quan điểm cá nhân (Agree or Disagree). Hãy bấm chọn lập trường bạn muốn bảo vệ &mdash; toàn bộ 5 luận điểm, bài tập luyện dịch và bài mẫu sẽ tự động cập nhật theo đúng quan điểm bạn đã chọn:
        </p>
        <div class="stance-cards-grid">
          ${topic.approaches.map((appr, idx) => {
            const isAgree = appr.stance === 'agree' || (appr.name && appr.name.includes('ĐỒNG Ý') && !appr.name.includes('KHÔNG ĐỒNG Ý'));
            const isDisagree = appr.stance === 'disagree' || (appr.name && appr.name.includes('KHÔNG ĐỒNG Ý'));
            const isActive = idx === currentApproachIndex;
            const stanceClass = isAgree ? 'stance-agree' : (isDisagree ? 'stance-disagree' : '');
            const icon = isAgree ? '👍' : (isDisagree ? '👎' : '📝');
            const sub = isAgree ? 'Ủng hộ nhận định trong đề bài (Bảo vệ quan điểm tích cực / thuận lợi)' : 'Phản đối nhận định trong đề bài (Lập luận theo hướng ngược lại / bảo vệ góc nhìn đối lập)';
            return `
              <div class="stance-card-btn ${stanceClass} ${isActive ? 'active' : ''}" onclick="switchTopicApproach(${idx})">
                <div class="stance-icon-bubble">${icon}</div>
                <div class="stance-card-info">
                  <div class="stance-card-name">
                    <span>${appr.name}</span>
                    ${isActive ? '<span class="stance-active-indicator">Đang chọn</span>' : ''}
                  </div>
                  <div class="stance-card-sub">${sub}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  const ideaSelectorHtml = renderIdeaSelectionComponent(topic);

  let referenceArticlesHtml = '';
  if (topic.details && topic.details.reference_articles) {
    const refs = topic.details.reference_articles;
    const viArticles = refs.vi || [];
    const enArticles = refs.en || [];
    if (viArticles.length > 0 || enArticles.length > 0) {
      referenceArticlesHtml = `
        <div class="reading-section-card reference-articles-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.25rem;">📰</span>
              <h3 style="margin-bottom: 0;">Nguồn bài báo tham khảo & Dẫn chứng thực tế</h3>
            </div>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700; font-size: 0.75rem; padding: 0.25rem 0.65rem; border-radius: 999px;">XÁC THỰC 100% NGUỒN BÁO CHÍ</span>
          </div>
          <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 1rem; line-height: 1.5;">
            Các luận điểm và số liệu trong đề bài được đúc kết từ các bài báo và báo cáo thực tế uy tín. Học viên có thể đọc tham khảo để nạp thêm vốn hiểu biết xã hội và phong cách diễn đạt thực tế:
          </p>

          <div class="reference-articles-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
            ${viArticles.length > 0 ? `
              <div class="reference-col">
                <div style="font-size: 0.85rem; font-weight: 700; color: #dc2626; margin-bottom: 0.65rem; display: flex; align-items: center; gap: 0.4rem;">
                  <span>🇻🇳</span> BÁO CHÍ TIẾNG VIỆT
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                  ${viArticles.map(a => `
                    <div class="reference-article-card" style="background: var(--bg-primary); border: 1px solid var(--panel-border); border-left: 3px solid #dc2626; border-radius: var(--radius-sm); padding: 0.75rem 0.9rem;">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #dc2626; text-transform: uppercase;">${a.source}</span>
                        <a href="${resolveReferenceArticleUrl(a, 'vi')}" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: var(--accent-primary); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" title="Mở bài viết">
                          Đọc bài <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                        </a>
                      </div>
                      <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem; line-height: 1.4;">${a.title}</div>
                      ${a.summary && a.summary !== 'undefined' ? `<div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45;">${a.summary}</div>` : ""}
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${enArticles.length > 0 ? `
              <div class="reference-col">
                <div style="font-size: 0.85rem; font-weight: 700; color: #2563eb; margin-bottom: 0.65rem; display: flex; align-items: center; gap: 0.4rem;">
                  <span>🌐</span> BÁO CHÍ QUỐC TẾ (ENGLISH)
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                  ${enArticles.map(a => `
                    <div class="reference-article-card" style="background: var(--bg-primary); border: 1px solid var(--panel-border); border-left: 3px solid #2563eb; border-radius: var(--radius-sm); padding: 0.75rem 0.9rem;">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #2563eb; text-transform: uppercase;">${a.source}</span>
                        <a href="${resolveReferenceArticleUrl(a, 'en')}" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: var(--accent-primary); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" title="Open article">
                          Read <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                        </a>
                      </div>
                      <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem; line-height: 1.4;">${a.title}</div>
                      ${a.summary && a.summary !== 'undefined' ? `<div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45;">${a.summary}</div>` : ""}
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }
  }
  
  container.innerHTML = `
    <div class="reading-section-card">
      <h3>Dịch & Phân tích đề bài</h3>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <h5 style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem; font-weight: 700; letter-spacing: 0.05em;">ĐỀ BÀI TIẾNG ANH:</h5>
          <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); white-space: pre-line; background-color: var(--bg-primary); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--panel-border); font-family: inherit;">${promptEn}</div>
        </div>
        <div>
          <h5 style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem; font-weight: 700; letter-spacing: 0.05em;">BẢN DỊCH TIẾNG VIỆT:</h5>
          <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); background-color: var(--bg-primary); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--panel-border); font-family: inherit;">${promptVi}</div>
        </div>
      </div>
    </div>
    
    <div class="reading-section-card">
      <h3>Gợi ý diễn đạt lại chủ đề (Paraphrases)</h3>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Sử dụng các từ đồng nghĩa hoặc cấu trúc khác dưới đây để viết phần mở bài (Introduction) tránh lặp từ khóa của đề:</p>
      ${paraphraseHtml}
    </div>

    ${(topic.details && topic.details.mindmap_img) ? `
      <div class="reading-section-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin-bottom: 0;">Sơ đồ tư duy mở rộng (Mindmap)</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            ${topic.details.mindmap_img_en ? `
              <div class="mindmap-lang-switcher" style="display: inline-flex; background: var(--bg-primary); border: 1px solid var(--panel-border); border-radius: 999px; padding: 2px;">
                <button type="button" class="btn-mindmap-tab active" id="btn-mindmap-vi" style="border: none; background: var(--accent-primary); color: #fff; padding: 3px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" onclick="switchMindmapLang('vi')">🇻🇳 Tiếng Việt</button>
                <button type="button" class="btn-mindmap-tab" id="btn-mindmap-en" style="border: none; background: transparent; color: var(--text-secondary); padding: 3px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" onclick="switchMindmapLang('en')">🇬🇧 English</button>
              </div>
            ` : ''}
            <span style="font-size: 0.8rem; background: rgba(99, 102, 241, 0.15); color: var(--primary); padding: 4px 10px; border-radius: 999px; font-weight: 700;">5 LỰA CHỌN Ý TƯỞNG</span>
          </div>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Học viên có thể tham khảo sơ đồ tư duy dưới đây (bản Tiếng Việt & Tiếng Anh) để tự do lựa chọn các ý mình muốn đưa vào bài viết:</p>
        <div style="text-align: center; background: #fff; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--panel-border); cursor: pointer;" onclick="openActiveMindmapModal()">
          <img id="active-mindmap-img" src="${topic.details.mindmap_img}" alt="Mindmap" style="max-width: 100%; max-height: 480px; object-fit: contain; border-radius: var(--radius-sm);" title="Bấm vào để phóng to">
          <div style="margin-top: 8px; font-size: 0.8rem; color: #64748b; font-weight: 600;">🔍 Bấm vào ảnh để xem kích thước lớn</div>
        </div>
      </div>
    ` : ''}

    ${stanceSelectorHtml}

    ${ideaSelectorHtml}
    
    <div class="reading-section-card">
      <h3>Gợi ý tóm tắt ý tưởng sẽ viết</h3>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">${outlineIntroText}</p>
      ${outlineSummaryHtml}
    </div>

    ${referenceArticlesHtml}
    
    <div style="text-align: right; margin: 1rem 0 2rem 0;">
      <button class="btn btn-primary" style="padding: 0.75rem 2rem; font-size: 1rem; box-shadow: var(--shadow-glow);" onclick="${hasVocabStep() ? "switchStep('vocab')" : "switchStep('trans')"}">
        ${hasVocabStep() ? "TIẾP THEO: BƯỚC 02 - NẠP TỪ VỰNG CHỦ ĐỀ →" : "TIẾP THEO: BƯỚC 02 - TẬP DIỄN ĐẠT Ý TƯỞNG →"}
      </button>
    </div>
  `;
}

// Render Step 4 Model Essays
function renderStep4ModelEssay() {
  const container = document.getElementById('ws-model-step-view');
  if (!container) return;
  container.innerHTML = '';
  
  const topic = currentTopic;
  if (!topic) return;
  
  if (!topic.has_full_details || !topic.details) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 4rem 1.5rem;">
        <h3 style="font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 0.5rem;">Không có bài mẫu</h3>
        <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto; line-height: 1.5;">
          Xin lỗi, chủ đề tự viết tự do này hiện chưa có bài giải mẫu được lưu trữ trong cơ sở dữ liệu.
        </p>
      </div>
    `;
    return;
  }
  
  const essayText = currentSampleLevel === 'B1' ? topic.details.sample_b1 : topic.details.sample_b2;
  const translationText = currentSampleLevel === 'B1' ? topic.details.translation_b1 : topic.details.translation_b2;
  
  const parseMarkdown = (txt) => {
    if (!txt) return '';
    return txt
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  };
  
  const formattedEssay = parseMarkdown(essayText);
  const formattedTrans = parseMarkdown(translationText || 'Đang tải bản dịch...');
  
  let vocabNotesHtml = '';
  if (topic.details.key_vocab_notes && topic.details.key_vocab_notes.length > 0) {
    const listItems = topic.details.key_vocab_notes.map(v => `
      <li><strong>${v.en}</strong>: ${v.vi}</li>
    `).join('');
    vocabNotesHtml = `
      <div class="vocab-notes-card" style="margin-top: 1.5rem;">
        <h4>Cụm từ vựng quan trọng cần lưu ý</h4>
        <ul class="vocab-notes-list">
          ${listItems}
        </ul>
      </div>
    `;
  }
  
  container.innerHTML = `
    <div class="essay-comparison-grid">
      <div class="essay-col">
        <h4>BÀI LUẬN TIẾNG ANH (${currentSampleLevel})</h4>
        <div class="essay-text-content" style="white-space: pre-wrap; font-family: inherit; font-size: 1rem; line-height: 1.7; color: var(--text-primary); text-align: justify;">${formattedEssay}</div>
      </div>
      <div class="essay-col">
        <h4>BẢN DỊCH TIẾNG VIỆT</h4>
        <div class="essay-text-content" style="white-space: pre-wrap; font-family: inherit; font-size: 1rem; line-height: 1.7; color: var(--text-primary); text-align: justify;">${formattedTrans}</div>
      </div>
    ${vocabNotesHtml}
  `;
}

// Function to switch level in Step 4
function switchModelEssayLevel(level) {
  level = 'B2';
  currentSampleLevel = level;
  
  const pillB1 = document.getElementById('ws-model-level-b1');
  const pillB2 = document.getElementById('ws-model-level-b2');
  const targetPill = document.getElementById(`ws-model-level-${level.toLowerCase()}`);
  if (pillB1) pillB1.classList.remove('active');
  if (pillB2) pillB2.classList.remove('active');
  if (targetPill) targetPill.classList.add('active');
  
  renderStep4ModelEssay();
}

// Function to handle Access Gateway & Anti-Cheat Initialization
document.addEventListener('DOMContentLoaded', () => {
  const gateway = document.getElementById('access-gateway');
  const appContainer = document.getElementById('app-container');
  
  // Force login on every page load/refresh
  if (gateway) {
    gateway.classList.remove('hidden-gateway');
    gateway.style.display = 'flex';
  }
  if (appContainer) {
    appContainer.style.display = 'none';
  }

  // Check if current user is locked on reload
  if (isCurrentStudentLocked()) {
    showAccountLockedModal('tab_switch');
  }

  // Restore saved session name & class if student refreshed
  const savedName = sessionStorage.getItem('current_user_name');
  const savedClass = sessionStorage.getItem('current_user_class');
  if (savedName && document.getElementById('gateway-name')) {
    document.getElementById('gateway-name').value = savedName;
  }
  if (savedClass && document.getElementById('gateway-class')) {
    document.getElementById('gateway-class').value = savedClass;
    updateClassAccessUI();
  }
  updateStudentProfileDisplay();
  if (savedName && window.StudentHistorySync && typeof window.StudentHistorySync.pullFromCloud === 'function') {
    window.StudentHistorySync.pullFromCloud(savedName, savedClass || '');
  }

  // Anti-cheat: tab switch & window blur detection (giám sát nghiêm ngặt khi chuyển tab hoặc rời ứng dụng)
  let essayBlurTimeout = null;
  let hasLeftEssayContext = false;
  let leaveEssayReason = '';

  document.addEventListener('visibilitychange', () => {
    if (!isExamModeActive() || isPromptingUser) return;
    if (document.hidden) {
      hasLeftEssayContext = true;
      leaveEssayReason = 'tab_switch';
    } else {
      if (hasLeftEssayContext) {
        hasLeftEssayContext = false;
        handleCheatViolation(leaveEssayReason || 'tab_switch');
      }
    }
  });

  window.addEventListener('blur', () => {
    if (!isExamModeActive() || isPromptingUser) return;
    const modal = document.getElementById('cheat-warning-modal');
    if (modal && modal.style.display !== 'none' && !modal.classList.contains('hidden')) return;

    if (essayBlurTimeout) clearTimeout(essayBlurTimeout);

    // Giám sát nghiêm ngặt: 500ms
    // Đảm bảo bắt trọn mọi hành vi chuyển tab, chia đôi màn hình hay click sang app khác (ChatGPT, Zalo, Google Dịch)
    essayBlurTimeout = setTimeout(() => {
      if (isExamModeActive() && !isPromptingUser) {
        if (!document.hasFocus() || document.hidden) {
          hasLeftEssayContext = true;
          leaveEssayReason = 'window_blur';
        }
      }
    }, 500);
  });

  window.addEventListener('focus', () => {
    if (essayBlurTimeout) {
      clearTimeout(essayBlurTimeout);
      essayBlurTimeout = null;
    }
    if (!isExamModeActive() || isPromptingUser) {
      hasLeftEssayContext = false;
      return;
    }
    if (hasLeftEssayContext) {
      hasLeftEssayContext = false;
      handleCheatViolation(leaveEssayReason || 'window_blur');
    }
  });

  // Anti-cheat: Ngăn chặn triệt để mọi hành vi copy paste vào bài thi
  const essayArea = document.getElementById('essay-textarea');
  if (essayArea) {
    // 1. Chặn dán (paste) trực tiếp trên ô làm bài
    essayArea.addEventListener('paste', (e) => {
      if (isExamModeActive()) {
        e.preventDefault();
        e.stopPropagation();
        handleCheatViolation('paste');
        showToast("🚫 ĐÃ CHẶN DÁN VĂN BẢN! Phòng thi yêu cầu học viên tự gõ từng câu chữ.", "danger");
      }
    }, true);

    // 2. Chặn kéo thả (drag & drop) văn bản từ bên ngoài vào
    essayArea.addEventListener('drop', (e) => {
      if (isExamModeActive()) {
        e.preventDefault();
        e.stopPropagation();
        handleCheatViolation('paste');
        showToast("🚫 ĐÃ CHẶN KÉO THẢ VĂN BẢN! Vui lòng tự gõ nội dung bài viết.", "danger");
      }
    }, true);

    essayArea.addEventListener('dragover', (e) => {
      if (isExamModeActive()) {
        e.preventDefault();
      }
    });

    // 3. Chặn menu chuột phải (contextmenu) trong phòng thi để ngăn dán qua chuột
    essayArea.addEventListener('contextmenu', (e) => {
      if (isExamModeActive()) {
        e.preventDefault();
        showToast("⚠️ Tính năng chuột phải (Dán/Paste) bị vô hiệu hoá trong phòng thi!", "warning");
      }
    });

    // 4. Phát hiện chèn văn bản hàng loạt bất thường (chống auto-typer hoặc script extension)
    let lastExamInputLen = 0;
    essayArea.addEventListener('focus', () => {
      if (isExamModeActive()) lastExamInputLen = essayArea.value.length;
    });
    essayArea.addEventListener('input', (e) => {
      if (isExamModeActive()) {
        const curLen = essayArea.value.length;
        const diff = curLen - lastExamInputLen;
        // Nếu một lần nhập xuất hiện > 50 ký tự trong chớp mắt
        if (diff > 50 && e.inputType !== 'historyUndo') {
          essayArea.value = essayArea.value.slice(0, lastExamInputLen);
          handleCheatViolation('paste');
          showToast("⚠️ Phát hiện chèn văn bản hàng loạt bất thường! Bài thi yêu cầu tự gõ bàn phím.", "danger");
          return;
        }
        lastExamInputLen = curLen;
      }
    });
  }

  // Chặn sự kiện dán ở cấp độ toàn trang (document-level)
  document.addEventListener('paste', (e) => {
    if (isExamModeActive()) {
      e.preventDefault();
      e.stopPropagation();
      handleCheatViolation('paste');
      showToast("🚫 ĐÃ CHẶN DÁN VĂN BẢN! Mọi thao tác dán đều bị ghi nhận.", "danger");
    }
  }, true);

  // Chặn phím tắt Ctrl+V / Cmd+V ở cấp độ toàn trang
  document.addEventListener('keydown', (e) => {
    if (isExamModeActive()) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
        e.preventDefault();
        e.stopPropagation();
        handleCheatViolation('paste');
        showToast("🚫 ĐÃ CHẶN PHÍM TẮT DÁN (Ctrl+V/Cmd+V)!", "danger");
      }
    }
  }, true);

  // Chặn sao chép đề bài/tài liệu ra bên ngoài trong khi thi
  document.addEventListener('copy', (e) => {
    if (isExamModeActive()) {
      const selection = window.getSelection ? window.getSelection().toString() : '';
      if (selection && selection.length > 30) {
        const activeEl = document.activeElement;
        if (activeEl !== essayArea) {
          e.preventDefault();
          showToast("⚠️ Không được phép sao chép đề bài hoặc tài liệu ra ngoài phòng thi!", "warning");
        }
      }
    }
  }, true);
});

const VALID_CLASSES = {
  'CB210': [
    'Nguyễn Võ Thành Đạt',
    'Lê Huỳnh Thanh Duy',
    'Nguyễn Cao Kỳ Duyên',
    'Đào Ngọc Hân',
    'Trần Văn Hữu',
    'Trần Văn Kim Khoa',
    'Nguyễn Thanh Nâng',
    'Huỳnh Kỳ Nguyên',
    'Võ Thị Kim Nguyên',
    'Võ Hùng Sanh',
    'Tiền Thị Thanh Thảo',
    'Trần Thị Thanh Thảo',
    'Đặng Thị Kim Thoa',
    'Trần Thị Tiên Tiên',
    'Lê Kim Tuyền'
  ],
  'CB211': [
    'Hồ Anh Quân',
    'Lê Thành Nghiệp',
    'Lê Khánh Lâm',
    'Huỳnh Thị Ngọc Thắm',
    'Mai Trần Xuân Mai',
    'Lê Thị Uyển Nhi',
    'Nguyễn Thụy Thanh Trúc'
  ],
  'CB213': [
    'Nguyễn Quốc Anh',
    'Hoàng Hợp Minh Châu',
    'Đặng Châu Gia Huy',
    'Trần Minh Tuệ Mẩn',
    'Trần Minh Tuệẫn',
    'Đặng Thị Trúc Măng',
    'Trương Thị Kha My',
    'Ngô Diễm My',
    'Chiêm Chúc Ngân',
    'Huỳnh Thị Yến Nhi',
    'Phạm Nguyễn Tâm Như',
    'Phạm Nhựt Tiến',
    'Phạm Nhật Tiến',
    'Lê Thị Tú Trinh',
    'Trần Ngọc Vinh'
  ],
  'ONB103': [
    'Nguyễn Thị Duy',
    'Phạm Trần Mỹ Hân',
    'Trịnh Thị Thu Hiền',
    'Nguyễn Hoàng Kha',
    'Phạm Thị Út Lụa',
    'Phạm Thị Út Lua',
    'Lê Huỳnh Diễm My',
    'Nguyễn Thị Ngọc Mỹ',
    'Huỳnh Thị Kim Ngân',
    'Trần Thị Kim Ngân',
    'Nguyễn Thị Tiểu Phụng',
    'Trần Yến Phụng',
    'Phạm Ngọc Thạch',
    'Cao Thị Thu Trang',
    'Nguyễn Thị Thanh Tuyền',
    'Trần Phạm Phương Uyên',
    'Trần Ngô Mỹ Vy'
  ],
  'B212': [
    'Nguyễn Duy Hồng Anh',
    'Nguyễn Ngọc Minh Anh',
    'Nguyễn Lê Mỹ Hân',
    'Nguyễn Hồng Minh Huy',
    'Nguyễn Quốc Khải',
    'Đoàn Nguyễn Đình Khang',
    'Lê Nguyễn Gia Khánh',
    'Nguyễn Hữu Khánh',
    'Hồ Thị Ngọc Lan',
    'Trần Thị Hồng Lỉnh',
    'Trần Thị Hồng Lĩnh',
    'Võ Thị Triệu Minh',
    'Hứa Đình Nghi',
    'Võ Thị Bảo Ngọc',
    'Lê Tiến Phát',
    'Nguyễn Hoàng Thông',
    'Trần Hoàng Thông',
    'Nguyễn Kim Tiền',
    'Lê Thị Bảo Trân',
    'Võ Thị Diễm Trinh',
    'Nguyễn Tấn Trung',
    'Nguyễn Tiến Trung',
    'Trần Thị Ánh Tuyết',
    'Đặng Nguyễn Khánh Uyên',
    'Nguyễn Thị Chúc Yến'
  ]
};

const VALID_PASSWORDS = [
  'STUDYHARD',
  'PRACTICEWRITING',
  'VSTEPWRITING',
  'VSTEOWRITING',
  'VSTEPSEPTEMBER',
  'PTMN',
  'GVPTMN',
  'COMINHNGUYET',
  'PTMN2896',
  'PTMN2412',
  'PTMN2805'
];

function cleanGatewayPassword(pwd) {
  return (pwd || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/Ư/g, 'W')
    .replace(/Ơ/g, 'OW')
    .replace(/Ê/g, 'E');
}

function removeVietnameseTones(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normalizeVietnameseName(str) {
  if (!str) return '';
  return str
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function checkIsGiaTue(nameInput) {
  const norm = removeVietnameseTones(normalizeVietnameseName(nameInput));
  return norm.includes('gia tue') || norm.replace(/\s+/g, '').includes('giatue');
}

function checkIsTeacher(nameInput, classInput, passInput) {
  const normName = normalizeVietnameseName(nameInput);
  const noTone = removeVietnameseTones(normName);
  const upPass = cleanGatewayPassword(passInput);
  const upClass = (classInput || '').trim().toUpperCase();

  const teacherKeywords = [
    'ptmn', 'co nguyet', 'miss nguyet', 'pham thi minh nguyet',
    'nguyet pham', 'giao vien', 'teacher', 'admin', 'gv'
  ];
  const teacherPasswords = ['PTMN', 'GVPTMN', 'COMINHNGUYET', 'MISSNGUYET', 'PTMN2896', 'PTMN2412', 'PTMN2805', 'GV', 'TEACHER', 'ADMIN'];

  if (teacherKeywords.includes(noTone) || normName.includes('nguyệt') || normName.includes('nguyet')) return true;
  if (upClass === 'GV' || upClass === 'TEACHER' || upClass === 'ADMIN') return true;
  if (teacherPasswords.includes(upPass)) return true;
  return false;
}

async function submitGatewayAccess() {
  const nameInput = document.getElementById('gateway-name').value.trim();
  let classInput = document.getElementById('gateway-class').value.trim().toUpperCase();
  const passInput = (document.getElementById('gateway-pass')?.value || '').trim();
  const errorEl = document.getElementById('gateway-error');
  const btnSubmit = document.getElementById('btn-gateway-submit');

  if (!nameInput) {
    errorEl.textContent = 'Vui lòng nhập đầy đủ Họ và Tên!';
    errorEl.style.display = 'block';
    return;
  }

  // 1. TEACHER ACCESS (Bypasses all restrictions, always permitted)
  const isTeacher = checkIsTeacher(nameInput, classInput, passInput);
  if (isTeacher) {
    if (!classInput) classInput = 'GV';
    try {
      localStorage.removeItem('vstep_is_account_locked');
      localStorage.removeItem('vstep_locked_student_name');
    } catch(e) {}

    errorEl.style.display = 'none';
    const teacherName = nameInput || 'Cô Nguyệt (PTMN)';
    sessionStorage.setItem('current_user_name', teacherName);
    sessionStorage.setItem('current_user_class', 'GV');

    const gateway = document.getElementById('access-gateway');
    const appContainer = document.getElementById('app-container');
    if (gateway) {
      gateway.classList.add('hidden-gateway');
      gateway.style.setProperty('display', 'none', 'important');
    }
    if (appContainer) {
      appContainer.style.setProperty('display', 'flex', 'important');
    }
    updateClassAccessUI();
    updateStudentProfileDisplay();
    if (window.StudentHistorySync && typeof window.StudentHistorySync.pullFromCloud === 'function') {
      window.StudentHistorySync.pullFromCloud(teacherName, 'GV');
    }
    if (window.StudentHistorySync && typeof window.StudentHistorySync.onTeacherLoggedIn === 'function') {
      window.StudentHistorySync.onTeacherLoggedIn();
    }
    startSessionTracking(teacherName, classInput || 'GV', true);
    if (window.CB210StreakGuard && typeof window.CB210StreakGuard.onTeacherLoggedIn === 'function') {
      window.CB210StreakGuard.onTeacherLoggedIn();
    }
    showToast(`Chào mừng Giáo viên ${teacherName} đã đăng nhập hệ thống!`, 'success');

    // Post teacher entry in background
    const now = new Date();
    const timeString = now.toLocaleTimeString('vi-VN') + ' ' + now.toLocaleDateString('vi-VN');
    sendTrackingReport(`[GIÁO VIÊN] ${teacherName} - Lớp ${classInput} - Đăng nhập lúc ${timeString}`);
    return;
  }

  // 2. CHECK SPECIFIC STUDENT ACCOUNT LOCK
  if (checkIsGiaTue(nameInput)) {
    errorEl.textContent = 'Tài khoản học viên "Gia Tuệ" hiện đã bị KHÓA! Vui lòng liên hệ Giáo viên (Cô Nguyệt).';
    errorEl.style.display = 'block';
    return;
  }
  const lockKey = getStudentLockKey(nameInput);
  const lockDataRaw = localStorage.getItem(lockKey);
  let isTargetLocked = false;
  if (lockDataRaw) {
    try {
      const parsed = JSON.parse(lockDataRaw);
      if (parsed && parsed.locked === true) isTargetLocked = true;
    } catch(e) { isTargetLocked = false; }
  }
  if (isTargetLocked) {
    sessionStorage.setItem('current_user_name', nameInput);
    sessionStorage.setItem('current_user_class', classInput);
    showAccountLockedModal('tab_switch');
    return;
  }

  // 3. STUDENT VALIDATION
  let cleanClass = (classInput || '')
    .replace(/^(LỚP|LOP|CLASS)\s*/i, '')
    .trim();
  const noToneClass = removeVietnameseTones(cleanClass.toLowerCase()).replace(/[^a-z0-9]/g, '').toUpperCase();

  if (checkIsGiaTue(nameInput) || noToneClass === 'B2' || noToneClass.includes('GIATUE')) {
    errorEl.textContent = 'Tài khoản học viên "Gia Tuệ" hiện đã bị KHÓA! Vui lòng liên hệ Giáo viên (Cô Nguyệt).';
    errorEl.style.display = 'block';
    return;
  }

  if (!classInput) {
    errorEl.textContent = 'Vui lòng nhập Mã lớp học!';
    errorEl.style.display = 'block';
    return;
  }

  if (noToneClass === '0NB103') {
    cleanClass = 'ONB103';
  } else {
    cleanClass = noToneClass;
  }

  const ALLOWED_CLASS_KEYS = ['CB210', 'CB211', 'CB213', 'ONB103', '0NB103', 'B212'];
  if (!ALLOWED_CLASS_KEYS.includes(cleanClass)) {
    errorEl.textContent = 'Hệ thống hiện chỉ mở cho các lớp: CB210, CB211, CB213, ONB103, B212!';
    errorEl.style.display = 'block';
    return;
  }

      let matchedName = nameInput;
  const normInput = normalizeVietnameseName(nameInput);
  const noToneInput = removeVietnameseTones(normInput);

  const roster = VALID_CLASSES[cleanClass] || [];
  const found = roster.find(st => {
    const normSt = normalizeVietnameseName(st);
    const noToneSt = removeVietnameseTones(normSt);
    return normSt === normInput || noToneSt === noToneInput;
  });

  if (found) {
    matchedName = found;
    classInput = cleanClass;
  } else {
    errorEl.textContent = 'Họ và tên "' + nameInput + '" không có trong danh sách lớp ' + cleanClass + '. Vui lòng kiểm tra lại!';
    errorEl.style.display = 'block';
    return;
  }

  if (!passInput) {
    errorEl.textContent = 'Vui lòng nhập Mật khẩu truy cập!';
    errorEl.style.display = 'block';
    return;
  }

  if (!VALID_PASSWORDS.includes(cleanGatewayPassword(passInput))) {
    errorEl.textContent = 'Mật khẩu không chính xác! Vui lòng kiểm tra lại (mật khẩu mặc định: STUDYHARD).';
    errorEl.style.display = 'block';
    return;
  }

  // 4. CB210 DAILY WRITING STREAK GUARD (Google Sheets Cloud Check)
  if (classInput === 'CB210' && window.CB210StreakGuard && typeof window.CB210StreakGuard.checkStudentLogin === 'function') {
    const origBtnHtml = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span>ĐANG KIỂM TRA CHUYÊN CẦN CB210...</span><i class="fa-solid fa-spinner fa-spin"></i>';
    }
    const streakRes = await window.CB210StreakGuard.checkStudentLogin(matchedName, 'CB210');
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = origBtnHtml;
    }
    if (!streakRes || !streakRes.allowed) {
      errorEl.style.display = 'none';
      return;
    }
  } else if (window.CB210StreakGuard && typeof window.CB210StreakGuard.onLogout === 'function') {
    window.CB210StreakGuard.onLogout();
  }

  // SUCCESSFUL STUDENT LOGIN
  errorEl.style.display = 'none';
  sessionStorage.setItem('current_user_name', matchedName);
  sessionStorage.setItem('current_user_class', classInput);

  // Instantly allow access into the workspace
  const gateway = document.getElementById('access-gateway');
  const appContainer = document.getElementById('app-container');
  if (gateway) {
    gateway.classList.add('hidden-gateway');
    gateway.style.setProperty('display', 'none', 'important');
  }
  if (appContainer) {
    appContainer.style.setProperty('display', 'flex', 'important');
  }
  updateClassAccessUI();
  updateStudentProfileDisplay();
  if (window.StudentHistorySync && typeof window.StudentHistorySync.onLogout === 'function') {
    window.StudentHistorySync.onLogout();
  }
  if (window.StudentHistorySync && typeof window.StudentHistorySync.pullFromCloud === 'function') {
    window.StudentHistorySync.pullFromCloud(matchedName, classInput);
  }
  startSessionTracking(matchedName, classInput, false);
  renderDashboard();
  showToast(`Chào mừng ${matchedName} đã đến với lớp học!`, 'success');

  // Attendance log in background
  const now = new Date();
  const timeString = now.toLocaleTimeString('vi-VN') + ' ' + now.toLocaleDateString('vi-VN');
  sendTrackingReport(`${matchedName} - Lớp ${classInput} - Đã truy cập hệ thống lúc ${timeString}`);
}

function updateStudentProfileDisplay() {
  const nameEl = document.getElementById('studentNameDisplay');
  const classEl = document.getElementById('studentClassDisplay');
  const avatarIcon = document.getElementById('studentAvatarIcon');
  const userName = sessionStorage.getItem('current_user_name');
  const userClass = sessionStorage.getItem('current_user_class');
  const isTeacher = userClass === 'GV' || (userName && (userName === 'PTMN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))));
  
  if (nameEl) {
    nameEl.textContent = userName || 'Chưa đăng nhập';
    nameEl.title = userName || '';
  }
  if (classEl) {
    if (isTeacher) {
      classEl.innerHTML = '<span class="badge-class" style="background: rgba(16,185,129,0.15); color: #059669;">Giáo viên (GV)</span>';
    } else {
      classEl.innerHTML = `<span class="badge-class">${userClass ? 'Lớp: ' + userClass : 'Lớp: --'}</span>`;
    }
  }
  if (avatarIcon) {
    avatarIcon.innerHTML = isTeacher ? '<i class="fa-solid fa-chalkboard-user"></i>' : '<i class="fa-solid fa-user-graduate"></i>';
  }
}

function reopenGateway() {
  if (confirm('Bạn có muốn đăng xuất và đổi thông tin tài khoản không?')) {
    if (window.StudentHistorySync && typeof window.StudentHistorySync.flushOnExit === 'function') {
      window.StudentHistorySync.flushOnExit();
    }
    if (window.StudentHistorySync && typeof window.StudentHistorySync.onLogout === 'function') {
      window.StudentHistorySync.onLogout();
    }
    sendExitSessionReport('logout');
    sessionStorage.removeItem('current_user_name');
    sessionStorage.removeItem('current_user_class');
    if (window.CB210StreakGuard && typeof window.CB210StreakGuard.onLogout === 'function') {
      window.CB210StreakGuard.onLogout();
    }
    const gateway = document.getElementById('access-gateway');
    const appContainer = document.getElementById('app-container');
    if (gateway) {
      gateway.classList.remove('hidden-gateway');
      gateway.style.setProperty('display', 'flex', 'important');
    }
    if (appContainer) {
      appContainer.style.setProperty('display', 'none', 'important');
    }
    updateStudentProfileDisplay();
  }
}

// Mobile Sidebar Helpers
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}


// Check if a category (1..4) is allowed for current student/class
function isCategoryAllowedForUser(catId) {
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';

  // Teachers always have access to all categories
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return true;
  }

  // Class B212: ONLY Category 1 is opened; Categories 2, 3, 4 are locked
  if (userClass === 'B212') {
    return catId === 1 || String(catId) === '1';
  }

  // Classes ONB103, 0NB103, CB211, CB213: Categories 1 & 2 are opened
  if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
    return catId === 1 || catId === 2 || String(catId) === '1' || String(catId) === '2';
  }

  // CB210: all categories 1, 2, 3, 4 are opened
  if (userClass === 'CB210') {
    return true;
  }

  return true;
}

// Check if a topic is allowed for current student/class
function isTopicAllowedForUser(catId, topicId, topic) {
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';

  // Teachers always have access to all topics
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return true;
  }

  // Category must be allowed first
  if (typeof isCategoryAllowedForUser === 'function' && !isCategoryAllowedForUser(catId)) {
    return false;
  }

  // Class B212: in Category 1 (TYPE 01), ALL topics are opened; all other categories are locked
  if (userClass === 'B212') {
    return catId === 1 || String(catId) === '1';
  }

  // Classes ONB103, 0NB103, CB211, CB213:
  // - Category 1: ALL topics are unlocked
  // - Category 2: ONLY topics analyzing "Nguyên nhân & Giải pháp" OR "Nguyên nhân & Ảnh hưởng" are unlocked, plus Topic 16 (Khởi nghiệp ở giới trẻ) & Topic 28 (Tội phạm mạng); other topics remain locked
  if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
    if (catId === 1 || String(catId) === '1') return true;
    if (catId === 2 || String(catId) === '2') {
      const tid = Number(topicId || (topic ? topic.id : 0));
      const allowedCat2Ids = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 23, 24, 27, 30, 32, 33, 34, 36, 37, 40, 41, 42, 43];
      if (allowedCat2Ids.includes(tid)) return true;
      if (topic) {
        const subtype = typeof getTopicSubtypeLabel === 'function' ? getTopicSubtypeLabel(topic, 2) : '';
        if (subtype === 'NGUYÊN NHÂN & GIẢI PHÁP' || subtype === 'NGUYÊN NHÂN & ẢNH HƯỞNG') return true;
      }
      // Additionally open Topic 16 (Khởi nghiệp ở giới trẻ) and Topic 28 (Tội phạm mạng) in Category 2
      if (tid === 16 || tid === 28) {
        return true;
      }
      return false;
    }
    return false;
  }

  return true;
}

// Check if a workspace step ('read', 'vocab', 'trans', 'write', 'model') is allowed for current student/class
function isStepAllowedForUser(stepKey, catId, topicId, topic) {
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';

  // Teachers always have access to all steps
  if (userClass === 'GV' || userClass === 'TEACHER' || userClass === 'ADMIN' || (typeof checkIsTeacher === 'function' && checkIsTeacher(userName, userClass, ''))) {
    return true;
  }

  // Class B212:
  // - Category 1 (TYPE 01): ALL topics have ALL steps (1..5) unlocked!
  // - Categories 2, 3, 4: locked
  if (userClass === 'B212') {
    if (catId === 1 || String(catId) === '1') {
      return true; // All steps 1..5 unlocked for all topics in Category 1!
    }
    if (stepKey === 'write' || stepKey === 'model') {
      return false;
    }
  }

  // Classes CB211, ONB103, 0NB103, CB213:
  // - Category 1: ALL steps unlocked
  // - Category 2: ALL allowed topics (including Topic 16 & 28) have ALL steps (1..5) unlocked
  if (['CB211', 'ONB103', '0NB103', 'CB213'].includes(userClass)) {
    if (catId === 1 || String(catId) === '1') return true;
    if (catId === 2 || String(catId) === '2') {
      if (typeof isTopicAllowedForUser === 'function') {
        return isTopicAllowedForUser(catId, topicId, topic);
      }
      return true;
    }
  }

  return true;
}

// Class-based Feature Restriction Handler
function updateClassAccessUI() {
  const userClass = (sessionStorage.getItem('current_user_class') || '').toUpperCase();
  const userName = sessionStorage.getItem('current_user_name') || '';
  const isCB210 = (userClass === 'CB210');
  const isB212 = (userClass === 'B212');
  
  // Category 1, 2, 3 & 4 lock/unlock based on isCategoryAllowedForUser
  [1, 2, 3, 4].forEach(catId => {
    const link = document.getElementById(`nav-link-cat-${catId}`);
    if (!link) return;

    const existingBadge = link.querySelector('.cat-lock-badge');
    if (existingBadge) existingBadge.remove();

    if (!isCategoryAllowedForUser(catId)) {
      link.classList.add('is-locked');
      let lockMsg = 'Dạng luận này tạm thời chưa mở';
      if (isB212) {
        lockMsg = 'Dạng luận này tạm thời chưa mở cho lớp B212 (Hiện tại lớp mở tất cả các đề thuộc DẠNG LUẬN 01)';
      } else if (['ONB103', '0NB103', 'CB211', 'CB213'].includes(userClass)) {
        lockMsg = `Dạng luận này tạm thời chưa mở cho lớp ${userClass} (Hiện tại lớp đã mở DẠNG LUẬN 01 & 02)`;
      } else if (isCB210) {
        lockMsg = 'Dạng luận này chưa mở cho lớp CB210 (Hiện lớp mở DẠNG 01, 02 & 03)';
      }
      link.setAttribute('title', lockMsg);
      const badge = document.createElement('span');
      badge.className = 'cat-lock-badge';
      badge.innerHTML = '🔒 Khoá';
      link.appendChild(badge);
    } else {
      link.classList.remove('is-locked');
      link.removeAttribute('title');
    }
  });

  if (currentCategory && !isCategoryAllowedForUser(currentCategory.id)) {
    switchCategory(1);
  }
}

function toggleGatewayPasswordVisibility() {
  const pwdInput = document.getElementById('gateway-pass');
  const icon = document.getElementById('toggle-gateway-pwd-icon');
  if (!pwdInput) return;
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    if (icon) {
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
    }
  } else {
    pwdInput.type = 'password';
    if (icon) {
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    }
  }
}
window.toggleGatewayPasswordVisibility = toggleGatewayPasswordVisibility;

/* ==========================================================================
   RANDOM TOPIC PICKER (CHỌN NGẪU NHIÊN 1 ĐỀ LUYỆN TẬP)
   ========================================================================== */
let randomPickerScope = 'all';
let randomPickerUnwrittenOnly = true;
let randomPickedItem = null;
let randomRollTimer = null;

function getEligibleRandomTopics(scope, unwrittenOnly) {
  if (typeof ESSAY_DATA === 'undefined' || !Array.isArray(ESSAY_DATA)) return [];
  const allEligible = [];
  ESSAY_DATA.forEach(cat => {
    if (scope !== 'all' && String(cat.id) !== String(scope)) return;
    (cat.topics || []).forEach(t => {
      if (!t.has_full_details) return;
      const allowed = typeof isTopicAllowedForUser === 'function'
        ? isTopicAllowedForUser(cat.id, t.id, t)
        : true;
      if (!allowed) return;
      allEligible.push({ catId: cat.id, catTitle: cat.title_vi || cat.title_en || `Dạng 0${cat.id}`, topic: t });
    });
  });

  if (unwrittenOnly) {
    const unwritten = allEligible.filter(item => !isTopicWritten(item.catId, item.topic.id));
    if (unwritten.length > 0) {
      return { pool: unwritten, totalUnlocked: allEligible.length, fallbackAllWritten: false };
    }
    return { pool: allEligible, totalUnlocked: allEligible.length, fallbackAllWritten: allEligible.length > 0 };
  }
  return { pool: allEligible, totalUnlocked: allEligible.length, fallbackAllWritten: false };
}

function renderRandomScopeBar() {
  const bar = document.getElementById('random-scope-bar');
  if (!bar || typeof ESSAY_DATA === 'undefined') return;

  const scopes = [
    { id: 'all', label: '✨ Tất cả dạng' },
    { id: 1, label: 'Dạng 01: Adv/Disadv' },
    { id: 2, label: 'Dạng 02: Causes/Solutions' },
    { id: 3, label: 'Dạng 03: Opinion' },
    { id: 4, label: 'Dạng 04: Discussion' }
  ];

  bar.innerHTML = scopes.map(sc => {
    const res = getEligibleRandomTopics(sc.id, false);
    const active = String(randomPickerScope) === String(sc.id);
    return `
      <button type="button" class="random-scope-pill ${active ? 'is-active' : ''}" onclick="setRandomScope('${sc.id}')">
        <span>${sc.label}</span>
        <span class="scope-cnt">${res.totalUnlocked}</span>
      </button>
    `;
  }).join('');
}

function renderRandomResultCard(item, meta) {
  const box = document.getElementById('random-result-box');
  const startBtn = document.getElementById('btn-random-start');
  const rerollBtn = document.getElementById('btn-random-reroll');
  const poolInfo = document.getElementById('random-pool-info');
  if (!box) return;

  if (poolInfo) {
    if (meta && meta.totalUnlocked > 0) {
      poolInfo.textContent = meta.fallbackAllWritten
        ? `Đã hoàn thành hết ${meta.totalUnlocked} đề — ôn tập lại`
        : `${meta.pool.length} đề khả dụng`;
    } else {
      poolInfo.textContent = '0 đề khả dụng';
    }
  }

  if (!item) {
    box.innerHTML = `
      <div class="random-empty-state">
        <div style="font-size: 2rem; margin-bottom: 0.45rem;">🔒</div>
        <div style="font-weight: 700; margin-bottom: 0.35rem;">Chưa có đề mở khóa trong dạng bài này</div>
        <div style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 0.85rem;">
          Bạn có thể chuyển sang <strong>Tất cả dạng</strong> để bốc thăm trong các đề đã mở khóa cho lớp mình.
        </div>
        ${randomPickerScope !== 'all' ? `<button type="button" class="btn-random-reroll" onclick="setRandomScope('all')">✨ Chọn từ Tất cả dạng</button>` : ''}
      </div>
    `;
    if (startBtn) startBtn.disabled = true;
    if (rerollBtn) rerollBtn.disabled = true;
    return;
  }

  if (startBtn) startBtn.disabled = false;
  if (rerollBtn) rerollBtn.disabled = meta && meta.pool.length <= 1;

  const t = item.topic;
  const isWritten = isTopicWritten(item.catId, t.id);
  const catNames = {
    1: 'Dạng 01 • Thuận lợi & Bất lợi',
    2: 'Dạng 02 • Nguyên nhân – Ảnh hưởng – Giải pháp',
    3: 'Dạng 03 • Quan điểm (Opinion)',
    4: 'Dạng 04 • Thảo luận (Discussion)'
  };
  const catColors = { 1: '#4f46e5', 2: '#8b5cf6', 3: '#059669', 4: '#d97706' };
  const accent = catColors[item.catId] || '#4f46e5';
  const rawTag = Array.isArray(t.tags) ? t.tags.join(' • ') : (t.tags || '');
  const previewText = (t.context || t.prompt || '').trim();

  box.innerHTML = `
    <div class="random-picked-inner" style="--picked-accent: ${accent}">
      <div class="random-picked-badges">
        <span class="random-cat-badge">${catNames[item.catId] || item.catTitle}</span>
        <span class="random-id-badge">Đề #${String(t.id).padStart(2, '0')}</span>
        ${rawTag ? `<span class="random-tag-badge">${rawTag}</span>` : ''}
        <span class="random-status-badge ${isWritten ? 'is-done' : ''}">${isWritten ? '✓ Đã viết' : '○ Chưa viết'}</span>
      </div>
      <div class="random-picked-vi">${t.title_vi || t.title_en}</div>
      <div class="random-picked-en">${t.title_en}</div>
      ${previewText ? `<div class="random-picked-preview">${previewText}</div>` : ''}
      ${meta && meta.fallbackAllWritten ? `<div class="random-fallback-note">🎉 Bạn đã luyện xong tất cả đề trong nhóm này — hệ thống chọn lại ngẫu nhiên để bạn ôn tập!</div>` : ''}
    </div>
  `;
}

function rollRandomTopic(animate) {
  if (randomRollTimer) {
    clearInterval(randomRollTimer);
    randomRollTimer = null;
  }
  const meta = getEligibleRandomTopics(randomPickerScope, randomPickerUnwrittenOnly);
  if (!meta.pool || meta.pool.length === 0) {
    randomPickedItem = null;
    renderRandomResultCard(null, meta);
    return;
  }

  const pickOne = (avoidCurrent) => {
    let candidates = meta.pool;
    if (avoidCurrent && randomPickedItem && candidates.length > 1) {
      candidates = candidates.filter(c => !(c.catId === randomPickedItem.catId && c.topic.id === randomPickedItem.topic.id));
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  };

  const finalPick = pickOne(true);
  const box = document.getElementById('random-result-box');

  if (animate && box && meta.pool.length > 1) {
    box.classList.add('is-rolling');
    let ticks = 0;
    randomRollTimer = setInterval(() => {
      ticks++;
      if (ticks < 5) {
        const tempPick = meta.pool[Math.floor(Math.random() * meta.pool.length)];
        renderRandomResultCard(tempPick, meta);
      } else {
        clearInterval(randomRollTimer);
        randomRollTimer = null;
        randomPickedItem = finalPick;
        renderRandomResultCard(finalPick, meta);
        box.classList.remove('is-rolling');
      }
    }, 65);
  } else {
    randomPickedItem = finalPick;
    renderRandomResultCard(finalPick, meta);
  }
}

function openRandomTopicModal(defaultScope) {
  const modal = document.getElementById('random-topic-modal');
  if (!modal) return;
  randomPickerScope = (defaultScope !== undefined && defaultScope !== null) ? defaultScope : 'all';
  const cb = document.getElementById('random-unwritten-only');
  if (cb) randomPickerUnwrittenOnly = cb.checked;

  // If the requested category has 0 unlocked full topics, fall back smoothly to 'all'
  if (randomPickerScope !== 'all') {
    const check = getEligibleRandomTopics(randomPickerScope, false);
    if (check.totalUnlocked === 0) {
      randomPickerScope = 'all';
    }
  }

  renderRandomScopeBar();
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  rollRandomTopic(true);
}

function closeRandomTopicModal() {
  const modal = document.getElementById('random-topic-modal');
  if (modal) modal.classList.remove('is-open');
  document.body.style.overflow = '';
  if (randomRollTimer) {
    clearInterval(randomRollTimer);
    randomRollTimer = null;
  }
}

function setRandomScope(scope) {
  randomPickerScope = scope === 'all' ? 'all' : Number(scope);
  renderRandomScopeBar();
  rollRandomTopic(true);
}

function toggleRandomUnwrittenOnly() {
  const cb = document.getElementById('random-unwritten-only');
  randomPickerUnwrittenOnly = cb ? cb.checked : true;
  rollRandomTopic(true);
}

function startPickedRandomTopic() {
  if (!randomPickedItem) return;
  const { catId, topic } = randomPickedItem;
  closeRandomTopicModal();
  if (typeof showToast === 'function') {
    showToast(`🎲 Bắt đầu luyện đề #${topic.id}: ${topic.title_vi || topic.title_en}`, 'info');
  }
  startPractice(catId, topic.id);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('random-topic-modal');
    if (modal && modal.classList.contains('is-open')) {
      closeRandomTopicModal();
    }
  }
});

/* ==========================================================================
   STEP 4 PRE-WRITE CONFIRMATION MODAL (XÁC NHẬN HOÀN THÀNH BƯỚC 1, 2, 3)
   ========================================================================== */
function openStep4ConfirmModal() {
  const modal = document.getElementById('step4-confirm-modal');
  const feedbackEl = document.getElementById('step4-modal-feedback');
  if (!modal) return;
  if (feedbackEl) {
    feedbackEl.style.display = 'none';
    feedbackEl.className = 'step4-modal-feedback';
    feedbackEl.innerHTML = '';
  }
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeStep4ConfirmModal() {
  const modal = document.getElementById('step4-confirm-modal');
  if (modal) modal.classList.remove('is-open');
  document.body.style.overflow = '';
}

function jumpToPrepStepFromModal(stepKey) {
  closeStep4ConfirmModal();
  switchStep(stepKey);
}

function buildStep4QuickJumpButtons(missingList) {
  const withVocab = typeof hasVocabStep === 'function' ? hasVocabStep() : true;
  const joined = (missingList || []).join(' ').toUpperCase();
  const btns = [];
  if (!joined || joined.includes('BƯỚC 01')) {
    btns.push(`<button type="button" class="btn-step4-jump" onclick="jumpToPrepStepFromModal('read')">📖 Về Bước 1 (Đọc hiểu)</button>`);
  }
  if (withVocab && (!joined || joined.includes('BƯỚC 02'))) {
    btns.push(`<button type="button" class="btn-step4-jump" onclick="jumpToPrepStepFromModal('vocab')">🔤 Sang Bước 2 (Từ vựng)</button>`);
  }
  if (!joined || joined.includes('BƯỚC 03')) {
    btns.push(`<button type="button" class="btn-step4-jump" onclick="jumpToPrepStepFromModal('trans')">✍️ Sang Bước 3 (Luyện dịch)</button>`);
  }
  return btns.length > 0 ? `<div class="step4-jump-row">${btns.join('')}</div>` : '';
}

function handleStep4ConfirmYes() {
  if (!currentTopic) return;
  const catId = currentCategory ? currentCategory.id : 0;
  const topicId = currentTopic ? currentTopic.id : 0;
  const feedbackEl = document.getElementById('step4-modal-feedback');

  // Kiểm tra LỊCH SỬ THỰC TẾ của Bước 1, 2, 3 (không chỉ tin vào lời xác nhận)
  const gate = (typeof getSequentialStepGate === 'function')
    ? getSequentialStepGate('write', catId, topicId, currentTopic)
    : { allowed: true, missing: [] };

  if (gate && gate.allowed) {
    closeStep4ConfirmModal();
    if (typeof showToast === 'function') {
      showToast('✅ Đã xác nhận lịch sử hoàn thành Bước 1–2–3! Chúc bạn viết bài thật tốt!', 'success');
    }
    switchStep('write', { skipStep4Confirm: true });
    return;
  }

  // Chưa có đủ lịch sử hoàn thành Bước 1, 2, 3 -> KHÔNG CHO VÀO & hiện chi tiết bước còn thiếu
  const missingItems = (gate && Array.isArray(gate.missing) && gate.missing.length > 0)
    ? gate.missing
    : ['Chưa có lịch sử hoàn thành đủ Bước 1, Bước 2 và Bước 3 cho đề bài này.'];

  if (feedbackEl) {
    feedbackEl.className = 'step4-modal-feedback is-error';
    feedbackEl.innerHTML = `
      <div class="step4-fb-title">⛔ Hệ thống chưa ghi nhận đủ lịch sử hoàn thành BƯỚC 1, 2, 3!</div>
      <p class="step4-fb-sub">Bạn cần có lịch sử học thực tế các mục sau trước khi vào BƯỚC 4:</p>
      <ul class="step4-fb-list">
        ${missingItems.map(item => `<li>${item}</li>`).join('')}
      </ul>
      ${buildStep4QuickJumpButtons(missingItems)}
    `;
    feedbackEl.style.display = 'block';
  }
  if (typeof showToast === 'function') {
    showToast('🔒 Chưa có đủ lịch sử hoàn thành Bước 1, 2, 3! Hãy hoàn thành các bước còn thiếu trước nhé.', 'warning');
  }
}

function handleStep4ConfirmNo() {
  const feedbackEl = document.getElementById('step4-modal-feedback');
  const catId = currentCategory ? currentCategory.id : 0;
  const topicId = currentTopic ? currentTopic.id : 0;
  const gate = (currentTopic && typeof getSequentialStepGate === 'function')
    ? getSequentialStepGate('write', catId, topicId, currentTopic)
    : { allowed: false, missing: [] };

  if (feedbackEl) {
    feedbackEl.className = 'step4-modal-feedback is-remind';
    feedbackEl.innerHTML = `
      <div class="step4-fb-title">📌 Nhắc nhở: Hãy hoàn thành BƯỚC 1, 2, 3 trước nhé!</div>
      <p class="step4-fb-sub">
        Bạn chưa thể vào <strong>BƯỚC 4 (Viết bài luận)</strong> khi chưa học xong các bước chuẩn bị.
        Hãy đọc kỹ đề, nạp từ vựng và luyện dịch câu ở <strong>Bước 1, 2, 3</strong> rồi quay lại viết bài nhé!
      </p>
      ${buildStep4QuickJumpButtons(gate && gate.missing ? gate.missing : [])}
    `;
    feedbackEl.style.display = 'block';
  }
  if (typeof showToast === 'function') {
    showToast('📌 Hãy hoàn thành BƯỚC 1, 2, 3 trước khi vào BƯỚC 4 nhé!', 'warning');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('step4-confirm-modal');
    if (modal && modal.classList.contains('is-open')) {
      closeStep4ConfirmModal();
    }
  }
});

/* ==========================================================================
   CUTE STUDY CAT GRAPHICS & INTERACTIVE SIDEBAR BUDDY
   ========================================================================== */
const SIDEBAR_CAT_QUOTES = [
  'Meow~ Hôm nay bạn viết 1 bài cho mượt tay nhé! 🐾',
  'Đừng bỏ qua Bước 1–2–3 nha, mình canh cửa đó! 😼',
  'Mỗi ngày 1 bài luận — B1/B2 trong tầm tay! ✨',
  'Bí đề? Bấm 🎲 Ngẫu nhiên 1 đề thử vận may xem! 🎲',
  'Đọc kỹ đề + chọn 3 ý rõ ràng là thắng 50% rồi! 💡',
  'Gõ đều tay đủ ≥ 250 từ là mình tặng 10 điểm chăm chỉ! 🏆',
  'Đừng quên uống nước và giữ thẳng lưng khi viết nha! ☕',
  'Collocations ở Bước 2 chính là bí kíp ăn điểm đó! 📖',
  'Viết xong nhớ xem Bước 5 để học thêm cách diễn đạt hay! 🌟',
  'Cố lên nhé! Miss Nguyệt và tụi mình luôn cổ vũ bạn! 💜'
];
let sidebarCatQuoteIdx = 0;

function pokeSidebarCat() {
  const bubble = document.getElementById('sidebar-cat-bubble');
  const img = document.getElementById('sidebar-cat-img');
  if (bubble) {
    sidebarCatQuoteIdx = (sidebarCatQuoteIdx + 1) % SIDEBAR_CAT_QUOTES.length;
    bubble.textContent = SIDEBAR_CAT_QUOTES[sidebarCatQuoteIdx];
    bubble.classList.remove('is-pop');
    void bubble.offsetWidth;
    bubble.classList.add('is-pop');
  }
  if (img) {
    img.classList.remove('is-bouncing');
    void img.offsetWidth;
    img.classList.add('is-bouncing');
  }
}

function updateCategoryCatBanner(catId) {
  const img = document.getElementById('category-cat-img');
  const kicker = document.getElementById('category-kicker-pill');
  const tip = document.getElementById('category-cat-tip');
  const card = document.getElementById('category-intro-card');

  const cfg = {
    1: {
      img: 'cat_pros_cons.png',
      kicker: '🐾 DẠNG LUẬN 01 • ADVANTAGES & DISADVANTAGES',
      tip: '💡 Mẹo mèo: Cân đối số ý rõ ràng giữa mặt Thuận lợi & Bất lợi (hoặc đi sâu 3 ý với đề 1 chiều) nhé!',
      accent: '#4f46e5',
      wide: false
    },
    2: {
      img: 'cat_study_desk.png',
      kicker: '🐾 DẠNG LUẬN 02 • CAUSES – EFFECTS – SOLUTIONS',
      tip: '💡 Mẹo mèo: Xem kỹ nhóm dạng bài (Nguyên nhân / Ảnh hưởng / Giải pháp) để triển khai đúng trọng tâm nhé!',
      accent: '#8b5cf6',
      wide: false
    },
    3: {
      img: 'cat_opinion.png',
      kicker: '🐾 DẠNG LUẬN 03 • OPINION ESSAYS',
      tip: '💡 Mẹo mèo: Khẳng định rõ lập trường Đồng ý hay Phản đối ngay từ Mở bài và giữ xuyên suốt bài viết nha!',
      accent: '#059669',
      wide: false
    },
    4: {
      img: 'welcome_cats.png',
      kicker: '🐾 DẠNG LUẬN 04 • DISCUSSION ESSAYS',
      tip: '💡 Mẹo mèo: Bàn luận công bằng cả 2 quan điểm trước khi chốt quan điểm cá nhân thật thuyết phục nhé!',
      accent: '#d97706',
      wide: true
    }
  }[Number(catId)] || null;

  if (!cfg) return;
  if (img) {
    img.src = cfg.img;
    img.classList.toggle('is-wide-squad', Boolean(cfg.wide));
  }
  if (kicker) kicker.textContent = cfg.kicker;
  if (tip) tip.textContent = cfg.tip;
  if (card) card.style.setProperty('--cat-banner-accent', cfg.accent);
}
