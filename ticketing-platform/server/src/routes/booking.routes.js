const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { bookingLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/booking.controller');

router.post('/', protect, bookingLimiter, ctrl.createBooking);
router.get('/', protect, ctrl.myBookings);
router.get('/:id', protect, ctrl.getMyBooking);
router.post('/:id/entitlements', protect, ctrl.applyBookingEntitlements);
router.post('/:id/cancel', protect, ctrl.cancelBooking);

module.exports = router;