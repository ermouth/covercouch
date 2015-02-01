/**
 * Created by ftescht on 18.04.2014.
 */

module.exports = function(runtime) {

	var workerId = runtime && runtime.cluster && runtime.cluster.worker ? runtime.cluster.worker.id : null,
		workerKey = workerId != null ? '[worker#'+ workerId +']' : "";

	return function (message, type, args) {
		var time = new Date(),
			logObject = {
				type: (type !== null && type !== undefined) ? type : "info",
				message: message
			};
		if (args !== undefined) {
			try {
				logObject.args = args !== null ? Object.clone(args, true) : null;
			} catch (e) {
				logObject.args = Object.clone(args.toString(), true);
			}
		}
		console.log(
				time.iso() +
				workerKey +
				"[" + logObject.type + "]: "+
				JSON.stringify(logObject.message)
		);
	};

};