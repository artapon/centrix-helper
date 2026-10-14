const _ = require('lodash');
let moment = require("moment-timezone");
const validateModel = require("../models/validate.model");
const xrayModel = require("../models/xray.model");
const organisationsModel = require("../../../core/models/organisations.model");
const labresultModel = require("../models/labresult.model");
const userModel = require("../models/users.model");
const view = require('../../../core/view')('validate');

exports.activeto = async function (req, res) {
  let orgcode = req.session.sitecode;
  let collections = await validateModel.getlistCollections();
  let org = await organisationsModel.getOrgData(orgcode);
  let results = [];

  for(i = 0; i <= collections.length; i++) {
    let countInactive = await validateModel.getlistCollectionsActiveTo(collections[i]);
    if(countInactive > 0)
      results.push({collection : collections[i].name, countInactive : countInactive})
  }

  results = _.orderBy(results, ['collection'],['asc']);

  return res.renderPage(view('table'), {
    title:  'List Inactive Data (Active To not null) : ' + org[0].name,
    results : results,
  });
}

exports.statusFlagD = async function (req, res) {
  let orgcode = req.session.sitecode;
  let collections = await validateModel.getlistCollections();
  let org = await organisationsModel.getOrgData(orgcode);
  let results = [];

  for(i = 0; i <= collections.length; i++) {
    let countInactive = await validateModel.getlistCollectionsstatusFlagD(collections[i]);
    if(countInactive > 0)
      results.push({collection : collections[i].name, countInactive : countInactive})
  }

  results = _.orderBy(results, ['collection'],['asc'])

  return res.renderPage(view('table'), {
    title:  'List Inactive Data (StatusflagD) : ' + org[0].name,
    results : results,
  });
}

exports.modality = async function (req, res) {
  let orgcode = req.session.sitecode;
  let xrays = await xrayModel.validateModalityData();
  let org = await organisationsModel.getOrgData(orgcode);

  return res.renderPage(view('xray_table'), {
    title:  'List Empty Default modality : ' + org[0].name,
    xrays : xrays,
  });
}

exports.modalityExport = async function (req, res) {
  let xrays = await xrayModel.validateModalityData();
  res.xls('xraymaster.xlsx', xrays);
}

exports.interfaceSetting = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let interfaceUser = await validateModel.getInterfaceUser(org[0]._id);
  let radiologySetting = await validateModel.getRadiologySettings(org[0]._id);
  let emrSetting = await validateModel.getEMRSettings(org[0]._id);
  let risSequence = await validateModel.getSequenceNumber("RADIOLOGYACCESSION", null, org[0]._id);
  let labSequence = await validateModel.getSequenceNumber("PATIENTORDER", "LAB", org[0]._id);
  let lisSetting = await validateModel.getReferenceDomains("INTERFACE", org[0]._id);
  let thirdpartySettings = await validateModel.getThirdPartySettings(org[0]._id);
  let externalurls = await validateModel.getReferenceDomains("EXTERNALURL", org[0]._id);
  let dfs = await validateModel.getDoctorShareType(org[0]._id);
  let bankcodes = await validateModel.getReferenceValues("BANKNM");
  let fileServers = await validateModel.getReferenceValues("FILESERVERCONFIG");
  let smartcards = await validateModel.getReferenceValues("RTMESVRURL");
  let edcconfigs = await validateModel.getEDCConfigs();

  return res.renderPage(view('interface_setting'), {
    title:  'Interface Setting Checklist : ' + org[0].name,
    org: org[0],
    interfaceUser : interfaceUser[0],
    radiologySetting: radiologySetting[0],
    risSequence : risSequence[0],
    emrSetting : emrSetting[0],
    labSequence : labSequence[0],
    lisSetting: lisSetting,
    thirdpartySettings: thirdpartySettings,
    externalurls: externalurls,
    dfs: dfs,
    bankcodes : bankcodes,
    fileServers : fileServers,
    smartcards : smartcards,
    edcconfigs : edcconfigs
  });
}

exports.transactionData = async function (req, res) {
  let orgcode = req.session.sitecode;
  let collections = await validateModel.getlistCollections();
  let org = await organisationsModel.getOrgData(orgcode);
  let results = [];

  for(i = 0; i <= collections.length; i++) {
    let countData = await validateModel.countlistCollectionsTransaction(collections[i]);
    if(countData > 0)
      results.push({collection : collections[i].name, countrecords : countData})
  }

  results = _.orderBy(results, ['collection'],['asc']);

  return res.renderPage(view('transactiondata'), {
    title:  'List Count Data with patientvisituid: ' + org[0].name,
    results : results,
  });
}

exports.havePatientData = async function (req, res) {
  let orgcode = req.session.sitecode;
  let collections = await validateModel.getlistCollections();
  let org = await organisationsModel.getOrgData(orgcode);
  let results = [];

  for(i = 0; i <= collections.length; i++) {
    let countData = await validateModel.countlistCollectionsPatient(collections[i]);
    if(countData > 0)
      results.push({collection : collections[i].name, countrecords : countData})
  }

  results = _.orderBy(results, ['collection'],['asc']);

  return res.renderPage(view('transactiondata'), {
    title:  'List Count Data with patientuid: ' + org[0].name,
    results : results,
  });
}

exports.countNotransactionData = async function (req, res) {
  let orgcode = req.session.sitecode;
  let collections = await validateModel.getlistCollections();
  let org = await organisationsModel.getOrgData(orgcode);
  let results = [];

  for(i = 0; i <= collections.length; i++) {
    let countData = await validateModel.countlistCollectionsMaster(collections[i]);
    if(countData > 0)
      results.push({collection : collections[i].name, countrecords : countData})
  }

  results = _.orderBy(results, ['collection'],['asc']);

  return res.renderPage(view('transactiondata'), {
    title:  'List Count Other Data: ' + org[0].name,
    results : results,
  });
}

