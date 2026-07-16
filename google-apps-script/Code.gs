function doPost(e) {
  try {
    var body = parseRequestBody_(e);
    requireApiSecret_(body.secret);
    var action = sanitizeText_(body.action, 40);
    var payload = body.payload || {};

    if (action === 'courses') {
      return jsonResponse_({ success: true, courses: getActiveCoursesForApi_() });
    }
    if (action === 'referrer') {
      return jsonResponse_(validateReferrerForApi_(payload.token));
    }
    if (action === 'submit') {
      return jsonResponse_(submitReferral_(payload));
    }
    return jsonResponse_({ success: false, code: 'UNKNOWN_ACTION', message: 'Unknown request action.' });
  } catch (error) {
    return jsonResponse_({
      success: false,
      code: error.code || 'SERVER_ERROR',
      message: error.publicMessage || 'The referral request could not be processed.'
    });
  }
}

function doGet() {
  return jsonResponse_({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SSC.SHEETS.REFERRALS || e.range.getRow() < 2) return;
  logReferralEdit_(sheet, e);
  recalculateReferralRow_(sheet, e.range.getRow());
}

function logReferralEdit_(sheet, e) {
  var headers = getHeaderMap_(sheet);
  var rowNumber = e.range.getRow();
  var col = e.range.getColumn();
  var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  var referralId = row[headers['Referral ID'] - 1];
  var referrerId = row[headers['Referrer ID'] - 1];
  var oldValue = e.oldValue || '';
  var newValue = e.value || '';
  if (col === headers['Final Course Fee'] || col === headers['Amount Received']) {
    logActivity_(SSC.ACTIVITY.FEE_UPDATED, referralId, referrerId, oldValue, newValue, 'Fee field updated.');
  }
  if (col === headers.Status && newValue === 'Admission Confirmed') {
    logActivity_(SSC.ACTIVITY.ADMISSION_CONFIRMED, referralId, referrerId, oldValue, newValue, 'Admission status updated.');
  }
  if (col === headers.Status && newValue === 'Admission Cancelled') {
    logActivity_(SSC.ACTIVITY.ADMISSION_CANCELLED, referralId, referrerId, oldValue, newValue, 'Admission status updated.');
  }
  if (col === headers['Reward Approval Status'] && newValue === 'Approved') {
    logActivity_(SSC.ACTIVITY.REWARD_APPROVED, referralId, referrerId, oldValue, newValue, 'Reward approval updated.');
  }
  if (col === headers['Reward Payment Status'] && newValue === 'Paid') {
    logActivity_(SSC.ACTIVITY.REWARD_PAID, referralId, referrerId, oldValue, newValue, 'Reward payment status updated.');
  }
  if (col === headers['Cancellation Adjustment'] && newValue) {
    logActivity_(SSC.ACTIVITY.REWARD_ADJUSTED, referralId, referrerId, oldValue, newValue, 'Cancellation adjustment recorded.');
  }
}

function getActiveCoursesForApi_() {
  return readObjects_(getSheet_(SSC.SHEETS.COURSES))
    .filter(function (row) {
      return row.Active === 'Yes';
    })
    .sort(function (a, b) {
      return Number(a['Display Order'] || 0) - Number(b['Display Order'] || 0);
    })
    .map(function (row) {
      return {
        id: String(row['Course ID']),
        name: String(row['Course Name'])
      };
    });
}

function validateReferrerForApi_(token) {
  var referrer = findActiveReferrerByToken_(sanitizeToken_(token));
  if (!referrer) {
    return { valid: false };
  }
  return {
    valid: true,
    referrerName: buildPublicReferrerName_(referrer.row['Full Name'])
  };
}

function buildPublicReferrerName_(fullName) {
  var cleaned = sanitizeText_(fullName, 100);
  if (!cleaned) return 'A friend';

  var parts = cleaned.split(/\s+/).filter(function (part) {
    return !!part;
  });

  if (!parts.length) return 'A friend';

  var firstName = parts[0].slice(0, 40);
  if (parts.length === 1) {
    return firstName.slice(0, 60);
  }

  var lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return (firstName + ' ' + lastInitial + '.').slice(0, 60);
}

function submitReferral_(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = new Date();
    var token = sanitizeToken_(payload.token);
    var referrer = findReferrerByToken_(token);
    if (!referrer) {
      return rejectedResponse_('INVALID_REFERRAL_LINK', 'This referral link is not valid.');
    }
    if (referrer.row.Active !== 'Yes') {
      return rejectedResponse_('INACTIVE_REFERRER', 'This referral link is not active.');
    }

    var name = sanitizeText_(payload.name, 100);
    if (!name) {
      return rejectedResponse_('MISSING_NAME', 'Please enter the prospective student name.');
    }

    var normalisedMobile = normaliseMobile_(payload.mobile);
    if (!normalisedMobile) {
      return rejectedResponse_('INVALID_MOBILE_NUMBER', 'Please enter a valid 10-digit Indian mobile number.');
    }

    var courseId = sanitizeCourseId_(payload.courseId);
    var course = findActiveCourseById_(courseId);
    if (!course) {
      return rejectedResponse_('INACTIVE_COURSE', 'Please select a valid active course.');
    }

    if (payload.consent !== true) {
      return rejectedResponse_('CONSENT_REQUIRED', 'Contact consent is required.');
    }

    var source = sanitizeReferralSource_(payload.source);
    var existing = findExistingContactByMobile_(normalisedMobile);
    if (existing) {
      var recordType = existing.row['Record Type'];
      var code = recordTypeToErrorCode_(recordType);
      logRejection_(now, code, referrer.row['Referrer ID'], normalisedMobile, 'ExistingContacts match.');
      return rejectedResponse_(code, recordType + ' already exists in Samyak records.');
    }

    var duplicate = findActiveReferralByMobile_(normalisedMobile, now);
    if (duplicate) {
      logActivity_(SSC.ACTIVITY.DUPLICATE, '', referrer.row['Referrer ID'], '', normalisedMobile, 'Active referral already exists for this mobile number.');
      return rejectedResponse_('DUPLICATE_REFERRAL', 'This contact has already been registered through an active referral.');
    }

    var referralId = nextReferralId_();
    var settings = getSettings_();
    var validityDays = Number(settings.REFERRAL_VALIDITY_DAYS || 90);
    var validUntil = addDays_(now, validityDays);
    var email = sanitizeEmail_(payload.email);
    var minPaymentPercent = Number(settings.MINIMUM_FEE_PERCENT || 50);
    var standardFee = positiveNumber_(course.row['Standard Fee']) || '';
    var rewards = calculateRewards_(standardFee, course.row);
    var minimumPayment = standardFee ? standardFee * (minPaymentPercent / 100) : '';
    var row = buildReferralRow_({
      referralId: referralId,
      now: now,
      token: token,
      referrerId: referrer.row['Referrer ID'],
      name: name,
      mobile: sanitizeText_(payload.mobile, 40),
      normalisedMobile: normalisedMobile,
      email: email,
      courseName: course.row['Course Name'],
      source: source,
      validUntil: validUntil,
      standardFee: standardFee,
      minimumPayment: minimumPayment,
      cashReward: rewards.cash,
      courseCredit: rewards.credit,
      referrer: referrer.row
    });

    var sheet = getSheet_(SSC.SHEETS.REFERRALS);
    sheet.appendRow(row);
    logActivity_(SSC.ACTIVITY.SUBMITTED, referralId, referrer.row['Referrer ID'], '', 'Referral Accepted', 'Referral submitted through ' + source + '.');
    refreshReferrerStatistics();
    return {
      success: true,
      referralId: referralId,
      validUntil: formatDateForApi_(validUntil)
    };
  } finally {
    lock.releaseLock();
  }
}

