/**
 * CoverCouch 0.1
 * Read ACL for CouchDB
 *
 * Created by ermouth on 18.01.15.
 */


require('sugar');

var worker = require('./cvr/worker'),
	runtime = {
		cluster: require('cluster'),
		root: __dirname
	},
	conf = require('./cvr/config')(runtime),
	log = require('./cvr/logger')(runtime);

if (runtime.cluster.isMaster) {

	var cpus = conf.workers.count || require('os').cpus().length,
		fs = require('fs'),
		workers = [];

	// On worker die
	runtime.cluster.on('exit', function(worker) {
		for (var i=0; i < workers.length; i++) if (worker.id == workers[i].id) workers[i] = null;
		workers = workers.compact(true);
		workers.push(runtime.cluster.fork());
	});

	fs.watch(runtime.root + '/cvr/config.js', function (event, filename) {
		_restart('Config changed');
	});

	// Fork workers
	for(var i = 0; i < cpus; i++) workers.push(runtime.cluster.fork());

	// Restarter
	var _restart = function (msg) {
			log('Restart workers: '+msg);
			var i = workers.length;
			while (i--) _stop.fill(workers[i]).delay(i*conf.workers.reloadOverlap);
		},
		_stop = function(w) {
			if(w) {
				w.send({event: 'shutdown', time: Date.now()});
				_kill.fill(w).delay(conf.workers.killDelay);
			}
		},
		_kill = function(w) {
			if(w && w.suicide === undefined) w.kill();
		},
		_restarter = function() {
			if (Date.create().getHours() == (conf.workers.reloadAt || 0)) _restart('Daily restart');
		},
		restarter = setInterval(_restarter, 36e5);

} else if (runtime.cluster.isWorker) worker(runtime);
