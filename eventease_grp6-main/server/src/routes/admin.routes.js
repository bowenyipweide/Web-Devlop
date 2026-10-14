const router = require('express').Router();
const { protect, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/admin.controller');

router.use(protect, requireRole('admin'));

router.get('/stats', ctrl.platformStats);
router.get('/users', ctrl.listUsers);
router.patch('/users/:id', ctrl.updateUserStatus);
router.get('/moderation', ctrl.moderationQueue);
router.post('/events/:id/review', ctrl.reviewEvent);
router.get('/refunds', ctrl.listRefundRequests);
router.patch('/refunds/:id', ctrl.reviewRefund);
router.get('/fraud', ctrl.fraudMonitor);

module.exports = router;