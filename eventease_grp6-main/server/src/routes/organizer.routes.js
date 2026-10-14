const router = require('express').Router();
const { protect, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/organizer.controller');

router.get('/dashboard', protect, requireRole('organizer', 'admin'), ctrl.dashboard);
router.get('/analytics/sales', protect, requireRole('organizer', 'admin'), ctrl.salesAnalytics);
router.get('/analytics/forecast', protect, requireRole('organizer', 'admin'), ctrl.demandForecast);
router.get('/analytics/engagement', protect, requireRole('organizer', 'admin'), ctrl.engagement);

module.exports = router;