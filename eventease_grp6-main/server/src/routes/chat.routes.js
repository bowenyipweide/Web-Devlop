const router = require('express').Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/chat.controller');

// optionalAuth lets the chat identify logged-in users so Ease can create
// bookings for them. Guests can still chat and ask questions.
router.post('/', optionalAuth, ctrl.chat);

module.exports = router;