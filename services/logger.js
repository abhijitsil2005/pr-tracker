// Structured JSON logger. Writes one JSON object per line to stdout/stderr —
// Elastic Beanstalk already captures both and (once CloudWatch Logs streaming
// is enabled via .ebextensions) ships them to CloudWatch Logs verbatim, so
// there's no need for a CloudWatch SDK transport here. Passing `correlationId`
// in `meta` ties a log line back to the request that produced it (see
// middleware/requestId.js) — grep/filter CloudWatch Logs Insights by it to
// pull every line for one request across all routes/queries.
function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  info:  (message, meta) => log('info', message, meta),
  warn:  (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
