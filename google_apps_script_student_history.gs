/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - QUẢN LÝ & ĐỒNG BỘ LỊCH SỬ HỌC VIÊN (TẤT CẢ CÁC LỚP - B1 & B2)
 * Dự án: PHÒNG LUYỆN VIẾT LUẬN VSTEP B1 & B2 (English with Miss Nguyet)
 * ============================================================================
 * TÍNH NĂNG:
 * - Quản lý TẤT CẢ các lớp (CB210, CB211, CB213, ONB103, B212, ...) trên CẢ 2 web B1 & B2
 * - Học viên đăng nhập đúng tên trên bất kỳ máy/trình duyệt nào sẽ tự động thấy lại
 *   toàn bộ bài đã làm (Bước 1, 2, 3, 4, câu dịch, bản nháp, đánh dấu đã viết)
 * - Tự động tạo 3 tab gọn đẹp trong Google Sheet cho giáo viên theo dõi:
 *     1) TongHopHocVien : Tổng hợp từng học viên (Tên, Lớp, B1/B2, Số bài nộp, Điểm TB, Số đề B1-3, Cập nhật cuối)
 *     2) NhatKyBaiNop   : Nhật ký chi tiết từng bài luận mới nộp của tất cả các lớp
 *     3) DuLieuDongBo   : Kho dữ liệu đồng bộ JSON (không cần chỉnh sửa thủ công)
 *
 * HƯỚNG DẪN CÀI ĐẶT (2 PHÚT):
 * 1. Tạo 1 file Google Sheet mới trên Google Drive (VD: "QUAN LY LICH SU HOC VIEN VSTEP B1 & B2")
 * 2. Chọn menu: Tiện ích mở rộng (Extensions) -> Apps Script
 * 3. Xóa hết code mặc định trong Code.gs, dán toàn bộ file này vào và nhấn Lưu (Cmd+S / Ctrl+S)
 * 4. Nhấn Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment):
 *    - Chọn loại (Select type): Ứng dụng web (Web app)
 *    - Mô tả (Description): Student History Sync All Classes v1
 *    - Thực thi với tư cách (Execute as): Tôi (Me)
 *    - Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 5. Nhấn Triển khai (Deploy) -> Cấp quyền (Authorize access -> Gmail -> Advanced -> Go to... -> Allow)
 * 6. Copy link Web App (dạng https://script.google.com/macros/s/.../exec) gửi lại để gắn vào web B1 & B2!
 * ============================================================================
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';
const TEACHER_ADMIN_KEY = 'PTMN_VSTEP_2026';

const SHEET_SUMMARY = 'TongHopHocVien';
const SHEET_ESSAY_LOG = 'NhatKyBaiNop';
const SHEET_SYNC_DATA = 'DuLieuDongBo';

const SUMMARY_HEADERS = [
  'RecordKey',          // 0 (Col 1): B1|nguyen_van_a
  'Web (B1/B2)',        // 1 (Col 2)
  'Họ và tên',          // 2 (Col 3)
  'Lớp',                // 3 (Col 4)
  'Số bài đã nộp (B4)', // 4 (Col 5)
  'Điểm TB (/10)',      // 5 (Col 6)
  'Đề đã luyện B1-3',   // 6 (Col 7)
  'Số bản nháp',        // 7 (Col 8)
  'Bài gần nhất',       // 8 (Col 9)
  'Cập nhật gần nhất'   // 9 (Col 10)
];

const ESSAY_LOG_HEADERS = [
  'SubmissionKey',      // 0 (Col 1): B1|nguyen_van_a|173... (chống ghi trùng)
  'Thời gian nộp',      // 1 (Col 2)
  'Web (B1/B2)',        // 2 (Col 3)
  'Lớp',                // 3 (Col 4)
  'Họ và tên',          // 4 (Col 5)
  'Dạng bài',           // 5 (Col 6)
  'Đề bài',             // 6 (Col 7)
  'Số từ',              // 7 (Col 8)
  'Điểm (/10)'          // 8 (Col 9)
];

const SYNC_HEADERS = [
  'RecordKey',          // 0 (Col 1): B1|nguyen_van_a
  'Level',              // 1 (Col 2)
  'StudentKey',         // 2 (Col 3)
  'FullName',           // 3 (Col 4)
  'ClassCode',          // 4 (Col 5)
  'UpdatedAt',          // 5 (Col 6)
  'Chunk1',             // 6 (Col 7)
  'Chunk2',             // 7 (Col 8)
  'Chunk3',             // 8 (Col 9)
  'Chunk4'              // 9 (Col 10)
];

function getNowVN() {
  return Utilities.formatDate(new Date(), VN_TZ, 'yyyy-MM-dd HH:mm:ss');
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

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureSheetWithHeaders(ss, name, headers, headerBg, widths) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground(headerBg)
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    if (Array.isArray(widths)) {
      widths.forEach(function (w, idx) {
        if (w) sheet.setColumnWidth(idx + 1, w);
      });
    }
  }
  return sheet;
}

function ensureAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summarySheet = ensureSheetWithHeaders(
    ss,
    SHEET_SUMMARY,
    SUMMARY_HEADERS,
    '#4f46e5',
    [160, 85, 210, 90, 125, 105, 125, 100, 260, 165]
  );
  const essayLogSheet = ensureSheetWithHeaders(
    ss,
    SHEET_ESSAY_LOG,
    ESSAY_LOG_HEADERS,
    '#0f766e',
    [190, 155, 85, 90, 200, 180, 280, 80, 90]
  );
  const syncSheet = ensureSheetWithHeaders(
    ss,
    SHEET_SYNC_DATA,
    SYNC_HEADERS,
    '#334155',
    [160, 65, 150, 200, 90, 160, 160, 100, 100, 100]
  );
  return { summarySheet: summarySheet, essayLogSheet: essayLogSheet, syncSheet: syncSheet };
}

function findRowByCol1(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const vals = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === key) {
      return i + 2;
    }
  }
  return null;
}

function parseSyncChunks(row) {
  const raw = String(row[6] || '') + String(row[7] || '') + String(row[8] || '') + String(row[9] || '');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function splitSyncChunks(payloadObj) {
  const CHUNK_SIZE = 45000;
  const MAX_TOTAL = CHUNK_SIZE * 4;
  let obj = payloadObj || {};
  let str = JSON.stringify(obj);

  if (str.length > MAX_TOTAL && Array.isArray(obj.history) && obj.history.length > 20) {
    const trimmed = Object.assign({}, obj, { history: obj.history.slice(0, 40) });
    str = JSON.stringify(trimmed);
    if (str.length > MAX_TOTAL) {
      trimmed.history = trimmed.history.slice(0, 20);
      str = JSON.stringify(trimmed);
    }
  }

  return [
    str.slice(0, CHUNK_SIZE),
    str.slice(CHUNK_SIZE, CHUNK_SIZE * 2),
    str.slice(CHUNK_SIZE * 2, CHUNK_SIZE * 3),
    str.slice(CHUNK_SIZE * 3, CHUNK_SIZE * 4)
  ];
}

function mergeStudentPayloads(existing, incoming) {
  const ex = (existing && typeof existing === 'object') ? existing : {};
  const inc = (incoming && typeof incoming === 'object') ? incoming : {};

  // 1. Merge history (Step 4 submissions) by id
  const byId = {};
  (Array.isArray(ex.history) ? ex.history : []).forEach(function (it) {
    if (it && it.id) byId[String(it.id)] = it;
  });
  (Array.isArray(inc.history) ? inc.history : []).forEach(function (it) {
    if (!it || !it.id) return;
    const sid = String(it.id);
    if (!byId[sid]) {
      byId[sid] = it;
    } else {
      const merged = Object.assign({}, byId[sid], it);
      if (String(byId[sid].content || '').length > String(it.content || '').length) {
        merged.content = byId[sid].content;
      }
      byId[sid] = merged;
    }
  });
  const history = Object.keys(byId).map(function (k) { return byId[k]; })
    .sort(function (a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); })
    .slice(0, 60);

  // 2. Merge drafts by updatedAt
  const drafts = Object.assign({}, ex.drafts || {});
  const incDrafts = inc.drafts || {};
  Object.keys(incDrafts).forEach(function (k) {
    const cd = incDrafts[k];
    if (!cd || typeof cd !== 'object') return;
    const ed = drafts[k];
    if (!ed || Number(cd.updatedAt || 0) >= Number(ed.updatedAt || 0)) {
      drafts[k] = cd;
    }
  });

  // 3. Merge Step 1-2-3 prep progress
  const prep = Object.assign({}, ex.prep || {});
  const incPrep = inc.prep || {};
  Object.keys(incPrep).forEach(function (k) {
    const cp = incPrep[k];
    if (!cp || typeof cp !== 'object') return;
    const ep = prep[k] || {};
    prep[k] = {
      readSec: Math.max(Number(ep.readSec || 0), Number(cp.readSec || 0)),
      vocabSec: Math.max(Number(ep.vocabSec || 0), Number(cp.vocabSec || 0)),
      transSec: Math.max(Number(ep.transSec || 0), Number(cp.transSec || 0)),
      readDone: Boolean(ep.readDone || cp.readDone),
      vocabDone: Boolean(ep.vocabDone || cp.vocabDone)
    };
  });

  // 4. Merge Step 3 translation states
  const trans = Object.assign({}, ex.trans || {});
  const incTrans = inc.trans || {};
  Object.keys(incTrans).forEach(function (k) {
    const ct = incTrans[k];
    if (!ct || typeof ct !== 'object') return;
    const et = trans[k] || {};
    const mergedT = {};
    const inputVal = (ct.input && String(ct.input).trim()) ? String(ct.input) : (et.input ? String(et.input) : '');
    if (inputVal) mergedT.input = inputVal;
    if (et.checked || ct.checked) mergedT.checked = true;
    if (et.attempted || ct.attempted) mergedT.attempted = true;
    if (et.correct || ct.correct) mergedT.correct = true;
    trans[k] = mergedT;
  });

  // 5. Merge stick / unstick
  const exStickTime = Number(ex.stickUpdatedAt || 0);
  const incStickTime = Number(inc.stickUpdatedAt || 0);
  let stick = Array.isArray(ex.stick) ? ex.stick : [];
  let unstick = Array.isArray(ex.unstick) ? ex.unstick : [];
  let stickUpdatedAt = exStickTime;
  if (incStickTime >= exStickTime && (Array.isArray(inc.stick) || Array.isArray(inc.unstick))) {
    stick = Array.isArray(inc.stick) ? inc.stick : stick;
    unstick = Array.isArray(inc.unstick) ? inc.unstick : unstick;
    stickUpdatedAt = incStickTime;
  }

  return {
    history: history,
    drafts: drafts,
    prep: prep,
    trans: trans,
    stick: stick,
    unstick: unstick,
    stickUpdatedAt: stickUpdatedAt
  };
}

