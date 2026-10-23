# Telegram forecast alerts

## Goal

Keep checking named spots against the rolling next 14 local calendar days and
notify the owner's private Telegram chat when the saved wind and swell rules
qualify, without an open browser tab. Preserve existing saved spots and map tools.

## Initial design

1. Reuse the existing wind/swell scorer on the server. Include minimum and maximum
   swell period, clockwise bearings, speed, height, consecutive hours and minimum
   matching days. Show all qualifying dates and their first matching window.
2. Store enabled spots and delivery state in SQLite on a persistent volume.
   The browser keeps its existing local presets and explicitly synchronizes its
   enabled alerts after connecting Telegram and after successful saves/deletions.
3. Add an anonymous, private browser session and a short-lived, single-use Telegram
   `/start` link. Bot credentials stay on the server. Accept private chats only.
4. Poll Telegram updates on the server; persist the update cursor. Support
   `/start`, `/status`, `/stop` and `/help`. Polling avoids external webhook setup.
5. Run a bounded forecast check on startup and about every six hours. Deduplicate
   notifications durably; retry temporary errors and disable blocked chats.
6. Add a compact Telegram section to Saved spots: connect, current state, sync
   feedback, test notification and disconnect. Notification links reopen a spot.
7. Test scorer semantics, persistence/restarts, linking, authorization, delivery
   retries/deduplication and the complete browser flow with a local Telegram stub.
8. Document deployment variables, persistent storage, one worker/replica, bot
   creation, operational status and the real-phone acceptance check.

## Review loop

### Pass 1 — design and scoring review

Findings and decisions:

- Start from deployed commit `9258f5b`, not the older main checkout. Keep the
  maximum-period control, observation layers and street-level zoom.
- Existing forecast scoring still counts nighttime. Apply the same fixed
  **06:00 inclusive to 18:00 exclusive, local to the spot** rule to forecast
  and historical matching. Preserve the existing hourly-sample interpretation
  (two consecutive matching hourly samples); never join runs across dates/gaps.
- Add qualifying windows to the shared result, preserving its existing fields.
  Share the actual scorer, not a second Telegram-specific implementation.
- Connect is explicit consent to send enabled saved-spot alerts to a private
  chat. Add a separately requested test message. Never send real test messages
  from automated tests or use another signed-in messaging account.
- Use a random HttpOnly, SameSite=Strict browser cookie; persist only its hash.
  Validate same-origin mutations and bounded JSON input. Never accept a chat ID
  from the browser. `/start` links carry random, hashed, 10-minute, one-use
  tokens. Only a private human sender can claim one.
- Keep existing browser presets. Persist a separate server-owned snapshot of
  enabled alerts. Synchronize only after successful browser persistence; show
  unsynced/error states. Do not erase server alerts merely because an initial
  local-storage read is empty or failed. Use server revisions to reject stale
  writes from another tab.
- A message links to the server's saved alert using the owner cookie. It can
  restore that preset into the original browser without sharing credentials in
  the URL. Other browsers show a helpful access message, not somebody's rules.

### Pass 2 — failure and delivery walkthrough

Refinements:

- Use Node 24's built-in SQLite with WAL, transactions and a required durable
  database path when Telegram is enabled. No extra database dependency. Run one
  application replica with a volume and a renewable database worker lease.
- Telegram long polling has a durable update cursor, bounded timeouts and
  backoff. Advance the cursor only after committing each update's effects.
  Replayed `/start` updates cannot relink or produce duplicate confirmations.
- Forecast checks run on startup/connection/changed rules and every six hours;
  failures retry after 15 minutes without treating missing data as a mismatch.
  Fetch in batches with timeouts; revalidate the saved revision before sending.
- Compare **qualifying dates**, not the shifting 14-day denominator or incidental
  hourly changes. Notify on first qualification, newly qualifying dates, or a
  changed rule that qualifies; require at least six hours between automatic
  messages per spot. A lost match re-arms only after a successful check, and
  never clears the last notification's cooldown. Persist these decisions.
- Add a closer-range confirmation once the earliest previously announced date
  enters the next 72 hours, if it still qualifies. Label farther dates as an
  early heads-up; include actual available-day coverage and source models.
- Persist a delivery attempt before sending. Telegram has no client idempotency
  key: a timeout/crash after acceptance can be ambiguous. Mark it **uncertain**
  and do not blindly retry it; expose that status. Retry explicit 429/5xx
  rejections with backoff, and disable delivery on 403. Do not claim exactly-once
  delivery or verified phone reception from an API success.
- `/stop` immediately disconnects every browser linked to that chat; browser
  disconnect removes its server alerts and pending link. Pending attempts must
  check current connection/rules before sending. `/status` and `/help` are
  idempotent command replies; no automatic test message on connect.