function buildReferralRow_(data) {
  var links = buildReferralWhatsAppLinks_(data.referrer, data.referralId, data.validUntil, data.cashReward, data.courseCredit, '');
  return [
    data.referralId,
    data.now,
    data.token,
    data.referrerId,
    escapeFormula_(data.name),
    escapeFormula_(data.mobile),
    data.normalisedMobile,
    escapeFormula_(data.email),
    data.courseName,
    'Yes',
    data.source,
    'Referral Accepted',
    data.validUntil,
    'Accepted',
    '',
    '',
    data.standardFee,
    '',
    data.minimumPayment,
    '',
    '',
    data.cashReward,
    data.courseCredit,
    '',
    '',
    'Pending',
    '',
    'Pending',
    '',
    '',
    '',
    links.registration,
    links.admission,
    links.approval,
    links.paid,
    '',
    data.now
  ];
}

function recalculateReferralRow_(sheet, rowNumber) {
  var headers = getHeaderMap_(sheet);
  var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  var now = new Date();
  var finalFee = positiveNumber_(row[headers['Final Course Fee'] - 1]);
  var amountReceived = positiveNumber_(row[headers['Amount Received'] - 1]);
  var status = row[headers.Status - 1];
  var oldStatus = status;
  var settings = getSettings_();
  var minPercent = Number(settings.MINIMUM_FEE_PERCENT || 50);

  if (finalFee) {
    row[headers['Minimum Qualifying Payment'] - 1] = finalFee * (minPercent / 100);
    var course = findCourseByName_(row[headers['Course Interested'] - 1]);
    var rewards = calculateRewards_(finalFee, course ? course.row : {});
    row[headers['Cash Reward'] - 1] = rewards.cash;
    row[headers['Course Credit'] - 1] = rewards.credit;
  }

  var minimumPayment = positiveNumber_(row[headers['Minimum Qualifying Payment'] - 1]);
  if (finalFee && amountReceived && amountReceived >= minimumPayment && ['Referral Accepted', 'Counselling in Progress', 'Admission Confirmed', 'Awaiting Minimum Fee'].indexOf(status) !== -1) {
    row[headers.Status - 1] = 'Reward Eligible';
    if (!row[headers['Reward Eligibility Date'] - 1]) row[headers['Reward Eligibility Date'] - 1] = now;
    logActivity_(SSC.ACTIVITY.REWARD_ELIGIBLE, row[headers['Referral ID'] - 1], row[headers['Referrer ID'] - 1], oldStatus, 'Reward Eligible', 'Minimum qualifying payment received.');
  } else if (finalFee && status === 'Admission Confirmed') {
    row[headers.Status - 1] = 'Awaiting Minimum Fee';
  }

  var choice = row[headers['Reward Choice'] - 1];
  if (choice === 'Cash') {
    row[headers['Approved Reward Amount'] - 1] = row[headers['Cash Reward'] - 1];
  } else if (choice === 'Course Credit') {
    row[headers['Approved Reward Amount'] - 1] = row[headers['Course Credit'] - 1];
  }

  if (row[headers['Reward Approval Status'] - 1] === 'Approved') {
    if (!row[headers['Reward Approval Date'] - 1]) row[headers['Reward Approval Date'] - 1] = now;
    if (row[headers.Status - 1] !== 'Reward Paid') row[headers.Status - 1] = 'Reward Approved';
  }

  if (row[headers['Reward Payment Status'] - 1] === 'Paid') {
    if (!row[headers['Reward Payment Date'] - 1]) row[headers['Reward Payment Date'] - 1] = now;
    row[headers.Status - 1] = 'Reward Paid';
  }

  if (row[headers.Status - 1] === 'Admission Cancelled') {
    if (row[headers['Reward Payment Status'] - 1] === 'Paid') {
      row[headers['Cancellation Adjustment'] - 1] = row[headers['Cancellation Adjustment'] - 1] || 'Recovery or adjustment required';
      logActivity_(SSC.ACTIVITY.REWARD_ADJUSTED, row[headers['Referral ID'] - 1], row[headers['Referrer ID'] - 1], '', '', 'Admission cancelled after reward payment.');
    } else {
      row[headers['Reward Payment Status'] - 1] = 'Cancelled';
      row[headers['Reward Approval Status'] - 1] = 'Adjusted';
      logActivity_(SSC.ACTIVITY.ADMISSION_CANCELLED, row[headers['Referral ID'] - 1], row[headers['Referrer ID'] - 1], oldStatus, 'Admission Cancelled', 'Unpaid reward cancelled.');
    }
  }

  row[headers['Last Updated'] - 1] = now;
  refreshWhatsAppLinksForReferralRow_(row, headers);
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function refreshWhatsAppLinksForReferralRow_(row, headers) {
  var referrer = findReferrerById_(row[headers['Referrer ID'] - 1]);
  if (!referrer) return;
  var links = buildReferralWhatsAppLinks_(
    referrer.row,
    row[headers['Referral ID'] - 1],
    row[headers['Valid Until'] - 1],
    row[headers['Cash Reward'] - 1],
    row[headers['Course Credit'] - 1],
    row[headers['Approved Reward Amount'] - 1]
  );
  row[headers['Registration WhatsApp Link'] - 1] = links.registration;
  row[headers['Admission WhatsApp Link'] - 1] = links.admission;
  row[headers['Reward Approval WhatsApp Link'] - 1] = links.approval;
  row[headers['Reward Paid WhatsApp Link'] - 1] = links.paid;
}

function normaliseMobile_(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
  if (digits.length === 11 && digits.charAt(0) === '0') digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return '';
  return digits;
}

function calculateRewards_(fee, courseRow) {
  var overrideCash = positiveNumber_(courseRow && courseRow['Cash Reward']);
  var overrideCredit = positiveNumber_(courseRow && courseRow['Course Credit']);
  if (overrideCash && overrideCredit) {
    return { cash: overrideCash, credit: overrideCredit };
  }
  var finalFee = positiveNumber_(fee);
  if (!finalFee || finalFee < 10000) return { cash: 500, credit: 750 };
  if (finalFee <= 19999) return { cash: 750, credit: 1000 };
  if (finalFee <= 29999) return { cash: 1000, credit: 1500 };
  return { cash: 1500, credit: 2000 };
}

function nextReferralId_() {
  var year = Utilities.formatDate(new Date(), getWorkbook_().getSpreadsheetTimeZone(), 'yyyy');
  var rows = readObjects_(getSheet_(SSC.SHEETS.REFERRALS));
  var max = 0;
  rows.forEach(function (row) {
    var id = String(row['Referral ID'] || '');
    var match = id.match(/^SSC-\d{4}-(\d{6})$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return 'SSC-' + year + '-' + String(max + 1).padStart(6, '0');
}

function generateUniqueReferralToken_(existing) {
  existing = existing || getExistingTokenSet_();
  var token = '';
  do {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  } while (existing[token]);
  existing[token] = true;
  return token;
}

function getExistingTokenSet_() {
  var set = {};
  readObjects_(getSheet_(SSC.SHEETS.REFERRERS)).forEach(function (row) {
    if (row['Referral Token']) set[row['Referral Token']] = true;
  });
  return set;
}

function findReferrerByToken_(token) {
  if (!token) return null;
  return findObject_(SSC.SHEETS.REFERRERS, function (row) {
    return row['Referral Token'] === token;
  });
}

function findActiveReferrerByToken_(token) {
  if (!token) return null;
  return findObject_(SSC.SHEETS.REFERRERS, function (row) {
    return row['Referral Token'] === token && row.Active === 'Yes';
  });
}

function findReferrerById_(referrerId) {
  if (!referrerId) return null;
  return findObject_(SSC.SHEETS.REFERRERS, function (row) {
    return row['Referrer ID'] === referrerId;
  });
}

function findActiveCourseById_(courseId) {
  return findObject_(SSC.SHEETS.COURSES, function (row) {
    return row['Course ID'] === courseId && row.Active === 'Yes';
  });
}

function findCourseByName_(courseName) {
  return findObject_(SSC.SHEETS.COURSES, function (row) {
    return row['Course Name'] === courseName;
  });
}

function findExistingContactByMobile_(mobile) {
  var targetMobile = normaliseMobile_(mobile);

  return findObject_(SSC.SHEETS.EXISTING_CONTACTS, function (row) {
    var storedMobile = normaliseMobile_(
      row['Normalised Mobile'] || row['Mobile Number']
    );

    return storedMobile === targetMobile && row.Active !== 'No';
  });
}

function findActiveReferralByMobile_(mobile, now) {
  var targetMobile = normaliseMobile_(mobile);

  return findObject_(SSC.SHEETS.REFERRALS, function (row) {
    var status = row.Status;
    var validUntil = row['Valid Until'];
    var storedMobile = normaliseMobile_(
      row['Normalised Mobile'] || row['Mobile Number']
    );

    return storedMobile === targetMobile &&
      [
        'Referral Accepted',
        'Counselling in Progress',
        'Admission Confirmed',
        'Awaiting Minimum Fee',
        'Reward Eligible',
        'Reward Approved',
        'Reward Paid'
      ].indexOf(status) !== -1 &&
      validUntil instanceof Date &&
      validUntil >= now;
  });
}

function findObject_(sheetName, predicate) {
  var sheet = getSheet_(sheetName);
  var rows = readObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) return { row: rows[i], rowNumber: i + 2 };
  }
  return null;
}

function readObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (header, index) {
      obj[header] = row[index];
    });
    return obj;
  }).filter(function (row) {
    return Object.keys(row).some(function (key) { return row[key] !== ''; });
  });
}

function getHeaderMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (header, index) {
    map[header] = index + 1;
  });
  return map;
}

function getSheet_(sheetName) {
  var sheet = getWorkbook_().getSheetByName(sheetName);
  if (!sheet) throw publicError_('CONFIGURATION_ERROR', 'Workbook is not set up.');
  return sheet;
}

function getWorkbook_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  throw publicError_('CONFIGURATION_ERROR', 'Referral workbook is not configured.');
}

function getSettings_() {
  var settings = {};
  readObjects_(getSheet_(SSC.SHEETS.SETTINGS)).forEach(function (row) {
    settings[row.Setting] = row.Value;
  });
  return settings;
}

function buildPersonalLink_(token, settings) {
  var base = (settings && settings.PERSONAL_LINK_BASE) || SSC.PERSONAL_LINK_BASE_DEFAULT;
  return base + token;
}

function buildReferrerShareLink_(personalLink) {
  var message = 'Hi, I am sharing my Samyak Skill Circle referral link. Please use this link to enquire at Samyak Computer Classes: ' + personalLink;
  return 'https://wa.me/?text=' + encodeURIComponent(message);
}

function buildReferralWhatsAppLinks_(referrer, referralId, validUntil, cashReward, courseCredit, approvedRewardAmount) {
  var phone = referrer['Normalised Mobile'];
  var validUntilText = validUntil instanceof Date ? formatDateForApi_(validUntil) : String(validUntil || '');
  var paidAmount = approvedRewardAmount || '[Approved Reward Amount]';
  return {
    registration: buildWhatsAppLink_(phone, 'Hi ' + referrer['Full Name'] + ', your referral has been successfully registered under Referral ID ' + referralId + '. It will remain valid until ' + validUntilText + '. We will update you if the referral results in an admission.'),
    admission: buildWhatsAppLink_(phone, 'Good news! Your referral ' + referralId + ' has taken admission at Samyak Computer Classes. The reward will become eligible after the required course fee is received.'),
    approval: buildWhatsAppLink_(phone, 'Congratulations! Your referral reward has been approved. Please choose between \u20b9' + cashReward + ' cash or \u20b9' + courseCredit + ' Samyak Course Credit.'),
    paid: buildWhatsAppLink_(phone, 'Your referral reward of \u20b9' + paidAmount + ' has been processed. Thank you for being part of Samyak Skill Circle - Learn, Refer and Grow.')
  };
}

