const rateLimit = require('express-rate-limit');

// Login is the primary brute-force target — unauthenticated, password-guessable.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Password changes are auth-guessing surface too (attacker with a stolen/guessed
// token could brute-force current_password), so keep it tight as well.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

// Broad guard across all API routes — generous enough for normal use,
// blocks scripted abuse/DoS.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiter, passwordChangeLimiter, apiLimiter };
