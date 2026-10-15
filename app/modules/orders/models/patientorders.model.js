const mongoose = require("mongoose");
const paging = require('../../../core/http/paging');        // optional Previous / Next paging of the list pages

const TZ = "Asia/Bangkok";
const DATETIME_FORMAT = "%d/%m/%Y %H:%M";

function toObjectId(id) {
  return mongoose.Types.ObjectId(id);
}

function dateStr(field, format = DATETIME_FORMAT) {
  return { $dateToString: { date: field, format, timezone: TZ } };
}

function orDefault(field, fallback = "") {
  return { $ifNull: [field, fallback] };
}

// Single-document lookup + unwind, with a projection so only the fields the
// caller actually needs cross the wire (localField/foreignField still lets
// Mongo use an index on the joined collection).
function joinOne(from, localField, as, project, foreignField = "_id") {
  return [
    {
      $lookup: {
        from,
        localField,
        foreignField,
        as,
        pipeline: [{ $project: project }]
      }
    },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } }
  ];
}

// Collapses several _id-keyed lookups against the SAME collection into one
// $lookup instead of one $lookup per field (e.g. 4 separate hits on
// "referencevalues" become 1). A $lookup with an array-valued localField
// matches every element against foreignField using the foreign collection's
// index natively (supported since Mongo 3.6, no $expr needed), so this stays
// index-safe while cutting the per-stage overhead of running N sub-pipelines.
function joinManyById(from, fieldMap, project) {
  const aliases = Object.keys(fieldMap);
  const buffer = `__${from}`;
  return [
    { $addFields: { [buffer]: aliases.map((alias) => `$${fieldMap[alias]}`) } },
    { $lookup: { from, localField: buffer, foreignField: "_id", as: buffer, pipeline: [{ $project: project }] } },
    {
      $addFields: aliases.reduce((fields, alias) => {
        fields[alias] = {
          $arrayElemAt: [
            { $filter: { input: `$${buffer}`, as: "doc", cond: { $eq: ["$$doc._id", `$${fieldMap[alias]}`] } } },
            0
          ]
        };
        return fields;
      }, {})
    },
    // Plain exclusion $project instead of $unset for MongoDB < 4.2 compatibility
    // (this codebase connects to a different, independently-versioned Mongo per site).
    { $project: { [buffer]: 0 } }
  ];
}

function buildActiveOrdersFilter(orguid, { patientuid, visituid, ordercattype } = {}) {
  const filter = {
    orguid: toObjectId(orguid),
    statusflag: "A"
  };
  if (visituid) filter.patientvisituid = visituid;
  if (patientuid) filter.patientuid = patientuid;
  if (ordercattype) filter.ordercattype = ordercattype;
  return filter;
}

// A $lookup with localField/foreignField AND a pipeline needs MongoDB 5.0+; older servers
// reject the whole aggregation ("$lookup with 'pipeline' may not specify 'localField'...").
// Sites run different Mongo versions, so the server is asked once per connection.
let lookupSupport = { key: "", ok: null };
async function lookupPipelineSupported() {
  const conn = mongoose.connection;
  const key = `${conn.host}:${conn.port}/${conn.name}`;
  if (lookupSupport.key === key && lookupSupport.ok !== null) return lookupSupport.ok;
  let ok = false;
  try {
    const info = await conn.db.admin().serverInfo();
    ok = parseInt(String(info.version || "0").split(".")[0], 10) >= 5;
  } catch (err) {
    ok = false;   // unknown version: use the form every server accepts
  }
  lookupSupport = { key, ok };
  return ok;
}

// For MongoDB < 5.0: the same joins without the projection sub-pipeline (the final
// $project of each query still picks the fields, so the results are identical).
function withoutLookupPipelines(pipeline) {
  return pipeline.map((stage) => {
    const lk = stage.$lookup;
    if (!lk || !lk.localField || !lk.pipeline) return stage;
    const { pipeline: _dropped, ...plain } = lk;
    return { $lookup: plain };
  });
}

async function runAggregation(collection, pipeline) {
  try {
    const stages = (await lookupPipelineSupported()) ? pipeline : withoutLookupPipelines(pipeline);
    return await mongoose.connection.db
      .collection(collection)
      .aggregate(stages, { allowDiskUse: true })
      .toArray();
  } catch (err) {
    console.error(`Orders aggregation on ${collection} failed:`, err.message);
    return [];
  }
}

function resolveOrdersLimit({ visituid, patientuid, ordercattype }) {
  if (ordercattype) return (visituid || patientuid) ? 1000 : 100;
  if (visituid || patientuid) return 10000;
  return 50;
}