- Bound owners, enabled spots, request sizes, pending links and per-session
  mutation/test rates. Keep tokens, cookie values, Telegram IDs and full upstream
  error bodies out of logs and public health output.
- Missing bot configuration leaves the map and local alerts usable and displays
  an honest unavailable state. Document required Railway volume, always-on
  process, single replica, bot ownership and credential setup. Deployment and
  real-phone proof cannot be reported until credentials/recipient are present.

Plan accepted for implementation after these two passes. Review the finished
code against these cases and record any further refinements below.

### Pass 3 — browser proof and phone usability

The closed-tab integration passed. Reviewing the actual phone flow revealed that
Telegram often opens a new browser without the original owner cookie. Refined
the link design: a random, hashed, **read-only, seven-day** capability in the URL
fragment opens the spot's current settings in any browser. It cannot connect a
chat, change a monitor, enable notifications or silently save a preset. The
fragment is removed from the address bar and is never in navigation/referrer
requests. Deleted/disconnected spots revoke access. Anyone receiving a forwarded
link can view that spot and its conditions until it expires; no account control
is included. Existing owner-cookie links still work in the original browser.

Verification also found that synchronizing presets could cancel a queued
connection confirmation. Sync now cancels/re-evaluates only unsent **forecast**
messages, preserving connection/test replies. A successful sync schedules an
immediate check. Reconnecting explicitly clears previous uncertain attempts,
so an operator can re-arm after reconciling the Telegram chat.

## Implementation sequence and gates

1. Shared daylight forecast scoring + qualifying windows; retain existing tests.
2. Persistent owner/link/alert/delivery store and Telegram transport.
3. Background checking and bot commands, including durable retry/uncertain states.
4. Same-origin authenticated HTTP routes and production/development wiring.
5. Connection/status/sync controls and notification links in the existing SAM UI.
6. Deterministic server integration tests (real SQLite, fake external endpoints),
   browser smoke with a closed-tab/server-check case, complete unit/build gates.
7. Operational documentation, final review and commit. List any externally
   blocked activation steps precisely; never imply the live bot is already active.

## Completion evidence

- Implemented the shared daylight scorer and windows; persistent owner/link,
  snapshot, revision, scheduling, lease and delivery modules; Telegram transport,
  commands, HTTP routes, SAM controls and read-only phone links.
- `npm test`: **63 passed**, including timezone/daylight, optional period maximum,
  actual SQLite reopen, notification deduplication, genuine loss/recovery,
  ambiguous delivery/worker recovery, rate-limit backoff, blocked bot, expired
  one-use links, cross-origin/ownership rejection and scoped view access.
- `npm run build`: passed. `npm run smoke:telegram`: passed with a 390 px mobile
  viewport, closed Aer tab, server-only send, repeat suppression, fresh phone
  browser preview, preserved maximum-period setting, automatic edit sync and
  disconnect. `npm run smoke:saved`: passed. Screenshot visually inspected.
- Production Docker image builds successfully with the actual shared runtime
  imports. No Telegram token is included in repository files or browser assets.
- At the user's request, created **@AerSurfForecastBot** through the existing
  signed-in Beeper UI and official BotFather conversation. Outgoing setup messages
  verified through the unchanged read-only Beeper connection. The resulting token
  is private server configuration, not part of this plan or Git.
- Verified the bot identity with `getMe`. Configured a Railway `/data` volume and
  server-only variables; the existing service has one replica and sleeping off.
- Automated tests use a fake recipient and transport. Live evidence follows.

### Final usability check

The first requested test notification now works immediately after connection;
only earlier test requests consume its one-minute cooldown. Connection replies
do not block it. The regression test passes.

## Live activation evidence — 23 October 2026

- Implementation commits: `a37bbeb`, followed by `013f11a` for the immediate-test
  refinement. Latest Railway deployment `3460e5fa-c042-4654-a21b-6e5de11343f4`
  reports **SUCCESS** with `/data` mounted, one replica and application sleeping
  disabled. `/health` returns 200 and `/api/telegram/status` reports available.
- Bot identity confirmed as **@AerSurfForecastBot**; `/status`, `/stop` and `/help`
  appear in its command menu. The bot token remains server-only.
- Through the signed-in Beeper UI, connected a temporary browser session by
  sending its private `/start` link to the verified new bot. This exercised the
  live Telegram update poller, persisted owner/link and outgoing confirmation.
- Requested exactly one live test notification through Aer. Its full expected
  text arrived as an incoming message in the owner's Telegram conversation and
  was read back through the unchanged read-only Beeper API (message `12852`).
  This verifies Telegram-chat reception, not a banner or sound on a physical phone.
- Disconnected the temporary test session and confirmed zero monitoring spots
  for it. No user surf criteria were invented or uploaded. The user enables real
  monitoring by connecting from the browser holding their saved spots; automatic
  sync then copies the enabled snapshots to the server.
