const mongoose = require("mongoose");
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/dateHelper");
exports.getPatientBills = async function (orguid, billdate, patientuid, visituid, sequencenumber = '') {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(visituid)
    initfilter.patientvisituid = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  if(sequencenumber)
    initfilter.sequencenumber = sequencenumber;

  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : initfilter
        },
        { $sort : { _id : -1}},
        { $limit : 50 },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "patientvisits.visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payors", localField: "payoruid", foreignField: "_id", as: "payors" } },
        { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payoragreements", localField: "payoragreementuid", foreignField: "_id", as: "payoragreements" } },
        { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" } },
        { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "cancelrefundbyuseruid", foreignField: "_id", as: "cancelrefundbyuser" } },
        { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                sequencenumber : "$sequencenumber",
                billdate : { $dateToString: { date : "$billdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                billdate_seaech : { $dateToString: { date : "$billdate", format : "%d/%m/%Y", timezone : "Asia/Bangkok" }},
                billdateforsort : "$billdate",
                canceldate : { $dateToString: { date : "$canceldate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                mrn : "$patients.mrn",
                visitid : "$patientvisits.visitid",
                visitstatus : "$visitstatus.valuedescription",
                totalbillamount : "$totalbillamount",
                payor : "$payors.name",
                payoragreements : "$payoragreements.name",
                user : "$user.name",
                userdepart : "$userdepart.name",
                cancelrefundbyuser : "$cancelrefundbyuser.name",
                isrefund : "$isrefund",
                iscancelled : "$iscancelled",
                isipdbill : "$isipdbill",
                isinterim : "$isinterim",
                isreceivable : "$isreceivable",
                interimfromdate : { $dateToString: { date : "$interimfromdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                interimtodate : { $dateToString: { date : "$interimtodate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedatforsort :  "$modifiedat",
                patientbilleditems : { $size: "$patientbilleditems" },
                paymentdetails : { $size: "$paymentdetails" }
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
      console.log(err)
    });

  return data;
};

exports.getPatientBillItems = async function (billuid, orguid) {
  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : { 
                  _id : mongoose.Types.ObjectId(billuid),
                  orguid : mongoose.Types.ObjectId(orguid),
                  statusflag : "A"
              }
        },
        { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
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
            tariffs : "$tariffs",
            patientorderuid : "$patientbilleditems.patientorderuid",
            patientorderitemuid : "$patientbilleditems.patientorderitemuid",
          },
          
      },
      { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" } },
      { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
      { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" } },
      { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "billinggroups", localField: "billingsubgroupuid", foreignField: "_id", as: "billingsubgroup" } },
      { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
      {
        $project : {
          sequencenumber : "$sequencenumber",
          chargedate : { $dateToString: { date : "$chargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          patientorderuid : 1,
          billinggroup : "$billinggroup.name",
          billingsubgroup : "$billingsubgroup.name",
          ordernumber : 1,
          orderitemcode : {
            $cond: { if: { $ne: ['$chargecodetype', "PATIENTPACKAGE"] }, then: '$orderitem.code', else: '$orderset.code' }
          },
          orderitemuid : 1,
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
          doctorshare : "$tariffs.doctorshare",
          patientorderitemuid : 1,
          isdoctorshareitem : "$orderitem.isdoctorshareitem"
        },
        
    },
    { $sort : { "billinggroup.displayorder" : -1}},
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

exports.getPatientBillItemsByHN = async function (patientuid, orguid) {
  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : { 
                  patientuid : mongoose.Types.ObjectId(patientuid),
                  orguid : mongoose.Types.ObjectId(orguid),
                  statusflag : "A"
              }
        },
        { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
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
            tariffs : "$tariffs",
            patientorderuid : "$patientbilleditems.patientorderuid",
            patientorderitemuid : "$patientbilleditems.patientorderitemuid",
          },
          
      },
      { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" } },
      { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "ordersets", localField: "orderitemuid", foreignField: "_id", as: "orderset" } },
      { $unwind: { path: "$orderset", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "billinggroups", localField: "billinggroupuid", foreignField: "_id", as: "billinggroup" } },
      { $unwind: { path: "$billinggroup", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "billinggroups", localField: "billingsubgroupuid", foreignField: "_id", as: "billingsubgroup" } },
      { $unwind: { path: "$billingsubgroup", preserveNullAndEmptyArrays: true } },
      {
        $project : {
          sequencenumber : "$sequencenumber",
          chargedate : { $dateToString: { date : "$chargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
          patientorderuid : 1,
          billinggroup : "$billinggroup.name",
          billingsubgroup : "$billingsubgroup.name",
          ordernumber : 1,
          orderitemcode : {
            $cond: { if: { $ne: ['$chargecodetype', "PATIENTPACKAGE"] }, then: '$orderitem.code', else: '$orderset.code' }
          },
          orderitemuid : 1,
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
          doctorshare : "$tariffs.doctorshare",
          patientorderitemuid : 1,
          isdoctorshareitem : "$orderitem.isdoctorshareitem"
        },
        
    },
    { $sort : { "sequencenumber" : -1}},
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

exports.getPatientBillPaymentsItems = async function (billuid, orguid) {
  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : { 
                  _id : mongoose.Types.ObjectId(billuid),
                  orguid : mongoose.Types.ObjectId(orguid),
                  statusflag : "A"
              }
        },
        { $unwind: { path: "$paymentdetails", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$paymentdetails.carddetails", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "paymentdetails.carddetails.cardtypeuid", foreignField: "_id", as: "cardtype" } },
        { $unwind: { path: "$cardtype", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "paymentdetails.carddetails.banknameuid", foreignField: "_id", as: "bankname" } },
        { $unwind: { path: "$bankname", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "paymentdetails.paymentmodeuid", foreignField: "_id", as: "paymentmode" } },
        { $unwind: { path: "$paymentmode", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "paymentdetails.currencyuid", foreignField: "_id", as: "currency" } },
        { $unwind: { path: "$currency", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "paymentdetails.cancelledbyuseruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project : {
            'sequencenumber' : "$paymentdetails.sequencenumber",
            "paiddate" : { $dateToString: { date : "$paymentdetails.paiddate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            "currencyuid" : "$currency.valuedescription",
            "paidamount" : "$paymentdetails.paidamount",
            "paymentmodeuid" : "$paymentmode.valuedescription",
            "amount" : "$paymentdetails.amount",
            "returnchange" : "$paymentdetails.returnchange",
            "iscancelled" : "$paymentdetails.iscancelled",
            "canceldate" : { $dateToString: { date : "$paymentdetails.canceldate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            "cancelledbyuseruid" : "$user.name",
            "isarsettlement" : "$paymentdetails.isarsettlement",
            "shouldnotbeused" : "$paymentdetails.shouldnotbeused",
            "cardtype" : "$cardtype.valuedescription",
            "bankname" : "$bankname.valuedescription",
            "carddetails" : "$paymentdetails.carddetails",
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
        console.log(err)
      });

      return data;
}

exports.getPatientBillDFPackageItems  = async function (billuid, orguid) {
  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : { 
                  _id : mongoose.Types.ObjectId(billuid),
                  orguid : mongoose.Types.ObjectId(orguid),
                  statusflag : "A"
              }
        },
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
    { $lookup: { from: "patientvisits", foreignField: "_id", localField: "patientvisituid", as: "patientvisituid" } },
    { $unwind: { path: '$patientvisituid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "referencevalues", foreignField: "_id", localField: "patientvisituid.entypeuid", as: "patientvisituid.entypeuid" } },
    { $unwind: { path: '$patientvisituid.entypeuid', preserveNullAndEmptyArrays: true } },
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
    { $lookup: { from: "patientvisits", foreignField: "_id", localField: "patientvisituid", as: "patientvisituid" } },
    { $unwind: { path: '$patientvisituid', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "referencevalues", foreignField: "_id", localField: "patientvisituid.entypeuid", as: "patientvisituid.entypeuid" } },
    { $unwind: { path: '$patientvisituid.entypeuid', preserveNullAndEmptyArrays: true } },
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

exports.getPatientBillDFItems = async function (billuid, orguid) {
  let data = await mongoose.connection.db
  .collection("patientbills")
  .aggregate(
    [
      {
             $match : { 
                _id : mongoose.Types.ObjectId(billuid),
                orguid : mongoose.Types.ObjectId(orguid),
                statusflag : "A"
            }
      },
      { $unwind: { path: "$patientbilleditems", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "tariffs", foreignField: "_id", localField: "patientbilleditems.tariffuid", as: "tariffs" } },
      { $unwind: { path: '$tariffs', preserveNullAndEmptyArrays: true } },
      {
        $project : {
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
          doctorshare : "$tariffs.doctorshare"
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
        doctorshare : 1
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


exports.getPatientBillData = async function (sequencenumber, orguid) {
  let data = await mongoose.connection.db
  .collection("patientbills")
  .aggregate(
    [
      {
             $match : { 
                sequencenumber : sequencenumber,
                orguid : mongoose.Types.ObjectId(orguid),
                statusflag : "A"
            }
      },
      { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patient" } },
      { $unwind: { path: "$patient", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisit" } },
      { $unwind: { path: "$patientvisit", preserveNullAndEmptyArrays: true } },
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

exports.getPatientBillsByPayors = async function (orguid, payoruid) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(payoruid)
    initfilter.payoruid;

  let data = await mongoose.connection.db
    .collection("patientbills")
    .aggregate(
      [
        {
               $match : initfilter
        },
        { $sort : { _id : -1}},
        { $limit : 50 },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "patientvisits.visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payors", localField: "payoruid", foreignField: "_id", as: "payors" } },
        { $unwind: { path: "$payors", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payoragreements", localField: "payoragreementuid", foreignField: "_id", as: "payoragreements" } },
        { $unwind: { path: "$payoragreements", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" } },
        { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "cancelrefundbyuseruid", foreignField: "_id", as: "cancelrefundbyuser" } },
        { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                sequencenumber : "$sequencenumber",
                billdate : { $dateToString: { date : "$billdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                billdate_seaech : { $dateToString: { date : "$billdate", format : "%d/%m/%Y", timezone : "Asia/Bangkok" }},
                billdateforsort : "$billdate",
                canceldate : { $dateToString: { date : "$canceldate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                mrn : "$patients.mrn",
                visitid : "$patientvisits.visitid",
                visitstatus : "$visitstatus.valuedescription",
                totalbillamount : "$totalbillamount",
                payor : "$payors.name",
                payoragreements : "$payoragreements.name",
                user : "$user.name",
                userdepart : "$userdepart.name",
                cancelrefundbyuser : "$cancelrefundbyuser.name",
                isrefund : "$isrefund",
                iscancelled : "$iscancelled",
                isipdbill : "$isipdbill",
                isinterim : "$isinterim",
                isreceivable : "$isreceivable",
                interimfromdate : { $dateToString: { date : "$interimfromdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                interimtodate : { $dateToString: { date : "$interimtodate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedatforsort :  "$modifiedat",
                patientbilleditems : { $size: "$patientbilleditems" }
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
      console.log(err)
    });

  return data;
};