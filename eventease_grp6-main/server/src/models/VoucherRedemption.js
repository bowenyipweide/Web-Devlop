const mongoose = require('mongoose');

// Links a customer to a redeemed voucher code and the event the discount is
// valid for. `used` flips to true once the entitlement is applied to a booking
// that has been paid for; an expired/cancelled booking releases it again.
// A null `event` means the entitlement is platform-wide (a loyalty gift card)
// and applies to the customer's next booking on any event.
const voucherRedemptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
    used: { type: Boolean, default: false },
    usedBooking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    redeemedAt: { type: Date, default: Date.now },
    usedAt: Date,
  },
  { timestamps: true }
);

voucherRedemptionSchema.index({ user: 1, event: 1, used: 1 });

module.exports = mongoose.model('VoucherRedemption', voucherRedemptionSchema);