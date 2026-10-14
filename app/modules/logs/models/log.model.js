const mongoose = require("mongoose");
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/dateHelper");
const { WebClient } = require("@slack/web-api");
exports.getImportLogData = async function (dataset, datasetcode, resulttype = 'ERROR', isExport = false) {
  let filter = {};
  
  filter.statusflag = 'A';

  if(datasetcode)
    filter.datasetcode = datasetcode;

  if(dataset)
    filter.dataset = dataset;

  if(resulttype) {
    if(resulttype == 'ERROR') {
      filter.resulttype = { $eq : resulttype}
    } else {
      filter.resulttype = { $ne : 'ERROR'}
    }  
  }

  let limit = { $limit : 2000};
  if(!datasetcode && !dataset && !resulttype) {
    limit = { $limit : 50}
  }

  // Sort and limit before the lookups so only the returned rows are joined.
  let pipeline =     [
    { $match : filter },
    { $sort : { auditdate : -1}},
    ...(isExport ? [] : [limit]),
    {
      "$lookup": {
          "from": "users",
          "localField": "useruid",
          "foreignField": "_id",
          "as": "user"
      }
    },
    {
      "$unwind": {
          "preserveNullAndEmptyArrays": true,
          "path": "$user"
      }
    },
    { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
    { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
    { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "organisations", localField: "orguid", foreignField: "_id", as: "organisation" } },
    { $unwind: { path: "$organisation", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "referencevalues", localField: "datasetuid", foreignField: "_id", as: "referencevalues" } },
    { $unwind: { path: "$referencevalues", preserveNullAndEmptyArrays: true } },
    {  
      $project : {
          username : "$user.name",
          auditdate : { $dateToString: { date : "$auditdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          dataset : "$dataset",
          datasetcode: {
            $cond: {
              if: { $eq: ["$dataset", "REFERENCEVALUE"] }, // Condition: If "fieldName" is null
              then: "$referencevalues.valuecode",
              else: "$datasetcode"
            }
          },
          resulttype : "$resulttype",
          errorlog : "$errorlog",
          createdby : "$createdby.name",
          createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          modifiedby : "$modifiedby.name",
          modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          modifiedatforsort :  "$auditdate",
          organisation :  "$organisation.name"
      }
    }
  ]

  let importlogs = await mongoose.connection.db
  .collection("importlogs")
  .aggregate(
    pipeline,
    { allowDiskUse: true }
  )
  .toArray()
  .then(function (res) {
    return res;
  })
  .catch(function (err) {
    res.status(200).json(err);
  });

  return importlogs;
}


exports.getAuditLogData = async function (dataset, datasetuid) {
  
  let datestart = new Date(moment().subtract(7, 'days').toISOString());
  let dateto = new Date(moment().toISOString());
  let filter = {};

  let addlookup = {
    from: "referencedomains",
    localField: "datasetuid",
    foreignField: "_id",
    as: "datasets"
  };

  filter.auditdate = { $gte: datestart, $lte: dateto }

  if(datasetuid)
    filter.datasetuid = mongoose.Types.ObjectId(datasetuid);
   
  filter.statusflag = 'A';

  if(dataset){
    filter.dataset = {$eq : dataset};

    if(dataset == 'ReferenceDomain') {
      addlookup = {
        from: "referencedomains",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'Tariffs') {
      addlookup = {
        from: "tariffs",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'OrderItem') {
      addlookup = {
        from: "orderitems",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
      
    } else if(dataset == 'OrderSet') {
      addlookup = {
        from: "ordersets",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'DrugMaster') {
      addlookup = {
        from: "drugmasters",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'ITEM_MASTER') {
      addlookup = {
        from: "itemmasters",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'FormTemplate') {
      addlookup = {
        from: "formtemplates",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'CertTemplate') {
      addlookup = {
        from: "certificatetemplates",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'REPORT TEMPLATE') {
      addlookup = {
        from: "reporttemplates",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'TaskMaster') {
      addlookup = {
        from: "tasks",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'ThirdPartySetting') {
      addlookup = {
        from: "thirdpartysettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'OrderRouteMap') {
      addlookup = {
        from: "orderroutemaps",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'DrugGroup') {
      addlookup = {
        from: "druggroups",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'OrderResultItem') {
      addlookup = {
        from: "orderresultitems",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'SequenceNumber') {
      addlookup = {
        from: "sequencenumbers",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'RadiologySetting') {
      addlookup = {
        from: "radiologysettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'RegistrationSetting') {
      addlookup = {
        from: "registrationsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'OrderSetting') {
      addlookup = {
        from: "ordersettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'EMRSetting') {
      addlookup = {
        from: "emrsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'DoctorWorkbenchSetting') {
      addlookup = {
        from: "doctorworkbenchsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'EmergencySetting') {
      addlookup = {
        from: "emergencysettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'ANCSetting') {
      addlookup = {
        from: "ancsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'BatchJobSetting') {
      addlookup = {
        from: "batchjobsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'PharmacyWorklistSetting') {
      addlookup = {
        from: "pharmacyworklistsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'InventorySetting') {
      addlookup = {
        from: "inventorysettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'InpatientSetting') {
      addlookup = {
        from: "inpatientsettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'Billing Parameters') {
      addlookup = {
        from: "billingparameters",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'PharmacySetting') {
      addlookup = {
        from: "pharmacysettings",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'GenerateBedCharges') {
      addlookup = {
        from: "organisations",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }else if(dataset == 'EDC Config') {
      addlookup = {
        from: "edcconfigs",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    } else if(dataset == 'Department') {
      addlookup = {
        from: "departments",
        localField: "datasetuid",
        foreignField: "_id",
        as: "datasets"
      }
    }
  }

  let auditlogs = await mongoose.connection.db
  .collection("auditlogs")
  .aggregate(
    [
      { $match : filter },
      { $sort : { _id : -1}},
      {
        "$lookup": {
            "from": "users",
            "localField": "useruid",
            "foreignField": "_id",
            "as": "user"
        }
      },
      {
        "$unwind": {
            "preserveNullAndEmptyArrays": true,
            "path": "$user"
        }
      },
      { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
      { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
      { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "organisations", localField: "orguid", foreignField: "_id", as: "organisation" } },
      { $unwind: { path: "$organisation", preserveNullAndEmptyArrays: true } },
      { $lookup: addlookup},
      { $unwind: { path: "$datasets", preserveNullAndEmptyArrays: true } },
      {  
        $project : {
            username : "$user.name",
            auditdate : { $dateToString: { date : "$auditdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            dataset : "$dataset",
            datasetcode : "$datasets.code",
            datasetname : "$datasets.name",
            url: "$url",
            useruid : "$modifiedby.name",
            postaudit : '$postaudit',
            createdby : "$createdby.name",
            createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            modifiedby : "$modifiedby.name",
            modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            modifiedatforsort :  "$auditdate",
            organisation :  "$organisation.name"
        }
      },
    ],
    { allowDiskUse: true }
  )
  .toArray()
  .then(function (res) {
    return res;
  })
  .catch(function (err) {
    res.status(200).json(err);
  });

  return auditlogs;
}

exports.geAuditLogsDetail = async function (orguid, id = '') {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter._id = mongoose.Types.ObjectId(id);

  let auditlogs = await mongoose.connection.db
    .collection("auditlogs")
    .aggregate(
      [
        {
            $match : initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patientuid" } },
        { $unwind: { path: "$patientuid", preserveNullAndEmptyArrays: true } },
    ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return auditlogs;
};

exports.getUid = async function (data = {} ) {
  let initfilter = {};
  
  initfilter.statusflag = 'A';
  initfilter.orguid = mongoose.Types.ObjectId(data.orguid);
  initfilter.code = data.code;
  
  let result = await mongoose.connection.db
    .collection(data.collection)
    .aggregate(
    [
      {
        $match : initfilter
      },
    ],
    { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else
        return '';
    }).catch(function (err) {
      console.log(err);
    });
  
    return result;
  }


exports.getTodayActiveSession = async function () {
  let initfilter = {};
  
  initfilter.statusflag = 'A';
  let current_date = moment().format('YYYY-MM-DD');
  let datestart = helpers.fromDateUTC(current_date);
  let dateto = helpers.toDateUTC(current_date)

  initfilter.lastactivitydate = { $gte: datestart, $lte: dateto }

    let loginsessions = await mongoose.connection.db
    .collection("loginsessions")
    .aggregate(
      [
        {
            $match : initfilter
        },
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "departments", localField: "departmentuid", foreignField: "_id", as: "department" } },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        {
          $project : {
            "loginname" : "$loginname",
            "name" : "$user.name",
            "department_name" : "$department.name",
            "ipaddress" : "$ipaddress",
            "lastactivitydate" :  { $dateToString: { date : "$lastactivitydate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          }
        },
        { $sort : { lastactivitydate : -1}},
    ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return loginsessions;
}

exports.exportAllActiveSessions = async function (orguid) {
  let initfilter = {};
    let loginsessions = await mongoose.connection.db
    .collection("loginsessions")
    .aggregate(
      [
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "departments", localField: "departmentuid", foreignField: "_id", as: "department" } },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        {
          $project : {
            "loginname" : "$loginname",
            "name" : "$user.name",
            "department_name" : "$department.name",
            "ipaddress" : "$ipaddress",
            "lastactivitydate" :  { $dateToString: { date : "$lastactivitydate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          }
        },
        { $sort : { lastactivitydate : -1}},
    ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return loginsessions;
}


exports.getSapLogs = async function (orguid, isdone = false, identifierkey, responsestatus, fromDate, toDate, isexport = false) {
  let initfilter = {};

  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(fromDate && toDate){
    let datestart = helpers.fromDateUTC(fromDate);
    let dateto = helpers.toDateUTC(toDate);
    initfilter.fromdate = { $gte: datestart };
    initfilter.todate = { $lte: dateto };
  }

  if(isdone  == 'true')
    initfilter.isdone =  true;
  else if(isdone == 'false')
    initfilter.isdone =  false;

  if(identifierkey)
    initfilter.identifierkey =  identifierkey;

  if(responsestatus)
    initfilter.responsestatus =  responsestatus;

  let pipeline = [
      {
          $match : initfilter
      },
      {
        $project : {
          _id : "$_id",
          transactioncode : "$transactioncode",
          transactiontype : "$transactiontype",
          createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          fromdate : { $dateToString: { date : "$fromdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          todate : { $dateToString: { date : "$todate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          fromdate2 : { $dateToString: { date : "$fromdate", format : "%d-%m-%Y", timezone : "Asia/Bangkok" }},
          todate2 : { $dateToString: { date : "$todate", format : "%d-%m-%Y", timezone : "Asia/Bangkok" }},
          domain : "$domain",
          identifierkey : "$identifierkey",
          responsemessage : "$responsemessage",
          responsestatus : "$responsestatus",
          isdone : "$isdone"
        }
      },
      { $sort : { _id : -1}},
    ];

    if((!fromDate && !toDate) || !isexport) {
      pipeline.push({$limit: 100});
    }

  let sapLogs = await mongoose.connection.db
    .collection("plugin_saploggers")
    .aggregate(pipeline,
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return sapLogs;
}

exports.getPatientMigrationLogCount = async function (interfaceUserId) {
  let filter = {};
  filter.statusflag = 'A';
  filter.patientexisthn =  { $exists: true };

  if(interfaceUserId)
    filter.createdby = mongoose.Types.ObjectId(interfaceUserId);

  let count = await mongoose.connection.db
  .collection("patients")
  .aggregate([
    {
      $match: filter
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getPatientMigrationSequenceNumber = async function (orguid) {
  let filter = {};
  filter.statusflag = 'A';
  filter.orguid = mongoose.Types.ObjectId(orguid);
  filter.code = 'PATIENTID';

  let count = await mongoose.connection.db
  .collection("sequencenumbers")
  .aggregate([
    {
      $match: filter
    },
    {
      $project: {
        runningvalue : "$runningvalue"
      }
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].runningvalue;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getPatientAddMigrationLogCount = async function (interfaceUserId) {
  let filter = {};
  filter.statusflag = 'A';

  if(interfaceUserId)
    filter.createdby = mongoose.Types.ObjectId(interfaceUserId);

  let count = await mongoose.connection.db
  .collection("patientadditionaldetails")
  .aggregate([
    {
      $match: filter
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getPatientImagesMigrationLogCount = async function (interfaceUserId) {
  let filter = {};
  filter.statusflag = 'A';
  filter.comments = { $regex: /migration/i };

  if(interfaceUserId)
    filter.createdby = mongoose.Types.ObjectId(interfaceUserId);

  let count = await mongoose.connection.db
  .collection("patientimages")
  .aggregate([
    {
      $match: filter
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getMRDLogCount = async function (interfaceUserId) {
  let filter = {};
  filter.statusflag = 'A';

  if(interfaceUserId)
    filter.createdby = mongoose.Types.ObjectId(interfaceUserId);

  let count = await mongoose.connection.db
  .collection("mrdfolders")
  .aggregate([
    {
      $match: filter
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getPatientAllergyLogCount = async function (interfaceUserId) {
  let filter = {};
  filter.statusflag = 'A';

  if(interfaceUserId)
    filter.createdby = mongoose.Types.ObjectId(interfaceUserId);

  let count = await mongoose.connection.db
  .collection("allergies")
  .aggregate([
    {
      $match: filter
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}

exports.getGRLogCount = async function () {
  let filter = {};
  filter.statusflag = 'A';
  filter.invoicenumber = 'IMPORTINTERFACE';
  filter.comments = 'Opening Stock Import';

  let count = await mongoose.connection.db
  .collection("goodsreceives")
  .aggregate([
    {
      $match: filter
    },
    { $lookup: { from: "referencevalues", localField: "grntypeuid", foreignField: "_id", as: "grntype" } },
    { $unwind: { path: "$grntype", preserveNullAndEmptyArrays: true } },
    {
      $match: {$or: [
        { grntype: "RCVBOR" },
        { grntype: "RCVOB" }
      ]}
    },
    {
      $count: "total"
    }
  ])
  .toArray()
  .then(function (res) {
    if (res.length > 0) {
      return res[0].total;
    } else {
      return 0; // No matching documents
    }
  }).catch(function (err) {
    res.status(200).json(err);
  });

  return count;
}


exports.getSlackBackupLogs = async function () {
    const token = process.env.SLACK_BOT_TOKEN || "";
    let results = [];

    if(token != "") {
      const client = new WebClient(token);

      results = await client.conversations.history({
        channel: process.env.SLACK_BACKUP_CHANNEL_ID,
        limit: 5, // number of messages
      });
    }
   
    return results;
}