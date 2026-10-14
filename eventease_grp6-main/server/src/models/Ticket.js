const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const ticketSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    sessionId: mongoose.Schema.Types.ObjectId,
    sessionDate: Date,
    categoryName: String,
    tier: String,
    section: String,
    row: String,
    number: Number,
    seatLabel: String,
    price: Number,
    currency: { type: String, default: 'SGD' },
    status: {
      type: String,
      enum: ['active', 'used', 'refunded', 'transferred', 'resale_listed'],
      default: 'active',
      index: true,
    },
    qrData: String,
    qrCode: String,
    validatedAt: Date,
    entryCount: { type: Number, default: 0 },
    admissionCount: { type: Number, default: 1 },
    transfer: {
      toUser: mongoose.Schema.Types.ObjectId,
      code: String,
      claimedAt: Date,
    },
    resaleSeller: mongoose.Schema.Types.ObjectId,
    resalePrice: Number,
    audit: [{ at: Date, action: String, by: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true }
);

ticketSchema.pre('save', function (next) {
  if (!this.code) this.code = `EE-${nanoid(10).toUpperCase()}`;
  if (!this.qrData) this.qrData = `EVENTEASE:v1:${this.event}:${this.code}`;
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);