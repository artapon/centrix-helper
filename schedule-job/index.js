const http = require('http');
const schedule = require('node-schedule');
let moment = require('moment')
let times = [
  {hour: 00, minute: 00}
];
times.forEach(function(time) {
  var j = schedule.scheduleJob(time, function() {
    // your job
    console.log(moment().format('DD/MM/YYYY hh:mm') + '| Bed API Schedule Job Running !!');
    const options = {
      hostname: 'localhost',
      port: 8085,
      path: '/etl/run',
      method: 'GET'
    }
    const req = http.request(options, res => {
      res.on('data', function (chunk) {
        console.log(moment().format('DD/MM/YYYY hh:mm') + '| Response: '+ res.statusCode + " " + chunk);
      });
    
    });
    req.on('error', error => {
      console.error(error)
    })
    req.end()
  });
})
