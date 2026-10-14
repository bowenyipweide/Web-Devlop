const Notification = require('../models/Notification');
const emailService = require('./email.service');

class NotificationService {
  async persist(userId, { kind, channel = 'inapp', title, body, link, meta }) {
    try {
      return await Notification.create({ user: userId, kind, channel, title, body, link, meta });
    } catch (e) {
      console.error('[notify] persist failed', e.message);
      return null;
    }
  }

  async notify(user, { kind, subject, titles, body, html, link }) {
    if (!user) return;
    // Channels user enabled. Email is default; sms/whatsapp are simulated.
    const prefs = user.notifications || { email: true, sms: false, whatsapp: false };
    const title = titles && titles.email ? titles.email : subject;
    await this.persist(user._id, { kind, channel: 'inapp', title, body, link });

    if (!user.email) return;
    if (prefs.email) {
      try {
        await emailService.sendMail({ to: user.email, subject, html, text: body });
      } catch (e) {
        console.error('[notify] email failed', e.message);
      }
    }
    if (prefs.sms) console.log(`[notify][sms] -> ${user.email}: ${subject}`);
    if (prefs.whatsapp) console.log(`[notify][whatsapp] -> ${user.email}: ${subject}`);
  }
}

module.exports = new NotificationService();