const encryption = require('../../../core/helpers/encryption');
const fs = require('fs');
let moment = require("moment-timezone");
const console = require('console');
const { extract } = require('@extractus/feed-extractor');
let _ = require('lodash');
const view = require('../../../core/view')('tools');

exports.encryptDecrypt = function (req, res) {
  return res.renderPage(view('encrypt_decrypt'), {
    title: 'Centrix HIS Helper Tools',
    text: ""
  });
};

exports.centrixEncrypt = function(req, res) {
  let value = req.body.encryptvalue;
  let removespvalue = req.body.removespvalue;

  if(removespvalue == "Y")
    value = value.replace("@", "%40");

  if(value)
    text = encryption.centrixEncrypt(value);

  return res.renderPage(view('encrypt_decrypt'), {
      title:  'Centrix HIS Helper Tools',
      text: value + " => " + text
    });
};

exports.centrixDecrypt = function(req, res) {
  let value = req.body.decryptvalue;
  if(value)
    text = encryption.centrixDecrypt(value);
  return res.renderPage(view('encrypt_decrypt'), {
      title:  'Centrix HIS Helper Tools',
      text: value + " : " + text
    });
};

exports.medintEncrypt = function(req, res) {
  let value = req.body.encryptvalue;
  if(value)
    text = encryption.medintEncrypt(value);

  return res.renderPage(view('encrypt_decrypt'), {
      title:  'Centrix HIS Helper Tools',
      text: value + " => " + text
    });
};

exports.medintDecrypt = function(req, res) {
  let value = req.body.decryptvalue;
  if(value)
    text = encryption.medintDecrypt(value);
  return res.renderPage(view('encrypt_decrypt'), {
      title:  'Centrix HIS Helper Tools',
      text: value + " : " + text
    });
};

exports.erpManual = function(req, res) {
  let dateat = moment().toISOString();
  let selectedDate = req.query.date || moment().toISOString();
  let selectedDateFormat = req.query.date || moment().format('DD/MM/YYYY');

  if(selectedDate) {
    dateat = moment(selectedDate).toISOString();
    selectedDateFormat = moment(selectedDate).format('DD/MM/YYYY');
  }
    

  return res.renderPage(view('erp_manual'), {
      title:  'RUN ERP Manual ข้อมูล ณ วันที่ : ' + selectedDateFormat,
      dateat : dateat,
      selectedDate : selectedDateFormat,
      outbound :  process.env.CENTRIX_ERP_OUTBOUND
    });
};

exports.erpDataToExcel = function(req, res) {
  return res.renderPage(view('erp_convert_data'), {
      title:  'Convert ERP data To Excel'
    });
};

