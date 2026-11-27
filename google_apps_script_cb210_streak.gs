/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - QUẢN LÝ CHỈ TIÊU VIẾT LUẬN HẰNG NGÀY (LỚP CB210)
 * Dự án: PHÒNG LUYỆN VIẾT LUẬN VSTEP B1 & B2 (English with Miss Nguyet)
 * ============================================================================
 * HƯỚNG DẪN CÀI ĐẶT (CHỈ MẤT 2-3 PHÚT):
 * 1. Tạo 1 file Google Sheet mới trên Google Drive (VD: "Quan Ly Viet Luan Hang Ngay - CB210")
 * 2. Trên thanh menu Google Sheet, chọn: Tiện ích mở rộng (Extensions) -> Apps Script
 * 3. Xóa hết code mặc định trong file Code.gs, dán toàn bộ code này vào và nhấn Lưu (Ctrl+S / Cmd+S)
 * 4. Nhấn nút: Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment)
 *    - Chọn loại (Select type): Ứng dụng web (Web app)
 *    - Mô tả (Description): CB210 Writing Streak v1
 *    - Thực thi với tư cách (Execute as): Tôi (Me)
 *    - Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 5. Nhấn Triển khai (Deploy) -> Cấp quyền (Authorize access -> Chọn tài khoản Gmail -> Advanced / Nâng cao -> Go to... -> Allow)
 * 6. Copy đường link Web App (có dạng: https://script.google.com/macros/s/.../exec)
 *    và gửi lại vào khung chat để gắn cố định vào cả 2 website B1 & B2!
 * ============================================================================
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';
const TEACHER_ADMIN_KEY = 'PTMN_VSTEP_2026';

const SHEET_STUDENTS = 'HocVien_CB210';
const SHEET_LOGS = 'NhatKyNopBai';
const SHEET_CONFIG = 'CaiDat';
const SHEET_STUDENT_HISTORY = 'LichSuHocVien';

const HISTORY_HEADERS = [
  'RecordKey',    // 0 (Col 1): <LEVEL>|<studentSlug> (VD: B1|nguyen_van_a)
  'Level',        // 1 (Col 2): B1 | B2
  'StudentKey',   // 2 (Col 3): nguyen_van_a
  'FullName',     // 3 (Col 4): Họ tên học viên
  'ClassCode',    // 4 (Col 5): Mã lớp
  'EssaysCount',  // 5 (Col 6): Số bài luận đã nộp (Bước 4)
  'PrepCount',    // 6 (Col 7): Số đề đã luyện Bước 1-2-3
  'UpdatedAt',    // 7 (Col 8): Thời điểm đồng bộ cuối
  'Chunk1',       // 8 (Col 9): JSON dữ liệu phần 1 (tối đa 45.000 ký tự)
  'Chunk2',       // 9 (Col 10): JSON dữ liệu phần 2
  'Chunk3',       // 10 (Col 11): JSON dữ liệu phần 3
  'Chunk4'        // 11 (Col 12): JSON dữ liệu phần 4
];

// Danh sách cố định 15 học viên lớp CB210 (tự động khởi tạo vào Sheet)
const CB210_ROSTER = [
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
];

const STUDENT_HEADERS = [
  'StudentKey',          // 0 (Col 1)
  'FullName',            // 1 (Col 2)
  'ClassCode',           // 2 (Col 3)
  'StreakCount',         // 3 (Col 4): Chuỗi ngày viết liên tiếp
  'BestStreak',          // 4 (Col 5): Chuỗi cao nhất
  'LastEssayDate',       // 5 (Col 6): Ngày gần nhất nộp bài hoàn chỉnh (YYYY-MM-DD)
  'EssaysToday',         // 6 (Col 7): Số bài hoàn chỉnh đã nộp trong ngày LastEssayDate
  'TotalEssays',         // 7 (Col 8): Tổng số bài hoàn chỉnh đã nộp
  'TotalDays',           // 8 (Col 9): Tổng số ngày đạt chỉ tiêu
  'Status',              // 9 (Col 10): ACTIVE | LOCKED
  'LockReason',          // 10 (Col 11): Lý do khóa
  'LockedAt',            // 11 (Col 12): Thời điểm khóa
  'UnlockRequested',     // 12 (Col 13): YES | NO
  'UnlockRequestNote',   // 13 (Col 14): Lời nhắn xin mở khóa từ học viên
  'UnlockedByTeacherAt', // 14 (Col 15): Lần mở khóa gần nhất
  'GraceUntilDate',      // 15 (Col 16): Ngày ân hạn sau khi cô mở khóa (YYYY-MM-DD)
  'LastEssayInfo',       // 16 (Col 17): Thông tin bài viết gần nhất
  'UpdatedAt',           // 17 (Col 18): Cập nhật cuối
  'WarningCount',        // 18 (Col 19): Số lần đã nhắc nhở bỏ chuỗi (0, 1, 2...)
  'LastWarningDate'      // 19 (Col 20): Ngày gần nhất nhận nhắc nhở bỏ chuỗi (YYYY-MM-DD)
];

const LOG_HEADERS = [
  'Timestamp',
  'DateVN',
  'FullName',
  'ClassCode',
  'Level',
  'Topic',
  'WordCount',
  'Score',
  'Qualified'
];

function getTodayVN() {
  return Utilities.formatDate(new Date(), VN_TZ, 'yyyy-MM-dd');
}

function getTomorrowVN() {
  const d = new Date(Date.now() + 86400000);
  return Utilities.formatDate(d, VN_TZ, 'yyyy-MM-dd');
}

function getNowVN() {
  return Utilities.formatDate(new Date(), VN_TZ, 'yyyy-MM-dd HH:mm:ss');
}

function normalizeDateCell(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, VN_TZ, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return s;
}

function diffDaysYMD(ymdStart, ymdEnd) {
  if (!ymdStart || !ymdEnd) return 0;
  const p1 = ymdStart.split('-').map(Number);
  const p2 = ymdEnd.split('-').map(Number);
  if (p1.length !== 3 || p2.length !== 3) return 0;
  const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  return Math.round((t2 - t1) / 86400000);
}

// Kiểm tra các ngày nằm GIỮA ymdStart và ymdEnd (exclusive cả 2 đầu) có phải đều là Chủ Nhật không
function isOnlySundaysBetween(ymdStart, ymdEnd) {
  const p1 = ymdStart.split('-').map(Number);
  const p2 = ymdEnd.split('-').map(Number);
  const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  for (let t = t1 + 86400000; t < t2; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0) {
      return false;
    }
  }
  return true;
}

