const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    reference: { type: String, required: true, unique: true },
    items: [
      {
        sessionId: mongoose.Schema.Types.ObjectId,
        sessionDate: Date,
        categoryId: String,
        categoryName: String,
        tier: String,
        unitPrice: Number,
        qty: Number,
        seats: [
          {
            seatId: mongoose.Schema.Types.ObjectId,
            section: String,
            row: String,
            number: Number,
            label: String,
          },
        ],
        bundleApplied: Boolean,
        lineTotal: Number,
      },
    ],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discountName: { type: String },
    total: { type: Number, required: true },
    currency: { type: String, default: 'SGD' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'refund_pending', 'refunded', 'expired'],
      default: 'pending',
      index: true,
    },
    payment: {
      provider: { type: String, enum: ['stripe', 'cash', 'paynow', 'simulated'], default: 'simulated' },
      method: String,
      intentId: String,
      status: { type: String, enum: ['pending', 'succeeded', 'failed', 'refunded'] },
    },
    // Every entitlement spent on this booking (event vouchers + loyalty gift
    // cards). `voucherRedemption` is the legacy single-ref field, kept in sync
    // with the first entry so older records and clients still resolve.
    voucherRedemptions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VoucherRedemption' }],
    voucherRedemption: { type: mongoose.Schema.Types.ObjectId, ref: 'VoucherRedemption' },
    tickets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }],
    holdExpiresAt: Date,
    holdTokens: [String],
    resaleRefund: { type: Number, default: 0 },
    cancelReason: String,
    audit: [
      {
        at: { type: Date, default: Date.now },
        action: String,
        by: mongoose.Schema.Types.ObjectId,
        note: String,
      },
    ],
  },
  { timestamps: true }
);

bookingSchema.index({ event: 1, status: 1, createdAt: -1 });
bookingSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);