exports.getPatientOrders = async function (orguid, patientuid = "", visituid = "", ordercattype = "", page = null) {
  const filter = buildActiveOrdersFilter(orguid, { patientuid, visituid, ordercattype });
  const limit = resolveOrdersLimit({ visituid, patientuid, ordercattype });

  const pipeline = [
    { $match: filter },
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

    ...joinManyById("ordercategories", {
      ordercat: "patientorderitems.ordercatuid",
      ordersubcat: "patientorderitems.ordersubcatuid"
    }, { name: 1 }),
    ...joinOne("patientvisits", "patientvisituid", "patientvisits", { visitid: 1, startdate: 1, enddate: 1, visitstatusuid: 1 }),
    ...joinOne("patients", "patientuid", "patients", { mrn: 1 }),
    ...joinManyById("users", {
      cby: "createdby",
      mby: "modifiedby",
      careprovider: "patientorderitems.careprovideruid"
    }, { name: 1 }),
    ...joinManyById("departments", {
      ordertodepartment: "ordertodepartmentuid",
      orderdepartment: "orderdepartmentuid"
    }, { name: 1 }),
    ...joinOne("orderitems", "patientorderitems.orderitemuid", "orderitems", { code: 1, name: 1 }),
    ...joinOne("tariffs", "patientorderitems.tariffuid", "tariffs", { unitprice: 1 }),
    // Depends on patientvisits above for patientvisits.visitstatusuid.
    ...joinManyById("referencevalues", {
      status: "patientorderitems.statusuid",
      quantityUOM: "patientorderitems.quantityUOM",
      dosageUOM: "patientorderitems.dosageUOM",
      visitstatus: "patientvisits.visitstatusuid"
    }, { valuedescription: 1 }),

    {
      $project: {
        patientuid: 1,
        ordercattype: 1,
        createdat: dateStr("$createdat"),
        modifiedat: dateStr("$modifiedat"),
        ordernumber: 1,
        hn: "$patients.mrn",
        visitid: "$patientvisits.visitid",
        visitstatus: "$visitstatus.valuedescription",
        startdate: dateStr("$patientvisits.startdate"),
        enddate: dateStr("$patientvisits.enddate"),
        careprovider: "$careprovider.name",
        statusuid: "$status.valuedescription",
        orderdepartment: "$orderdepartment.name",
        ordertodepartment: "$ordertodepartment.name",
        orderdate: dateStr("$orderdate"),
        totalprice: orDefault("$patientorderitems.totalprice"),
        unitprice: orDefault("$patientorderitems.unitprice"),
        quantity: orDefault("$patientorderitems.quantity"),
        discount: orDefault("$patientorderitems.discount"),
        vatamount: orDefault("$patientorderitems.vatamount"),
        netamount: orDefault("$patientorderitems.netamount"),
        dosage: orDefault("$patientorderitems.dosage"),
        volume: orDefault("$patientorderitems.volume"),
        isactive: "$patientorderitems.isactive",
        ispom: "$patientorderitems.broughtfromoutside",
        iscontinuousorder: "$patientorderitems.iscontinuousorder",
        isipfillallowed: "$patientorderitems.isipfillallowed",
        orderitemname: "$orderitems.name",
        orderitemcode: "$orderitems.code",
        ordercatname: "$ordercat.name",
        ordersubcatname: "$ordersubcat.name",
        tariffunitprice: orDefault("$tariffs.unitprice"),
        payordiscount: orDefault("$payordiscount", 0),
        specialdiscount: orDefault("$specialdiscount", 0),
        createdby: "$cby.name",
        modifiedby: "$mby.name",
        quantityUOM: "$quantityUOM.valuedescription",
        dosageUOM: "$dosageUOM.valuedescription",
        quantityperdose: "$patientorderitems.quantityperdose",
        patientorderitemuid: "$patientorderitems._id",
        billintType: "$patientorderitems.billingtype"
      }
    },
    ...paging.stages(page, limit)
  ];

  return runAggregation("patientorders", pipeline);
};

function resolveOrdersByCateLimit({ visituid, patientuid }) {
  return (visituid || patientuid) ? 100000 : 50;
}

