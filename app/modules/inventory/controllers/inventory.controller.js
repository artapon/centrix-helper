
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const organisationsModel = require("../../../core/models/organisations.model");
const inventoryModel = require("../models/inventory.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('inventory');
exports.index = async function (req, res) {
  let page = req.query.page || 0;
  let selectedDateFormat = req.query.date || moment().format('YYYY-MM-DD');
  let selectedDateFormat2 = req.query.date2 || moment().format('YYYY-MM-DD');
  // '' = all types (the form's ALL TYPES); not given = goods receive, as before.
  let typeParam = req.query.transactiontype === undefined ? 'INVENTORIES.GOODSRECEIVE' : String(req.query.transactiontype);
  let transactiontype = typeParam;
  let orderno = req.query.orderno || "";
  let itemno = req.query.itemno || "";
  let itemuid = await inventoryModel.getItemMasterUID(itemno);
  let refno = req.query.refno || "";
  let mrn = req.query.mrn || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  
  itemuid = itemuid.length > 0 ? itemuid[0]._id : '';

  let allTransactionType = [
    "INVENTORIES.GOODSRECEIVE",
    "INVENTORIES.CANCELTRANSFER",
    "INVENTORIES.TRANSFEROUT",
    "INVENTORIES.TRANSFERIN",
    "INVENTORIES.STOCKISSUE",
    "INVENTORIES.STOCKDISPENSE",
    "PHARMACYMASTER.CANCELDISPENSE",
    "PHARMACYMASTER.IPFILL",
    "COMMON.DISPENSERETURN",
    "INVENTORIES.VENDORRETURN",
    "INVENTORIES.STOCKADJUST",
    "INVENTORIES.MANUFACTURING",
    "INVENTORIES.REPACKING",
    "INVENTORIES.MANUFACUTINGREPACKING",
    "INVENTORIES.STOCKTRANSFERRETURN"
  ];

  if(transactiontype != '') {
    transactiontype = transactiontype;
  }else {
    transactiontype = allTransactionType;
  }

  let inventory = [], error = '';
  try {
    inventory = await inventoryModel.getInventoryData(org[0]._id, page, selectedDateFormat, selectedDateFormat2, transactiontype, orderno, refno, itemuid, mrn) || [];
  } catch (err) {
    const msg = err && err.message ? err.message : 'unknown error';
    error = /time limit|MaxTimeMSExpired|exceeded/i.test(msg)
      ? 'The search took longer than 2 minutes and was stopped. Narrow it: fewer days, one transaction type, or an item / HN.'
      : 'The stock ledger could not be read from the database: ' + msg + '.';
  }
  page = Math.max(0, parseInt(page, 10) || 0);
  let nextPage = page + 1;
  let lastpage = page > 0 ? page - 1 : 0;
  // 10 rows a page (each costs ~80 lookups); the query read one more to know whether there is a next page.
  const PER_PAGE = 10;
  const hasMore = inventory.length > PER_PAGE;
  inventory = inventory.slice(0, PER_PAGE);
  const pager = {
    page: page, perPage: PER_PAGE, hasMore: hasMore,
    from: inventory.length ? page * PER_PAGE + 1 : 0, to: page * PER_PAGE + inventory.length,
    prev: page > 0 ? paging.href(req, lastpage) : '', next: hasMore ? paging.href(req, nextPage) : ''
  };
  let isDebug = req.query.debug || false;
  
  return res.renderPage(view('inventory'), {
    title:  'Inventory 1 Day : ' + org[0].name,
    results : inventory,
    nextpage : nextPage,
    lastpage : lastpage,
    isDebug : isDebug,
    selectdate : selectedDateFormat,
    selectdate2 : selectedDateFormat2,
    transactiontype : typeParam,
    itemno : itemno,
    mrn : mrn,
    orderno : orderno,
    refno : refno,
    error : error,
    page : page,
    // Previous / Next (<page-pager>, as on the other list pages): this address with only the page changed.
    paging : pager
  });
}

exports.interfaceItemmasters = async function (req, res) {
  let code = req.query.code || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: inventory, paging: pg } = paging.page(req, p, await inventoryModel.getInterfaceItemMaster(org[0]._id, code, p));

  return res.renderPage(view('itemmaster'), {
    title:  'Get Itemmasters : ' + org[0].name,
    results : inventory,
    paging: pg, query: { code: code }
  });
}

exports.interfaceVendors = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: vendor, paging: pg } = paging.page(req, p, await inventoryModel.getInterfaceVendorMaster(org[0]._id, p));

  return res.renderPage(view('vendor'), {
    title:  'Get Interfaced Vendors : ' + org[0].name,
    results : vendor,
    paging: pg, query: {}
  });
}

exports.interfaceGR = async function (req, res) {
  let grn = req.query.grn || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: gr, paging: pg } = paging.page(req, p, await inventoryModel.getInterfaceGR(org[0]._id, grn, p));
  return res.renderPage(view('gr'), {
    title:  'Get Interfaced GR : ' + org[0].name,
    results : gr,
    paging: pg, query: { grn: grn }
  });
}

exports.interfaceGRItems = async function (req, res) {
  let grnuid = req.params.grnuid || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let gritems = await inventoryModel.getInterfaceGRItems(grnuid, org[0]._id);
  return res.renderPage(view('gritems'), {
    title:  'Get Interfaced GR ITEMS : ' + org[0].name,
    results : gritems,
  });
}

exports.availableitems = async function (req, res) {
  let code = req.query.itemno || "";
  let orgcode = req.session.sitecode;
  let itemuid = await inventoryModel.getItemMasterUID(code);
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  let rows = [], error = '';
  try {
    rows = await inventoryModel.getAvailableItemMasters(org[0]._id, itemuid, p);
  } catch (err) {
    error = 'The stock could not be read from the database: ' + (err && err.message ? err.message : 'unknown error') + '.';
  }
  const { rows: items, paging: pg } = paging.page(req, p, rows || []);
  return res.renderPage(view('availableitems'), {
    title:  'Available Items : ' + org[0].name,
    items : items,
    itemno: code,
    error: error,
    paging: pg, query: { itemno: code }
  });
}