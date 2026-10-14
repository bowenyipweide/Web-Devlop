const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'notifications', 'accessibility'];
  const updates = {};
  for (const key of allowed) if (key in req.body) updates[key] = req.body[key];

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
  ok(res, { user: user.toSafeJSON() });
});

const applyOrganizer = asyncHandler(async (req, res) => {
  const { organization, organizerBio } = req.body;
  if (!organization) throw ApiError.badRequest('Organization name required');

  await User.findByIdAndUpdate(req.user._id, {
    role: 'organizer',
    organization,
    organizerBio,
    isApproved: false,
  });
  const user = await User.findById(req.user._id);
  ok(res, { user: user.toSafeJSON(), message: 'Organizer application submitted for admin approval.' });
});

const toggleFavorite = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const user = await User.findById(req.user._id);
  const idx = (user.favorites || []).map(String).indexOf(String(eventId));
  if (idx >= 0) user.favorites.splice(idx, 1);
  else user.favorites.push(eventId);
  await user.save();
  const evts = await require('../models/Event').find({ _id: { $in: user.favorites } }).select('title slug category image startDate venue');
  ok(res, { favorites: user.favorites, events: evts });
});

module.exports = { updateProfile, applyOrganizer, toggleFavorite };