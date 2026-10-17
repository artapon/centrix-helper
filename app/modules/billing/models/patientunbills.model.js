const mongoose = require("mongoose");
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/date.helper");
exports.getPatientUnBills = async function (orguid, patientuid, visituid, page = 0) {
  let perpage = 50;
  let initfilter = {};
  if(visituid)
    initfilter.patientvisituid = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';

  let data = await mongoose.connection.db
    .collection("patientchargecodes")
    .aggregate(
      [
        {
               $match : initfilter
        },
        { $sort : { "_id" : -1}},
        {
          $project: {
            'patientuid' : "$patientuid",
            'patientvisituid' : "$patientvisituid",
            'createdby' : "$createdby",
            'modifiedby' : "$modifiedby",
            'allocationinitialized' : "$allocationinitialized",
            'chargecodessize' : { $size: "$chargecodes" },
          }
        },
        {
          $match : {
              'chargecodessize' : {$gt : 0}
          }
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        {
          $match : {
              'patientvisits.entypeuid' : {$eq : mongoose.Types.ObjectId('59ef351fd2bbe66c36f99862')}
          }
        },
        { $lookup: { from: "referencevalues", localField: "patientvisits.visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                mrn : "$patients.mrn",
                visitid : "$patientvisits.visitid",
                startdate : { $dateToString: { date : "$patientvisits.startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                visitstatus : "$visitstatus.valuedescription",
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedatforsort :  "$modifiedat",
                createdatforsort :  "$createdat",
                visitdateforsort :  "$patientvisits.startdate",
                chargecodes : "$chargecodessize",
                allocationinitialized : "$allocationinitialized",
                patientuid : 1,
                patientvisituid : 1
            }
        },
        { "$skip": page * perpage },
        { "$limit": perpage },
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

// Charge code items, loaded in pages (see unbilling.controller patientBillsItems / unbillItemsRows).
// Items are numbered by document and position in its chargecodes array, so pages are stable;
// skip/limit run before the lookups, so each page only joins its own rows.
const ITEM_DETAIL_STAGES = [
  {
    $project : {
      _id : "$chargecodes._id",
      orderitemname : "$chargecodes.orderitemname",
      orderitemuid : "$chargecodes.orderitemuid",
      tariffuid : "$chargecodes.tariffuid",
      billinggroupuid : "$chargecodes.billinggroupuid",
      billingsubgroupuid : "$chargecodes.billingsubgroupuid",
      chargecodetype : "$chargecodes.chargecodetype",
      ordernumber : "$chargecodes.ordernumber",
      patientorderuid : "$chargecodes.patientorderuid",
      patientorderitemuid : "$chargecodes.patientorderitemuid",
      quantity : "$chargecodes.quantity",
      orgquantity : "$chargecodes.orgquantity",
      unitprice : "$chargecodes.unitprice",
      payordiscount : "$chargecodes.payordiscount",
      specialdiscount : "$chargecodes.specialdiscount",
      netamount : "$chargecodes.netamount",
      overriddenprice : "$chargecodes.overriddenprice",
      visitpayoruid : "$chargecodes.visitpayoruid",
      departmentuid : "$chargecodes.departmentuid",
      careprovideruid : "$chargecodes.careprovideruid",
      chargedate : { $dateToString: { date : "$chargecodes.chargedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
      issplit : "$chargecodes.issplit",
      ordertodepartmentuid : "$chargecodes.ordertodepartmentuid",
      allocatedpayoruid : "$chargecodes.allocatedpayoruid",
      allocatedagreementuid : "$chargecodes.allocatedagreementuid",
      unitcost : "$chargecodes.unitcost",
      taxamount : "$chargecodes.taxamount",
      chargedateforsort : "$chargecodes.chargedate",
      itemstatusflag : "$chargecodes.statusflag",
      isbilled : "$chargecodes.isbilled",
      patientbilluid : "$chargecodes.patientbilluid",
      createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
      modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
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
  { $lookup: { from: "patientorders", localField: "patientorderuid", foreignField: "_id", as: "patientorder" } },
  { $unwind: { path: "$patientorder", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "payors", localField: "visitpayoruid", foreignField: "_id", as: "visitpayor" } },
  { $unwind: { path: "$visitpayor", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "payors", localField: "allocatedpayoruid", foreignField: "_id", as: "alocatepayor" } },
  { $unwind: { path: "$alocatepayor", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "patientbills", localField: "patientbilluid", foreignField: "_id", as: "patientbill" } },
  { $unwind: { path: "$patientbill", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "tariffs", localField: "tariffuid", foreignField: "_id", as: "tariff" } },
  { $unwind: { path: "$tariff", preserveNullAndEmptyArrays: true } },
  {
    $project : {
      _id : 1,
      patientorderuid : 1,
      patientorderitemuid : 1,
      ordercreateat :  { $dateToString: { date : "$patientorder.createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
      ordermodifiedat :  { $dateToString: { date : "$patientorder.modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
      orderdate :  { $dateToString: { date : "$patientorder.orderdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
      orderstatusflag :  "$patientorder.statusflag",
      chargedate : 1,
      billinggroup : "$billinggroup.name",
      billingsubgroup : "$billingsubgroup.name",
      ordernumber : 1,
      orderitemcode : {
        $cond: { if: { $ne: ['$chargecodetype', "PATIENTPACKAGE"] }, then: '$orderitem.code', else: '$orderset.code' }
      },
      orderitemname : 1,
      chargecodetype : 1,
      quantity : 1,
      orgquantity : 1,
      unitprice : { $ifNull: ["$unitprice", '']},
      tariffunitprice : { $ifNull: ["$tariff.unitprice" , ''] },
      payordiscount : 1,
      specialdiscount : 1,
      netamount : 1,
      visitpayor : "$visitpayor.name",
      alocatepayor : "$alocatepayor.name",
      overriddenprice : 1,
      issplit : 1,
      isbilled : 1,
      billednumber : "$patientbill.sequencenumber",
      unitcost: 1,
      taxamount : 1,
      itemstatusflag : 1,
      createdat : 1,
      modifiedat : 1
    },
  },
];

async function aggregateItems(match, offset, limit) {
  const page = [{ $skip: Math.max(0, Number(offset) || 0) }];
  if (limit) page.push({ $limit: Number(limit) });
  return mongoose.connection.db
    .collection("patientchargecodes")
    .aggregate(
      [
        { $match: match },
        { $unwind: { path: "$chargecodes", includeArrayIndex: "chargecodeindex", preserveNullAndEmptyArrays: true } },
        { $sort: { _id: 1, chargecodeindex: 1 } },
        ...page,
        ...ITEM_DETAIL_STAGES,
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .catch(function (err) {
      console.log(err);
      return [];
    });
}

const itemsOfChargecode = (chargecodeuid, orguid) => ({
  _id : mongoose.Types.ObjectId(chargecodeuid),
  orguid : mongoose.Types.ObjectId(orguid),
  statusflag : 'A'
});

const itemsOfPatient = (patientuid, orguid) => ({
  patientuid : mongoose.Types.ObjectId(patientuid),
  orguid : mongoose.Types.ObjectId(orguid),
  statusflag : 'A'
});

// offset/limit are optional; without a limit every item is returned.
exports.getPatientUnBillItems = function (chargecodeuid, orguid, offset = 0, limit = 0) {
  return aggregateItems(itemsOfChargecode(chargecodeuid, orguid), offset, limit);
}

exports.getPatientUnBillItemsByHN = function (patientuid, orguid, offset = 0, limit = 0) {
  return aggregateItems(itemsOfPatient(patientuid, orguid), offset, limit);
}

/**
 * Item count and net amount per item status flag, over all items (no lookups):
 * { total, flags: { A: { count, netamount }, D: { ... } } }
 */
async function summariseItems(match) {
  const rows = await mongoose.connection.db
    .collection("patientchargecodes")
    .aggregate(
      [
        { $match: match },
        { $unwind: { path: "$chargecodes", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$chargecodes.statusflag", ""] },
            count: { $sum: 1 },
            netamount: { $sum: { $convert: { input: "$chargecodes.netamount", to: "double", onError: 0, onNull: 0 } } }
          }
        }
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .catch(function (err) {
      console.log(err);
      return [];
    });
  const flags = {};
  let total = 0;
  rows.forEach((row) => {
    flags[row._id] = { count: row.count, netamount: row.netamount };
    total += row.count;
  });
  return { total, flags };
}

exports.getPatientUnBillItemsSummary = (chargecodeuid, orguid) => summariseItems(itemsOfChargecode(chargecodeuid, orguid));
exports.getPatientUnBillItemsSummaryByHN = (patientuid, orguid) => summariseItems(itemsOfPatient(patientuid, orguid));

exports.getPatientUnBillData = async function (unbilluid, orguid) {
  let data = await mongoose.connection.db
    .collection("patientchargecodes")
    .aggregate(
      [
        {
               $match : { 
                  _id : mongoose.Types.ObjectId(unbilluid),
                  orguid : mongoose.Types.ObjectId(orguid),
                  statusflag : "A"
              }
        },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "patientvisits.visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                mrn : "$patients.mrn",
                visitid : "$patientvisits.visitid",
                startdate : { $dateToString: { date : "$patientvisits.startdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                visitstatus : "$visitstatus.valuedescription",
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedatforsort :  "$modifiedat",
                chargecodes : { $size: "$chargecodes" },
                allocationinitialized : "$allocationinitialized"
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
};

/**
 * Batch version of isPatientOrderInChargeCodes for a list of orders: one query instead of
 * one per order. Returns a Set of "patientuid|patientorderitemuid" keys that have charge codes.
 */
exports.getOrderItemsInChargeCodes = async function (orguid, orders) {
  const toId = (value) => mongoose.Types.ObjectId(String(value));
  const withItems = orders.filter((o) => o.patientuid && o.patientorderitemuid);
  const found = new Set();
  if (!withItems.length) return found;

  const patientuids = [...new Set(withItems.map((o) => String(o.patientuid)))].map(toId);
  const itemuids = [...new Set(withItems.map((o) => String(o.patientorderitemuid)))].map(toId);
  try {
    const docs = await mongoose.connection.db
      .collection("patientchargecodes")
      .find(
        {
          orguid: toId(orguid),
          patientuid: { $in: patientuids },
          "chargecodes.patientorderitemuid": { $in: itemuids }
        },
        { projection: { patientuid: 1, "chargecodes.patientorderitemuid": 1 } }
      )
      .toArray();
    docs.forEach((doc) => (doc.chargecodes || []).forEach((cc) => {
      if (cc.patientorderitemuid) found.add(`${doc.patientuid}|${cc.patientorderitemuid}`);
    }));
  } catch (err) {
    console.error("Error checking unbilled data:", err);
  }
  return found;
}

exports.isPatientOrderInChargeCodes = async function (patientuid ,orguid, patientorderitemuid) {
   try {
    const result = await mongoose.connection.db
      .collection("patientchargecodes")
      .findOne({
        orguid: mongoose.Types.ObjectId(orguid),
        patientuid : mongoose.Types.ObjectId(patientuid),
        "chargecodes.patientorderitemuid": mongoose.Types.ObjectId(patientorderitemuid)
      });

    // ✅ Return true if found, false otherwise
    return result ? true : false;
  } catch (err) {
    console.error("Error checking unbilled data:", err);
    return false;
  }
}