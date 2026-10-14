const mongoose = require("mongoose");
exports.getPatientBillDFPackageItems  = async function (orguid, patientuid, visituid) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(visituid)
    initfilter.patientvisituid = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match :initfilter
        },
        { $lookup: { from: "patientvisits", foreignField: "_id", localField: "patientvisituid", as: "patientvisituid" } },
        { $unwind: { path: '$patientvisituid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", foreignField: "_id", localField: "patientvisituid.entypeuid", as: "patientvisituid.entypeuid" } },
        { $unwind: { path: '$patientvisituid.entypeuid', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
        {
          $match: {
              "patientbilleditems.chargecodetype": "PATIENTPACKAGE"
          }
      },
      { $lookup: { from: "patientpackages", foreignField: "_id", localField: "patientbilleditems.patientorderuid", as: "patientpackage" } },
      { $unwind: { path: '$patientpackage', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$patientpackage.orderitems', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "orderitems", foreignField: "_id", localField: "patientpackage.orderitems.orderitemuid", as: "patientpackage.orderitems.orderitemuid" } },
      { $unwind: { path: '$patientpackage.orderitems.orderitemuid', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "ordercategories", foreignField: "_id", localField: "patientpackage.orderitems.orderitemuid.ordercatuid", as: "patientpackage.orderitems.orderitemuid.ordercatuid" } },
      { $unwind: { path: '$patientpackage.orderitems.orderitemuid.ordercatuid', preserveNullAndEmptyArrays: true } },
      {
        $match: {
            $or: [
                { "patientpackage.orderitems.orderitemuid.ordercatuid.ordercattype": "DOCTORFEE"},
                { "patientpackage.orderitems.orderitemuid.isdoctorshareitem": true }
            ]
        }
    },
    { $lookup: { from: "ordercategories", foreignField: "_id", localField: "patientbilleditems.orderitemuid.ordersubcatuid", as: "patientbilleditems.orderitemuid.ordersubcatuid" } },
    { $unwind: { path: '$patientbilleditems.orderitemuid.ordersubcatuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "tariffs", foreignField: "_id", localField: "patientbilleditems.tariffuid", as: "patientbilleditems.tariffuid" } },
    { $unwind: { path: '$patientbilleditems.tariffuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "tpas", localField: "tpauid", foreignField: "_id", as: "tpauid" } },
    { $unwind: { path: "$tpauid", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", foreignField: "_id", localField: "useruid", as: "useruid" } },
    { $unwind: { path: '$useruid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "departments", foreignField: "_id", localField: "userdepartmentuid", as: "userdepartmentuid" } },
    { $unwind: { path: '$userdepartmentuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "patients", foreignField: "_id", localField: "patientuid", as: "patientuid" } },
    { $unwind: { path: '$patientuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "patientorders", foreignField: "_id", localField: "patientbilleditems.patientorderuid", as: "patientbilleditems.patientorderuid" } },
    { $unwind: { path: '$patientbilleditems.patientorderuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", foreignField: "_id", localField: "patientbilleditems.patientorderuid.createdby", as: "patientbilleditems.patientorderuid.createdby" } },
    { $unwind: { path: '$patientbilleditems.patientorderuid.createdby', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "departments", foreignField: "_id", localField: "patientbilleditems.departmentuid", as: "patientbilleditems.departmentuid" } },
    { $unwind: { path: '$patientbilleditems.departmentuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "billinggroups", foreignField: "_id", localField: "patientbilleditems.billingsubgroupuid", as: "patientbilleditems.billingsubgroupuid" } },
    { $unwind: { path: '$patientbilleditems.billingsubgroupuid', preserveNullAndEmptyArrays: true } },
    {
        $lookup: {
            from: "ordercategories",
            foreignField: "_id",
            localField: "patientpackage.orderitems.orderitemuid.ordersubcatuid",
            as: "patientpackage.orderitems.orderitemuid.ordersubcatuid"
        }
    },
    { $unwind: { path: '$patientpackage.orderitems.orderitemuid.ordersubcatuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "ordersets", foreignField: "_id", localField: "patientbilleditems.orderitemuid", as: "ordersetuid" } },
    { $unwind: { path: '$ordersetuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "tpas", localField: "tpauid", foreignField: "_id", as: "tpauid" } },
    { $unwind: { path: "$tpauid", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "departments", foreignField: "_id", localField: "userdepartmentuid", as: "userdepartmentuid" } },
    { $unwind: { path: '$userdepartmentuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "patients", foreignField: "_id", localField: "patientuid", as: "patientuid" } },
    { $unwind: { path: '$patientuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "referencevalues", foreignField: "_id", localField: "patientvisituid.entypeuid", as: "patientvisituid.entypeuid" } },
    { $unwind: { path: '$patientvisituid.entypeuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", foreignField: "_id", localField: "patientbilleditems.careprovideruid", as: "patientbilleditems.careprovideruid" } },
    { $unwind: { path: '$patientbilleditems.careprovideruid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "billinggroups", foreignField: "_id", localField: "patientbilleditems.billingsubgroupuid", as: "patientbilleditems.billingsubgroupuid" } },
    { $unwind: { path: '$patientbilleditems.billinggroupuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "billinggroups", foreignField: "_id", localField: "patientbilleditems.billinggroupuid", as: "patientbilleditems.billinggroupuid" } },
    { $unwind: { path: '$patientbilleditems.billinggroupuid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "patientorders", foreignField: "patientuid", localField: "patientuid._id", as: "patientorders" } },
    {
        $project : {
          chargedate : { $dateToString: { date : "$patientbilleditems.chargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          patientorderuid : 1,
          billinggroup : "$patientbilleditems.billinggroupuid.name",
          billingsubgroup : "$patientbilleditems.billingsubgroupuid.name",
          ordernumber : "$patientbilleditems.ordernumber",
          orderitemcode : "$patientpackage.orderitems.orderitemuid.code",
          orderitemname : "$patientpackage.orderitems.orderitemuid.name",
          chargecodetype : "$patientbilleditems.chargecodetype",
          quantity : "$patientbilleditems.quantity",
          unitprice : "$patientpackage.orderitems.packageitemprice",
          doctorshare : "$patientpackage.orderitems.doctoritemshare",
          payordiscount : "$patientbilleditems.payordiscount",
          specialdiscount :"$patientbilleditems.specialdiscount",
          taxamount : "$patientbilleditems.taxamount",
          netamount : { $multiply: ["$patientbilleditems.quantity", "$patientpackage.orderitems.packageitemprice"]},
          overriddenprice : "$patientbilleditems.overriddenprice",
          unitcost : "$patientbilleditems.unitcost",
          profitability : "$patientbilleditems.profitability",
          careprovider : "$patientbilleditems.careprovideruid.name",
          visitid : "$patientvisituid.visitid"
        }
      
      },
      {
          $sort: { "billdate": 1.0 }
      }
      ],
      { allowDiskUse: true }
      )
      .toArray()
      .then(function (res) {
        return res;
      })
      .catch(function (err) {
        console.log(err)
      });

      return data;
}

exports.getPatientBillDFItems = async function (orguid, patientuid, visituid) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(visituid)
    initfilter.patientvisituid = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;
  let data = await mongoose.connection.db
  .collection("patientbills")
  .aggregate(
    [
      {
             $match : initfilter
      },
      { $lookup: { from: "patientvisits", foreignField: "_id", localField: "patientvisituid", as: "patientvisituid" } },
      { $unwind: { path: '$patientvisituid', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", foreignField: "_id", localField: "patientbilleditems.careprovideruid", as: "patientbilleditems.careprovideruid" } },
      { $unwind: { path: '$patientbilleditems.careprovideruid', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "tariffs", foreignField: "_id", localField: "patientbilleditems.tariffuid", as: "tariffs" } },
      { $unwind: { path: '$tariffs', preserveNullAndEmptyArrays: true } },
      {
        $project : {
          sequencenumber : "$sequencenumber",
          patientorderuid : "$patientbilleditems.patientorderuid",
          billinggroupuid : "$patientbilleditems.billinggroupuid",
          billingsubgroupuid : "$patientbilleditems.billingsubgroupuid",
          ordernumber : "$patientbilleditems.ordernumber",
          orderitemuid : "$patientbilleditems.orderitemuid",
          orderitemname : "$patientbilleditems.orderitemname",
          chargecodetype : "$patientbilleditems.chargecodetype",
          quantity : "$patientbilleditems.quantity",
          unitprice : "$patientbilleditems.unitprice",
          payordiscount : "$patientbilleditems.payordiscount",
          specialdiscount : "$patientbilleditems.specialdiscount",
          taxamount : "$patientbilleditems.taxamount",
          netamount : "$patientbilleditems.netamount",
          overriddenprice : "$patientbilleditems.overriddenprice",
          unitcost : "$patientbilleditems.unitcost",
          profitability : "$patientbilleditems.profitability",
          chargedate : "$patientbilleditems.chargedate",
          doctorshare : "$tariffs.doctorshare",
          careprovider : "$patientbilleditems.careprovideruid.name",
          patientvisituid : "$patientvisituid",
        },
        
    },
    { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" } },
    { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "ordercategories", foreignField: "_id", localField: "orderitem.ordercatuid", as: "ordercatuid" } },
    { $unwind: { path: '$ordercatuid', preserveNullAndEmptyArrays: true } },
    {
      $match: {
          $or: [
              { "ordercatuid.ordercattype": "DOCTORFEE" },
              { "orderitem.isdoctorshareitem": true }
          ]
      }
    },
    { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
    { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" } },
    { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "billinggroups", localField: "billingsubgroupuid", foreignField: "_id", as: "billingsubgroup" } },
    { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
    {
      $project : {
        chargedate : { $dateToString: { date : "$chargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
        patientorderuid : 1,
        billinggroup : "$billinggroup.name",
        billingsubgroup : "$billingsubgroup.name",
        ordernumber : 1,
        orderitemcode : {
          $cond: { if: { $ne: ['$chargecodetype', "PATIENTPACKAGE"] }, then: '$orderitem.code', else: '$orderset.code' }
        },
        orderitemname : 1,
        chargecodetype : 1,
        quantity : 1,
        unitprice : 1,
        payordiscount : 1,
        specialdiscount : 1,
        taxamount : 1,
        netamount : 1,
        overriddenprice : 1,
        unitcost : 1,
        profitability : 1,
        doctorshare : 1,
        sequencenumber : 1,
        careprovider : 1,
        visitid : "$patientvisituid.visitid",
        ordercattype : "$ordercatuid.ordercattype",
        isdoctorshareitem : "orderitem.isdoctorshareitem"
      },
      
  },
  { $sort : { "orderitemcode" : 1}},
    ],
    { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err)
    });

    return data;
}