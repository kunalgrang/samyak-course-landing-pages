var SSC = (function () {
  var PROGRAMME_NAME = 'Samyak Skill Circle';
  var PERSONAL_LINK_BASE_DEFAULT = 'https://go.samyaksion.com/r/';

  var SHEETS = {
    REFERRERS: 'Referrers',
    COURSES: 'Courses',
    REFERRALS: 'Referrals',
    EXISTING_CONTACTS: 'ExistingContacts',
    ACTIVITY_LOG: 'ActivityLog',
    SETTINGS: 'Settings'
  };

  var HEADERS = {};
  HEADERS[SHEETS.REFERRERS] = [
    'Referrer ID',
    'Full Name',
    'Mobile Number',
    'Normalised Mobile',
    'Referrer Type',
    'Course Studied',
    'Referral Token',
    'Personal Link',
    'WhatsApp Share Link',
    'Created Date',
    'Active',
    'Total Referrals',
    'Successful Admissions',
    'Cash Rewards Earned',
    'Course Credit Earned',
    'Notes'
  ];
  HEADERS[SHEETS.COURSES] = [
    'Course ID',
    'Course Name',
    'Standard Fee',
    'Cash Reward',
    'Course Credit',
    'Active',
    'Display Order'
  ];
  HEADERS[SHEETS.REFERRALS] = [
    'Referral ID',
    'Submission Date and Time',
    'Referral Token',
    'Referrer ID',
    'Prospect Name',
    'Mobile Number',
    'Normalised Mobile',
    'Email',
    'Course Interested',
    'Consent',
    'Referral Source',
    'Status',
    'Valid Until',
    'Validation Result',
    'Admission Date',
    'Course Joined',
    'Standard Course Fee',
    'Final Course Fee',
    'Minimum Qualifying Payment',
    'Amount Received',
    'Reward Eligibility Date',
    'Cash Reward',
    'Course Credit',
    'Reward Choice',
    'Approved Reward Amount',
    'Reward Approval Status',
    'Reward Approval Date',
    'Reward Payment Status',
    'Reward Payment Date',
    'Payment Reference',
    'Cancellation Adjustment',
    'Registration WhatsApp Link',
    'Admission WhatsApp Link',
    'Reward Approval WhatsApp Link',
    'Reward Paid WhatsApp Link',
    'Admin Notes',
    'Last Updated'
  ];
  HEADERS[SHEETS.EXISTING_CONTACTS] = [
    'Contact ID',
    'Full Name',
    'Mobile Number',
    'Normalised Mobile',
    'Record Type',
    'Course',
    'Registration Date',
    'Active',
    'Notes'
  ];
  HEADERS[SHEETS.ACTIVITY_LOG] = [
    'Date and Time',
    'Action',
    'Referral ID',
    'Referrer ID',
    'Performed By',
    'Old Value',
    'New Value',
    'Notes'
  ];
  HEADERS[SHEETS.SETTINGS] = [
    'Setting',
    'Value',
    'Description'
  ];

  var SETTINGS = [
    ['PROGRAMME_NAME', PROGRAMME_NAME, 'Public programme name.'],
    ['PROGRAMME_TAGLINE', 'Learn, Refer and Grow', 'Public programme tagline.'],
    ['PERSONAL_LINK_BASE', PERSONAL_LINK_BASE_DEFAULT, 'Base URL used before the personal referral token.'],
    ['REFERRAL_VALIDITY_DAYS', 90, 'Number of days an accepted referral remains active.'],
    ['MINIMUM_FEE_PERCENT', 50, 'Percentage of final agreed fee required before reward eligibility.'],
    ['COURSE_CREDIT_VALIDITY_MONTHS', 12, 'Validity period for approved course credit.'],
    ['INSTITUTE_PHONE', '', 'Administrator may fill this later.'],
    ['INSTITUTE_WHATSAPP', '', 'Administrator may fill this later.']
  ];

  var COURSE_NAMES = [
    'MS Office',
    'Advanced Excel',
    'Tally',
    'Digital Marketing',
    'Data Analytics',
    'Web Development',
    'Graphic Design',
    'Video Editing',
    'Animation and VFX',
    'AI and Machine Learning',
    'Others'
  ];

  var REFERRAL_STATUSES = [
    'Duplicate Referral',
    'Existing Enquiry',
    'Current Student',
    'Former Student',
    'Invalid Referral Link',
    'Invalid Mobile Number',
    'Referral Accepted',
    'Counselling in Progress',
    'Admission Confirmed',
    'Awaiting Minimum Fee',
    'Reward Eligible',
    'Reward Approved',
    'Reward Paid',
    'Admission Cancelled',
    'Referral Expired',
    'Referral Rejected'
  ];

  var ACTIVITY = {
    SUBMITTED: 'Referral submitted',
    REJECTED: 'Referral rejected',
    DUPLICATE: 'Duplicate detected',
    EXPIRED: 'Referral expired',
    ADMISSION_CONFIRMED: 'Admission confirmed',
    FEE_UPDATED: 'Fee updated',
    REWARD_ELIGIBLE: 'Reward became eligible',
    REWARD_APPROVED: 'Reward approved',
    REWARD_PAID: 'Reward paid',
    ADMISSION_CANCELLED: 'Admission cancelled',
    REWARD_ADJUSTED: 'Reward recovered or adjusted'
  };

  return {
    PROGRAMME_NAME: PROGRAMME_NAME,
    PERSONAL_LINK_BASE_DEFAULT: PERSONAL_LINK_BASE_DEFAULT,
    SHEETS: SHEETS,
    HEADERS: HEADERS,
    SETTINGS: SETTINGS,
    COURSE_NAMES: COURSE_NAMES,
    REFERRAL_STATUSES: REFERRAL_STATUSES,
    ACTIVITY: ACTIVITY,
    YES_NO: ['Yes', 'No'],
    REFERRER_TYPES: ['Student', 'Alumni'],
    REFERRAL_SOURCES: ['Online', 'Physical'],
    EXISTING_RECORD_TYPES: ['Existing Enquiry', 'Current Student', 'Former Student'],
    REWARD_CHOICES: ['Cash', 'Course Credit'],
    REWARD_APPROVAL_STATUSES: ['Pending', 'Approved', 'Rejected', 'Adjusted'],
    REWARD_PAYMENT_STATUSES: ['Pending', 'Paid', 'Recovered', 'Adjusted', 'Cancelled']
  };
}());
