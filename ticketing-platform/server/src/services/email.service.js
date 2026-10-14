const { getTransporter, SMTP_TIMEOUTS } = require('../config/email');

const EMAIL_FROM = process.env.SMTP_FROM || 'EventEase <eventease.notify@gmail.com>';

// Hard ceiling on the SMTP round trip. `finalizePayment` awaits this before it
// responds, so it must always settle: without it a stalled mail server keeps the
// buyer's browser on "Confirming your payment…" long after the money moved.
const EMAIL_DEADLINE_MS = Number(process.env.EMAIL_DEADLINE_MS) || 15000;

const withDeadline = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`SMTP send exceeded ${ms}ms`)),
        ms
      );
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);

let emailAvailable = false;

const setEmailAvailable = (v) => { emailAvailable = v; };

const sendMail = async ({ to, subject, html, text }) => {
  if (!emailAvailable) {
    console.log(`[email:log] "${subject}" -> ${to} (SMTP unavailable — message not sent)`);
    console.log(`[email:log] body: ${text || html}`);
    return null;
  }
  try {
    const transporter = getTransporter();
    const mail = await withDeadline(
      transporter.sendMail({ from: EMAIL_FROM, to, subject, html: html || text, text }),
      Math.min(EMAIL_DEADLINE_MS, SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.socketTimeout)
    );
    console.log(`[email] sent "${subject}" -> ${to} (${mail.messageId})`);
    return mail;
  } catch (err) {
    console.error(`[email] failed to send "${subject}" -> ${to}:`, err.message);
    return null;
  }
};

const renderBookingConfirmation = ({ user, booking, event, tickets }) => {
  const items = booking.items
    .map(
      (i) =>
        `<tr><td>${i.categoryName}${i.seats?.length ? ` (${i.seats.map((s) => s.label).join(', ')})` : ''}</td><td>${i.sessionDate ? new Date(i.sessionDate).toLocaleDateString() : ''}</td><td>${i.qty}</td><td>${i.unitPrice}</td><td>${i.lineTotal}</td></tr>`
    )
    .join('');
  const ticketLinks = (tickets || [])
    .map((t) => `<li>${t.seatLabel || t.categoryName}${t.sessionDate ? ` · ${new Date(t.sessionDate).toLocaleDateString()}` : ''} – <a href="${process.env.CLIENT_URL}/account?ticket=${t.code}">View e-ticket ${t.code}</a></li>`)
    .join('');
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:auto">
    <h2 style="color:#7c3aed">EventEase 🎟</h2>
    <p>Hi <strong>${user.name}</strong>, thanks for booking with EventEase!</p>
    <h3>${event.title}</h3>
    <p><strong>Event runs:</strong> ${new Date(event.startDate).toLocaleString()} – ${new Date(event.endDate || event.startDate).toLocaleString()}<br/><strong>Venue:</strong> ${event.venue.name}, ${event.venue.city}</p>
    <p><strong>Booking ref:</strong> ${booking.reference}</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><th>Category</th><th>Date</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${items}</table>
    <p>Subtotal ${booking.subtotal} · Discount -${booking.discount} · <strong>Total ${booking.currency} ${booking.total}</strong></p>
    <p>Your e-tickets (QR validated at entry):</p>
    <ul>${ticketLinks || '<li>Tickets will appear shortly.</li>'}</ul>
    <p style="color:#666">Need help? Reply to this email or visit our support page.</p>
  </div>`;
};

const renderTicket = (ticket, event, qrDataUrl) => `
  <div style="font-family:sans-serif;max-width:420px;border:1px solid #ddd;border-radius:12px;padding:16px;margin:auto">
    <img src="${qrDataUrl}" alt="QR code" width="180" style="display:block;margin:0 auto"/>
    <h3 style="text-align:center">${event.title}</h3>
    <p><strong>${ticket.sessionDate ? new Date(ticket.sessionDate).toLocaleString() : new Date(event.startDate).toLocaleString()}</strong><br/>${event.venue.name}, ${event.venue.city}</p>
    <p><strong>Ticket:</strong> ${ticket.code}<br/>
       <strong>Seat:</strong> ${ticket.seatLabel || 'General admission'}<br/>
       <strong>Category:</strong> ${ticket.categoryName || 'Standard'}</p>
    <p style="text-align:center;color:#666;font-size:12px">Gate validates QR once. Authorised entry only.</p>
  </div>`;

module.exports = { sendMail, renderBookingConfirmation, renderTicket, setEmailAvailable };
