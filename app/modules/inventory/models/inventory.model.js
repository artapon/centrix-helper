const mongoose = require("mongoose");
const paging = require('../../../core/http/paging');
// Dates MongoDB can turn into text: years 0-9999 (a day off each end, for the time zone).
const VALID_FROM = new Date(Date.UTC(0, 0, 2)), VALID_TO = new Date(Date.UTC(9999, 11, 31));
VALID_FROM.setUTCFullYear(0);

// Search text matched literally inside a $regex (a "(" or "*" typed in a box would break or slow the search).
const escRe = (v) => String(v == null ? '' : v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Inventory tracking in batches, to keep the database work small:
//   1. the cheap start of the pipeline (date / item filters, the ledger rows, their transaction type) runs once as a
//      cursor and yields only { _id, lid } of each matching ledger row, in the pipeline's own order;
//   2. the joins (~80 lookups, then the HN / order / reference filters) run on a batch of those rows at a time;
//   3. it stops as soon as there are enough rows for the page and one more (to know whether there is a next page).
// The rows and their fields are the same as running the whole pipeline at once; only far fewer rows are joined.
const TRACKING_TIME_MS = 120000;
async function trackingInBatches(pipeline, typeFilter, page, perpage) {
    const split = pipeline.findIndex((st) => st.$match === typeFilter);      // the early type filter ends the cheap part
    if (split < 0) throw new Error('Inventory tracking: the type filter stage was not found');
    const cheap = pipeline.slice(0, split + 1), joins = pipeline.slice(split + 1);
    const coll = mongoose.connection.db.collection("stockledgers");
    const opts = { allowDiskUse: true, maxTimeMS: TRACKING_TIME_MS };
    const deadline = Date.now() + TRACKING_TIME_MS;
    const want = (page + 1) * perpage + 1;
    const key = (id, lid) => String(id) + '|' + String(lid);
    const found = coll.aggregate(cheap.concat([{ $project: { _id: 1, lid: "$ledgerdetails._id" } }]), opts);
    const out = [];
    let size = Math.max(20, Math.ceil(want * 1.5));         // a few more than needed: the last filters may drop some
    try {
        while (out.length < want) {
            const batch = [];
            while (batch.length < size && await found.hasNext()) batch.push(await found.next());
            if (!batch.length) break;
            if (Date.now() > deadline) throw Object.assign(new Error('operation exceeded time limit'), { codeName: 'MaxTimeMSExpired' });
            const docs = new Map(batch.map((b) => [String(b._id), b._id]));
            const lids = batch.map((b) => b.lid);
            const rows = await coll.aggregate([
                { $match: { _id: { $in: [...docs.values()] } } },
                { $addFields: { ledgerdetails: { $filter: { input: "$ledgerdetails", as: "l", cond: { $in: ["$$l._id", lids] } } } } },
                { $unwind: "$ledgerdetails" }
            ].concat(joins), Object.assign({}, opts, { maxTimeMS: Math.max(1000, deadline - Date.now()) })).toArray();
            // Back in the order the cheap part found them (the join query reads by _id).
            const at = new Map(batch.map((b, i) => [key(b._id, b.lid), i]));
            const pos = (r) => { const i = at.get(key(r._id, r.ledgerdetails && r.ledgerdetails._id)); return i === undefined ? batch.length : i; };
            rows.sort((a, b) => pos(a) - pos(b));
            out.push(...rows);
            size = Math.min(size * 2, 500);                  // the filters dropped rows: take bigger batches
        }
    } catch (err) {
        console.error('Inventory tracking:', err && err.message ? err.message : err);
        throw err;                                           // the page says why it is empty
    } finally {
        await found.close().catch(() => {});
    }
    return out.slice(page * perpage, page * perpage + perpage + 1);
}        // optional Previous / Next paging of the list pages
exports.getItemMasterUID = async function (code) {
    let itemmaster = await mongoose.connection.db
    .collection("itemmasters")
    .aggregate(
        [
            {
                $match: {
                    statusflag: 'A',
                    code: {$eq : code}
                }
            },
        ]
    ).toArray()
    .then(function (res) {
        return res;
    })
    .catch(function (err) {
        console.log(err);
    });

    return itemmaster;
}

exports.getInventoryData = async function (orguid, page = 0, selectedDateFormat, selectedDateFormat2, transactiontype = 'INVENTORIES.GOODSRECEIVE', orderno = "", refno = "", itemuid = "", mrn = "") {
    let transactiontypefilter = {};
    let transactionfilter = {};
    let initfilter = {};
    let perpage = 10;
    let morefilter = null;
    
    if(refno != "") {
        morefilter = {referencedispense : { $regex: '.*' + escRe(refno) + '.*' }};
    }

    let datestart = new Date(selectedDateFormat); // "2020-08-01"
    datestart.setHours(datestart.getHours() - 7);  // "31-07-2020 17:00:00.000Z"
  
    let dateto = new Date(selectedDateFormat2); // "2020-08-31"
    dateto.setHours(dateto.getHours() - 7); // "30-08-2020 17:00:00.000Z"
    dateto.setMilliseconds(dateto.getMilliseconds() - 1);
    dateto.setDate(dateto.getDate() + 1);

    initfilter.orguid = mongoose.Types.ObjectId(orguid);
    initfilter.statusflag = 'A';
    
    if(itemuid) {
        initfilter.itemmasteruid = itemuid;
    } else {
        initfilter.ledgerdetails = { $elemMatch: { transactiondate: { $gte: datestart, $lte: dateto } } };

        transactionfilter = {
            $and: [
                { $gte: ["$$transactiondata.transactiondate", datestart] },
                { $lte: ["$$transactiondata.transactiondate", dateto] }
            ]
        }

        perpage = 10;
    }

    // One type, or several ("all types"): a list has to be matched with $in (matching the list itself finds nothing).
    if(transactiontype && transactiontype.length) {
        transactiontypefilter = {
                "ledgerdetails.transactiontype"  : Array.isArray(transactiontype) ? { $in : transactiontype } : transactiontype
                }
        }

    // The whole pipeline as it was; trackingInBatches() runs its cheap start once and its joins on a few rows at a time.
    const pipeline = [
            {
                $match: initfilter
            },
            {
                $addFields: {
                    ledgerdetails: {
                        $filter: {
                            input: "$ledgerdetails",
                            as: "transactiondata",
                            cond: transactionfilter
                        }
                    }
                }
            },
            {
                $addFields: {
                    ledgerdetailssize: { $size: "$ledgerdetails" }
                }
            },
            {
                $match: {
                    ledgerdetailssize: { $gt: 0 }
                }
            },
            { $unwind: { path: '$ledgerdetails', preserveNullAndEmptyArrays: true } },
            // The transaction type is the ledger row's own field: keep only those rows before joining anything to them.
            { $match : transactiontypefilter },
            { $lookup: { from: "organisations", foreignField: "_id", localField: "orguid", as: "orguid" } },
            { $unwind: { path: '$orguid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "itemmasters", foreignField: "_id", localField: "itemmasteruid", as: "itemmasteruid" } },
            { $unwind: { path: '$itemmasteruid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "itemmasteruid.itemtypeuid", as: "itemmasteruid.itemtypeuid" } },
            { $unwind: { path: '$itemmasteruid.itemtypeuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "ledgerdetails.quantityuom", as: "ledgerdetails.quantityuom" } },
            { $unwind: { path: '$ledgerdetails.quantityuom', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "storeuid", as: "storeuid" } },
            { $unwind: { path: '$storeuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "storeuid.departmentuid", as: "storeuid.departmentuid" } },
            { $unwind: { path: '$storeuid.departmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "storeuid.departmentuid.parentdeptuid", as: "storeuid.departmentuid.parentdeptuid" } },
            { $unwind: { path: '$storeuid.departmentuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "storeuid.departmentuid.parentdeptuid.parentdeptuid", as: "storeuid.departmentuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$storeuid.departmentuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.GOODSRECEIVE -----------//
            { $lookup: { from: 'goodsreceives', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'goodsreceivetransactionrefuid' } },
            { $unwind: { path: '$goodsreceivetransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "goodsreceivetransactionrefuid.grntypeuid", as: "goodsreceivetransactionrefuid.grntypeuid" } },
            { $unwind: { path: '$goodsreceivetransactionrefuid.grntypeuid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.GOODSRECEIVE -----------//

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.TRANSFEROUT, INVENTORIES.TRANSFERIN, INVENTORIES.STOCKISSUE  -----------//
            { $lookup: { from: 'stocktransfers', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'transferintransactionrefuid' } },
            { $unwind: { path: '$transferintransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "transferintransactionrefuid.todeptuid", as: "transferintransactionrefuid.todeptuid" } },
            { $unwind: { path: '$transferintransactionrefuid.todeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "transferintransactionrefuid.todeptuid.parentdeptuid", as: "transferintransactionrefuid.todeptuid.parentdeptuid" } },
            { $unwind: { path: '$transferintransactionrefuid.todeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "transferintransactionrefuid.fromstoreuid", as: "transferintransactionrefuid.fromstoreuid" } },
            { $unwind: { path: '$transferintransactionrefuid.fromstoreuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "transferintransactionrefuid.tostoreuid", as: "transferintransactionrefuid.tostoreuid" } },
            { $unwind: { path: '$transferintransactionrefuid.tostoreuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "transferintransactionrefuid.issuetypeuid", as: "transferintransactionrefuid.issuetypeuid" } },
            { $unwind: { path: '$transferintransactionrefuid.issuetypeuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "vendors", foreignField: "_id", localField: "transferintransactionrefuid.vendoruid", as: "transferintransactionrefuid.vendoruid" } },
            { $unwind: { path: '$transferintransactionrefuid.vendoruid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.TRANSFEROUT, INVENTORIES.TRANSFERIN, INVENTORIES.STOCKISSUE  -----------//

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.CANCELTRANSFER ---------------------------------//
            { $lookup: { from: 'stocktransfers', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'canceltransfertransactionrefuid' } },
            { $unwind: { path: '$canceltransfertransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "canceltransfertransactionrefuid.fromstoreuid", as: "canceltransfertransactionrefuid.fromstoreuid" } },
            { $unwind: { path: '$canceltransfertransactionrefuid.fromstoreuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "canceltransfertransactionrefuid.tostoreuid", as: "canceltransfertransactionrefuid.tostoreuid" } },
            { $unwind: { path: '$canceltransfertransactionrefuid.tostoreuid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.CANCELTRANSFER ---------------------------------//

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKDISPENSE ---------------------------------//
            { $lookup: { from: 'stockdispenses', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'stockdispensetransactionrefuid' } },
            { $unwind: { path: '$stockdispensetransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientvisituid", as: "stockdispensetransactionrefuid.patientvisituid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientvisituid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientuid", as: "stockdispensetransactionrefuid.patientuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientorders", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid", as: "stockdispensetransactionrefuid.patientorderuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid", as: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid", as: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid", as: "stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.ordertodepartmentuid", as: "stockdispensetransactionrefuid.patientorderuid.ordertodepartmentuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.ordertodepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "wards", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.warduid", as: "stockdispensetransactionrefuid.patientorderuid.warduid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.warduid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "locations", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid", as: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid", as: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid", as: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid", as: "stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$stockdispensetransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKDISPENSE -----------//

            //------ สำหรับ กรณี Transaction Type เป็น PHARMACYMASTER.IPFILL -----------//
            { $lookup: { from: 'stockdispenses', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'ipfilltransactionrefuid' } },
            { $unwind: { path: '$ipfilltransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", foreignField: "_id", localField: "ipfilltransactionrefuid.patientvisituid", as: "ipfilltransactionrefuid.patientvisituid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientvisituid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", foreignField: "_id", localField: "ipfilltransactionrefuid.patientuid", as: "ipfilltransactionrefuid.patientuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientorders", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid", as: "ipfilltransactionrefuid.patientorderuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "wards", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.warduid", as: "ipfilltransactionrefuid.patientorderuid.warduid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.warduid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "locations", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid", as: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid", as: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid", as: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid", as: "ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.warduid.nursingstnuid.owningdeptuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.ordertodepartmentuid", as: "ipfilltransactionrefuid.patientorderuid.ordertodepartmentuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.ordertodepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid", as: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.orderdepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid", as: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid", as: "ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$ipfilltransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น PHARMACYMASTER.IPFILL -----------//

            //------ สำหรับ กรณี Transaction Type เป็น PHARMACYMASTER.CANCELDISPENSE -----------//
            { $lookup: { from: 'stockdispenses', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'canceldispensetransactionrefuid' } },
            { $unwind: { path: '$canceldispensetransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientvisituid", as: "canceldispensetransactionrefuid.patientvisituid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientvisituid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientuid", as: "canceldispensetransactionrefuid.patientuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientorders", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientorderuid", as: "canceldispensetransactionrefuid.patientorderuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientorderuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid", as: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid", as: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid", as: "canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "canceldispensetransactionrefuid.patientorderuid.ordertodepartmentuid", as: "canceldispensetransactionrefuid.patientorderuid.ordertodepartmentuid" } },
            { $unwind: { path: '$canceldispensetransactionrefuid.patientorderuid.ordertodepartmentuid', preserveNullAndEmptyArrays: true } },
            //------ End กรณี Transaction Type เป็น PHARMACYMASTER.CANCELDISPENSE -----------//

            //------ กรณี Transaction Type เป็น COMMON.DISPENSERETURN ------------------------------------//
            { $lookup: { from: 'dispensereturns', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'dispensereturntransactionrefuid' } },
            { $unwind: { path: '$dispensereturntransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientvisituid", as: "dispensereturntransactionrefuid.patientvisituid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientvisituid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patients", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientuid", as: "dispensereturntransactionrefuid.patientuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientorders", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientorderuid", as: "dispensereturntransactionrefuid.patientorderuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientorderuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid", as: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid", as: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid", as: "dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientorderuid.orderdepartmentuid.parentdeptuid.parentdeptuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "departments", foreignField: "_id", localField: "dispensereturntransactionrefuid.patientorderuid.ordertodepartmentuid", as: "dispensereturntransactionrefuid.patientorderuid.ordertodepartmentuid" } },
            { $unwind: { path: '$dispensereturntransactionrefuid.patientorderuid.ordertodepartmentuid', preserveNullAndEmptyArrays: true } },
            //------ End กรณี Transaction Type เป็น COMMON.DISPENSERETURN ------------------------------------//
            
            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.VENDORRETURN ----------------------------------------------------------//
            { $lookup: { from: 'vendorreturns', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'vendorreturntransactionrefuid' } },
            { $unwind: { path: '$vendorreturntransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "vendorreturntransactionrefuid.returntypeuid", as: "vendorreturntransactionrefuid.returntypeuid" } },
            { $unwind: { path: '$vendorreturntransactionrefuid.returntypeuid', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.VENDORRETURN ----------------------------------------------------------//

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKADJUST ----------------------------------------------------------//
            { $lookup: { from: 'stockadjusts', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'stockadjusttransactionrefuid' } },
            { $unwind: { path: '$stockadjusttransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "stockadjusttransactionrefuid.adjusttype", as: "stockadjusttransactionrefuid.adjusttype" } },
            { $unwind: { path: '$stockadjusttransactionrefuid.adjusttype', preserveNullAndEmptyArrays: true } },
            //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKADJUST ----------------------------------------------------------//

            //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.MANUFACTURING, INVENTORIES.REPACKING, INVENTORIES.MANUFACUTINGREPACKING ----------------------------------------------------------//
            { $lookup: { from: 'manufacturedetails', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'manufacturedetailstransactionrefuid' } },
            { $unwind: { path: '$manufacturedetailstransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "itemmasters", foreignField: "_id", localField: "manufacturedetailstransactionrefuid.inputdetails.itemmasteruid", as: "manufacturedetailstransactionrefuid.inputdetails.itemmasteruid" } },
            //-------End สำหรับ กรณี Transaction Type เป็น INVENTORIES.MANUFACTURING, INVENTORIES.REPACKING, INVENTORIES.MANUFACUTINGREPACKING ----------------------------------------------------------//

            //----------- สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKTRANSFERRETURN ----------------------------------------------------------//
            { $lookup: { from: 'stocktransferreturns', localField: 'ledgerdetails.transactionrefuid', foreignField: '_id', as: 'stocktransferreturnstransactionrefuid' } },
            { $unwind: { path: '$stocktransferreturnstransactionrefuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "stocktransferreturnstransactionrefuid.issuetypeuid", as: "stocktransferreturnstransactionrefuid.issuetypeuid" } },
            { $unwind: { path: '$stocktransferreturnstransactionrefuid.issuetypeuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'stocktransfers', localField: 'stocktransferreturnstransactionrefuid.stocktransferuid', foreignField: '_id', as: 'issuecanceltransfertransactionrefuid' } },
            { $unwind: { path: '$issuecanceltransfertransactionrefuid', preserveNullAndEmptyArrays: true } },
            //----------- End สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKTRANSFERRETURN ----------------------------------------------------------//

            //----------- กรณี Transaction Type เป็น COMMON.DISPENSERETURN ใช้แสดง REFERENCE_NO ในการคืนของ ------------------------------------//
            {
            $addFields:{
                referencedispensereturnitem:{
                    $first: {
                        $filter: {
                            input: "$dispensereturntransactionrefuid.itemdetails",
                            as: "item",
                            cond: {
                                $eq: ["$$item._id", "$ledgerdetails.transactionrefitemuid"]
                            }
                        }
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'stockdispenses',
                let: { patientorderitemuid: '$referencedispensereturnitem.parentpatientorderitemuid', patientorderuid: '$referencedispensereturnitem.parentpatientorderuid'},
                pipeline: [
                    { $match: { $expr: { $eq: [ '$patientorderuid', '$$patientorderuid'] } } },
                    {
                        $project: {
                            patientorderitems : 1,
                            itemdetails: 1,
                            stockdispensenumber: 1,
                            patientorderitemuid: "$$patientorderitemuid"
                        }
                    },
                    {
                        $addFields:{
                            itemdetails: {
                                $first: {
                                    $filter: {
                                        input: "$itemdetails",
                                        as: "itemdetail",
                                        cond: {
                                            $and: [
                                                { $eq: ["$$itemdetail.patientorderitemuid", "$patientorderitemuid"] },
                                                { $ne: ["$$itemdetail.iscancelled", true] } //cancel stockdispenses เป็นการคืนของกลับเข้า HIS แต่ query ตรงนี้จะใช้เช็คเฉพาะการทำ dispensed return ซึ่งจะต้องไม่ใช่การคืนไปที่รายการที่มีการ cancel stockdispense
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        $match: {
                            itemdetails: { $ne: null }
                        }
                    },
                    {
                        $project: {
                            "stockdispensenumber": 1
                        }
                    },
                ],
                as: 'referencedispensenumber'
            }
        },
        {
            $addFields:{
                referencedispensenumber:{
                    $first: "$referencedispensenumber.stockdispensenumber" //กรณี Transaction Type เป็น COMMON.DISPENSERETURN ใช้แสดง REFERENCE_NO ในการคืนของ
                }
            }
        },
        //----------- End กรณี Transaction Type เป็น COMMON.DISPENSERETURN ใช้แสดง  REFERENCE_NO ในการคืนของ ------------------------------------//

        //------ สำหรับ กรณี Transaction Type เป็น PHARMACYMASTER.CANCELDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ -----------//
        {
            $addFields:{
                referencephamacycanceldispenseitem:{
                    $first: {
                        $filter: {
                            input: "$canceldispensetransactionrefuid.itemdetails",
                            as: "item",
                            cond: {
                                $eq: ["$$item._id", "$ledgerdetails.transactionrefitemuid"]
                            }
                        }
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'stockdispenses',
                let: { itemdetail_id : '$referencephamacycanceldispenseitem._id', patientorderuid: '$referencephamacycanceldispenseitem.patientorderuid'},
                pipeline: [
                    { $match: { $expr: { $eq: [ '$patientorderuid', '$$patientorderuid'] } } },
                    {
                        $project: {
                            patientorderitems : 1,
                            itemdetails: 1,
                            stockdispensenumber: 1,
                            itemdetail_id: "$$itemdetail_id"
                        }
                    },
                    {
                        $addFields:{
                            itemdetails: {
                                $first: {
                                    $filter: {
                                        input: "$itemdetails",
                                        as: "itemdetail",
                                        cond: {
                                            $and: [
                                                { $eq: ["$$itemdetail._id", "$itemdetail_id"] },
                                                { $eq: ["$$itemdetail.iscancelled", true] } //PHARMACYMASTER.CANCELDISPENSE จะเป็น items ที่ iscancelled = true
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        $match: {
                            itemdetails: { $ne: null }
                        }
                    },
                    {
                        $project: {
                            "stockdispensenumber": 1
                        }
                    }
                ],
                as: 'referencephamacycanceldispensenumber'
            }
        },
        {
            $addFields:{
                referencephamacycanceldispensenumber:{
                    $first: "$referencephamacycanceldispensenumber.stockdispensenumber" //กรณี Transaction Type เป็น PHARMACYMASTER.CANCELDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ
                }
            }
        },
        //------ End สำหรับ กรณี Transaction Type เป็น PHARMACYMASTER.CANCELDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ -----------//
        
        //------ สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ -----------//
        {
            $addFields:{
                referenceinventorydispenseitem:{
                    $first: {
                        $filter: {
                            input: "$stockdispensetransactionrefuid.itemdetails",
                            as: "item",
                            cond: {
                                $eq: ["$$item._id", "$ledgerdetails.transactionrefitemuid"]
                            }
                        }
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'stockdispenses',
                let: { itemdetail_id : '$referenceinventorydispenseitem._id', patientorderuid: '$referenceinventorydispenseitem.patientorderuid'},
                pipeline: [
                    { $match: { $expr: { $eq: [ '$patientorderuid', '$$patientorderuid'] } } },
                    {
                        $project: {
                            patientorderitems : 1,
                            itemdetails: 1,
                            stockdispensenumber: 1,
                            itemdetail_id: "$$itemdetail_id"
                        }
                    },
                    {
                        $addFields:{
                            itemdetails: {
                                $first: {
                                    $filter: {
                                        input: "$itemdetails",
                                        as: "itemdetail",
                                        cond: {
                                            $and: [
                                                { $eq: ["$$itemdetail._id", "$itemdetail_id"] },
                                                { $eq: ["$$itemdetail.iscancelled", true] } //PHARMACYMASTER.CANCELDISPENSE จะเป็น items ที่ iscancelled = true
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        $match: {
                            itemdetails: { $ne: null }
                        }
                    },
                    {
                        $project: {
                            "stockdispensenumber": 1
                        }
                    },
                ],
                as: 'referenceinventorydispensenumber'
            }
        },
        {
            $addFields:{
                referenceinventorydispensenumber:{
                    $first: "$referenceinventorydispensenumber.stockdispensenumber" //กรณี Transaction Type เป็น INVENTORIES.STOCKDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ
                }
            }
        },
        //------ End สำหรับ กรณี Transaction Type เป็น INVENTORIES.STOCKDISPENSE ใช้แสดง  REFERENCE_NO ในการคืนของ -----------//
        {
            $project: {
                "orguid": 1,
                "patientvisituid": 1,
                "patientorderuid": 1,
                "ledgerdetails._id": 1,
                "itemmasteruid": 1,
                "storeuid": 1,
                "batchid": 1,
                "expirydate": "$expirydate",
                // เงื่อนไขแสดง referencedispense => REFERENCE_NO การคืนของกลับเข้า HIS ของ Transaction PHARMACYMASTER.CANCELDISPENSE, COMMON.DISPENSERETURN, INVENTORIES.STOCKTRANSFERRETURN, INVENTORIES.STOCKDISPENSE
                "referencedispense": {
                    $switch: {
                        branches: [
                            { case: { $eq: ["$ledgerdetails.transactiontype", "PHARMACYMASTER.CANCELDISPENSE"] }, then: '$referencephamacycanceldispensenumber' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "COMMON.DISPENSERETURN"] }, then: '$referencedispensenumber' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKTRANSFERRETURN"] }, then: '$issuecanceltransfertransactionrefuid.stocktransfernumber' },
                            { case: { $and : [ 
                                { $eq : ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKDISPENSE"] },//รายการคืนของประเภท INVENTORIES.STOCKDISPENSE
                                { $gt : ["$ledgerdetails.quantity", 0] } ] }, then: '$referenceinventorydispensenumber'
                            }
                        ],
                        default: " "
                    }
                },
                "ledgerdetails.transactiondate": { $dateToString: { date : "$ledgerdetails.transactiondate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                "ledgerdetails.wac": { $ifNull: ["$ledgerdetails.wac", 0] },
                "ledgerdetails.quantityuom": 1,
                "ledgerdetails.quantity": 1,
                "ledgerdetails.transactiontype": 1,
                "ledgerdetails.transactionrefitemuid": 1,
                "ledgerdetails.transactionrefuid": {
                    $switch: {
                        branches: [
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.GOODSRECEIVE"] }, then: '$goodsreceivetransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.CANCELTRANSFER"] }, then: '$canceltransfertransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.TRANSFEROUT"] }, then: '$transferintransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.TRANSFERIN"] }, then: '$transferintransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKISSUE"] }, then: '$transferintransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKDISPENSE"] }, then: '$stockdispensetransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "PHARMACYMASTER.CANCELDISPENSE"] }, then: '$canceldispensetransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "PHARMACYMASTER.IPFILL"] }, then: '$ipfilltransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "COMMON.DISPENSERETURN"] }, then: '$dispensereturntransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.VENDORRETURN"] }, then: '$vendorreturntransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKADJUST"] }, then: '$stockadjusttransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.MANUFACTURING"] }, then: '$manufacturedetailstransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.REPACKING"] }, then: '$manufacturedetailstransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.MANUFACUTINGREPACKING"] }, then: '$manufacturedetailstransactionrefuid' },
                            { case: { $eq: ["$ledgerdetails.transactiontype", "INVENTORIES.STOCKTRANSFERRETURN"] }, then: '$stocktransferreturnstransactionrefuid' }
                        ],
                        default: " "
                    }
                },
                "grntypeuid" : "$goodsreceivetransactionrefuid.grntypeuid"
            }
        },
        {
            $project: {
                "orguid": 1,
                "ledgerdetails": 1,
                "itemmasteruid": 1,
                "storeuid": 1,
                "batchid": 1,
                "expirydate": 1,
                "referencedispense": 1,
                "filterpatientorderitems": {
                    $arrayElemAt: [{
                        $filter: {
                            input: "$ledgerdetails.transactionrefuid.itemdetails",
                            as: "itemdetails",
                            cond: {
                                $and: [
                                    { $eq: ["$$itemdetails.itemmasteruid", "$itemmasteruid._id"] },
                                    { $eq: ["$$itemdetails._id", "$ledgerdetails.transactionrefitemuid"] },
                                ]
                            }
                        }
                    }, 0],
                },
                grntypeuid : 1
            }
        },
        { $lookup: { from: "patientorders", foreignField: "_id", localField: "filterpatientorderitems.patientorderuid", as: "filterpatientorderitems.patientorderuid" } },
        { $unwind: { path: '$filterpatientorderitems.patientorderuid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", foreignField: "_id", localField: "filterpatientorderitems.patientorderuid.entypeuid", as: "entypeuid" } },
        { $unwind: { path: '$entypeuid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", foreignField: "_id", localField: "ledgerdetails.transactionrefuid.patientvisituid.entypeuid", as: "entypeuid" } },
        { $unwind: { path: '$entypeuid', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                "orguid": 1,
                "ledgerdetails": 1,
                "itemmasteruid": 1,
                "storeuid": 1,
                "batchid": 1,
                "expirydate": 1,
                "entypeuid": "$entypeuid.relatedvalue",
                "filterpatientorderitems": 1,
                "referencedispense": 1,
                "filterpatientvisitpayor":
                {
                    $arrayElemAt: [
                        {
                            $filter: {
                                input: "$filterpatientorderitems.patientorderuid.patientorderitems",
                                as: "patientorderitems",
                                cond: {
                                    $and: [
                                        { $eq: ["$$patientorderitems._id", "$filterpatientorderitems.patientorderitemuid"] }
                                    ]
                                }
                            }
                        }, 0],
                },
                grntypeuid : 1
            }
        },
        {
            $project: {
                "orguid": 1,
                "ledgerdetails": 1,
                "itemmasteruid": 1,
                "storeuid": 1,
                "batchid": 1,
                "expirydate": 1,
                "entypeuid": 1,
                "filterpatientorderitems": 1,
                "filterpatientvisitpayor": 1,
                "referencedispense": 1,
                "getpatientvisitpayor":
                {
                    $arrayElemAt: [{
                        $filter: {
                            input: "$ledgerdetails.transactionrefuid.patientvisituid.visitpayors",
                            as: "visitpayors",
                            cond: {
                                $and: [
                                    { $eq: ["$$visitpayors.orderofpreference", 1] }
                                ]
                            }
                        }
                    }, 0],
                },
                grntypeuid : 1
            }
        },
        { $lookup: { from: "payors", foreignField: "_id", localField: "getpatientvisitpayor.payoruid", as: "payoruid" } },
        { $unwind: { path: '$payoruid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "payoragreements", foreignField: "_id", localField: "getpatientvisitpayor.payoragreementuid", as: "payoragreementuid" } },
        { $unwind: { path: '$payoragreementuid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tpas", foreignField: "_id", localField: "getpatientvisitpayor.tpauid", as: "tpauid" } },
        { $unwind: { path: '$tpauid', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", foreignField: "_id", localField: "tpauid.arcategoryuid", as: "tpauid.arcategoryuid" } },
        { $unwind: { path: '$tpauid.arcategoryuid', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                "orguid": 1,
                "ledgerdetails": 1,
                "itemmasteruid": 1,
                "storeuid": 1,
                "batchid": 1,
                "expirydate": 1,
                "entypeuid": 1,
                "filterpatientorderitems": 1,
                "filterpatientvisitpayor": 1,
                "getpatientvisitpayor": 1,
                "payoruid": 1,
                "payoragreementuid": 1,
                "tpauid": 1,
                "referencedispense": 1,
                "payortype": {
                    $switch: {
                        branches: [
                            { case: { $eq: ["$tpauid.arcategoryuid.valuecode", "1"] }, then: "UC" }
                        ],
                        default: ""
                    }
                },
                patientvisituid: { $ifNull: ["$ledgerdetails.transactionrefuid.patientvisituid", null] },
                grntypeuid : 1,
                mrn : { $ifNull: ["$ledgerdetails.transactionrefuid.patientuid.mrn", ""] },
            }
        },
        {
            $match: {
                "mrn":  { $regex: '.*' + escRe(mrn) + '.*' }
            }
        },
        { $lookup: { from: "admissionrequests", foreignField: "patientvisituid", localField: "patientvisituid._id", as: "admissionrequests" } },
        {
            $addFields: {
                referringdepartmentuid: {
                    $cond:
                    {
                        if: { $isArray: "$admissionrequests" },
                        then: { $ifNull: [{ $arrayElemAt: ["$admissionrequests.referringdepartmentuid", 0] }, null] },
                        else: null
                    }
                },
                firstdepartment: { $arrayElemAt: ["$patientvisituid.visitcareproviders.departmentuid", 0] },
                parentpatientorderuid: {
                    $cond:
                    {
                        if: { $eq: ["$ledgerdetails.transactiontype", "COMMON.DISPENSERETURN"] },
                        then: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: "$ledgerdetails.transactionrefuid.itemdetails",
                                        as: "itemdetailsdata",
                                        cond: {
                                            $and: [
                                                { $eq: ["$$itemdetailsdata._id", "$ledgerdetails.transactionrefitemuid"] },
                                            ]
                                        }
                                    }
                                }, 0]
                        },
                        else: { $ifNull: ["$ledgerdetails.transactionrefuid.patientorderuid._id", null] }
                    }
                },
            }
        },
        {
            $addFields: {
                orderfromdeptfirst: {
                    $cond:
                    {
                        if: { $eq: ["$ledgerdetails.transactiontype", "COMMON.DISPENSERETURN"] },
                        then: { $ifNull: ["$parentpatientorderuid.parentpatientorderuid", null] },
                        else: "$parentpatientorderuid"
                    }
                },
            }
        },
        { $lookup: { from: "departments", foreignField: "_id", localField: "orderfromdeptfirst", as: "orderfromdeptfirst" } },
        { $unwind: { path: '$orderfromdeptfirst', preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                transactiontype: "$ledgerdetails.transactiontype",
                departmentcostcenteruid:
                {
                    $ifNull: [
                        {
                            $cond:
                            {
                                if: { $eq: ["$entypeuid", "PACKAGE"] },
                                then: "$userdepartment",
                                else: {
                                    $cond:
                                    {
                                        if: { $eq: ["$entypeuid", "OPD"] },
                                        then: {
                                            $cond:
                                            {
                                                if: { $eq: ["$orderfromdeptfirst.isregistrationallowed", true] },
                                                then: "$orderfromdeptfirst._id",
                                                else: "$firstdepartment"
                                            }
                                        },
                                        else: {
                                            $cond:
                                            {
                                                if: { $eq: ["$orderfromdeptfirst.isregistrationallowed", true] },
                                                then: "$orderfromdeptfirst._id",
                                                else: {
                                                    $cond:
                                                    {
                                                        if: { $eq: ["$orderfromdeptfirst.isadmissionallowed", true] },
                                                        then: { $ifNull: ["$referringdepartmentuid", "$firstdepartment"] },
                                                        else: "$firstdepartment"
                                                    }
                                                },
                                            }
                                        },
                                    }
                                }
                            }
                        }
                        , []]
                }
            }
        },
        { $lookup: { from: "departments", foreignField: "_id", localField: "departmentcostcenteruid", as: "departmentcostcenteruid" } },
        { $unwind: { path: '$departmentcostcenteruid', preserveNullAndEmptyArrays: true } },
        {
            $match : {
                $or:[ 
                    
                    { "ledgerdetails.transactionrefuid.stocktransfernumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.vendorreturnnumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.manufacturingnumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.stockdispensenumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.stockadjustnumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.grnnumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.dispensereturnnumber" : { $regex: '.*' + escRe(orderno) + '.*' }},
                    { "ledgerdetails.transactionrefuid.returnnumber" : { $regex: '.*' + escRe(orderno) + '.*' }}
                ],
                ...(morefilter || {})
            }
        },
    ];

    return trackingInBatches(pipeline, transactiontypefilter, parseInt(page, 10) || 0, perpage);
    }

    exports.getInterfaceItemMaster = async function (orguid, code, page = null) {
        let search = {};

        if(code) {
            search.code = code;
        }

        //search.createdbycode = 'INTERFACE';

        let data = await mongoose.connection.db
        .collection("itemmasters")
        .aggregate(
            [
                {
                    $match : {
                        "statusflag" : 'A',
                        "orguid" :  mongoose.Types.ObjectId(orguid),
                        ...search
                    }
                },
                // Limit before the lookups: each item yields at least one row per store,
                // so the newest 200 items cover the newest 200 rows.
                { $sort : { _id : -1}},
                // Paged: enough items for the page's rows (each item gives at least one), then the page's rows.
                { $limit : page ? page.skip + page.limit : 200},
                { $unwind: { path: "$handlingstores", preserveNullAndEmptyArrays: true } },
                ...paging.stages(page, 200),
                { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
                { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
                {
                    $project : {
                        createdat : "$createdat", 
                        code : "$code",
                        name : "$name",
                        externalcode : { $ifNull: ['$externalcode' , ''] },
                        description : "$description",
                        baseuomuid : "$baseuomuid",
                        purchasinguomuid : "$purchasinguomuid",
                        storeuid : "$handlingstores.storeuid",
                        createdby : "$users.name",
                        createdbycode : "$users.code",
                        allowconsignmentstock : "$allowconsignmentstock",
                        allowfractions : "$allowfractions",
                        allownegativestock : "$allownegativestock",
                        allowconsignmentstock : "$allowconsignmentstock",
                        allowrepacking : "$allowrepacking",
                        isbatchidmandatory : "$isbatchidmandatory",
                        isexpirydatemandatory : "$isexpirydatemandatory",
                        ismanufacturingitem : "$ismanufacturingitem",
                        isnoninventoryitem : "$isnoninventoryitem",
                        itemtypeuid : "$itemtypeuid"
                    }
                },
                { $lookup: { from: "referencevalues", localField: "baseuomuid", foreignField: "_id", as: "baseuom" } },
                { $lookup: { from: "referencevalues", localField: "purchasinguomuid", foreignField: "_id", as: "purchasinguom" } },
                { $lookup: { from: "inventorystores", localField: "storeuid", foreignField: "_id", as: "inventorystores" } },
                { $lookup: { from: "referencevalues", localField: "itemtypeuid", foreignField: "_id", as: "itemtype" } },
                { $unwind: { path: "$baseuom", preserveNullAndEmptyArrays: true } },
                { $unwind: { path: "$purchasinguom", preserveNullAndEmptyArrays: true } },
                { $unwind: { path: "$inventorystores", preserveNullAndEmptyArrays: true } },
                { $unwind: { path: "$itemtype", preserveNullAndEmptyArrays: true } },
                {
                    $project : {
                        createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        createdatforsort : "$createdat",
                        code : 1,
                        name : 1,
                        externalcode : 1,
                        baseuomcode : "$baseuom.valuecode",
                        baseuomname : "$baseuom.valuedescription",
                        purchasinguomcode : "$purchasinguom.valuecode",
                        purchasinguomname : "$purchasinguom.valuedescription",
                        storecode : "$inventorystores.code",
                        storename : "$inventorystores.name",
                        createdby : 1,
                        itemtype : "$itemtype.valuedescription",
                        allowconsignmentstock : 1,
                        allowfractions : 1,
                        allownegativestock : 1,
                        allowconsignmentstock : 1,
                        allowrepacking : 1,
                        isbatchidmandatory : 1,
                        isexpirydatemandatory : 1,
                        ismanufacturingitem : 1,
                        isnoninventoryitem : 1,
                        createdbycode : 1
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
    
        return data;
    };

    exports.getInterfaceVendorMaster = async function (orguid, page = null) {
        let data = await mongoose.connection.db
        .collection("vendors")
        .aggregate(
            [
                {
                    $match : {
                        "orguid" :  mongoose.Types.ObjectId(orguid)
                    }
                },
                // Sort on the real date (the formatted dd/mm/yyyy string does not sort chronologically)
                { $sort : {"createdat": -1, "_id": -1}},
                ...paging.stages(page, 50),
                { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
                { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
                {
                    $project : {
                        createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        code : "$code",
                        name : "$name",
                        description : "$description",
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
    
        return data;
    };

    exports.getInterfaceGR = async function (orguid, grn, page = null) {
        let search = {};

        if(grn)
            search.grnnumber = grn;

        let data = await mongoose.connection.db
        .collection("goodsreceives")
        .aggregate(
            [
                {
                    $match : {
                        statusflag: 'A',
                        "orguid" :  mongoose.Types.ObjectId(orguid),
                        ...search
                    }
                },
                { $sort : {"_id": -1}},
                ...paging.stages(page, 50),
                { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
                { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "inventorystores", localField: "storeuid", foreignField: "_id", as: "inventorystores" } },
                { $unwind: { path: "$inventorystores", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "vendors", localField: "vendoruid", foreignField: "_id", as: "vendor" } },
                { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "referencevalues", localField: "statusuid", foreignField: "_id", as: "status" } },
                { $unwind: { path: "$status", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "referencevalues", localField: "grntypeuid", foreignField: "_id", as: "grntype" } },
                { $unwind: { path: "$grntype", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "users", localField: "approvedby", foreignField: "_id", as: "approvedby" } },
                { $unwind: { path: "$approvedby", preserveNullAndEmptyArrays: true } },
                {
                    $project : {
                        createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        grnnumber : "$grnnumber",
                        invoicenumber : "$invoicenumber",
                        invoicedate :  { $dateToString: { date : "$invoicedate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        grntype : "$grntype.valuedescription",
                        storecode : "$inventorystores.code",
                        storename : "$inventorystores.name",
                        vendorcode : { $ifNull: ["$vendor.code", ""]},
                        vendorname : { $ifNull: ["$vendor.name", ""]},
                        comments : { $ifNull: ["$comments", ""]},
                        netamount : { $ifNull: ["$netamount", ""]},
                        items : { $size: "$itemdetails" },
                        approvedby : "$approvedby.name",
                        approvaldate : { $dateToString: { date : "$approvaldate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                        status : { $ifNull: ["$status.valuedescription", ""]},
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
    
        return data;
    };

exports.getInterfaceGRItems = async function (grnuid, orguid) {
    let data = await mongoose.connection.db
      .collection("goodsreceives")
      .aggregate(
        [
            {
                $match : {
                        "_id" : mongoose.Types.ObjectId(grnuid),
                        "orguid" :  mongoose.Types.ObjectId(orguid)
                 }
            },
            { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "users" } },
            { $unwind: { path: "$users", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$itemdetails", preserveNullAndEmptyArrays: true } },
            {
                $project : {
                    grnnumber: "$grnnumber",
                    itemmasteruid : "$itemdetails.itemmasteruid",
                    itemname : "$itemdetails.itemname",
                    comments : "$itemdetails.comments",
                    receivetypeuid : "$itemdetails.receivetypeuid", 
                    quantity : "$itemdetails.quantity",
                    quantityuom : "$itemdetails.quantityuom",
                    purchasinguomuid : "$itemdetails.purchasinguomuid",
                    batchid : "$itemdetails.batchid",
                    unitprice : "$itemdetails.unitprice", 
                    netamount : "$itemdetails.netamount",
                    wac : "$itemdetails.wac"
                }
                
            },
            { $lookup: { from: "itemmasters", localField: "itemmasteruid", foreignField: "_id", as: "itemmasters" } },
            { $lookup: { from: "referencevalues", localField: "receivetypeuid", foreignField: "_id", as: "receivetype" } },
            { $lookup: { from: "referencevalues", localField: "purchasinguomuid", foreignField: "_id", as: "purchasinguom" } },
            { $lookup: { from: "referencevalues", localField: "quantityuom", foreignField: "_id", as: "quantityuom" } },
            { $unwind: { path: "$itemmasters", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$purchasinguom", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$quantityuom", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$receivetype", preserveNullAndEmptyArrays: true } },
             {
                $project : {
                    grnnumber : 1,
                    itemmastercode : "$itemmasters.code",
                    itemname : { $ifNull: [ "$itemname", "$itemmasters.name" ]},
                    comments : "$comments",
                    receivetypeuid : 1, 
                    quantity : 1,
                    quantityuomcode : "$quantityuom.valuecode",
                    quantityuomname : { $ifNull: ["$quantityuom.valuedescription", ""]},
                    purchasinguomcode : "$quantityuom.valuecode",
                    purchasinguom : { $ifNull: ["$purchasinguom.valuedescription", ""]},
                    receivetypecode : "$receivetype.valuecode",
                    receivetypename : { $ifNull: ["$receivetype.valuedescription", ""]},
                    batchid : 1,
                    unitprice : 1, 
                    netamount : 1,
                    wac : { $ifNull: ["$wac", ""]}
                }
                
            },
            { $sort : {"createdat": -1}}
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
  
    return data;
  };

  
  exports.getAvailableItemMasters = async function (orguid, itemuid = '', page = null) {
    let search = {};
    search.statusflag = 'A';
    search.orguid = mongoose.Types.ObjectId(orguid);
    search.quantity = {$gt : 0};

    if(Array.isArray(itemuid) && itemuid.length > 0)
        search.itemmasteruid = itemuid[0]._id;

    let data = await mongoose.connection.db
    .collection("stockledgers")
    .aggregate(
        [
            {
                $match : search
            },
            // quantity, then _id: one order, so the pages neither repeat nor skip rows
            { $sort : { quantity : -1, _id : -1 }},
            ...paging.stages(page, 50),
            { $lookup: { from: "itemmasters", localField: "itemmasteruid", foreignField: "_id", as: "itemmasters" } },
            { $unwind: { path: "$itemmasters", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "quantityuom", foreignField: "_id", as: "quantityuom" } },
            { $unwind: { path: "$quantityuom", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "inventorystores", foreignField: "_id", localField: "storeuid", as: "storeuid" } },
            { $unwind: { path: '$storeuid', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", foreignField: "_id", localField: "itemmasters.itemtypeuid", as: "itemtypeuid" } },
            { $unwind: { path: '$itemtypeuid', preserveNullAndEmptyArrays: true } },
            {
                $project : {
                    'code' : "$itemmasters.code",
                    'name' : "$itemmasters.name",
                    'quantity' : "$quantity",
                    'uom_code' : '$quantityuom.valuecode',
                    'uom' : '$quantityuom.valuedescription',
                    'type' : '$itemtypeuid.valuedescription',
                    'store_code' : '$storeuid.code',
                    'store' : '$storeuid.name',
                    // A wrong expiry date (e.g. year 10007) can't be shown as text and failed the whole list;
                    // it is shown as "⚠ invalid (year …)" instead. The range keeps a day off each end for Bangkok time.
                    'expirydate' : { $cond : [
                        { $and : [ { $gte : [ "$expirydate", VALID_FROM ] }, { $lt : [ "$expirydate", VALID_TO ] } ] },
                        { $dateToString: { date : "$expirydate", format : "%d/%m/%Y", timezone : "Asia/Bangkok" }},
                        { $cond : [ { $eq : [ { $type : "$expirydate" }, "date" ] },
                            { $concat : [ "⚠ invalid (year ", { $toString : { $add : [ 1970, { $floor : { $divide : [ { $toLong : "$expirydate" }, 31556952000 ] } } ] } }, ")" ] },
                            null ] }
                    ]},
                    'batchid' : '$batchid'
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
        // Thrown on: the page shows why the list is empty (it used to break the page with "items is not defined").
        console.error('Available items:', err && err.message ? err.message : err);
        throw err;
    });

    return data || [];
};