exports.erpDataToExcelConvert = function(req, res) {
  let resultHeader = [];
  let resultDetails = [];
  let payments = [];
  let inventory = [];
  try {
    if(!req.file) {
      res.redirect('/tools/erp-to-excel')
    } else {
      let data = Buffer.from(req.file.buffer).toString("utf-8");
      let datajson = JSON.parse(data);
      let originalname = req.file.originalname;
      let filename =  originalname.split('.')[0];

      if(req.body.type == 'header'){
        console.log('Processing Revenue Header ' + filename);
        datajson.forEach(item => {
          resultHeader.push(
            {
              BusinessUnit : item.BusinessUnit,
              InvoiceNo : item.InvoiceNo,
              InvoiceDate : item.InvoiceDate,
              EpisodeNo : item.EpisodeNo,
              DocumentType : item.DocumentType,
              ReferralDetails : item.ReferralDetails,
              CustomerCode : item.CustomerCode,
              CustomerType : item.CustomerType,
              HN : item.HN,
              PatientName : item.PatientName,
              NationalityCode : item.NationalityCode,
              Currency : item.Currency,
              TotalNetAmount : item.TotalNetAmount
            }
          )
        });
        res.xls(filename + '_Header.xlsx', resultHeader);
      } else if(req.body.type == 'details') {
        console.log('Processing Revenue Details ' + filename);
        datajson.forEach(data => {
          data.Details.forEach(item => {
            resultDetails.push(
              {
                BusinessUnit : data.BusinessUnit,
                InvoiceNo : data.InvoiceNo,
                InvoiceDate : data.InvoiceDate,
                EpisodeNo : data.EpisodeNo,
                DocumentType : data.DocumentType,
                ReferralDetails : data.ReferralDetails,
                CustomerCode : data.CustomerCode,
                CustomerType : data.CustomerType,
                HN : data.HN,
                PatientName : data.PatientName,
                NationalityCode : data.NationalityCode,
                Currency : data.Currency,
                TotalNetAmount : data.TotalNetAmount,
                LineNo : item.LineNo,
                ItemCode : item.ItemCode,
                ItemName : item.ItemName,
                PackageCode : item.PackageCode,
                AccountCode : item.AccountCode,
                DiscountCode : item.DiscountCode,
                DepartmentCode : item.DepartmentCode,
                PatientLocation : item.PatientLocation,
                ReceivingLocation : item.ReceivingLocation,
                RevenueSubtype : item.RevenueSubtype,
                UnitCost : item.UnitCost,
                Amount : item.Amount,
                DiscountAmount : item.DiscountAmount,
                NetAmount : item.NetAmount,
                DoctorCode : item.DoctorCode,
                DoctorName : item.DoctorName,
                OrderTime : item.OrderTime,
              }
            )
          })
        });
        res.xls(filename + '_Details.xlsx', resultDetails);
      } else if(req.body.type == 'payments') {
        console.log('Processing Revenue Payments ' + filename);
        datajson.forEach(data => {
          data.Payments.forEach(item => {
            payments.push(
              {
                BusinessUnit : data.BusinessUnit,
                InvoiceNo : data.InvoiceNo,
                InvoiceDate : data.InvoiceDate,
                EpisodeNo : data.EpisodeNo,
                DocumentType : data.DocumentType,
                ReferralDetails : data.ReferralDetails,
                CustomerCode : data.CustomerCode,
                CustomerType : data.CustomerType,
                HN : data.HN,
                PatientName : data.PatientName,
                NationalityCode : data.NationalityCode,
                Currency : data.Currency,
                TotalNetAmount : data.TotalNetAmount,
                Paymentmethod : item.Paymentmethod,
                Amount : item.Amount,
                DepositReferenceNo : item.DepositReferenceNo,
                BankCode : item.BankCode,
                BankAccount : item.BankAccount,
                DueDate : item.DueDate,
                ChequeNumber : item.ChequeNumber
              }
            )
          })
        });
        res.xls(filename + '_Payments.xlsx', payments);
      } else if(req.body.type == 'inventory') {
        console.log('Processing Inventory Data ' + filename);

        datajson.forEach(item => {
          let errorMessages = [];
          let error = "";
          if(item.TRANSACTION_TYPE == 'RCVRET') {

            if(item.REFERENCE_NO == "") {
              errorMessages.push("REFERENCE_REQUIRED_NO_ERROR");
            }

            if((item.ORDER_NO).includes('SD-') && item.ORDER_NO != item.REFERENCE_NO) {
              errorMessages.push("REFERENCE_NO_ERROR");
            }
            if(item.STORE_CODE != item.RECEIVING_LOCATION_CODE) {
              errorMessages.push("RECEIVING_LOCATION_CODE_ERROR");
            }
           
          } 
          
          if(item.TRANSACTION_TYPE == 'ADJCNT') {
            if(item.STORE_CODE != item.RECEIVING_LOCATION_CODE) {
              errorMessages.push("RECEIVING_LOCATION_CODE_ERROR");
            }
          }

          error = errorMessages.join(", ");

          inventory.push(
          {
              TRANSACTION_GROUP : item.TRANSACTION_GROUP,
              BUSINESS_UNIT : item.BUSINESS_UNIT,
              TRANSACTION_DATE : item.TRANSACTION_DATE,
              ORDER_NO : item.ORDER_NO,
              STORE_CODE : item.STORE_CODE,
              TRANSACTION_TYPE : item.TRANSACTION_TYPE,
              CUST_NAME : item.CUST_NAME,
              ADJUST_TYPE : item.ADJUST_TYPE,
              COMMENTS_HEADER : item.COMMENTS_HEADER,
              END_HEADER : item.END_HEADER,
              ACCOUNT : item.ACCOUNT,
              DEPT_CODE : item.DEPT_CODE,
              PATIENT_LOCATION_CODE : item.PATIENT_LOCATION_CODE,
              RECEIVING_LOCATION_CODE : item.RECEIVING_LOCATION_CODE,
              TO_STORE_CODE : item.TO_STORE_CODE,
              ORDER_LINE_NO : item.ORDER_LINE_NO,
              ITEM_CODE : item.ITEM_CODE,
              EXPIRE_DATE : item.EXPIRE_DATE,
              BATCHID : item.BATCHID,
              UNIT_OF_MEASURE : item.UNIT_OF_MEASURE,
              QTY : item.QTY,
              ACTUAL_COST : item.ACTUAL_COST,
              COMMENTS_LINE : item.COMMENTS_LINE,
              PATIENTTYPE : item.PATIENTTYPE,
              REFERENCE_NO : item.REFERENCE_NO,
              ERROR_STATUS : error
            }
          )
        });
        res.xls(filename + '_inventory.xlsx', inventory);
      }
    }
  } catch (err) {
      res.status(500).send(err);
  }
};

