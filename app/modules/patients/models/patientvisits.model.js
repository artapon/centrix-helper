const mongoose = require("mongoose");
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/date.helper");
exports.getPatientVisitUID = async function (vn) {
  let visituid = '';
  let patientvisit = await mongoose.connection.db
  .collection("patientvisits")
  .aggregate(
      [
          {
              $match : {
                  "visitid" : {$eq : vn}
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

  visituid = patientvisit.length > 0 ? patientvisit[0]._id : "";

  return visituid;
}
exports.getVisitData = async function (visitid) {
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : {
                    "statusflag" : "A",
                    "visitid" : { $eq : visitid}
                }  
            },
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
            { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
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

  return patientvisits;
};

exports.getVisitDataByUid = async function (patientvisituid) {
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : {
                    "_id" : mongoose.Types.ObjectId(patientvisituid),
                    "statusflag" : "A"
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

  return patientvisits;
};

exports.getVisitSearchData = async function (visitid, mrn) {
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : {
                    "statusflag" : "A",
                 
                }  
            },
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
            { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
            {
              $match : {
                  "mrn" : "$patients.mrn",
                  "visitid" : visitid
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

  return patientvisits;
};

exports.getFirtVisitData = async function () {
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : {
                    "statusflag" : "A"
                }  
            },
            { $sort: { "startdate": -1 } },
            {$limit : 1},
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patient" } },
            { $unwind: { path: "$patient", preserveNullAndEmptyArrays: true } },
            
        ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err)
      return err;
    });

  return patientvisits;
};

exports.getVisitAll = async function (orguid , visituid , patientuid , visitstatusuid, page = 0, entypeuid = '', visitdate = '') {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  if(visitstatusuid)
    initfilter.visitstatusuid = mongoose.Types.ObjectId(visitstatusuid);

  if(entypeuid)
    initfilter.entypeuid = mongoose.Types.ObjectId(entypeuid);

  if(visitdate) {
    let startOfDay = moment.tz(visitdate + " 00:00:00", "YYYY-MM-DD HH:mm:ss", "Asia/Bangkok").toDate();
    let endOfDay = moment.tz(visitdate + " 23:59:59", "YYYY-MM-DD HH:mm:ss", "Asia/Bangkok").toDate();
    initfilter.startdate = { $gte: startOfDay, $lte: endOfDay };
  }

  let perpage = 50;
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : initfilter
            },
            { $sort : { _id : -1}},
            { "$skip": page * perpage },
            { "$limit": perpage },
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
            { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
            { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
            { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
            { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
            { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "admissionrequests", localField: "admissionrequestuid", foreignField: "_id", as: "admissionrequest" } },
            { $unwind: { path: "$admissionrequest", preserveNullAndEmptyArrays: true } },
            {
                $project : {
                        visitid : "$visitid",
                        visitidbeforeconvert : "$visitidbeforeconvert",
                        hn : "$patients.mrn",
                        entype : "$entype.valuedescription",
                        visitstatus : "$visitstatus.valuedescription",
                        isreadmission : { $ifNull : ["$isreadmission", '']},
                        isadmitted :  { $ifNull : ["$admissionrequest.isadmitted", '']},
                        isvisitanonymous : { $ifNull : ["$isvisitanonymous", '']},
                        ispatientpregnant : { $ifNull : ["$ispatientpregnant", '']},
                        showprecaution : { $ifNull : ["$showprecaution", '']},
                        ispatientlactaion : { $ifNull : ["$ispatientlactaion", '']},
                        startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        createdby : "$createdby.name",
                        modifiedby : "$modifiedby.name",
                        modifiedatforsort : "$modifiedat",        
                        fvisitcareprovider : { $arrayElemAt: [ "$visitcareproviders", 0 ] },
                        lvisitcareprovider : { $arrayElemAt: [ "$visitcareproviders", -1 ] },
                        fdepartmentjourney : { $arrayElemAt: [ "$visitjourneys", 0 ] },
                        ldepartmentjourney : { $arrayElemAt: [ "$visitjourneys", -1 ] },
                        mdepartmentjourney : { $arrayElemAt: [ {
                          $filter: {
                             input: "$visitjourneys",
                             as: "visitjourneys",
                             cond: { $eq: [ "$$visitjourneys.statusuid",  mongoose.Types.ObjectId("5784c4d032f3003ef802ae1b")] }
                          }
                        }, 0 ] },
                        isconvertedfromopd : "$isconvertedfromopd"
                }
            },
            { $lookup: { from: "users", localField: "fvisitcareprovider.careprovideruid", foreignField: "_id", as: "fcareprovider" } },
            { $unwind: { path: "$fcareprovider", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", localField: "fdepartmentjourney.departmentuid", foreignField: "_id", as: "fdepartment" } },
            { $unwind: { path: "$fdepartment", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "fdepartmentjourney.statusuid", foreignField: "_id", as: "fjourney" } },
            { $unwind: { path: "$fjourney", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "lvisitcareprovider.careprovideruid", foreignField: "_id", as: "lcareprovider" } },
            { $unwind: { path: "$lcareprovider", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", localField: "ldepartmentjourney.departmentuid", foreignField: "_id", as: "ldepartment" } },
            { $unwind: { path: "$ldepartment", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", localField: "mdepartmentjourney.departmentuid", foreignField: "_id", as: "mdepartment" } },
            { $unwind: { path: "$mdepartment", preserveNullAndEmptyArrays: true } },
            {
              $project : {
                      visitid : 1,
                      visitidbeforeconvert : 1,
                      hn : 1,
                      entype : 1,
                      visitstatus : {$ifNull: ["$visitstatus", '$fjourney.valuedescription']},
                      isreadmission : 1,
                      isvisitanonymous : 1,
                      startdate : 1,
                      enddate : 1,
                      createdby : 1,
                      modifiedby : 1,
                      modifiedat : 1,
                      modifiedatforsort : 1,
                      fcareproviders : "$fcareprovider.name",
                      fdepartment : "$fdepartment.name",
                      lcareproviders : "$lcareprovider.name",
                      ldepartment : "$ldepartment.name",
                      mdepartmentjourney : "$mdepartment.name",
                      ispatientpregnant : 1,
                      showprecaution : 1,
                      ispatientlactaion : 1,
                      isconvertedfromopd : 1,
                      isadmitted : 1
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

  return patientvisits;
};

exports.getVisitByStatus = async function (status, orguid , limit = 200) {
  // Resolve the status text to its reference value ids first, so visits are filtered
  // (and limited) before the lookups instead of joining every visit of the org.
  const statusuids = await mongoose.connection.db
    .collection("referencevalues")
    .find({ valuedescription: status }, { projection: { _id: 1 } })
    .map((ref) => ref._id)
    .toArray();

  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
        [
            {
                $match : {
                  "statusflag" : "A",
                   "orguid" : mongoose.Types.ObjectId(orguid),
                   "visitstatusuid" : { $in : statusuids }
                }
            },
            { $sort : { startdate : -1}},
            { $limit :  limit},
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
            { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
            { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
            { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
            { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
            { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
            {
                $project : {
                        visitid : "$visitid",
                        hn : "$patients.mrn",
                        entype : "$entype.valuedescription",
                        visitstatus : "$visitstatus.valuedescription",
                        isreadmission : "$isreadmission",
                        isvisitanonymous : "$isvisitanonymous",
                        startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        createdby : "$createdby.name",
                        modifiedby : "$modifiedby.name",
                        modifiedatforsort : "$modifiedat",
                        dateforsort : "$startdate",
                        modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        medicaldischargedate :  { $dateToString: { date : "$medicaldischargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }}
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

  return patientvisits;
};

exports.getTodayVisitByCareprovider = async function (currentdate, orguid) {
  let initfilter = {};
  initfilter.statusflag = 'A';
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  let current_date = moment().format('YYYY-MM-DD');

  if(currentdate)
    currentdate = currentdate
    
  let datestart = helpers.fromDateUTC(current_date);
  let dateto = helpers.toDateUTC(current_date)

  initfilter.startdate = { $gte: datestart, $lte: dateto }
    
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
            $match : initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                    visitid : "$visitid",
                    hn : "$patients.mrn",
                    entype : "$entype.valuedescription",
                    visitstatus : "$visitstatus.valuedescription",
                    startdate : { $dateToString: { date : "$startdate", format : "%Y-%m-%d", timezone : "Asia/Bangkok" }},
                    modifiedatforsort : "$modifiedat",
                    visitcareproviders : { $arrayElemAt: [ "$visitcareproviders", -1 ] },
                    fvisitjourneys : { $arrayElemAt: [ "$visitjourneys", 0] },

            }
        },
        { $lookup: { from: "referencevalues", localField: "fvisitjourneys.statusuid", foreignField: "_id", as: "fvisitstatus" } },
        { $unwind: { path: "$fvisitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "visitcareproviders.careprovideruid", foreignField: "_id", as: "careprovider" } },
        { $unwind: { path: "$careprovider", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "departments", localField: "visitcareproviders.departmentuid", foreignField: "_id", as: "department" } },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        {
          $project : {
                  visitid : 1,
                  hn : 1,
                  entype : 1,
                  visitstatus : {$ifNull: ["$visitstatus","$fvisitstatus.valuedescription"]},
                  startdate : 1,
                  careprovideruid : "$careprovider._id",
                  careprovidername : "$careprovider.name"
          }
      },
      {
        $match : {
          careprovidername : {$ne : null},
          visitstatus : { $in : ["Arrived", "Registered"] }
        }
      },
      {
        $group: {
        _id: {careprovideruid : "$careprovideruid" , careprovidername : "$careprovidername"},
            visits : { $push : {visitid : "$visitid", hn : "$hn" , entype : "$entype"}}
        }
      },
      {
        $project : {
          careprovideruid : "$_id.careprovideruid",
          careprovidername : "$_id.careprovidername",
          activevisits :{ $size: "$visits" }
        }
      },
      {
        $match : {
          careprovidername : {$ne : ""},
         
        }
      },
      { $lookup: { from: "users", localField: "careprovideruid", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project : {
          defaultdepartment : "$user.defaultdepartment.name",
          careprovideruid : "$_id.careprovideruid",
          careprovidername : "$_id.careprovidername",
          activevisits : 1
        }
      },
      { $sort : {activevisits : -1, careprovidername : - 1} }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return patientvisits;
};

exports.getVisitByCareproviderUID = async function (currentdate, careprovideruid, orguid) {
  let initfilter = {};
  initfilter.statusflag = 'A';
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  let current_date = moment().format('YYYY-MM-DD');
  if(currentdate)
    currentdate = currentdate
    
  let datestart = helpers.fromDateUTC(current_date);
  let dateto = helpers.toDateUTC(current_date)

  initfilter.startdate = { $gte: datestart, $lte: dateto }
    
  let patientvisits = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
          $match : initfilter
        },
        { $unwind: { path: "$visitcareproviders", preserveNullAndEmptyArrays: true } },
        {
          $match : {
              "visitcareproviders.careprovideruid" : mongoose.Types.ObjectId(careprovideruid)
          }  
        },
        { $lookup: { from: "users", localField: "visitcareproviders.careprovideruid", foreignField: "_id", as: "careprovider" } },
        { $unwind: { path: "$careprovider", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
        $project : {
                careprovider : "$careprovider.name",
                visitid : "$visitid",
                hn : "$patients.mrn",
                entype : "$entype.valuedescription",
                visitstatus : "$visitstatus.valuedescription",
                isreadmission : { $ifNull : ["$isreadmission", '']},
                isvisitanonymous : { $ifNull : ["$isvisitanonymous", '']},
                ispatientpregnant : { $ifNull : ["$ispatientpregnant", '']},
                showprecaution : { $ifNull : ["$showprecaution", '']},
                ispatientlactaion : { $ifNull : ["$ispatientlactaion", '']},
                startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                createdby : "$createdby.name",
                modifiedby : "$modifiedby.name",
                modifiedatforsort : "$modifiedat",        
                fdepartmentjourney : { $arrayElemAt: [ "$visitjourneys", 0 ] },
                ldepartmentjourney : { $arrayElemAt: [ "$visitjourneys", -1 ] },
                mdepartmentjourney : { $arrayElemAt: [ {
                  $filter: {
                      input: "$visitjourneys",
                      as: "visitjourneys",
                      cond: { $eq: [ "$$visitjourneys.statusuid",  mongoose.Types.ObjectId("5784c4d032f3003ef802ae1b")] }
                  }
                }, 0 ] }
                    }
                },
                { $lookup: { from: "departments", localField: "fdepartmentjourney.departmentuid", foreignField: "_id", as: "fdepartment" } },
                { $unwind: { path: "$fdepartment", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "referencevalues", localField: "fdepartmentjourney.statusuid", foreignField: "_id", as: "fjourney" } },
                { $unwind: { path: "$fjourney", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "departments", localField: "ldepartmentjourney.departmentuid", foreignField: "_id", as: "ldepartment" } },
                { $unwind: { path: "$ldepartment", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "departments", localField: "mdepartmentjourney.departmentuid", foreignField: "_id", as: "mdepartment" } },
                { $unwind: { path: "$mdepartment", preserveNullAndEmptyArrays: true } },
                {
                  $project : {
                          careprovider : 1,
                          visitid : 1,
                          hn : 1,
                          entype : 1,
                          visitstatus : {$ifNull: ["$visitstatus", '$fjourney.valuedescription']},
                          isreadmission : 1,
                          isvisitanonymous : 1,
                          startdate : 1,
                          enddate : 1,
                          createdby : 1,
                          modifiedby : 1,
                          modifiedat : 1,
                          modifiedatforsort : 1,
                          fcareproviders : "$fcareprovider.name",
                          fdepartment : "$fdepartment.name",
                          lcareproviders : "$lcareprovider.name",
                          ldepartment : "$ldepartment.name",
                          mdepartmentjourney : "$mdepartment.name",
                          ispatientpregnant : 1,
                          showprecaution : 1,
                          ispatientlactaion : 1,
                  }
                },
                {
                  $match : {
                    visitstatus : { $in : ["Arrived", "Registered"] }
                  }
                },
       
    ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return patientvisits;
}

exports.getVisitJourneys = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  let visitjourneys = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
            $match :initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$visitjourneys", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "visitjourneys.careprovideruid", foreignField: "_id", as: "careprovider" } },
        { $unwind: { path: "$careprovider", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "departments", localField: "visitjourneys.departmentuid", foreignField: "_id", as: "department" } },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitjourneys.statusuid", foreignField: "_id", as: "statusuid" } },
        { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "visitjourneys.useruid", foreignField: "_id", as: "juser" } },
        { $unwind: { path: "$juser", preserveNullAndEmptyArrays: true } },
        {
          $project : {
                  visitid : "$visitid",
                  hn : "$patients.mrn",
                  entype : "$entype.valuedescription",
                  visitstatus : {$ifNull: ["$visitstatus.valuedescription", "$statusuid.valuedescription"]},
                  isreadmission : {$ifNull: ["$isreadmission", '']},
                  isvisitanonymous : {$ifNull: ["$isvisitanonymous", ""]},
                  startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  createdby : "$createdby.name",
                  modifiedby : "$modifiedby.name",
                  careprovider : {$ifNull: ["$careprovider.name",""]},
                  department : {$ifNull: ["$department.name",""]},
                  statusuid : "$statusuid.valuedescription",
                  useruid : "$juser.name",
                  vmodifiedat : { $dateToString: { date : "$visitjourneys.modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  dateforsort : "$startdate"
          }
        },
        { $sort : {dateforsort : -1} }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return visitjourneys;
};

exports.getBedoccupancy = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;
    
  let visitBedoccupancy = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
            $match :initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$bedoccupancy", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "wards", localField: "bedoccupancy.warduid", foreignField: "_id", as: "wards" } },
        { $unwind: { path: "$wards", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "beds", localField: "bedoccupancy.beduid", foreignField: "_id", as: "beds" } },
        { $unwind: { path: "$beds", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitjourneys.statusuid", foreignField: "_id", as: "statusuid" } },
        { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
        {
          $project : {
                  visitid : "$visitid",
                  hn : "$patients.mrn",
                  entype : "$entype.valuedescription",
                  visitstatus : { $ifNull: ["$visitstatus.valuedescription","$statusuid.valuedescription"]},
                  isreadmission : { $ifNull: ["$isreadmission", '']},
                  isvisitanonymous : { $ifNull: ["$isvisitanonymous", '']},
                  startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  createdby : "$createdby.name",
                  modifiedby : "$modifiedby.name",
                  wardcode : "$wards.code",
                  wardname : "$wards.name",
                  bedcode : "$beds.code",
                  bedname : "$beds.name",
                  bedstartdate : { $dateToString: { date : "$bedoccupancy.startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  isactive : { $ifNull: ["$bedoccupancy.isactive", '']},
                  isolatedbed : { $ifNull: ["$bedoccupancy.isolatedbed", '']},
                  modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  dateforsort : "$startdate"
          }
        },
        { $sort : {dateforsort : -1} }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return visitBedoccupancy;
};

exports.getVisitPayors = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;
    
  let visitVisitPayors = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
            $match :initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$visitpayors", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payors", localField: "visitpayors.payoruid", foreignField: "_id", as: "payors" } },
        { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payoragreements", localField: "visitpayors.payoragreementuid", foreignField: "_id", as: "payoragreements" } },
        { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tpas", localField: "visitpayors.tpauid", foreignField: "_id", as: "tpas" } },
        { $unwind: { path: "$tpas", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitcareproviders.statusuid", foreignField: "_id", as: "statusuid" } },
        { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
        {
          $project : {
                  visitid : "$visitid",
                  hn : "$patients.mrn",
                  entype : "$entype.valuedescription",
                  visitstatus : { $ifNull: ["$visitstatus.valuedescription","$statusuid.valuedescription"]},
                  isreadmission : { $ifNull: ["$isreadmission", '']},
                  isvisitanonymous : { $ifNull: ["$isvisitanonymous", '']},
                  startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  createdby : "$createdby.name",
                  modifiedby : "$modifiedby.name",
                  modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  payorcode : "$payors.code",
                  payorname : "$payors.name",
                  payoragreementscode : "$payoragreements.code",
                  payoragreementsname : "$payoragreements.name",
                  tpacode : "$tpas.code",
                  tpaname : "$tpas.name",
                  modifiedby : "$modifiedby.name",
                  dateforsort : "$startdate"
          }
        },
        { $sort : {dateforsort : -1} }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return visitVisitPayors;
};

exports.getVisitcareproviders = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;
    
  let visitcareproviders = await mongoose.connection.db
    .collection("patientvisits")
    .aggregate(
      [
        {
            $match :initfilter
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$visitcareproviders", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "departments", localField: "visitcareproviders.departmentuid", foreignField: "_id", as: "departments" } },
        { $unwind: { path: "$departments", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitcareproviders.visittypeuid", foreignField: "_id", as: "visittype" } },
        { $unwind: { path: "$visittype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "visitcareproviders.careprovideruid", foreignField: "_id", as: "careproviders" } },
        { $unwind: { path: "$careproviders", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitcareproviders.entypeuid", foreignField: "_id", as: "careproviderentype" } },
        { $unwind: { path: "$careproviderentype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "visitcareproviders.statusuid", foreignField: "_id", as: "careproviderst" } },
        { $unwind: { path: "$careproviderst", preserveNullAndEmptyArrays: true } },
        {
          $project : {
                  visitid : "$visitid",
                  hn : "$patients.mrn",
                  entype : "$entype.valuedescription",
                  visitstatus : { $ifNull: ["$visitstatus.valuedescription", "$careproviderst.valuedescription"]},
                  isreadmission : { $ifNull: ["$isreadmission", '']},
                  isvisitanonymous : { $ifNull: ["$isvisitanonymous", '']},
                  startdate : { $dateToString: { date : "$startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  enddate : { $dateToString: { date : "$enddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  createdby : "$createdby.name",
                  modifiedby : "$modifiedby.name",
                  modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  modifiedby : "$modifiedby.name",
                  dateforsort : "$startdate",
                  departmentcode : "$departments.code",
                  departmentname : "$departments.name",
                  visittype : "$visittype.valuedescription",
                  careprovidercode : "$careproviders.code",
                  careprovidername : "$careproviders.name",
                  careproviderentype : "$careproviderentype.valuedescription",
                  careproviderstartdate : { $dateToString: { date : "$visitcareproviders.startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                  isprimarycareprovider : "$visitcareproviders.isprimarycareprovider",
          }
        },
        { $sort : {dateforsort : -1} }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      if(res.length > 0)
        return res;
      else 
        return []
    })
    .catch(function (err) {
      console.log(err);
    });

  return visitcareproviders;
};