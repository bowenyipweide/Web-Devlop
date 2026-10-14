const nodemailer = require('nodemailer');

// `sendMail` is awaited inside the payment finalisation path, so a blackholed
// SMTP host would otherwise hold the HTTP response open for nodemailer's
// library defaults (2 min connect, 30 s greeting, 10 min socket). Cap them so a
// dead mail server degrades to "email not sent" instead of a stuck checkout.
const SMTP_TIMEOUTS = {
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 5000,
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 5000,
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 10000,
};

let transporter = null;

const createTransporter = () => {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    ...SMTP_TIMEOUTS,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

const getTransporter = () => {
  if (!transporter) createTransporter();
  return transporter;
};

const verifyEmailConfig = async () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[email] SMTP not configured — emails will be logged to console instead of sent');
    return false;
  }
  try {
    const t = getTransporter();
    await t.verify();
    console.log('[email] SMTP connection verified successfully');
    return true;
  } catch (err) {
    console.error('[email] SMTP connection failed:', err.message);
    console.error('[email] Emails will NOT be sent. Please check SMTP_USER and SMTP_PASS in .env');
    console.error('[email] For Gmail, use an App Password (https://myaccount.google.com/apppasswords)');
    return false;
  }
};

module.exports = { createTransporter, getTransporter, verifyEmailConfig, SMTP_TIMEOUTS };
