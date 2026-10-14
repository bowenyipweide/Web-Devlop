const QRCode = require('qrcode');

// qrData is a signed-ish token. We compute a HMAC prefix so validation can be
// checked server-side even without DB load for label scanning, though the full
// validation always hits the database.
const crypto = require('crypto');

const signQr = (raw) => {
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(raw)
    .digest('hex')
    .slice(0, 16);
  return `${raw}|${sig}`;
};

const verifyQr = (qrData) => {
  const idx = qrData.lastIndexOf('|');
  if (idx < 0) return false;
  const raw = qrData.slice(0, idx);
  const sig = qrData.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(raw)
    .digest('hex')
    .slice(0, 16);
  return sig === expected;
};

const generateQrDataUrl = async (data) => {
  try {
    return await QRCode.toDataURL(data, { errorCorrectionLevel: 'H', width: 320, margin: 1 });
  } catch (e) {
    console.error('[qr] generation failed', e.message);
    return null;
  }
};

module.exports = { signQr, verifyQr, generateQrDataUrl };