exports.inventoryData = async function (req, res) {
  return res.renderPage(view('inventory'), {
    title:  'Validate Inventory Data'
  });
}

exports.validateAccessionnumberOrders = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let xrayOrders = await xrayModel.validateDuplicateAccessionnumber(org[0]._id)
  let countOrder = xrayOrders.length;

  return res.renderPage(view('xray_access_errors'), {
    title:  'Accessionnumber Errors ' + countOrder + ' Items',
    xrayOrders: xrayOrders
  });
}

exports.validateLabResult = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);

  return res.renderPage(view('labresult'), {
    title:  'Validate Labresult จาก LIS',
    data : []
  });
}

exports.validateLabResultFile = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let data = [];
  let mrn = "";
  let vn = "";

  if(req.file) {
    let hl7Message = Buffer.from(req.file.buffer).toString("utf-8");
    let segments = hl7Message.split(/\r|\n/).filter(s => s.trim() !== '');
    let currentOBR = [];
    let hisOBR = [];
    let hisresultItems = [];

    if(segments[0].startsWith('MSH')) {
      let listMSHValue = segments[0].split('|');
      let type = listMSHValue[8].split('^')[0];
      if(type != 'ORU') {
        res.redirect('/lab/result-check?error=Format ไฟล์ไม่ถูกต้อง')
      }
    }


    if(segments[1].startsWith('PID')) {
      let listPIDValue = segments[1].split('|');
      mrn = listPIDValue[2];
    }

    if(segments[2].startsWith('PV1')) {
      let listPV1Value = segments[2].split('|');
      vn = listPV1Value[19];
    }

    // Iterate through the segments and organize OBR and OBX sections
    for (let segment of segments) {
      // Start a new OBR section
      let obr = {
        orderdatetime: null,
        ordernumber: null,
        obrCode: null,
        obrName: null,
        obxList: [], // Array to store associated OBX segments
      };
      
      if (segment.startsWith('OBR')) {
        let listOBRValue = segment.split('|');
        obr.orderdatetime = listOBRValue[7] ? moment(listOBRValue[7], 'YYYYMMDDHHmmss').format('DD/MM/YYYY HH:mm:ss') : "";
        obr.ordernumber = listOBRValue[2].split('^')[0];
        let obrCodeName = listOBRValue[4].split('^');
        let userCode1 = listOBRValue[34].split('^')[0];
        let hisUserCode1 = await userModel.getUserByCode(userCode1, org[0]._id);
        if(!hisUserCode1[0]) {
          obr.usercodeErr = "T";
        }
        obr.usercode1 =  hisUserCode1[0] ? hisUserCode1[0].code : userCode1;
        obr.obrCode = obrCodeName[0];
        obr.obrName = obrCodeName[1];
        currentOBR = obr;
        hisOBR = await labresultModel.getlabData(obrCodeName[0].trim());

        hisresultItems = hisOBR.filter(function(item) {
          return item._id.code === currentOBR.obrCode
        })[0]

        if(hisresultItems)
          hisresultItems = hisresultItems.resultitems;

      } else if (segment.startsWith('OBX')) {
        if (currentOBR) {
          let obx = {
            display: null,
            obxCode: null,
            obxName: null,
            obxValue: null,
            obxUnit: null,
            obxRange: null,
          };

          const listOBXValue = segment.split('|');
          const obxCodeName = listOBXValue[3].split('^');
          obx.display = listOBXValue[1];
          obx.obxCode = obxCodeName[0];
          let existResultItems = null;
          if(hisresultItems) {
            if(hisresultItems.length > 1){
              existResultItems = hisresultItems.find(item => (item.resultcode).toString().trim() === (obxCodeName[0]).toString().trim() );
              obx.resultType =  hisresultItems[0].resulttype;
              obx.hisdisplay = existResultItems ? existResultItems.displayorder : "";
            } else {
              existResultItems = hisresultItems[0].resultcode ? (hisresultItems[0].resultcode).toString().trim() === (obxCodeName[0]).toString().trim() : "";
              obx.resultType =  hisresultItems[0].resulttype;
              obx.hisdisplay = hisresultItems[0].displayorder;
            }
          }

          if(existResultItems) {
            obx.exists = 'T';
          } else {
            obx.exists = 'F';
          }
          obx.obxName = obxCodeName[1];
          obx.obxValue = listOBXValue[5];
          obx.obxUnit = listOBXValue[6];
          obx.obxRange = listOBXValue[7];
          obx.obxFlag = listOBXValue[8];
          obx.datetime = listOBXValue[14] ? moment(listOBXValue[14], 'YYYYMMDDHHmmss').format('DD/MM/YYYY HH:mm:ss') : "";
          let userCode2 = listOBXValue[16].split('^')[0];
          let hisUserCode2 = await userModel.getUserByCode(userCode2, org[0]._id);

          if(!hisUserCode2[0]) {
            obx.usercodeErr = "T";
          }

          if(obx.resultType == 'NUMERIC' && !(!isNaN(parseFloat(obx.obxValue)) && isFinite(obx.obxValue))) {
            obx.valueTypeErr = "T";
          } else {
            obx.valueTypeErr = "F";
          }

          obx.usercode =  hisUserCode2[0] ? hisUserCode2[0].code : userCode2;
          currentOBR.obxList.push(obx);
          data.push(currentOBR);
        }
      }
     
    }
  }

  let uniqueData = Array.from(new Set(data.map(JSON.stringify))).map(JSON.parse);

  return res.renderPage(view('labresult'), {
    title:  'Validate Labresult (ORU) จาก LIS',
    data : uniqueData,
    mrn : mrn,
    vn : vn
  });
}