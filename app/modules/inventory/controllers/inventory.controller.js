
const organisationsModel = require("../../../core/models/organisations.model");
const inventoryModel = require("../models/inventory.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('inventory');
exports.index = async function (req, res) {
  let page = req.query.page || 0;
  let selectedDateFormat = req.query.date || moment().format('YYYY-MM-DD');
  let selectedDateFormat2 = req.query.date2 || moment().format('YYYY-MM-DD');
  let transactiontype = req.query.transactiontype || 'INVENTORIES.GOODSRECEIVE';
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

  let inventory = await inventoryModel.getInventoryData(org[0]._id, page, selectedDateFormat, selectedDateFormat2, transactiontype, orderno, refno, itemuid, mrn);
  let nextPage = parseInt(page) + 1;
  let lastpage = parseInt(page)  > 0 ? parseInt(page) - 1 : 0;
  let isDebug = req.query.debug || false;
  
  return res.renderPage(view('inventory'), {
    title:  'Inventory 1 Day : ' + org[0].name,
    results : inventory,
    nextpage : nextPage,
    lastpage : lastpage,
    isDebug : isDebug,
    selectdate : selectedDateFormat,
    selectdate2 : selectedDateFormat2,
    transactiontype : transactiontype,
    itemno : itemno,
    mrn : mrn
  });
}

exports.interfaceItemmasters = async function (req, res) {
  let code = req.query.code || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let inventory = await inventoryModel.getInterfaceItemMaster(org[0]._id, code);

  return res.renderPage(view('itemmaster'), {
    title:  'Get Itemmasters : ' + org[0].name,
    results : inventory,
  });
}

exports.interfaceVendors = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let vendor = await inventoryModel.getInterfaceVendorMaster(org[0]._id);

  return res.renderPage(view('vendor'), {
    title:  'Get Interfaced Vendors : ' + org[0].name,
    results : vendor,
  });
}

exports.interfaceGR = async function (req, res) {
  let grn = req.query.grn || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let gr = await inventoryModel.getInterfaceGR(org[0]._id, grn);
  return res.renderPage(view('gr'), {
    title:  'Get Interfaced GR : ' + org[0].name,
    results : gr,
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
  let items = await inventoryModel.getAvailableItemMasters(org[0]._id, itemuid);
  return res.renderPage(view('availableitems'), {
    title:  'Available Items : ' + org[0].name,
    items : items,
  });
}