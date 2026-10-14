const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/notification.controller');

router.get('/', protect, ctrl.list);
router.patch('/:id/read', protect, ctrl.markRead);
router.patch('/read-all', protect, ctrl.markAllRead);

module.exports = router;