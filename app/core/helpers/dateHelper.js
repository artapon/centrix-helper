const methods = {
  fromDateUTC(date, timezone = 7) {
    let fromDate = new Date(date);
    fromDate.setHours(fromDate.getHours() - timezone);
    return fromDate;
  },
  toDateUTC(date, timezone = 7, plus = 1) {
    let toDate = new Date(date);
    toDate.setHours(toDate.getHours() - timezone);
    toDate.setMilliseconds(toDate.getMilliseconds() - 1);
    toDate.setDate(toDate.getDate() + plus);
    return toDate;
  }
}
module.exports = { ...methods }