function syncEssayLogRows(essayLogSheet, recordKey, level, studentName, classCode, historyArr) {
  if (!Array.isArray(historyArr) || historyArr.length === 0) return;

  const lastRow = essayLogSheet.getLastRow();
  const existingMap = {};
  if (lastRow >= 2) {
    const keys = essayLogSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i][0] || '').trim();
      if (k) existingMap[k] = i + 2;
    }
  }

  // Duyệt từ cũ -> mới để dòng mới nhất nằm phía dưới (hoặc cập nhật điểm nếu AI chấm lại)
  const ordered = historyArr.slice().reverse();
  ordered.forEach(function (item) {
    if (!item || !item.id) return;
    const subKey = recordKey + '|' + String(item.id);
    const topicLabel = (item.topicId ? ('Đề ' + item.topicId + ': ') : '') + String(item.topicTitle || '');
    const scoreVal = typeof item.score === 'number' ? Number(item.score.toFixed(1)) : '';
    const rowData = [
      subKey,
      String(item.date || getNowVN()),
      level,
      String(item.studentClass || classCode || ''),
      studentName,
      String(item.catTitleVi || ''),
      topicLabel,
      Number(item.wordCount || 0),
      scoreVal
    ];
    if (existingMap[subKey]) {
      // Cập nhật điểm mới nhất nếu vừa chấm AI xong
      essayLogSheet.getRange(existingMap[subKey], 9).setValue(scoreVal);
    } else {
      essayLogSheet.appendRow(rowData);
      existingMap[subKey] = essayLogSheet.getLastRow();
    }
  });
}

