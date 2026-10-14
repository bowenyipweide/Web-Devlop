const router = require('express').Router();
const { protect, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/marketplace.controller');

// Public catalog + authenticated redemption endpoints.
router.get('/rewards', protect, ctrl.listRewards);
router.get('/redemptions', protect, ctrl.myRedemptions);
router.post('/redeem', protect, ctrl.redeem);

// Admin management of the loyalty marketplace catalog.
router.get('/admin/rewards', protect, requireRole('admin'), ctrl.adminListRewards);
router.post('/admin/rewards', protect, requireRole('admin'), ctrl.adminCreateReward);
router.patch('/admin/rewards/:id', protect, requireRole('admin'), ctrl.adminUpdateReward);
router.delete('/admin/rewards/:id', protect, requireRole('admin'), ctrl.adminDeleteReward);

module.exports = router;