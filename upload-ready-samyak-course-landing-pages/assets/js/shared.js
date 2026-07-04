(function () {
  var WHATSAPP_CONVERSION = 'AW-17938047753/l-dXCN76xskcEInGw-lC';
  var CALL_CONVERSION = 'AW-17938047753/4-O_CNv6xskcEInGw-lC';
  var FORM_CONVERSION = 'AW-17938047753/KKhoCJuo7MEcEInGw-IC';
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/shreeservicesrt@gmail.com';
  var DEFAULT_WHATSAPP_NUMBER = '917413832777';

  function fireConversion(sendTo, callback) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      callback();
    }
    var fallback = window.setTimeout(finish, 500);
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'conversion', {
          send_to: sendTo,
          event_callback: function () {
            window.clearTimeout(fallback);
            finish();
          }
        });
      } else {
        window.clearTimeout(fallback);
        finish();
      }
    } catch (error) {
      window.clearTimeout(fallback);
      finish();
    }
  }

  function handleConversionLink(event) {
    var link = event.currentTarget;
    var destination = link.href;
    var isCall = destination.indexOf('tel:') === 0;
    event.preventDefault();
    fireConversion(isCall ? CALL_CONVERSION : WHATSAPP_CONVERSION, function () {
      window.location.href = destination;
    });
  }

  function phoneIsValid(phone) {
    return /^[0-9]{10}$/.test(phone);
  }

  function buildFallback(course, name, phone) {
    var number = document.body.dataset.whatsappNumber || DEFAULT_WHATSAPP_NUMBER;
    var message = 'Hi, I am interested in the ' + course + ' course at Samyak Sion. Please contact me. Name: ' + name + '. Phone: ' + phone + '.';
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(message);
  }

  function showError(form, message, fallbackUrl) {
    var location = form.dataset.location;
    var error = document.getElementById(location + '-form-error');
    if (!error) return;
    error.hidden = false;
    error.innerHTML = message + ' <a href="' + fallbackUrl + '">Message us directly on WhatsApp</a>.';
  }

  function clearError(form) {
    var location = form.dataset.location;
    var error = document.getElementById(location + '-form-error');
    if (!error) return;
    error.hidden = true;
    error.textContent = '';
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    if (form.dataset.submitting === 'true') return;

    var nameInput = form.querySelector('input[name="name"]');
    var phoneInput = form.querySelector('input[name="phone"]');
    var button = form.querySelector('button[type="submit"]');
    var name = (nameInput && nameInput.value || '').trim();
    var phone = (phoneInput && phoneInput.value || '').replace(/\D/g, '');
    var course = form.dataset.course || 'this';
    var fallbackUrl = buildFallback(course, name, phone);

    clearError(form);

    if (!name) {
      showError(form, 'Please enter your name.', fallbackUrl);
      if (nameInput) nameInput.focus();
      return;
    }
    if (!phoneIsValid(phone)) {
      showError(form, 'Please enter a valid 10-digit Indian mobile number.', fallbackUrl);
      if (phoneInput) phoneInput.focus();
      return;
    }

    form.dataset.submitting = 'true';
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending...';
    }

    var payload = {};
    Array.prototype.forEach.call(new FormData(form).entries(), function (entry) {
      payload[entry[0]] = entry[1];
    });
    payload.name = name;
    payload.phone = phone;

    fetch(document.body.dataset.formEndpoint || FORM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('FormSubmit returned ' + response.status);
        }
        return response.json().catch(function () { return {}; });
      })
      .then(function () {
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'conversion', {
            send_to: FORM_CONVERSION,
            value: 500,
            currency: 'INR'
          });
        }
        var location = form.dataset.location;
        var container = document.getElementById(location + '-form-container');
        var success = document.getElementById(location + '-form-success');
        if (container) container.style.display = 'none';
        if (success) {
          success.style.display = 'block';
          success.setAttribute('role', 'status');
          success.setAttribute('tabindex', '-1');
          success.focus();
        }
      })
      .catch(function () {
        form.dataset.submitting = 'false';
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.defaultText || 'Request Callback';
        }
        showError(form, 'Sorry, the form could not be submitted right now.', fallbackUrl);
      });
  }

  function setupFaqs() {
    document.querySelectorAll('.faq-q').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = button.closest('.faq-item');
        var isOpen = item && item.classList.toggle('open');
        button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a[href*="wa.me"], a[href^="tel:"]').forEach(function (link) {
      link.addEventListener('click', handleConversionLink);
    });
    document.querySelectorAll('form.lead-form').forEach(function (form) {
      form.addEventListener('submit', handleFormSubmit);
    });
    setupFaqs();
  });
}());
