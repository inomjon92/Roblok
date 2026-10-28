// Android app: tell the wrapper the game started, and offer a newer APK when one is out.
(function () {
  var GAME_VERSION = '0.4.0';
  var SITE = 'https://roblok-inom1.vercel.app/';
  var $ = function (id) { return document.getElementById(id); };
  $('versionText').textContent = 'v' + GAME_VERSION;
  var app = window.RoblokApp;
  if (!app) return;
  try { app.ready(); } catch (e) { /* older wrapper */ }
  fetch(SITE + 'version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (v) {
      if (!(v.apkCode > app.versionCode())) return;
      $('updateText').textContent = 'Yangi versiya ' + v.apkName + ' chiqdi!';
      $('updateBtn').onclick = function () { app.openUrl(v.apkUrl); };
      $('updateBar').classList.add('on');
    })
    .catch(function () {});
})();
