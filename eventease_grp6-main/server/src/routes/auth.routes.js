const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/me', protect, ctrl.me);
router.post('/change-password', protect, ctrl.changePassword);

module.exports = router;