// Kiểm tra các ngày từ ymdFrom (inclusive) đến trước ymdToday (exclusive) có phải đều là Chủ Nhật không
function isOnlySundaysFromStart(ymdFrom, ymdToday) {
  const p1 = ymdFrom.split('-').map(Number);
  const p2 = ymdToday.split('-').map(Number);
  const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  for (let t = t1; t < t2; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0) {
      return false;
    }
  }
  return true;
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

function makeStudentKey(name, classCode) {
  const normClass = String(classCode || 'CB210').trim().toUpperCase().replace(/\s+/g, '');
  return slugifyName(name) + '|' + normClass;
}

function ensureSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Sheet Học viên CB210
  let studentSheet = ss.getSheetByName(SHEET_STUDENTS);
  if (!studentSheet) {
    studentSheet = ss.insertSheet(SHEET_STUDENTS);
    studentSheet.getRange(1, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]);
    studentSheet.getRange(1, 1, 1, STUDENT_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#ffffff');
    studentSheet.setFrozenRows(1);
  } else if (studentSheet.getLastRow() === 0) {
    studentSheet.getRange(1, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]);
  } else if (studentSheet.getLastColumn() < STUDENT_HEADERS.length) {
    // Tự động bổ sung cột WarningCount (19) & LastWarningDate (20) cho Sheet đã tạo trước đó
    const startCol = studentSheet.getLastColumn() + 1;
    const missingHeaders = STUDENT_HEADERS.slice(startCol - 1);
    studentSheet.getRange(1, startCol, 1, missingHeaders.length)
      .setValues([missingHeaders])
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#ffffff');
  }

  // Tự động khởi tạo đủ 15 học viên CB210 nếu chưa có trong Sheet
  const existingData = studentSheet.getDataRange().getValues();
  const existingKeys = {};
  for (let i = 1; i < existingData.length; i++) {
    const k = String(existingData[i][0] || '').trim();
    if (k) existingKeys[k] = true;
  }
  const nowStr = getNowVN();
  const rowsToAppend = [];
  for (let i = 0; i < CB210_ROSTER.length; i++) {
    const fullName = CB210_ROSTER[i];
    const key = makeStudentKey(fullName, 'CB210');
    if (!existingKeys[key]) {
      rowsToAppend.push([
        key, fullName, 'CB210',
        0, 0, '', 0, 0, 0,
        'ACTIVE', '', '', 'NO', '', '', '', '', nowStr, 0, ''
      ]);
      existingKeys[key] = true;
    }
  }
  if (rowsToAppend.length > 0) {
    studentSheet.getRange(studentSheet.getLastRow() + 1, 1, rowsToAppend.length, STUDENT_HEADERS.length)
      .setValues(rowsToAppend);
  }

  // 2. Sheet Nhật ký nộp bài
  let logSheet = ss.getSheetByName(SHEET_LOGS);
  if (!logSheet) {
    logSheet = ss.insertSheet(SHEET_LOGS);
    logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    logSheet.getRange(1, 1, 1, LOG_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1d4ed8')
      .setFontColor('#ffffff');
    logSheet.setFrozenRows(1);
  } else if (logSheet.getLastRow() === 0) {
    logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  }

  // 3. Sheet Cài đặt
  let configSheet = ss.getSheetByName(SHEET_CONFIG);
  if (!configSheet) {
    configSheet = ss.insertSheet(SHEET_CONFIG);
    configSheet.getRange(1, 1, 7, 2).setValues([
      ['Key', 'Value'],
      ['SystemEnabled', 'TRUE'],         // TRUE = bật khóa tự động khi không viết bài, FALSE = tạm tắt
      ['StartDate', getTomorrowVN()],    // Ngày bắt đầu áp dụng (mặc định: ngày mai để không khóa oan hôm nay)
      ['StreakMode', 'STRICT_DAILY'],    // STRICT_DAILY (cả Chủ Nhật) | ALLOW_SUNDAY_OFF (miễn Chủ Nhật)
      ['MinWords', '250'],               // Số từ tối thiểu để tính là 1 bài luận hoàn chỉnh
      ['MaxWarningsBeforeLock', '2'],    // Số lần nhắc nhở bỏ chuỗi trước khi khóa (mặc định: nhắc 2 lần, lần 3 mới khóa)
      ['UpdatedAt', nowStr]
    ]);
    configSheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#059669').setFontColor('#ffffff');
    configSheet.setFrozenRows(1);
  }

  return { studentSheet, logSheet, configSheet };
}

