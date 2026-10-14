const router = require('express').Router();
const { protect, optionalAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/event.controller');

// public
router.get('/', optionalAuth, ctrl.listEvents);
router.get('/categories', ctrl.categories);
router.get('/:slug', optionalAuth, ctrl.getEvent);

// organizer
router.get('/manage/list', protect, requireRole('organizer', 'admin'), ctrl.myEvents);
router.get('/manage/:id', protect, requireRole('organizer', 'admin'), ctrl.getManageEvent);
router.post('/', protect, requireRole('organizer', 'admin'), ctrl.createEvent);
router.patch('/manage/:id', protect, requireRole('organizer', 'admin'), ctrl.updateEvent);
router.post('/manage/:id/submit', protect, requireRole('organizer', 'admin'), ctrl.submitForApproval);
router.post('/manage/:id/cancel', protect, requireRole('organizer', 'admin'), ctrl.cancelEvent);

module.exports = router;