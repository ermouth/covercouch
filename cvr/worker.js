/**
 * CoverCouch 0.1.1 Router
 *
 *
 * Created by ermouth on 18.01.15.
 */

module.exports = function (runtime) {

	var isA = Object.isArray,
		isB = Object.isBoolean,
		isS = Object.isString,
		isO = Object.isObject,
		isN = Object.isNumber,
		isR = Object.isRegExp,
		isF = Object.isFunction,
		log = require('./logger')(runtime);


	/** Cluster */
	if(runtime && runtime.cluster) {
		// monitors controllable shutdown
		// and starts shutdown proc
		process.on('message', function(msg) {
			log("Worker received "+msg.event+" event");
			if (msg && msg.event == "shutdown") runtime.cluster.worker.kill();
		});
	}

	var Q = 			require("q"),
		conf = 			require('./config')(runtime),
		bodyParser = 	require('body-parser'),
		cookieParser = 	require('cookie-parser'),
		basicAuth = 	require('basic-auth'),
		request = 		require('request'),
		http = 			require('http'),
		https = 		require('https'),
		fs = 			require("fs"),
		nano = 			require('nano')(conf.couch.nano),
		express = 		require('express'),
		URL = 			require('url'),
		app = express(),
		router = express.Router(),
		server = http.createServer(app),
		couch = conf.couch.url,
		cvr = {
			log:	log,
			ddoc:	require('./ddoc')(),
			config:	conf,
			db:{},
			user:{
				_anonymous:{
					_id:"org.couchdb.user:_anonymous",name:"_anonymous",
					type:"user",roles:[],_acl:["u-_anonymous"]
				}
			},
			session:{},
			bodyParser:bodyParser,

			Q:Q,
			URL:URL,
			Estream:		require('event-stream'),
			Couch:{
				_pending:	{},
				request: 	Q.denodeify(nano.request),
				cacheDb:	_cacheDb
			},
			Request: 	Q.denodeify(request),
			request: 	request
		};


	// lib
	require('./lib')(cvr);

	// ACL-related fns
	require('./acl')(cvr);

	// Middleware
	([
		require('./rater')(conf),
		require('compression')({ threshold: 4096 }),
		cookieParser(),
		function (req, res, next) {
			// Identify user
			req.basicAuth = basicAuth(req);
			_userBySession (req)
			.done(function(){
				next();
			});
		},
		function(req, res, next){
			// CORS and other headers,
			// unjsonned query
			var i, tmp, json={};
			res.set(conf.headers);
			if(conf.origins && conf.origins[req.headers.origin]) {
				res.set('Access-Control-Allow-Origin', req.headers.origin);
			}
			next();
		},
		require('./router')(router, cvr)
	])
	.forEach(function(e){app.use(conf.server.mount, e);});

	// -- end middleware ---


	// ##### PRELOAD #####
	_readUsers(conf.couch.users)
	.then(function(){ return Q.denodeify(nano.db.list)()})
	.then(_stashDbs)
	.then(_followCouch)
	.done(function () {
		server.listen(conf.server.port);
		log("CoverCouch start");
	});


	// ##### END INIT #####

	//----------------------------

	function _followCouch(){
		var pi = Q.defer(),
			feed = nano.followUpdates({since: "now"});

		feed.on('change', function (c) {
			var msg = false,
				db = c.db_name,
				t = c.type;
			if (t=='created') {
				cvr.db[db] = _newDb(db);
				_cacheDb(db);
				msg = true;

			} else if (t=='deleted'){
				if (cvr.db[db].feed) cvr.db[db].feed.stop();
				cvr.db[db] = undefined;
				msg = true;
			}
			if (msg) log("CouchDB change: "+ t+" "+ db);
		});

		feed.on('error', function(){
			// swallow errors
		});

		feed.follow();
		pi.resolve();
		return pi.promise;
	}

	//----------------------------

	function _userBySession(req, force){
		var cookie = req.cookies.AuthSession||"",
			pi = Q.defer(),
			p,
			h={headers:{'accept-encoding': 'utf-8'}},
			sid = (req.basicAuth?
				new Buffer(req.basicAuth.name+':'+req.basicAuth.pass).toString('base64')
				:
				cookie
			);


		if (!force && cvr.session[sid]) {
			req.session=cvr.session[sid];
			_h();
			pi.resolve();
		}
		else {
			p = {
				url:couch+'/_session',
				headers:{
					'Content-Type': 'application/json',
					Accept: 'application/json'
				}
			};
			if (req.basicAuth)  h.headers.Authorization = "Basic "+sid;
			else h.headers.Cookie = 'AuthSession='+(cookie||"");

			cvr.Request(Object.merge(p,h,true)).done(function(data){
				var ok = true,
					d = JSON.parse(data[1]),
					u, c, s;
				if (d && d.userCtx) {
					u = d.userCtx;
					c = sid;
					if (u.name!=null) {
						//save user/session
						s = { id:c, stamp:Date.now(), user: u.name, headers: h.headers};
						if (cvr.user[u.name] && !cvr.user[u.name].inactive) {
							cvr.session[c] = s;
						} else {
							ok = false;
							cvr.session[c] = void 0;
						}
					}
					else if (c) {
						// drop session
						cvr.session[c] = void 0;
					}
				}

				if (ok) {
					req.session = cvr.session[c]||{id:c,stamp:Date.now(),user:"_anonymous",h:{}};
					_h();
					pi.resolve(data);
				}
				else {
					req.session = null;
					pi.reject(data);
				}
			});
		}

		return pi.promise;

		function _h (){
			req.h = Object.merge(
				Object.clone(
					Object.reject(req.headers,["Authorization","Cookie",'accept-encoding']),
					true
				),
				req.session.h,
				true
			);
		}
	}


	//----------------------------

	function _readUsers (usersDb){
		var udb = nano.use(usersDb),
			ulist = Q.denodeify(udb.list),
			pi = ulist ({include_docs:true});

		pi.then(function(d){

			// Memoize users
			_stashUsers(d[0].rows);

			// Follow _users db
			var feed = udb.follow({since:"now",include_docs:true});
			feed.on('change', function(a){
				var id = a.id, u = a.doc;
				if (/^org\.couchdb\.user:[a-z0-9_]+$/.test(id)) {
					if (a.deleted) delete cvr.user[u.name];
					else _stashUsers([a])
				}
			});
			feed.follow();

		});

		return pi;
	}


	//----------------------------

	function _stashUsers (rows){
		rows.forEach(function(obj){
			var e = obj.doc;
			if (/^org\.couchdb\.user:[a-z0-9_]+$/.test(e._id) && e.type=="user") {
				var u = Object.clone(e,true);
				if (u.password===null) {
					u.admin = true;
					u.roles = u.roles.union('_admin');
				}
				u._acl = ['r-*','u-'+ u.name].union(u.roles.map(function(e){return 'r-'+e;}))
				cvr.user[u.name] = u;
			}
		});
		log("Cached "+Object.size(cvr.user)+" users")
	}


	//----------------------------

	function _stashDbs (data){
		var i, tmp, pre = {}, dbs = data[0], all=[], pi = Q.defer();
		dbs.forEach(function(e){
			cvr.db[e] = _newDb(e);
		});

		for (i=0;i<conf.couch.preload.length;i++) {
			tmp = conf.couch.preload[i];
			pre[tmp]=true;
			if (cvr.db[tmp]) all.push(_cacheDb(tmp, true));
		}

		dbs.forEach(function(e){
			if (!pre[e]) all.push(_cacheDbAclDdoc(e));
		});

		Q.all(all).done(function(data){
			log(data.length+" DBs precached");
			pi.resolve();
		});

		return pi.promise;
	}

	//----------------------------

	function _newDb (name) {
		return {
			acl:{}, ddoc:{},
			cached:false,
			noacl:false,
			isforall:true,
			restricted:false,
			nano:nano.use(name),
			feed:null
		}
	}

	//----------------------------

	function _cacheDbAclDdoc (db, create) {
		var dbv = cvr.db[db],
			pi = Q.defer();

		Q.denodeify(dbv.nano.list)({
			include_docs:true,
			startkey:"_design/acl",
			endkey:"_design/acl"
		})
		.then(function(all) {
			if (all[0].rows.length) {
				log('Found _design/acl for '+db);
				_unwindDdocs(dbv, all[0].rows);
				pi.resolve();
			}
			else if (create){
				// Create ddoc
				Q.denodeify(dbv.nano.insert)(JSON.parse(cvr.lib.json(cvr.ddoc)))
				.then(function(){
					log('Created _design/acl for '+db);
					_cacheDbAclDdoc (db).
					then(function(){
						pi.resolve();
					})
				});
			}
			else pi.resolve();
		});

		return pi.promise;
	}

	//----------------------------

	function _cacheDb (db, create) {
		var dbv = cvr.db[db],
			dbc = dbv.nano,
			pi = Q.defer(),
			_view = Q.denodeify(dbc.view),
			_list = Q.denodeify(dbc.list);

		if (cvr.Couch._pending[db]) return cvr.Couch._pending[db];
		else cvr.Couch._pending[db] = pi.promise;

		_cacheDbAclDdoc (db, create)
		.then(function(){
			if (!dbv.noacl) {
				_view("acl","acl",{startkey:null,endkey:[]})
					.then(function(all){
						all[0].rows.forEach(function(e){
							dbv.acl[e.id]= e.value;
						});
						dbv.cached = true;
						pi.resolve(dbv);
					});
			} else {
				dbv.cached = true;
				pi.resolve(dbv);
			}
		});

		pi.promise.then(function(){

			// Follow bucket

			cvr.Couch._pending[db] = undefined;
			log(
				"Cached DB "
				+db+'. '
				+(dbv.noacl?'No ACL.':Object.size(dbv.acl)+' ACL docs read.'));
			var feed = dbc.follow({since:"now"});
			feed.on('change', function(a){
				var id = a.id,
					ddoc = id==="_design/acl";

				if (a.deleted) {
					if (dbv.acl[id]) dbv.acl[id].s = +a.seq;
					if (ddoc) dbv.ddoc[id] = undefined;
				}
				else {
					// Update ACL
					cvr.ACL.load(db, id, a.seq);
					// Reload if ddoc
					if (ddoc) {
						_list({include_docs:true,startkey:id,endkey:id})
						.then(function(data){
							log ('Updated '+id+' for DB '+db);
							_unwindDdocs(dbv, data[0].rows);
						});
					}
				}
			});
			dbv.feed = feed;
			feed.follow();
		});

		return pi.promise;

	}

	//----------------------------

	function _unwindDdocs(dbv, docs){

		// Prepare some ddoc fields

		var i, j, tmp, dacl, racl;
		for (i=0;i<docs.length;i++) {
			try {
				tmp = cvr.lib.unjson(Object.clone(docs[i].doc, true));
				dbv.ddoc[tmp._id] = tmp;
				if (tmp._id=="_design/acl") dacl = dbv.ddoc[tmp._id];
			}catch(e){
				console.log(e.stack, e.message)
			}
		}
		if (dacl) {
			// unwind dbacl rules
			if (isA(dacl.dbacl)) dacl.dbacl = cvr.ACL.unwind(dacl.dbacl);
			if (isO(dacl.restrict)) {
				dbv._restrict = {};
				racl = dacl.restrict;
				if (isA(racl["*"])) dacl.restrict["*"] = cvr.ACL.unwind(racl["*"]);
				for (i in racl) if (i!="*") {
					var pair, rule, rules = racl[i], dest = [];
					if (isO(rules)) for (j in rules) {
						rule = rules[j];
						if (isA(rule)) {
							pair = [];
							try {
								pair[0] = new RegExp(
									RegExp.escape(
										j.replace('*','ᴥ').replace('+','ᴣ')
									)
										.replace('ᴥ','.+')
										.replace('ᴣ','[^\\/]+')
								);
								pair[1] =  cvr.ACL.unwind(rule);
							} catch(e) {}
							if (pair.length==2) dest.push(pair);
						}
					}
					if (dest.length) dbv._restrict[i.toUpperCase()]=dest;
				}
				dbv.restricted = !!Object.size(dbv._restrict);
			}
		}
		else dacl = dbv.ddoc["_design/acl"];

		dbv.noacl = !dacl || !isF(cvr.lib.getref(dacl, "views.acl.map"));
		dbv.isforall = !dacl || !isO(cvr.lib.getref(dacl, "restrict.*"));

		dacl = tmp = null;
	}
}