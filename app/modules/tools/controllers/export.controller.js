const orderitemModel = require("../models/orderitems.model");
const organisationsModel = require("../../../core/models/organisations.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('tools');

exports.index = function(req, res) {
  return res.renderPage(view('export'), {
      title:  'Export Data',
    });
};

exports.exportItemMasterOrderitems = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let orderitems = await orderitemModel.getItemMasterOrderitems(org[0]._id);
  res.xls('ItemMasterOrderitems.xlsx', orderitems);
}

exports.exportItemMasterNoOrderitems = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let orderitems = await orderitemModel.getItemMasterNoOrderitems(org[0]._id);
  res.xls('ItemMasterNoOrderitems.xlsx', orderitems);
}

exports.exportOrderitemsNoItemMasters = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let orderitems = await orderitemModel.getOrderitemsNoItemMasters(org[0]._id);
  res.xls('OrderitemsNoItemMasters.xlsx', orderitems);
}

exports.exportAllFiles = async function (req, res) {
  let orderitems = [];
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let orderitems1 = await orderitemModel.getItemMasterNoOrderitems(org[0]._id);
  let orderitems2 = await orderitemModel.getOrderitemsNoItemMasters(org[0]._id);
  let orderitems3 = await orderitemModel.getItemMasterOrderitems(org[0]._id);

  orderitems = orderitems1.concat(orderitems2, orderitems3);

  res.xls('allOrderItemsItemmasters.xlsx', orderitems);
}

exports.exportOrderDF = async function (req, res) {
  let currentdate =  moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
  let startdate = moment().tz("Asia/Bangkok").startOf('month').format('YYYY-MM-DD');
  let url = process.env.CENTRIX_ERP_SERVICE + `/df/order/transaction/${startdate}/${currentdate}/json`;
  let options = {json: true};
  let results = await new Promise (function (resolve, reject) {
    request(url, options, (error, res, results) => {
      let DFarray = [];
      if (error) {
          return  console.log(error)
      };

      if (!error && res.statusCode == 200) {
          if(results && results.length > 0){
              results.forEach(result => {
                  var data = {}
                  Object.keys(result).forEach(key => {
                      var re = new RegExp(" ", 'g');
                      var newKey = key.replace(re, "").replace('.', "");
                      data[newKey] = result[key];
                  });
      
                  DFarray.push(data);
              });
          }
          resolve(DFarray);
      };
    });
  });

  results = _.orderBy(results, ['OrderDate'], ['desc']);

  res.xls('orderDF.xlsx', results);
}
