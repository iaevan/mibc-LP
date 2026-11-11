// The orientation invitation sent with each ticket. [name] is replaced per person.

export const SUBJECT = 'Welcome to NSU MIBC: General Member Orientation, Recruitment 10.0';

const FORM_URL = 'https://docs.google.com/forms/d/1tUe6KVa4EDVuNoHbL5fDDkyo-8WZYqp2xKIaTKkv2Xo/viewform?edit_requested=true';

const escapeHtml = text => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function ticketFileName(name) {
  const safe = String(name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Ticket';
  return `MIBC-Orientation-Ticket-${safe}.jpg`;
}

export function renderEmail(name) {
  const text = `Dear ${name},

Congratulations on becoming a General Member of North South University's Marketing & International Business Club, NSU MIBC! We're thrilled to have you on board. As you step into this new role, we're excited to have you join us and look forward to seeing the ideas, perspectives, and contributions you'll bring to the club.

We warmly invite you to attend the General Member Orientation Ceremony for Recruitment 10.0. Get to know the people behind MIBC, meet your fellow recruits, and find out more about what being a part of MIBC has in store for you.

Orientation Details:
Date: 12th November, 2026
Time: 6PM
Venue: Audi 801

Your entry ticket has been attached to this email. Please bring it along on the day of the orientation.

We would also like all new recruits to complete the Club T-shirt Form through the link below. Please make sure to submit your responses so we can proceed with the T-shirt arrangements.

T-shirt Form: ${FORM_URL}

We're looking forward to having you all with us and making this a memorable start to your time at MIBC!

Please note that new recruits are requested to refrain from visiting the MIB Club Room until the General Member Orientation Ceremony. You will be officially welcomed into the club during the orientation, and we look forward to seeing you there!

Warm regards,
NSU MIBC
`;

  const p = 'margin:0 0 16px;';
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f1f1f;">
<p style="${p}">Dear ${escapeHtml(name)},</p>
<p style="${p}">Congratulations on becoming a General Member of North South University's Marketing &amp; International Business Club, NSU MIBC! We're thrilled to have you on board. As you step into this new role, we're excited to have you join us and look forward to seeing the ideas, perspectives, and contributions you'll bring to the club.</p>
<p style="${p}">We warmly invite you to attend the General Member Orientation Ceremony for Recruitment 10.0. Get to know the people behind MIBC, meet your fellow recruits, and find out more about what being a part of MIBC has in store for you.</p>
<p style="${p}"><strong>Orientation Details:</strong><br>Date: 12th November, 2026<br>Time: 6PM<br>Venue: Audi 801</p>
<p style="${p}">Your entry ticket has been attached to this email. Please bring it along on the day of the orientation.</p>
<p style="${p}">We would also like all new recruits to complete the Club T-shirt Form through the link below. Please make sure to submit your responses so we can proceed with the T-shirt arrangements.</p>
<p style="${p}">T-shirt Form: <a href="${FORM_URL}" style="color:#b0182a;">${FORM_URL}</a></p>
<p style="${p}">We're looking forward to having you all with us and making this a memorable start to your time at MIBC!</p>
<p style="${p}">Please note that new recruits are requested to refrain from visiting the MIB Club Room until the General Member Orientation Ceremony. You will be officially welcomed into the club during the orientation, and we look forward to seeing you there!</p>
<p style="margin:0;">Warm regards,<br>NSU MIBC</p>
</div>
</body></html>`;

  return { subject: SUBJECT, text, html };
}
