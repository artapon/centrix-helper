// URL scheme, grouped by data domain:
//
//   /overview            dashboard                 /lab           LIS (lab master, orders, results)
//   /patients            patients, visits, merges  /radiology     RIS (modality, orders, Mirth log)
//   /pharmacy            pharmacy orders           /diet          diet orders
//   /billing             orders, bills, DF         /inventory     items, vendors, goods receipts
//   /reports             Jasper viewer / logs      /logs          audit and import logs
//   /migration           migration data checks     /interfaces    interface settings, SAP
//   /data-quality        data checks
//   /query-studio        Query Studio add-on       /database      connections, info, monitor
//   /tools               shortcuts and utilities   /admin         users, roles, marketplace
//   /api/database/...    JSON APIs of the database pages
//
// LEGACY maps each old path prefix to its new one. It is used to
//   - redirect old links and bookmarks (core/middleware/legacyredirect.middleware.js),
//   - move role permissions and shortcut links stored in SQLite (migrations/sqlite/migrate.js).
// A prefix matches the whole path or a path continuing with "/", so /tool/query-data does not
// match /tool/query-data-audit; the longest match wins.

const LEGACY = {
  // Patients
  '/data/patient/summary': '/patients/summary',
  '/data/patientvisits': '/patients/visits',
  '/data/patient/merges': '/patients/merges',
  '/data/patient/auditdetail': '/patients/audit-detail',
  '/data/patient/auditlogmore': '/patients/audit-log',
  '/data/packagesitems': '/patients/package-items',
  '/data/doctormonitor': '/patients/doctor-visits',
  '/data/doctor/visits': '/patients/doctor-visits/by-doctor',

  // LIS
  '/tool/labmaster': '/lab/master',
  '/tool/laborders': '/lab/orders',
  '/tool/labresult': '/lab/hl7-result',
  '/data/validate/labresult': '/lab/result-check',
  '/data/validate/labresultFile': '/lab/result-check/file',

  // RIS
  '/tool/xraymaster': '/radiology/default-modality',
  '/tool/xrayorders': '/radiology/orders',
  '/tool/xrayresult': '/radiology/hl7-result',
  '/data/xrayresultlog': '/radiology/mirth-log',
  '/data/validate/accessionnumber': '/radiology/accession-check',

  // Pharmacy
  '/tool/pharmacyOrders': '/pharmacy/orders',
  '/data/medsadmins': '/pharmacy/meds-admin',
  '/data/ipfillorders': '/pharmacy/ip-fill-orders',

  // Diet
  '/data/diet': '/diet/orders',

  // Billing
  '/data/patientOrders': '/billing/patient-orders',
  '/data/patientbills': '/billing/bills',
  '/data/patientunbills': '/billing/charge-codes',
  '/data/deposits': '/billing/deposits',
  '/data/creditnotes': '/billing/credit-notes',
  '/data/medicaldischarges': '/billing/medical-discharges',
  '/data/bills/billtems': '/billing/bill-items',
  '/data/bills/billtemsbyhn': '/billing/bill-items-by-hn',
  '/data/bills/billdfitems': '/billing/bill-df-items',
  '/data/validate/billdfitems': '/billing/bill-df-items',
  '/data/bills/paymentitems': '/billing/payment-items',
  '/data/unbills/unbillitems': '/billing/unbill-items',
  '/data/unbills/unbillitemsbyhn': '/billing/unbill-items-by-hn',
  '/data/validate/df': '/billing/df-check',
  '/data/validate/dfxray': '/billing/df-check-xray',

  // Inventory
  '/data/validate/inventory': '/inventory/tracking',
  '/data/inventory/availableitems': '/inventory/available-items',
  '/data/validate/interfaceitemmaster': '/inventory/item-masters',
  '/data/validate/interfacevendor': '/inventory/vendors',
  '/data/validate/interfacegr': '/inventory/goods-receipts',
  '/data/validate/gritems': '/inventory/goods-receipt-items',
  '/tool/inventory/comparedata': '/inventory/tracking/compare',

  // Reports (JasperServer)
  '/data/jasperviewer': '/reports/viewer',
  '/data/jasperreportlogs': '/reports/event-logs',
  '/tool/jasper-printout': '/reports/print-out-builder',
  '/tool/jasper-printout-settings': '/reports/settings',

  // Logs
  '/data/validate/auditlog': '/logs/audit',
  '/data/validate/auditdetail': '/logs/audit-detail',
  '/data/validate/importlog': '/logs/import',

  // Migration
  '/data/validate/transactionData': '/migration/visit-data',
  '/data/validate/havePatientData': '/migration/patient-data',
  '/data/validate/countNotransactionData': '/migration/other-data',

  // Interfaces
  '/data/validate/interface/setting': '/interfaces/settings',
  '/data/validate/interfacesap': '/interfaces/sap',
  '/data/validate/interfacesapExport': '/interfaces/sap/export',

  // Data quality
  '/data/validate/activeto': '/data-quality/active-to',
  '/data/validate/statusFlagD': '/data-quality/status-deleted',
  '/data/validate/inventoryData': '/data-quality/inventory',
  '/data/validate/doctorScheduleData': '/data-quality/doctor-schedules',

  // Exports

  // Query Studio (add-on)
  '/tool/query-data': '/query-studio',
  '/tool/query-data-audit': '/query-studio/audit',

  // Database
  '/settings/connections': '/database/connections',
  '/setting': '/database/info',
  '/db/connection': '/database/connect',
  '/tool/dbmonitor': '/database/monitor',
  '/api/db/monitor': '/api/database/monitor',
  '/api/db/stats': '/api/database/stats',
  '/api/db-connections': '/api/database/connections',

  // Tools
  '/tool/shortcuts': '/tools/shortcuts',
  '/tool/encryptdecrypt': '/tools/encrypt-decrypt',
  '/tool/centrixEncrypt': '/tools/encrypt-decrypt/centrix-encrypt',
  '/tool/centrixDecrypt': '/tools/encrypt-decrypt/centrix-decrypt',
  '/tool/medintEncrypt': '/tools/encrypt-decrypt/medint-encrypt',
  '/tool/medintDecrypt': '/tools/encrypt-decrypt/medint-decrypt',
  '/tool/rss': '/tools/source-status',
  '/tool/erpmanual': '/tools/erp-manual',
  '/tool/erpDataToExcel': '/tools/erp-to-excel',
  '/tool/erpDataToExcelConvert': '/tools/erp-to-excel/convert',
  '/tool/generator': '/tools/api-generator',

  // Administration
  '/settings/users': '/admin/users',
  '/settings/roles': '/admin/roles',
  '/settings/marketplace': '/admin/marketplace'
};

const ENTRIES = Object.keys(LEGACY).sort((a, b) => b.length - a.length);

/** The new path for an old one (query string kept), or null when the path is current. */
function upgrade(url) {
  const raw = String(url || '');
  const cut = raw.search(/[?#]/);
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const rest = cut < 0 ? '' : raw.slice(cut);
  for (const old of ENTRIES) {
    if (path === old || path.startsWith(old + '/')) return LEGACY[old] + path.slice(old.length) + rest;
  }
  return null;
}

module.exports = { LEGACY, upgrade };
