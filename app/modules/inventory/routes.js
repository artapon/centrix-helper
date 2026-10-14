const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const inventoryController = require('./controllers/inventory.controller');

router.get('/inventory/tracking', asyncHandler(inventoryController.index));
router.get('/inventory/available-items', asyncHandler(inventoryController.availableitems));
router.get('/inventory/item-masters', asyncHandler(inventoryController.interfaceItemmasters));
router.get('/inventory/vendors', asyncHandler(inventoryController.interfaceVendors));
router.get('/inventory/goods-receipts', asyncHandler(inventoryController.interfaceGR));
router.get('/inventory/goods-receipt-items/:grnuid', asyncHandler(inventoryController.interfaceGRItems));

module.exports = router;
