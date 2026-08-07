(function () {
  'use strict';

  var CONTACT_PHONE = '917413832777';
  var API_TIMEOUT_MS = 12000;
  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

  var state = {
    token: '',
    referrerName: '',
    language: 'en',
    courses: [],
    categories: [],
    submitting: false,
    submitted: false,
    idempotencyKey: '',
    retryAction: null
  };

  var text = {
    en: {
      schoolName: 'Samyak Computer Classes',
      friendFallback: 'A friend',
      headingSuffix: 'has referred you to Samyak Computer Classes',
      intro: 'Explore our practical, career-focused courses and submit your details for personal counselling.',
      benefit: 'Special benefit for you: After successful admission, you will receive a complimentary classroom AI Prompting Crash Course.',
      loadingTitle: 'Validating invitation link',
      loadingCopy: 'Please wait while we check this invitation link.',
      coursesLoadingTitle: 'Loading courses',
      coursesLoadingCopy: 'We are fetching the latest active course list.',
      invalidTitle: 'This invitation link is invalid or no longer available.',
      invalidCopy: 'You can still contact Samyak Computer Classes directly for course counselling.',
      errorTitle: 'We could not load this page right now.',
      serverError: 'We could not submit your enquiry right now. Please try again or contact Samyak Computer Classes.',
      retryButton: 'Retry',
      websiteButton: 'Samyak website',
      whatsappButton: 'WhatsApp',
      callButton: 'Call Samyak',
      formTitle: 'Tell us which course you are interested in',
      formCopy: 'Share your details and our counsellor will contact you shortly.',
      nameLabel: 'Full Name',
      namePlaceholder: 'Enter your full name',
      mobileLabel: 'Mobile Number',
      mobilePlaceholder: '9876543210',
      emailLabel: 'Email Address',
      emailPlaceholder: 'optional@example.com',
      courseLabel: 'Course Interested',
      coursePlaceholder: 'Select a course',
      consent: 'I agree to be contacted by Samyak Computer Classes through phone calls, WhatsApp and email regarding course information, counselling and admission.',
      submitButton: 'Request course counselling',
      submittingButton: 'Submitting...',
      privacyNote: 'Samyak will use your details only for course counselling and admission follow-up.',
      successTitle: 'Thank you! Your course enquiry has been registered.',
      enquiryReferenceLabel: 'Enquiry Reference',
      protectedUntilLabel: 'Registration protected until',
      successCopy: 'Our counsellor will contact you shortly. After successful admission, you will receive your complimentary classroom AI Prompting Crash Course.',
      chatButton: 'Chat on WhatsApp',
      rejectionTitle: 'We could not register this enquiry.',
      requiredName: 'Please enter your full name.',
      requiredMobile: 'Please enter your mobile number.',
      invalidMobile: 'Please enter a valid 10-digit Indian mobile number.',
      invalidEmail: 'Please enter a valid email address or leave it blank.',
      requiredCourse: 'Please select a course.',
      requiredConsent: 'Please provide consent before submitting the form.',
      duplicate: 'Your course interest has already been registered. Please contact Samyak Computer Classes if you need assistance.',
      existingEnquiry: 'Your enquiry is already registered with Samyak Computer Classes. Please contact us for further assistance.',
      currentStudent: 'Our records indicate that you are already a Samyak student. Please contact the centre for assistance.',
      formerStudent: 'Our records indicate that you have previously studied at Samyak. Please contact the centre to explore available courses and benefits.',
      invalidReferral: 'This invitation link is no longer available. You may contact Samyak Computer Classes directly.',
      inactiveCourse: 'The selected course is currently unavailable. Please select another course.',
      coursesUnavailable: 'We could not load the active courses right now. Please try again.',
      validationUnavailable: 'We could not validate this invitation link right now. Please try again.',
      noCourses: 'No active courses are available right now. Please contact Samyak Computer Classes.',
      successWhatsApp: 'Hi Samyak, I submitted a course enquiry through a friend\'s invitation link. My Enquiry Reference is {id}.'
    },
    hi: {
      schoolName: 'Samyak Computer Classes',
      friendFallback: 'आपके एक मित्र',
      headingSuffix: 'ने आपको Samyak Computer Classes के लिए recommend किया है',
      intro: 'हमारे practical और career-focused courses देखें और personal counselling के लिए अपनी details submit करें।',
      benefit: 'आपके लिए विशेष लाभ: सफल admission के बाद आपको complimentary classroom AI Prompting Crash Course मिलेगा।',
      loadingTitle: 'Invitation link जांचा जा रहा है',
      loadingCopy: 'कृपया प्रतीक्षा करें, हम इस invitation link को जांच रहे हैं।',
      coursesLoadingTitle: 'कोर्स लोड हो रहे हैं',
      coursesLoadingCopy: 'हम latest active course list ला रहे हैं।',
      invalidTitle: 'यह invitation link invalid है या अब available नहीं है।',
      invalidCopy: 'आप course counselling के लिए Samyak Computer Classes से सीधे संपर्क कर सकते हैं।',
      errorTitle: 'यह page अभी load नहीं हो पाया।',
      serverError: 'हम अभी आपकी enquiry submit नहीं कर पाए। कृपया दोबारा प्रयास करें या Samyak Computer Classes से संपर्क करें।',
      retryButton: 'फिर कोशिश करें',
      websiteButton: 'Samyak website',
      whatsappButton: 'WhatsApp',
      callButton: 'Call Samyak',
      formTitle: 'बताएं कि आप किस course में interested हैं',
      formCopy: 'अपनी details share करें। हमारा counsellor आपसे जल्द संपर्क करेगा।',
      nameLabel: 'पूरा नाम',
      namePlaceholder: 'अपना पूरा नाम लिखें',
      mobileLabel: 'मोबाइल नंबर',
      mobilePlaceholder: '9876543210',
      emailLabel: 'ईमेल पता',
      emailPlaceholder: 'optional@example.com',
      courseLabel: 'जिस कोर्स में रुचि है',
      coursePlaceholder: 'कोर्स चुनें',
      consent: 'मैं पाठ्यक्रम की जानकारी, काउंसलिंग और एडमिशन के संबंध में Samyak Computer Classes द्वारा फोन, WhatsApp और ईमेल के माध्यम से संपर्क किए जाने के लिए सहमत हूँ।',
      submitButton: 'Course counselling के लिए request करें',
      submittingButton: 'Submit हो रहा है...',
      privacyNote: 'Samyak आपकी details का उपयोग केवल course counselling और admission follow-up के लिए करेगा।',
      successTitle: 'धन्यवाद! आपकी course enquiry register हो गई है।',
      enquiryReferenceLabel: 'Enquiry Reference',
      protectedUntilLabel: 'Registration protected until',
      successCopy: 'हमारा counsellor आपसे जल्द संपर्क करेगा। सफल admission के बाद आपको complimentary classroom AI Prompting Crash Course मिलेगा।',
      chatButton: 'WhatsApp पर chat करें',
      rejectionTitle: 'यह enquiry register नहीं हो पाई।',
      requiredName: 'कृपया अपना पूरा नाम भरें।',
      requiredMobile: 'कृपया मोबाइल नंबर भरें।',
      invalidMobile: 'कृपया valid 10-digit Indian mobile number भरें।',
      invalidEmail: 'कृपया valid email भरें या इसे blank छोड़ दें।',
      requiredCourse: 'कृपया कोर्स चुनें।',
      requiredConsent: 'कृपया form submit करने से पहले consent दें।',
      duplicate: 'आपकी course interest पहले से registered है। सहायता के लिए Samyak Computer Classes से संपर्क करें।',
      existingEnquiry: 'आपकी enquiry Samyak Computer Classes में पहले से registered है। आगे की सहायता के लिए हमसे संपर्क करें।',
      currentStudent: 'हमारे records के अनुसार आप पहले से Samyak student हैं। सहायता के लिए centre से संपर्क करें।',
      formerStudent: 'हमारे records के अनुसार आपने पहले Samyak में पढ़ाई की है। available courses और benefits explore करने के लिए centre से संपर्क करें।',
      invalidReferral: 'यह invitation link अब available नहीं है। आप Samyak Computer Classes से सीधे संपर्क कर सकते हैं।',
      inactiveCourse: 'चुना हुआ course अभी उपलब्ध नहीं है। कृपया दूसरा course चुनें।',
      coursesUnavailable: 'हम अभी active courses load नहीं कर पाए। कृपया फिर कोशिश करें।',
      validationUnavailable: 'हम अभी यह invitation link validate नहीं कर पाए। कृपया फिर कोशिश करें।',
      noCourses: 'अभी कोई active course उपलब्ध नहीं है। कृपया Samyak Computer Classes से संपर्क करें।',
      successWhatsApp: "Hi Samyak, I submitted a course enquiry through a friend's invitation link. My Enquiry Reference is {id}."
    }
  };

  var panels = {};
  var fields = {};
  var form;
  var formAlert;
  var submitButton;
  var retryButton;
  var referrerNameNode;
  var successReferralId;
  var successValidUntil;
  var successWhatsApp;
  var rejectionMessage;

  document.addEventListener('DOMContentLoaded', function () {
    panels = {
      loading: document.getElementById('loading-panel'),
      courses: document.getElementById('courses-panel'),
      invalid: document.getElementById('invalid-panel'),
      error: document.getElementById('error-panel'),
      form: document.getElementById('referral-form'),
      success: document.getElementById('success-panel'),
      rejection: document.getElementById('rejection-panel')
    };
    form = document.getElementById('referral-form');
    formAlert = document.getElementById('form-alert');
    submitButton = document.getElementById('submit-button');
    retryButton = document.getElementById('retry-button');
    referrerNameNode = document.getElementById('referrer-name');
    successReferralId = document.getElementById('success-referral-id');
    successValidUntil = document.getElementById('success-valid-until');
    successWhatsApp = document.getElementById('success-whatsapp');
    rejectionMessage = document.getElementById('rejection-message');
    fields = {
      name: document.getElementById('full-name'),
      mobile: document.getElementById('mobile'),
      email: document.getElementById('email'),
      course: document.getElementById('course'),
      consent: document.getElementById('consent')
    };

    document.querySelectorAll('[data-lang-button]').forEach(function (button) {
      button.addEventListener('click', function () {
        setLanguage(button.getAttribute('data-lang-button') || 'en');
      });
    });
    form.addEventListener('submit', handleSubmit);
    retryButton.addEventListener('click', handleRetry);

    setLanguage('en');
    start();
  });

  function start() {
    state.token = extractTokenFromPath();
    if (!TOKEN_PATTERN.test(state.token)) {
      showInvalidLink();
      return;
    }
    validateReferralToken();
  }

  function extractTokenFromPath() {
    var path = window.location.pathname || '';
    var match = path.match(/^\/r\/([^/?#]+)\/?$/);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).slice(0, 128);
    } catch (_error) {
      return '';
    }
  }

  function setLanguage(language) {
    state.language = language === 'hi' ? 'hi' : 'en';
    document.documentElement.lang = state.language === 'hi' ? 'hi' : 'en';

    document.querySelectorAll('[data-lang-button]').forEach(function (button) {
      var isActive = button.getAttribute('data-lang-button') === state.language;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var key = node.getAttribute('data-i18n');
      if (text[state.language][key]) node.textContent = text[state.language][key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
      var key = node.getAttribute('data-i18n-placeholder');
      if (text[state.language][key]) node.setAttribute('placeholder', text[state.language][key]);
    });

    updateCoursePlaceholder();
    updateReferrerName();
    clearFieldErrors();
    if (submitButton.disabled && state.submitting) {
      submitButton.textContent = text[state.language].submittingButton;
    }
  }

  function showPanel(name, focusSelector) {
    Object.keys(panels).forEach(function (key) {
      panels[key].classList.toggle('is-hidden', key !== name);
    });
    var focusTarget = focusSelector ? document.querySelector(focusSelector) : panels[name].querySelector('h2');
    if (focusTarget) {
      window.setTimeout(function () { focusTarget.focus(); }, 0);
    }
  }

  function validateReferralToken() {
    state.retryAction = validateReferralToken;
    showPanel('loading');
    fetchJson('/api/public/referrals/resolve/' + encodeURIComponent(state.token), { method: 'GET' })
      .then(function (data) {
        if (data && data.valid === true) {
          state.referrerName = sanitizePublicReferrerName(data.referrer && data.referrer.displayName);
          updateReferrerName();
          loadCourses();
        } else {
          showInvalidLink();
        }
      })
      .catch(function () {
        showRecoverableError(text[state.language].validationUnavailable, validateReferralToken);
      });
  }

  function loadCourses() {
    state.retryAction = loadCourses;
    showPanel('courses');
    fetchJson('/api/public/referrals/resolve/' + encodeURIComponent(state.token) + '/courses', { method: 'GET' })
      .then(function (data) {
        if (!data || data.success !== true || !Array.isArray(data.categories)) {
          throw new Error('COURSES_UNAVAILABLE');
        }
        state.categories = data.categories.filter(function (category) {
          return category && typeof category.id === 'string' && typeof category.name === 'string' && Array.isArray(category.courses);
        });
        state.courses = [];
        state.categories.forEach(function (category) {
          category.courses.forEach(function (course) {
            if (course && typeof course.id === 'string' && typeof course.name === 'string') {
              state.courses.push(course);
            }
          });
        });
        if (!state.courses.length) {
          showRecoverableError(text[state.language].noCourses, loadCourses);
          return;
        }
        renderCourses();
        showPanel('form');
      })
      .catch(function () {
        showRecoverableError(text[state.language].coursesUnavailable, loadCourses);
      });
  }

  function renderCourses() {
    while (fields.course.options.length > 1) {
      fields.course.remove(1);
    }
    state.categories.forEach(function (category) {
      var group = document.createElement('optgroup');
      group.label = category.name.slice(0, 120);
      category.courses.forEach(function (course) {
        var option = document.createElement('option');
        option.value = course.id.slice(0, 120);
        option.textContent = course.name.slice(0, 120);
        group.appendChild(option);
      });
      if (group.children.length) fields.course.appendChild(group);
    });
    updateCoursePlaceholder();
  }

  function updateCoursePlaceholder() {
    if (fields.course && fields.course.options.length) {
      fields.course.options[0].textContent = text[state.language].coursePlaceholder;
    }
  }

  function updateReferrerName() {
    if (!referrerNameNode) return;
    referrerNameNode.textContent = state.referrerName || text[state.language].friendFallback;
  }

  function sanitizePublicReferrerName(value) {
    var name = trimLimit(value, 60);
    return name || '';
  }

  function handleRetry() {
    if (typeof state.retryAction === 'function') {
      state.retryAction();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (state.submitting || state.submitted) return;
    clearFormAlert();
    var payload = validateForm();
    if (!payload) return;

    state.submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = text[state.language].submittingButton;
    state.idempotencyKey = state.idempotencyKey || generateIdempotencyKey();

    postJson('/api/public/referrals/submit', payload, { 'Idempotency-Key': state.idempotencyKey })
      .then(function (data) {
        if (data && data.success === true) {
          state.submitted = true;
          showSuccess(data);
          return;
        }
        handleSubmissionFailure(data || {});
      })
      .catch(function () {
        showFormAlert(text[state.language].serverError);
        unlockSubmission();
      });
  }

  function validateForm() {
    clearFieldErrors();
    var firstInvalid = null;
    var name = trimLimit(fields.name.value, 100);
    var mobile = trimLimit(fields.mobile.value, 40);
    var email = trimLimit(fields.email.value, 150);
    var courseId = trimLimit(fields.course.value, 80);
    var normalisedMobile = normaliseMobile(mobile);

    fields.name.value = name;
    fields.mobile.value = mobile;
    fields.email.value = email;

    if (!name) firstInvalid = markInvalid(firstInvalid, 'name', text[state.language].requiredName);
    if (!mobile) {
      firstInvalid = markInvalid(firstInvalid, 'mobile', text[state.language].requiredMobile);
    } else if (!normalisedMobile) {
      firstInvalid = markInvalid(firstInvalid, 'mobile', text[state.language].invalidMobile);
    }
    if (email && !isValidEmail(email)) firstInvalid = markInvalid(firstInvalid, 'email', text[state.language].invalidEmail);
    if (!courseId) firstInvalid = markInvalid(firstInvalid, 'course', text[state.language].requiredCourse);
    if (!fields.consent.checked) firstInvalid = markInvalid(firstInvalid, 'consent', text[state.language].requiredConsent);

    if (firstInvalid) {
      fields[firstInvalid].focus();
      return null;
    }

    return {
      token: state.token,
      name: name,
      mobile: mobile,
      email: email,
      courseId: courseId,
      consent: true
    };
  }

  function markInvalid(currentFirst, fieldName, message) {
    var field = fields[fieldName];
    var error = document.getElementById(fieldName + '-error');
    if (field) field.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
    return currentFirst || fieldName;
  }

  function clearFieldErrors() {
    Object.keys(fields).forEach(function (key) {
      if (fields[key]) fields[key].removeAttribute('aria-invalid');
    });
    ['name-error', 'mobile-error', 'email-error', 'course-error', 'consent-error'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = '';
    });
  }

  function handleSubmissionFailure(data) {
    var code = typeof data.code === 'string' ? data.code : '';
    var message = mapBackendMessage(code);

    if (code === 'DUPLICATE_REFERRAL' || code === 'EXISTING_ENQUIRY' || code === 'CURRENT_STUDENT' || code === 'FORMER_STUDENT') {
      showRejection(message);
      return;
    }

    if (code === 'INVALID_REFERRAL_LINK' || code === 'INACTIVE_REFERRER') {
      showInvalidLink();
      return;
    }

    if (code === 'CONSENT_REQUIRED') {
      markInvalid(null, 'consent', message);
      fields.consent.focus();
      unlockSubmission();
      return;
    }

    if (code === 'INVALID_MOBILE_NUMBER') {
      markInvalid(null, 'mobile', message);
      fields.mobile.focus();
      unlockSubmission();
      return;
    }

    if (code === 'INACTIVE_COURSE') {
      markInvalid(null, 'course', message);
      fields.course.focus();
      unlockSubmission();
      return;
    }

    showFormAlert(message);
    unlockSubmission();
  }

  function mapBackendMessage(code) {
    var copy = text[state.language];
    var messages = {
      DUPLICATE_REFERRAL: copy.duplicate,
      EXISTING_ENQUIRY: copy.existingEnquiry,
      CURRENT_STUDENT: copy.currentStudent,
      FORMER_STUDENT: copy.formerStudent,
      INVALID_REFERRAL_LINK: copy.invalidReferral,
      INACTIVE_REFERRER: copy.invalidReferral,
      CONSENT_REQUIRED: copy.requiredConsent,
      INVALID_MOBILE_NUMBER: copy.invalidMobile,
      INACTIVE_COURSE: copy.inactiveCourse
    };
    return messages[code] || copy.serverError;
  }

  function showSuccess(data) {
    var referralId = typeof data.enquiryNumber === 'string' ? data.enquiryNumber.slice(0, 40) : (typeof data.referralId === 'string' ? data.referralId.slice(0, 40) : '');
    var validUntil = typeof data.validUntil === 'string' ? data.validUntil.slice(0, 30) : '';
    successReferralId.textContent = referralId;
    successValidUntil.textContent = validUntil;
    successWhatsApp.href = 'https://wa.me/' + CONTACT_PHONE + '?text=' + encodeURIComponent(text[state.language].successWhatsApp.replace('{id}', referralId));
    showPanel('success', '#success-heading');
  }

  function showRejection(message) {
    rejectionMessage.textContent = message;
    showPanel('rejection', '#rejection-heading');
  }

  function showInvalidLink() {
    showPanel('invalid', '#invalid-heading');
  }

  function showRecoverableError(message, retryAction) {
    state.retryAction = retryAction;
    document.getElementById('error-copy').textContent = message;
    showPanel('error', '#error-heading');
  }

  function showFormAlert(message) {
    formAlert.textContent = message;
    formAlert.classList.remove('is-hidden');
  }

  function clearFormAlert() {
    formAlert.textContent = '';
    formAlert.classList.add('is-hidden');
  }

  function unlockSubmission() {
    state.submitting = false;
    if (!state.submitted) {
      submitButton.disabled = false;
      submitButton.textContent = text[state.language].submitButton;
    }
  }

  function fetchJson(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, API_TIMEOUT_MS);
    var requestOptions = options || {};
    requestOptions.signal = controller.signal;
    return fetch(url, requestOptions)
      .then(function (response) {
        window.clearTimeout(timeoutId);
        if (!response.ok) throw new Error('REQUEST_FAILED');
        return response.json();
      })
      .catch(function (error) {
        window.clearTimeout(timeoutId);
        throw error;
      });
  }

  function postJson(url, payload, headers) {
    return fetchJson(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
      body: JSON.stringify(payload)
    });
  }

  function trimLimit(value, maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  function normaliseMobile(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
    if (digits.length === 11 && digits.charAt(0) === '0') digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : '';
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function generateIdempotencyKey() {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }
}());
