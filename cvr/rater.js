/**
 * CoverCouch early locking middleware.
 * Created by ermouth on 29.01.15.
 */
module.exports = function (conf) {

	// Returns middlewares that
	// prevents CouchDB from overload.
	// Locks on per-ip and overall request rates.
	// See server.rater params in config.js.
	var rate = require('memory-rate'),
		r = conf.server.rater;

	return [
		rate.middleware({
			interval: r.all.interval,
			msTime: true,
			setHeaders: false,
			limit: r.all.limit,
			getKeys: function (req) {
				return ["*"];
			},
			onLimit: function (req, res, next, options, rate) {
				res.set(502).end();
			}
		}),

		rate.middleware({
			interval: r.ip.interval,
			msTime: true,
			limit: r.ip.limit,
			getKeys: function (req) {
				return [req.connection.remoteAddress];
			},
			onSetHeaders: function (req, res, options, rate) {
				var remaining = options.limit - rate.value[1];
				res.setHeader('X-RateLimit-Limit', options.limit);
				res.setHeader('X-RateLimit-Remaining', remaining >= 0 ? remaining : 0);
			},
			onLimit: function (req, res, next, options, rate) {
				res.set(420).end();
			}
		})
	];

};