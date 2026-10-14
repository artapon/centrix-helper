// Sign-in / install pages: show-password toggles and confirm-password check.
(function () {
  document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = document.getElementById(button.getAttribute('data-password-toggle'));
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      button.querySelector('i').className = show ? 'far fa-eye-slash' : 'far fa-eye';
    });
  });

  var password = document.getElementById('password');
  var confirm = document.getElementById('password_confirm');
  if (password && confirm) {
    var check = function () {
      confirm.setCustomValidity(confirm.value && confirm.value !== password.value ? 'Passwords do not match.' : '');
    };
    password.addEventListener('input', check);
    confirm.addEventListener('input', check);
  }

  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      var button = form.querySelector('button[type="submit"]');
      if (button) setTimeout(function () { button.disabled = true; }, 0);
    });
  });
})();
