// Mounted before the DB-connection guard: the services and their history live in SQLite.
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAction, requireAdmin } = require('../../app/core/middleware/requireauth.middleware');
const controller = require('./controllers/servicemonitor.controller');
const checker = require('./models/checker.service');

const LINK = '/service-monitor';
const manage = requireAction(LINK, 'manage');
const check = requireAction(LINK, 'check');
const clear = requireAction(LINK, 'clear');

const router = express.Router();


// "Settings" (administrators only): the pages' light / dark theme.
router.get(`${LINK}/settings`, requireAdmin, asyncHandler(controller.settingsIndex));
router.post(`${LINK}/settings`, requireAdmin, controller.settingsSave);
router.post(`${LINK}/settings/import-kuma/preview`, requireAdmin, controller.kumaPreview);
router.post(`${LINK}/settings/import-kuma`, requireAdmin, controller.kumaImport);
// Backup & restore: the restore requests send the file as text (it can be larger than the JSON body limit).
const backupText = express.text({ type: 'text/plain', limit: '20mb' });
router.get(`${LINK}/settings/backup`, requireAdmin, controller.backupDownload);
// Share (administrators only): the public, view-only status page (/status/<token>, routes.open.js).
router.get(`${LINK}/share`, requireAdmin, controller.shareGet);
router.post(`${LINK}/share`, requireAdmin, controller.shareSave);
router.post(`${LINK}/settings/restore/preview`, requireAdmin, backupText, controller.restorePreview);
router.post(`${LINK}/settings/restore`, requireAdmin, backupText, controller.restore);

// Access follows the "Service Health" menu item (/service-monitor and everything under it).
router.get(LINK, asyncHandler(controller.index));
router.get(`${LINK}/data`, controller.data);
router.get(`${LINK}/services/:id(\\d+)`, controller.detail);
router.post(`${LINK}/services`, manage, controller.create);
router.post(`${LINK}/services/test`, manage, controller.test);
router.post(`${LINK}/services/:id(\\d+)`, manage, controller.update);
router.post(`${LINK}/services/:id(\\d+)/enabled`, manage, controller.toggle);
router.post(`${LINK}/services/:id(\\d+)/delete`, manage, controller.remove);
router.post(`${LINK}/services/:id(\\d+)/check`, check, controller.check);
router.post(`${LINK}/check-all`, check, controller.checkAll);
router.post(`${LINK}/reset/preview`, clear, controller.resetPreview);
router.post(`${LINK}/reset`, clear, controller.reset);
router.post(`${LINK}/groups`, manage, controller.saveGroup);
router.post(`${LINK}/groups/:id(\\d+)`, manage, controller.saveGroup);
router.post(`${LINK}/groups/:id(\\d+)/delete`, manage, controller.removeGroup);

// Checks run in the background from start-up (each tick skips them while the add-on is inactive).
checker.start();

module.exports = router;
