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
    flushOnExit
  };
})(window);
