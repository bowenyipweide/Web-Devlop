const router = require('express').Router();
const { protect, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/ticket.controller');

router.get('/', protect, ctrl.myTickets);
router.get('/resale/market', ctrl.resaleMarket);
router.get('/resale/mine', protect, ctrl.myResale);
router.get('/:code', protect, ctrl.detail);
router.post('/validate', protect, requireRole('organizer', 'admin'), ctrl.validate);
router.post('/:code/transfer', protect, ctrl.initiateTransfer);
router.post('/transfer/:transferCode/claim', protect, ctrl.claimTransfer);
router.post('/resale/list', protect, ctrl.listOnResale);
router.post('/resale/:listingId/buy', protect, ctrl.buyResale);
router.delete('/resale/:id', protect, ctrl.cancelListing);

module.exports = router;