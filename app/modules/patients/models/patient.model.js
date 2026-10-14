const mongoose = require("mongoose");
exports.getlabData = async function (labcode) {

  let labresults = await mongoose.connection.db
    .collection("labmasters")
    .aggregate(
      [
        {
            $match : {
                "code" : labcode
            
            }  
        },
        {
            "$unwind": {
                "path": "$resultitems",
                "preserveNullAndEmptyArrays": true
            }
        },
        {
            
            $project : {
                "resultitemuid" : "$resultitems.resultitemuid",
                "code" : "$code",
                "name" : "$name",
                "orderitemuid" : "$orderitemuid",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]}
            }
        },
        {
            "$lookup": {
                "from": "orderresultitems",
                "localField": "resultitemuid",
                "foreignField": "_id",
                "as": "orderresultitems"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$orderresultitems"
            }
        },
        {
            $project : {
                "resultitemuid" : "$resultitems.resultitemuid",
                "code" : "$code",
                "name" : "$name",
                "resultcode" : "$orderresultitems.code",
                "resultname" : "$orderresultitems.name",
                "resultuomuid"  : "$orderresultitems.uomuid",
                "orderitemuid" : "$orderitemuid",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]}
            }
        },
        {
            "$lookup": {
                "from": "referencevalues",
                "localField": "resultuomuid",
                "foreignField": "_id",
                "as": "referencevalues"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$referencevalues"
            }
        },
        {
            
            $project : {
                "resultitemuid" : 1,
                "code" : 1,
                "name" : 1,
                "resultcode" : 1,
                "resultname" : 1,
                "uom" : "$referencevalues.valuedescription",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]},
                "OBX_HL7_RESULT_CODE" : { $concat:["$resultcode","^","$resultname","^", "$resultname"]}
            }
        },
        {
            $group: {
                 _id: {"code" : "$code", "name" : "$name", "OBR_HL7_ORDER_CODE" : "$OBR_HL7_ORDER_CODE"},
                 resultitems:{$push: {
                     resultcode:"$resultcode",
                     resultname:"$resultname",
                     uom:"$uom",
                     OBX_HL7_RESULT_CODE:"$OBX_HL7_RESULT_CODE"
                 }},
            }}
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

  return labresults;
};

exports.getPatientUID = async function (hn) {
    let patientuid = '';
    let patient = await mongoose.connection.db
    .collection("patients")
    .aggregate(
        [
            {
                $match : {
                    "mrn" : {$eq : hn}
                }  
            }
        ]
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      res.status(200).json(err);
    });

    patientuid = patient.length > 0 ? patient[0]._id : "";

    return patientuid;
}