function readConfig(configSheet) {
  const cfg = {
    SystemEnabled: true,
    StartDate: getTomorrowVN(),
    StreakMode: 'STRICT_DAILY',
    MinWords: 250,
    MaxWarningsBeforeLock: 2
  };
  const rows = configSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || '').trim();
    const rawVal = rows[i][1];
    const v = String(rawVal || '').trim();
    if (k === 'SystemEnabled') cfg.SystemEnabled = (v.toUpperCase() !== 'FALSE');
    if (k === 'StartDate' && rawVal) cfg.StartDate = normalizeDateCell(rawVal);
    if (k === 'StreakMode' && v) cfg.StreakMode = v;
    if (k === 'MinWords' && v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 50 && n <= 1000) cfg.MinWords = n;
    }
    if (k === 'MaxWarningsBeforeLock' && v !== '') {
      const nw = parseInt(v, 10);
      if (!isNaN(nw) && nw >= 0 && nw <= 10) cfg.MaxWarningsBeforeLock = nw;
    }
  }
  return cfg;
}

function writeConfig(configSheet, newCfg) {
  const rows = configSheet.getDataRange().getValues();
  const keysToSet = {};
  if (typeof newCfg.SystemEnabled !== 'undefined') keysToSet.SystemEnabled = newCfg.SystemEnabled ? 'TRUE' : 'FALSE';
  if (typeof newCfg.StartDate !== 'undefined' && /^\d{4}-\d{2}-\d{2}$/.test(String(newCfg.StartDate).trim())) {
    keysToSet.StartDate = String(newCfg.StartDate).trim();
  }
  if (typeof newCfg.StreakMode !== 'undefined' && newCfg.StreakMode) {
    keysToSet.StreakMode = String(newCfg.StreakMode).trim();
  }
  if (typeof newCfg.MinWords !== 'undefined') {
    const n = parseInt(newCfg.MinWords, 10);
    if (!isNaN(n) && n >= 50 && n <= 1000) keysToSet.MinWords = String(n);
  }
  if (typeof newCfg.MaxWarningsBeforeLock !== 'undefined' && String(newCfg.MaxWarningsBeforeLock).trim() !== '') {
    const nw = parseInt(newCfg.MaxWarningsBeforeLock, 10);
    if (!isNaN(nw) && nw >= 0 && nw <= 10) keysToSet.MaxWarningsBeforeLock = String(nw);
  }
  keysToSet.UpdatedAt = getNowVN();

  Object.keys(keysToSet).forEach((key) => {
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) {
        configSheet.getRange(i + 1, 2).setNumberFormat('@').setValue(keysToSet[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      configSheet.appendRow([key, keysToSet[key]]);
    }
  });

  return readConfig(configSheet);
}

function rowToStudentObj(row, rowIndex, today) {
  const lastEssayDate = normalizeDateCell(row[5]);
  const rawEssaysToday = Number(row[6] || 0);
  const essaysToday = (lastEssayDate === today) ? Math.max(1, rawEssaysToday) : 0;

  return {
    rowIndex: rowIndex,
    studentKey: String(row[0] || ''),
    fullName: String(row[1] || ''),
    classCode: String(row[2] || 'CB210'),
    streakCount: Number(row[3] || 0),
    bestStreak: Number(row[4] || 0),
    lastEssayDate: lastEssayDate,
    essaysToday: essaysToday,
    totalEssays: Number(row[7] || 0),
    totalDays: Number(row[8] || 0),
    status: String(row[9] || 'ACTIVE').toUpperCase(),
    lockReason: String(row[10] || ''),
    lockedAt: String(row[11] || ''),
    unlockRequested: String(row[12] || 'NO').toUpperCase() === 'YES',
    unlockRequestNote: String(row[13] || ''),
    unlockedByTeacherAt: String(row[14] || ''),
    graceUntilDate: normalizeDateCell(row[15]),
    lastEssayInfo: String(row[16] || ''),
    updatedAt: String(row[17] || ''),
    warningCount: Number(row[18] || 0),
    lastWarningDate: normalizeDateCell(row[19])
  };
}

function findStudentRow(studentSheet, key, today) {
  const data = studentSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === key) {
      return { rowNumber: i + 1, row: data[i], student: rowToStudentObj(data[i], i + 1, today) };
    }
  }
  return null;
}

/**
 * Đánh giá học viên có bị thiếu ngày bắt buộc (để khóa) tại ngày `today` hay không.
 * Trả về: { shouldLock: boolean, daysMissed: number, reason: string }
 */
