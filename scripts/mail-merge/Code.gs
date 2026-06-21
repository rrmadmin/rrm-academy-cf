/**
 * RRM Academy — Lane A relationship mail-merge.
 * Sends INDIVIDUAL personal-style emails from community@rrmacademy.org via Google
 * Workspace, so they land in Gmail Primary (not the SES newsletter / Promotions path).
 * See docs/email-sending-playbook.md.
 *
 * SETUP (once): see README.md in this folder.
 * RUN: Recipients sheet -> RRM Mail Merge menu -> "Send test to me" -> "Send to all pending".
 *
 * The account running this script MUST have community@rrmacademy.org configured as a
 * "Send mail as" alias (Gmail Settings -> Accounts -> Send mail as). It already is on
 * the Virtual Assistant account.
 */

// ----- EDIT PER CAMPAIGN (the /stuc-comms skill fills these) -----
var FROM_ALIAS = 'community@rrmacademy.org';
var FROM_NAME  = 'Dr. Naomi Whittaker';
var REPLY_TO   = 'community@rrmacademy.org';
var TEST_EMAIL = 'brianrwhittaker@gmail.com';   // "Send test to me" target

var SUBJECT = 'a few new recordings I wanted to share';

// Use {{FirstName}} for the merge field (falls back to "friend" when blank).
// Keep it personal: short paragraphs, plain text links, NO styled button, NO images.
function buildBodyHtml(firstName) {
  var name = firstName && firstName.trim() ? firstName.trim() : 'friend';
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;">',
    '<p>Hi ' + escapeHtml(name) + ',</p>',
    '<p>A quick note from the Save the Uterus Club. Your membership includes a small library of recorded sessions, and I wanted to make sure you know they are all there waiting for you whenever you want them.</p>',
    '<p>The newest is <b>Cycle Charting &amp; Whole-Body Wellness</b> with Rebecca Vavilov of OVA Wellness, a warm, practical walk through reading your cycle and the daily foundations that support healthy hormones. You can ' +
      '<a href="https://rrmacademy.org/courses">see it and the rest of the member courses here</a>.</p>',
    '<p>One small favor: add this address to your contacts so these land in your main inbox instead of a promotions folder.</p>',
    '<p>Warmly,<br>Dr. Whittaker</p>',
    '<p style="font-size:12px;color:#888;margin-top:18px;">Save the Uterus Club, RRM Academy. 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011. Just reply if you would like to stop receiving these.</p>',
    '</div>'
  ].join('\n');
}
// ----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RRM Mail Merge')
    .addItem('Send test to me', 'sendTest')
    .addSeparator()
    .addItem('Send to all pending', 'sendAll')
    .addItem('Show send-as check', 'checkAlias')
    .addToUi();
}

function checkAlias() {
  var aliases = GmailApp.getAliases();
  var ok = aliases.indexOf(FROM_ALIAS) !== -1;
  SpreadsheetApp.getUi().alert(
    (ok ? 'OK: ' : 'MISSING: ') + FROM_ALIAS + ' as a send-as alias.\n\nAvailable aliases:\n' +
    (aliases.length ? aliases.join('\n') : '(none — add it in Gmail Settings > Accounts > Send mail as)')
  );
}

function sendTest() {
  var html = buildBodyHtml('Brian');
  _send(TEST_EMAIL, '[TEST] ' + SUBJECT, html);
  SpreadsheetApp.getUi().alert('Test sent to ' + TEST_EMAIL + '. Check the Primary tab.');
}

function sendAll() {
  var sheet = _recipientsSheet();
  var data = sheet.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var iEmail = head.indexOf('email');
  var iFirst = head.indexOf('firstname');
  var iStatus = head.indexOf('status');
  var iError = head.indexOf('error');
  if (iEmail < 0 || iStatus < 0) {
    SpreadsheetApp.getUi().alert('Recipients sheet needs at least "Email" and "Status" columns.');
    return;
  }
  if (GmailApp.getAliases().indexOf(FROM_ALIAS) === -1) {
    SpreadsheetApp.getUi().alert('Cannot send: ' + FROM_ALIAS + ' is not a send-as alias on this account.');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var pending = data.slice(1).filter(function (r) { return r[iEmail] && !r[iStatus]; }).length;
  if (pending === 0) { ui.alert('No pending recipients (every row already has a Status).'); return; }
  if (ui.alert('Send to ' + pending + ' pending recipient(s) from ' + FROM_ALIAS + '?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var sent = 0, failed = 0;
  for (var row = 1; row < data.length; row++) {
    var email = String(data[row][iEmail] || '').trim();
    if (!email || data[row][iStatus]) continue;            // skip blanks + already-sent (idempotent)
    var first = iFirst >= 0 ? data[row][iFirst] : '';
    try {
      _send(email, SUBJECT, buildBodyHtml(first));
      sheet.getRange(row + 1, iStatus + 1).setValue(new Date());
      if (iError >= 0) sheet.getRange(row + 1, iError + 1).setValue('');
      sent++;
      Utilities.sleep(1200);                               // gentle pacing, looks 1:1
    } catch (e) {
      failed++;
      if (iError >= 0) sheet.getRange(row + 1, iError + 1).setValue(String(e));
    }
  }
  ui.alert('Done. Sent ' + sent + ', failed ' + failed + '. Failed rows keep a blank Status so a re-run retries them.');
}

function _send(to, subject, html) {
  GmailApp.sendEmail(to, subject, html.replace(/<[^>]+>/g, ' '), {
    htmlBody: html,
    name: FROM_NAME,
    from: FROM_ALIAS,
    replyTo: REPLY_TO
  });
}

function _recipientsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Recipients') || ss.getSheets()[0];
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