exports.mergedRSS = async function(req, res) {
  
  let results = [];
  let resultMergeds = [];
  let resultOpens = [];
  let feeditems = [];
  let feedMergeditems = [];
  let feedOpenitems = [];
  let bgColor = "";
  let inc = "";

  for (let i = 1 ; i <= 3; i++) {
    feeditems = await extract('https://gitlab.com/humc/centrix-medint/-/merge_requests.atom?feed_token=b43NMBVy1zctERB2RrfQ&scope=all&state=all&sort=created_date&page=' + i, {
      useISODateFormat: true,
      normalization: false
    })

    feeditems.entry.forEach(item => {
      if(item.title.indexOf('Revert') != 0 && item.title.indexOf('Draft') && item.title.indexOf('develop') < 0 && item.title.indexOf('master') < 0) {
        let isArray =  item.labels ? Array.isArray(item.labels.label) : false;

        if(item.title.indexOf('THB') >= 0) {
          bgColor = "#9fc5e8";
        } else if(item.title.indexOf('RPH') >= 0)
          bgColor = "#cae9be";

        inc = item.labels ? (isArray ? (item.labels.label).find(el => el.toLowerCase().indexOf('inc-') > -1 || el.toLowerCase().indexOf('close') > -1) : "") : "";
        team = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('TM-') > -1) : "") : ""

        results.push({
          id : item.id,
          title : item.summary,
          href : item.link,
          developer : item.author.name,
          updated: moment(item.updated).tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss"),
          status : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Deployed') > -1) : "") : "",
          version : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('-v') > -1 || el.indexOf('sprint') > -1) : "") : "",
          cn : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('CN-') > -1 || el.indexOf('CEN-') > -1 ) : "") : "",
          inc : inc,
          inc_code : inc ? inc.replace('INC-', '') : "",
          color : bgColor,
          milestone : item.milestone ? item.milestone : "",
          conflicts : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Conflicts') > -1) : "") : "",
          team : team ? team.replace('TM-', '') : "",
        })
      }
    });
  }

  let milestones = results.filter(function(item) {
    return item.milestone != "" && (item.status == "" || item.status == undefined);
  })

  for (let i = 1 ; i <= 3; i++) {
    feedMergeditems = await extract('https://gitlab.com/humc/centrix-medint/-/merge_requests.atom?feed_token=b43NMBVy1zctERB2RrfQ&scope=all&state=merged&sort=merged_at_desc&page=' + i, {
      useISODateFormat: true,
      normalization: false
    })

    feedMergeditems.entry.forEach(item => {
      if(item.title.indexOf('Revert') != 0 && item.title.indexOf('Draft') && item.title.indexOf('develop') < 0 && item.title.indexOf('master') < 0) {
        let isArray =  item.labels ? Array.isArray(item.labels.label) : false;

        if(item.title.indexOf('THB') >= 0) {
          bgColor = "#9fc5e8";
        } else if(item.title.indexOf('RPH') >= 0)
          bgColor = "#cae9be";

        inc = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('INC-') > -1) : "") : "";
        team = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('TM-') > -1) : "") : ""

        resultMergeds.push({
          id : item.id,
          title : item.summary,
          href : item.link,
          developer : item.author.name,
          updated: moment(item.updated).tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss"),
          status : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Deployed') > -1) : "") : "",
          version : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('-v') > -1) : "") : "",
          cn : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('CN-') > -1 || el.indexOf('CEN-') > -1 ) : "") : "",
          inc : inc,
          inc_code : inc ? inc.replace('INC-', '') : "",
          color : bgColor,
          conflicts : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Conflicts') > -1) : "") : "",
          team : team ? team.replace('TM-', '') : "",
        })
      }
    });
  }

  for (let i = 1 ; i <= 1; i++) {
    feedOpenitems = await extract('https://gitlab.com/humc/centrix-medint/-/merge_requests.atom?feed_token=b43NMBVy1zctERB2RrfQ&scope=all&state=opened&page=' + i, {
      useISODateFormat: true,
      normalization: false
    })
    if(Array.isArray(feedOpenitems.entry)) {
      feedOpenitems.entry.forEach(item => {
        if(item.title.indexOf('Revert') != 0 && item.title.indexOf('Draft') && item.title.indexOf('develop') < 0 && item.title.indexOf('master') < 0) {
          let isArray =  item.labels ? Array.isArray(item.labels.label) : false;

          if(item.title.indexOf('THB') >= 0) {
            bgColor = "#9fc5e8";
          } else if(item.title.indexOf('RPH') >= 0)
            bgColor = "#cae9be";

          inc = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('INC-') > -1) : "") : "";
          team = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('TM-') > -1) : "") : ""

          resultOpens.push({
            id : item.id,
            title : item.summary,
            href : item.link,
            developer : item.author.name,
            updated: moment(item.updated).tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss"),
            status : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Deployed') > -1) : "") : "",
            version : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('-v') > -1) : "") : "",
            cn : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('CN-') > -1 || el.indexOf('CEN-') > -1 ) : "") : "",
            inc : inc,
            inc_code : inc ? inc.replace('INC-', '') : "",
            color : bgColor,
            conflicts : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Conflicts') > -1) : "") : "",
            team : team ? team.replace('TM-', '') : "",
          })
        }
      });
    } else {
      item = feedOpenitems.entry;
      if(item.title.indexOf('Revert') != 0 && item.title.indexOf('Draft') && item.title.indexOf('develop') < 0 && item.title.indexOf('master') < 0) {
        let isArray =  item.labels ? Array.isArray(item.labels.label) : false;
        if(item.title.indexOf('THB') >= 0) {
          bgColor = "#9fc5e8";
        } else if(item.title.indexOf('RPH') >= 0)
          bgColor = "#cae9be";

        inc = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('INC-') > -1) : "") : "";
        team = item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('TM-') > -1) : "") : "";
       
        resultOpens.push({
          id : item.id,
          title : item.summary,
          href : item.link,
          developer : item.author.name,
          updated: moment(item.updated).tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss"),
          status : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Deployed') > -1) : "") : "",
          version : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('-v') > -1) : "") : "",
          cn : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('CN-') > -1 || el.indexOf('CEN-') > -1 ) : "") : "",
          inc : inc,
          inc_code : inc ? inc.replace('INC-', '') : "",
          color : bgColor,
          conflicts : item.labels ? (isArray ? (item.labels.label).find(el => el.indexOf('Conflicts') > -1) : "") : "",
          team : team ? team.replace('TM-', '') : "",
        })
      }
    }
  }

  return res.renderPage(view('gitlab_rss'), {
      title:  'Centrix HIS Soruce Code Status',
      results : _.uniqBy(results, 'title'),
      resultMergeds : _.uniqBy(resultMergeds, 'title'),
      resultOpens :  _.uniqBy(resultOpens, 'title'),
      milestones : milestones
    });
};