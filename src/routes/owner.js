const express = require('express');
const ownerService = require('../services/ownerService');

const router = express.Router();

// Get full store data
router.get('/store', ownerService.getStoreData);

// Update Store Profile / Settings
router.put('/store', ownerService.updateStoreInfo);
router.put('/timings', ownerService.updateTimings);
router.put('/location', ownerService.updateLocation);
router.put('/bank', ownerService.updateBankDetails);
router.put('/printer', ownerService.updatePrinterSettings);
router.put('/preferences', ownerService.updatePreferences);

// Categories
router.post('/categories', ownerService.addCategory);

// Menu Items
router.post('/menu', ownerService.addMenuItem);
router.put('/menu/:id', ownerService.updateMenuItem);
router.delete('/menu/:id', ownerService.deleteMenuItem);

// Orders
router.put('/orders/:id', ownerService.updateOrderStatus);
router.post('/orders/simulate', ownerService.simulateIncomingOrder);

// Staff
router.post('/staff', ownerService.addStaffMember);
router.delete('/staff/:id', ownerService.deleteStaffMember);

// Notifications
router.put('/notifications/read-all', ownerService.markAllNotificationsRead);

module.exports = router;