function evaluateMissedWriting(st, cfg, today) {
  if (!cfg.SystemEnabled) {
    return { shouldLock: false, daysMissed: 0, reason: '' };
  }
  // Nếu hôm nay vẫn trước hoặc đúng ngày bắt đầu áp dụng -> chưa phạt khóa
  if (cfg.StartDate && today <= cfg.StartDate) {
    return { shouldLock: false, daysMissed: 0, reason: '' };
  }
  // Nếu đang có ngày ân hạn của giáo viên (hôm nay hoặc xa hơn) -> không khóa
  if (st.graceUntilDate && st.graceUntilDate >= today) {
    return { shouldLock: false, daysMissed: 0, reason: '' };
  }
  // Nếu đã nộp bài hoàn chỉnh hôm nay -> không khóa
  if (st.lastEssayDate === today) {
    return { shouldLock: false, daysMissed: 0, reason: '' };
  }

  const allowSunday = (cfg.StreakMode === 'ALLOW_SUNDAY_OFF');

  // Trường hợp 1: Học viên đã từng nộp bài từ StartDate trở về sau
  if (st.lastEssayDate && (!cfg.StartDate || st.lastEssayDate >= cfg.StartDate)) {
    const gap = diffDaysYMD(st.lastEssayDate, today);
    if (gap <= 1) {
      return { shouldLock: false, daysMissed: 0, reason: '' };
    }
    if (allowSunday && isOnlySundaysBetween(st.lastEssayDate, today)) {
      return { shouldLock: false, daysMissed: 0, reason: '' };
    }
    const missed = Math.max(1, gap - 1);
    return {
      shouldLock: true,
      daysMissed: missed,
      reason: 'Không nộp bài luận hoàn chỉnh hằng ngày (lần cuối nộp: ' + st.lastEssayDate + ', bỏ lỡ ' + missed + ' ngày)'
    };
  }

  // Trường hợp 2: Học viên CHƯA nộp bài hoàn chỉnh nào kể từ StartDate (và hôm nay > StartDate)
  if (cfg.StartDate && today > cfg.StartDate) {
    if (allowSunday && isOnlySundaysFromStart(cfg.StartDate, today)) {
      return { shouldLock: false, daysMissed: 0, reason: '' };
    }
    const missed = Math.max(1, diffDaysYMD(cfg.StartDate, today));
    return {
      shouldLock: true,
      daysMissed: missed,
      reason: 'Chưa nộp bài luận hoàn chỉnh nào (≥ ' + cfg.MinWords + ' từ) kể từ ngày áp dụng ' + cfg.StartDate + ' (bỏ lỡ ' + missed + ' ngày)'
    };
  }

  return { shouldLock: false, daysMissed: 0, reason: '' };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleAction(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(12000);
  try {
    const action = String(params.action || 'ping').trim();
    const today = getTodayVN();
    const nowStr = getNowVN();

    // 0. ĐỒNG BỘ LỊCH SỬ HỌC VIÊN THEO TÊN (MỌI LỚP - B1 & B2)
    if (action === 'getStudentHistory') {
      return handleGetStudentHistory(params);
    }
    if (action === 'saveStudentHistory') {
      return handleSaveStudentHistory(params, nowStr);
    }

    const { studentSheet, logSheet, configSheet } = ensureSheets();
    const cfg = readConfig(configSheet);

    if (action === 'ping') {
      return { ok: true, message: 'CB210 Writing Streak API ready', today: today, config: cfg };
    }

    // =========================================================================
    // 1. CHECK LOGIN (Học viên CB210 đăng nhập)
    // =========================================================================
    if (action === 'checkLogin') {
      const name = String(params.name || '').trim();
      const classCode = String(params.classCode || 'CB210').trim().toUpperCase();
      if (!name) return { ok: false, error: 'Missing name' };

      // Chỉ áp dụng kiểm tra khóa nghiêm ngặt cho lớp CB210
      if (classCode !== 'CB210') {
        return { ok: true, locked: false, skippedClass: true, config: cfg };
      }

      const key = makeStudentKey(name, 'CB210');
      let found = findStudentRow(studentSheet, key, today);

      // Nếu học viên CB210 mới bổ sung chưa có trong roster -> tạo mới
      if (!found) {
        studentSheet.appendRow([
          key, name, 'CB210',
          0, 0, '', 0, 0, 0,
          'ACTIVE', '', '', 'NO', '', '', '', '', nowStr, 0, ''
        ]);
        found = findStudentRow(studentSheet, key, today);
      }

      const st = found.student;
      const rNum = found.rowNumber;

      // Cập nhật tên có dấu nếu cần
      if (name && name !== st.fullName) {
        studentSheet.getRange(rNum, 2).setValue(name);
        st.fullName = name;
      }

      // Nếu hệ thống đang TẠM TẮT
      if (!cfg.SystemEnabled) {
        return {
          ok: true,
          locked: false,
          systemDisabled: true,
          streakCount: st.streakCount,
          bestStreak: st.bestStreak,
          lastEssayDate: st.lastEssayDate,
          essaysToday: st.essaysToday,
          totalEssays: st.totalEssays,
          todayDone: st.lastEssayDate === today,
          today: today,
          config: cfg
        };
      }

      const hasGraceToday = Boolean(st.graceUntilDate && st.graceUntilDate >= today);

      const maxWarnings = (typeof cfg.MaxWarningsBeforeLock === 'number') ? cfg.MaxWarningsBeforeLock : 2;

      // Đang bị khóa thủ công hoặc đã bị khóa trước đó (và không có ân hạn hôm nay)
      if (st.status === 'LOCKED' && !hasGraceToday) {
        return {
          ok: true,
          locked: true,
          fullName: st.fullName,
          classCode: 'CB210',
          streakCount: st.streakCount,
          bestStreak: st.bestStreak,
          lastEssayDate: st.lastEssayDate,
          totalEssays: st.totalEssays,
          warningCount: st.warningCount,
          maxWarnings: maxWarnings,
          lockReason: st.lockReason || ('Tài khoản CB210 đang bị khóa do bỏ chuỗi vượt quá ' + maxWarnings + ' lần nhắc nhở.'),
          unlockRequested: st.unlockRequested,
          unlockRequestNote: st.unlockRequestNote,
          today: today,
          config: cfg
        };
      }

      // Đánh giá bỏ lỡ ngày viết bài (chính sách: nhắc nhở 2 lần, bỏ lần thứ 3 mới khóa)
      const check = evaluateMissedWriting(st, cfg, today);
      if (check.shouldLock) {
        // Nếu chưa hết lượt nhắc nhở (warningCount < maxWarnings) -> KHÔNG KHÓA, ghi nhận cảnh báo & cho vào viết hôm nay
        if (st.warningCount < maxWarnings) {
          const newWarnCount = st.warningCount + 1;
          const warnMsg = (newWarnCount >= maxWarnings)
            ? ('CẢNH BÁO LẦN CUỐI (' + newWarnCount + '/' + maxWarnings + '): ' + check.reason + '. Nếu tiếp tục bỏ chuỗi thêm 1 lần nữa, tài khoản sẽ TỰ ĐỘNG BỊ KHÓA!')
            : ('NHẮC NHỞ BỎ CHUỖI LẦN ' + newWarnCount + '/' + maxWarnings + ': ' + check.reason + '. Hãy nộp đủ 1 bài luận hoàn chỉnh hôm nay để giữ quyền truy cập!');

          studentSheet.getRange(rNum, 4).setValue(0);                               // Reset StreakCount = 0 vì bỏ chuỗi
          studentSheet.getRange(rNum, 16).setNumberFormat('@').setValue(today);     // GraceUntilDate = hôm nay (để vào viết bài ngay)
          studentSheet.getRange(rNum, 18).setValue(nowStr);                         // UpdatedAt
          studentSheet.getRange(rNum, 19).setValue(newWarnCount);                   // WarningCount
          studentSheet.getRange(rNum, 20).setNumberFormat('@').setValue(today);     // LastWarningDate

          return {
            ok: true,
            locked: false,
            streakWarning: true,
            newlyWarned: true,
            warningCount: newWarnCount,
            maxWarnings: maxWarnings,
            daysMissed: check.daysMissed,
            warningReason: warnMsg,
            fullName: st.fullName,
            classCode: 'CB210',
            streakCount: 0,
            bestStreak: st.bestStreak,
            lastEssayDate: st.lastEssayDate,
            essaysToday: 0,
            totalEssays: st.totalEssays,
            todayDone: false,
            hasGraceToday: true,
            today: today,
            config: cfg
          };
        }

        // Đã nhắc đủ maxWarnings (2 lần) mà vẫn bỏ chuỗi tiếp -> TỰ ĐỘNG KHÓA!
        const finalLockReason = maxWarnings > 0
          ? ('Đã bỏ chuỗi lần thứ ' + (maxWarnings + 1) + ' sau ' + maxWarnings + ' lần nhắc nhở (' + check.reason + ')')
          : check.reason;

        studentSheet.getRange(rNum, 10).setValue('LOCKED');         // Status
        studentSheet.getRange(rNum, 11).setValue(finalLockReason);  // LockReason
        studentSheet.getRange(rNum, 12).setValue(nowStr);           // LockedAt
        studentSheet.getRange(rNum, 18).setValue(nowStr);           // UpdatedAt
        return {
          ok: true,
          locked: true,
          newlyLocked: true,
          fullName: st.fullName,
          classCode: 'CB210',
          streakCount: st.streakCount,
          bestStreak: st.bestStreak,
          lastEssayDate: st.lastEssayDate,
          totalEssays: st.totalEssays,
          daysMissed: check.daysMissed,
          warningCount: st.warningCount,
          maxWarnings: maxWarnings,
          lockReason: finalLockReason,
          unlockRequested: st.unlockRequested,
          unlockRequestNote: st.unlockRequestNote,
          today: today,
          config: cfg
        };
      }

      // Được phép vào học! Nếu hôm nay vừa bị nhắc nhở và vẫn chưa nộp bài hôm nay -> hiện lại nhắc nhở (không tăng WarningCount)
      const warnedTodayNotDone = (st.lastWarningDate === today && st.lastEssayDate !== today && st.warningCount > 0);
      const repeatWarnMsg = warnedTodayNotDone
        ? (st.warningCount >= maxWarnings
            ? ('CẢNH BÁO LẦN CUỐI (' + st.warningCount + '/' + maxWarnings + '): Hôm nay bạn cần nộp đủ 1 bài luận hoàn chỉnh (≥ ' + cfg.MinWords + ' từ). Nếu bỏ chuỗi thêm 1 lần nữa, tài khoản sẽ TỰ ĐỘNG BỊ KHÓA!')
            : ('NHẮC NHỞ BỎ CHUỖI LẦN ' + st.warningCount + '/' + maxWarnings + ': Hôm nay bạn cần nộp đủ 1 bài luận hoàn chỉnh (≥ ' + cfg.MinWords + ' từ) để bắt đầu lại chuỗi viết nhé!'))
        : '';

      studentSheet.getRange(rNum, 18).setValue(nowStr);
      return {
        ok: true,
        locked: false,
        streakWarning: warnedTodayNotDone,
        newlyWarned: false,
        warningCount: st.warningCount,
        maxWarnings: maxWarnings,
        warningReason: repeatWarnMsg,
        fullName: st.fullName,
        classCode: 'CB210',
        streakCount: st.streakCount,
        bestStreak: st.bestStreak,
        lastEssayDate: st.lastEssayDate,
        essaysToday: st.essaysToday,
        totalEssays: st.totalEssays,
        todayDone: st.lastEssayDate === today,
        hasGraceToday: hasGraceToday,
        today: today,
        config: cfg
      };
    }

    // =========================================================================
    // 2. RECORD ESSAY (Ghi nhận học viên CB210 nộp bài viết hoàn chỉnh)
    // =========================================================================
    if (action === 'recordEssay') {
      const name = String(params.name || '').trim();
      const classCode = String(params.classCode || 'CB210').trim().toUpperCase();
      const level = String(params.level || 'B1').trim().toUpperCase();
      const topicTitle = String(params.topic || 'VSTEP Task 2').trim().slice(0, 140);
      const wordCount = parseInt(params.wordCount, 10) || 0;
      const score = String(params.score || '').trim();

      if (!name || classCode !== 'CB210') {
        return { ok: true, skipped: true };
      }

      const qualified = wordCount >= cfg.MinWords;

      // Luôn ghi log vào NhatKyNopBai để cô đối chiếu
      logSheet.appendRow([
        nowStr,
        today,
        name,
        'CB210',
        level,
        topicTitle,
        wordCount,
        score,
        qualified ? 'YES' : 'NO'
      ]);

      const key = makeStudentKey(name, 'CB210');
      let found = findStudentRow(studentSheet, key, today);
      if (!found) {
        studentSheet.appendRow([
          key, name, 'CB210',
          0, 0, '', 0, 0, 0,
          'ACTIVE', '', '', 'NO', '', '', '', '', nowStr, 0, ''
        ]);
        found = findStudentRow(studentSheet, key, today);
      }

      const st = found.student;
      const rNum = found.rowNumber;

      if (!qualified) {
        return {
          ok: true,
          qualified: false,
          wordCount: wordCount,
          minWords: cfg.MinWords,
          todayDone: st.lastEssayDate === today,
          essaysToday: st.essaysToday,
          streakCount: st.streakCount,
          bestStreak: st.bestStreak,
          totalEssays: st.totalEssays
        };
      }

      const essayInfo = '[' + level + '] ' + topicTitle + ' (' + wordCount + ' từ' + (score ? ' - ' + score + 'đ' : '') + ')';

      // Đã nộp ít nhất 1 bài đạt chuẩn hôm nay rồi -> tăng EssaysToday & TotalEssays
      if (st.lastEssayDate === today) {
        const newEssaysToday = st.essaysToday + 1;
        const newTotalEssays = st.totalEssays + 1;
        studentSheet.getRange(rNum, 7).setValue(newEssaysToday);
        studentSheet.getRange(rNum, 8).setValue(newTotalEssays);
        studentSheet.getRange(rNum, 10).setValue('ACTIVE');
        studentSheet.getRange(rNum, 11).setValue('');
        studentSheet.getRange(rNum, 13).setValue('NO');
        studentSheet.getRange(rNum, 16).setValue('');
        studentSheet.getRange(rNum, 17).setValue(essayInfo);
        studentSheet.getRange(rNum, 18).setValue(nowStr);
        return {
          ok: true,
          qualified: true,
          todayDone: true,
          essaysToday: newEssaysToday,
          totalEssays: newTotalEssays,
          streakCount: st.streakCount,
          bestStreak: st.bestStreak,
          lastEssayDate: today
        };
      }

      // Bài đạt chuẩn ĐẦU TIÊN của hôm nay -> tăng chuỗi & tổng số ngày!
      const allowSunday = (cfg.StreakMode === 'ALLOW_SUNDAY_OFF');
      const gap = st.lastEssayDate ? diffDaysYMD(st.lastEssayDate, today) : 999;
      const sundayBypass = st.lastEssayDate && allowSunday && isOnlySundaysBetween(st.lastEssayDate, today);
      const hasGraceToday = Boolean(st.graceUntilDate && st.graceUntilDate >= today);

      let nextStreak = 1;
      if (st.lastEssayDate && (gap === 1 || sundayBypass || hasGraceToday)) {
        nextStreak = Math.max(1, st.streakCount + 1);
      } else if (!st.lastEssayDate && hasGraceToday && st.streakCount > 0) {
        nextStreak = st.streakCount + 1;
      }
      const nextBest = Math.max(st.bestStreak, nextStreak);
      const nextTotalEssays = st.totalEssays + 1;
      const nextTotalDays = st.totalDays + 1;

      studentSheet.getRange(rNum, 4).setValue(nextStreak);
      studentSheet.getRange(rNum, 5).setValue(nextBest);
      studentSheet.getRange(rNum, 6).setNumberFormat('@').setValue(today);
      studentSheet.getRange(rNum, 7).setValue(1);
      studentSheet.getRange(rNum, 8).setValue(nextTotalEssays);
      studentSheet.getRange(rNum, 9).setValue(nextTotalDays);
      studentSheet.getRange(rNum, 10).setValue('ACTIVE');
      studentSheet.getRange(rNum, 11).setValue('');
      studentSheet.getRange(rNum, 13).setValue('NO');
      studentSheet.getRange(rNum, 14).setValue('');
      studentSheet.getRange(rNum, 16).setValue('');
      studentSheet.getRange(rNum, 17).setValue(essayInfo);
      studentSheet.getRange(rNum, 18).setValue(nowStr);

      return {
        ok: true,
        qualified: true,
        firstToday: true,
        todayDone: true,
        essaysToday: 1,
        totalEssays: nextTotalEssays,
        totalDays: nextTotalDays,
        streakCount: nextStreak,
        bestStreak: nextBest,
        lastEssayDate: today
      };
    }

    // =========================================================================
    // 3. REQUEST UNLOCK (Học viên CB210 gửi lời nhắn xin cô mở khóa)
    // =========================================================================
    if (action === 'requestUnlock') {
      const name = String(params.name || '').trim();
      const note = String(params.note || '').trim().slice(0, 300);
      if (!name) return { ok: false, error: 'Missing name' };

      const key = makeStudentKey(name, 'CB210');
      const found = findStudentRow(studentSheet, key, today);
      if (!found) return { ok: false, error: 'Không tìm thấy học viên CB210' };

      const rNum = found.rowNumber;
      studentSheet.getRange(rNum, 13).setValue('YES');
      studentSheet.getRange(rNum, 14).setValue(note || '(Học viên đã gửi yêu cầu xin mở khóa)');
      studentSheet.getRange(rNum, 18).setValue(nowStr);

      return { ok: true, unlockRequested: true };
    }

    // =========================================================================
    // CÁC HÀNH ĐỘNG DÀNH RIÊNG CHO GIÁO VIÊN (CẦN ADMIN KEY)
    // =========================================================================
    const adminKey = String(params.adminKey || '').trim();
    if (adminKey !== TEACHER_ADMIN_KEY) {
      return { ok: false, error: 'Unauthorized: Invalid teacher adminKey' };
    }

    // 4. LIST STUDENTS (Toàn bộ 15 học viên CB210)
    if (action === 'listStudents') {
      const data = studentSheet.getDataRange().getValues();
      const students = [];
      const maxWarnCfg = (typeof cfg.MaxWarningsBeforeLock === 'number') ? cfg.MaxWarningsBeforeLock : 2;
      for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        const st = rowToStudentObj(data[i], i + 1, today);
        const evalRes = evaluateMissedWriting(st, cfg, today);
        st.todayDone = (st.lastEssayDate === today);
        st.hasGraceToday = Boolean(st.graceUntilDate && st.graceUntilDate >= today);
        st.daysMissed = evalRes.daysMissed;
        st.maxWarnings = maxWarnCfg;
        st.willWarnOnNextLogin = (st.status !== 'LOCKED') && evalRes.shouldLock && (st.warningCount < maxWarnCfg);
        st.willBeLockedOnNextLogin = (st.status !== 'LOCKED') && evalRes.shouldLock && (st.warningCount >= maxWarnCfg);
        st.effectiveLocked = (st.status === 'LOCKED' && !st.hasGraceToday) || st.willBeLockedOnNextLogin;
        students.push(st);
      }

      // Sắp xếp ưu tiên: Xin mở khóa -> Đang bị khóa -> Sắp bị khóa -> Chưa nộp hôm nay -> Đã xong hôm nay
      students.sort((a, b) => {
        const score = (s) => {
          if (s.status === 'LOCKED' && s.unlockRequested) return 0;
          if (s.status === 'LOCKED' && !s.hasGraceToday) return 1;
          if (s.willBeLockedOnNextLogin) return 2;
          if (!s.todayDone) return 3;
          return 4;
        };
        const diff = score(a) - score(b);
        if (diff !== 0) return diff;
        return a.fullName.localeCompare(b.fullName, 'vi');
      });

      return { ok: true, today: today, config: cfg, students: students };
    }

    // 5. UNLOCK STUDENT (Mở khóa & cấp ân hạn cả ngày hôm nay để vào viết bài)
    if (action === 'unlockStudent') {
      const studentKey = String(params.studentKey || '').trim();
      const keepStreak = String(params.keepStreak || 'false').toLowerCase() === 'true';
      const found = findStudentRow(studentSheet, studentKey, today);
      if (!found) return { ok: false, error: 'Không tìm thấy học viên' };

      const rNum = found.rowNumber;
      if (!keepStreak) {
        studentSheet.getRange(rNum, 4).setValue(0);
      }
      studentSheet.getRange(rNum, 10).setValue('ACTIVE');
      studentSheet.getRange(rNum, 11).setValue('');
      studentSheet.getRange(rNum, 13).setValue('NO');
      studentSheet.getRange(rNum, 14).setValue('');
      studentSheet.getRange(rNum, 15).setValue(nowStr);
      studentSheet.getRange(rNum, 16).setNumberFormat('@').setValue(today); // Ân hạn hôm nay để vào viết bài
      studentSheet.getRange(rNum, 18).setValue(nowStr);
      studentSheet.getRange(rNum, 19).setValue(0);   // Reset lượt nhắc nhở về 0 sau khi cô mở khóa
      studentSheet.getRange(rNum, 20).setValue('');

      return { ok: true, unlocked: studentKey, keepStreak: keepStreak, graceUntilDate: today };
    }

    // 6. EXCUSE TODAY (Miễn/tính hoàn thành hôm nay cho học viên xin phép nghỉ ốm)
    if (action === 'excuseToday') {
      const studentKey = String(params.studentKey || '').trim();
      const note = String(params.note || 'Giáo viên cho phép nghỉ / miễn chỉ tiêu hôm nay').trim();
      const found = findStudentRow(studentSheet, studentKey, today);
      if (!found) return { ok: false, error: 'Không tìm thấy học viên' };

      const rNum = found.rowNumber;
      const st = found.student;
      const nextStreak = Math.max(1, st.streakCount);
      studentSheet.getRange(rNum, 4).setValue(nextStreak);
      studentSheet.getRange(rNum, 5).setValue(Math.max(st.bestStreak, nextStreak));
      studentSheet.getRange(rNum, 6).setNumberFormat('@').setValue(today);
      studentSheet.getRange(rNum, 7).setValue(Math.max(1, st.essaysToday));
      studentSheet.getRange(rNum, 10).setValue('ACTIVE');
      studentSheet.getRange(rNum, 11).setValue('');
      studentSheet.getRange(rNum, 13).setValue('NO');
      studentSheet.getRange(rNum, 14).setValue('');
      studentSheet.getRange(rNum, 15).setValue(nowStr);
      studentSheet.getRange(rNum, 16).setNumberFormat('@').setValue(today);
      studentSheet.getRange(rNum, 17).setValue('[MIỄN HÔM NAY] ' + note);
      studentSheet.getRange(rNum, 18).setValue(nowStr);

      return { ok: true, excused: studentKey, date: today };
    }

    // 7. LOCK STUDENT (Khóa thủ công)
    if (action === 'lockStudent') {
      const studentKey = String(params.studentKey || '').trim();
      const reason = String(params.reason || 'Khóa thủ công bởi Miss Nguyệt').trim();
      const found = findStudentRow(studentSheet, studentKey, today);
      if (!found) return { ok: false, error: 'Không tìm thấy học viên' };

      const rNum = found.rowNumber;
      studentSheet.getRange(rNum, 10).setValue('LOCKED');
      studentSheet.getRange(rNum, 11).setValue(reason);
      studentSheet.getRange(rNum, 12).setValue(nowStr);
      studentSheet.getRange(rNum, 16).setValue('');
      studentSheet.getRange(rNum, 18).setValue(nowStr);

      return { ok: true, locked: studentKey };
    }

    // 8. RESET WARNINGS (Xóa lượt nhắc nhở bỏ chuỗi về 0)
    if (action === 'resetWarnings') {
      const studentKey = String(params.studentKey || '').trim();
      const found = findStudentRow(studentSheet, studentKey, today);
      if (!found) return { ok: false, error: 'Không tìm thấy học viên' };
      const rNum = found.rowNumber;
      studentSheet.getRange(rNum, 19).setValue(0);
      studentSheet.getRange(rNum, 20).setValue('');
      studentSheet.getRange(rNum, 18).setValue(nowStr);
      return { ok: true, resetWarnings: studentKey };
    }

    // 9. SET CONFIG
    if (action === 'setConfig') {
      const updated = writeConfig(configSheet, {
        SystemEnabled: typeof params.systemEnabled !== 'undefined' ? String(params.systemEnabled).toLowerCase() === 'true' : undefined,
        StartDate: params.startDate,
        StreakMode: params.streakMode,
        MinWords: params.minWords,
        MaxWarningsBeforeLock: params.maxWarningsBeforeLock
      });
      return { ok: true, config: updated };
    }

    return { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// ĐỒNG BỘ LỊCH SỬ HỌC TẬP THEO TÊN HỌC VIÊN (MỌI LỚP - B1 & B2)
// ============================================================================

function ensureHistorySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_STUDENT_HISTORY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_STUDENT_HISTORY);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HISTORY_HEADERS);
    sheet.getRange(1, 1, 1, HISTORY_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#0f766e')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 60);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 200);
    sheet.setColumnWidth(5, 90);
    sheet.setColumnWidth(6, 95);
    sheet.setColumnWidth(7, 95);
    sheet.setColumnWidth(8, 160);
  }
  return sheet;
}

