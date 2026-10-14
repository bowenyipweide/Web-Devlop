const mongoose = require('mongoose');

// Records a customer spending loyalty points on a marketplace reward.
const redemptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reward: { type: mongoose.Schema.Types.ObjectId, ref: 'LoyaltyReward', required: true },
    rewardName: String,
    rewardImage: String,
    rewardCategory: String,
    pointsSpent: { type: Number, required: true },
    // Set when the reward was a gift card: the platform-wide credit that was
    // minted for the customer in exchange for the points.
    giftCardCode: String,
    giftCardValue: Number,
    giftCardEntitlement: { type: mongoose.Schema.Types.ObjectId, ref: 'VoucherRedemption' },
    status: { type: String, enum: ['completed', 'cancelled'], default: 'completed' },
    redeemedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

redemptionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Redemption', redemptionSchema);