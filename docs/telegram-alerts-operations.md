# Running Telegram alerts

## Activation

1. Create a dedicated bot with Telegram's **@BotFather → /newbot**. Keep its
   token in server secrets. No bot token belongs in Git, a URL to Aer, a browser
   bundle, a screenshot, or the plan. A dedicated bot must have no other poller
   or webhook: Telegram does not allow `getUpdates` while a webhook is configured.
2. Run the production image with **Node 24**, **one replica** and an always-on
   process. Disable Railway Serverless/app sleeping for this service: forecast
   checks must run without incoming browser requests.
3. Attach a persistent Railway volume at `/data`. Configure:

   | Variable | Value |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | BotFather's secret token |
   | `TELEGRAM_BOT_USERNAME` | Bot username, with or without `@` |
   | `PUBLIC_APP_URL` | The canonical HTTPS app origin, without a path |
   | `AER_ALERT_DB` | `/data/aer-alerts.sqlite` |

   A database in the container's ephemeral filesystem loses monitoring rules on
   redeploy. Never attach two independent databases to the same bot. The database
   lease protects overlapping workers using the **same** volume. Do not enable
   multiple replicas as a scaling mechanism for this SQLite deployment.
4. Deploy the build. The server verifies the token's bot username with `getMe`
   before offering connection links. Incomplete configuration keeps the normal
   map and browser-only alerts usable; the Telegram panel says it is unavailable.
5. In **Saved spots → Telegram alerts → Connect Telegram**, open the bot and press
   **Start**. Return to Aer; the panel automatically syncs enabled saved-spot alerts.
   Save any edits to conditions, the day-count rules, look-ahead, or alert opt-in. Successful
   local saves/deletions sync automatically while connected. A failed sync is
   visible and can be retried with **Sync saved alerts**.
6. Request **Send test notification** and inspect Telegram on the actual phone.
   The app's “accepted by Telegram” status verifies API acceptance, not a banner
   on a particular phone. Phone notification permissions and muted chats matter.
7. Close every Aer tab, wait for a real qualifying forecast check, and verify the
   resulting message. This is the final live acceptance check; deterministic
   browser/server tests use a fake bot and do not establish real-phone delivery.

Local development needs the same environment variables, with an absolute local
database path and `PUBLIC_APP_URL=http://localhost:5173`. Provide variables to the
Node process; never expose the token through a Vite-prefixed variable. The Vite
server mounts the same routes and background implementation as production.

## Behaviour

- The server persists snapshots of **enabled** saved spots and their linked conditions independently of the
  browser. It does not need an open tab, an awake laptop, or the phone online to
  evaluate forecasts. Telegram delivery still requires connectivity.
- Link an offshore **Swell only** point to a nearshore **Wind only** point in
  the saved-spot editor. Linked points can have their own alerts disabled.
  Required settings still sync. Only days with overlapping matching hours count;
  each point must pass one of its own X-out-of-Y rows. The group uses the longest
  minimum window and shortest look-ahead. Missing dependencies prevent alerts.
  Historical charts remain specific to the selected point.
- Every selected condition must match: height range, minimum/optional maximum swell period,
  clockwise wind/swell source-direction ranges, maximum wind speed, consecutive
  samples. Day-count rules slide across the chosen look-ahead: for example,
  **2 matching days in any 4-day period**, or **4 in any 7-day period**. Any
  satisfied row triggers. Every period must fit wholly inside the look-ahead,
  which starts today in local time and defaults to 14 days (supported range 1–14).
  Preview, on-screen alerts and Telegram use the same evaluator. Messages identify
  the qualifying period dates and include matching days only from qualifying
  periods. Older snapshots without a look-ahead default to 14 days.
- Matches use 06:00 inclusive–18:00 exclusive at each spot. “Two hours” follows
  the existing scorer: two consecutive hourly samples. These are interpolated
  model outputs, not a guarantee of two hours of actual beach conditions.
- Checks run on connection/sync, then about every six hours. Temporary forecast
  failures retry after 15 minutes, preserving previous match/deduplication state.
  Up to 20 spots are checked in each cycle; a Telegram long poll takes at most
  25 seconds before a check. No-data days are not counted as qualifying, and the
  message states actual usable-day coverage rather than promising a full horizon.