function buildWhatsAppLink_(normalisedMobile, message) {
  if (!normalisedMobile) return '';
  return 'https://wa.me/91' + normalisedMobile + '?text=' + encodeURIComponent(message);
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw publicError_('INVALID_REQUEST', 'Missing request body.');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw publicError_('INVALID_JSON', 'Invalid JSON request body.');
  }
}

function requireApiSecret_(providedSecret) {
  var expected = PropertiesService.getScriptProperties().getProperty('REFERRAL_API_SECRET');
  if (!expected || !providedSecret || providedSecret !== expected) {
    throw publicError_('UNAUTHORISED', 'Unauthorised request.');
  }
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function rejectedResponse_(code, message) {
  return { success: false, code: code, message: message };
}

function publicError_(code, message) {
  var error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  return error;
}

function logRejection_(date, code, referrerId, mobile, notes) {
  logActivity_(SSC.ACTIVITY.REJECTED, '', referrerId, '', code, notes + ' Mobile ending ' + String(mobile).slice(-4));
}

function logActivity_(action, referralId, referrerId, oldValue, newValue, notes) {
  var sheet = getSheet_(SSC.SHEETS.ACTIVITY_LOG);
  sheet.appendRow([
    new Date(),
    action,
    referralId || '',
    referrerId || '',
    Session.getActiveUser().getEmail() || 'System',
    oldValue || '',
    newValue || '',
    notes || ''
  ]);
}

function formatDateForApi_(date) {
  return Utilities.formatDate(date, getWorkbook_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

function addDays_(date, days) {
  var copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}

function sanitizeText_(value, maxLength) {
  var text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function sanitizeToken_(value) {
  var token = sanitizeText_(value, 80);
  return /^[A-Za-z0-9_-]{12,80}$/.test(token) ? token : '';
}

function sanitizeCourseId_(value) {
  var courseId = sanitizeText_(value, 80);
  return /^[A-Z0-9_-]{2,80}$/.test(courseId) ? courseId : '';
}

function sanitizeReferralSource_(value) {
  var source = sanitizeText_(value, 20);
  return SSC.REFERRAL_SOURCES.indexOf(source) !== -1 ? source : 'Online';
}

function sanitizeEmail_(value) {
  var email = sanitizeText_(value, 150);
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function escapeFormula_(value) {
  var text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function positiveNumber_(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? n : 0;
}

function courseIdFromName_(name) {
  return String(name).toUpperCase().replace(/&/g, 'AND').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function recordTypeToErrorCode_(recordType) {
  if (recordType === 'Existing Enquiry') return 'EXISTING_ENQUIRY';
  if (recordType === 'Current Student') return 'CURRENT_STUDENT';
  if (recordType === 'Former Student') return 'FORMER_STUDENT';
  return 'EXISTING_CONTACT';
}

function assert_(condition, message) {
  if (!condition) throw new Error('Test failed: ' + message);
}

function runReferralSystemTests() {
  setupWorkbook();
  testWorkbookConfiguration();
  testMobileNormalisation();
  testInvalidMobileNumber();
  testExistingEnquiryRejection();
  testCurrentStudentRejection();
  testFormerStudentRejection();
  testFirstReferralAcceptance();
  testActiveDuplicateRejection();
  testExpiredReferralAcceptance();
  testInvalidTokenRejection();
  testInactiveReferrerRejection();
  testRewardSlabCalculation();
  testMinimumQualifyingPaymentCalculation();
  SpreadsheetApp.getActive().toast('Referral system tests completed.');
}

function testWorkbookConfiguration() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  assert_(!!spreadsheetId, 'SPREADSHEET_ID exists after setupWorkbook');
  var workbook = getWorkbook_();
  assert_(workbook.getId() === spreadsheetId, 'getWorkbook opens the configured spreadsheet');
  Object.keys(SSC.HEADERS).forEach(function (sheetName) {
    assert_(!!workbook.getSheetByName(sheetName), 'sheet is accessible through getWorkbook: ' + sheetName);
  });
}

function testMobileNormalisation() {
  assert_(normaliseMobile_('9876543210') === '9876543210', 'plain mobile');
  assert_(normaliseMobile_('+91 98765 43210') === '9876543210', '+91 mobile');
  assert_(normaliseMobile_('91-9876543210') === '9876543210', '91 mobile');
  assert_(normaliseMobile_('09876543210') === '9876543210', 'leading zero mobile');
}

function testInvalidMobileNumber() {
  assert_(normaliseMobile_('1234567890') === '', 'invalid starting digit rejected');
}

function testExistingEnquiryRejection() {
  withTestData_(function (context) {
    addExistingContactForTest_('Existing Enquiry', '9876543210');
    var result = submitReferral_(testPayload_(context.token, '9876543210'));
    assert_(result.code === 'EXISTING_ENQUIRY', 'existing enquiry rejected');
  });
}

function testCurrentStudentRejection() {
  withTestData_(function (context) {
    addExistingContactForTest_('Current Student', '9876543211');
    var result = submitReferral_(testPayload_(context.token, '9876543211'));
    assert_(result.code === 'CURRENT_STUDENT', 'current student rejected');
  });
}

function testFormerStudentRejection() {
  withTestData_(function (context) {
    addExistingContactForTest_('Former Student', '9876543212');
    var result = submitReferral_(testPayload_(context.token, '9876543212'));
    assert_(result.code === 'FORMER_STUDENT', 'former student rejected');
  });
}

function testFirstReferralAcceptance() {
  withTestData_(function (context) {
    var result = submitReferral_(testPayload_(context.token, '9876543213'));
    assert_(result.success === true, 'first referral accepted');
  });
}

function testActiveDuplicateRejection() {
  withTestData_(function (context) {
    assert_(submitReferral_(testPayload_(context.token, '9876543214')).success === true, 'first duplicate seed accepted');
    var result = submitReferral_(testPayload_(context.token, '9876543214'));
    assert_(result.code === 'DUPLICATE_REFERRAL', 'active duplicate rejected');
  });
}

function testExpiredReferralAcceptance() {
  withTestData_(function (context) {
    var first = submitReferral_(testPayload_(context.token, '9876543215'));
    assert_(first.success === true, 'first referral accepted before expiry test');
    var sheet = getSheet_(SSC.SHEETS.REFERRALS);
    var headers = getHeaderMap_(sheet);
    var found = findObject_(SSC.SHEETS.REFERRALS, function (row) { return row['Referral ID'] === first.referralId; });
    sheet.getRange(found.rowNumber, headers.Status).setValue('Referral Expired');
    sheet.getRange(found.rowNumber, headers['Valid Until']).setValue(addDays_(new Date(), -1));
    var second = submitReferral_(testPayload_(context.token, '9876543215'));
    assert_(second.success === true, 'expired referral allows new valid referral');
  });
}

function testInvalidTokenRejection() {
  withTestData_(function () {
    var result = submitReferral_(testPayload_('invalidtokenxx', '9876543216'));
    assert_(result.code === 'INVALID_REFERRAL_LINK', 'invalid token rejected');
  });
}

function testInactiveReferrerRejection() {
  withTestData_(function (context) {
    var sheet = getSheet_(SSC.SHEETS.REFERRERS);
    var headers = getHeaderMap_(sheet);
    sheet.getRange(context.referrerRow, headers.Active).setValue('No');
    var result = submitReferral_(testPayload_(context.token, '9876543217'));
    assert_(result.code === 'INACTIVE_REFERRER', 'inactive referrer rejected');
  });
}

function testRewardSlabCalculation() {
  assert_(calculateRewards_(9999, {}).cash === 500, 'below 10000 cash');
  assert_(calculateRewards_(15000, {}).credit === 1000, '10000-19999 credit');
  assert_(calculateRewards_(25000, {}).cash === 1000, '20000-29999 cash');
  assert_(calculateRewards_(30000, {}).credit === 2000, '30000 plus credit');
}

function testMinimumQualifyingPaymentCalculation() {
  assert_(40000 * (Number(getSettings_().MINIMUM_FEE_PERCENT || 50) / 100) === 20000, 'minimum qualifying payment');
}

function withTestData_(callback) {
  setupWorkbook();
  var token = 'TEST' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var refSheet = getSheet_(SSC.SHEETS.REFERRERS);
  var referrerRow = refSheet.getLastRow() + 1;
  refSheet.appendRow(['TEST-REF-' + token, 'Test Referrer', '9876543200', '9876543200', 'Student', 'Test Course', token, buildPersonalLink_(token, getSettings_()), '', new Date(), 'Yes', 0, 0, 0, 0, 'Temporary test row']);
  try {
    callback({ token: token, referrerRow: referrerRow });
  } finally {
    cleanupTestRows_();
  }
}

function testPayload_(token, mobile) {
  return {
    token: token,
    name: 'Test Prospect',
    mobile: mobile,
    email: 'test@example.com',
    courseId: 'WEB_DEVELOPMENT',
    consent: true,
    source: 'Online'
  };
}

function addExistingContactForTest_(recordType, mobile) {
  getSheet_(SSC.SHEETS.EXISTING_CONTACTS).appendRow(['TEST-' + mobile, 'Test Contact', mobile, normaliseMobile_(mobile), recordType, 'Test', new Date(), 'Yes', 'Temporary test row']);
}

function cleanupTestRows_() {
  [SSC.SHEETS.REFERRERS, SSC.SHEETS.REFERRALS, SSC.SHEETS.EXISTING_CONTACTS, SSC.SHEETS.ACTIVITY_LOG].forEach(function (sheetName) {
    var sheet = getSheet_(sheetName);
    for (var row = sheet.getLastRow(); row >= 2; row--) {
      var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0].join(' ');
      if (values.indexOf('TEST') !== -1 || values.indexOf('Temporary test row') !== -1 || values.indexOf('Test Prospect') !== -1) {
        sheet.deleteRow(row);
      }
    }
  });
}
