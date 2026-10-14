const mongoose = require("mongoose");

exports.getlistCollections = async function () {
  let colections = await mongoose.connection.db
    .listCollections()
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      return err;
    });

    return colections;
};

exports.getTransactionlistCollections = async function () {
  let colections = await mongoose.connection.db
    .listCollections()
    .toArray()
    .then(function (res) {
      let excludeds = ["system.views"];
      let count = 0;
      let lists = [];
      res.forEach(async collection => {
        console.log(collection.name)
        if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
          let query = {"patientvisituid": { $exists: true }};
          count = await mongoose.connection.db.collection(collection.name).find(query).count();
          lists.push({
            collection : collection.name,
            countdata : count
          })
        }
      })
      return lists;
    })
    .catch(function (err) {
      return err;
    });

    return colections;
};

exports.getlistCollectionsActiveTo = async function (collection) {
  if(!collection) return [];
  let excludeds = ["system.views"];
  let results = [];
  try {
    if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
      results = await mongoose.connection.db
      .collection(collection.name)
      .aggregate(
        [
          {
            $match : {
              $or: [
                {activeto: {$ne: null}},
                {activeto: {$lte: new Date()}}
              ]
            }  
          }
        ]
      )
      .toArray()
      .then(function (data) {
        return data.length;
      })
      .catch(function (err) {
        console.log(collection)
        return err;
      });
    }
  } catch (error) {
    console.log(collection)
  }
  return results;
}

exports.getlistCollectionsstatusFlagD = async function (collection) {
  if(!collection) return [];
  let excludeds = ["system.views"];
  let results = [];
  try {
    if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
      results = await mongoose.connection.db
      .collection(collection.name)
      .aggregate(
        [
          {
            $match : {
              statusflag : "D"
            }  
          }
        ]
      )
      .toArray()
      .then(function (data) {
        return data.length;
      })
      .catch(function (err) {
        console.log(collection)
        return err;
      });
    }
  } catch (error) {
    console.log(collection)
  }
  return results;
}

