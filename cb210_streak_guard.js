/**
 * ============================================================================
 * CB210 DAILY WRITING STREAK GUARD & TEACHER ADMIN PANEL
 * Dự án: PHÒNG LUYỆN VIẾT LUẬN VSTEP B1 & B2 (English with Miss Nguyet)
 * Kết nối Google Sheets (Apps Script Web App) để:
 * - Yêu cầu học viên lớp CB210 viết ít nhất 1 bài luận hoàn chỉnh (>= 250 từ) mỗi ngày
 * - Tự động khóa truy cập nếu bỏ lỡ ngày viết (đồng bộ trên mọi thiết bị & ẩn danh)
 * - Cho phép học viên gửi lời nhắn xin cô Nguyệt mở khóa ngay trên màn hình đăng nhập
 * - Cung cấp Bảng Quản lý chuyên cần CB210 ngay trong giao diện Giáo viên
 * ============================================================================
 */
(function (root) {
  'use strict';

  // Dán link Google Apps Script Web App sau khi deploy (dạng https://script.google.com/macros/s/.../exec)
  const DEFAULT_CB210_STREAK_API_URL = 'https://script.google.com/macros/s/AKfycbz735OePTK8ODIO_XFwznnRe1Ngy1RYdx56wmUdHYoSSub6Qzt2kX6WYKf7tIKlS-nY/exec';
  const TEACHER_ADMIN_KEY = 'PTMN_VSTEP_2026';
  const LS_URL_OVERRIDE_KEY = 'vstep_cb210_streak_api_url_override';
  const LS_CACHE_PREFIX = 'vstep_cb210_streak_cache_';

  function detectCourseLevel() {
    try {
      const t = (document.title || '').toUpperCase();
      if (t.includes('B2')) return 'B2';
    } catch (e) {}
    return 'B1';
  }

  function getApiUrl() {
    if (DEFAULT_CB210_STREAK_API_URL && DEFAULT_CB210_STREAK_API_URL.startsWith('https://')) {
      return DEFAULT_CB210_STREAK_API_URL.trim();
    }
    try {
      const override = localStorage.getItem(LS_URL_OVERRIDE_KEY) || '';
      if (override.startsWith('https://script.google.com/')) {
        return override.trim();
      }
    } catch (e) {}
    return '';
  }

  function getTodayVN() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }

  function slugifyName(str) {
    if (!str) return 'unknown';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
  }

  function makeStudentKey(name) {
    return slugifyName(name) + '|CB210';
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function callApi(params, timeoutMs = 12000) {
    const baseUrl = getApiUrl();
    if (!baseUrl) {
      return { ok: false, unconfigured: true };
    }

    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => {
      if (typeof params[k] !== 'undefined' && params[k] !== null) {
        qs.append(k, String(params[k]));
      }
    });

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const resp = await fetch(`${baseUrl}?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      const data = await resp.json();
      return data;
    } catch (err) {
      if (timer) clearTimeout(timer);
      console.warn('[CB210StreakGuard] API error:', err);
      return { ok: false, networkError: true, error: err && err.message ? err.message : 'Network error' };
    }
  }

  const CB210StreakGuard = {
    currentStudent: null,
    streakCount: 0,
    bestStreak: 0,
    essaysToday: 0,
    totalEssays: 0,
    todayDone: false,
    hasGraceToday: false,
    warningCount: 0,
    maxWarnings: 2,
    isTeacherMode: false,
    cachedStudents: [],
    cachedConfig: {
      SystemEnabled: true,
      StartDate: '',
      StreakMode: 'STRICT_DAILY',
      MaxWarningsBeforeLock: 2,
      MinWords: 250
    },
    currentFilter: 'all',
    currentSearch: '',

    isConfigured() {
      return Boolean(getApiUrl());
    },

    init() {
      this.ensureDomElements();
      this.bindLoginInputReset();
      this.bindAdminModalEvents();
    },

    ensureDomElements() {
      // 1. Lock box inside login gateway (right before Submit button)
      const submitBtn = document.getElementById('btn-gateway-submit');
      if (submitBtn && submitBtn.parentNode && !document.getElementById('cb210LockBox')) {
        const lockBox = document.createElement('div');
        lockBox.id = 'cb210LockBox';
        lockBox.className = 'cb210-lock-box';
        lockBox.style.display = 'none';
        submitBtn.parentNode.insertBefore(lockBox, submitBtn);
      }

      // 2. Sidebar daily quota pill (for CB210 students) + Teacher manage button
      const profileCard = document.getElementById('studentProfileCard');
      if (profileCard && profileCard.parentNode) {
        if (!document.getElementById('cb210-sidebar-pill')) {
          const pill = document.createElement('div');
          pill.id = 'cb210-sidebar-pill';
          pill.className = 'cb210-sidebar-pill';
          pill.style.display = 'none';
          profileCard.insertAdjacentElement('afterend', pill);
        }
        if (!document.getElementById('btn-cb210-teacher-sidebar')) {
          const tBtn = document.createElement('button');
          tBtn.id = 'btn-cb210-teacher-sidebar';
          tBtn.type = 'button';
          tBtn.className = 'btn-cb210-teacher-sidebar';
          tBtn.style.display = 'none';
          tBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i><span>QUẢN LÝ CHUỖI CB210</span><span class="cb210-badge-count" id="cb210-lock-badge-sidebar" style="display:none;">0</span>`;
          tBtn.addEventListener('click', () => this.openAdminModal());
          profileCard.insertAdjacentElement('afterend', tBtn);
        }
      }

      // 3. Header quick button for Teacher
      const headerActions = document.querySelector('.top-header .header-actions');
      if (headerActions && !document.getElementById('btn-cb210-teacher-header')) {
        const hBtn = document.createElement('button');
        hBtn.id = 'btn-cb210-teacher-header';
        hBtn.type = 'button';
        hBtn.className = 'btn-cb210-teacher-header';
        hBtn.style.display = 'none';
        hBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i><span>CB210</span><span class="cb210-badge-count" id="cb210-lock-badge-header" style="display:none;">0</span>`;
        hBtn.addEventListener('click', () => this.openAdminModal());
        headerActions.insertBefore(hBtn, headerActions.firstChild);
      }

      // 4. Teacher Admin Modal Overlay
      if (!document.getElementById('cb210-admin-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'cb210-admin-overlay';
        overlay.className = 'cb210-admin-overlay';
        overlay.innerHTML = `
          <div class="cb210-admin-card">
            <button type="button" class="cb210-admin-close" id="btn-close-cb210-admin" aria-label="Đóng">&times;</button>
            <div class="cb210-admin-header">
              <div class="cb210-admin-icon"><i class="fa-solid fa-shield-halved"></i></div>
              <div>
                <h3>QUẢN LÝ CHỈ TIÊU VIẾT LUẬN HẰNG NGÀY — LỚP CB210</h3>
                <p>Mỗi ngày tối thiểu 1 bài luận hoàn chỉnh (đồng bộ cả 2 web B1 & B2). Tự động khóa khi nghỉ và mở khóa từ xa chỉ với 1 chạm.</p>
              </div>
            </div>

            <div id="cb210-setup-banner" class="cb210-setup-box" style="display:none;">
              <strong><i class="fa-solid fa-plug-circle-exclamation"></i> Chưa gắn link Google Apps Script Quản lý CB210</strong>
              <div style="margin-top:4px;">
                Sau khi cô triển khai file <code>google_apps_script_cb210_streak.gs</code> thành Web App, cô dán link vào đây để kiểm tra ngay (và gửi link vào khung chat để em gắn cố định cho tất cả máy của 15 bạn CB210):
              </div>
              <div class="cb210-setup-row">
                <input type="url" id="cb210-api-url-input" class="cb210-url-input" placeholder="https://script.google.com/macros/s/.../exec">
                <button type="button" class="btn-cb210-act btn-cb210-unlock" id="btn-save-cb210-url">
                  <i class="fa-solid fa-link"></i> Lưu & Kết nối
                </button>
              </div>
            </div>

            <div class="cb210-admin-stats">
              <div class="cb210-stat-box">
                <span class="cb210-stat-val" id="cb210-stat-total">0</span>
                <span class="cb210-stat-lbl">Tổng lớp CB210</span>
              </div>
              <div class="cb210-stat-box">
                <span class="cb210-stat-val" id="cb210-stat-done" style="color:#10b981;">0</span>
                <span class="cb210-stat-lbl">✅ Đã viết hôm nay</span>
              </div>
              <div class="cb210-stat-box">
                <span class="cb210-stat-val" id="cb210-stat-pending" style="color:#f59e0b;">0</span>
                <span class="cb210-stat-lbl">⚠️ Chưa viết hôm nay</span>
              </div>
              <div class="cb210-stat-box">
                <span class="cb210-stat-val" id="cb210-stat-locked" style="color:#ef4444;">0</span>
                <span class="cb210-stat-lbl">🔒 Đang khoá / Xin mở</span>
              </div>
            </div>

            <div class="cb210-config-bar">
              <div class="cb210-config-group">
                <label>
                  Khóa tự động:
                  <select id="cb210-cfg-enabled" class="cb210-select">
                    <option value="true">🟢 Đang BẬT</option>
                    <option value="false">⏸️ Tạm TẮT</option>
                  </select>
                </label>
                <label>
                  Ngày bắt đầu:
                  <input type="date" id="cb210-cfg-startdate" class="cb210-date-input">
                </label>
                <label>
                  Chủ Nhật:
                  <select id="cb210-cfg-sunday" class="cb210-select">
                    <option value="STRICT_DAILY">Viết cả Chủ Nhật</option>
                    <option value="ALLOW_SUNDAY_OFF">Miễn Chủ Nhật</option>
                  </select>
                </label>
                <label>
                  Nhắc bỏ chuỗi:
                  <select id="cb210-cfg-maxwarn" class="cb210-select">
                    <option value="0">Khóa ngay (0 nhắc)</option>
                    <option value="1">Nhắc 1 lần → khóa</option>
                    <option value="2" selected>Nhắc 2 lần → khóa</option>
                    <option value="3">Nhắc 3 lần → khóa</option>
                  </select>
                </label>
                <label>
                  Số từ tối thiểu:
                  <select id="cb210-cfg-minwords" class="cb210-select">
                    <option value="200">≥ 200 từ</option>
                    <option value="250" selected>≥ 250 từ (Chuẩn VSTEP)</option>
                    <option value="300">≥ 300 từ</option>
                  </select>
                </label>
              </div>
              <button type="button" class="btn-cb210-act btn-cb210-refresh" id="btn-cb210-refresh">
                <i class="fa-solid fa-arrows-rotate"></i> Tải lại
              </button>
            </div>

            <div class="cb210-toolbar">
              <div class="cb210-filter-tabs">
                <button type="button" class="cb210-filter-btn active" data-filter="all">Tất cả</button>
                <button type="button" class="cb210-filter-btn" data-filter="locked">🔒 Bị khoá / Xin mở</button>
                <button type="button" class="cb210-filter-btn" data-filter="pending">⚠️ Chưa viết hôm nay</button>
                <button type="button" class="cb210-filter-btn" data-filter="done">✅ Đã xong hôm nay</button>
              </div>
              <input type="text" id="cb210-search-input" class="cb210-search-input" placeholder="Tìm tên học viên CB210...">
            </div>

            <div class="cb210-student-list" id="cb210-student-list">
              <div style="text-align:center;padding:28px;color:#94a3b8;font-weight:700;">
                Đang tải danh sách lớp CB210...
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      // 5. Streak Warning Modal Overlay (Nhắc nhở bỏ chuỗi 1/2 & 2/2)
      if (!document.getElementById('cb210-warning-overlay')) {
        const wOverlay = document.createElement('div');
        wOverlay.id = 'cb210-warning-overlay';
        wOverlay.className = 'cb210-warning-overlay';
        wOverlay.innerHTML = `<div class="cb210-warning-card" id="cb210-warning-card"></div>`;
        document.body.appendChild(wOverlay);
      }
    },

    bindLoginInputReset() {
      const nameInput = document.getElementById('gateway-name');
      const classInput = document.getElementById('gateway-class');
      const hide = () => this.hideLockedLoginBox();
      if (nameInput) nameInput.addEventListener('input', hide);
      if (classInput) classInput.addEventListener('input', hide);
    },

    bindAdminModalEvents() {
      const overlay = document.getElementById('cb210-admin-overlay');
      const closeBtn = document.getElementById('btn-close-cb210-admin');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          if (overlay) overlay.classList.remove('open');
        });
      }
      if (overlay) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.classList.remove('open');
        });
      }

      const refreshBtn = document.getElementById('btn-cb210-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.fetchAndRenderAdminList());
      }

      const saveUrlBtn = document.getElementById('btn-save-cb210-url');
      if (saveUrlBtn) {
        saveUrlBtn.addEventListener('click', async () => {
          const inp = document.getElementById('cb210-api-url-input');
          const url = inp ? inp.value.trim() : '';
          if (!url.startsWith('https://script.google.com/')) {
            alert('Link không hợp lệ! URL Web App của Google Apps Script phải bắt đầu bằng https://script.google.com/...');
            return;
          }
          localStorage.setItem(LS_URL_OVERRIDE_KEY, url);
          saveUrlBtn.disabled = true;
          saveUrlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';
          const ping = await callApi({ action: 'ping' });
          saveUrlBtn.disabled = false;
          saveUrlBtn.innerHTML = '<i class="fa-solid fa-link"></i> Lưu & Kết nối';
          if (ping && ping.ok) {
            if (typeof window.showToast === 'function') {
              window.showToast('✅ Đã kết nối Google Sheet quản lý CB210 thành công!', 'success');
            }
            this.fetchAndRenderAdminList();
          } else {
            alert('Không thể kết nối tới URL này. Cô kiểm tra lại bước Deploy (Who has access: Anyone) nhé!');
          }
        });
      }

      const onConfigChange = async () => {
        if (!this.isConfigured()) return;
        const enabledEl = document.getElementById('cb210-cfg-enabled');
        const startEl = document.getElementById('cb210-cfg-startdate');
        const sundayEl = document.getElementById('cb210-cfg-sunday');
        const maxWarnEl = document.getElementById('cb210-cfg-maxwarn');
        const minWordsEl = document.getElementById('cb210-cfg-minwords');
        const res = await callApi({
          action: 'setConfig',
          adminKey: TEACHER_ADMIN_KEY,
          systemEnabled: enabledEl ? enabledEl.value : 'true',
          startDate: startEl ? startEl.value : '',
          streakMode: sundayEl ? sundayEl.value : 'STRICT_DAILY',
          maxWarningsBeforeLock: maxWarnEl ? maxWarnEl.value : '2',
          minWords: minWordsEl ? minWordsEl.value : '250'
        });
        if (res && res.ok) {
          this.cachedConfig = res.config || this.cachedConfig;
          if (typeof window.showToast === 'function') {
            window.showToast('⚙️ Đã cập nhật quy tắc lớp CB210 lên Google Sheet!', 'success');
          }
          this.fetchAndRenderAdminList();
        }
      };

      ['cb210-cfg-enabled', 'cb210-cfg-startdate', 'cb210-cfg-sunday', 'cb210-cfg-maxwarn', 'cb210-cfg-minwords'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', onConfigChange);
      });

      document.querySelectorAll('.cb210-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.cb210-filter-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentFilter = btn.dataset.filter || 'all';
          this.renderAdminList();
        });
      });

      const searchInp = document.getElementById('cb210-search-input');
      if (searchInp) {
        searchInp.addEventListener('input', () => {
          this.currentSearch = searchInp.value.trim().toLowerCase();
          this.renderAdminList();
        });
      }
    },

    // =========================================================================
    // KIỂM TRA ĐĂNG NHẬP CHO HỌC VIÊN LỚP CB210
    // =========================================================================
    async checkStudentLogin(name, classCode) {
      this.ensureDomElements();
      this.isTeacherMode = false;
      this.toggleTeacherUI(false);

      const normClass = String(classCode || '').trim().toUpperCase();
      if (normClass !== 'CB210') {
        this.currentStudent = null;
        this.hideSidebarPill();
        this.hideLockedLoginBox();
        return { allowed: true, skippedClass: true };
      }

      this.currentStudent = { name, classCode: 'CB210', key: makeStudentKey(name) };

      if (!this.isConfigured()) {
        this.hideSidebarPill();
        return { allowed: true, unconfigured: true };
      }

      const res = await callApi({
        action: 'checkLogin',
        name: name,
        classCode: 'CB210'
      });

      const cacheKey = LS_CACHE_PREFIX + this.currentStudent.key;

      if (res && res.ok) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            date: getTodayVN(),
            locked: Boolean(res.locked),
            streakCount: res.streakCount || 0,
            todayDone: Boolean(res.todayDone),
            essaysToday: res.essaysToday || 0,
            lockReason: res.lockReason || '',
            lastEssayDate: res.lastEssayDate || ''
          }));
        } catch (e) {}

        if (res.config) this.cachedConfig = res.config;

        if (res.locked) {
          this.renderLockedLoginBox(name, res);
          if (res.newlyLocked && typeof window.sendTrackingReport === 'function') {
            window.sendTrackingReport(`[KHÓA TỰ ĐỘNG CB210] ${name} - ${res.lockReason || 'Bỏ lỡ bài viết hằng ngày'}`);
          }
          return { allowed: false, locked: true, data: res };
        }

        this.streakCount = Number(res.streakCount || 0);
        this.bestStreak = Number(res.bestStreak || 0);
        this.essaysToday = Number(res.essaysToday || 0);
        this.totalEssays = Number(res.totalEssays || 0);
        this.todayDone = Boolean(res.todayDone);
        this.hasGraceToday = Boolean(res.hasGraceToday);
        this.warningCount = Number(res.warningCount || 0);
        this.maxWarnings = (typeof res.maxWarnings === 'number')
          ? res.maxWarnings
          : (typeof this.cachedConfig.MaxWarningsBeforeLock === 'number' ? this.cachedConfig.MaxWarningsBeforeLock : 2);

        this.hideLockedLoginBox();
        this.renderSidebarPill();

        if (res.streakWarning) {
          this.showStreakWarningModal(name, res);
          if (res.newlyWarned && typeof window.sendTrackingReport === 'function') {
            window.sendTrackingReport(`[NHẮC BỎ CHUỖI ${this.warningCount}/${this.maxWarnings} - CB210] ${name} - ${res.warningReason || 'Bỏ lỡ ngày viết bài'}`);
          }
        }
        return { allowed: true, data: res };
      }

      // Dự phòng khi mạng yếu: tôn trọng trạng thái khóa đã lưu trước đó
      try {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.locked) {
            this.renderLockedLoginBox(name, cached);
            return { allowed: false, locked: true, offlineCached: true };
          }
        }
      } catch (e) {}

      return { allowed: true, networkFallback: true };
    },

    // =========================================================================
    // GHI NHẬN NỘP BÀI LUẬN HOÀN CHỈNH CHO CB210
    // =========================================================================
    async recordEssaySubmission({ topicTitle, wordCount, score }) {
      const userName = sessionStorage.getItem('current_user_name') || '';
      const userClass = (sessionStorage.getItem('current_user_class') || '').trim().toUpperCase();
      if (!userName || userClass !== 'CB210') return null;
      if (!this.isConfigured()) return null;

      const level = detectCourseLevel();
      const res = await callApi({
        action: 'recordEssay',
        name: userName,
        classCode: 'CB210',
        level: level,
        topic: topicTitle || 'VSTEP Task 2',
        wordCount: wordCount || 0,
        score: (typeof score !== 'undefined' && score !== null) ? String(score) : ''
      });

      if (res && res.ok) {
        if (res.qualified) {
          this.todayDone = true;
          this.essaysToday = Number(res.essaysToday || 1);
          this.totalEssays = Number(res.totalEssays || this.totalEssays + 1);
          this.streakCount = Number(res.streakCount || Math.max(1, this.streakCount));
          this.bestStreak = Number(res.bestStreak || this.streakCount);
          this.renderSidebarPill();

          try {
            const cacheKey = LS_CACHE_PREFIX + makeStudentKey(userName);
            localStorage.setItem(cacheKey, JSON.stringify({
              date: getTodayVN(),
              locked: false,
              streakCount: this.streakCount,
              todayDone: true,
              essaysToday: this.essaysToday,
              lastEssayDate: getTodayVN()
            }));
          } catch (e) {}

          if (typeof window.showToast === 'function') {
            window.showToast(
              `🔥 CB210: Đã ghi nhận bài luận hoàn chỉnh (${wordCount} từ)! Chỉ tiêu hôm nay: ${this.essaysToday}/1 • Chuỗi ${this.streakCount} ngày!`,
              'success'
            );
          }
        } else {
          const minW = res.minWords || this.cachedConfig.MinWords || 250;
          if (typeof window.showToast === 'function') {
            window.showToast(
              `⚠️ CB210: Bài viết mới đạt ${wordCount}/${minW} từ nên CHƯA được tính hoàn thành chỉ tiêu hôm nay! Hãy viết đủ ≥ ${minW} từ để không bị khóa ngày mai nhé.`,
              'warning'
            );
          }
        }
      }
      return res;
    },

    renderLockedLoginBox(name, data) {
      this.ensureDomElements();
      const box = document.getElementById('cb210LockBox');
      if (!box) return;

      const minWords = (data && data.config && data.config.MinWords) || this.cachedConfig.MinWords || 250;
      const lastDate = (data && data.lastEssayDate) ? data.lastEssayDate : 'Chưa nộp bài nào';
      const reason = (data && data.lockReason) || `Chưa nộp ít nhất 1 bài luận hoàn chỉnh (≥ ${minWords} từ) mỗi ngày.`;
      const alreadyRequested = Boolean(data && data.unlockRequested);

      box.innerHTML = `
        <div class="cb210-lock-header">
          <div class="cb210-lock-icon"><i class="fa-solid fa-lock"></i></div>
          <div class="cb210-lock-title">TÀI KHOẢN LỚP CB210 ĐÃ BỊ KHÓA TRUY CẬP</div>
        </div>
        <div class="cb210-lock-desc">
          <strong>${esc(name)}</strong> tạm thời không thể vào hệ thống.<br>
          <strong>Lý do:</strong> ${esc(reason)}
        </div>
        <div class="cb210-lock-meta">
          <span class="cb210-lock-chip">📅 Lần nộp gần nhất: ${esc(lastDate)}</span>
          <span class="cb210-lock-chip">🔥 Chuỗi cũ: ${Number(data && data.streakCount || 0)} ngày</span>
          <span class="cb210-lock-chip">✍️ Yêu cầu: ≥ ${minWords} từ/ngày</span>
          ${(data && Number(data.warningCount || 0) > 0) ? `<span class="cb210-lock-chip">⚠️ Đã nhắc nhở: ${Number(data.warningCount)}/${Number(data.maxWarnings || 2)} lần</span>` : ''}
        </div>
        <input type="text" id="cb210-unlock-note" class="cb210-unlock-note-input" placeholder="Nhập lý do gửi cô Nguyệt xin mở khóa (VD: Em bị ốm hôm qua, hôm nay em sẽ viết bù...)" value="${esc(data && data.unlockRequestNote || '')}">
        <button type="button" class="btn-cb210-request" id="btn-cb210-req-unlock" ${alreadyRequested ? 'disabled' : ''}>
          <i class="fa-solid fa-paper-plane"></i>
          <span>${alreadyRequested ? 'ĐÃ GỬI YÊU CẦU XIN CÔ MỞ KHÓA' : 'GỬI YÊU CẦU XIN CÔ NGUYỆT MỞ KHÓA'}</span>
        </button>
        <div id="cb210-req-status" class="cb210-request-sent" style="${alreadyRequested ? '' : 'display:none;'}">
          ✅ Yêu cầu của bạn đã gửi lên hệ thống. Sau khi cô Nguyệt mở khóa, bạn chỉ cần bấm lại nút <strong>BẮT ĐẦU HỌC</strong> là vào được ngay!
        </div>
      `;
      box.style.display = 'block';

      const reqBtn = document.getElementById('btn-cb210-req-unlock');
      if (reqBtn && !alreadyRequested) {
        reqBtn.addEventListener('click', async () => {
          const noteEl = document.getElementById('cb210-unlock-note');
          const statusEl = document.getElementById('cb210-req-status');
          const note = noteEl ? noteEl.value.trim() : '';
          reqBtn.disabled = true;
          reqBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>ĐANG GỬI YÊU CẦU...</span>';

          const resp = await callApi({
            action: 'requestUnlock',
            name: name,
            note: note
          });

          if (resp && resp.ok) {
            reqBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>ĐÃ GỬI YÊU CẦU XIN CÔ MỞ KHÓA</span>';
            if (statusEl) statusEl.style.display = 'block';
            if (typeof window.sendTrackingReport === 'function') {
              window.sendTrackingReport(`[XIN MỞ KHÓA CB210] ${name} - Lý do: ${note || 'Không ghi chú'}`);
            }
          } else {
            reqBtn.disabled = false;
            reqBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>THỬ GỬI LẠI YÊU CẦU</span>';
            alert('Không gửi được yêu cầu do lỗi mạng. Bạn vui lòng thử lại hoặc nhắn trực tiếp cho cô Nguyệt nhé!');
          }
        });
      }
    },

    hideLockedLoginBox() {
      const box = document.getElementById('cb210LockBox');
      if (box) box.style.display = 'none';
    },

    showStreakWarningModal(name, data) {
      this.ensureDomElements();
      const overlay = document.getElementById('cb210-warning-overlay');
      const card = document.getElementById('cb210-warning-card');
      if (!overlay || !card) return;

      const warnCnt = Number(data && data.warningCount || this.warningCount || 1);
      const maxWarn = Number(data && data.maxWarnings || this.maxWarnings || 2);
      const isFinal = warnCnt >= maxWarn;
      const remaining = Math.max(0, maxWarn - warnCnt);
      const minWords = (data && data.config && data.config.MinWords) || this.cachedConfig.MinWords || 200;
      const lastDate = (data && data.lastEssayDate) ? data.lastEssayDate : 'Chưa nộp bài nào';
      const daysMissed = Number(data && data.daysMissed || 1);

      card.className = 'cb210-warning-card' + (isFinal ? ' is-final' : '');
      card.innerHTML = `
        <div class="cb210-warn-badge ${isFinal ? 'is-final' : ''}">
          ${isFinal ? `🚨 CẢNH BÁO LẦN CUỐI (${warnCnt}/${maxWarn})` : `⚠️ NHẮC NHỞ BỎ CHUỖI (LẦN ${warnCnt}/${maxWarn})`}
        </div>
        <h3 class="cb210-warn-title">
          ${isFinal ? 'Đừng bỏ chuỗi thêm lần nào nữa nhé!' : 'Bạn vừa bỏ lỡ chuỗi viết luận hằng ngày!'}
        </h3>
        <div class="cb210-warn-desc">
          Chào <strong>${esc(name)}</strong>, hệ thống ghi nhận bạn đã bỏ lỡ chỉ tiêu viết luận của lớp <strong>CB210</strong>.
          ${isFinal
            ? `<div class="cb210-warn-alert-box is-final">⚠️ <strong>Đây là lần nhắc nhở cuối cùng (${warnCnt}/${maxWarn})!</strong> Nếu bạn tiếp tục bỏ chuỗi thêm <strong>1 lần nữa</strong>, tài khoản lớp CB210 sẽ <strong>TỰ ĐỘNG BỊ KHÓA</strong> và phải xin cô Nguyệt mở lại.</div>`
            : `<div class="cb210-warn-alert-box">Hệ thống cho phép nhắc nhở tối đa <strong>${maxWarn} lần</strong> (bạn còn <strong>${remaining} lần nhắc</strong>). Nếu vẫn tiếp tục bỏ chuỗi sau ${maxWarn} lần nhắc nhở, tài khoản sẽ <strong>tự động bị khóa</strong>!</div>`
          }
        </div>
        <div class="cb210-warn-meta">
          <span class="cb210-warn-chip">📅 Lần nộp gần nhất: ${esc(lastDate)}</span>
          ${daysMissed > 0 ? `<span class="cb210-warn-chip">⏳ Bỏ lỡ: ${daysMissed} ngày</span>` : ''}
          <span class="cb210-warn-chip">✍️ Hôm nay: ≥ ${minWords} từ</span>
        </div>
        <button type="button" class="btn-cb210-warn-ok ${isFinal ? 'is-final' : ''}" id="btn-cb210-warn-ack">
          ✍️ TÔI ĐÃ HIỂU & BẮT ĐẦU VIẾT BÀI NGAY
        </button>
      `;

      overlay.classList.add('open');
      const okBtn = document.getElementById('btn-cb210-warn-ack');
      if (okBtn) {
        okBtn.onclick = () => overlay.classList.remove('open');
      }
    },

    renderSidebarPill() {
      this.ensureDomElements();
      const pill = document.getElementById('cb210-sidebar-pill');
      if (!pill) return;

      const minWords = this.cachedConfig.MinWords || 250;
      const warnCnt = Number(this.warningCount || 0);
      const maxWarn = Number(this.maxWarnings || this.cachedConfig.MaxWarningsBeforeLock || 2);
      const warnLine = warnCnt > 0
        ? `<div class="cb210-pill-warn ${warnCnt >= maxWarn ? 'is-final' : ''}">${warnCnt >= maxWarn ? `🚨 Cảnh báo cuối: ${warnCnt}/${maxWarn} — Bỏ nữa sẽ KHÓA!` : `⚠️ Nhắc bỏ chuỗi: ${warnCnt}/${maxWarn} lần`}</div>`
        : '';

      if (this.todayDone) {
        pill.className = 'cb210-sidebar-pill is-done';
        pill.innerHTML = `
          <div class="cb210-pill-top">
            <span>✅ Đạt chỉ tiêu hôm nay (${Math.max(1, this.essaysToday)}/1)</span>
            <span>🔥 ${this.streakCount}d</span>
          </div>
          <div class="cb210-pill-sub">Xuất sắc! Tài khoản CB210 được giữ mở cho ngày mai.</div>
          ${warnLine}
        `;
      } else {
        pill.className = 'cb210-sidebar-pill' + (warnCnt >= maxWarn && maxWarn > 0 ? ' is-danger' : '');
        const ruleHint = (warnCnt >= maxWarn && maxWarn > 0)
          ? `Nộp 1 bài (≥ ${minWords} từ) trước 23:59 kẻo BỊ KHÓA ngày mai!`
          : `Nộp 1 bài (≥ ${minWords} từ) trước 23:59 để giữ chuỗi (nhắc tối đa ${maxWarn} lần).`;
        pill.innerHTML = `
          <div class="cb210-pill-top">
            <span>✍️ Chỉ tiêu CB210: 0/1 bài</span>
            <span>🔥 ${this.streakCount}d</span>
          </div>
          <div class="cb210-pill-sub">${ruleHint}</div>
          ${warnLine}
        `;
      }
      pill.style.display = 'block';
    },

    hideSidebarPill() {
      const pill = document.getElementById('cb210-sidebar-pill');
      if (pill) pill.style.display = 'none';
    },

    // =========================================================================
    // CHẾ ĐỘ GIÁO VIÊN (ADMIN PANEL QUẢN LÝ CB210)
    // =========================================================================
    onTeacherLoggedIn() {
      this.ensureDomElements();
      this.isTeacherMode = true;
      this.currentStudent = null;
      this.hideLockedLoginBox();
      this.hideSidebarPill();
      this.toggleTeacherUI(true);
      this.refreshTeacherBadge();
    },

    onLogout() {
      this.isTeacherMode = false;
      this.currentStudent = null;
      this.hideSidebarPill();
      this.toggleTeacherUI(false);
    },

    toggleTeacherUI(show) {
      const sBtn = document.getElementById('btn-cb210-teacher-sidebar');
      const hBtn = document.getElementById('btn-cb210-teacher-header');
      if (sBtn) sBtn.style.display = show ? 'flex' : 'none';
      if (hBtn) hBtn.style.display = show ? 'inline-flex' : 'none';
    },

    updateTeacherBadges(count) {
      ['cb210-lock-badge-sidebar', 'cb210-lock-badge-header'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (count > 0) {
          el.textContent = String(count);
          el.style.display = 'inline-flex';
        } else {
          el.style.display = 'none';
        }
      });
    },

    async refreshTeacherBadge() {
      if (!this.isConfigured()) return;
      const res = await callApi({ action: 'listStudents', adminKey: TEACHER_ADMIN_KEY });
      if (res && res.ok && Array.isArray(res.students)) {
        this.cachedStudents = res.students;
        if (res.config) this.cachedConfig = res.config;
        const alertCount = res.students.filter((s) => s.effectiveLocked || s.unlockRequested).length;
        this.updateTeacherBadges(alertCount);
      }
    },

    openAdminModal() {
      this.ensureDomElements();
      const overlay = document.getElementById('cb210-admin-overlay');
      if (overlay) overlay.classList.add('open');

      const setupBanner = document.getElementById('cb210-setup-banner');
      const urlInput = document.getElementById('cb210-api-url-input');
      if (!DEFAULT_CB210_STREAK_API_URL) {
        if (setupBanner) setupBanner.style.display = 'block';
        if (urlInput) urlInput.value = getApiUrl();
      } else if (setupBanner) {
        setupBanner.style.display = 'none';
      }

      if (this.isConfigured()) {
        this.fetchAndRenderAdminList();
      } else {
        const listEl = document.getElementById('cb210-student-list');
        if (listEl) {
          listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#b45309;font-weight:700;">Vui lòng dán link Google Apps Script Web App ở khung màu vàng phía trên để kích hoạt bảng theo dõi lớp CB210.</div>`;
        }
      }
    },

    async fetchAndRenderAdminList() {
      const listEl = document.getElementById('cb210-student-list');
      if (listEl) {
        listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;font-weight:700;"><i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ dữ liệu CB210 từ Google Sheet...</div>`;
      }

      const res = await callApi({ action: 'listStudents', adminKey: TEACHER_ADMIN_KEY });
      if (!res || !res.ok) {
        if (listEl) {
          listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;font-weight:700;">❌ Không tải được dữ liệu: ${esc(res && res.error ? res.error : 'Lỗi kết nối')}</div>`;
        }
        return;
      }

      this.cachedStudents = res.students || [];
      if (res.config) this.cachedConfig = res.config;

      // Sync config inputs
      const enabledEl = document.getElementById('cb210-cfg-enabled');
      const startEl = document.getElementById('cb210-cfg-startdate');
      const sundayEl = document.getElementById('cb210-cfg-sunday');
      const maxWarnEl = document.getElementById('cb210-cfg-maxwarn');
      const minWordsEl = document.getElementById('cb210-cfg-minwords');
      if (enabledEl) enabledEl.value = this.cachedConfig.SystemEnabled ? 'true' : 'false';
      if (startEl && this.cachedConfig.StartDate) startEl.value = this.cachedConfig.StartDate;
      if (sundayEl) sundayEl.value = this.cachedConfig.StreakMode || 'STRICT_DAILY';
      if (maxWarnEl) maxWarnEl.value = String(typeof this.cachedConfig.MaxWarningsBeforeLock === 'number' ? this.cachedConfig.MaxWarningsBeforeLock : 2);
      if (minWordsEl) minWordsEl.value = String(this.cachedConfig.MinWords || 250);

      // Update KPI stats
      const total = this.cachedStudents.length;
      const doneCount = this.cachedStudents.filter((s) => s.todayDone).length;
      const lockedCount = this.cachedStudents.filter((s) => s.effectiveLocked || s.unlockRequested).length;
      const pendingCount = this.cachedStudents.filter((s) => !s.todayDone && !s.effectiveLocked).length;

      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
      setTxt('cb210-stat-total', total);
      setTxt('cb210-stat-done', doneCount);
      setTxt('cb210-stat-pending', pendingCount);
      setTxt('cb210-stat-locked', lockedCount);
      this.updateTeacherBadges(lockedCount);

      this.renderAdminList();
    },

    renderAdminList() {
      const listEl = document.getElementById('cb210-student-list');
      if (!listEl) return;

      let rows = this.cachedStudents.slice();
      if (this.currentFilter === 'locked') {
        rows = rows.filter((s) => s.effectiveLocked || s.unlockRequested);
      } else if (this.currentFilter === 'pending') {
        rows = rows.filter((s) => !s.todayDone && !s.effectiveLocked);
      } else if (this.currentFilter === 'done') {
        rows = rows.filter((s) => s.todayDone);
      }

      if (this.currentSearch) {
        rows = rows.filter((s) => (s.fullName || '').toLowerCase().includes(this.currentSearch));
      }

      if (rows.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#94a3b8;font-weight:700;">Không có học viên nào khớp bộ lọc hiện tại.</div>`;
        return;
      }

      listEl.innerHTML = rows.map((st) => {
        const isLocked = Boolean(st.effectiveLocked);
        const rowCls = isLocked ? 'is-locked' : (st.todayDone ? 'is-done' : '');

        const stWarn = Number(st.warningCount || 0);
        const stMaxWarn = (typeof st.maxWarnings === 'number') ? st.maxWarnings : (typeof this.cachedConfig.MaxWarningsBeforeLock === 'number' ? this.cachedConfig.MaxWarningsBeforeLock : 2);
        let statusTag = '';
        if (st.status === 'LOCKED' && !st.hasGraceToday) {
          statusTag = `<span class="cb210-pill-tag cb210-tag-locked">🔒 ĐANG BỊ KHÓA</span>`;
        } else if (st.willBeLockedOnNextLogin) {
          statusTag = `<span class="cb210-pill-tag cb210-tag-locked">🔒 SẮP KHÓA (Hết ${stMaxWarn} lần nhắc)</span>`;
        } else if (st.willWarnOnNextLogin) {
          statusTag = `<span class="cb210-pill-tag cb210-tag-warn">⚠️ Sắp nhắc lần ${stWarn + 1}/${stMaxWarn} (Bỏ ${st.daysMissed} ngày)</span>`;
        } else if (st.todayDone) {
          statusTag = `<span class="cb210-pill-tag cb210-tag-done">✅ Đã viết hôm nay (${Math.max(1, st.essaysToday)} bài)</span>`;
        } else if (st.hasGraceToday) {
          statusTag = `<span class="cb210-pill-tag cb210-tag-pending">🔓 Đang ân hạn hôm nay (0/1 bài)</span>`;
        } else {
          statusTag = `<span class="cb210-pill-tag cb210-tag-pending">⏳ Chưa nộp hôm nay (0/1 bài)</span>`;
        }

        const reqTag = st.unlockRequested ? `<span class="cb210-pill-tag cb210-tag-req">📩 XIN MỞ KHÓA</span>` : '';
        const warnTag = stWarn > 0
          ? `<span class="cb210-pill-tag ${stWarn >= stMaxWarn ? 'cb210-tag-locked' : 'cb210-tag-warn'}">${stWarn >= stMaxWarn ? `🚨 Nhắc ${stWarn}/${stMaxWarn} (Cuối)` : `⚠️ Nhắc ${stWarn}/${stMaxWarn}`}</span>`
          : '';
        const streakTag = `<span class="cb210-pill-tag cb210-tag-streak">🔥 Chuỗi: ${st.streakCount}d • Tổng: ${st.totalEssays} bài</span>`;

        const lastInfo = st.lastEssayInfo
          ? `Bài gần nhất: <strong>${esc(st.lastEssayInfo)}</strong> (${esc(st.lastEssayDate || '--')})`
          : `Lần nộp gần nhất: <strong>${esc(st.lastEssayDate || 'Chưa có bài đạt chuẩn')}</strong>`;

        const lockNoteHtml = st.unlockRequested && st.unlockRequestNote
          ? `<div class="cb210-st-note">💬 Lời nhắn xin mở: "${esc(st.unlockRequestNote)}"</div>`
          : (st.lockReason && isLocked ? `<div class="cb210-st-note">📌 ${esc(st.lockReason)}</div>` : '');

        const kEsc = esc(st.studentKey);
        const actionsHtml = isLocked
          ? `
            <button type="button" class="btn-cb210-act btn-cb210-unlock" data-act="unlock" data-key="${kEsc}">🔓 Mở khóa</button>
            <button type="button" class="btn-cb210-act btn-cb210-keep" data-act="unlockKeep" data-key="${kEsc}">🔥 Mở & Giữ chuỗi</button>
          `
          : `
            ${!st.todayDone ? `<button type="button" class="btn-cb210-act btn-cb210-excuse" data-act="excuse" data-key="${kEsc}" title="Đánh dấu miễn chỉ tiêu hôm nay (xin phép nghỉ)">✅ Miễn hôm nay</button>` : ''}
            ${stWarn > 0 ? `<button type="button" class="btn-cb210-act btn-cb210-resetwarn" data-act="resetWarn" data-key="${kEsc}" title="Đưa số lần nhắc nhở bỏ chuỗi về 0">🔄 Xóa nhắc</button>` : ''}
            <button type="button" class="btn-cb210-act btn-cb210-lock" data-act="lock" data-key="${kEsc}">🔒 Khóa tay</button>
          `;

        return `
          <div class="cb210-student-row ${rowCls}">
            <div class="cb210-st-info">
              <div class="cb210-st-name-line">
                <span class="cb210-st-name">${esc(st.fullName)}</span>
                ${statusTag}
                ${warnTag}
                ${reqTag}
                ${streakTag}
              </div>
              <div class="cb210-st-meta">${lastInfo}</div>
              ${lockNoteHtml}
            </div>
            <div class="cb210-st-actions">
              ${actionsHtml}
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => this.handleStudentAction(btn));
      });
    },

    async handleStudentAction(btn) {
      const act = btn.dataset.act;
      const key = btn.dataset.key;
      if (!act || !key) return;

      btn.disabled = true;
      let res = null;

      if (act === 'unlock' || act === 'unlockKeep') {
        res = await callApi({
          action: 'unlockStudent',
          adminKey: TEACHER_ADMIN_KEY,
          studentKey: key,
          keepStreak: act === 'unlockKeep' ? 'true' : 'false'
        });
      } else if (act === 'excuse') {
        const note = prompt('Ghi chú miễn chỉ tiêu hôm nay (VD: Xin phép nghỉ ốm):', 'Giáo viên cho phép nghỉ hôm nay');
        if (note === null) { btn.disabled = false; return; }
        res = await callApi({
          action: 'excuseToday',
          adminKey: TEACHER_ADMIN_KEY,
          studentKey: key,
          note: note
        });
      } else if (act === 'resetWarn') {
        res = await callApi({
          action: 'resetWarnings',
          adminKey: TEACHER_ADMIN_KEY,
          studentKey: key
        });
      } else if (act === 'lock') {
        const reason = prompt('Nhập lý do khóa học viên này:', 'Chưa hoàn thành bài viết luận hằng ngày theo yêu cầu');
        if (reason === null) { btn.disabled = false; return; }
        res = await callApi({
          action: 'lockStudent',
          adminKey: TEACHER_ADMIN_KEY,
          studentKey: key,
          reason: reason
        });
      }

      btn.disabled = false;
      if (res && res.ok) {
        if (typeof window.showToast === 'function') {
          window.showToast('✅ Đã cập nhật trạng thái học viên CB210 thành công!', 'success');
        }
        await this.fetchAndRenderAdminList();
      } else {
        alert('Không thể cập nhật: ' + (res && res.error ? res.error : 'Lỗi kết nối'));
      }
    }
  };

  root.CB210StreakGuard = CB210StreakGuard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CB210StreakGuard.init());
  } else {
    CB210StreakGuard.init();
  }
})(window);
