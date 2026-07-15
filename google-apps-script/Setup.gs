function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Samyak Skill Circle')
    .addItem('Setup Workbook', 'setupWorkbook')
    .addItem('Generate Missing Referral Links', 'generateMissingReferralLinks')
    .addItem('Refresh Referrer Statistics', 'refreshReferrerStatistics')
    .addItem('Expire Old Referrals', 'expireOldReferrals')
    .addToUi();
}

function setupWorkbook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss || !ss.getId()) {
    throw publicError_('CONFIGURATION_ERROR', 'Open the referral workbook before running setupWorkbook().');
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(SSC.HEADERS).forEach(function (sheetName) {
    var sheet = ensureSheet_(ss, sheetName);
    ensureHeaders_(sheet, SSC.HEADERS[sheetName]);
    freezeHeader_(sheet);
  });
  populateSettings_();
  populateCourses_();
  applyWorkbookValidation_();
  SpreadsheetApp.getActive().toast('Samyak Skill Circle workbook setup complete.');
}

function ensureSheet_(ss, sheetName) {
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function ensureHeaders_(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0];
  var needsUpdate = headers.some(function (header, index) {
    return current[index] !== header;
  });
  if (needsUpdate) {
    range.setValues([headers]);
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eef5f7');
  sheet.autoResizeColumns(1, headers.length);
}

function freezeHeader_(sheet) {
  sheet.setFrozenRows(1);
}

function populateSettings_() {
  var sheet = getSheet_(SSC.SHEETS.SETTINGS);
  var rows = readObjects_(sheet);
  var existing = {};
  rows.forEach(function (row) {
    existing[row.Setting] = true;
  });
  var toAppend = SSC.SETTINGS.filter(function (setting) {
    return !existing[setting[0]];
  });
  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, SSC.HEADERS[SSC.SHEETS.SETTINGS].length).setValues(toAppend);
  }
}

function populateCourses_() {
  var sheet = getSheet_(SSC.SHEETS.COURSES);
  var rows = readObjects_(sheet);
  var existing = {};
  rows.forEach(function (row) {
    existing[row['Course ID']] = true;
  });
  var toAppend = [];
  SSC.COURSE_NAMES.forEach(function (name, index) {
    var id = courseIdFromName_(name);
    if (!existing[id]) {
      toAppend.push([id, name, '', '', '', 'Yes', index + 1]);
    }
  });
  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, SSC.HEADERS[SSC.SHEETS.COURSES].length).setValues(toAppend);
  }
}

function applyWorkbookValidation_() {
  applyValidation_(SSC.SHEETS.REFERRERS, 'Referrer Type', SSC.REFERRER_TYPES);
  applyValidation_(SSC.SHEETS.REFERRERS, 'Active', SSC.YES_NO);
  applyValidation_(SSC.SHEETS.COURSES, 'Active', SSC.YES_NO);
  applyValidation_(SSC.SHEETS.REFERRALS, 'Referral Source', SSC.REFERRAL_SOURCES);
  applyValidation_(SSC.SHEETS.REFERRALS, 'Status', SSC.REFERRAL_STATUSES);
  applyValidation_(SSC.SHEETS.REFERRALS, 'Reward Choice', SSC.REWARD_CHOICES);
  applyValidation_(SSC.SHEETS.REFERRALS, 'Reward Approval Status', SSC.REWARD_APPROVAL_STATUSES);
  applyValidation_(SSC.SHEETS.REFERRALS, 'Reward Payment Status', SSC.REWARD_PAYMENT_STATUSES);
  applyValidation_(SSC.SHEETS.EXISTING_CONTACTS, 'Record Type', SSC.EXISTING_RECORD_TYPES);
  applyValidation_(SSC.SHEETS.EXISTING_CONTACTS, 'Active', SSC.YES_NO);
}

function applyValidation_(sheetName, header, values) {
  var sheet = getSheet_(sheetName);
  var col = getHeaderMap_(sheet)[header];
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

function generateMissingReferralLinks() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SSC.SHEETS.REFERRERS);
    var headers = getHeaderMap_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
    var values = range.getValues();
    var settings = getSettings_();
    var tokenSet = getExistingTokenSet_();
    values.forEach(function (row) {
      var tokenIndex = headers['Referral Token'] - 1;
      var linkIndex = headers['Personal Link'] - 1;
      var shareIndex = headers['WhatsApp Share Link'] - 1;
      if (!row[tokenIndex]) {
        row[tokenIndex] = generateUniqueReferralToken_(tokenSet);
      }
      row[linkIndex] = buildPersonalLink_(row[tokenIndex], settings);
      row[shareIndex] = buildReferrerShareLink_(row[linkIndex]);
      if (!row[headers['Created Date'] - 1]) row[headers['Created Date'] - 1] = new Date();
      if (!row[headers.Active - 1]) row[headers.Active - 1] = 'Yes';
    });
    range.setValues(values);
  } finally {
    lock.releaseLock();
  }
}

function refreshReferrerStatistics() {
  var refSheet = getSheet_(SSC.SHEETS.REFERRERS);
  var referralRows = readObjects_(getSheet_(SSC.SHEETS.REFERRALS));
  var stats = {};
  referralRows.forEach(function (row) {
    var referrerId = row['Referrer ID'];
    if (!referrerId) return;
    if (!stats[referrerId]) {
      stats[referrerId] = { total: 0, successful: 0, cash: 0, credit: 0 };
    }
    stats[referrerId].total += 1;
    if (['Admission Confirmed', 'Awaiting Minimum Fee', 'Reward Eligible', 'Reward Approved', 'Reward Paid'].indexOf(row.Status) !== -1) {
      stats[referrerId].successful += 1;
    }
    if (row['Reward Choice'] === 'Cash') stats[referrerId].cash += Number(row['Approved Reward Amount'] || 0);
    if (row['Reward Choice'] === 'Course Credit') stats[referrerId].credit += Number(row['Approved Reward Amount'] || 0);
  });
  var headers = getHeaderMap_(refSheet);
  var lastRow = refSheet.getLastRow();
  if (lastRow < 2) return;
  var range = refSheet.getRange(2, 1, lastRow - 1, refSheet.getLastColumn());
  var values = range.getValues();
  values.forEach(function (row) {
    var id = row[headers['Referrer ID'] - 1];
    var stat = stats[id] || { total: 0, successful: 0, cash: 0, credit: 0 };
    row[headers['Total Referrals'] - 1] = stat.total;
    row[headers['Successful Admissions'] - 1] = stat.successful;
    row[headers['Cash Rewards Earned'] - 1] = stat.cash;
    row[headers['Course Credit Earned'] - 1] = stat.credit;
  });
  range.setValues(values);
}

function expireOldReferrals() {
  var sheet = getSheet_(SSC.SHEETS.REFERRALS);
  var headers = getHeaderMap_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  var values = range.getValues();
  var now = new Date();
  values.forEach(function (row) {
    var status = row[headers.Status - 1];
    var validUntil = row[headers['Valid Until'] - 1];
    if (status === 'Referral Accepted' && validUntil instanceof Date && validUntil < now) {
      row[headers.Status - 1] = 'Referral Expired';
      row[headers['Last Updated'] - 1] = now;
      logActivity_(SSC.ACTIVITY.EXPIRED, row[headers['Referral ID'] - 1], row[headers['Referrer ID'] - 1], status, 'Referral Expired', 'Referral validity ended.');
    }
  });
  range.setValues(values);
}
