const LoyaltyReward = require('../models/LoyaltyReward');
const Redemption = require('../models/Redemption');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');
const { issueGiftCard } = require('./voucher.controller');
const { audit } = require('../utils/audit');

const listRewards = asyncHandler(async (req, res) => {
  const rewards = await LoyaltyReward.find({ active: true }).sort({ pointsRequired: 1 });
  ok(res, { rewards: rewards.map((r) => r.toPublicJSON()) });
});

const myRedemptions = asyncHandler(async (req, res) => {
  const redemptions = await Redemption.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate('reward', 'name pointsRequired');
  ok(res, { redemptions });
});

// Spend loyalty points on a marketplace reward. Stock and points are consumed
// atomically so two concurrent requests cannot over-redeem.
const redeem = asyncHandler(async (req, res) => {
  const { rewardId } = req.body;
  if (!rewardId) throw ApiError.badRequest('Reward required');

  const reward = await LoyaltyReward.findById(rewardId);
  if (!reward || !reward.active) throw ApiError.notFound('Reward not found');

  const user = await User.findById(req.user._id);
  if ((user.loyaltyPoints || 0) < reward.pointsRequired)
    throw ApiError.badRequest('Not enough loyalty points for this reward');
  if (reward.stock <= reward.redeemedCount)
    throw ApiError.badRequest('This reward is out of stock');

  const claimed = await LoyaltyReward.findOneAndUpdate(
    { _id: reward._id, $expr: { $lt: ['$redeemedCount', '$stock'] } },
    { $inc: { redeemedCount: 1 } },
    { new: false }
  );
  if (!claimed) throw ApiError.badRequest('This reward is out of stock');

  await User.updateOne({ _id: user._id }, { $inc: { loyaltyPoints: -reward.pointsRequired } });

  // Gift card rewards convert the points spent into real booking credit. The
  // customer gets a platform-wide voucher entitlement that applies automatically
  // to their next booking on any event. Physical rewards have nothing to grant.
  let giftCard = null;
  if (reward.category === 'gift_card') {
    giftCard = await issueGiftCard({
      userId: user._id,
      title: reward.name,
      value: reward.value,
      description: reward.description,
    });
  }

  const redemption = await Redemption.create({
    user: user._id,
    reward: reward._id,
    rewardName: reward.name,
    rewardImage: reward.image,
    rewardCategory: reward.category,
    pointsSpent: reward.pointsRequired,
    status: 'completed',
    giftCardCode: giftCard ? giftCard.voucher.code : undefined,
    giftCardValue: giftCard ? giftCard.voucher.value : undefined,
    giftCardEntitlement: giftCard ? giftCard.redemption._id : undefined,
  });

  await notificationService.notify(user, {
    kind: 'reward.redeemed',
    subject: 'EventEase · Reward redeemed',
    title: `Reward redeemed: ${reward.name}`,
    body: giftCard
      ? `You redeemed "${reward.name}" with ${reward.pointsRequired} loyalty points. ${giftCard.voucher.value} credit added — it applies automatically to your next booking.`
      : `You redeemed "${reward.name}" with ${reward.pointsRequired} loyalty points.`,
    link: '/account#marketplace',
  });

  await audit(req, { action: 'loyalty.redeem', targetType: 'LoyaltyReward', targetId: reward._id, note: giftCard ? `${reward.pointsRequired} pts → ${reward.name} (${giftCard.voucher.code})` : `${reward.pointsRequired} pts → ${reward.name}` });

  const fresh = await User.findById(user._id);
  ok(res, {
    redemption,
    loyaltyPoints: fresh.loyaltyPoints,
    giftCard: giftCard
      ? { code: giftCard.voucher.code, value: giftCard.voucher.value, expiresAt: giftCard.voucher.expiresAt }
      : null,
  }, 201);
});

// ---- Admin management of the loyalty marketplace catalog ----
const adminListRewards = asyncHandler(async (req, res) => {
  const rewards = await LoyaltyReward.find().sort({ createdAt: -1 });
  ok(res, { rewards });
});

const adminCreateReward = asyncHandler(async (req, res) => {
  const { name, description, image, pointsRequired, stock, category, value, active } = req.body;
  if (!name || !name.trim()) throw ApiError.badRequest('Reward name is required');
  const pts = Number(pointsRequired);
  if (!Number.isFinite(pts) || pts < 1) throw ApiError.badRequest('Points required must be at least 1');
  // Gift cards are worthless without an amount, so refuse to create them blind.
  if (category === 'gift_card' && !(Number(value) > 0))
    throw ApiError.badRequest('A gift card reward needs a monetary value');

  const reward = await LoyaltyReward.create({
    name: name.trim(),
    description,
    image,
    pointsRequired: pts,
    value: value != null ? Number(value) : undefined,
    stock: Number.isFinite(Number(stock)) ? Math.max(0, Number(stock)) : 0,
    category: category || 'merchandise',
    active: active !== false,
  });

  await audit(req, { action: 'loyalty.reward.create', targetType: 'LoyaltyReward', targetId: reward._id, note: `${reward.name} · ${reward.pointsRequired} pts` });
  ok(res, { reward }, 201);
});

const adminUpdateReward = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reward = await LoyaltyReward.findById(id);
  if (!reward) throw ApiError.notFound('Reward not found');

  const { name, description, image, pointsRequired, stock, category, value, active } = req.body;
  if (name !== undefined) reward.name = String(name).trim() || reward.name;
  if (description !== undefined) reward.description = description;
  if (image !== undefined) reward.image = image;
  if (pointsRequired !== undefined) {
    const pts = Number(pointsRequired);
    if (!Number.isFinite(pts) || pts < 1) throw ApiError.badRequest('Points required must be at least 1');
    reward.pointsRequired = pts;
  }
  if (value !== undefined) reward.value = value == null ? undefined : Number(value);
  if (stock !== undefined) reward.stock = Math.max(0, Number(stock) || 0);
  if (category !== undefined) reward.category = category;
  if (active !== undefined) reward.active = !!active;
  // Validate the pair only after both fields are settled, so a category or value
  // edit in the same request can't leave a gift card with no amount.
  if (reward.category === 'gift_card' && !(reward.value > 0))
    throw ApiError.badRequest('A gift card reward needs a monetary value');
  await reward.save();

  await audit(req, { action: 'loyalty.reward.update', targetType: 'LoyaltyReward', targetId: reward._id, note: reward.name });
  ok(res, { reward });
});

const adminDeleteReward = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reward = await LoyaltyReward.findById(id);
  if (!reward) throw ApiError.notFound('Reward not found');

  await audit(req, { action: 'loyalty.reward.delete', targetType: 'LoyaltyReward', targetId: reward._id, note: reward.name });
  await LoyaltyReward.deleteOne({ _id: reward._id });
  ok(res, { message: 'Reward deleted' });
});

module.exports = {
  listRewards,
  myRedemptions,
  redeem,
  adminListRewards,
  adminCreateReward,
  adminUpdateReward,
  adminDeleteReward,
};