exports.getPatientData = async function (hn) {
    let patient = await mongoose.connection.db
    .collection("patients")
    .aggregate(
        [
            {
                $match : {
                    "mrn" : {$eq : hn}
                
                }  
            },
            {
                "$lookup": {
                    "from": "referencevalues",
                    "localField": "titleuid",
                    "foreignField": "_id",
                    "as": "title"
                }
            },
            {
                "$unwind": {
                    "preserveNullAndEmptyArrays": true,
                    "path": "$title"
                }
            },
            {
                "$lookup": {
                    "from": "referencevalues",
                    "localField": "genderuid",
                    "foreignField": "_id",
                    "as": "gender"
                }
            },
            {
                "$unwind": {
                    "preserveNullAndEmptyArrays": true,
                    "path": "$gender"
                }
            },
            {
                "$lookup": {
                    "from": "patientadditionaldetails",
                    "localField": "_id",
                    "foreignField": "patientuid",
                    "as": "patientadditionaldetails"
                }
            },
            {
                "$unwind": {
                    "preserveNullAndEmptyArrays": true,
                    "path": "$patientadditionaldetails"
                }
            },
            {
                "$unwind": {
                    "preserveNullAndEmptyArrays": true,
                    "path": "$patientadditionaldetails.aliasnames"
                }
            },
            {
              "$lookup": {
                  "from": "users",
                  "localField": "createdby",
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
            {
            
                $project : {
                    "title" : "$title",
                    "name" : "$firstname",
                    "surname" : "$lastname",
                    "idcard" : "$nationalid",
                    "title" : "$title.valuedescription",
                    "gender" : "$gender.relatedvalue",
                    "nameeng" : "$patientadditionaldetails.aliasnames.firstname",
                    "surnameeng" : "$patientadditionaldetails.aliasnames.lastname",
                    "mobile" : "$contact.mobilephone",
                    "dob" : { $dateToString: { date :"$dateofbirth", format : "%Y%m%d", timezone : "Asia/Bangkok", onNull: "" }},
                    "usercode" : "$user.code",
                    "username" : "$user.name"
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

  return patient;
}

exports.getPatientMergeData = async function (orguid, patientuid) {
    let initfilter = {};
    initfilter.statusflag = 'A'
    initfilter.orguid =  mongoose.Types.ObjectId(orguid);

    if(patientuid) {
      initfilter = {
        statusflag : 'A',
        orguid : mongoose.Types.ObjectId(orguid),
        $or: [
          {
            "primarypatientuid": mongoose.Types.ObjectId(patientuid)
          },
          {
            "secondarypatientuid": mongoose.Types.ObjectId(patientuid)
          }
        ]
      }
    }
       
        
    let patientmerges = await mongoose.connection.db
    .collection("patientmerges")
    .aggregate(
        [
            {
                $match : initfilter
            },
            { $sort : { "mergedate" : -1}},
            { $limit : 50 },
            { $lookup: { from: "patients", localField: "primarypatientuid", foreignField: "_id", as: "pripatient" } },
            { $unwind: { path: "$pripatient", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", localField: "secondarypatientuid", foreignField: "_id", as: "secpatient" } },
            { $unwind: { path: "$secpatient", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "mergedbyuseruid", foreignField: "_id", as: "mergedbyuseruid" } },
            { $unwind: { path: "$mergedbyuseruid", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "reasonuid", foreignField: "_id", as: "reasonuid" } },
            { $unwind: { path: "$reasonuid", preserveNullAndEmptyArrays: true } },
            {
                $project : {
                    'mergeseqno' : "$mergeseqno",
                    'mergedate' :  { $dateToString: { date : "$mergedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                    'primaryhn' : "$pripatient.mrn",
                    'secmaryhn' : "$secpatient.mrn",
                    'isunmerged' : "$isunmerged",
                    "reasonuid" : "$reasonuid.valuedescription",
                    "mergedby" : "$mergedbyuseruid.name",
                    "dateforsort" : "$mergedate"
                }
            }
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

  return patientmerges;
}

exports.gePatientAuditLogsData = async function (orguid, patientuid = '', limit = 0) {
  let initfilter = {};

  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  initfilter.patientuid = patientuid;

  let auditlogs = await mongoose.connection.db
    .collection("auditlogs")
    .aggregate(
      [
        {
            $match : initfilter
        },
        // Newest first, then limit (limit 0 = all); an empty {} stage would make Mongo reject the pipeline.
        { $sort : { "auditdate" : -1}},
        ...(limit > 0 ? [{ $limit : limit }] : []),
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "useruid" } },
        { $unwind: { path: "$useruid", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                'auditdateforsort' : "$auditdate",
                'url' : "$url",
                'dataset' :  "$dataset",
                'postaudit' : "$postaudit",
                'useruid' : "$useruid.name",
                'auditdate' : { $dateToString: { date : "$auditdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            }
        }
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

exports.gePatientAuditLogsDetail = async function (orguid, id = '') {
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

  exports.gePatientAlerts = async function (orguid, patientuid = '') {
    let initfilter = {};
    initfilter.orguid = mongoose.Types.ObjectId(orguid);
    initfilter.patientuid = mongoose.Types.ObjectId(patientuid);

    let alerts = await mongoose.connection.db
      .collection("alerts")
      .aggregate(
        [
            {
                $match : initfilter
            },
            { $unwind: { path: "$alerts", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patientuid" } },
            { $unwind: { path: "$patientuid", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "alerts.alerttypeuid", foreignField: "_id", as: "alerttype" } },
            { $unwind: { path: "$alerttype", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisit" } },
            { $unwind: { path: "$patientvisit", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", localField: "departmentuid", foreignField: "_id", as: "department" } },
            { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    "visitid" : "$patientvisit.visitid",
                    "department" : "$department.name",
                    "startdate" : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                    "enddate" : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                    'alerttype' : "$alerttype.valuedescription",
                    'alertmessage' : "$alerts.alertmessage",
                    'isactive' : "$alerts.isactive",
                    'isalldepartments' : "$alerts.alldepartments"
                }
            }
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
  
    return alerts;
  };

