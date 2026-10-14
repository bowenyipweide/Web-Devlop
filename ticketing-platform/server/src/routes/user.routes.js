const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');

router.patch('/profile', protect, ctrl.updateProfile);
router.post('/apply-organizer', protect, ctrl.applyOrganizer);
router.post('/favorites/:eventId', protect, ctrl.toggleFavorite);

module.exports = router;