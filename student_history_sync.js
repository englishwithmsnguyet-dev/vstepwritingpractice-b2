/**
 * ============================================================================
 * STUDENT CLOUD & PER-NAME HISTORY SYNC ENGINE
 * Dự án: PHÒNG LUYỆN VIẾT LUẬN VSTEP B1 & B2 (English with Miss Nguyet)
 * - Lưu riêng toàn bộ lịch sử (Bước 1, 2, 3, 4, bản nháp, đánh dấu đã viết)
 *   theo TÊN HỌC VIÊN chuẩn hóa (slugifyName)
 * - Tự động đồng bộ lên Google Sheets (Apps Script Web App) để học viên
 *   đăng nhập đúng tên trên bất kỳ thiết bị/trình duyệt nào đều thấy lại bài đã làm!
 * ============================================================================
 */
(function (root) {
  'use strict';

  const DEFAULT_SYNC_API_URL =
    'https://script.google.com/macros/s/AKfycbz7GaRjy-YxM0ErwnEnTi50-_jjB3FhzKMAfU-bQLKurhHlGlqLNxuXlTp5WX4da9sN/exec';
  const LS_URL_OVERRIDE_KEY = 'vstep_student_history_api_url_override';
  const TEACHER_ADMIN_KEY = 'PTMN_VSTEP_2026';
  const GOOGLE_SHEET_VIEW_URL =
    'https://docs.google.com/spreadsheets/d/10wxT_1xXrGy6WfFx4bHJ_cjmkMJRVnfnB-y7q2jDgAg/edit';

  let pushTimer = null;
  let isDirtyForCloud = false;
  let isPushing = false;
  let lastPulledKey = '';

  function detectCourseLevel() {
    try {
      const t = (document.title || '').toUpperCase();
      if (t.includes('B2')) return 'B2';
    } catch (e) {}
    return 'B1';
  }

  function getApiUrl() {
    if (DEFAULT_SYNC_API_URL && DEFAULT_SYNC_API_URL.startsWith('https://')) {
      return DEFAULT_SYNC_API_URL.trim();
    }
    try {
      const override = localStorage.getItem(LS_URL_OVERRIDE_KEY) || '';
      if (override.startsWith('https://script.google.com/')) {
        return override.trim();
      }
    } catch (e) {}
    return '';
  }

  function slugifyName(str) {
    if (!str) return 'guest';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'guest';
  }

  function getCurrentStudentName() {
    try {
      return (sessionStorage.getItem('current_user_name') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function getCurrentStudentClass() {
    try {
      return (sessionStorage.getItem('current_user_class') || '').trim().toUpperCase();
    } catch (e) {
      return '';
    }
  }

  function getStudentSlug(nameOpt) {
    const raw = (typeof nameOpt === 'string' && nameOpt.trim()) ? nameOpt.trim() : getCurrentStudentName();
    return slugifyName(raw || 'guest');
  }

  // --- Per-Student LocalStorage Key Builders ---
  function getHistoryKey(nameOpt) {
    return `vstep_history_${getStudentSlug(nameOpt)}`;
  }

  function getDraftPrefix(nameOpt) {
    return `vstep_draft_${getStudentSlug(nameOpt)}_`;
  }

  function getDraftKey(catId, topicId, nameOpt) {
    return `${getDraftPrefix(nameOpt)}${catId}_${topicId}`;
  }

  function getDraftMetaKey(nameOpt) {
    return `vstep_draft_meta_${getStudentSlug(nameOpt)}`;
  }

  function getTransKey(type, catId, topicId, level, idx, nameOpt) {
    return `vstep_trans_${type}_${getStudentSlug(nameOpt)}_${catId}_${topicId}_${level}_${idx}`;
  }

  function getTransTopicPrefix(type, catId, topicId, nameOpt) {
    return `vstep_trans_${type}_${getStudentSlug(nameOpt)}_${catId}_${topicId}_`;
  }

  function getIdeaSelKey(prefix, catId, topicId, groupType, apprSuffix, nameOpt) {
    return `vstep_${prefix}_${getStudentSlug(nameOpt)}_${catId}_${topicId}_${groupType}${apprSuffix || ''}`;
  }

  function getStickKey(nameOpt) {
    return `vstep_stick_done_${getStudentSlug(nameOpt)}`;
  }

  function getUnstickKey(nameOpt) {
    return `vstep_stick_undone_${getStudentSlug(nameOpt)}`;
  }

  function getStickMetaKey(nameOpt) {
    return `vstep_stick_meta_${getStudentSlug(nameOpt)}`;
  }

  function getPrepPrefix(nameOpt) {
    return `vstep_prep_${getStudentSlug(nameOpt)}_`;
  }

  function getPrepKey(catId, topicId, nameOpt) {
    return `${getPrepPrefix(nameOpt)}${catId}_${topicId}`;
  }

  // --- Draft Metadata (tracks update / deletion timestamps for clean cloud merge) ---
  function loadDraftMeta(nameOpt) {
    try {
      const raw = localStorage.getItem(getDraftMetaKey(nameOpt));
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveDraftMeta(meta, nameOpt) {
    try {
      localStorage.setItem(getDraftMetaKey(nameOpt), JSON.stringify(meta || {}));
    } catch (e) {}
  }

  function recordDraftChange(catId, topicId, isDeleted) {
    const meta = loadDraftMeta();
    const k = `${catId}_${topicId}`;
    meta[k] = { updatedAt: Date.now(), deleted: Boolean(isDeleted) };
    saveDraftMeta(meta);
    schedulePush(Boolean(isDeleted));
  }

  function recordStickChange() {
    try {
      localStorage.setItem(getStickMetaKey(), String(Date.now()));
    } catch (e) {}
    schedulePush(false);
  }

  // --- One-time Legacy Data Migration (per student, non-destructive) ---
  function migrateLegacyDataForStudent(studentName) {
    const slug = getStudentSlug(studentName);
    if (!slug || slug === 'guest') return;
    const migFlag = `vstep_migrated_v2_${slug}`;
    if (localStorage.getItem(migFlag) === '1') return;

    try {
      // 1. Migrate matching entries from legacy global writing_history
      const legacyHistRaw = localStorage.getItem('writing_history');
      if (legacyHistRaw) {
        const legacyHist = JSON.parse(legacyHistRaw);
        if (Array.isArray(legacyHist) && legacyHist.length > 0) {
          const matched = legacyHist.filter(item => {
            if (!item) return false;
            if (item.studentName && slugifyName(item.studentName) === slug) return true;
            return false;
          });
          if (matched.length > 0) {
            const curRaw = localStorage.getItem(getHistoryKey(studentName));
            const cur = curRaw ? JSON.parse(curRaw) : [];
            const byId = new Map();
            cur.forEach(it => { if (it && it.id) byId.set(String(it.id), it); });
            matched.forEach(it => { if (it && it.id && !byId.has(String(it.id))) byId.set(String(it.id), it); });
            const merged = Array.from(byId.values()).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
            localStorage.setItem(getHistoryKey(studentName), JSON.stringify(merged));
          }
        }
      }

      // 2. Migrate legacy stick keys (app.js previously used vstep_stick_topics_<lower> / vstep_unstick_topics_<lower>)
      const oldLower = (studentName || '').trim().toLowerCase();
      if (oldLower) {
        const oldStick = localStorage.getItem(`vstep_stick_topics_${oldLower}`) || localStorage.getItem(`vstep_stick_done_${oldLower}`);
        if (oldStick && !localStorage.getItem(getStickKey(studentName))) {
          localStorage.setItem(getStickKey(studentName), oldStick);
        }
        const oldUnstick = localStorage.getItem(`vstep_unstick_topics_${oldLower}`) || localStorage.getItem(`vstep_stick_undone_${oldLower}`);
        if (oldUnstick && !localStorage.getItem(getUnstickKey(studentName))) {
          localStorage.setItem(getUnstickKey(studentName), oldUnstick);
        }
      }

      // 3. Migrate legacy vstep_prep_<normalizeVietnameseName> (previously had spaces instead of underscores)
      const oldNorm = (studentName || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'd')
        .toLowerCase().trim().replace(/\s+/g, ' ');
      if (oldNorm && oldNorm !== slug) {
        const oldPrepPrefix = `vstep_prep_${oldNorm}_`;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(oldPrepPrefix)) {
            const rest = k.slice(oldPrepPrefix.length);
            const newK = `${getPrepPrefix(studentName)}${rest}`;
            if (!localStorage.getItem(newK)) {
              localStorage.setItem(newK, localStorage.getItem(k));
            }
          }
        }
      }

      localStorage.setItem(migFlag, '1');
    } catch (e) {
      console.warn('[StudentHistorySync] Migration warning:', e);
    }
  }

  // --- Snapshot Builder (collects all data for the currently logged-in student) ---
  function buildLocalSnapshot(nameOpt) {
    const slug = getStudentSlug(nameOpt);
    if (!slug || slug === 'guest') return null;

    // 1. History (Step 4 submissions)
    let history = [];
    try {
      const raw = localStorage.getItem(getHistoryKey(nameOpt));
      history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      history = [];
    }

    // 2. Drafts
    const drafts = {};
    const draftMeta = loadDraftMeta(nameOpt);
    const dPrefix = getDraftPrefix(nameOpt);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(dPrefix)) {
        const topicPair = k.slice(dPrefix.length); // "<catId>_<topicId>"
        const text = localStorage.getItem(k) || '';
        const meta = draftMeta[topicPair] || {};
        if (text.trim()) {
          drafts[topicPair] = {
            text: text,
            updatedAt: Number(meta.updatedAt || Date.now()),
            deleted: false
          };
        }
      }
    }
    // Include explicit deletions so deleting a draft syncs to cloud too
    Object.keys(draftMeta).forEach(topicPair => {
      if (draftMeta[topicPair] && draftMeta[topicPair].deleted && !drafts[topicPair]) {
        drafts[topicPair] = {
          text: '',
          updatedAt: Number(draftMeta[topicPair].updatedAt || Date.now()),
          deleted: true
        };
      }
    });

    // 3. Step 1-2-3 Prep progress
    const prep = {};
    const pPrefix = getPrepPrefix(nameOpt);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pPrefix)) {
        const topicPair = k.slice(pPrefix.length);
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || '{}');
          if (parsed && typeof parsed === 'object') {
            prep[topicPair] = {
              readSec: Number(parsed.readSec || 0),
              vocabSec: Number(parsed.vocabSec || 0),
              transSec: Number(parsed.transSec || 0),
              readDone: Boolean(parsed.readDone),
              vocabDone: Boolean(parsed.vocabDone)
            };
          }
        } catch (e) {}
      }
    }

    // 4. Step 3 Translation inputs, attempts, checked, correctness
    const trans = {};
    const types = ['input', 'checked', 'attempted', 'correct'];
    types.forEach(t => {
      const prefix = `vstep_trans_${t}_${slug}_`;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const rest = k.slice(prefix.length); // "<catId>_<topicId>_<level>_<idx>"
          if (!trans[rest]) trans[rest] = {};
          const val = localStorage.getItem(k);
          if (t === 'input') {
            if (val && val.trim()) trans[rest].input = val;
          } else {
            if (val === 'true') trans[rest][t] = true;
          }
        }
      }
    });
    // Clean empty trans entries
    Object.keys(trans).forEach(rk => {
      const e = trans[rk];
      if (!e.input && !e.checked && !e.attempted && !e.correct) {
        delete trans[rk];
      }
    });

    // 5. Stick / Unstick lists
    let stick = [];
    let unstick = [];
    try {
      stick = JSON.parse(localStorage.getItem(getStickKey(nameOpt)) || '[]');
      if (!Array.isArray(stick)) stick = [];
    } catch (e) { stick = []; }
    try {
      unstick = JSON.parse(localStorage.getItem(getUnstickKey(nameOpt)) || '[]');
      if (!Array.isArray(unstick)) unstick = [];
    } catch (e) { unstick = []; }
    const stickUpdatedAt = Number(localStorage.getItem(getStickMetaKey(nameOpt)) || 0);

    return {
      history,
      drafts,
      prep,
      trans,
      stick,
      unstick,
      stickUpdatedAt
    };
  }

  // --- Merge Cloud Data into Current Student's LocalStorage ---
  function mergeCloudIntoLocal(cloudData, nameOpt) {
    const slug = getStudentSlug(nameOpt);
    if (!slug || slug === 'guest' || !cloudData || typeof cloudData !== 'object') {
      return { essaysRestored: 0, prepRestored: 0, draftsRestored: 0, localHasNewer: false };
    }

    let essaysRestored = 0;
    let prepRestored = 0;
    let draftsRestored = 0;
    let localHasNewer = false;

    // 1. Merge Writing History (Step 4 submissions)
    const localSnap = buildLocalSnapshot(nameOpt) || { history: [], drafts: {}, prep: {}, trans: {}, stick: [], unstick: [], stickUpdatedAt: 0 };
    const cloudHist = Array.isArray(cloudData.history) ? cloudData.history : [];
    const byId = new Map();
    localSnap.history.forEach(it => {
      if (it && it.id) byId.set(String(it.id), it);
    });
    const localIds = new Set(byId.keys());
    const cloudIds = new Set();

    cloudHist.forEach(it => {
      if (!it || !it.id) return;
      const sid = String(it.id);
      cloudIds.add(sid);
      if (!byId.has(sid)) {
        byId.set(sid, it);
        essaysRestored++;
      } else {
        // Keep whichever has fuller content / updated score
        const cur = byId.get(sid);
        const merged = Object.assign({}, cur, it);
        if ((cur.content || '').length > (it.content || '').length) {
          merged.content = cur.content;
        }
        byId.set(sid, merged);
      }
    });
    localIds.forEach(id => {
      if (!cloudIds.has(id)) localHasNewer = true;
    });

    const mergedHist = Array.from(byId.values()).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    try {
      localStorage.setItem(getHistoryKey(nameOpt), JSON.stringify(mergedHist));
    } catch (e) {}

    // 2. Merge Drafts
    const cloudDrafts = (cloudData.drafts && typeof cloudData.drafts === 'object') ? cloudData.drafts : {};
    const draftMeta = loadDraftMeta(nameOpt);
    Object.keys(cloudDrafts).forEach(topicPair => {
      const cd = cloudDrafts[topicPair];
      if (!cd || typeof cd !== 'object') return;
      const ld = localSnap.drafts[topicPair];
      const cTime = Number(cd.updatedAt || 0);
      const lTime = ld ? Number(ld.updatedAt || 0) : 0;
      const parts = topicPair.split('_');
      if (parts.length !== 2) return;
      const dKey = getDraftKey(parts[0], parts[1], nameOpt);

      if (!ld || cTime >= lTime) {
        if (cd.deleted || !cd.text || !String(cd.text).trim()) {
          localStorage.removeItem(dKey);
          draftMeta[topicPair] = { updatedAt: cTime || Date.now(), deleted: true };
        } else {
          const prevText = localStorage.getItem(dKey) || '';
          localStorage.setItem(dKey, cd.text);
          draftMeta[topicPair] = { updatedAt: cTime || Date.now(), deleted: false };
          if (!prevText.trim()) draftsRestored++;
        }
      } else {
        localHasNewer = true;
      }
    });
    Object.keys(localSnap.drafts).forEach(tp => {
      if (!cloudDrafts[tp]) localHasNewer = true;
    });
    saveDraftMeta(draftMeta, nameOpt);

    // 3. Merge Step 1-2-3 Prep Progress
    const cloudPrep = (cloudData.prep && typeof cloudData.prep === 'object') ? cloudData.prep : {};
    Object.keys(cloudPrep).forEach(topicPair => {
      const cp = cloudPrep[topicPair];
      if (!cp || typeof cp !== 'object') return;
      const lp = localSnap.prep[topicPair] || { readSec: 0, vocabSec: 0, transSec: 0, readDone: false, vocabDone: false };
      const mergedPrep = {
        readSec: Math.max(Number(lp.readSec || 0), Number(cp.readSec || 0)),
        vocabSec: Math.max(Number(lp.vocabSec || 0), Number(cp.vocabSec || 0)),
        transSec: Math.max(Number(lp.transSec || 0), Number(cp.transSec || 0)),
        readDone: Boolean(lp.readDone || cp.readDone),
        vocabDone: Boolean(lp.vocabDone || cp.vocabDone)
      };
      if (!localSnap.prep[topicPair] && (mergedPrep.readSec > 0 || mergedPrep.vocabSec > 0 || mergedPrep.transSec > 0 || mergedPrep.readDone || mergedPrep.vocabDone)) {
        prepRestored++;
      }
      if (Number(lp.readSec || 0) > Number(cp.readSec || 0) ||
          Number(lp.vocabSec || 0) > Number(cp.vocabSec || 0) ||
          Number(lp.transSec || 0) > Number(cp.transSec || 0)) {
        localHasNewer = true;
      }
      try {
        localStorage.setItem(`${getPrepPrefix(nameOpt)}${topicPair}`, JSON.stringify(mergedPrep));
      } catch (e) {}
    });
    Object.keys(localSnap.prep).forEach(tp => {
      if (!cloudPrep[tp]) localHasNewer = true;
    });

    // 4. Merge Step 3 Translations
    const cloudTrans = (cloudData.trans && typeof cloudData.trans === 'object') ? cloudData.trans : {};
    Object.keys(cloudTrans).forEach(rest => {
      const ct = cloudTrans[rest];
      if (!ct || typeof ct !== 'object') return;
      const lt = localSnap.trans[rest] || {};
      const inputKey = `vstep_trans_input_${slug}_${rest}`;
      const checkedKey = `vstep_trans_checked_${slug}_${rest}`;
      const attemptedKey = `vstep_trans_attempted_${slug}_${rest}`;
      const correctKey = `vstep_trans_correct_${slug}_${rest}`;

      if (ct.input && (!lt.input || !lt.input.trim())) {
        localStorage.setItem(inputKey, ct.input);
      }
      if (ct.checked) localStorage.setItem(checkedKey, 'true');
      if (ct.attempted) localStorage.setItem(attemptedKey, 'true');
      if (ct.correct) localStorage.setItem(correctKey, 'true');
    });
    Object.keys(localSnap.trans).forEach(rk => {
      if (!cloudTrans[rk]) localHasNewer = true;
    });

    // 5. Merge Stick / Unstick
    const cStickTime = Number(cloudData.stickUpdatedAt || 0);
    const lStickTime = Number(localSnap.stickUpdatedAt || 0);
    if (Array.isArray(cloudData.stick) || Array.isArray(cloudData.unstick)) {
      if (cStickTime > lStickTime) {
        try {
          localStorage.setItem(getStickKey(nameOpt), JSON.stringify(cloudData.stick || []));
          localStorage.setItem(getUnstickKey(nameOpt), JSON.stringify(cloudData.unstick || []));
          localStorage.setItem(getStickMetaKey(nameOpt), String(cStickTime));
        } catch (e) {}
      } else if (lStickTime === 0 && cStickTime === 0) {
        const unionStick = Array.from(new Set([...(localSnap.stick || []), ...(cloudData.stick || [])]));
        const unionUnstick = Array.from(new Set([...(localSnap.unstick || []), ...(cloudData.unstick || [])]));
        try {
          localStorage.setItem(getStickKey(nameOpt), JSON.stringify(unionStick));
          localStorage.setItem(getUnstickKey(nameOpt), JSON.stringify(unionUnstick));
        } catch (e) {}
      } else if (lStickTime > cStickTime) {
        localHasNewer = true;
      }
    }

    return { essaysRestored, prepRestored, draftsRestored, localHasNewer };
  }

  // --- Refresh visible UI after cloud sync finishes ---
  function refreshVisibleUI() {
    try {
      if (typeof root.updateStats === 'function') root.updateStats();
      if (typeof root.currentScreen !== 'undefined') {
        if (root.currentScreen === 'dashboard' && typeof root.renderDashboard === 'function') {
          root.renderDashboard();
        } else if (root.currentScreen === 'category' && typeof root.renderCategoryTopics === 'function') {
          const searchEl = document.getElementById('search-input-field');
          root.renderCategoryTopics(searchEl ? searchEl.value : '');
        } else if (root.currentScreen === 'history' && typeof root.renderHistory === 'function') {
          root.renderHistory();
        } else if (root.currentScreen === 'drafts' && typeof root.renderDrafts === 'function') {
          root.renderDrafts();
        } else if (root.currentScreen === 'workspace') {
          if (typeof root.renderWorkspaceStepHeader === 'function') root.renderWorkspaceStepHeader();
          if (typeof root.updateWorkspaceStickBadge === 'function') root.updateWorkspaceStickBadge();
        }
      }
    } catch (e) {
      console.warn('[StudentHistorySync] UI refresh warning:', e);
    }
  }

  // --- Network: Pull Student History from Google Sheets ---
  async function pullFromCloud(studentNameOpt, classCodeOpt) {
    const studentName = (studentNameOpt || getCurrentStudentName() || '').trim();
    const classCode = (classCodeOpt || getCurrentStudentClass() || '').trim().toUpperCase();
    if (!studentName) return { ok: false, skipped: true };

    migrateLegacyDataForStudent(studentName);
    refreshVisibleUI();

    const apiUrl = getApiUrl();
    if (!apiUrl) return { ok: false, unconfigured: true };

    const level = detectCourseLevel();
    const pullKey = `${level}|${getStudentSlug(studentName)}`;
    lastPulledKey = pullKey;

    const qs = new URLSearchParams({
      action: 'getStudentHistory',
      level: level,
      studentName: studentName
    });

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 14000) : null;

    try {
      const resp = await fetch(`${apiUrl}?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      const res = await resp.json();
      if (!res || !res.ok) {
        return { ok: false, error: (res && res.error) || 'Sync error' };
      }

      // Ensure user didn't switch accounts while request was in flight
      if (getStudentSlug() !== getStudentSlug(studentName)) {
        return { ok: false, stale: true };
      }

      if (res.found && res.data) {
        const stats = mergeCloudIntoLocal(res.data, studentName);
        refreshVisibleUI();

        const totalEssays = (buildLocalSnapshot(studentName)?.history || []).length;
        const totalPrep = Object.keys(buildLocalSnapshot(studentName)?.prep || {}).length;
        if ((stats.essaysRestored > 0 || stats.prepRestored > 0 || stats.draftsRestored > 0) && typeof root.showToast === 'function') {
          const parts = [];
          if (totalEssays > 0) parts.push(`${totalEssays} bài đã nộp`);
          if (totalPrep > 0) parts.push(`${totalPrep} đề đang luyện B1–3`);
          root.showToast(`☁️ Đã khôi phục lịch sử của ${studentName}${parts.length ? ' (' + parts.join(', ') + ')' : ''}!`, 'success');
        }

        if (stats.localHasNewer) {
          pushToCloudNow(studentName, classCode);
        }
        return { ok: true, restored: true, stats };
      } else {
        // No cloud record yet: if local has any data for this student, upload it right away!
        const snap = buildLocalSnapshot(studentName);
        const hasAnyLocal = snap && (
          snap.history.length > 0 ||
          Object.keys(snap.drafts).length > 0 ||
          Object.keys(snap.prep).length > 0 ||
          Object.keys(snap.trans).length > 0 ||
          snap.stick.length > 0
        );
        if (hasAnyLocal) {
          pushToCloudNow(studentName, classCode);
        }
        return { ok: true, restored: false };
      }
    } catch (err) {
      if (timer) clearTimeout(timer);
      console.warn('[StudentHistorySync] Pull warning:', err);
      return { ok: false, networkError: true };
    }
  }

  // --- Network: Push Student History to Google Sheets ---
  async function pushToCloudNow(studentNameOpt, classCodeOpt, useBeacon = false) {
    const studentName = (studentNameOpt || getCurrentStudentName() || '').trim();
    const classCode = (classCodeOpt || getCurrentStudentClass() || '').trim().toUpperCase();
    if (!studentName) return { ok: false, skipped: true };

    const apiUrl = getApiUrl();
    if (!apiUrl) return { ok: false, unconfigured: true };

    const snap = buildLocalSnapshot(studentName);
    if (!snap) return { ok: false, skipped: true };

    const bodyStr = JSON.stringify({
      action: 'saveStudentHistory',
      level: detectCourseLevel(),
      studentName: studentName,
      classCode: classCode || 'STUDENT',
      payload: snap
    });

    isDirtyForCloud = false;

    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        const blob = new Blob([bodyStr], { type: 'text/plain;charset=utf-8' });
        if (navigator.sendBeacon(apiUrl, blob)) {
          return { ok: true, beacon: true };
        }
      } catch (e) {}
    }

    if (isPushing) {
      isDirtyForCloud = true;
      return { ok: false, busy: true };
    }
    isPushing = true;

    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyStr,
        keepalive: Boolean(useBeacon)
      });
      isPushing = false;
      let data = { ok: resp.ok };
      try { data = await resp.json(); } catch (e) {}
      if (isDirtyForCloud) {
        schedulePush(false);
      }
      return data;
    } catch (err) {
      isPushing = false;
      console.warn('[StudentHistorySync] Push warning:', err);
      return { ok: false, networkError: true };
    }
  }

  function schedulePush(immediate = false) {
    const studentName = getCurrentStudentName();
    if (!studentName) return;
    isDirtyForCloud = true;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (immediate) {
      pushToCloudNow();
    } else {
      pushTimer = setTimeout(() => {
        pushTimer = null;
        if (isDirtyForCloud) {
          pushToCloudNow();
        }
      }, 2500);
    }
  }

  function flushOnExit() {
    if (isDirtyForCloud && getCurrentStudentName()) {
      pushToCloudNow(undefined, undefined, true);
    }
  }

  window.addEventListener('pagehide', flushOnExit);
  window.addEventListener('beforeunload', flushOnExit);

  // ============================================================================
  // TEACHER STUDENT MANAGER PANEL (CHỈ HIỂN THỊ KHI GIÁO VIÊN ĐĂNG NHẬP)
  // ============================================================================
  const managerState = {
    isTeacherMode: false,
    activeTab: 'students', // 'students' | 'logs'
    levelFilter: 'ALL',    // 'ALL' | 'B1' | 'B2'
    classFilter: 'ALL',
    searchQuery: '',
    showUnsubmittedRoster: false,
    students: [],
    essayLogs: [],
    generatedAt: '',
    isLoading: false,
    detailRecordKey: null
  };

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSecVi(sec) {
    const s = Math.max(0, Math.round(Number(sec || 0)));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}p ${r}s` : `${r}s`;
  }

  function resolveTopicLabel(catId, topicId) {
    try {
      if (typeof root.ESSAY_DATA !== 'undefined' && Array.isArray(root.ESSAY_DATA)) {
        const cat = root.ESSAY_DATA.find(c => Number(c.id) === Number(catId));
        if (cat && Array.isArray(cat.topics)) {
          const t = cat.topics.find(x => Number(x.id) === Number(topicId));
          if (t) return `Dạng ${catId} – Đề ${topicId}: ${t.title_vi || t.title_en || ''}`;
        }
      }
    } catch (e) {}
    return `Dạng ${catId} – Đề ${topicId}`;
  }

  function ensureManagerDom() {
    // 1. Sidebar button for Teacher (below profile card / CB210 button)
    const profileCard = document.getElementById('studentProfileCard');
    if (profileCard && profileCard.parentNode && !document.getElementById('btn-shs-teacher-sidebar')) {
      const btn = document.createElement('button');
      btn.id = 'btn-shs-teacher-sidebar';
      btn.type = 'button';
      btn.className = 'btn-shs-teacher-sidebar';
      btn.style.display = 'none';
      btn.innerHTML = `<i class="fa-solid fa-users-viewfinder"></i><span>QUẢN LÝ HỌC VIÊN</span><span class="shs-badge-count" id="shs-count-badge-sidebar" style="display:none;">0</span>`;
      btn.addEventListener('click', () => openStudentManagerModal());
      const cb210Btn = document.getElementById('btn-cb210-teacher-sidebar');
      if (cb210Btn && cb210Btn.parentNode === profileCard.parentNode) {
        cb210Btn.insertAdjacentElement('afterend', btn);
      } else {
        profileCard.insertAdjacentElement('afterend', btn);
      }
    }

    // 2. Top-header quick pill button for Teacher
    const headerActions = document.querySelector('.top-header .header-actions');
    if (headerActions && !document.getElementById('btn-shs-teacher-header')) {
      const hBtn = document.createElement('button');
      hBtn.id = 'btn-shs-teacher-header';
      hBtn.type = 'button';
      hBtn.className = 'btn-shs-teacher-header';
      hBtn.style.display = 'none';
      hBtn.innerHTML = `<i class="fa-solid fa-users-viewfinder"></i><span>Học viên</span><span class="shs-badge-count" id="shs-count-badge-header" style="display:none;">0</span>`;
      hBtn.addEventListener('click', () => openStudentManagerModal());
      headerActions.insertBefore(hBtn, headerActions.firstChild);
    }

    // 3. Full Modal Overlay
    if (!document.getElementById('shs-manager-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'shs-manager-overlay';
      overlay.className = 'shs-manager-overlay';
      overlay.innerHTML = `
        <div class="shs-manager-card" role="dialog" aria-modal="true" aria-labelledby="shs-manager-title">
          <button type="button" class="shs-manager-close" id="btn-close-shs-manager" aria-label="Đóng">&times;</button>

          <div class="shs-manager-header">
            <div class="shs-manager-icon"><i class="fa-solid fa-users-viewfinder"></i></div>
            <div>
              <h3 id="shs-manager-title">QUẢN LÝ HỌC VIÊN &amp; KẾT QUẢ BÀI NỘP (B1 &amp; B2)</h3>
              <p>Theo dõi số bài luận đã nộp, điểm số, tiến độ Bước 1–2–3 và đọc trực tiếp bài viết của tất cả các lớp.</p>
            </div>
          </div>

          <div class="shs-kpi-grid">
            <div class="shs-kpi-card">
              <div class="shs-kpi-val" id="shs-kpi-students">0</div>
              <div class="shs-kpi-lbl">Học viên đã đồng bộ</div>
            </div>
            <div class="shs-kpi-card is-accent">
              <div class="shs-kpi-val" id="shs-kpi-essays">0</div>
              <div class="shs-kpi-lbl">Tổng bài luận đã nộp</div>
            </div>
            <div class="shs-kpi-card is-green">
              <div class="shs-kpi-val" id="shs-kpi-avg">--</div>
              <div class="shs-kpi-lbl">Điểm trung bình (/10)</div>
            </div>
            <div class="shs-kpi-card is-amber">
              <div class="shs-kpi-val" id="shs-kpi-prep">0</div>
              <div class="shs-kpi-lbl">Lượt đề luyện B1–3</div>
            </div>
          </div>

          <div class="shs-toolbar">
            <div class="shs-tabs" id="shs-tabs">
              <button type="button" class="shs-tab is-active" data-tab="students">📋 Tổng hợp học viên</button>
              <button type="button" class="shs-tab" data-tab="logs">📝 Nhật ký bài nộp mới nhất</button>
            </div>
            <div class="shs-toolbar-actions">
              <button type="button" class="shs-btn-secondary" id="btn-shs-refresh">🔄 Làm mới</button>
              <a class="shs-btn-sheet" href="${GOOGLE_SHEET_VIEW_URL}" target="_blank" rel="noopener noreferrer">📊 Mở Google Sheet</a>
            </div>
          </div>

          <div class="shs-filter-row">
            <div class="shs-level-pills" id="shs-level-pills">
              <button type="button" class="shs-pill is-active" data-level="ALL">Tất cả (B1 &amp; B2)</button>
              <button type="button" class="shs-pill" data-level="B1">Web B1</button>
              <button type="button" class="shs-pill" data-level="B2">Web B2</button>
            </div>
            <select id="shs-class-filter" class="shs-select" title="Lọc theo lớp">
              <option value="ALL">Tất cả các lớp</option>
            </select>
            <input type="search" id="shs-search-input" class="shs-search" placeholder="Tìm theo tên học viên hoặc tên đề bài...">
            <label class="shs-roster-toggle" title="Hiển thị thêm các học viên trong danh sách lớp chưa nộp bài nào">
              <input type="checkbox" id="shs-show-roster-chk">
              <span>Hiện cả HV chưa có bài</span>
            </label>
          </div>

          <div id="shs-main-body" class="shs-main-body">
            <div class="shs-loading">Đang tải dữ liệu học viên từ Google Sheet...</div>
          </div>

          <div id="shs-detail-view" class="shs-detail-view" style="display:none;"></div>

          <div class="shs-footer-bar">
            <span id="shs-last-sync-note">Chưa đồng bộ</span>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Event bindings
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeStudentManagerModal();
      });
      const closeBtn = document.getElementById('btn-close-shs-manager');
      if (closeBtn) closeBtn.addEventListener('click', closeStudentManagerModal);

      const refreshBtn = document.getElementById('btn-shs-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', () => loadStudentsReport());

      const tabsEl = document.getElementById('shs-tabs');
      if (tabsEl) {
        tabsEl.addEventListener('click', (e) => {
          const btn = e.target.closest('.shs-tab');
          if (!btn) return;
          managerState.activeTab = btn.getAttribute('data-tab') || 'students';
          tabsEl.querySelectorAll('.shs-tab').forEach(b => b.classList.toggle('is-active', b === btn));
          hideStudentDetailView();
          renderManagerContent();
        });
      }

      const lvlEl = document.getElementById('shs-level-pills');
      if (lvlEl) {
        lvlEl.addEventListener('click', (e) => {
          const btn = e.target.closest('.shs-pill');
          if (!btn) return;
          managerState.levelFilter = btn.getAttribute('data-level') || 'ALL';
          lvlEl.querySelectorAll('.shs-pill').forEach(b => b.classList.toggle('is-active', b === btn));
          renderManagerContent();
        });
      }

      const clsSel = document.getElementById('shs-class-filter');
      if (clsSel) {
        clsSel.addEventListener('change', () => {
          managerState.classFilter = clsSel.value || 'ALL';
          renderManagerContent();
        });
      }

      const searchInp = document.getElementById('shs-search-input');
      if (searchInp) {
        searchInp.addEventListener('input', () => {
          managerState.searchQuery = searchInp.value || '';
          renderManagerContent();
        });
      }

      const rosterChk = document.getElementById('shs-show-roster-chk');
      if (rosterChk) {
        rosterChk.addEventListener('change', () => {
          managerState.showUnsubmittedRoster = Boolean(rosterChk.checked);
          renderManagerContent();
        });
      }
    }
  }

  function setTeacherButtonsVisible(show) {
    ensureManagerDom();
    const sBtn = document.getElementById('btn-shs-teacher-sidebar');
    const hBtn = document.getElementById('btn-shs-teacher-header');
    if (sBtn) sBtn.style.display = show ? 'flex' : 'none';
    if (hBtn) hBtn.style.display = show ? 'inline-flex' : 'none';
  }

  function updateTeacherCountBadges(count) {
    const sBadge = document.getElementById('shs-count-badge-sidebar');
    const hBadge = document.getElementById('shs-count-badge-header');
    [sBadge, hBadge].forEach(el => {
      if (!el) return;
      if (count > 0) {
        el.textContent = String(count);
        el.style.display = 'inline-flex';
      } else {
        el.style.display = 'none';
      }
    });
  }

  function populateClassFilterOptions() {
    const sel = document.getElementById('shs-class-filter');
    if (!sel) return;
    const prev = managerState.classFilter || 'ALL';
    const classSet = new Set(['CB210', 'CB211', 'CB213', 'ONB103', 'B212']);
    try {
      if (typeof root.VALID_CLASSES === 'object' && root.VALID_CLASSES) {
        Object.keys(root.VALID_CLASSES).forEach(k => {
          if (k && k !== '0NB103') classSet.add(k.toUpperCase());
        });
      }
    } catch (e) {}
    managerState.students.forEach(s => { if (s.classCode) classSet.add(s.classCode); });
    managerState.essayLogs.forEach(l => { if (l.classCode) classSet.add(l.classCode); });

    const sorted = Array.from(classSet).sort();
    sel.innerHTML = `<option value="ALL">Tất cả các lớp</option>` +
      sorted.map(c => `<option value="${escHtml(c)}">Lớp ${escHtml(c)}</option>`).join('');
    if (sorted.includes(prev)) {
      sel.value = prev;
    } else {
      sel.value = 'ALL';
      managerState.classFilter = 'ALL';
    }
  }

  function getMergedStudentsList() {
    const base = managerState.students.slice();
    if (!managerState.showUnsubmittedRoster) return base;

    try {
      if (typeof root.VALID_CLASSES === 'object' && root.VALID_CLASSES) {
        const existingSlugsByClass = new Set(
          base.map(s => `${s.classCode}|${slugifyName(s.fullName)}`)
        );
        const existingSlugsAny = new Set(base.map(s => slugifyName(s.fullName)));
        const targetLvl = managerState.levelFilter === 'ALL' ? detectCourseLevel() : managerState.levelFilter;

        Object.keys(root.VALID_CLASSES).forEach(cls => {
          if (!cls || cls === '0NB103' || cls === 'B2') return;
          const roster = root.VALID_CLASSES[cls];
          if (!Array.isArray(roster)) return;
          roster.forEach(name => {
            const sl = slugifyName(name);
            if (!existingSlugsByClass.has(`${cls}|${sl}`) && !existingSlugsAny.has(sl)) {
              base.push({
                recordKey: `${targetLvl}|${sl}`,
                level: targetLvl,
                fullName: name,
                classCode: cls,
                essaysCount: 0,
                avgScore: null,
                prepCount: 0,
                activeDrafts: 0,
                latestInfo: '',
                updatedAt: '',
                isRosterOnly: true
              });
            }
          });
        });
      }
    } catch (e) {}
    return base;
  }

  function renderManagerContent() {
    const bodyEl = document.getElementById('shs-main-body');
    if (!bodyEl) return;

    const lvl = managerState.levelFilter;
    const cls = managerState.classFilter;
    const q = slugifyName(managerState.searchQuery || '').replace(/_/g, ' ').trim();
    const rawQ = (managerState.searchQuery || '').toLowerCase().trim();

    const allStudents = getMergedStudentsList();
    const filteredStudents = allStudents.filter(st => {
      if (lvl !== 'ALL' && !st.isRosterOnly && st.level !== lvl) return false;
      if (cls !== 'ALL' && st.classCode !== cls) return false;
      if (rawQ) {
        const hay = `${st.fullName} ${st.classCode} ${st.latestInfo}`.toLowerCase();
        const haySlug = slugifyName(`${st.fullName} ${st.classCode} ${st.latestInfo}`).replace(/_/g, ' ');
        if (!hay.includes(rawQ) && !haySlug.includes(q)) return false;
      }
      return true;
    });

    const filteredLogs = managerState.essayLogs.filter(lg => {
      if (lvl !== 'ALL' && lg.level !== lvl) return false;
      if (cls !== 'ALL' && lg.classCode !== cls) return false;
      if (rawQ) {
        const hay = `${lg.fullName} ${lg.classCode} ${lg.topicLabel} ${lg.catTitleVi}`.toLowerCase();
        const haySlug = slugifyName(`${lg.fullName} ${lg.classCode} ${lg.topicLabel}`).replace(/_/g, ' ');
        if (!hay.includes(rawQ) && !haySlug.includes(q)) return false;
      }
      return true;
    });

    // Update KPI Cards based on current filter (exclude roster-only ghosts from synced count)
    const syncedFiltered = filteredStudents.filter(s => !s.isRosterOnly);
    const totalEssays = syncedFiltered.reduce((acc, s) => acc + (Number(s.essaysCount) || 0), 0);
    const totalPrep = syncedFiltered.reduce((acc, s) => acc + (Number(s.prepCount) || 0), 0);
    const scoredStudents = syncedFiltered.filter(s => typeof s.avgScore === 'number');
    const overallAvg = scoredStudents.length > 0
      ? (scoredStudents.reduce((acc, s) => acc + s.avgScore, 0) / scoredStudents.length).toFixed(1)
      : '--';

    const elSt = document.getElementById('shs-kpi-students');
    const elEs = document.getElementById('shs-kpi-essays');
    const elAv = document.getElementById('shs-kpi-avg');
    const elPr = document.getElementById('shs-kpi-prep');
    if (elSt) elSt.textContent = String(syncedFiltered.length);
    if (elEs) elEs.textContent = String(totalEssays);
    if (elAv) elAv.textContent = overallAvg;
    if (elPr) elPr.textContent = String(totalPrep);

    if (managerState.activeTab === 'students') {
      if (filteredStudents.length === 0) {
        bodyEl.innerHTML = `<div class="shs-empty">Chưa có dữ liệu học viên phù hợp với bộ lọc hiện tại.<br><small>Khi học viên đăng nhập và làm Bước 1–4 trên web B1 hoặc B2, dữ liệu sẽ tự động hiển thị tại đây.</small></div>`;
        return;
      }
      const rowsHtml = filteredStudents.map((st, idx) => {
        const scoreHtml = (typeof st.avgScore === 'number')
          ? `<strong class="shs-score-val">${st.avgScore.toFixed(1)}</strong><span class="shs-score-sub">(${((st.avgScore * 7) / 10).toFixed(1)}/7)</span>`
          : `<span class="shs-muted">--</span>`;
        const essaysPill = st.essaysCount > 0
          ? `<span class="shs-pill-num is-done">${st.essaysCount} bài</span>`
          : `<span class="shs-pill-num is-zero">0 bài</span>`;
        const prepPill = st.prepCount > 0
          ? `<span class="shs-pill-num is-prep">${st.prepCount} đề</span>`
          : `<span class="shs-muted">0</span>`;
        const lvlBadge = `<span class="shs-lvl-badge is-${st.level === 'B2' ? 'b2' : 'b1'}">${escHtml(st.level)}</span>`;
        const clsBadge = st.classCode ? `<span class="shs-cls-badge">${escHtml(st.classCode)}</span>` : '<span class="shs-muted">--</span>';
        const actionBtn = st.isRosterOnly
          ? `<span class="shs-muted" style="font-size:0.78rem;">Chưa vào web</span>`
          : `<button type="button" class="shs-btn-detail" data-record-key="${escHtml(st.recordKey)}">👁️ Xem bài</button>`;
        return `
          <tr class="${st.isRosterOnly ? 'is-roster-only' : ''}">
            <td class="shs-td-center">${idx + 1}</td>
            <td><strong>${escHtml(st.fullName)}</strong></td>
            <td class="shs-td-center">${clsBadge}</td>
            <td class="shs-td-center">${lvlBadge}</td>
            <td class="shs-td-center">${essaysPill}</td>
            <td class="shs-td-center">${scoreHtml}</td>
            <td class="shs-td-center">${prepPill}</td>
            <td class="shs-td-latest" title="${escHtml(st.latestInfo)}">${escHtml(st.latestInfo || '—')}</td>
            <td class="shs-td-time">${escHtml(st.updatedAt || '—')}</td>
            <td class="shs-td-center">${actionBtn}</td>
          </tr>
        `;
      }).join('');

      bodyEl.innerHTML = `
        <div class="shs-table-wrap">
          <table class="shs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Họ và tên</th>
                <th>Lớp</th>
                <th>Web</th>
                <th>Bài nộp (B4)</th>
                <th>Điểm TB</th>
                <th>Luyện B1–3</th>
                <th>Bài gần nhất</th>
                <th>Cập nhật</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;

      bodyEl.querySelectorAll('.shs-btn-detail').forEach(btn => {
        btn.addEventListener('click', () => {
          const rk = btn.getAttribute('data-record-key');
          if (rk) openStudentDetailView(rk);
        });
      });
    } else {
      if (filteredLogs.length === 0) {
        bodyEl.innerHTML = `<div class="shs-empty">Chưa có bài luận nào được nộp khớp bộ lọc hiện tại.</div>`;
        return;
      }
      const rowsHtml = filteredLogs.map((lg, idx) => {
        const scoreHtml = (typeof lg.score === 'number')
          ? `<strong class="shs-score-val">${lg.score.toFixed(1)}</strong><span class="shs-score-sub">(${((lg.score * 7) / 10).toFixed(1)}/7)</span>`
          : `<span class="shs-muted">--</span>`;
        const lvlBadge = `<span class="shs-lvl-badge is-${lg.level === 'B2' ? 'b2' : 'b1'}">${escHtml(lg.level)}</span>`;
        const clsBadge = lg.classCode ? `<span class="shs-cls-badge">${escHtml(lg.classCode)}</span>` : '--';
        return `
          <tr>
            <td class="shs-td-center">${idx + 1}</td>
            <td class="shs-td-time">${escHtml(lg.date)}</td>
            <td><strong>${escHtml(lg.fullName)}</strong></td>
            <td class="shs-td-center">${clsBadge}</td>
            <td class="shs-td-center">${lvlBadge}</td>
            <td>${escHtml(lg.topicLabel)}</td>
            <td class="shs-td-center">${lg.wordCount} từ</td>
            <td class="shs-td-center">${scoreHtml}</td>
            <td class="shs-td-center">
              <button type="button" class="shs-btn-detail" data-record-key="${escHtml(lg.recordKey)}">👁️ Đọc bài</button>
            </td>
          </tr>
        `;
      }).join('');

      bodyEl.innerHTML = `
        <div class="shs-table-wrap">
          <table class="shs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Thời gian</th>
                <th>Học viên</th>
                <th>Lớp</th>
                <th>Web</th>
                <th>Đề bài</th>
                <th>Số từ</th>
                <th>Điểm</th>
                <th>Xem</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;

      bodyEl.querySelectorAll('.shs-btn-detail').forEach(btn => {
        btn.addEventListener('click', () => {
          const rk = btn.getAttribute('data-record-key');
          if (rk) openStudentDetailView(rk);
        });
      });
    }
  }

  function hideStudentDetailView() {
    managerState.detailRecordKey = null;
    const detailEl = document.getElementById('shs-detail-view');
    const bodyEl = document.getElementById('shs-main-body');
    if (detailEl) detailEl.style.display = 'none';
    if (bodyEl) bodyEl.style.display = 'block';
  }

  async function openStudentDetailView(recordKey) {
    const detailEl = document.getElementById('shs-detail-view');
    const bodyEl = document.getElementById('shs-main-body');
    if (!detailEl || !bodyEl) return;

    managerState.detailRecordKey = recordKey;
    bodyEl.style.display = 'none';
    detailEl.style.display = 'block';
    detailEl.innerHTML = `<div class="shs-loading">Đang tải chi tiết bài viết của học viên...</div>`;

    const apiUrl = getApiUrl();
    const qs = new URLSearchParams({
      action: 'getStudentDetail',
      adminKey: TEACHER_ADMIN_KEY,
      recordKey: recordKey
    });

    try {
      const resp = await fetch(`${apiUrl}?${qs.toString()}`, { method: 'GET', cache: 'no-store' });
      const res = await resp.json();
      if (!res || !res.ok || !res.found) {
        detailEl.innerHTML = `
          <div class="shs-detail-top">
            <button type="button" class="shs-btn-secondary" id="btn-shs-back">← Quay lại danh sách</button>
          </div>
          <div class="shs-empty">Không tìm thấy dữ liệu chi tiết cho học viên này.</div>
        `;
        const bk = document.getElementById('btn-shs-back');
        if (bk) bk.addEventListener('click', hideStudentDetailView);
        return;
      }

      const data = res.data || {};
      const hist = Array.isArray(data.history) ? data.history : [];
      const prepObj = (data.prep && typeof data.prep === 'object') ? data.prep : {};
      const prepKeys = Object.keys(prepObj);
      const draftsObj = (data.drafts && typeof data.drafts === 'object') ? data.drafts : {};
      const activeDraftKeys = Object.keys(draftsObj).filter(k => draftsObj[k] && !draftsObj[k].deleted && String(draftsObj[k].text || '').trim());

      const essaysHtml = hist.length === 0
        ? `<div class="shs-empty" style="padding:1.2rem;">Học viên chưa nộp bài luận (Bước 4) nào.</div>`
        : hist.map((item, idx) => {
            const sc = typeof item.score === 'number' ? item.score : 0;
            return `
              <div class="shs-essay-item">
                <div class="shs-essay-head">
                  <div>
                    <span class="shs-essay-idx">#${idx + 1}</span>
                    <strong>Đề ${escHtml(item.topicId || '?')}: ${escHtml(item.topicTitle || '')}</strong>
                    <div class="shs-essay-meta">${escHtml(item.date || '')} • ${escHtml(item.catTitleVi || '')} • ${Number(item.wordCount || 0)} từ${item.cheatViolations ? ` • ⚠️ Vi phạm: ${item.cheatViolations}` : ''}</div>
                  </div>
                  <div class="shs-essay-score-box">
                    <strong>${sc.toFixed(1)}</strong> / 10
                    <div>(${((sc * 7) / 10).toFixed(1)} / 7.0)</div>
                  </div>
                </div>
                <details class="shs-essay-details" ${idx === 0 ? 'open' : ''}>
                  <summary>📖 Đọc toàn bộ bài viết (${Number(item.wordCount || 0)} từ)</summary>
                  <div class="shs-essay-content">${escHtml(item.content || '')}</div>
                </details>
              </div>
            `;
          }).join('');

      const prepHtml = prepKeys.length === 0
        ? `<div class="shs-muted" style="padding:0.5rem 0;">Chưa có đề luyện Bước 1–2–3.</div>`
        : `<div class="shs-prep-grid">${prepKeys.map(pk => {
            const p = prepObj[pk] || {};
            const [cid, tid] = pk.split('_');
            return `
              <div class="shs-prep-chip">
                <div class="shs-prep-title">${escHtml(resolveTopicLabel(cid, tid))}</div>
                <div class="shs-prep-meta">
                  B1 Đọc: ${formatSecVi(p.readSec)} ${p.readDone ? '✅' : ''} •
                  B2 Từ vựng: ${formatSecVi(p.vocabSec)} ${p.vocabDone ? '✅' : ''} •
                  B3 Dịch: ${formatSecVi(p.transSec)}
                </div>
              </div>
            `;
          }).join('')}</div>`;

      const draftsHtml = activeDraftKeys.length === 0
        ? ''
        : `
          <h4 class="shs-detail-section-title">📝 Bản nháp đang viết dở (${activeDraftKeys.length})</h4>
          ${activeDraftKeys.map(dk => {
            const d = draftsObj[dk];
            const [cid, tid] = dk.split('_');
            const wc = String(d.text || '').trim().split(/\s+/).filter(Boolean).length;
            return `
              <details class="shs-essay-details" style="margin-bottom:0.55rem;">
                <summary>${escHtml(resolveTopicLabel(cid, tid))} (${wc} từ)</summary>
                <div class="shs-essay-content">${escHtml(d.text || '')}</div>
              </details>
            `;
          }).join('')}
        `;

      detailEl.innerHTML = `
        <div class="shs-detail-top">
          <button type="button" class="shs-btn-secondary" id="btn-shs-back">← Quay lại danh sách</button>
          <div class="shs-detail-student-info">
            <strong>${escHtml(res.fullName)}</strong>
            <span class="shs-cls-badge">Lớp ${escHtml(res.classCode || '--')}</span>
            <span class="shs-lvl-badge is-${res.level === 'B2' ? 'b2' : 'b1'}">Web ${escHtml(res.level)}</span>
            <span class="shs-muted">Cập nhật: ${escHtml(res.updatedAt || '--')}</span>
          </div>
        </div>

        <h4 class="shs-detail-section-title">✍️ Bài luận đã nộp – Bước 4 (${hist.length} bài)</h4>
        ${essaysHtml}

        <h4 class="shs-detail-section-title" style="margin-top:1.15rem;">📚 Tiến độ luyện Bước 1 – 2 – 3 (${prepKeys.length} đề)</h4>
        ${prepHtml}
        ${draftsHtml}
      `;

      const bk = document.getElementById('btn-shs-back');
      if (bk) bk.addEventListener('click', hideStudentDetailView);
    } catch (err) {
      detailEl.innerHTML = `
        <div class="shs-detail-top">
          <button type="button" class="shs-btn-secondary" id="btn-shs-back">← Quay lại danh sách</button>
        </div>
        <div class="shs-empty">Lỗi kết nối khi tải chi tiết bài viết. Cô bấm thử lại nhé!</div>
      `;
      const bk = document.getElementById('btn-shs-back');
      if (bk) bk.addEventListener('click', hideStudentDetailView);
    }
  }

  async function loadStudentsReport(silent = false) {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;
    const bodyEl = document.getElementById('shs-main-body');
    if (!silent && bodyEl) {
      bodyEl.innerHTML = `<div class="shs-loading">🔄 Đang tải danh sách học viên &amp; bài nộp từ Google Sheet...</div>`;
    }

    const qs = new URLSearchParams({
      action: 'getAllStudentsReport',
      adminKey: TEACHER_ADMIN_KEY,
      level: 'ALL'
    });

    try {
      const resp = await fetch(`${apiUrl}?${qs.toString()}`, { method: 'GET', cache: 'no-store' });
      const res = await resp.json();
      if (!res || !res.ok) {
        if (!silent && bodyEl) {
          bodyEl.innerHTML = `
            <div class="shs-empty">
              ⚠️ Không đọc được báo cáo từ Apps Script (${escHtml((res && res.error) || 'Chưa cập nhật phiên bản mới')}).<br>
              <small>Cô nhớ bấm <b>Deploy → Manage deployments → Edit → New version → Deploy</b> cho file <code>google_apps_script_student_history.gs</code> nhé!</small>
            </div>`;
        }
        return;
      }

      managerState.students = Array.isArray(res.students) ? res.students : [];
      managerState.essayLogs = Array.isArray(res.essayLogs) ? res.essayLogs : [];
      managerState.generatedAt = res.generatedAt || '';

      updateTeacherCountBadges(managerState.students.length);
      populateClassFilterOptions();

      const noteEl = document.getElementById('shs-last-sync-note');
      if (noteEl) {
        noteEl.textContent = `Đồng bộ trực tiếp từ Google Sheet lúc ${managerState.generatedAt || new Date().toLocaleTimeString('vi-VN')}`;
      }

      if (!silent) {
        hideStudentDetailView();
        renderManagerContent();
      }
    } catch (err) {
      if (!silent && bodyEl) {
        bodyEl.innerHTML = `<div class="shs-empty">⚠️ Lỗi mạng khi tải dữ liệu từ Google Sheet. Cô bấm Làm mới để thử lại nhé!</div>`;
      }
    }
  }

  function openStudentManagerModal() {
    ensureManagerDom();
    const overlay = document.getElementById('shs-manager-overlay');
    if (overlay) overlay.classList.add('is-open');
    hideStudentDetailView();
    loadStudentsReport(false);
  }

  function closeStudentManagerModal() {
    const overlay = document.getElementById('shs-manager-overlay');
    if (overlay) overlay.classList.remove('is-open');
  }

  function onTeacherLoggedIn() {
    managerState.isTeacherMode = true;
    setTeacherButtonsVisible(true);
    loadStudentsReport(true);
  }

  function onLogout() {
    managerState.isTeacherMode = false;
    setTeacherButtonsVisible(false);
    closeStudentManagerModal();
  }

  root.StudentHistorySync = {
    slugifyName,
    getStudentSlug,
    getHistoryKey,
    getDraftPrefix,
    getDraftKey,
    getTransKey,
    getTransTopicPrefix,
    getIdeaSelKey,
    getStickKey,
    getUnstickKey,
    getPrepPrefix,
    getPrepKey,
    recordDraftChange,
    recordStickChange,
    migrateLegacyDataForStudent,
    pullFromCloud,
    pushToCloudNow,
    schedulePush,
    flushOnExit,
    onTeacherLoggedIn,
    onLogout,
    openStudentManagerModal,
    closeStudentManagerModal
  };
})(window);
