const request = require('request');
const organisationsModel = require("../../../core/models/organisations.model");
let moment = require("moment-timezone");
let _ = require('lodash');
const view = require('../../../core/view')('validate');
exports.dforder = async function (req, res) {
  let currentdate =  req.query.date || "";
  let currentdateFormat =  req.query.date || "";
  let orgcode = req.session.sitecode;
  let currentMonth =  moment(currentdate).tz("Asia/Bangkok").format("YYYY/MM");
  if(currentdate == "") {
    currentdate = moment().tz("Asia/Bangkok").format("YYYY/MM/DD");
    currentdateFormat = moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
    currentMonth = moment().tz("Asia/Bangkok").format("YYYY/MM");
  } else {
    currentdate = String(currentdate).replace(/-/g, '/')
  }
  let url = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/billed/transaction/${currentdate}?format=json&tz=Asia/Bangkok`;
  let downloadUrl = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/billed/transaction/${currentdate}?tz=Asia/Bangkok`
  let downloadUrl2 = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/billed/transaction/${currentMonth}?tz=Asia/Bangkok`
  console.log(url);
  let options = {json: true};
  let org = await organisationsModel.getOrgData(orgcode);
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
  results = _.orderBy(results, ['No'], ['desc']);
  return res.renderPage(view('df'), {
    title:  'Order DF Billed: ' + org[0].name + " " + currentdateFormat,
    results : results,
    downloadUrl : downloadUrl,
    downloadUrl2 : downloadUrl2
  });
}



exports.dfxray = async function (req, res) {
  let currentdate =  req.query.date || "";
  let currentdateFormat =  req.query.date || "";
  let billed =  req.query.billed || "";
  let currentMonth =  moment(currentdate).tz("Asia/Bangkok").format("YYYY/MM");
  let url = "";
  let xrayType = "ก่อนออก Billed";
  let downloadUrl = "";
  let downloadUrl2 = "";
  if(currentdate == "") {
    currentdate = moment().tz("Asia/Bangkok").format("YYYY/MM/DD");
    currentdateFormat = moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
    currentMonth = moment().tz("Asia/Bangkok").format("YYYY/MM");
  }
  if(billed == "Y"){
    url = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xray/billed/transaction/${currentdate}?tz=Asia/Bangkok&format=json&authorized=true`;
    downloadUrl = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xray/billed/transaction/${currentdate}?tz=Asia/Bangkok&authorized=true`;
    downloadUrl2 = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xray/billed/transaction/${currentMonth}?tz=Asia/Bangkok&authorized=true`;
    xrayType = "Billed";
    downloadText = "XRAY DF Billed";
  } else {
    url = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xrayorder/authorized/transaction/${currentdate}?tz=Asia/Bangkok&format=json`;
    downloadUrl = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xrayorder/authorized/transaction/${currentdate}?tz=Asia/Bangkok`;
    downloadUrl2 = process.env.CENTRIX_DF_SERVICE + `/v2.0/df/xrayorder/authorized/transaction/${currentMonth}?tz=Asia/Bangkok`;
    downloadText = "XRAY DF";
  }

  console.log(url);
  let options = {json: true};
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
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
  console.log("Request API : " + url);
  results = _.orderBy(results, ['No'], ['desc']);
  return res.renderPage(view('xraydf'), {
    title:  ' DF XRAY '+ xrayType +' : ' + org[0].name + " " + currentdateFormat,
    results : results,
    downloadUrl : downloadUrl,
    downloadUrl2 : downloadUrl2,
    downloadText : downloadText
  });
}