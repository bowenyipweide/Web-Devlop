const mongoose = require('mongoose');

// A purchasable reward in the customer loyalty marketplace. Customers spend
// their loyaltyPoints to redeem these items.
const loyaltyRewardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    image: String,
    pointsRequired: { type: Number, required: true, min: 1 },
    // Monetary credit granted for `gift_card` rewards, in the booking currency.
    // Ignored for physical merchandise and upgrades.
    value: { type: Number, min: 0 },
    stock: { type: Number, default: 0 },
    redeemedCount: { type: Number, default: 0 },
    category: { type: String, default: 'merchandise' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

loyaltyRewardSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    name: this.name,
    description: this.description,
    image: this.image,
    pointsRequired: this.pointsRequired,
    value: this.value,
    isGiftCard: this.category === 'gift_card',
    stock: this.stock,
    redeemedCount: this.redeemedCount,
    remaining: Math.max(0, this.stock - this.redeemedCount),
    category: this.category,
  };
};

module.exports = mongoose.model('LoyaltyReward', loyaltyRewardSchema);