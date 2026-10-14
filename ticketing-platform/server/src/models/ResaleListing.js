const mongoose = require('mongoose');

const resaleListingSchema = new mongoose.Schema(
  {
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    fee: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['listed', 'reserved', 'sold', 'cancelled'],
      default: 'listed',
      index: true,
    },
    buyer: mongoose.Schema.Types.ObjectId,
    reservedUntil: Date,
    soldAt: Date,
  },
  { timestamps: true }
);

resaleListingSchema.index({ event: 1, status: 1, price: 1 });

module.exports = mongoose.model('ResaleListing', resaleListingSchema);