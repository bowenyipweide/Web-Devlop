const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    categoryId: { type: String, required: true },
    categoryName: { type: String, required: true },
    tier: { type: String, enum: ['vip', 'standard', 'concession'], default: 'standard' },
    price: { type: Number, required: true },
    section: { type: String, required: true },
    row: { type: String, required: true },
    number: { type: Number, required: true },
    status: {
      type: String,
      enum: ['available', 'held', 'booked'],
      default: 'available',
      index: true,
    },
    heldUntil: Date,
    heldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    holdToken: String,
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    accessibility: { wheelchair: { type: Boolean, default: false } },
  },
  { timestamps: true }
);

seatSchema.index({ event: 1, session: 1, section: 1, row: 1, number: 1 }, { unique: true });
seatSchema.index({ event: 1, session: 1, status: 1 });

module.exports = mongoose.model('Seat', seatSchema);