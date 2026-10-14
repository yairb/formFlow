// Dev only: served and injected by scripts/dev-error-relay.ts, never part of a build.
(function () {
  function send(kind, detail) {
    try {
      fetch('/__dev-error', { method: 'POST', body: kind + ': ' + detail, keepalive: true });
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    send('error', (e.message || 'resource failed: ' + (e.target && (e.target.src || e.target.href))) + (e.error && e.error.stack ? '\n' + e.error.stack : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    send('unhandledrejection', r && r.stack ? r.stack : String(r));
  });
  document.addEventListener('securitypolicyviolation', function (e) {
    send('csp', e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline') + ' at ' + e.sourceFile + ':' + e.lineNumber);
  });
  var orig = console.error;
  console.error = function () {
    send('console.error', Array.prototype.map.call(arguments, function (a) { return a && a.stack ? a.stack : String(a); }).join(' '));
    return orig.apply(console, arguments);
  };
})();
