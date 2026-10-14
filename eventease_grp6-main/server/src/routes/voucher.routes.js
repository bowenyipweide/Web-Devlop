const router = require('express').Router();
const { protect, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/voucher.controller');

router.get('/mine', protect, ctrl.myRedemptions);
router.get('/available', protect, ctrl.available);
router.post('/redeem', protect, ctrl.redeem);

// Admin management of voucher redemption codes.
router.get('/', protect, requireRole('admin'), ctrl.listAll);
router.post('/', protect, requireRole('admin'), ctrl.create);

module.exports = router;