exports.getInterfaceUser = async function (orguid) {
  let user = await mongoose.connection.db
    .collection("users")
    .aggregate(
      [
        {
            $match : {
                "statusflag" : "A",
                "code" : "INTERFACE",
                "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        }],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return user;
}

exports.getRadiologySettings = async function (orguid) {
  let setting = await mongoose.connection.db
    .collection("radiologysettings")
    .aggregate(
      [
        {
            $match : {
                "statusflag" : "A",
                "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        }],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return setting;
}

exports.getEMRSettings = async function (orguid) {
  let setting = await mongoose.connection.db
    .collection("emrsettings")
    .aggregate(
      [
        {
            $match : {
                "statusflag" : "A",
                "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        }],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return setting;
}

exports.getSequenceNumber = async function (code, paramvalue, orguid) {
  let setting = await mongoose.connection.db
    .collection("sequencenumbers")
    .aggregate(
      [
        {
            $match : {
                "statusflag" : "A",
                "code" : code,
                "orguid" : mongoose.Types.ObjectId(orguid),
                "paramvalue" : paramvalue
            }  
        }],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return setting;
}

exports.getReferenceDomains = async function (code, orguid) {
  let setting = await mongoose.connection.db
    .collection("referencedomains")
    .aggregate(
      [
        { 
          $match : {
             "statusflag" : "A",
             "activeto" : null,
             "code" : code
          }
        },
        { $unwind: { path: "$values", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "values", foreignField: "_id", as: "referencevalues" } },
        { $unwind: { path: "$referencevalues", preserveNullAndEmptyArrays: true } },
        { 
          $match : {
             "referencevalues.activeto" : null 
          }
        },
        {
            $project : {
                uid: "$_id",
                code : "$code",
                name : "$name",
                valuecode : "$referencevalues.valuecode",
                valuedescription : "$referencevalues.valuedescription",
                relatedvalue : "$referencevalues.relatedvalue",
                locallanguagedesc : "$referencevalues.locallanguagedesc"
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

  return setting;
}

exports.getThirdPartySettings = async function (orguid) {
  let settings = await mongoose.connection.db
    .collection("thirdpartysettings")
    .aggregate(
      [
        { $match : {statusflag : "A", "orguid" : orguid }},
        { $unwind: { path: "$modules", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$modules.apiurls", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                modulename : "$modules.name",
                apiname : "$modules.apiurls.name",
                url : "$modules.apiurls.url",
                isactive : "$modules.apiurls.isactive"
            }
        },
        { $match : {isactive : true }},
        {$sort : {"isactive" : -1}}
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

  return settings;
}

exports.getDoctorShareType = async function (orguid) {
  let settings = await mongoose.connection.db
    .collection("accountbillingmappings")
    .aggregate(
      [
        { $match : {statusflag : "A", "orguid" : orguid , activeto : null, code : {$in : ['DFXRAY', 'DFDENTAL', 'DFOTHERS']}}},
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

  return settings;
}

exports.countlistCollectionsTransaction = async function (collection) {
  if(!collection) return [];
  let excludeds = ["system.views"];
  let results = [];
  try {
    if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
      results = await mongoose.connection.db
      .collection(collection.name)
      .aggregate(
        [
          {
            $match : {
              patientvisituid : {$exists : true}
            }  
        },
        ], { allowDiskUse: true }
      )
      .toArray()
      .then(function (data) {
        return data.length;
      })
      .catch(function (err) {
        console.log(collection)
        return err;
      });
    }
  } catch (error) {
    console.log(collection)
  }
  return results;
}

exports.countlistCollectionsPatient = async function (collection) {
  if(!collection) return [];
  let excludeds = ["system.views"];
  let results = [];
  try {
    if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
      results = await mongoose.connection.db
      .collection(collection.name)
      .aggregate(
        [
          {
            $match : {
              patientuid : {$exists : true}
            }  
        },
        ], { allowDiskUse: true }
      )
      .toArray()
      .then(function (data) {
        return data.length;
      })
      .catch(function (err) {
        console.log(collection)
        return err;
      });
    }
  } catch (error) {
    console.log(collection)
  }
  return results;
}

exports.countlistCollectionsMaster = async function (collection) {
  if(!collection) return [];
  let excludeds = ["system.views"];
  let results = [];
  try {
    if(collection.type == "collection" && !(collection.name).includes(excludeds)) {
      results = await mongoose.connection.db
      .collection(collection.name)
      .aggregate(
        [
          {
            $match : {
              patientvisituid : {$exists : false},
              patientuid : {$exists : false}
            }  
        },
        ], { allowDiskUse: true }
      )
      .toArray()
      .then(function (data) {
        return data.length;
      })
      .catch(function (err) {
        console.log(collection)
        return err;
      });
    }
  } catch (error) {
    console.log(collection)
  }
  return results;
}

exports.getReferenceValues = async function (code, orguid) {
  let setting = await mongoose.connection.db
    .collection("referencevalues")
    .aggregate(
      [
        { 
          $match : {
             "statusflag" : "A",
             "activeto" : null,
             "domaincode" : code
          }
        },
        {
            $project : {
                uid : "$_id",
                code : "$valuecode",
                valuedescription : "$valuedescription",
                locallanguagedesc : "$locallanguagedesc",
                relatedvalue : "$relatedvalue"
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

  return setting;
}

exports.getCountPatients = async function (code, orguid) {
  let setting = await mongoose.connection.db
    .collection("patients")
    .aggregate(
      [
        { 
          $match : {
             "statusflag" : "A",
             "activeto" : null,
             "domaincode" : code
          }
        },
        {
            $project : {
                code : "$valuecode",
                valuedescription : "$valuedescription",
                locallanguagedesc : "$locallanguagedesc",
                relatedvalue : "$relatedvalue"
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

  return setting;
}

exports.getEDCConfigs = async function (code, orguid) {
  let setting = await mongoose.connection.db
    .collection("edcconfigs")
    .aggregate(
      [
        { 
          $match : {
             "statusflag" : "A",
          }
        },
        { $lookup: { from: "referencevalues", localField: "banknameuid", foreignField: "_id", as: "bankname" } },
        { $unwind: { path: "$bankname", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                name : "$name",
                domaincode : "$bankname.domaincode",
                valuecode : "$bankname.valuecode",
                bankname : "$bankname.valuedescription",
                relatedvalue : "$bankname.relatedvalue",
                saleapi : "$saleapi",
                voidapi : "$voidapi",
                serialport : "$serialport",
                proxyurl : "$proxyurl"
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

  return setting;
}