// paging (optional): { skip, limit } for the Lab Orders pages; without it as before (50, or every item of a patient / visit).
exports.getPatientOrdersByCate = async function (orguid, patientuid = "", visituid = "", ordercatetype, accessionnumber = "", paging = null) {
  const filter = buildActiveOrdersFilter(orguid, { patientuid, visituid, ordercattype: ordercatetype });
  const skip = paging ? Math.max(0, parseInt(paging.skip, 10) || 0) : 0;
  const limit = paging && paging.limit ? Math.min(1000, Math.max(1, parseInt(paging.limit, 10) || 50)) : resolveOrdersByCateLimit({ visituid, patientuid });

  const pipeline = [
    { $match: filter },
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

    // Filter by accessionnumber as early as possible: it only needs the
    // previous $project, so running it here (instead of after every lookup
    // and the final $limit, as before) avoids paying for a dozen joins on
    // documents that will be discarded, and stops the old bug where a
    // matching document past the `limit` cutoff was silently dropped.
    ...(accessionnumber ? [{ $match: { accessionnumber } }] : []),
    // Nothing below drops rows, so page and limit before the joins instead of joining every order first.
    ...(skip ? [{ $skip: skip }] : []),
    { $limit: limit },

    ...joinManyById("ordercategories", {
      ordercat: "ordercatuid",
      ordersubcat: "ordersubcatuid"
    }, { name: 1 }),
    ...joinOne("patientvisits", "patientvisituid", "patientvisits", { visitid: 1, visitstatusuid: 1 }),
    ...joinOne("patients", "patientuid", "patients", { mrn: 1 }),
    ...joinManyById("users", {
      careprovider: "careprovideruid",
      createdby: "createdby",
      modifiedby: "modifiedby"
    }, { name: 1 }),
    ...joinManyById("departments", {
      orderdepartment: "orderdepartmentuid",
      ordertodepartment: "ordertodepartmentuid"
    }, { name: 1 }),
    ...joinOne("labresults", "_id", "labresult", { specimencollecteddate: 1, specimenaccepteddate: 1, resultdate: 1, approvaldate: 1 }, "patientorderuid"),
    ...joinOne("orderitems", "orderitemuid", "orderitem", { code: 1, istaskgenerationreqd: 1, defaultmodalityuid: 1 }),

    ...joinOne("tariffs", "tariffuid", "tariff", { unitprice: 1 }),
    // Depends on patientvisits (visitstatusuid) and orderitem (defaultmodalityuid) above.
    ...joinManyById("referencevalues", {
      status: "statusuid",
      quantityUOM: "quantityUOM",
      modality: "orderitem.defaultmodalityuid",
      visitstatus: "patientvisits.visitstatusuid"
    }, { valuedescription: 1, valuecode: 1 }),

    {
      $project: {
        ordercattype: 1,
        startdate_search: dateStr("$startdate", "%d/%m/%Y"),
        orderdate: dateStr("$startdate", "%d-%m-%Y %H:%M"),
        startdate: dateStr("$startdate"),
        enddate: dateStr("$startdate"),
        createdat: dateStr("$createdat"),
        createdby: "$createdby.name",
        modifiedat: dateStr("$modifiedat"),
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
        specimencollecteddate: dateStr("$labresult.specimencollecteddate", "%d/%m/%Y %H:%M:%S"),
        specimenaccepteddate: dateStr("$labresult.specimenaccepteddate", "%d/%m/%Y %H:%M:%S"),
        resultdate: dateStr("$labresult.resultdate", "%d/%m/%Y %H:%M:%S"),
        approvaldate: dateStr("$labresult.approvaldate", "%d/%m/%Y %H:%M:%S"),
        orderitemcode: "$orderitem.code",
        isautogenerated: 1,
        quantity: 1,
        isexecute: "$orderitem.istaskgenerationreqd",
        unitprice: 1,
        totalprice: 1,
        payordiscount: orDefault("$payordiscount", 0),
        specialdiscount: orDefault("$specialdiscount", 0),
        quantityUOM: "$quantityUOM.valuedescription",
        ordercat: "$ordercat.name",
        ordersubcat: "$ordersubcat.name",
        isactive: 1,
        ispom: 1,
        iscontinuousorder: 1,
        isipfillallowed: 1,
        tariffunitprice: orDefault("$tariff.unitprice"),
        modalityCode: orDefault("$modality.valuecode")
      }
    }
  ];

  return runAggregation("patientorders", pipeline);
};