function findHistoryRow(sheet, recordKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0] || '').trim() === recordKey) {
      const rowNum = i + 2;
      const row = sheet.getRange(rowNum, 1, 1, HISTORY_HEADERS.length).getValues()[0];
      return { rowNumber: rowNum, row: row };
    }
  }
  return null;
}

function parseHistoryChunks(row) {
  const raw = String(row[8] || '') + String(row[9] || '') + String(row[10] || '') + String(row[11] || '');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function splitHistoryChunks(payloadObj) {
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

  // 3. Merge Step 1-2-3 prep progress (always keep max seconds & OR booleans)
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

function handleGetStudentHistory(params) {
  const studentName = String(params.studentName || params.name || '').trim();
  const level = String(params.level || 'B1').trim().toUpperCase() === 'B2' ? 'B2' : 'B1';
  if (!studentName) return { ok: false, error: 'Missing studentName' };

  const studentKey = slugifyName(studentName);
  const recordKey = level + '|' + studentKey;
  const sheet = ensureHistorySheet();
  const found = findHistoryRow(sheet, recordKey);
  if (!found) {
    return { ok: true, found: false, recordKey: recordKey, studentKey: studentKey };
  }
  const data = parseHistoryChunks(found.row);
  return {
    ok: true,
    found: Boolean(data),
    recordKey: recordKey,
    studentKey: studentKey,
    fullName: String(found.row[3] || studentName),
    classCode: String(found.row[4] || ''),
    essaysCount: Number(found.row[5] || 0),
    prepCount: Number(found.row[6] || 0),
    updatedAt: String(found.row[7] || ''),
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
  const sheet = ensureHistorySheet();
  const found = findHistoryRow(sheet, recordKey);
  const existing = found ? parseHistoryChunks(found.row) : null;
  const merged = mergeStudentPayloads(existing, incoming);
  const chunks = splitHistoryChunks(merged);
  const essaysCount = Array.isArray(merged.history) ? merged.history.length : 0;
  const prepCount = merged.prep ? Object.keys(merged.prep).length : 0;

  const rowValues = [
    recordKey,
    level,
    studentKey,
    studentName,
    classCode || (found ? String(found.row[4] || '') : ''),
    essaysCount,
    prepCount,
    nowStr,
    chunks[0],
    chunks[1],
    chunks[2],
    chunks[3]
  ];

  if (found) {
    const range = sheet.getRange(found.rowNumber, 1, 1, HISTORY_HEADERS.length);
    sheet.getRange(found.rowNumber, 9, 1, 4).setNumberFormat('@');
    range.setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
    const newRowNum = sheet.getLastRow();
    sheet.getRange(newRowNum, 9, 1, 4).setNumberFormat('@');
    sheet.getRange(newRowNum, 9, 1, 4).setValues([[chunks[0], chunks[1], chunks[2], chunks[3]]]);
  }

  return {
    ok: true,
    saved: true,
    recordKey: recordKey,
    essaysCount: essaysCount,
    prepCount: prepCount,
    updatedAt: nowStr
  };
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
