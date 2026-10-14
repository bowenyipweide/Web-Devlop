const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, default: 'general' },
    channel: { type: String, enum: ['email', 'sms', 'whatsapp', 'inapp'] },
    title: { type: String, required: true },
    body: String,
    read: { type: Boolean, default: false },
    link: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);