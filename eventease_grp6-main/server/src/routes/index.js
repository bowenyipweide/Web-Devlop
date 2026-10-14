const router = require('express').Router();

const auth = require('./auth.routes');
const users = require('./user.routes');
const events = require('./event.routes');
const bookings = require('./booking.routes');
const payments = require('./payment.routes');
const tickets = require('./ticket.routes');
const marketplace = require('./marketplace.routes');
const vouchers = require('./voucher.routes');
const organizer = require('./organizer.routes');
const admin = require('./admin.routes');
const notifications = require('./notification.routes');
const chat = require('./chat.routes');

router.use('/auth', auth);
router.use('/users', users);
router.use('/events', events);
router.use('/bookings', bookings);
router.use('/payments', payments);
router.use('/tickets', tickets);
router.use('/marketplace', marketplace);
router.use('/vouchers', vouchers);
router.use('/organizer', organizer);
router.use('/admin', admin);
router.use('/notifications', notifications);
router.use('/chat', chat);

module.exports = router;