exports.getPharmacyOrders = async function (orguid, patientuid, itemcode, visituid, page = null) {
  const filter = buildActiveOrdersFilter(orguid, { patientuid, visituid });
  filter.ordercattype = "MEDICINE";
  const searchitem = itemcode ? { "item.code": itemcode } : {};

  const pipeline = [
    { $match: filter },
    { $sort: { orderdate: -1 } },
    { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
    ...joinOne("stockdispenses", "patientorderitems.stockdispenseuid", "stockdispense", { stockdispensenumber: 1 }),
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

    ...joinManyById("users", {
      user: "careprovideruid",
      createdby: "createdby",
      modifiedby: "modifiedby"
    }, { name: 1 }),

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

    ...joinOne("patients", "patientuid", "patient", { mrn: 1 }),
    ...joinOne("patientvisits", "patientvisituid", "patientvisits", { visitid: 1 }),
    ...joinManyById("referencevalues", {
      status: "statusuid",
      entype: "entypeuid"
    }, { valuedescription: 1 }),
    ...joinOne("orderitems", "orderitemuid", "item", { code: 1, name: 1 }),

    { $match: searchitem },

    ...joinOne("referencevalues", "quantityUOM", "quantityUOM", { valuedescription: 1 }),
    ...joinOne("wards", "warduid", "ward", { code: 1, name: 1 }),
    ...joinOne("beds", "beduid", "bed", { code: 1, name: 1 }),
    ...joinManyById("departments", {
      department: "orderdepartmentuid",
      todepartment: "ordertodepartmentuid"
    }, { code: 1, name: 1 }),

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
        orderdate: dateStr("$orderdate"),
        modifiedat: dateStr("$modifiedat"),
        modifiedby: 1,
        patientorderitemsuid: 1,
        stockdispensenumber: orDefault("$stockdispensenumber"),
        startdate: dateStr("$startdate"),
        enddate: dateStr("$enddate"),
        isactive: 1,
        iscontinuousorder: 1,
        isipfillallowed: 1,
        istaperingdose: 1,
        iscosigned: 1,
        iscosignrequired: 1
      }
    },
    ...paging.stages(page, 50)
  ];

  return runAggregation("patientorders", pipeline);
};

exports.getPatientOrdersitem = async function (orderuid, orderitemuid, orguid) {
  const pipeline = [
    { $match: { _id: toObjectId(orderuid), orguid: toObjectId(orguid) } },
    { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
    ...joinOne("referencevalues", "patientorderitems.statusuid", "status", { valuedescription: 1 }),
    ...joinManyById("ordercategories", {
      ordercat: "patientorderitems.ordercatuid",
      ordersubcat: "patientorderitems.ordersubcatuid"
    }, { name: 1 }),
    { $match: { "patientorderitems._id": toObjectId(orderitemuid) } },
    {
      $project: {
        status: orDefault("$status.valuedescription"),
        iscontinuousorder: orDefault("$patientorderitems.iscontinuousorder"),
        startdate: dateStr("$patientorderitems.startdate"),
        enddate: dateStr("$patientorderitems.enddate"),
        quantity: "$patientorderitems.quantity",
        unitprice: "$patientorderitems.unitprice",
        totalprice: "$patientorderitems.totalprice",
        ordercat: "$ordercat.name",
        ordersubcat: "$ordersubcat.name",
        ordernumber: "$ordernumber"
      }
    }
  ];

  return runAggregation("patientorders", pipeline);
};

/**
 * Retrieves medications administration orders for a patient based on various filters.
 *
 * @param {string} orguid - The organization unique identifier (ObjectId).
 * @param {string} [patientuid] - The patient unique identifier (ObjectId) (optional).
 * @param {string} [visituid] - The patient visit unique identifier (ObjectId) (optional).
 * @param {string} [itemcode] - The item code for the order (optional).
 * @param {string} [ordernumber] - The order number for the patient order (optional).
 *
 * @returns {Promise<Array>} - A promise that resolves to an array of medication administration orders.
 */
exports.getMedsadminOrders = async function (orguid, patientuid, visituid, itemcode, ordernumber, page = null) {
  const initfilter = buildActiveOrdersFilter(orguid, { patientuid, visituid });
  const searchitem = {};
  if (itemcode) searchitem["orderitem.code"] = itemcode;
  if (ordernumber) searchitem["patientorder.ordernumber"] = ordernumber;

  const pipeline = [
    { $match: initfilter },
    { $sort: { _id: -1 } },
    ...joinOne("patientorders", "patientorderuid", "patientorder", { ordernumber: 1, orderdate: 1, ordertypeuid: 1, patientorderitems: 1 }),
    ...joinOne("patients", "patientuid", "patient", { mrn: 1 }),
    ...joinOne("patientvisits", "patientvisituid", "patientvisit", { visitid: 1 }),
    ...joinOne("orderitems", "orderitemuid", "orderitem", { code: 1, name: 1 }),

    { $match: searchitem },

    // patientorder.patientorderitems is an array (an order can hold many
    // items); narrow it once to the specific item this medsadmin record
    // belongs to, then join off that scalar instead of the whole array.
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

    ...joinOne("frequencies", "matchedOrderItem.frequencyuid", "frequency", { name: 1 }),
    ...joinManyById("referencevalues", {
      quantityUOM: "matchedOrderItem.quantityUOM",
      dosageUOM: "dosageUOM",
      orderstatus: "matchedOrderItem.statusuid",
      ordertype: "patientorder.ordertypeuid",
      medsadminstatus: "statusuid"
    }, { valuedescription: 1 }),
    ...joinOne("users", "modifiedby", "modifiedby", { name: 1 }),
    ...joinOne("drugmasters", "drugmasteruid", "drugmaster", { volume: 1, dosagenotapplicable: 1 }),

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
        admindate: dateStr("$admindate"),
        orderdate: dateStr("$patientorder.orderdate"),
        adminqty: "$adminqty",
        dosage: "$dosage",
        dosageUOM: "$dosageUOM.valuedescription",
        quantityUOM: "$quantityUOM.valuedescription",
        dosagedate: dateStr("$dosagedate", "%d/%m/%Y"),
        dosagetime: dateStr("$dosagedate", "%H:%M"),
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
        modifiedat: dateStr("$modifiedat")
      }
    }
  ];

  // Paged: every visit is paged too; else as before (200, every row of a visit).
  pipeline.push(...paging.stages(page, visituid ? 0 : 200));

  return runAggregation("medsadmins", pipeline);
};