function handleGetStudentHistory(params) {
  const studentName = String(params.studentName || params.name || '').trim();
  const level = String(params.level || 'B1').trim().toUpperCase() === 'B2' ? 'B2' : 'B1';
  if (!studentName) return { ok: false, error: 'Missing studentName' };

  const studentKey = slugifyName(studentName);
  const recordKey = level + '|' + studentKey;
  const sheets = ensureAllSheets();
  const rowNum = findRowByCol1(sheets.syncSheet, recordKey);
  if (!rowNum) {
    return { ok: true, found: false, recordKey: recordKey, studentKey: studentKey };
  }

  const row = sheets.syncSheet.getRange(rowNum, 1, 1, SYNC_HEADERS.length).getValues()[0];
  const data = parseSyncChunks(row);
  return {
    ok: true,
    found: Boolean(data),
    recordKey: recordKey,
    studentKey: studentKey,
    fullName: String(row[3] || studentName),
    classCode: String(row[4] || ''),
    updatedAt: String(row[5] || ''),
    data: data
  };
}

function handleSaveStudentHistory(params, nowStr) {
  const studentName = String(params.studentName || params.name || '').trim();
  const classCode = String(params.classCode || '').trim().toUpperCase();
  const level = String(params.level || 'B1').trim().toUpperCase() === 'B2' ? 'B2' : 'B1';
  if (!studentName) return { ok: false, error: 'Missing studentName' };

  let incoming = params.payload;
  if (typeof incoming === 'string') {
    try {
      incoming = JSON.parse(incoming);
    } catch (e) {
      return { ok: false, error: 'Invalid JSON payload' };
    }
  }
  if (!incoming || typeof incoming !== 'object') {
    return { ok: false, error: 'Missing payload' };
  }

  const studentKey = slugifyName(studentName);
  const recordKey = level + '|' + studentKey;
  const sheets = ensureAllSheets();

  // 1. Update DuLieuDongBo
  const syncRowNum = findRowByCol1(sheets.syncSheet, recordKey);
  let existing = null;
  let prevClass = '';
  if (syncRowNum) {
    const prevRow = sheets.syncSheet.getRange(syncRowNum, 1, 1, SYNC_HEADERS.length).getValues()[0];
    existing = parseSyncChunks(prevRow);
    prevClass = String(prevRow[4] || '');
  }

  const effClass = classCode || prevClass;
  const merged = mergeStudentPayloads(existing, incoming);
  const chunks = splitSyncChunks(merged);

  const syncValues = [
    recordKey,
    level,
    studentKey,
    studentName,
    effClass,
    nowStr,
    chunks[0],
    chunks[1],
    chunks[2],
    chunks[3]
  ];

  if (syncRowNum) {
    sheets.syncSheet.getRange(syncRowNum, 7, 1, 4).setNumberFormat('@');
    sheets.syncSheet.getRange(syncRowNum, 1, 1, SYNC_HEADERS.length).setValues([syncValues]);
  } else {
    sheets.syncSheet.appendRow(syncValues);
    const newRow = sheets.syncSheet.getLastRow();
    sheets.syncSheet.getRange(newRow, 7, 1, 4).setNumberFormat('@');
    sheets.syncSheet.getRange(newRow, 7, 1, 4).setValues([[chunks[0], chunks[1], chunks[2], chunks[3]]]);
  }

  // 2. Update TongHopHocVien (Bảng quản lý trực quan cho cô)
  const histArr = Array.isArray(merged.history) ? merged.history : [];
  const essaysCount = histArr.length;
  let avgScore = '';
  if (essaysCount > 0) {
    let sum = 0;
    let cnt = 0;
    histArr.forEach(function (h) {
      if (typeof h.score === 'number' && !isNaN(h.score)) {
        sum += h.score;
        cnt++;
      }
    });
    if (cnt > 0) avgScore = Number((sum / cnt).toFixed(1));
  }
  const prepCount = merged.prep ? Object.keys(merged.prep).length : 0;
  let activeDrafts = 0;
  if (merged.drafts) {
    Object.keys(merged.drafts).forEach(function (dk) {
      const d = merged.drafts[dk];
      if (d && !d.deleted && d.text && String(d.text).trim()) activeDrafts++;
    });
  }
  let latestInfo = '';
  if (histArr.length > 0) {
    const h0 = histArr[0];
    latestInfo = 'Đề ' + (h0.topicId || '?') + ': ' + (h0.topicTitle || '') +
      ' (' + (h0.wordCount || 0) + ' từ' + (typeof h0.score === 'number' ? ' - ' + h0.score.toFixed(1) + 'đ' : '') + ')';
  }

  const summaryValues = [
    recordKey,
    level,
    studentName,
    effClass,
    essaysCount,
    avgScore,
    prepCount,
    activeDrafts,
    latestInfo,
    nowStr
  ];
  const sumRowNum = findRowByCol1(sheets.summarySheet, recordKey);
  if (sumRowNum) {
    sheets.summarySheet.getRange(sumRowNum, 1, 1, SUMMARY_HEADERS.length).setValues([summaryValues]);
  } else {
    sheets.summarySheet.appendRow(summaryValues);
  }

  // 3. Update NhatKyBaiNop (Chi tiết từng bài nộp)
  syncEssayLogRows(sheets.essayLogSheet, recordKey, level, studentName, effClass, histArr);

  return {
    ok: true,
    saved: true,
    recordKey: recordKey,
    essaysCount: essaysCount,
    prepCount: prepCount,
    updatedAt: nowStr
  };
}

