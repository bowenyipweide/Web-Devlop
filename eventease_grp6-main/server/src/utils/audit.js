const AuditLog = require('../models/AuditLog');

const audit = async (req, { action, targetType, targetId, note }) => {
  try {
    await AuditLog.create({
      actor: req.user ? req.user._id : undefined,
      actorRole: req.user ? req.user.role : 'guest',
      action,
      targetType,
      targetId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      meta: note ? { note } : undefined,
    });
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
};

module.exports = { audit };