- Notifications announce first qualification, a newly qualifying date or changed
  qualifying rules, with at least six hours between automatic messages per spot.
  A successful nonmatching forecast re-arms the alert. Loss of API data does not.
  Incidental changes to the first hourly window or the rolling denominator do not
  generate repeated messages. A further confirmation is sent as announced dates
  come within 72 hours and still qualify.
- Models are **Météo-France MFWAM primary swell + ECMWF IFS wind via Open-Meteo**,
  matching the browser forecast preview and alerts. MFWAM supplies up to 10
  forecast days; searches beyond that retain unknown dates rather than a GFS
  fallback. Swell's native three-hour output is interpolated to hourly samples
  by Open-Meteo; hourly wind still governs each matching window. The ECMWF
  combined-wave map is separate. Long-range forecasts are labelled estimates.
- New forecasts use the configured point's sea grid cell; these alerts do not
  claim to resolve a reef's exact wind shadow, refraction or breaking wave height.
- Multiple browsers can connect to the same chat. Each controls its own snapshot;
  identical spots in different browsers can produce separate alerts. `/status`
  reports the total; `/stop` disconnects all browsers for that chat.
- A notification's spot link also works in Telegram's fresh in-app browser. It
  grants read-only access to that spot and current conditions for seven days,
  revoked when the spot is removed or disconnected. Forwarding the link allows
  its recipient to view the same spot, never manage alerts. Opening it does not
  save or enable a monitor; **Save spot** deliberately creates a local copy.

## Reliability and recovery

`/health` checks the web process. In Saved spots, inspect connection, server spot
count, latest check, latest Telegram acceptance and any forecast/delivery warning.
Logs emit only generic event types, never bot tokens, cookies, private chat IDs,
link tokens or upstream bodies.

- **Retryable rejection:** a Telegram 429 or explicit 5xx rejection is queued with
  backoff (at least a minute, at most one day); repeated rejections eventually fail.
- **Uncertain delivery:** timeout, malformed response or crash after marking a
  send in progress could mean Telegram accepted the message. Do not retry blindly.
  The database holds that spot's pending notification and exposes an uncertain
  status. Inspect the Telegram chat, then disconnect/reconnect and sync to explicitly
  re-arm if needed. This can produce a new alert; the user has reconciled the old
  one. There is no exactly-once guarantee in Telegram's `sendMessage` interface.
- **Blocked bot:** a 403 disconnects associated monitors. Unblock the bot, reconnect
  from Aer and sync to resume.
- **Lost browser:** `/stop` still stops all messages. Reconnect in another browser
  and import/recreate the local spot presets. No silent bulk overwrite occurs on
  an initial empty/corrupt local-storage read.
- **Changed elsewhere:** a stale browser revision receives 409. Refresh connection
  status and deliberately sync the desired local snapshot. Merely refreshing
  status never overwrites server settings.
- **Restart:** SQLite retains connections, rules, notification state and Telegram's
  update cursor. A replacement worker may wait up to five minutes for an old lease.
  A graceful shutdown releases it immediately.

Back up the volume using Railway's volume backups or SQLite's online backup
mechanism. Do not copy only the live `.sqlite` file while ignoring its WAL.
Keep backups private: the database contains coordinates, saved rules and chat IDs.
Stop the process before restoring; restore the whole snapshot and resume only one
poller. A rollback to an older database can repeat previously delivered alerts.

## Verification

```sh
npm test
npm run build
npm run smoke:telegram
npm run smoke:saved
```

The Telegram smoke uses a real SQLite file and the actual browser controls,
closes the tab before driving a server check, verifies deduplication and restores
the alert's spot. No Telegram credentials or real recipients are used by tests.

References: [Telegram Bot API](https://core.telegram.org/bots/api),
[Telegram deep links](https://core.telegram.org/bots/features#deep-linking),
[Railway volumes](https://docs.railway.com/volumes),
[Railway Serverless](https://docs.railway.com/deployments/serverless).
