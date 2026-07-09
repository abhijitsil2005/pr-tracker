const crypto = require('crypto');

// Reuse an inbound correlation id (e.g. from an upstream proxy/ALB or a
// client that's retrying/tracing a request) so a single logical request
// keeps one id across hops; otherwise mint a fresh one. Echoed back on the
// response so a caller can report the id when asking about a failure.
function requestId(req, res, next) {
  req.id = req.get('X-Request-Id') || req.get('X-Correlation-Id') || crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
