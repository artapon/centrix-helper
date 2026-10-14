const mongoose = require("mongoose");
let moment = require("moment-timezone");
exports.getCareProvidersSchedule = async function (orguid) {
  var datestart = new Date(moment().startOf('day').toISOString());
  var dateend = new Date(moment().endOf('day').toISOString());
  let data = await mongoose.connection.db
    .collection("appointmentschedules")
    .aggregate(
      [
        {
            $match: {
                statusflag: 'A',
                appointmentdate: { $gte: datestart, $lte: dateend },
                orguid : mongoose.Types.ObjectId(orguid)
            }
        },
        {
            $unwind: '$timings'
        },
        {
            $lookup: {
                from: 'departments',
                localField: 'departmentuid',
                foreignField: '_id',
                as: 'departmentuid'
            }
        },
        {
            $unwind: '$departmentuid'
        },
        {
            $lookup: {
                from: 'users',
                localField: 'careprovideruid',
                foreignField: '_id',
                as: 'careprovideruid'
            }
        },
        {
            $unwind: '$careprovideruid'
        },
        {
            $lookup: {
                from: 'organisations',
                localField: 'orguid',
                foreignField: '_id',
                as: 'orguid'
            }
        },
        {
            $unwind: '$orguid'
        },
        {
            $project: {
                _id: 0,
                organisations_code: { $ifNull: ['$orguid.code' , ''] },
                appointmentsessionuid: { $ifNull: ['$appointmentsessionuid' , ''] },
                careprovider_code: { $ifNull: ['$careprovideruid.code' , ''] },
                careprovider_name: { $ifNull: ['$careprovideruid.name' , ''] },
                careprovider_licennumber: { $ifNull: ['$careprovideruid.licensenumber' , ''] },
                department_name: { $ifNull: ['$departmentuid.name' , ''] },
                department_code: { $ifNull: ['$departmentuid.code' , ''] },
                appointment_date: { $ifNull: [{ $dateToString: { format: "%Y-%m-%d", date: "$appointmentdate" } }, ''] },
                appointment_starttime: { $ifNull: [{ $dateToString: { format: "%H:%M", date: "$timings.starttime"  } }, ''] },
                appointment_endtime: { $ifNull: [{ $dateToString: { format: "%H:%M", date: "$timings.starttime"  } }, ''] },
                iscancelled : "$iscancelled"
            }
        },
      ]
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