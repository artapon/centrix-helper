const mongoose = require("mongoose");

exports.getAllReportTemplate = async function (orguid) {
    let initfilter = {};
    initfilter.statusflag = 'A';
    initfilter.orguid = mongoose.Types.ObjectId(orguid);
    let reporttemplates = await mongoose.connection.db
        .collection("reporttemplates")
        .aggregate(
            [
                {
                    $match: initfilter
                }],
            { allowDiskUse: true }
        )
        .toArray()
        .then(function (res) {
            return res;
        })
        .catch(function (err) {
            console.error("Error in getAllReportTemplate:", err);
            return [];
        });

    return reporttemplates;
}