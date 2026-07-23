import { initBotId } from 'botid/client/core';

// BotID client-side protection (Next.js 15.3+ instrumentation-client hook).
// Every path listed here must ALSO call checkBotId() on the server — this list
// dictates which requests get the classification headers attached; a protected
// server route with no matching entry here will always read as a bot.
//
// Only include routes invoked via fetch/form from within the app UI. Endpoints
// hit from email links (subscribe/confirm, unsubscribe, email digest) or cron
// (ingest, import) must NOT be listed — BotID would block those real requests.
initBotId({
  protect: [
    // Sends email → email-bomb / spam vector.
    { path: '/api/auth/magic-link', method: 'POST' },
    // Sends confirmation email → subscription abuse.
    { path: '/api/subscribe', method: 'POST' },
    // User-generated content → moderation / downstream LLM cost.
    { path: '/api/submissions', method: 'POST' },
    // Grants attendance rewards → farming abuse.
    { path: '/api/attendance', method: 'POST' },
    // Profile writes.
    { path: '/api/onboarding', method: 'POST' },
    { path: '/api/favorites', method: 'POST' },
    // Account mutations, including account deletion (DELETE).
    { path: '/api/profile', method: 'POST' },
    { path: '/api/profile', method: 'PATCH' },
    { path: '/api/profile', method: 'DELETE' },
  ],
});
