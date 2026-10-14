const mongoose = require('mongoose');

// A redemption code created by an admin for a selected event. The voucher is
// "redeemed" by a customer (creating a VoucherRedemption entitlement) and the
// discount is then applied when they book that specific event.
//
// `event` is optional: when it is null the voucher is platform-wide and its
// entitlement applies to any booking. That is how loyalty gift cards are issued.
const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    title: { type: String, required: true },
    description: String,
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
    // 'admin' vouchers are published codes; 'loyalty' vouchers are minted when a
    // customer spends points on a gift card reward and have no redeemable code.
    source: { type: String, enum: ['admin', 'loyalty'], default: 'admin' },
    type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, required: true },
    maxDiscount: Number,
    minSpend: { type: Number, default: 0 },
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },
    startsAt: Date,
    expiresAt: Date,
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

voucherSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('Voucher', voucherSchema);