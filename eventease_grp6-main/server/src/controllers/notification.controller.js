const Notification = require('../models/Notification');
const { asyncHandler, ok } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  ok(res, { notifications });
});

const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await Notification.updateOne({ _id: id, user: req.user._id }, { read: true });
  ok(res, { ok: true });
});

const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id }, { read: true });
  ok(res, { ok: true });
});

module.exports = { list, markRead, markAllRead };