function handleGetAllStudentsReport(params) {
  const adminKey = String(params.adminKey || '').trim();
  if (adminKey !== TEACHER_ADMIN_KEY) {
    return { ok: false, error: 'Unauthorized' };
  }

  const filterLevel = String(params.level || 'ALL').trim().toUpperCase();
  const sheets = ensureAllSheets();

  // 1. Read TongHopHocVien
  const students = [];
  const sumLast = sheets.summarySheet.getLastRow();
  if (sumLast >= 2) {
    const rows = sheets.summarySheet.getRange(2, 1, sumLast - 1, SUMMARY_HEADERS.length).getValues();
    rows.forEach(function (r) {
      const recordKey = String(r[0] || '').trim();
      if (!recordKey) return;
      const lvl = String(r[1] || 'B1').trim().toUpperCase();
      if (filterLevel !== 'ALL' && lvl !== filterLevel) return;
      const avgRaw = r[5];
      students.push({
        recordKey: recordKey,
        level: lvl,
        fullName: String(r[2] || '').trim(),
        classCode: String(r[3] || '').trim().toUpperCase(),
        essaysCount: Number(r[4] || 0),
        avgScore: (avgRaw !== '' && avgRaw !== null && !isNaN(Number(avgRaw))) ? Number(avgRaw) : null,
        prepCount: Number(r[6] || 0),
        activeDrafts: Number(r[7] || 0),
        latestInfo: String(r[8] || '').trim(),
        updatedAt: String(r[9] || '').trim()
      });
    });
  }
  students.sort(function (a, b) {
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });

  // 2. Read NhatKyBaiNop (newest first, up to 300 rows)
  const essayLogs = [];
  const logLast = sheets.essayLogSheet.getLastRow();
  if (logLast >= 2) {
    const startRow = Math.max(2, logLast - 299);
    const numRows = logLast - startRow + 1;
    const rows = sheets.essayLogSheet.getRange(startRow, 1, numRows, ESSAY_LOG_HEADERS.length).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const subKey = String(r[0] || '').trim();
      if (!subKey) continue;
      const lvl = String(r[2] || 'B1').trim().toUpperCase();
      if (filterLevel !== 'ALL' && lvl !== filterLevel) continue;
      const scoreRaw = r[8];
      essayLogs.push({
        submissionKey: subKey,
        recordKey: subKey.split('|').slice(0, 2).join('|'),
        date: String(r[1] || '').trim(),
        level: lvl,
        classCode: String(r[3] || '').trim().toUpperCase(),
        fullName: String(r[4] || '').trim(),
        catTitleVi: String(r[5] || '').trim(),
        topicLabel: String(r[6] || '').trim(),
        wordCount: Number(r[7] || 0),
        score: (scoreRaw !== '' && scoreRaw !== null && !isNaN(Number(scoreRaw))) ? Number(scoreRaw) : null
      });
    }
  }

  return {
    ok: true,
    students: students,
    essayLogs: essayLogs,
    generatedAt: getNowVN()
  };
}