exports.countPatientOrdersitem = async function (patientuid, patientvisituid) {
  const pipeline = [
    { $match: { statusflag: "A", patientuid, patientvisituid } },
    {
      $project: {
        size: { $size: { $ifNull: ["$patientorderitems", []] } }
      }
    },
    { $group: { _id: null, totalPatientOrderItems: { $sum: "$size" } } },
    { $project: { _id: 0, totalPatientOrderItems: 1 } }
  ];

  const data = await runAggregation("patientorders", pipeline);
  return data.length > 0 ? data[0].totalPatientOrderItems : 0;
};

// Batches order-detail enrichment for a list of billing/unbilling items into
// a single aggregation instead of one query per item (previously N+1 queries
// via getPatientOrdersitem), which is the dominant cost for large invoices.
exports.enrichItemsWithOrderDetails = async function (items, orgId) {
  if (!items.length) return items;

  const orderUids = [...new Set(items.map((item) => String(item.patientorderuid)))].map(toObjectId);

  const pipeline = [
    { $match: { _id: { $in: orderUids }, orguid: toObjectId(orgId) } },
    { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
    ...joinOne("referencevalues", "patientorderitems.statusuid", "status", { valuedescription: 1 }),
    ...joinManyById("ordercategories", {
      ordercat: "patientorderitems.ordercatuid",
      ordersubcat: "patientorderitems.ordersubcatuid"
    }, { name: 1 }),
    {
      $project: {
        _id: 0,
        patientorderitemuid: "$patientorderitems._id",
        status: orDefault("$status.valuedescription"),
        iscontinuousorder: orDefault("$patientorderitems.iscontinuousorder"),
        startdate: dateStr("$patientorderitems.startdate"),
        enddate: dateStr("$patientorderitems.enddate"),
        quantity: "$patientorderitems.quantity",
        unitprice: "$patientorderitems.unitprice",
        totalprice: "$patientorderitems.totalprice",
        ordercat: "$ordercat.name",
        ordersubcat: "$ordersubcat.name"
      }
    }
  ];

  const details = await runAggregation("patientorders", pipeline);
  const detailsByItemUid = new Map(details.map((d) => [String(d.patientorderitemuid), d]));

  return items.map(function (item) {
    const detail = detailsByItemUid.get(String(item.patientorderitemuid));
    return Object.assign(item, {
      startdate: detail ? detail.startdate : "",
      enddate: detail ? detail.enddate : "",
      odquantity: detail ? detail.quantity : "",
      odunitprice: detail ? (detail.unitprice || "") : "",
      oddertotalprice: detail ? (detail.totalprice || "") : "",
      iscontinuousorder: detail ? detail.iscontinuousorder : "",
      ordercat: detail ? detail.ordercat : "",
      ordersubcat: detail ? detail.ordersubcat : "",
      orderitemstatus: detail ? detail.status : ""
    });
  });
};
