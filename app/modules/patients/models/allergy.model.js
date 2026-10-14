const mongoose = require("mongoose");

/**
 * Retrieves active drug allergies for a given patient.
 * 
 * @param {string} orguid - The organization UID.
 * @param {string} patientuid - The patient UID.
 * @returns {Promise<Array>} A promise that resolves to an array of active drug allergies.
 */
exports.getPatientDrugAllergies = async function (orguid, patientuid) {
    let initfilter = {};
    if (patientuid) initfilter.patientuid = patientuid;

    try {
        const allergies = await mongoose.connection.db.collection("allergies").aggregate([
            { $match: initfilter },
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
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$druggroupuid"] } } },
                        { $project: { name: 1 } }
                    ],
                    as: "druggroup"
                }
            },
            { $unwind: { path: "$druggroup", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "druggroups",
                    let: { allergenuid: "$drugallergies.allergenuid" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$allergenuid"] } } },
                        { $project: { name: 1 } }
                    ],
                    as: "allergen"
                }
            },
            { $unwind: { path: "$allergen", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "users",
                    let: { createdby: "$createdby" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$createdby"] } } },
                        { $project: { name: 1 } }
                    ],
                    as: "createdby"
                }
            },
            { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    allergenname: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$type.valuecode", 'ALGTYP1'] }, then: "$allergen.name" },
                                { case: { $eq: ["$type.valuecode", 'ALGTYP2'] }, then: "$drugallergies.tradename" },
                                { case: { $eq: ["$type.valuecode", 'ALGTYP3'] }, then: "$druggroup.name" },
                                { case: { $eq: ["$type.valuecode", 'ALGTYP4'] }, then: "$drugallergies.freetext" }
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
        ], { allowDiskUse: true }).toArray();

        return allergies;
    } catch (err) {
        console.error(err);
        return [];
    }
};