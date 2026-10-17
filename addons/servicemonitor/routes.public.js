// Mounted before the DB-connection guard: the services and their history live in SQLite.
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAction, requireAdmin } = require('../../app/core/middleware/requireauth.middleware');
const controller = require('./controllers/servicemonitor.controller');
const checker = require('./models/checker.service');
const model = require('./models/services.model');
const layout = require('../../app/core/layout');

const LINK = '/service-monitor';
const manage = requireAction(LINK, 'manage');
const check = requireAction(LINK, 'check');
const clear = requireAction(LINK, 'clear');
const importKuma = requireAction(LINK, 'import');

const router = express.Router();


// "Settings" (administrators only): the pages' light / dark theme.
router.get(`${LINK}/settings`, requireAdmin, asyncHandler(controller.settingsIndex));
router.post(`${LINK}/settings`, requireAdmin, controller.settingsSave);
router.post(`${LINK}/settings/slack/test`, requireAdmin, controller.slackTest);
// Backup & restore: the restore requests send the file as text (it can be larger than the JSON body limit).
const backupText = express.text({ type: 'text/plain', limit: '20mb' });
router.get(`${LINK}/settings/backup`, requireAdmin, controller.backupDownload);
// Share (administrators only): an organization's public, view-only status page (/status/<token>, routes.open.js).
router.get(`${LINK}/orgs/:id(\\d+)/share`, requireAdmin, controller.shareGet);
router.post(`${LINK}/orgs/:id(\\d+)/share`, requireAdmin, controller.shareSave);
router.post(`${LINK}/settings/restore/preview`, requireAdmin, backupText, controller.restorePreview);
router.post(`${LINK}/settings/restore`, requireAdmin, backupText, controller.restore);

// Access follows the "Service Health" menu item (/service-monitor and everything under it).
router.get(LINK, asyncHandler(controller.index));
router.get(`${LINK}/org/:orgId(\\d+)`, asyncHandler(controller.index));
router.post(`${LINK}/orgs`, manage, controller.saveOrg);
router.post(`${LINK}/orgs/:id(\\d+)`, manage, controller.saveOrg);
router.get(`${LINK}/orgs/:id(\\d+)/contents`, manage, controller.orgContents);
router.post(`${LINK}/orgs/:id(\\d+)/enabled`, manage, controller.toggleOrg);
router.post(`${LINK}/orgs/:id(\\d+)/import-kuma/preview`, importKuma, controller.kumaPreview);
router.post(`${LINK}/orgs/:id(\\d+)/import-kuma`, importKuma, controller.kumaImport);
router.post(`${LINK}/orgs/:id(\\d+)/delete`, manage, controller.removeOrg);
router.get(`${LINK}/data`, controller.data);
router.get(`${LINK}/services/:id(\\d+)`, controller.detail);
router.post(`${LINK}/services`, manage, controller.create);
router.post(`${LINK}/services/test`, manage, controller.test);
router.post(`${LINK}/services/:id(\\d+)`, manage, controller.update);
router.post(`${LINK}/services/:id(\\d+)/enabled`, manage, controller.toggle);
router.post(`${LINK}/services/enabled`, manage, controller.toggleMany);
router.post(`${LINK}/services/:id(\\d+)/delete`, manage, controller.remove);
router.post(`${LINK}/services/:id(\\d+)/check`, check, controller.check);
router.post(`${LINK}/check-all`, check, controller.checkAll);
router.post(`${LINK}/reset/preview`, clear, controller.resetPreview);
router.post(`${LINK}/reset`, clear, controller.reset);
router.post(`${LINK}/groups`, manage, controller.saveGroup);
router.post(`${LINK}/groups/:id(\\d+)`, manage, controller.saveGroup);
router.post(`${LINK}/groups/:id(\\d+)/delete`, manage, controller.removeGroup);

// The sidebar lists the organizations under "Service Health", each opening its own page.
layout.submenu(LINK, model.orgMenu);
model.orgs().catch((err) => console.error('Service Monitor: reading of the organizations failed:', err));

// Checks run in the background from start-up (each tick skips them while the add-on is inactive).
checker.start();

module.exports = router;
