const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { bookingLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/payment.controller');
const express = require('express');

router.post('/pay', protect, bookingLimiter, ctrl.pay);
router.post('/create-intent', protect, ctrl.createPaymentIntent);
router.post('/confirm-session', protect, ctrl.confirmSession);
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.webhook);

module.exports = router;