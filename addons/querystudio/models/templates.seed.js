// Built-in query templates: list pages of the app as Query Data templates, with the same pipelines:
// Patient Summary, Patient Visits Data, Patient Merges (app/modules/patients), Patient Orders Data
// (app/modules/orders), Patient Bills, Patient Chargecodes, Patient Deposits, Patient Creditnotes, Bill items
// and Chargecodes items (app/modules/billing), PharmacyOrders Data, Medsadmins Data, IP Fill Order Data
// (app/modules/orders), Lab Orders Data, RADIOLOGY Orders Data, Patient Diets (app/modules/orders) and
// Lab Master Data (app/modules/tools), Get Itemmasters, Get Interfaced GR and Available Items
// (app/modules/inventory). Details the pages add after their query (order item details,
// in-charge-code flags) are joined in the pipeline. The pages' own paging ($skip / $limit) is left out: Query
// Data pages the results. "key" ties a template to its built-in, so Query Template → Restore built-ins can add
// back one that was deleted.
module.exports = [
  {
    key: "patient-summary",
    name: "Patient Summary",
    category: "Patients",
    description: "One patient or visit as on the Patient Summary page: visits, bills, unbilled charges, deposits, credit notes, journeys, beds, payors, care providers, bed transfers, newborn details, alerts, merges, DF items and drug allergies. Give an HN, a VN or both; alerts, merges, DF items and allergies use the VN's patient when there is no HN.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: "any", default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: "any", default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Visits", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "admissionrequests",
      localField: "admissionrequestuid",
      foreignField: "_id",
      as: "admissionrequest"
    }
  },
  { $unwind: { path: "$admissionrequest", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      visitidbeforeconvert: "$visitidbeforeconvert",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: "$visitstatus.valuedescription",
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isadmitted: { $ifNull: ["$admissionrequest.isadmitted", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      ispatientpregnant: { $ifNull: ["$ispatientpregnant", ""] },
      showprecaution: { $ifNull: ["$showprecaution", ""] },
      ispatientlactaion: { $ifNull: ["$ispatientlactaion", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      modifiedatforsort: "$modifiedat",
      fvisitcareprovider: { $arrayElemAt: ["$visitcareproviders", 0] },
      lvisitcareprovider: { $arrayElemAt: ["$visitcareproviders", -1] },
      fdepartmentjourney: { $arrayElemAt: ["$visitjourneys", 0] },
      ldepartmentjourney: { $arrayElemAt: ["$visitjourneys", -1] },
      mdepartmentjourney: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$visitjourneys",
              as: "visitjourneys",
              cond: { $eq: ["$$visitjourneys.statusuid", ObjectId("5784c4d032f3003ef802ae1b")] }
            }
          },
          0
        ]
      },
      isconvertedfromopd: "$isconvertedfromopd"
    }
  },
  {
    $lookup: {
      from: "users",
      localField: "fvisitcareprovider.careprovideruid",
      foreignField: "_id",
      as: "fcareprovider"
    }
  },
  { $unwind: { path: "$fcareprovider", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "fdepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "fdepartment"
    }
  },
  { $unwind: { path: "$fdepartment", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "fdepartmentjourney.statusuid",
      foreignField: "_id",
      as: "fjourney"
    }
  },
  { $unwind: { path: "$fjourney", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "lvisitcareprovider.careprovideruid",
      foreignField: "_id",
      as: "lcareprovider"
    }
  },
  { $unwind: { path: "$lcareprovider", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "ldepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "ldepartment"
    }
  },
  { $unwind: { path: "$ldepartment", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "mdepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "mdepartment"
    }
  },
  { $unwind: { path: "$mdepartment", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: 1,
      visitidbeforeconvert: 1,
      hn: 1,
      entype: 1,
      visitstatus: { $ifNull: ["$visitstatus", "$fjourney.valuedescription"] },
      isreadmission: 1,
      isvisitanonymous: 1,
      startdate: 1,
      enddate: 1,
      createdby: 1,
      modifiedby: 1,
      modifiedat: 1,
      modifiedatforsort: 1,
      fcareproviders: "$fcareprovider.name",
      fdepartment: "$fdepartment.name",
      lcareproviders: "$lcareprovider.name",
      ldepartment: "$ldepartment.name",
      mdepartmentjourney: "$mdepartment.name",
      ispatientpregnant: 1,
      showprecaution: 1,
      ispatientlactaion: 1,
      isconvertedfromopd: 1,
      isadmitted: 1
    }
  }
])` },
      { title: "Bills", query: `db.patientbills.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "payors", localField: "payoruid", foreignField: "_id", as: "payors" } },
  { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "payoragreements",
      localField: "payoragreementuid",
      foreignField: "_id",
      as: "payoragreements"
    }
  },
  { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      billdate: { $dateToString: { date: "$billdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      billdate_seaech: { $dateToString: { date: "$billdate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      billdateforsort: "$billdate",
      canceldate: { $dateToString: { date: "$canceldate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      visitstatus: "$visitstatus.valuedescription",
      totalbillamount: "$totalbillamount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      isrefund: "$isrefund",
      iscancelled: "$iscancelled",
      isipdbill: "$isipdbill",
      isinterim: "$isinterim",
      isreceivable: "$isreceivable",
      interimfromdate: { $dateToString: { date: "$interimfromdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      interimtodate: { $dateToString: { date: "$interimtodate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      patientbilleditems: { $size: "$patientbilleditems" },
      paymentdetails: { $size: "$paymentdetails" }
    }
  }
])` },
      { title: "Unbilled charges (IPD)", query: `db.patientchargecodes.aggregate([
  {
    $match: {
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  { $sort: { _id: -1 } },
  {
    $project: {
      patientuid: "$patientuid",
      patientvisituid: "$patientvisituid",
      createdby: "$createdby",
      modifiedby: "$modifiedby",
      allocationinitialized: "$allocationinitialized",
      chargecodessize: { $size: "$chargecodes" }
    }
  },
  { $match: { chargecodessize: { $gt: 0 } } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $match: { "patientvisits.entypeuid": { $eq: ObjectId("59ef351fd2bbe66c36f99862") } } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      startdate: {
        $dateToString: { date: "$patientvisits.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      visitstatus: "$visitstatus.valuedescription",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      createdatforsort: "$createdat",
      visitdateforsort: "$patientvisits.startdate",
      chargecodes: "$chargecodessize",
      allocationinitialized: "$allocationinitialized",
      patientuid: 1,
      patientvisituid: 1
    }
  }
])` },
      { title: "Deposits", query: `db.deposits.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { depositdate: -1, _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "paymentmodeuid", foreignField: "_id", as: "paymentmode" }
  },
  { $unwind: { path: "$paymentmode", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      depositdate: { $dateToString: { date: "$depositdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      depositdateforsort: "$depositdate",
      mrn: "$patients.mrn",
      visitid: { $ifNull: ["$patientvisits.visitid", ""] },
      visitstatus: "$visitstatus.valuedescription",
      paidamount: "$paidamount",
      amount: "$amount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      isrefund: "$isrefund",
      iscancelled: "$iscancelled",
      isipddeposit: "$isipddeposit",
      isduetobillcancel: { $ifNull: ["$isduetobillcancel", ""] },
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      dateforsort: "$depositdate",
      paymentmode: "$paymentmode.valuedescription"
    }
  }
])` },
      { title: "Credit notes", query: `db.creditnotes.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { creditdate: -1, _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "approvedbyuseruid", foreignField: "_id", as: "approvedbyuser" }
  },
  { $unwind: { path: "$approvedbyuser", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      creditdate: { $dateToString: { date: "$creditdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      creditdateforsort: "$creditdate",
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      visitstatus: "$visitstatus.valuedescription",
      creditamount: "$creditamount",
      amount: "$amount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      iscancelled: "$iscancelled",
      isipdcredit: "$isipdcredit",
      isrefund: "$isrefund",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      approvedbyuser: "$approvedbyuser.name"
    }
  }
])` },
      { title: "Visit journeys", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$visitjourneys", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "visitjourneys.careprovideruid",
      foreignField: "_id",
      as: "careprovider"
    }
  },
  { $unwind: { path: "$careprovider", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "visitjourneys.departmentuid",
      foreignField: "_id",
      as: "department"
    }
  },
  { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitjourneys.statusuid",
      foreignField: "_id",
      as: "statusuid"
    }
  },
  { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "visitjourneys.useruid", foreignField: "_id", as: "juser" }
  },
  { $unwind: { path: "$juser", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: { $ifNull: ["$visitstatus.valuedescription", "$statusuid.valuedescription"] },
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      careprovider: { $ifNull: ["$careprovider.name", ""] },
      department: { $ifNull: ["$department.name", ""] },
      statusuid: "$statusuid.valuedescription",
      useruid: "$juser.name",
      vmodifiedat: {
        $dateToString: { date: "$visitjourneys.modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      dateforsort: "$startdate"
    }
  },
  { $sort: { dateforsort: -1 } }
])` },
      { title: "Bed occupancy", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$bedoccupancy", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "wards", localField: "bedoccupancy.warduid", foreignField: "_id", as: "wards" }
  },
  { $unwind: { path: "$wards", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "beds", localField: "bedoccupancy.beduid", foreignField: "_id", as: "beds" } },
  { $unwind: { path: "$beds", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitjourneys.statusuid",
      foreignField: "_id",
      as: "statusuid"
    }
  },
  { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: { $ifNull: ["$visitstatus.valuedescription", "$statusuid.valuedescription"] },
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      wardcode: "$wards.code",
      wardname: "$wards.name",
      bedcode: "$beds.code",
      bedname: "$beds.name",
      bedstartdate: {
        $dateToString: { date: "$bedoccupancy.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      isactive: { $ifNull: ["$bedoccupancy.isactive", ""] },
      isolatedbed: { $ifNull: ["$bedoccupancy.isolatedbed", ""] },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      dateforsort: "$startdate"
    }
  },
  { $sort: { dateforsort: -1 } }
])` },
      { title: "Visit payors", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$visitpayors", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "payors", localField: "visitpayors.payoruid", foreignField: "_id", as: "payors" }
  },
  { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "payoragreements",
      localField: "visitpayors.payoragreementuid",
      foreignField: "_id",
      as: "payoragreements"
    }
  },
  { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tpas", localField: "visitpayors.tpauid", foreignField: "_id", as: "tpas" } },
  { $unwind: { path: "$tpas", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitcareproviders.statusuid",
      foreignField: "_id",
      as: "statusuid"
    }
  },
  { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: { $ifNull: ["$visitstatus.valuedescription", "$statusuid.valuedescription"] },
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      payorcode: "$payors.code",
      payorname: "$payors.name",
      payoragreementscode: "$payoragreements.code",
      payoragreementsname: "$payoragreements.name",
      tpacode: "$tpas.code",
      tpaname: "$tpas.name",
      dateforsort: "$startdate"
    }
  },
  { $sort: { dateforsort: -1 } }
])` },
      { title: "Visit care providers", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$visitcareproviders", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "visitcareproviders.departmentuid",
      foreignField: "_id",
      as: "departments"
    }
  },
  { $unwind: { path: "$departments", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitcareproviders.visittypeuid",
      foreignField: "_id",
      as: "visittype"
    }
  },
  { $unwind: { path: "$visittype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "visitcareproviders.careprovideruid",
      foreignField: "_id",
      as: "careproviders"
    }
  },
  { $unwind: { path: "$careproviders", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitcareproviders.entypeuid",
      foreignField: "_id",
      as: "careproviderentype"
    }
  },
  { $unwind: { path: "$careproviderentype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "visitcareproviders.statusuid",
      foreignField: "_id",
      as: "careproviderst"
    }
  },
  { $unwind: { path: "$careproviderst", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: { $ifNull: ["$visitstatus.valuedescription", "$careproviderst.valuedescription"] },
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      dateforsort: "$startdate",
      departmentcode: "$departments.code",
      departmentname: "$departments.name",
      visittype: "$visittype.valuedescription",
      careprovidercode: "$careproviders.code",
      careprovidername: "$careproviders.name",
      careproviderentype: "$careproviderentype.valuedescription",
      careproviderstartdate: {
        $dateToString: { date: "$visitcareproviders.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      isprimarycareprovider: "$visitcareproviders.isprimarycareprovider"
    }
  },
  { $sort: { dateforsort: -1 } }
])` },
      { title: "Bed transfers", query: `db.bedtransfers.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "wards", localField: "sourcewarduid", foreignField: "_id", as: "swards" } },
  { $unwind: { path: "$swards", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "beds", localField: "sourcebeduid", foreignField: "_id", as: "sbeds" } },
  { $unwind: { path: "$sbeds", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "wards", localField: "destwarduid", foreignField: "_id", as: "dwards" } },
  { $unwind: { path: "$dwards", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "beds", localField: "destbeduid", foreignField: "_id", as: "dbeds" } },
  { $unwind: { path: "$dbeds", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "wards", localField: "transferredwarduid", foreignField: "_id", as: "twards" } },
  { $unwind: { path: "$twards", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "beds", localField: "transferredbeduid", foreignField: "_id", as: "tbeds" } },
  { $unwind: { path: "$tbeds", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "bookedby", foreignField: "_id", as: "bookedby" } },
  { $unwind: { path: "$bookedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "statusuid", foreignField: "_id", as: "statusuid" }
  },
  { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$patientvisits.visitid",
      hn: "$patients.mrn",
      swardscode: "$swards.code",
      swardsname: "$swards.name",
      sbedscode: "$sbeds.code",
      sbedsname: "$sbeds.name",
      dwardscode: "$dwards.code",
      dwardsname: "$dwards.name",
      dbedscode: "$dbeds.code",
      dbedsname: "$dbeds.name",
      twardscode: "$twards.code",
      twardsname: "$twards.name",
      tbedscode: "$tbeds.code",
      tbedsname: "$tbeds.name",
      statusuid: "$statusuid.valuedescription",
      isactive: "$isactive",
      isolationrequired: "$isolationrequired",
      retaincurrentbed: "$retaincurrentbed",
      islodgerbed: "$islodgerbed",
      ischangedept: "$ischangedept",
      bookedby: "$bookedby.name",
      bookedat: { $dateToString: { date: "$bookedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      dateforsort: "$bookedat"
    }
  },
  { $sort: { dateforsort: -1 } }
])` },
      { title: "Newborn details", query: `db.newborndetails.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  {
    $lookup: { from: "patients", localField: "babypatientuid", foreignField: "_id", as: "babypatients" }
  },
  { $unwind: { path: "$babypatients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      hn: "$babypatients.mrn",
      visitid: "$patientvisits.visitid",
      isogtube: "$isogtube",
      isbonding: "$isbonding",
      istrachialsuction: "$istrachialsuction",
      isoxygen: "$isoxygen",
      isppvncpap: "$isppvncpap",
      isretainedettube: "$isretainedettube",
      ischestcompression: "$ischestcompression"
    }
  }
])` },
      { title: "Alerts", query: `db.alerts.aggregate([
  {
    $match: { orguid: {{orguid}}, {{#hn|vn}}patientuid: {{hn|vn:patient}},{{/hn|vn}} }
  },
  { $unwind: { path: "$alerts", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patientuid" } },
  { $unwind: { path: "$patientuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "alerts.alerttypeuid",
      foreignField: "_id",
      as: "alerttype"
    }
  },
  { $unwind: { path: "$alerttype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisit" }
  },
  { $unwind: { path: "$patientvisit", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "departments", localField: "departmentuid", foreignField: "_id", as: "department" }
  },
  { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$patientvisit.visitid",
      department: "$department.name",
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      alerttype: "$alerttype.valuedescription",
      alertmessage: "$alerts.alertmessage",
      isactive: "$alerts.isactive",
      isalldepartments: "$alerts.alldepartments"
    }
  }
])` },
      { title: "Patient merges", query: `db.patientmerges.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#hn|vn}}$or: [{ primarypatientuid: {{hn|vn:patient}} }, { secondarypatientuid: {{hn|vn:patient}} }],{{/hn|vn}}
    }
  },
  { $sort: { mergedate: -1, _id: -1 } },
  {
    $lookup: { from: "patients", localField: "primarypatientuid", foreignField: "_id", as: "pripatient" }
  },
  { $unwind: { path: "$pripatient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patients", localField: "secondarypatientuid", foreignField: "_id", as: "secpatient" }
  },
  { $unwind: { path: "$secpatient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "mergedbyuseruid", foreignField: "_id", as: "mergedbyuseruid" }
  },
  { $unwind: { path: "$mergedbyuseruid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "reasonuid", foreignField: "_id", as: "reasonuid" }
  },
  { $unwind: { path: "$reasonuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      mergeseqno: "$mergeseqno",
      mergedate: { $dateToString: { date: "$mergedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      primaryhn: "$pripatient.mrn",
      secmaryhn: "$secpatient.mrn",
      isunmerged: "$isunmerged",
      reasonuid: "$reasonuid.valuedescription",
      mergedby: "$mergedbyuseruid.name",
      dateforsort: "$mergedate"
    }
  }
])` },
      { title: "DF bill items", query: `db.patientbills.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn|vn}}patientuid: {{hn|vn:patient}},{{/hn|vn}}
    }
  },
  {
    $lookup: {
      from: "patientvisits",
      foreignField: "_id",
      localField: "patientvisituid",
      as: "patientvisituid"
    }
  },
  { $unwind: { path: "$patientvisituid", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      foreignField: "_id",
      localField: "patientbilleditems.careprovideruid",
      as: "patientbilleditems.careprovideruid"
    }
  },
  { $unwind: { path: "$patientbilleditems.careprovideruid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "tariffs", foreignField: "_id", localField: "patientbilleditems.tariffuid", as: "tariffs" }
  },
  { $unwind: { path: "$tariffs", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      patientorderuid: "$patientbilleditems.patientorderuid",
      billinggroupuid: "$patientbilleditems.billinggroupuid",
      billingsubgroupuid: "$patientbilleditems.billingsubgroupuid",
      ordernumber: "$patientbilleditems.ordernumber",
      orderitemuid: "$patientbilleditems.orderitemuid",
      orderitemname: "$patientbilleditems.orderitemname",
      chargecodetype: "$patientbilleditems.chargecodetype",
      quantity: "$patientbilleditems.quantity",
      unitprice: "$patientbilleditems.unitprice",
      payordiscount: "$patientbilleditems.payordiscount",
      specialdiscount: "$patientbilleditems.specialdiscount",
      taxamount: "$patientbilleditems.taxamount",
      netamount: "$patientbilleditems.netamount",
      overriddenprice: "$patientbilleditems.overriddenprice",
      unitcost: "$patientbilleditems.unitcost",
      profitability: "$patientbilleditems.profitability",
      chargedate: "$patientbilleditems.chargedate",
      doctorshare: "$tariffs.doctorshare",
      careprovider: "$patientbilleditems.careprovideruid.name",
      patientvisituid: "$patientvisituid"
    }
  },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "ordercategories",
      foreignField: "_id",
      localField: "orderitem.ordercatuid",
      as: "ordercatuid"
    }
  },
  { $unwind: { path: "$ordercatuid", preserveNullAndEmptyArrays: true } },
  {
    $match: { $or: [{ "ordercatuid.ordercattype": "DOCTORFEE" }, { "orderitem.isdoctorshareitem": true }] }
  },
  { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
  { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" }
  },
  { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      localField: "billingsubgroupuid",
      foreignField: "_id",
      as: "billingsubgroup"
    }
  },
  { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      chargedate: { $dateToString: { date: "$chargedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      patientorderuid: 1,
      billinggroup: "$billinggroup.name",
      billingsubgroup: "$billingsubgroup.name",
      ordernumber: 1,
      orderitemcode: {
        $cond: {
          if: { $ne: ["$chargecodetype", "PATIENTPACKAGE"] },
          then: "$orderitem.code",
          else: "$orderset.code"
        }
      },
      orderitemname: 1,
      chargecodetype: 1,
      quantity: 1,
      unitprice: 1,
      payordiscount: 1,
      specialdiscount: 1,
      taxamount: 1,
      netamount: 1,
      overriddenprice: 1,
      unitcost: 1,
      profitability: 1,
      doctorshare: 1,
      sequencenumber: 1,
      careprovider: 1,
      visitid: "$patientvisituid.visitid",
      ordercattype: "$ordercatuid.ordercattype",
      isdoctorshareitem: "orderitem.isdoctorshareitem"
    }
  },
  { $sort: { orderitemcode: 1 } }
])` },
      { title: "DF package items", query: `db.patientbills.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn|vn}}patientuid: {{hn|vn:patient}},{{/hn|vn}}
    }
  },
  {
    $lookup: {
      from: "patientvisits",
      foreignField: "_id",
      localField: "patientvisituid",
      as: "patientvisituid"
    }
  },
  { $unwind: { path: "$patientvisituid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      foreignField: "_id",
      localField: "patientvisituid.entypeuid",
      as: "patientvisituid.entypeuid"
    }
  },
  { $unwind: { path: "$patientvisituid.entypeuid", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
  { $match: { "patientbilleditems.chargecodetype": "PATIENTPACKAGE" } },
  {
    $lookup: {
      from: "patientpackages",
      foreignField: "_id",
      localField: "patientbilleditems.patientorderuid",
      as: "patientpackage"
    }
  },
  { $unwind: { path: "$patientpackage", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$patientpackage.orderitems", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "orderitems",
      foreignField: "_id",
      localField: "patientpackage.orderitems.orderitemuid",
      as: "patientpackage.orderitems.orderitemuid"
    }
  },
  { $unwind: { path: "$patientpackage.orderitems.orderitemuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "ordercategories",
      foreignField: "_id",
      localField: "patientpackage.orderitems.orderitemuid.ordercatuid",
      as: "patientpackage.orderitems.orderitemuid.ordercatuid"
    }
  },
  {
    $unwind: { path: "$patientpackage.orderitems.orderitemuid.ordercatuid", preserveNullAndEmptyArrays: true }
  },
  {
    $match: {
      $or: [
        { "patientpackage.orderitems.orderitemuid.ordercatuid.ordercattype": "DOCTORFEE" },
        { "patientpackage.orderitems.orderitemuid.isdoctorshareitem": true }
      ]
    }
  },
  {
    $lookup: {
      from: "ordercategories",
      foreignField: "_id",
      localField: "patientbilleditems.orderitemuid.ordersubcatuid",
      as: "patientbilleditems.orderitemuid.ordersubcatuid"
    }
  },
  {
    $unwind: { path: "$patientbilleditems.orderitemuid.ordersubcatuid", preserveNullAndEmptyArrays: true }
  },
  {
    $lookup: {
      from: "tariffs",
      foreignField: "_id",
      localField: "patientbilleditems.tariffuid",
      as: "patientbilleditems.tariffuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.tariffuid", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tpas", localField: "tpauid", foreignField: "_id", as: "tpauid" } },
  { $unwind: { path: "$tpauid", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", foreignField: "_id", localField: "useruid", as: "useruid" } },
  { $unwind: { path: "$useruid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      foreignField: "_id",
      localField: "userdepartmentuid",
      as: "userdepartmentuid"
    }
  },
  { $unwind: { path: "$userdepartmentuid", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", foreignField: "_id", localField: "patientuid", as: "patientuid" } },
  { $unwind: { path: "$patientuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "patientorders",
      foreignField: "_id",
      localField: "patientbilleditems.patientorderuid",
      as: "patientbilleditems.patientorderuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.patientorderuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      foreignField: "_id",
      localField: "patientbilleditems.patientorderuid.createdby",
      as: "patientbilleditems.patientorderuid.createdby"
    }
  },
  {
    $unwind: { path: "$patientbilleditems.patientorderuid.createdby", preserveNullAndEmptyArrays: true }
  },
  {
    $lookup: {
      from: "departments",
      foreignField: "_id",
      localField: "patientbilleditems.departmentuid",
      as: "patientbilleditems.departmentuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.departmentuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      foreignField: "_id",
      localField: "patientbilleditems.billingsubgroupuid",
      as: "patientbilleditems.billingsubgroupuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.billingsubgroupuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "ordercategories",
      foreignField: "_id",
      localField: "patientpackage.orderitems.orderitemuid.ordersubcatuid",
      as: "patientpackage.orderitems.orderitemuid.ordersubcatuid"
    }
  },
  {
    $unwind: {
      path: "$patientpackage.orderitems.orderitemuid.ordersubcatuid",
      preserveNullAndEmptyArrays: true
    }
  },
  {
    $lookup: {
      from: "ordersets",
      foreignField: "_id",
      localField: "patientbilleditems.orderitemuid",
      as: "ordersetuid"
    }
  },
  { $unwind: { path: "$ordersetuid", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tpas", localField: "tpauid", foreignField: "_id", as: "tpauid" } },
  { $unwind: { path: "$tpauid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      foreignField: "_id",
      localField: "userdepartmentuid",
      as: "userdepartmentuid"
    }
  },
  { $unwind: { path: "$userdepartmentuid", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", foreignField: "_id", localField: "patientuid", as: "patientuid" } },
  { $unwind: { path: "$patientuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      foreignField: "_id",
      localField: "patientvisituid.entypeuid",
      as: "patientvisituid.entypeuid"
    }
  },
  { $unwind: { path: "$patientvisituid.entypeuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      foreignField: "_id",
      localField: "patientbilleditems.careprovideruid",
      as: "patientbilleditems.careprovideruid"
    }
  },
  { $unwind: { path: "$patientbilleditems.careprovideruid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      foreignField: "_id",
      localField: "patientbilleditems.billingsubgroupuid",
      as: "patientbilleditems.billingsubgroupuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.billinggroupuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      foreignField: "_id",
      localField: "patientbilleditems.billinggroupuid",
      as: "patientbilleditems.billinggroupuid"
    }
  },
  { $unwind: { path: "$patientbilleditems.billinggroupuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "patientorders",
      foreignField: "patientuid",
      localField: "patientuid._id",
      as: "patientorders"
    }
  },
  {
    $project: {
      chargedate: {
        $dateToString: { date: "$patientbilleditems.chargedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      patientorderuid: 1,
      billinggroup: "$patientbilleditems.billinggroupuid.name",
      billingsubgroup: "$patientbilleditems.billingsubgroupuid.name",
      ordernumber: "$patientbilleditems.ordernumber",
      orderitemcode: "$patientpackage.orderitems.orderitemuid.code",
      orderitemname: "$patientpackage.orderitems.orderitemuid.name",
      chargecodetype: "$patientbilleditems.chargecodetype",
      quantity: "$patientbilleditems.quantity",
      unitprice: "$patientpackage.orderitems.packageitemprice",
      doctorshare: "$patientpackage.orderitems.doctoritemshare",
      payordiscount: "$patientbilleditems.payordiscount",
      specialdiscount: "$patientbilleditems.specialdiscount",
      taxamount: "$patientbilleditems.taxamount",
      netamount: { $multiply: ["$patientbilleditems.quantity", "$patientpackage.orderitems.packageitemprice"] },
      overriddenprice: "$patientbilleditems.overriddenprice",
      unitcost: "$patientbilleditems.unitcost",
      profitability: "$patientbilleditems.profitability",
      careprovider: "$patientbilleditems.careprovideruid.name",
      visitid: "$patientvisituid.visitid"
    }
  },
  { $sort: { billdate: 1 } }
])` },
      { title: "Drug allergies", query: `db.allergies.aggregate([
  { $match: { {{#hn|vn}}patientuid: {{hn|vn:patient}},{{/hn|vn}} } },
  { $unwind: { path: "$drugallergies", preserveNullAndEmptyArrays: true } },
  { $match: { "drugallergies.isactive": true } },
  {
    $lookup: {
      from: "referencevalues",
      let: { typeuid: "$drugallergies.typeuid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$typeuid"] } } },
        { $project: { valuecode: 1, valuedescription: 1 } }
      ],
      as: "type"
    }
  },
  { $unwind: { path: "$type", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      let: { severityuid: "$drugallergies.severityuid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$severityuid"] } } },
        { $project: { valuecode: 1, valuedescription: 1 } }
      ],
      as: "severity"
    }
  },
  { $unwind: { path: "$severity", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "druggroups",
      let: { druggroupuid: "$drugallergies.druggroupuid" },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$druggroupuid"] } } }, { $project: { name: 1 } }],
      as: "druggroup"
    }
  },
  { $unwind: { path: "$druggroup", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "druggroups",
      let: { allergenuid: "$drugallergies.allergenuid" },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$allergenuid"] } } }, { $project: { name: 1 } }],
      as: "allergen"
    }
  },
  { $unwind: { path: "$allergen", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      let: { createdby: "$createdby" },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$createdby"] } } }, { $project: { name: 1 } }],
      as: "createdby"
    }
  },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      allergenname: {
        $switch: {
          branches: [
            { case: { $eq: ["$type.valuecode", "ALGTYP1"] }, then: "$allergen.name" },
            { case: { $eq: ["$type.valuecode", "ALGTYP2"] }, then: "$drugallergies.tradename" },
            { case: { $eq: ["$type.valuecode", "ALGTYP3"] }, then: "$druggroup.name" },
            { case: { $eq: ["$type.valuecode", "ALGTYP4"] }, then: "$drugallergies.freetext" }
          ]
        }
      },
      comments: "$drugallergies.comments",
      typecode: "$type.valuecode",
      typename: "$type.valuedescription",
      severitycode: "$severity.valuecode",
      severityname: "$severity.valuedescription",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }
    }
  },
  { $sort: { _id: -1 } }
])` }
    ]
  },
  {
    key: "patient-visits",
    name: "Patient Visits Data",
    category: "Patients",
    description: "Visits of the site, newest first, as on the Patient Visits Data page. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "visitstatus", label: "Visit status", type: "reference", domain: "VISITSTATUS", required: false, default: "", help: "" },
      { name: "entype", label: "Encounter type", type: "reference", domain: "ENTYPE", required: false, default: "", help: "" },
      { name: "visitdate", label: "Visit date", type: "date", required: false, default: "", help: "Visits that started on this day (Bangkok time)" }
    ],
    queries: [
      { title: "Patient visits", query: `db.patientvisits.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#vn}}_id: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#visitstatus}}visitstatusuid: {{visitstatus}},{{/visitstatus}}
      {{#entype}}entypeuid: {{entype}},{{/entype}}
      {{#visitdate}}startdate: { $gte: {{visitdate}}, $lte: {{visitdate:end}} },{{/visitdate}}
    }
  },
  { $sort: { _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" }
  },
  { $unwind: { path: "$entype", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "admissionrequests",
      localField: "admissionrequestuid",
      foreignField: "_id",
      as: "admissionrequest"
    }
  },
  { $unwind: { path: "$admissionrequest", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: "$visitid",
      visitidbeforeconvert: "$visitidbeforeconvert",
      hn: "$patients.mrn",
      entype: "$entype.valuedescription",
      visitstatus: "$visitstatus.valuedescription",
      isreadmission: { $ifNull: ["$isreadmission", ""] },
      isadmitted: { $ifNull: ["$admissionrequest.isadmitted", ""] },
      isvisitanonymous: { $ifNull: ["$isvisitanonymous", ""] },
      ispatientpregnant: { $ifNull: ["$ispatientpregnant", ""] },
      showprecaution: { $ifNull: ["$showprecaution", ""] },
      ispatientlactaion: { $ifNull: ["$ispatientlactaion", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedby: "$modifiedby.name",
      modifiedatforsort: "$modifiedat",
      fvisitcareprovider: { $arrayElemAt: ["$visitcareproviders", 0] },
      lvisitcareprovider: { $arrayElemAt: ["$visitcareproviders", -1] },
      fdepartmentjourney: { $arrayElemAt: ["$visitjourneys", 0] },
      ldepartmentjourney: { $arrayElemAt: ["$visitjourneys", -1] },
      mdepartmentjourney: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$visitjourneys",
              as: "visitjourneys",
              cond: { $eq: ["$$visitjourneys.statusuid", ObjectId("5784c4d032f3003ef802ae1b")] }
            }
          },
          0
        ]
      },
      isconvertedfromopd: "$isconvertedfromopd"
    }
  },
  {
    $lookup: {
      from: "users",
      localField: "fvisitcareprovider.careprovideruid",
      foreignField: "_id",
      as: "fcareprovider"
    }
  },
  { $unwind: { path: "$fcareprovider", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "fdepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "fdepartment"
    }
  },
  { $unwind: { path: "$fdepartment", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "fdepartmentjourney.statusuid",
      foreignField: "_id",
      as: "fjourney"
    }
  },
  { $unwind: { path: "$fjourney", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "lvisitcareprovider.careprovideruid",
      foreignField: "_id",
      as: "lcareprovider"
    }
  },
  { $unwind: { path: "$lcareprovider", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "ldepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "ldepartment"
    }
  },
  { $unwind: { path: "$ldepartment", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "departments",
      localField: "mdepartmentjourney.departmentuid",
      foreignField: "_id",
      as: "mdepartment"
    }
  },
  { $unwind: { path: "$mdepartment", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      visitid: 1,
      visitidbeforeconvert: 1,
      hn: 1,
      entype: 1,
      visitstatus: { $ifNull: ["$visitstatus", "$fjourney.valuedescription"] },
      isreadmission: 1,
      isvisitanonymous: 1,
      startdate: 1,
      enddate: 1,
      createdby: 1,
      modifiedby: 1,
      modifiedat: 1,
      modifiedatforsort: 1,
      fcareproviders: "$fcareprovider.name",
      fdepartment: "$fdepartment.name",
      lcareproviders: "$lcareprovider.name",
      ldepartment: "$ldepartment.name",
      mdepartmentjourney: "$mdepartment.name",
      ispatientpregnant: 1,
      showprecaution: 1,
      ispatientlactaion: 1,
      isconvertedfromopd: 1,
      isadmitted: 1
    }
  }
])` }
    ]
  },
  {
    key: "patient-merges",
    name: "Patient Merges",
    category: "Patients",
    description: "Patient merges of the site, newest first, as on the Patient Merges page; with an HN, the merges where that patient is the primary or the secondary.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Primary or secondary patient HN" }
    ],
    queries: [
      { title: "Patient merges", query: `db.patientmerges.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      {{#hn}}$or: [{ primarypatientuid: {{hn}} }, { secondarypatientuid: {{hn}} }],{{/hn}}
    }
  },
  { $sort: { mergedate: -1, _id: -1 } },
  {
    $lookup: { from: "patients", localField: "primarypatientuid", foreignField: "_id", as: "pripatient" }
  },
  { $unwind: { path: "$pripatient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patients", localField: "secondarypatientuid", foreignField: "_id", as: "secpatient" }
  },
  { $unwind: { path: "$secpatient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "mergedbyuseruid", foreignField: "_id", as: "mergedbyuseruid" }
  },
  { $unwind: { path: "$mergedbyuseruid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "reasonuid", foreignField: "_id", as: "reasonuid" }
  },
  { $unwind: { path: "$reasonuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      mergeseqno: "$mergeseqno",
      mergedate: { $dateToString: { date: "$mergedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      primaryhn: "$pripatient.mrn",
      secmaryhn: "$secpatient.mrn",
      isunmerged: "$isunmerged",
      reasonuid: "$reasonuid.valuedescription",
      mergedby: "$mergedbyuseruid.name",
      dateforsort: "$mergedate"
    }
  }
])` }
    ]
  },
  {
    key: "patient-orders",
    name: "Patient Orders Data",
    category: "Orders",
    description: "Order items of the site, as on the Patient Orders Data page, with whether each item is in a charge code. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "ordercattype", label: "Order category type", type: "choice", options: ["LAB","RADIOLOGY","MEDICINE","MEDICINE NONSTOCK","SUPPLY","DIET","DENTAL","DOCTORFEE","ROOMRENT","EQUIPMENT","OTHERS"], required: false, default: "", help: "" }
    ],
    queries: [
      { title: "Patient order items", query: `db.patientorders.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#ordercattype}}ordercattype: {{ordercattype}},{{/ordercattype}}
    }
  },
  {
    $project: {
      orderdate: 1,
      ordercattype: 1,
      createdat: 1,
      createdby: 1,
      modifiedat: 1,
      modifiedby: 1,
      ordernumber: 1,
      patientuid: 1,
      patientvisituid: 1,
      patientorderitems: 1,
      orderdepartmentuid: 1,
      ordertodepartmentuid: 1,
      isautogenerated: 1,
      payordiscount: 1,
      specialdiscount: 1
    }
  },
  { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
  {
    $addFields: { __ordercategories: ["$patientorderitems.ordercatuid", "$patientorderitems.ordersubcatuid"] }
  },
  {
    $lookup: {
      from: "ordercategories",
      localField: "__ordercategories",
      foreignField: "_id",
      as: "__ordercategories"
    }
  },
  {
    $addFields: {
      ordercat: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__ordercategories",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.ordercatuid"] }
            }
          },
          0
        ]
      },
      ordersubcat: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__ordercategories",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.ordersubcatuid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __ordercategories: 0 } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  { $addFields: { __users: ["$createdby", "$modifiedby", "$patientorderitems.careprovideruid"] } },
  { $lookup: { from: "users", localField: "__users", foreignField: "_id", as: "__users" } },
  {
    $addFields: {
      cby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$createdby"] } } },
          0
        ]
      },
      mby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$modifiedby"] } } },
          0
        ]
      },
      careprovider: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__users",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.careprovideruid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __users: 0 } },
  { $addFields: { __departments: ["$ordertodepartmentuid", "$orderdepartmentuid"] } },
  {
    $lookup: { from: "departments", localField: "__departments", foreignField: "_id", as: "__departments" }
  },
  {
    $addFields: {
      ordertodepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$ordertodepartmentuid"] } }
          },
          0
        ]
      },
      orderdepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$orderdepartmentuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __departments: 0 } },
  {
    $lookup: {
      from: "orderitems",
      localField: "patientorderitems.orderitemuid",
      foreignField: "_id",
      as: "orderitems"
    }
  },
  { $unwind: { path: "$orderitems", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "tariffs", localField: "patientorderitems.tariffuid", foreignField: "_id", as: "tariffs" }
  },
  { $unwind: { path: "$tariffs", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __referencevalues: [
        "$patientorderitems.statusuid",
        "$patientorderitems.quantityUOM",
        "$patientorderitems.dosageUOM",
        "$patientvisits.visitstatusuid"
      ]
    }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      status: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.statusuid"] }
            }
          },
          0
        ]
      },
      quantityUOM: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.quantityUOM"] }
            }
          },
          0
        ]
      },
      dosageUOM: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorderitems.dosageUOM"] }
            }
          },
          0
        ]
      },
      visitstatus: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientvisits.visitstatusuid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  // In a charge code: the order item is in its visit's patientchargecodes (the page's "in charge code" flag).
  { $lookup: { from: "patientchargecodes", localField: "patientvisituid", foreignField: "patientvisituid", as: "__chargecodes" } },
  {
    $addFields: {
      isInchargeCode: {
        $in: [
          "$patientorderitems._id",
          { $reduce: { input: "$__chargecodes.chargecodes.patientorderitemuid", initialValue: [], in: { $concatArrays: ["$$value", { $ifNull: ["$$this", []] }] } } }
        ]
      }
    }
  },
  {
    $project: {
      patientuid: 1,
      ordercattype: 1,
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      ordernumber: 1,
      hn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      visitstatus: "$visitstatus.valuedescription",
      startdate: {
        $dateToString: { date: "$patientvisits.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      enddate: {
        $dateToString: { date: "$patientvisits.enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      careprovider: "$careprovider.name",
      statusuid: "$status.valuedescription",
      orderdepartment: "$orderdepartment.name",
      ordertodepartment: "$ordertodepartment.name",
      orderdate: { $dateToString: { date: "$orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      totalprice: { $ifNull: ["$patientorderitems.totalprice", ""] },
      unitprice: { $ifNull: ["$patientorderitems.unitprice", ""] },
      quantity: { $ifNull: ["$patientorderitems.quantity", ""] },
      discount: { $ifNull: ["$patientorderitems.discount", ""] },
      vatamount: { $ifNull: ["$patientorderitems.vatamount", ""] },
      netamount: { $ifNull: ["$patientorderitems.netamount", ""] },
      dosage: { $ifNull: ["$patientorderitems.dosage", ""] },
      volume: { $ifNull: ["$patientorderitems.volume", ""] },
      isactive: "$patientorderitems.isactive",
      ispom: "$patientorderitems.broughtfromoutside",
      iscontinuousorder: "$patientorderitems.iscontinuousorder",
      isipfillallowed: "$patientorderitems.isipfillallowed",
      orderitemname: "$orderitems.name",
      orderitemcode: "$orderitems.code",
      ordercatname: "$ordercat.name",
      ordersubcatname: "$ordersubcat.name",
      tariffunitprice: { $ifNull: ["$tariffs.unitprice", ""] },
      payordiscount: { $ifNull: ["$payordiscount", 0] },
      specialdiscount: { $ifNull: ["$specialdiscount", 0] },
      createdby: "$cby.name",
      modifiedby: "$mby.name",
      quantityUOM: "$quantityUOM.valuedescription",
      dosageUOM: "$dosageUOM.valuedescription",
      quantityperdose: "$patientorderitems.quantityperdose",
      patientorderitemuid: "$patientorderitems._id",
      billintType: "$patientorderitems.billingtype",
      isInchargeCode: 1
    }
  }
])` }
    ]
  },
  {
    key: "patient-bills",
    name: "Patient Bills",
    category: "Billing",
    description: "Patient bills of the site, newest first, as on the Patient Bills page. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "sequencenumber", label: "Bill number", type: "text", required: false, default: "", help: "Bill sequence number, e.g. B2024001" }
    ],
    queries: [
      { title: "Patient bills", query: `db.patientbills.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#sequencenumber}}sequencenumber: {{sequencenumber}},{{/sequencenumber}}
    }
  },
  { $sort: { _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "payors", localField: "payoruid", foreignField: "_id", as: "payors" } },
  { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "payoragreements",
      localField: "payoragreementuid",
      foreignField: "_id",
      as: "payoragreements"
    }
  },
  { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      billdate: { $dateToString: { date: "$billdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      billdate_seaech: { $dateToString: { date: "$billdate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      billdateforsort: "$billdate",
      canceldate: { $dateToString: { date: "$canceldate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      visitstatus: "$visitstatus.valuedescription",
      totalbillamount: "$totalbillamount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      isrefund: "$isrefund",
      iscancelled: "$iscancelled",
      isipdbill: "$isipdbill",
      isinterim: "$isinterim",
      isreceivable: "$isreceivable",
      interimfromdate: { $dateToString: { date: "$interimfromdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      interimtodate: { $dateToString: { date: "$interimtodate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      patientbilleditems: { $size: "$patientbilleditems" },
      paymentdetails: { $size: "$paymentdetails" }
    }
  }
])` }
    ]
  },
  {
    key: "patient-chargecodes",
    name: "Patient Chargecodes",
    category: "Billing",
    description: "Unbilled charge codes of IPD visits, newest first, as on the Patient Chargecodes page. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Patient charge codes", query: `db.patientchargecodes.aggregate([
  {
    $match: {
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  { $sort: { _id: -1 } },
  {
    $project: {
      patientuid: "$patientuid",
      patientvisituid: "$patientvisituid",
      createdby: "$createdby",
      modifiedby: "$modifiedby",
      allocationinitialized: "$allocationinitialized",
      chargecodessize: { $size: "$chargecodes" }
    }
  },
  { $match: { chargecodessize: { $gt: 0 } } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $match: { "patientvisits.entypeuid": { $eq: ObjectId("59ef351fd2bbe66c36f99862") } } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      startdate: {
        $dateToString: { date: "$patientvisits.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      visitstatus: "$visitstatus.valuedescription",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      createdatforsort: "$createdat",
      visitdateforsort: "$patientvisits.startdate",
      chargecodes: "$chargecodessize",
      allocationinitialized: "$allocationinitialized",
      patientuid: 1,
      patientvisituid: 1
    }
  }
])` }
    ]
  },
  {
    key: "patient-deposits",
    name: "Patient Deposits",
    category: "Billing",
    description: "Deposits of the site, newest first, as on the Patient Deposits page. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Patient deposits", query: `db.deposits.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { depositdate: -1, _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "paymentmodeuid", foreignField: "_id", as: "paymentmode" }
  },
  { $unwind: { path: "$paymentmode", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      depositdate: { $dateToString: { date: "$depositdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      depositdateforsort: "$depositdate",
      mrn: "$patients.mrn",
      visitid: { $ifNull: ["$patientvisits.visitid", ""] },
      visitstatus: "$visitstatus.valuedescription",
      paidamount: "$paidamount",
      amount: "$amount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      isrefund: "$isrefund",
      iscancelled: "$iscancelled",
      isipddeposit: "$isipddeposit",
      isduetobillcancel: { $ifNull: ["$isduetobillcancel", ""] },
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      dateforsort: "$depositdate",
      paymentmode: "$paymentmode.valuedescription"
    }
  }
])` }
    ]
  },
  {
    key: "patient-creditnotes",
    name: "Patient Creditnotes",
    category: "Billing",
    description: "Credit notes of the site, newest first, as on the Patient Creditnotes page. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Patient credit notes", query: `db.creditnotes.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { creditdate: -1, _id: -1 } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "patientvisits.visitstatusuid",
      foreignField: "_id",
      as: "visitstatus"
    }
  },
  { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" }
  },
  { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "users",
      localField: "cancelrefundbyuseruid",
      foreignField: "_id",
      as: "cancelrefundbyuser"
    }
  },
  { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "users", localField: "approvedbyuseruid", foreignField: "_id", as: "approvedbyuser" }
  },
  { $unwind: { path: "$approvedbyuser", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      creditdate: { $dateToString: { date: "$creditdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      creditdateforsort: "$creditdate",
      mrn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      visitstatus: "$visitstatus.valuedescription",
      creditamount: "$creditamount",
      amount: "$amount",
      payor: "$payors.name",
      payoragreements: "$payoragreements.name",
      user: "$user.name",
      userdepart: "$userdepart.name",
      cancelrefundbyuser: "$cancelrefundbyuser.name",
      iscancelled: "$iscancelled",
      isipdcredit: "$isipdcredit",
      isrefund: "$isrefund",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedatforsort: "$modifiedat",
      approvedbyuser: "$approvedbyuser.name"
    }
  }
])` }
    ]
  },
  {
    key: "patient-bill-items",
    name: "Patient Bill Items",
    category: "Billing",
    description: "Billed items as on the Bill items pages (/billing/bill-items, /billing/bill-items-by-hn), with the order item's details. Give a bill number, an HN or a VN. Totals: the sums under the page's table.",
    params: [
      { name: "billno", label: "Bill number", type: "text", required: "any", default: "", help: "Bill sequence number" },
      { name: "hn", label: "HN", type: "hn", required: "any", default: "", help: "Every bill of the patient" },
      { name: "vn", label: "VN", type: "vn", required: "any", default: "", help: "Every bill of the visit" }
    ],
    queries: [
      { title: "Bill items", query: `db.patientbills.aggregate([
  {
    $match: {
      {{#billno}}sequencenumber: {{billno}},{{/billno}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "tariffs", foreignField: "_id", localField: "patientbilleditems.tariffuid", as: "tariffs" }
  },
  { $unwind: { path: "$tariffs", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      patientorderuid: "$patientbilleditems.patientorderuid",
      billinggroupuid: "$patientbilleditems.billinggroupuid",
      billingsubgroupuid: "$patientbilleditems.billingsubgroupuid",
      ordernumber: "$patientbilleditems.ordernumber",
      orderitemuid: "$patientbilleditems.orderitemuid",
      orderitemname: "$patientbilleditems.orderitemname",
      chargecodetype: "$patientbilleditems.chargecodetype",
      quantity: "$patientbilleditems.quantity",
      unitprice: "$patientbilleditems.unitprice",
      payordiscount: "$patientbilleditems.payordiscount",
      specialdiscount: "$patientbilleditems.specialdiscount",
      taxamount: "$patientbilleditems.taxamount",
      netamount: "$patientbilleditems.netamount",
      overriddenprice: "$patientbilleditems.overriddenprice",
      unitcost: "$patientbilleditems.unitcost",
      profitability: "$patientbilleditems.profitability",
      chargedate: "$patientbilleditems.chargedate",
      tariffs: "$tariffs",
      patientorderitemuid: "$patientbilleditems.patientorderitemuid"
    }
  },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
  { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" }
  },
  { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      localField: "billingsubgroupuid",
      foreignField: "_id",
      as: "billingsubgroup"
    }
  },
  { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
  // Order details (the page adds them after its query): the order item each line came from.
  { $lookup: { from: "patientorders", localField: "patientorderuid", foreignField: "_id", as: "__order" } },
  { $unwind: { path: "$__order", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __orderitem: { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$__order.patientorderitems", []] }, as: "it", cond: { $eq: ["$$it._id", "$patientorderitemuid"] } } }, 0] }
    }
  },
  { $lookup: { from: "referencevalues", localField: "__orderitem.statusuid", foreignField: "_id", as: "__itemstatus" } },
  { $unwind: { path: "$__itemstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordercategories", localField: "__orderitem.ordercatuid", foreignField: "_id", as: "__ordercat" } },
  { $unwind: { path: "$__ordercat", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordercategories", localField: "__orderitem.ordersubcatuid", foreignField: "_id", as: "__ordersubcat" } },
  { $unwind: { path: "$__ordersubcat", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      sequencenumber: "$sequencenumber",
      chargedate: { $dateToString: { date: "$chargedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      patientorderuid: 1,
      billinggroup: "$billinggroup.name",
      billingsubgroup: "$billingsubgroup.name",
      ordernumber: 1,
      orderitemcode: {
        $cond: {
          if: { $ne: ["$chargecodetype", "PATIENTPACKAGE"] },
          then: "$orderitem.code",
          else: "$orderset.code"
        }
      },
      orderitemuid: 1,
      orderitemname: 1,
      chargecodetype: 1,
      quantity: 1,
      unitprice: 1,
      payordiscount: 1,
      specialdiscount: 1,
      taxamount: 1,
      netamount: 1,
      overriddenprice: 1,
      unitcost: 1,
      profitability: 1,
      doctorshare: "$tariffs.doctorshare",
      patientorderitemuid: 1,
      isdoctorshareitem: "$orderitem.isdoctorshareitem",
      startdate: { $ifNull: [{ $dateToString: { date: "$__orderitem.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }, ""] },
      enddate: { $ifNull: [{ $dateToString: { date: "$__orderitem.enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }, ""] },
      odquantity: { $ifNull: ["$__orderitem.quantity", ""] },
      odunitprice: { $ifNull: ["$__orderitem.unitprice", ""] },
      oddertotalprice: { $ifNull: ["$__orderitem.totalprice", ""] },
      iscontinuousorder: { $ifNull: ["$__orderitem.iscontinuousorder", ""] },
      ordercat: { $ifNull: ["$__ordercat.name", ""] },
      ordersubcat: { $ifNull: ["$__ordersubcat.name", ""] },
      orderitemstatus: { $ifNull: ["$__itemstatus.valuedescription", ""] }
    }
  },
  { $sort: { sequencenumber: -1 } }
])` },
      { title: "Totals", query: `db.patientbills.aggregate([
  {
    $match: {
      {{#billno}}sequencenumber: {{billno}},{{/billno}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  { $unwind: "$patientbilleditems" },
  // The totals under the Bill items table: net amount, price (quantity × unit price) and discount
  {
    $group: {
      _id: null,
      items: { $sum: 1 },
      totalnetamount: { $sum: { $convert: { input: "$patientbilleditems.netamount", to: "double", onError: 0, onNull: 0 } } },
      totalprice: { $sum: { $multiply: [{ $convert: { input: "$patientbilleditems.quantity", to: "double", onError: 0, onNull: 0 } }, { $convert: { input: "$patientbilleditems.unitprice", to: "double", onError: 0, onNull: 0 } }] } },
      totaldiscount: { $sum: { $add: [{ $convert: { input: "$patientbilleditems.payordiscount", to: "double", onError: 0, onNull: 0 } }, { $convert: { input: "$patientbilleditems.specialdiscount", to: "double", onError: 0, onNull: 0 } }] } }
    }
  },
  { $project: { _id: 0 } }
])` }
    ]
  },
  {
    key: "patient-chargecode-items",
    name: "Patient Chargecode Items",
    category: "Billing",
    description: "Charge code (unbilled) items as on the Chargecodes items pages (/billing/unbill-items, /billing/unbill-items-by-hn), with the order item's details. Give a charge code id (the _id of a Patient Chargecodes row), an HN or a VN. Totals: count and net amount per item status flag.",
    params: [
      { name: "chargecodeid", label: "Chargecode id", type: "objectid", required: "any", default: "", help: "_id of a patientchargecodes document" },
      { name: "hn", label: "HN", type: "hn", required: "any", default: "", help: "Every charge code of the patient" },
      { name: "vn", label: "VN", type: "vn", required: "any", default: "", help: "Charge codes of the visit" }
    ],
    queries: [
      { title: "Chargecode items", query: `db.patientchargecodes.aggregate([
  {
    $match: {
      {{#chargecodeid}}_id: {{chargecodeid}},{{/chargecodeid}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  {
    $unwind: { path: "$chargecodes", includeArrayIndex: "chargecodeindex", preserveNullAndEmptyArrays: true }
  },
  { $sort: { _id: 1, chargecodeindex: 1 } },
  {
    $project: {
      _id: "$chargecodes._id",
      orderitemname: "$chargecodes.orderitemname",
      orderitemuid: "$chargecodes.orderitemuid",
      tariffuid: "$chargecodes.tariffuid",
      billinggroupuid: "$chargecodes.billinggroupuid",
      billingsubgroupuid: "$chargecodes.billingsubgroupuid",
      chargecodetype: "$chargecodes.chargecodetype",
      ordernumber: "$chargecodes.ordernumber",
      patientorderuid: "$chargecodes.patientorderuid",
      patientorderitemuid: "$chargecodes.patientorderitemuid",
      quantity: "$chargecodes.quantity",
      orgquantity: "$chargecodes.orgquantity",
      unitprice: "$chargecodes.unitprice",
      payordiscount: "$chargecodes.payordiscount",
      specialdiscount: "$chargecodes.specialdiscount",
      netamount: "$chargecodes.netamount",
      overriddenprice: "$chargecodes.overriddenprice",
      visitpayoruid: "$chargecodes.visitpayoruid",
      departmentuid: "$chargecodes.departmentuid",
      careprovideruid: "$chargecodes.careprovideruid",
      chargedate: {
        $dateToString: { date: "$chargecodes.chargedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      issplit: "$chargecodes.issplit",
      ordertodepartmentuid: "$chargecodes.ordertodepartmentuid",
      allocatedpayoruid: "$chargecodes.allocatedpayoruid",
      allocatedagreementuid: "$chargecodes.allocatedagreementuid",
      unitcost: "$chargecodes.unitcost",
      taxamount: "$chargecodes.taxamount",
      chargedateforsort: "$chargecodes.chargedate",
      itemstatusflag: "$chargecodes.statusflag",
      isbilled: "$chargecodes.isbilled",
      patientbilluid: "$chargecodes.patientbilluid",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }
    }
  },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
  { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" }
  },
  { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "billinggroups",
      localField: "billingsubgroupuid",
      foreignField: "_id",
      as: "billingsubgroup"
    }
  },
  { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientorders", localField: "patientorderuid", foreignField: "_id", as: "patientorder" }
  },
  { $unwind: { path: "$patientorder", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "payors", localField: "visitpayoruid", foreignField: "_id", as: "visitpayor" } },
  { $unwind: { path: "$visitpayor", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "payors", localField: "allocatedpayoruid", foreignField: "_id", as: "alocatepayor" }
  },
  { $unwind: { path: "$alocatepayor", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientbills", localField: "patientbilluid", foreignField: "_id", as: "patientbill" }
  },
  { $unwind: { path: "$patientbill", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tariffs", localField: "tariffuid", foreignField: "_id", as: "tariff" } },
  { $unwind: { path: "$tariff", preserveNullAndEmptyArrays: true } },
  // Order details (the page adds them after its query): the order item each line came from.
  {
    $addFields: {
      __orderitem: { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$patientorder.patientorderitems", []] }, as: "it", cond: { $eq: ["$$it._id", "$patientorderitemuid"] } } }, 0] }
    }
  },
  { $lookup: { from: "referencevalues", localField: "__orderitem.statusuid", foreignField: "_id", as: "__itemstatus" } },
  { $unwind: { path: "$__itemstatus", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordercategories", localField: "__orderitem.ordercatuid", foreignField: "_id", as: "__ordercat" } },
  { $unwind: { path: "$__ordercat", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "ordercategories", localField: "__orderitem.ordersubcatuid", foreignField: "_id", as: "__ordersubcat" } },
  { $unwind: { path: "$__ordersubcat", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 1,
      patientorderuid: 1,
      patientorderitemuid: 1,
      ordercreateat: {
        $dateToString: { date: "$patientorder.createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      ordermodifiedat: {
        $dateToString: { date: "$patientorder.modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      orderdate: {
        $dateToString: { date: "$patientorder.orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      orderstatusflag: "$patientorder.statusflag",
      chargedate: 1,
      billinggroup: "$billinggroup.name",
      billingsubgroup: "$billingsubgroup.name",
      ordernumber: 1,
      orderitemcode: {
        $cond: {
          if: { $ne: ["$chargecodetype", "PATIENTPACKAGE"] },
          then: "$orderitem.code",
          else: "$orderset.code"
        }
      },
      orderitemname: 1,
      chargecodetype: 1,
      quantity: 1,
      orgquantity: 1,
      unitprice: { $ifNull: ["$unitprice", ""] },
      tariffunitprice: { $ifNull: ["$tariff.unitprice", ""] },
      payordiscount: 1,
      specialdiscount: 1,
      netamount: 1,
      visitpayor: "$visitpayor.name",
      alocatepayor: "$alocatepayor.name",
      overriddenprice: 1,
      issplit: 1,
      isbilled: 1,
      billednumber: "$patientbill.sequencenumber",
      unitcost: 1,
      taxamount: 1,
      itemstatusflag: 1,
      createdat: 1,
      modifiedat: 1,
      startdate: { $ifNull: [{ $dateToString: { date: "$__orderitem.startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }, ""] },
      enddate: { $ifNull: [{ $dateToString: { date: "$__orderitem.enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }, ""] },
      odquantity: { $ifNull: ["$__orderitem.quantity", ""] },
      odunitprice: { $ifNull: ["$__orderitem.unitprice", ""] },
      oddertotalprice: { $ifNull: ["$__orderitem.totalprice", ""] },
      iscontinuousorder: { $ifNull: ["$__orderitem.iscontinuousorder", ""] },
      ordercat: { $ifNull: ["$__ordercat.name", ""] },
      ordersubcat: { $ifNull: ["$__ordersubcat.name", ""] },
      orderitemstatus: { $ifNull: ["$__itemstatus.valuedescription", ""] }
    }
  }
])` },
      { title: "Totals by item status", query: `db.patientchargecodes.aggregate([
  {
    $match: {
      {{#chargecodeid}}_id: {{chargecodeid}},{{/chargecodeid}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      orguid: {{orguid}},
      statusflag: "A"
    }
  },
  { $unwind: { path: "$chargecodes", preserveNullAndEmptyArrays: true } },
  // Item count and net amount per item status flag (A active, D deleted), as at the top of the page
  {
    $group: {
      _id: { $ifNull: ["$chargecodes.statusflag", ""] },
      count: { $sum: 1 },
      netamount: { $sum: { $convert: { input: "$chargecodes.netamount", to: "double", onError: 0, onNull: 0 } } }
    }
  },
  { $sort: { _id: 1 } }
])` }
    ]
  },
  {
    key: "pharmacy-orders",
    name: "PharmacyOrders Data",
    category: "Pharmacy",
    description: "Medicine order items of the site, newest order first, as on the PharmacyOrders Data page (/pharmacy/orders). Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "itemcode", label: "Item code", type: "text", required: false, default: "", help: "Order item code" }
    ],
    queries: [
      { title: "Pharmacy orders", query: `db.patientorders.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      ordercattype: "MEDICINE"
    }
  },
  { $sort: { orderdate: -1 } },
  { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "stockdispenses",
      localField: "patientorderitems.stockdispenseuid",
      foreignField: "_id",
      as: "stockdispense"
    }
  },
  { $unwind: { path: "$stockdispense", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 1,
      warduid: 1,
      beduid: 1,
      patientuid: 1,
      cattype: "$patientorderitems.ordercattype",
      ordernumber: 1,
      orderitemuid: "$patientorderitems.orderitemuid",
      patientorderitemsuid: "$patientorderitems._id",
      quantity: "$patientorderitems.quantity",
      statusuid: "$patientorderitems.statusuid",
      stockdispensenumber: "$stockdispense.stockdispensenumber",
      entypeuid: 1,
      quantityUOM: "$patientorderitems.quantityUOM",
      orderdepartmentuid: 1,
      careprovideruid: "$patientorderitems.careprovideruid",
      routeuid: "$patientorderitems.routeuid",
      frequencyuid: "$patientorderitems.frequencyuid",
      orderdate: 1,
      modifiedat: 1,
      modifiedby: 1,
      patientvisituid: 1,
      startdate: "$patientorderitems.startdate",
      enddate: "$patientorderitems.enddate",
      isactive: "$patientorderitems.isactive",
      iscontinuousorder: "$patientorderitems.iscontinuousorder",
      isipfillallowed: "$patientorderitems.isipfillallowed",
      istaperingdose: "$patientorderitems.istaperingdose",
      iscosigned: "$patientorderitems.iscosigned",
      iscosignrequired: "$patientorderitems.iscosignrequired",
      ordertodepartmentuid: 1
    }
  },
  { $addFields: { __users: ["$careprovideruid", "$createdby", "$modifiedby"] } },
  { $lookup: { from: "users", localField: "__users", foreignField: "_id", as: "__users" } },
  {
    $addFields: {
      user: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$careprovideruid"] } } },
          0
        ]
      },
      createdby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$createdby"] } } },
          0
        ]
      },
      modifiedby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$modifiedby"] } } },
          0
        ]
      }
    }
  },
  { $project: { __users: 0 } },
  {
    $project: {
      _id: 1,
      warduid: 1,
      beduid: 1,
      patientuid: 1,
      cattype: 1,
      ordernumber: 1,
      orderitemuid: 1,
      quantity: 1,
      statusuid: 1,
      entypeuid: 1,
      quantityUOM: 1,
      orderdepartmentuid: 1,
      careprovideruid: 1,
      careprovider_name: "$user.name",
      routeuid: 1,
      frequencyuid: 1,
      createdat: 1,
      createdby: "$createdby.name",
      modifiedat: 1,
      modifiedby: "$modifiedby.name",
      orderdate: 1,
      patientorderitemsuid: 1,
      stockdispensenumber: 1,
      patientvisituid: 1,
      startdate: 1,
      enddate: 1,
      isactive: 1,
      iscontinuousorder: 1,
      isipfillallowed: 1,
      istaperingdose: 1,
      iscosigned: 1,
      iscosignrequired: 1,
      ordertodepartmentuid: 1
    }
  },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patient" } },
  { $unwind: { path: "$patient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $addFields: { __referencevalues: ["$statusuid", "$entypeuid"] } },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      status: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$statusuid"] } } },
          0
        ]
      },
      entype: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$entypeuid"] } } },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "item" } },
  { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
  { $match: { {{#itemcode}}"item.code": {{itemcode}},{{/itemcode}} } },
  {
    $lookup: { from: "referencevalues", localField: "quantityUOM", foreignField: "_id", as: "quantityUOM" }
  },
  { $unwind: { path: "$quantityUOM", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "wards", localField: "warduid", foreignField: "_id", as: "ward" } },
  { $unwind: { path: "$ward", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "beds", localField: "beduid", foreignField: "_id", as: "bed" } },
  { $unwind: { path: "$bed", preserveNullAndEmptyArrays: true } },
  { $addFields: { __departments: ["$orderdepartmentuid", "$ordertodepartmentuid"] } },
  {
    $lookup: { from: "departments", localField: "__departments", foreignField: "_id", as: "__departments" }
  },
  {
    $addFields: {
      department: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$orderdepartmentuid"] } }
          },
          0
        ]
      },
      todepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$ordertodepartmentuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __departments: 0 } },
  {
    $project: {
      _id: 1,
      HN: "$patient.mrn",
      VN: "$patientvisits.visitid",
      quantityUOM: "$quantityUOM.valuedescription",
      cattype: 1,
      ordernumber: 1,
      orderitemuid: 1,
      itemcode: "$item.code",
      itemname: "$item.name",
      quantity: 1,
      status: "$status.valuedescription",
      entype: "$entype.valuedescription",
      statusuid: 1,
      wardcode: "$ward.code",
      wardname: "$ward.name",
      bedcode: "$bed.code",
      bedname: "$bed.name",
      depcode: "$department.code",
      depname: "$department.name",
      todepcode: "$todepartment.code",
      todepname: "$todepartment.name",
      careprovideruid: 1,
      careprovider_name: 1,
      orderdate: { $dateToString: { date: "$orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: 1,
      patientorderitemsuid: 1,
      stockdispensenumber: { $ifNull: ["$stockdispensenumber", ""] },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$enddate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      isactive: 1,
      iscontinuousorder: 1,
      isipfillallowed: 1,
      istaperingdose: 1,
      iscosigned: 1,
      iscosignrequired: 1
    }
  }
])` }
    ]
  },
  {
    key: "medsadmins",
    name: "Medsadmins Data",
    category: "Pharmacy",
    description: "Medication administration records of the site, newest first, as on the Medsadmins Data page (/pharmacy/meds-admin). Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "itemcode", label: "Item code", type: "text", required: false, default: "", help: "Order item code" },
      { name: "ordernumber", label: "Order number", type: "text", required: false, default: "", help: "" }
    ],
    queries: [
      { title: "Medsadmins", query: `db.medsadmins.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
    }
  },
  { $sort: { _id: -1 } },
  {
    $lookup: { from: "patientorders", localField: "patientorderuid", foreignField: "_id", as: "patientorder" }
  },
  { $unwind: { path: "$patientorder", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patient" } },
  { $unwind: { path: "$patient", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisit" }
  },
  { $unwind: { path: "$patientvisit", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $match: { {{#itemcode}}"orderitem.code": {{itemcode}},{{/itemcode}} {{#ordernumber}}"patientorder.ordernumber": {{ordernumber}},{{/ordernumber}} } },
  {
    $addFields: {
      matchedOrderItem: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$patientorder.patientorderitems",
              as: "item",
              cond: { $eq: ["$$item._id", "$patientorderitemuid"] }
            }
          },
          0
        ]
      }
    }
  },
  {
    $lookup: {
      from: "frequencies",
      localField: "matchedOrderItem.frequencyuid",
      foreignField: "_id",
      as: "frequency"
    }
  },
  { $unwind: { path: "$frequency", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __referencevalues: [
        "$matchedOrderItem.quantityUOM",
        "$dosageUOM",
        "$matchedOrderItem.statusuid",
        "$patientorder.ordertypeuid",
        "$statusuid"
      ]
    }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      quantityUOM: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$matchedOrderItem.quantityUOM"] }
            }
          },
          0
        ]
      },
      dosageUOM: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$dosageUOM"] } } },
          0
        ]
      },
      orderstatus: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$matchedOrderItem.statusuid"] }
            }
          },
          0
        ]
      },
      ordertype: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientorder.ordertypeuid"] }
            }
          },
          0
        ]
      },
      medsadminstatus: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$statusuid"] } } },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "drugmasters", localField: "drugmasteruid", foreignField: "_id", as: "drugmaster" }
  },
  { $unwind: { path: "$drugmaster", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      UID: {
        _id: "$_id",
        patientuid: "$patientuid",
        patientvisituid: "$patientvisituid",
        departmentuid: "$departmentuid",
        careprovideruid: "$careprovideruid",
        patientorderuid: "$patientorderuid",
        patientorderitemuid: "$patientorderitemuid",
        parentorderuid: "$parentorderuid",
        parentorderitemuid: "$parentorderitemuid",
        orderitemuid: "$orderitemuid",
        drugmasteruid: "$drugmasteruid"
      },
      HN: "$patient.mrn",
      VN: "$patientvisit.visitid",
      ordernumber: "$patientorder.ordernumber",
      ordercode: "$orderitem.code",
      ordername: "$orderitem.name",
      admindate: { $dateToString: { date: "$admindate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      orderdate: {
        $dateToString: { date: "$patientorder.orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }
      },
      adminqty: "$adminqty",
      dosage: "$dosage",
      dosageUOM: "$dosageUOM.valuedescription",
      quantityUOM: "$quantityUOM.valuedescription",
      dosagedate: { $dateToString: { date: "$dosagedate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      dosagetime: { $dateToString: { date: "$dosagedate", format: "%H:%M", timezone: "Asia/Bangkok" } },
      isactive: "$isactive",
      ispom: "$matchedOrderItem.broughtfromoutside",
      isivinfusion: "$isivinfusion",
      isprnorder: "$isprnorder",
      isstatorder: "$isstatorder",
      volume: "$drugmaster.volume",
      isdosagenotapplicable: "$drugmaster.dosagenotapplicable",
      orderstatus: "$orderstatus.valuedescription",
      ordertype: "$ordertype.valuedescription",
      frequency: "$frequency.name",
      medsadminstatus: "$medsadminstatus.valuedescription",
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }
    }
  }
])` }
    ]
  },
  {
    key: "ipfill-orders",
    name: "IP Fill Order Data",
    category: "Pharmacy",
    description: "IP fill order items of the site, newest order first, as on the IP Fill Order Data page (/pharmacy/ip-fill-orders), with the linked order number. Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "IP fill order items", query: `db.ipfillorders.aggregate([
  { $match: { orguid: {{orguid}}, statusflag: "A" } },
  { $unwind: { path: "$ipfillorderitems", preserveNullAndEmptyArrays: true } },
  { $sort: { orderdate: -1 } },
  { $match: { {{#vn}}"ipfillorderitems.patientvisituid": {{vn}},{{/vn}} } },
  { $match: { {{#hn}}"ipfillorderitems.patientuid": {{hn}},{{/hn}} } },
  {
    $lookup: {
      from: "patientvisits",
      localField: "ipfillorderitems.patientvisituid",
      foreignField: "_id",
      as: "patientvisits"
    }
  },
  {
    $lookup: {
      from: "patients",
      localField: "ipfillorderitems.patientuid",
      foreignField: "_id",
      as: "patients"
    }
  },
  {
    $lookup: {
      from: "patientorders",
      foreignField: "_id",
      localField: "ipfillorderitems.patientorderuid",
      as: "patientorder"
    }
  },
  {
    $lookup: {
      from: "patientorders",
      foreignField: "_id",
      localField: "ipfillorderitems.linkpatientorderuid",
      as: "linkpatientorder"
    }
  },
  {
    $lookup: { from: "inventorystores", foreignField: "_id", localField: "invstoreuid", as: "inventorystore" }
  },
  { $unwind: { path: "$inventorystore", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      let: { statusuid: "$ipfillorderitems.statusuid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$statusuid"] } } },
        { $project: { valuedescription: 1 } }
      ],
      as: "status"
    }
  },
  {
    $lookup: {
      from: "orderitems",
      let: { orderitemuid: "$ipfillorderitems.orderitemuid" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$orderitemuid"] } } },
        { $project: { code: 1, name: 1 } }
      ],
      as: "orderitems"
    }
  },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      vn: { $ifNull: [{ $arrayElemAt: ["$patientvisits.visitid", 0] }, ""] },
      hn: { $ifNull: [{ $arrayElemAt: ["$patients.mrn", 0] }, ""] },
      orderdate: { $dateToString: { date: "$orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      cutofftime: { $dateToString: { date: "$cutofftime", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      status: { $ifNull: [{ $arrayElemAt: ["$status.valuedescription", 0] }, ""] },
      ipfillnumber: "$ipfillnumber",
      ordernumber: { $ifNull: [{ $arrayElemAt: ["$patientorder.ordernumber", 0] }, ""] },
      ordercode: { $ifNull: [{ $arrayElemAt: ["$orderitems.code", 0] }, ""] },
      ordername: { $ifNull: [{ $arrayElemAt: ["$orderitems.name", 0] }, ""] },
      ipfillquantity: "$ipfillorderitems.ipfillquantity",
      inventorystore: "$inventorystore.name",
      ismultiplefreq: "$ipfillorderitems.ismultiplefreq",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      linkpatientorderuid: "$ipfillorderitems.linkpatientorderuid",
      linkpatientorderitemuid: "$ipfillorderitems.linkpatientorderitemuid",
      // The linked order's number when it holds the linked item (the page looks it up per row)
      linkorderitemnumber: {
        $let: {
          vars: { lo: { $arrayElemAt: ["$linkpatientorder", 0] } },
          in: {
            $cond: [
              { $in: ["$ipfillorderitems.linkpatientorderitemuid", { $ifNull: ["$$lo.patientorderitems._id", []] }] },
              { $ifNull: ["$$lo.ordernumber", ""] },
              ""
            ]
          }
        }
      }
    }
  }
])` }
    ]
  },
  {
    key: "lab-master",
    name: "Lab Master Data",
    category: "Lab",
    description: "Lab tests with their result items, specimens and value ranges, as on the Lab Master Data page (/lab/master). Like the page, it reads the lab master of organisation 59e865c8ab5f11532bab0537.",
    params: [
      { name: "labcode", label: "Lab code", type: "text", required: false, default: "", help: "Lab test code" }
    ],
    queries: [
      { title: "Lab master", query: `db.labmasters.aggregate([
  { $match: { statusflag: "A", orguid: ObjectId("59e865c8ab5f11532bab0537") } },
  { $unwind: { path: "$specimeninstructions", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$resultitems", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
  { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
  { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      resultitemuid: "$resultitems.resultitemuid",
      code: "$code",
      name: "$name",
      orderitemuid: "$orderitemuid",
      specimenuid: "$specimeninstructions.specimenuid",
      createdby: "$createdby.name",
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } }
    }
  },
  { $lookup: { from: "specimens", localField: "specimenuid", foreignField: "_id", as: "specimens" } },
  { $unwind: { preserveNullAndEmptyArrays: true, path: "$specimens" } },
  {
    $lookup: {
      from: "orderresultitems",
      localField: "resultitemuid",
      foreignField: "_id",
      as: "orderresultitems"
    }
  },
  { $unwind: { preserveNullAndEmptyArrays: true, path: "$orderresultitems" } },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitems" }
  },
  { $unwind: { preserveNullAndEmptyArrays: true, path: "$orderitems" } },
  {
    $lookup: {
      from: "ordercategories",
      localField: "orderitems.ordersubcatuid",
      foreignField: "_id",
      as: "ordercategories"
    }
  },
  { $unwind: { preserveNullAndEmptyArrays: true, path: "$ordercategories" } },
  {
    $project: {
      code: "$code",
      name: "$name",
      ordersubcat: "$ordercategories.name",
      resultitem: "$orderresultitems.code",
      resultitemname: "$orderresultitems.name",
      typeresultitem: "$orderresultitems.resulttype",
      valueranges: "$orderresultitems.valueranges",
      specimens: "$specimens.name",
      resultuomuid: "$orderresultitems.uomuid",
      createdby: 1,
      createdat: 1,
      modifiedby: 1,
      modifiedat: 1
    }
  },
  {
    $lookup: { from: "referencevalues", localField: "resultuomuid", foreignField: "_id", as: "referencevalues" }
  },
  { $unwind: { preserveNullAndEmptyArrays: true, path: "$referencevalues" } },
  {
    $project: {
      code: 1,
      name: 1,
      ordersubcat: 1,
      resultitem: 1,
      resultitemname: 1,
      valueranges_m: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$valueranges",
              as: "valueranges",
              cond: { $eq: ["$$valueranges.genderuid", ObjectId("59eeee62a277d1052ea6463b")] }
            }
          },
          0
        ]
      },
      valueranges_f: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$valueranges",
              as: "valueranges",
              cond: { $eq: ["$$valueranges.genderuid", ObjectId("59eeee62a277d1052ea6463c")] }
            }
          },
          0
        ]
      },
      typeresultitem: 1,
      specimens: 1,
      uomname: "$referencevalues.valuedescription",
      createdby: 1,
      createdat: 1,
      modifiedby: 1,
      modifiedat: 1
    }
  },
  {
    $project: {
      _id: 0,
      code: 1,
      name: 1,
      ordersubcat: 1,
      resultitem: 1,
      resultitemname: 1,
      normalstart_male: { $ifNull: ["$valueranges_m.normalrangestart", ""] },
      normalend_male: { $ifNull: ["$valueranges_m.normalrangeend", ""] },
      normalstart_female: { $ifNull: ["$valueranges_f.normalrangestart", ""] },
      normalend_female: { $ifNull: ["$valueranges_f.normalrangeend", ""] },
      typeresultitem: 1,
      specimens: 1,
      uomname: { $ifNull: ["$uomname", ""] },
      createdby: 1,
      createdat: 1,
      modifiedby: 1,
      modifiedat: 1
    }
  },
  { $match: { {{#labcode}}code: {{labcode}},{{/labcode}} } },
  { $sort: { code: -1, resultitem: 1, specimens: 1 } }
])` }
    ]
  },
  {
    key: "lab-orders",
    name: "Lab Orders Data",
    category: "Lab",
    description: "LAB order items of the site, newest order first, as on the Lab Orders Data page (/lab/orders). Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Lab order items", query: `db.patientorders.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      ordercattype: "LAB"
    }
  },
  { $sort: { _id: -1 } },
  { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      ordercattype: 1,
      createdat: 1,
      createdby: 1,
      modifiedat: 1,
      modifiedby: 1,
      ordernumber: 1,
      patientuid: 1,
      patientvisituid: 1,
      orderitemuid: "$patientorderitems.orderitemuid",
      orderitemname: "$patientorderitems.orderitemname",
      statusuid: "$patientorderitems.statusuid",
      careprovideruid: "$patientorderitems.careprovideruid",
      orderdepartmentuid: 1,
      ordertodepartmentuid: 1,
      accessionnumber: "$patientorderitems.accessionnumber",
      startdate: "$patientorderitems.startdate",
      isautogenerated: 1,
      quantity: "$patientorderitems.quantity",
      unitprice: "$patientorderitems.unitprice",
      totalprice: "$patientorderitems.totalprice",
      payordiscount: "$patientorderitems.payordiscount",
      specialdiscount: "$patientorderitems.specialdiscount",
      quantityUOM: "$patientorderitems.quantityUOM",
      ordercatuid: "$patientorderitems.ordercatuid",
      ordersubcatuid: "$patientorderitems.ordersubcatuid",
      isactive: "$patientorderitems.isactive",
      ispom: "$patientorderitems.broughtfromoutside",
      iscontinuousorder: "$patientorderitems.iscontinuousorder",
      isipfillallowed: "$patientorderitems.isipfillallowed",
      tariffuid: "$patientorderitems.tariffuid"
    }
  },
  { $addFields: { __ordercategories: ["$ordercatuid", "$ordersubcatuid"] } },
  {
    $lookup: {
      from: "ordercategories",
      localField: "__ordercategories",
      foreignField: "_id",
      as: "__ordercategories"
    }
  },
  {
    $addFields: {
      ordercat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordercatuid"] } }
          },
          0
        ]
      },
      ordersubcat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordersubcatuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __ordercategories: 0 } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  { $addFields: { __users: ["$careprovideruid", "$createdby", "$modifiedby"] } },
  { $lookup: { from: "users", localField: "__users", foreignField: "_id", as: "__users" } },
  {
    $addFields: {
      careprovider: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$careprovideruid"] } } },
          0
        ]
      },
      createdby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$createdby"] } } },
          0
        ]
      },
      modifiedby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$modifiedby"] } } },
          0
        ]
      }
    }
  },
  { $project: { __users: 0 } },
  { $addFields: { __departments: ["$orderdepartmentuid", "$ordertodepartmentuid"] } },
  {
    $lookup: { from: "departments", localField: "__departments", foreignField: "_id", as: "__departments" }
  },
  {
    $addFields: {
      orderdepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$orderdepartmentuid"] } }
          },
          0
        ]
      },
      ordertodepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$ordertodepartmentuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __departments: 0 } },
  {
    $lookup: { from: "labresults", localField: "_id", foreignField: "patientorderuid", as: "labresult" }
  },
  { $unwind: { path: "$labresult", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tariffs", localField: "tariffuid", foreignField: "_id", as: "tariff" } },
  { $unwind: { path: "$tariff", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __referencevalues: [
        "$statusuid",
        "$quantityUOM",
        "$orderitem.defaultmodalityuid",
        "$patientvisits.visitstatusuid"
      ]
    }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      status: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$statusuid"] } } },
          0
        ]
      },
      quantityUOM: {
        $arrayElemAt: [
          {
            $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$quantityUOM"] } }
          },
          0
        ]
      },
      modality: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$orderitem.defaultmodalityuid"] }
            }
          },
          0
        ]
      },
      visitstatus: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientvisits.visitstatusuid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  {
    $project: {
      ordercattype: 1,
      startdate_search: { $dateToString: { date: "$startdate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      orderdate: { $dateToString: { date: "$startdate", format: "%d-%m-%Y %H:%M", timezone: "Asia/Bangkok" } },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedatforsort: "$modifiedat",
      ordernumber: 1,
      hn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      orderitemname: 1,
      statusuid: "$status.valuedescription",
      careprovider: "$careprovider.name",
      orderdepartment: "$orderdepartment.name",
      ordertodepartment: "$ordertodepartment.name",
      visitstatusuid: "$visitstatus.valuedescription",
      accessionnumber: 1,
      specimencollecteddate: {
        $dateToString: { date: "$labresult.specimencollecteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      specimenaccepteddate: {
        $dateToString: { date: "$labresult.specimenaccepteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      resultdate: {
        $dateToString: { date: "$labresult.resultdate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      approvaldate: {
        $dateToString: { date: "$labresult.approvaldate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      orderitemcode: "$orderitem.code",
      isautogenerated: 1,
      quantity: 1,
      isexecute: "$orderitem.istaskgenerationreqd",
      unitprice: 1,
      totalprice: 1,
      payordiscount: { $ifNull: ["$payordiscount", 0] },
      specialdiscount: { $ifNull: ["$specialdiscount", 0] },
      quantityUOM: "$quantityUOM.valuedescription",
      ordercat: "$ordercat.name",
      ordersubcat: "$ordersubcat.name",
      isactive: 1,
      ispom: 1,
      iscontinuousorder: 1,
      isipfillallowed: 1,
      tariffunitprice: { $ifNull: ["$tariff.unitprice", ""] },
      modalityCode: { $ifNull: ["$modality.valuecode", ""] }
    }
  }
])` }
    ]
  },
  {
    key: "radiology-orders",
    name: "RADIOLOGY Orders Data",
    category: "Radiology",
    description: "RADIOLOGY order items of the site, newest order first, as on the RADIOLOGY Orders Data page (/radiology/orders). Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" },
      { name: "accessionnumber", label: "Accession number", type: "text", required: false, default: "", help: "" }
    ],
    queries: [
      { title: "Radiology order items", query: `db.patientorders.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      ordercattype: "RADIOLOGY"
    }
  },
  { $sort: { _id: -1 } },
  { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      ordercattype: 1,
      createdat: 1,
      createdby: 1,
      modifiedat: 1,
      modifiedby: 1,
      ordernumber: 1,
      patientuid: 1,
      patientvisituid: 1,
      orderitemuid: "$patientorderitems.orderitemuid",
      orderitemname: "$patientorderitems.orderitemname",
      statusuid: "$patientorderitems.statusuid",
      careprovideruid: "$patientorderitems.careprovideruid",
      orderdepartmentuid: 1,
      ordertodepartmentuid: 1,
      accessionnumber: "$patientorderitems.accessionnumber",
      startdate: "$patientorderitems.startdate",
      isautogenerated: 1,
      quantity: "$patientorderitems.quantity",
      unitprice: "$patientorderitems.unitprice",
      totalprice: "$patientorderitems.totalprice",
      payordiscount: "$patientorderitems.payordiscount",
      specialdiscount: "$patientorderitems.specialdiscount",
      quantityUOM: "$patientorderitems.quantityUOM",
      ordercatuid: "$patientorderitems.ordercatuid",
      ordersubcatuid: "$patientorderitems.ordersubcatuid",
      isactive: "$patientorderitems.isactive",
      ispom: "$patientorderitems.broughtfromoutside",
      iscontinuousorder: "$patientorderitems.iscontinuousorder",
      isipfillallowed: "$patientorderitems.isipfillallowed",
      tariffuid: "$patientorderitems.tariffuid"
    }
  },
  { $match: { {{#accessionnumber}}accessionnumber: {{accessionnumber}},{{/accessionnumber}} } },
  { $addFields: { __ordercategories: ["$ordercatuid", "$ordersubcatuid"] } },
  {
    $lookup: {
      from: "ordercategories",
      localField: "__ordercategories",
      foreignField: "_id",
      as: "__ordercategories"
    }
  },
  {
    $addFields: {
      ordercat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordercatuid"] } }
          },
          0
        ]
      },
      ordersubcat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordersubcatuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __ordercategories: 0 } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  { $addFields: { __users: ["$careprovideruid", "$createdby", "$modifiedby"] } },
  { $lookup: { from: "users", localField: "__users", foreignField: "_id", as: "__users" } },
  {
    $addFields: {
      careprovider: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$careprovideruid"] } } },
          0
        ]
      },
      createdby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$createdby"] } } },
          0
        ]
      },
      modifiedby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$modifiedby"] } } },
          0
        ]
      }
    }
  },
  { $project: { __users: 0 } },
  { $addFields: { __departments: ["$orderdepartmentuid", "$ordertodepartmentuid"] } },
  {
    $lookup: { from: "departments", localField: "__departments", foreignField: "_id", as: "__departments" }
  },
  {
    $addFields: {
      orderdepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$orderdepartmentuid"] } }
          },
          0
        ]
      },
      ordertodepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$ordertodepartmentuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __departments: 0 } },
  {
    $lookup: { from: "labresults", localField: "_id", foreignField: "patientorderuid", as: "labresult" }
  },
  { $unwind: { path: "$labresult", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tariffs", localField: "tariffuid", foreignField: "_id", as: "tariff" } },
  { $unwind: { path: "$tariff", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __referencevalues: [
        "$statusuid",
        "$quantityUOM",
        "$orderitem.defaultmodalityuid",
        "$patientvisits.visitstatusuid"
      ]
    }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      status: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$statusuid"] } } },
          0
        ]
      },
      quantityUOM: {
        $arrayElemAt: [
          {
            $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$quantityUOM"] } }
          },
          0
        ]
      },
      modality: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$orderitem.defaultmodalityuid"] }
            }
          },
          0
        ]
      },
      visitstatus: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientvisits.visitstatusuid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  {
    $project: {
      ordercattype: 1,
      startdate_search: { $dateToString: { date: "$startdate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      orderdate: { $dateToString: { date: "$startdate", format: "%d-%m-%Y %H:%M", timezone: "Asia/Bangkok" } },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedatforsort: "$modifiedat",
      ordernumber: 1,
      hn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      orderitemname: 1,
      statusuid: "$status.valuedescription",
      careprovider: "$careprovider.name",
      orderdepartment: "$orderdepartment.name",
      ordertodepartment: "$ordertodepartment.name",
      visitstatusuid: "$visitstatus.valuedescription",
      accessionnumber: 1,
      specimencollecteddate: {
        $dateToString: { date: "$labresult.specimencollecteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      specimenaccepteddate: {
        $dateToString: { date: "$labresult.specimenaccepteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      resultdate: {
        $dateToString: { date: "$labresult.resultdate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      approvaldate: {
        $dateToString: { date: "$labresult.approvaldate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      orderitemcode: "$orderitem.code",
      isautogenerated: 1,
      quantity: 1,
      isexecute: "$orderitem.istaskgenerationreqd",
      unitprice: 1,
      totalprice: 1,
      payordiscount: { $ifNull: ["$payordiscount", 0] },
      specialdiscount: { $ifNull: ["$specialdiscount", 0] },
      quantityUOM: "$quantityUOM.valuedescription",
      ordercat: "$ordercat.name",
      ordersubcat: "$ordersubcat.name",
      isactive: 1,
      ispom: 1,
      iscontinuousorder: 1,
      isipfillallowed: 1,
      tariffunitprice: { $ifNull: ["$tariff.unitprice", ""] },
      modalityCode: { $ifNull: ["$modality.valuecode", ""] }
    }
  }
])` }
    ]
  },
  {
    key: "patient-diets",
    name: "Patient Diets",
    category: "Diet",
    description: "DIET order items of the site, newest order first, as on the Patient Diets page (/diet/orders). Every filter is optional.",
    params: [
      { name: "hn", label: "HN", type: "hn", required: false, default: "", help: "Patient HN (mrn)" },
      { name: "vn", label: "VN", type: "vn", required: false, default: "", help: "Visit number (visitid)" }
    ],
    queries: [
      { title: "Diet order items", query: `db.patientorders.aggregate([
  {
    $match: {
      orguid: {{orguid}},
      statusflag: "A",
      {{#vn}}patientvisituid: {{vn}},{{/vn}}
      {{#hn}}patientuid: {{hn}},{{/hn}}
      ordercattype: "DIET"
    }
  },
  { $sort: { _id: -1 } },
  { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      ordercattype: 1,
      createdat: 1,
      createdby: 1,
      modifiedat: 1,
      modifiedby: 1,
      ordernumber: 1,
      patientuid: 1,
      patientvisituid: 1,
      orderitemuid: "$patientorderitems.orderitemuid",
      orderitemname: "$patientorderitems.orderitemname",
      statusuid: "$patientorderitems.statusuid",
      careprovideruid: "$patientorderitems.careprovideruid",
      orderdepartmentuid: 1,
      ordertodepartmentuid: 1,
      accessionnumber: "$patientorderitems.accessionnumber",
      startdate: "$patientorderitems.startdate",
      isautogenerated: 1,
      quantity: "$patientorderitems.quantity",
      unitprice: "$patientorderitems.unitprice",
      totalprice: "$patientorderitems.totalprice",
      payordiscount: "$patientorderitems.payordiscount",
      specialdiscount: "$patientorderitems.specialdiscount",
      quantityUOM: "$patientorderitems.quantityUOM",
      ordercatuid: "$patientorderitems.ordercatuid",
      ordersubcatuid: "$patientorderitems.ordersubcatuid",
      isactive: "$patientorderitems.isactive",
      ispom: "$patientorderitems.broughtfromoutside",
      iscontinuousorder: "$patientorderitems.iscontinuousorder",
      isipfillallowed: "$patientorderitems.isipfillallowed",
      tariffuid: "$patientorderitems.tariffuid"
    }
  },
  { $addFields: { __ordercategories: ["$ordercatuid", "$ordersubcatuid"] } },
  {
    $lookup: {
      from: "ordercategories",
      localField: "__ordercategories",
      foreignField: "_id",
      as: "__ordercategories"
    }
  },
  {
    $addFields: {
      ordercat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordercatuid"] } }
          },
          0
        ]
      },
      ordersubcat: {
        $arrayElemAt: [
          {
            $filter: { input: "$__ordercategories", as: "doc", cond: { $eq: ["$$doc._id", "$ordersubcatuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __ordercategories: 0 } },
  {
    $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" }
  },
  { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
  { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
  { $addFields: { __users: ["$careprovideruid", "$createdby", "$modifiedby"] } },
  { $lookup: { from: "users", localField: "__users", foreignField: "_id", as: "__users" } },
  {
    $addFields: {
      careprovider: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$careprovideruid"] } } },
          0
        ]
      },
      createdby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$createdby"] } } },
          0
        ]
      },
      modifiedby: {
        $arrayElemAt: [
          { $filter: { input: "$__users", as: "doc", cond: { $eq: ["$$doc._id", "$modifiedby"] } } },
          0
        ]
      }
    }
  },
  { $project: { __users: 0 } },
  { $addFields: { __departments: ["$orderdepartmentuid", "$ordertodepartmentuid"] } },
  {
    $lookup: { from: "departments", localField: "__departments", foreignField: "_id", as: "__departments" }
  },
  {
    $addFields: {
      orderdepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$orderdepartmentuid"] } }
          },
          0
        ]
      },
      ordertodepartment: {
        $arrayElemAt: [
          {
            $filter: { input: "$__departments", as: "doc", cond: { $eq: ["$$doc._id", "$ordertodepartmentuid"] } }
          },
          0
        ]
      }
    }
  },
  { $project: { __departments: 0 } },
  {
    $lookup: { from: "labresults", localField: "_id", foreignField: "patientorderuid", as: "labresult" }
  },
  { $unwind: { path: "$labresult", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" }
  },
  { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tariffs", localField: "tariffuid", foreignField: "_id", as: "tariff" } },
  { $unwind: { path: "$tariff", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      __referencevalues: [
        "$statusuid",
        "$quantityUOM",
        "$orderitem.defaultmodalityuid",
        "$patientvisits.visitstatusuid"
      ]
    }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "__referencevalues",
      foreignField: "_id",
      as: "__referencevalues"
    }
  },
  {
    $addFields: {
      status: {
        $arrayElemAt: [
          { $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$statusuid"] } } },
          0
        ]
      },
      quantityUOM: {
        $arrayElemAt: [
          {
            $filter: { input: "$__referencevalues", as: "doc", cond: { $eq: ["$$doc._id", "$quantityUOM"] } }
          },
          0
        ]
      },
      modality: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$orderitem.defaultmodalityuid"] }
            }
          },
          0
        ]
      },
      visitstatus: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$__referencevalues",
              as: "doc",
              cond: { $eq: ["$$doc._id", "$patientvisits.visitstatusuid"] }
            }
          },
          0
        ]
      }
    }
  },
  { $project: { __referencevalues: 0 } },
  {
    $project: {
      ordercattype: 1,
      startdate_search: { $dateToString: { date: "$startdate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
      orderdate: { $dateToString: { date: "$startdate", format: "%d-%m-%Y %H:%M", timezone: "Asia/Bangkok" } },
      startdate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      enddate: { $dateToString: { date: "$startdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdby: "$createdby.name",
      modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      modifiedby: "$modifiedby.name",
      modifiedatforsort: "$modifiedat",
      ordernumber: 1,
      hn: "$patients.mrn",
      visitid: "$patientvisits.visitid",
      orderitemname: 1,
      statusuid: "$status.valuedescription",
      careprovider: "$careprovider.name",
      orderdepartment: "$orderdepartment.name",
      ordertodepartment: "$ordertodepartment.name",
      visitstatusuid: "$visitstatus.valuedescription",
      accessionnumber: 1,
      specimencollecteddate: {
        $dateToString: { date: "$labresult.specimencollecteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      specimenaccepteddate: {
        $dateToString: { date: "$labresult.specimenaccepteddate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      resultdate: {
        $dateToString: { date: "$labresult.resultdate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      approvaldate: {
        $dateToString: { date: "$labresult.approvaldate", format: "%d/%m/%Y %H:%M:%S", timezone: "Asia/Bangkok" }
      },
      orderitemcode: "$orderitem.code",
      isautogenerated: 1,
      quantity: 1,
      isexecute: "$orderitem.istaskgenerationreqd",
      unitprice: 1,
      totalprice: 1,
      payordiscount: { $ifNull: ["$payordiscount", 0] },
      specialdiscount: { $ifNull: ["$specialdiscount", 0] },
      quantityUOM: "$quantityUOM.valuedescription",
      ordercat: "$ordercat.name",
      ordersubcat: "$ordersubcat.name",
      isactive: 1,
      ispom: 1,
      iscontinuousorder: 1,
      isipfillallowed: 1,
      tariffunitprice: { $ifNull: ["$tariff.unitprice", ""] },
      modalityCode: { $ifNull: ["$modality.valuecode", ""] }
    }
  }
])` }
    ]
  },
  {
    key: "item-masters",
    name: "Get Itemmasters",
    category: "Inventory",
    description: "Item masters of the site with their handling stores, newest first, as on the Get Itemmasters page (/inventory/item-masters).",
    params: [
      { name: "code", label: "Item code", type: "text", required: false, default: "", help: "Item master code" }
    ],
    queries: [
      { title: "Item masters", query: `db.itemmasters.aggregate([
  { $match: { statusflag: "A", orguid: {{orguid}}, {{#code}}code: {{code}},{{/code}} } },
  { $sort: { _id: -1 } },
  { $unwind: { path: "$handlingstores", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
  { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      createdat: "$createdat",
      code: "$code",
      name: "$name",
      externalcode: { $ifNull: ["$externalcode", ""] },
      description: "$description",
      baseuomuid: "$baseuomuid",
      purchasinguomuid: "$purchasinguomuid",
      storeuid: "$handlingstores.storeuid",
      createdby: "$users.name",
      createdbycode: "$users.code",
      allowconsignmentstock: "$allowconsignmentstock",
      allowfractions: "$allowfractions",
      allownegativestock: "$allownegativestock",
      allowrepacking: "$allowrepacking",
      isbatchidmandatory: "$isbatchidmandatory",
      isexpirydatemandatory: "$isexpirydatemandatory",
      ismanufacturingitem: "$ismanufacturingitem",
      isnoninventoryitem: "$isnoninventoryitem",
      itemtypeuid: "$itemtypeuid"
    }
  },
  {
    $lookup: { from: "referencevalues", localField: "baseuomuid", foreignField: "_id", as: "baseuom" }
  },
  {
    $lookup: {
      from: "referencevalues",
      localField: "purchasinguomuid",
      foreignField: "_id",
      as: "purchasinguom"
    }
  },
  {
    $lookup: { from: "inventorystores", localField: "storeuid", foreignField: "_id", as: "inventorystores" }
  },
  {
    $lookup: { from: "referencevalues", localField: "itemtypeuid", foreignField: "_id", as: "itemtype" }
  },
  { $unwind: { path: "$baseuom", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$purchasinguom", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$inventorystores", preserveNullAndEmptyArrays: true } },
  { $unwind: { path: "$itemtype", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      createdatforsort: "$createdat",
      code: 1,
      name: 1,
      externalcode: 1,
      baseuomcode: "$baseuom.valuecode",
      baseuomname: "$baseuom.valuedescription",
      purchasinguomcode: "$purchasinguom.valuecode",
      purchasinguomname: "$purchasinguom.valuedescription",
      storecode: "$inventorystores.code",
      storename: "$inventorystores.name",
      createdby: 1,
      itemtype: "$itemtype.valuedescription",
      allowconsignmentstock: 1,
      allowfractions: 1,
      allownegativestock: 1,
      allowrepacking: 1,
      isbatchidmandatory: 1,
      isexpirydatemandatory: 1,
      ismanufacturingitem: 1,
      isnoninventoryitem: 1,
      createdbycode: 1
    }
  }
])` }
    ]
  },
  {
    key: "goods-receipts",
    name: "Get Interfaced GR",
    category: "Inventory",
    description: "Goods receipts of the site, newest first, as on the Get Interfaced GR page (/inventory/goods-receipts).",
    params: [
      { name: "grn", label: "GRN number", type: "text", required: false, default: "", help: "Goods receipt number" }
    ],
    queries: [
      { title: "Goods receipts", query: `db.goodsreceives.aggregate([
  { $match: { statusflag: "A", orguid: {{orguid}}, {{#grn}}grnnumber: {{grn}},{{/grn}} } },
  { $sort: { _id: -1 } },
  { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
  { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "inventorystores", localField: "storeuid", foreignField: "_id", as: "inventorystores" }
  },
  { $unwind: { path: "$inventorystores", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "vendors", localField: "vendoruid", foreignField: "_id", as: "vendor" } },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "statusuid", foreignField: "_id", as: "status" }
  },
  { $unwind: { path: "$status", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "grntypeuid", foreignField: "_id", as: "grntype" }
  },
  { $unwind: { path: "$grntype", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "approvedby", foreignField: "_id", as: "approvedby" } },
  { $unwind: { path: "$approvedby", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      grnnumber: "$grnnumber",
      invoicenumber: "$invoicenumber",
      invoicedate: { $dateToString: { date: "$invoicedate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      grntype: "$grntype.valuedescription",
      storecode: "$inventorystores.code",
      storename: "$inventorystores.name",
      vendorcode: { $ifNull: ["$vendor.code", ""] },
      vendorname: { $ifNull: ["$vendor.name", ""] },
      comments: { $ifNull: ["$comments", ""] },
      netamount: { $ifNull: ["$netamount", ""] },
      items: { $size: "$itemdetails" },
      approvedby: "$approvedby.name",
      approvaldate: { $dateToString: { date: "$approvaldate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" } },
      status: { $ifNull: ["$status.valuedescription", ""] }
    }
  }
])` }
    ]
  },
  {
    key: "available-items",
    name: "Available Items",
    category: "Inventory",
    description: "Stock ledger rows with stock left (quantity > 0), largest quantity first, as on the Available Items page (/inventory/available-items).",
    params: [
      { name: "item", label: "Item code", type: "item", required: false, default: "", help: "Item master code" }
    ],
    queries: [
      { title: "Available items", query: `db.stockledgers.aggregate([
  {
    $match: {
      statusflag: "A",
      orguid: {{orguid}},
      quantity: { $gt: 0 },
      {{#item}}itemmasteruid: {{item}},{{/item}}
    }
  },
  { $sort: { quantity: -1, _id: -1 } },
  {
    $lookup: { from: "itemmasters", localField: "itemmasteruid", foreignField: "_id", as: "itemmasters" }
  },
  { $unwind: { path: "$itemmasters", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "referencevalues", localField: "quantityuom", foreignField: "_id", as: "quantityuom" }
  },
  { $unwind: { path: "$quantityuom", preserveNullAndEmptyArrays: true } },
  {
    $lookup: { from: "inventorystores", foreignField: "_id", localField: "storeuid", as: "storeuid" }
  },
  { $unwind: { path: "$storeuid", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "referencevalues",
      foreignField: "_id",
      localField: "itemmasters.itemtypeuid",
      as: "itemtypeuid"
    }
  },
  { $unwind: { path: "$itemtypeuid", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      code: "$itemmasters.code",
      name: "$itemmasters.name",
      quantity: "$quantity",
      uom_code: "$quantityuom.valuecode",
      uom: "$quantityuom.valuedescription",
      type: "$itemtypeuid.valuedescription",
      store_code: "$storeuid.code",
      store: "$storeuid.name",
      expirydate: {
        $cond: [
          {
            $and: [
              { $gte: ["$expirydate", ISODate("0000-01-02T00:00:00.000Z")] },
              { $lt: ["$expirydate", ISODate("9999-12-31T00:00:00.000Z")] }
            ]
          },
          { $dateToString: { date: "$expirydate", format: "%d/%m/%Y", timezone: "Asia/Bangkok" } },
          {
            $cond: [
              { $eq: [{ $type: "$expirydate" }, "date"] },
              {
                $concat: [
                  "⚠ invalid (year ",
                  { $toString: { $add: [1970, { $floor: { $divide: [{ $toLong: "$expirydate" }, 31556952000] } }] } },
                  ")"
                ]
              },
              null
            ]
          }
        ]
      },
      batchid: "$batchid"
    }
  }
])` }
    ]
  }
];