function handleGetStudentDetail(params) {
  const adminKey = String(params.adminKey || '').trim();
  if (adminKey !== TEACHER_ADMIN_KEY) {
    return { ok: false, error: 'Unauthorized' };
  }

  let recordKey = String(params.recordKey || '').trim();
  if (!recordKey) {
    const studentName = String(params.studentName || '').trim();
    const level = String(params.level || 'B1').trim().toUpperCase() === 'B2' ? 'B2' : 'B1';
    if (!studentName) return { ok: false, error: 'Missing recordKey' };
    recordKey = level + '|' + slugifyName(studentName);
  }

  const sheets = ensureAllSheets();
  const rowNum = findRowByCol1(sheets.syncSheet, recordKey);
  if (!rowNum) {
    return { ok: true, found: false, recordKey: recordKey };
  }

  const row = sheets.syncSheet.getRange(rowNum, 1, 1, SYNC_HEADERS.length).getValues()[0];
  const data = parseSyncChunks(row) || {};
  return {
    ok: true,
    found: true,
    recordKey: recordKey,
    level: String(row[1] || 'B1'),
    fullName: String(row[3] || ''),
    classCode: String(row[4] || ''),
    updatedAt: String(row[5] || ''),
    data: data
  };
}

function handleAction(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(12000);
  try {
    const action = String(params.action || 'ping').trim();
    const nowStr = getNowVN();

    if (action === 'ping') {
      ensureAllSheets();
      return { ok: true, message: 'VSTEP Student History Sync (All Classes - B1 & B2) ready', updatedAt: nowStr };
    }
    if (action === 'getStudentHistory') {
      return handleGetStudentHistory(params);
    }
    if (action === 'saveStudentHistory') {
      return handleSaveStudentHistory(params, nowStr);
    }
    if (action === 'getAllStudentsReport') {
      return handleGetAllStudentsReport(params);
    }
    if (action === 'getStudentDetail') {
      return handleGetStudentDetail(params);
    }

    return { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  return jsonResponse(handleAction(params));
}

function doPost(e) {
  let params = (e && e.parameter) ? e.parameter : {};
  if (e && e.postData && e.postData.contents) {
    try {
      const body = JSON.parse(e.postData.contents);
      params = Object.assign({}, params, body);
    } catch (err) {}
  }
  return jsonResponse(handleAction(params));
}
